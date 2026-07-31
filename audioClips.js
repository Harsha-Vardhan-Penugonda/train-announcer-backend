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

// Strips leading silence, then every remaining silence gap anywhere in the
// rest of the clip (stop_periods=-1 means "don't stop after the first one" -
// mid-recording pauses and trailing silence are both removed this way), then
// reduces background noise, then normalizes loudness. `minSilenceSeconds` is
// the "how much silence to trim" knob: lower = more aggressive (even brief
// pauses get cut), higher = gentler (only long dead air gets cut).
function buildEnhanceFilter(minSilenceSeconds) {
    return [
        `silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:detection=peak`,
        `silenceremove=stop_periods=-1:stop_duration=${minSilenceSeconds}:stop_threshold=-35dB:detection=peak`,
        'afftdn=nf=-25:nr=12',
        'loudnorm=I=-16:TP=-1.5:LRA=11',
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
            resolve();
        });
    });
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

// POST /api/audio-clips/:key/enhance - upload a raw recording (mic or file);
// it gets silence-trimmed, denoised, normalized, and saved as the live clip.
// Used both by the mic-recording flow and the dashboard's "replace" upload.
router.post('/:key/enhance', upload.single('audio'), async (req, res) => {
    const { key } = req.params;
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded (field name must be "audio").' });
    }

    const tmpDir = os.tmpdir();
    const token = crypto.randomBytes(6).toString('hex');
    const inputPath = path.join(tmpDir, `rec_${token}_in`);
    const outputPath = path.join(tmpDir, `rec_${token}_out.mp3`);

    try {
        fs.writeFileSync(inputPath, req.file.buffer);

        const minSilenceSeconds = parseMinSilence(req.body.minSilenceSeconds);
        const filter = buildEnhanceFilter(minSilenceSeconds);
        await runFfmpeg(['-y', '-i', inputPath, '-af', filter, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);

        const enhancedBuffer = fs.readFileSync(outputPath);
        const { durationSeconds } = await getAudioMetadata(outputPath);

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
