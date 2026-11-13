const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const AudioClip = require('./models/AudioClip');
const Train = require('./models/Train');
const { getAudioMetadata } = require('./audioMetadata');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const STATUSES = ['pending', 'recorded', 'archived'];
const SORTABLE_FIELDS = ['key', 'status', 'category', 'durationSeconds', 'fileSizeBytes', 'requestedAt', 'recordedAt', 'updatedAt', 'version'];

const DEFAULT_MIN_SILENCE = 0.2; // seconds - a pause shorter than this is left alone
const MIN_SILENCE_FLOOR = 0.05;  // most aggressive the slider allows
const MIN_SILENCE_CEILING = 1.5; // gentlest the slider allows
// -0.4dB is where the original digit/phrase clips (daya_chesi, kindAttention,
// 0-9 in all 3 languages) actually peak - matching it exactly is what makes
// everything sound consistent.
const TARGET_PEAK_DB = -0.4;
// Every libmp3lame encode pass shifts the decoded peak down by ~0.4dB from
// whatever the pre-encode gain math predicts (lossy reconstruction filter
// overshoot - confirmed by re-encoding a file at 0dB gain and watching its
// measured peak drop anyway). Compensate for it up front in the one encode
// pass below rather than re-encoding again to "correct" it, which just
// introduces the same shift a second time and cancels itself out.
const ENCODE_SHIFT_COMPENSATION_DB = 0.4;

// Strips leading silence, then every remaining silence gap anywhere in the
// rest of the clip (stop_periods=-1 means "don't stop after the first one" -
// mid-recording pauses and trailing silence are both removed this way), then
// reduces background noise. `minSilenceSeconds` is the "how much silence to
// trim" knob: lower = more aggressive (even brief pauses get cut), higher =
// gentler (only long dead air gets cut). Loudness normalization is applied
// separately afterward (see normalizeToPeak) - loudnorm's single-pass EBU
// R128 algorithm needs several seconds of audio to work with, and these are
// mostly 1-2s single-word clips, so it was silently a near no-op on exactly
// the files that most needed it.
function buildEnhanceFilter(minSilenceSeconds) {
    return [
        `silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:detection=peak`,
        `silenceremove=stop_periods=-1:stop_duration=${minSilenceSeconds}:stop_threshold=-35dB:detection=peak`,
        'afftdn=nf=-25:nr=12',
    ].join(',');
}

function parseMinSilence(rawValue) {
    const parsed = parseFloat(rawValue);
    if (Number.isNaN(parsed)) return DEFAULT_MIN_SILENCE;
    return Math.min(MIN_SILENCE_CEILING, Math.max(MIN_SILENCE_FLOOR, parsed));
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve(stderr);
        });
    });
}

// Measures the true peak of a file via ffmpeg's volumedetect filter. Works
// reliably regardless of clip length, unlike loudnorm's integrated-loudness
// measurement - this is a simple "how loud is the loudest sample" reading.
// If the prior silence-removal stage stripped a clip down to nothing (can
// happen on a very quiet/steady recording), ffmpeg can't even read it back -
// treat that the same as digital silence rather than letting it throw, so
// the existing "recording is too quiet" 422 downstream gets a chance to
// report it cleanly instead of a generic 500.
async function measurePeakDb(filePath) {
    let stderr;
    try {
        stderr = await runFfmpeg(['-i', filePath, '-af', 'volumedetect', '-f', 'null', '-']);
    } catch {
        return null;
    }
    const match = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/);
    if (!match || match[1] === '-inf') return null; // digital silence - nothing to normalize
    return parseFloat(match[1]);
}

// Boosts (or trims) a clip so its peak lands exactly at TARGET_PEAK_DB,
// regardless of duration - a plain gain adjustment based on a real
// measurement, rather than loudnorm's duration-sensitive loudness estimate.
async function normalizeToPeak(inputPath, outputPath) {
    const peakDb = await measurePeakDb(inputPath);
    if (peakDb === null) {
        // Either genuine digital silence, or (measurePeakDb already caught
        // this) an unreadable/collapsed file from the silence-removal stage.
        // Either way there's nothing sensible to normalize - just try to
        // pass it through as-is; if the input is too broken even for that,
        // let it fail here so the outer route handler's catch reports a
        // clean 500 rather than this function silently producing garbage.
        try {
            await runFfmpeg(['-y', '-i', inputPath, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);
        } catch {
            fs.copyFileSync(inputPath, outputPath);
        }
        return;
    }
    const gainDb = (TARGET_PEAK_DB - peakDb) + ENCODE_SHIFT_COMPENSATION_DB;
    await runFfmpeg(['-y', '-i', inputPath, '-af', `volume=${gainDb}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/audio-clips/summary - aggregate stats for the dashboard's stat tiles.
// Registered before "/:key" so it isn't swallowed by that param route.
router.get('/summary', async (req, res) => {
    const [statusCounts, sizeAgg, categoryCounts] = await Promise.all([
        AudioClip.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        AudioClip.aggregate([{ $group: { _id: null, totalBytes: { $sum: '$fileSizeBytes' } } }]),
        AudioClip.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    ]);

    const counts = { pending: 0, recorded: 0, archived: 0 };
    statusCounts.forEach(s => { if (s._id) counts[s._id] = s.count; });
    const byCategory = {};
    categoryCounts.forEach(c => { byCategory[c._id || 'Uncategorized'] = c.count; });

    res.json({
        total: counts.pending + counts.recorded + counts.archived,
        pending: counts.pending,
        recorded: counts.recorded,
        archived: counts.archived,
        totalBytes: sizeAgg[0]?.totalBytes || 0,
        byCategory,
    });
});

// GET /api/audio-clips/known-keys - suggestions sourced from real train data
// and legacy disk files, so admins spell a re-recording request exactly the
// way generate.js will look it up (e.g. "Vijayawada Junction", not "Vijayawada").
router.get('/known-keys', async (req, res) => {
    const [fromValues, toValues, nameValues] = await Promise.all([
        Train.distinct('FROM'),
        Train.distinct('TO'),
        Train.distinct('Train Name'),
    ]);

    let diskKeys = [];
    const audioFilesDir = path.join(__dirname, 'audio_files');
    try {
        diskKeys = fs.readdirSync(audioFilesDir)
            .filter(f => f.toLowerCase().endsWith('.mp3') && f !== '_silence.mp3')
            .map(f => f.slice(0, -4));
    } catch {
        diskKeys = [];
    }

    const all = new Set([...fromValues, ...toValues, ...nameValues, ...diskKeys].filter(Boolean));
    res.json(Array.from(all).sort());
});

// GET /api/audio-clips - search, filter, sort, paginate.
router.get('/', async (req, res) => {
    const { search = '', status, category, sort = 'requestedAt', order = 'desc', page = 1, limit = 20 } = req.query;

    const query = {};
    if (search) query.key = { $regex: escapeRegex(String(search)), $options: 'i' };
    if (status && STATUSES.includes(status)) query.status = status;
    if (category && AudioClip.CATEGORIES.includes(category)) query.category = category;

    const sortField = SORTABLE_FIELDS.includes(sort) ? sort : 'requestedAt';
    const sortOrder = order === 'asc' ? 1 : -1;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [items, total] = await Promise.all([
        AudioClip.find(query, '-audioData')
            .sort({ [sortField]: sortOrder })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        AudioClip.countDocuments(query),
    ]);

    res.json({ items, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) });
});

// POST /api/audio-clips - admin requests a new key to be recorded.
router.post('/', async (req, res) => {
    const { key, category } = req.body;
    if (!key || !String(key).trim()) {
        return res.status(400).json({ error: 'key is required' });
    }
    const trimmedKey = String(key).trim();

    const existing = await AudioClip.findOne({ key: trimmedKey });
    if (existing) {
        return res.status(200).json({ key: existing.key, status: existing.status, alreadyExisted: true });
    }

    const clip = await AudioClip.create({
        key: trimmedKey,
        status: 'pending',
        category: category && AudioClip.CATEGORIES.includes(category) ? category : 'Uncategorized',
    });
    res.status(201).json({ key: clip.key, status: clip.status, category: clip.category, alreadyExisted: false });
});

// GET /api/audio-clips/:key - full metadata for the detail view (no audio bytes).
router.get('/:key', async (req, res) => {
    const clip = await AudioClip.findOne({ key: req.params.key }, '-audioData');
    if (!clip) return res.status(404).json({ error: 'Not found' });
    res.json(clip);
});

// PATCH /api/audio-clips/:key - update category and/or status (archive/unarchive).
router.patch('/:key', async (req, res) => {
    const { category, status } = req.body;
    const update = {};

    if (category !== undefined) {
        if (!AudioClip.CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
        update.category = category;
    }
    if (status !== undefined) {
        if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        update.status = status;
    }
    if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
    }
    update.updatedAt = new Date();

    const clip = await AudioClip.findOneAndUpdate({ key: req.params.key }, update, { new: true }).select('-audioData');
    if (!clip) return res.status(404).json({ error: 'Not found' });
    res.json(clip);
});

// DELETE /api/audio-clips/:key - permanently remove a record.
router.delete('/:key', async (req, res) => {
    const result = await AudioClip.deleteOne({ key: req.params.key });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
});

// POST /api/audio-clips/:key/enhance - upload a recording (mic or file); by
// default it gets silence-trimmed, denoised, normalized, and saved as the
// live clip. Pass skipProcessing=true when the audio was already processed
// client-side (e.g. RecordPage's ffmpeg.wasm pipeline) - the upload is then
// just re-encoded to a consistent MP3 container/bitrate and stored as-is, so
// what the user previewed is exactly what gets saved rather than being run
// through a second, possibly different, filter pass.
router.post('/:key/enhance', upload.single('audio'), async (req, res) => {
    const { key } = req.params;
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded (field name must be "audio").' });
    }

    const tmpDir = os.tmpdir();
    const token = crypto.randomBytes(6).toString('hex');
    const inputPath = path.join(tmpDir, `rec_${token}_in`);
    const intermediatePath = path.join(tmpDir, `rec_${token}_mid.mp3`);
    const outputPath = path.join(tmpDir, `rec_${token}_out.mp3`);

    try {
        fs.writeFileSync(inputPath, req.file.buffer);

        const skipProcessing = req.body.skipProcessing === 'true';
        const { durationSeconds: inputDurationSeconds } = await getAudioMetadata(inputPath);

        let minSilenceSeconds = null;
        if (skipProcessing) {
            // Already processed (and normalized) client-side - just re-encode
            // to a consistent container/bitrate, no further gain changes. If
            // the upload itself is malformed (e.g. a near-empty result from
            // a client-side processing bug), fail with the same clear 422
            // below instead of a raw ffmpeg crash surfacing as a generic 500.
            try {
                await runFfmpeg(['-y', '-i', inputPath, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);
            } catch {
                return res.status(422).json({
                    error: 'Could not process the uploaded audio - the file may be empty or corrupted. Try recording again.',
                });
            }
        } else {
            minSilenceSeconds = parseMinSilence(req.body.minSilenceSeconds);
            const filter = buildEnhanceFilter(minSilenceSeconds);
            await runFfmpeg(['-y', '-i', inputPath, '-af', filter, '-c:a', 'libmp3lame', '-b:a', '128k', intermediatePath]);
            await normalizeToPeak(intermediatePath, outputPath);
        }

        const enhancedBuffer = fs.readFileSync(outputPath);
        const { durationSeconds } = await getAudioMetadata(outputPath);

        // Silence removal on a very quiet/soft recording can strip almost
        // everything, leaving a broken near-empty file that "succeeds" but
        // won't actually play. Catch that instead of silently saving it.
        const inputHadRealAudio = inputDurationSeconds && inputDurationSeconds > 0.3;
        const outputCollapsed = !durationSeconds || durationSeconds < 0.15;
        if (inputHadRealAudio && outputCollapsed) {
            return res.status(422).json({
                error: 'Processing removed almost all of the audio - the recording may be too quiet, or the silence-trim setting is too aggressive. Try recording again closer to the mic, or use a gentler silence-trim setting.',
            });
        }

        const existing = await AudioClip.findOne({ key });
        const nextVersion = (existing?.version || 0) + 1;

        const clip = await AudioClip.findOneAndUpdate(
            { key },
            {
                key,
                audioData: enhancedBuffer,
                mimeType: 'audio/mpeg',
                status: 'recorded',
                recordedAt: new Date(),
                updatedAt: new Date(),
                durationSeconds,
                fileSizeBytes: enhancedBuffer.length,
                version: nextVersion,
            },
            { upsert: true, new: true }
        ).select('-audioData');

        res.json({ ...clip.toObject(), minSilenceSeconds });
    } catch (err) {
        console.error(`Enhance failed for key "${key}":`, err.message);
        res.status(500).json({ error: 'Failed to process recording.' });
    } finally {
        fs.existsSync(inputPath) && fs.unlinkSync(inputPath);
        fs.existsSync(intermediatePath) && fs.unlinkSync(intermediatePath);
        fs.existsSync(outputPath) && fs.unlinkSync(outputPath);
    }
});

// GET /api/audio-clips/:key/audio - serve the stored audio bytes for playback.
router.get('/:key/audio', async (req, res) => {
    const clip = await AudioClip.findOne({ key: req.params.key });
    if (!clip || !clip.audioData) {
        return res.status(404).json({ error: 'No recorded audio for this key.' });
    }
    res.set('Content-Type', clip.mimeType || 'audio/mpeg');
    res.send(clip.audioData);
});

module.exports = router;
