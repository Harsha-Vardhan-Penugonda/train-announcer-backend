const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const Train = require('./models/Train');
const AudioClip = require('./models/AudioClip');
const { toBuffer } = require('./toBuffer');

const audioFilesDir = path.join(__dirname, 'audio_files');

// Strips every silence gap in the final merged announcement - leading,
// trailing, and anything left between clips (some legacy source files still
// carry their own internal padding since they were only denoised, never
// silence-trimmed). No pauses are inserted between clips; this filter's job
// is purely to remove whatever silence already exists, not add any.
const SILENCE_STRIP_FILTER = [
    'silenceremove=start_periods=1:start_duration=0:start_threshold=-30dB:detection=peak',
    'silenceremove=stop_periods=-1:stop_duration=0.2:stop_threshold=-30dB:detection=peak',
].join(',');

const audioCacheDir = path.join(os.tmpdir(), 'rly-audio-cache');
if (!fs.existsSync(audioCacheDir)) fs.mkdirSync(audioCacheDir, { recursive: true });

// MongoDB is back in sync with the (now fixed) disk files as of
// sync-disk-to-mongo.js, so it's safe to read from again - a re-recorded
// clip there wins over the legacy file on disk, which is the whole point.
const USE_MONGO_AUDIO = true;

// --- Database Function (reads from MongoDB) ---
const getTrainDetails = async (trainNo) => {
    const trainDoc = await Train.findOne({ 'Train No': String(trainNo) }).lean();
    if (!trainDoc) return null;

    return {
        'Train No': trainDoc['Train No'],
        'Train Name': trainDoc['Train Name'],
        'FROM': trainDoc['FROM'],
        'TO': trainDoc['TO'],
        'Train Type': trainDoc['Train Type']
    };
};

// Resolves a logical audio key (e.g. "Vijayawada Junction", "4_tel") to a real
// file path. When USE_MONGO_AUDIO is on, a re-recorded clip in MongoDB wins
// over the legacy file on disk (the point of the re-recording workflow);
// while it's off, disk is the only source consulted.
const resolveAudioKey = async (key) => {
    if (USE_MONGO_AUDIO) {
        const clip = await AudioClip.findOne({ key, status: 'recorded' }).lean();
        if (clip && clip.audioData) {
            const cachedPath = path.join(audioCacheDir, `${key}.mp3`);
            fs.writeFileSync(cachedPath, toBuffer(clip.audioData));
            return cachedPath;
        }
    }

    const diskPath = path.join(audioFilesDir, `${key}.mp3`);
    if (fs.existsSync(diskPath)) return diskPath;

    return null;
};

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve();
        });
    });
}

// --- Spoken numbers ---
// 0-9 are the digit clips used for train numbers. Telugu and English build
// 21-59 from a tens clip plus a units clip (33 = "30" + "3"), so only 10-19
// and the tens are recorded; Hindi numbers are each their own word, so every
// one is recorded. A whole-number clip, if one exists, always wins (see
// resolveItems) so a joined number that sounds choppy can be re-recorded.
function numberOptions(n, lang) {
    const whole = [`${n}_${lang}`];
    if (n < 20 || n % 10 === 0 || lang === 'hin') return [whole];
    return [whole, [`${n - (n % 10)}_${lang}`, `${n % 10}_${lang}`]];
}

// Time-of-day word for Telugu and Hindi, from the 24-hour expected hour.
function dayPeriod(hour24) {
    if (hour24 >= 4 && hour24 < 12) return { tel: 'tel_vudayam', hin: 'hin_subah' };
    if (hour24 >= 12 && hour24 < 16) return { tel: 'tel_madhyahnam', hin: 'hin_dopahar' };
    if (hour24 >= 16 && hour24 < 20) return { tel: 'tel_saayanthram', hin: 'hin_shaam' };
    return { tel: 'tel_raathri', hin: 'hin_raat' };
}

const PLATFORM_TYPES = ['Arrive Shortly', 'Is On', 'Departing'];
const LATE = 'Running Late';
const CANCELLED = 'Cancelled';

// Validates the type-specific inputs. Returns { error } or { late } where
// late holds the parsed delay and expected time (null for other types).
function parseInputs({ anncType, platformNumber, delayHours, delayMinutes, expectedTime }) {
    if (PLATFORM_TYPES.includes(anncType)) {
        if (!platformNumber || !String(platformNumber).trim()) return { error: 'Platform number is required.' };
        return { late: null };
    }
    if (anncType === CANCELLED) return { late: null };
    if (anncType !== LATE) return { error: `Unknown announcement type "${anncType}".` };

    const h = Number(delayHours || 0), m = Number(delayMinutes || 0);
    if (!Number.isInteger(h) || h < 0 || h > 23) return { error: 'Delay hours must be a whole number from 0 to 23.' };
    if (!Number.isInteger(m) || m < 0 || m > 59) return { error: 'Delay minutes must be a whole number from 0 to 59.' };
    if (h === 0 && m === 0) return { error: 'Enter how late the train is running.' };
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(expectedTime || '').trim());
    if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return { error: 'Expected arrival time must look like 22:05.' };
    return { late: { h, m, at24: Number(t[1]), atMin: Number(t[2]) } };
}

// Builds the announcement as a list of items. Each item is a list of
// options, and each option a list of clip keys; the first option whose
// clips all exist is used.
function buildItems(details, anncType, platformNumber, late) {
    const items = [];
    const say = (...keys) => keys.forEach(k => items.push([[k]]));
    const num = (n, lang) => items.push(numberOptions(n, lang));
    const { trainNo, from, to, name, type } = details;

    const common = (opening, lang) => {
        say(opening);
        String(trainNo).split('').forEach(ch => say(`${ch}_${lang}`));
        say(from, to);
        if (name) say(name);
        if (type) say(type);
    };

    const hour12 = late ? (late.at24 % 12 || 12) : null;
    const period = late ? dayPeriod(late.at24) : null;

    // --- Telugu ---
    common('daya_chesi', 'tel');
    if (anncType === 'Arrive Shortly') { say('marikoddi'); say(`${platformNumber}_tel`, 'vacchunu'); }
    else if (anncType === 'Is On') say(`${platformNumber}_tel`, 'vunnadi');
    else if (anncType === 'Departing') say(`${platformNumber}_tel`, 'bayalderutaku');
    else if (anncType === CANCELLED) say('tel_raddu', 'tel_regret');
    else {
        if (late.h) { num(late.h, 'tel'); say('tel_gantala'); }
        if (late.m) { num(late.m, 'tel'); say('tel_nimishamulu'); }
        say('tel_aalasyamuga', period.tel);
        num(hour12, 'tel');
        if (late.atMin) { say('tel_gantala'); num(late.atMin, 'tel'); say('tel_nimishamulaku'); }
        else items.push([['tel_gantalaku'], ['tel_gantala']]);
        say('tel_vacchunani', 'tel_regret');
    }

    // --- English ---
    common('kindAttention', 'eng');
    if (anncType === 'Arrive Shortly') say('willArive', `${platformNumber}_eng`);
    else if (anncType === 'Is On') say('isOn', `${platformNumber}_eng`);
    else if (anncType === 'Departing') say('isReadytoLeave', `${platformNumber}_eng`);
    else if (anncType === CANCELLED) say('eng_cancelled', 'eng_regret');
    else {
        say('eng_runningLateBy');
        if (late.h) { num(late.h, 'eng'); say(late.h === 1 ? 'eng_hour' : 'eng_hours'); }
        if (late.h && late.m) say('eng_and');
        if (late.m) { num(late.m, 'eng'); say(late.m === 1 ? 'eng_minute' : 'eng_minutes'); }
        say('eng_expectedAt');
        num(hour12, 'eng');
        if (late.atMin > 0 && late.atMin < 10) say('eng_oh', `${late.atMin}_eng`);
        else if (late.atMin) num(late.atMin, 'eng');
        say(late.at24 < 12 ? 'eng_am' : 'eng_pm', 'eng_regret');
    }

    // --- Hindi ---
    common('yaatrikan', 'hin');
    if (anncType === 'Arrive Shortly') say('krmank', `${platformNumber}_hin`, 'parThodi');
    else if (anncType === 'Is On') say('krmank', `${platformNumber}_hin`, 'ghadi');
    else if (anncType === 'Departing') say('krmank', `${platformNumber}_hin`, 'ravana');
    else if (anncType === CANCELLED) say('hin_radd', 'hin_regret');
    else {
        if (late.h) { num(late.h, 'hin'); say('hin_ghante'); }
        if (late.m) { num(late.m, 'hin'); say('hin_minat'); }
        say('hin_deri', period.hin);
        num(hour12, 'hin');
        say('hin_baje');
        if (late.atMin) { num(late.atMin, 'hin'); say('hin_pahunchne'); }
        else items.push([['hin_pahunchneOnly'], ['0_hin', 'hin_pahunchne']]);
        say('hin_regret');
    }
    return items;
}

// Picks, for each item, the first option whose clips all resolve. Returns
// the file paths in order plus the keys that couldn't be found.
async function resolveItems(items) {
    const cache = new Map();
    const resolve = (key) => {
        if (!cache.has(key)) cache.set(key, resolveAudioKey(key));
        return cache.get(key);
    };
    const files = [], missing = [];
    for (const options of items) {
        let chosen = null;
        for (const keys of options) {
            const paths = await Promise.all(keys.map(resolve));
            if (paths.every(Boolean)) { chosen = paths; break; }
        }
        if (chosen) files.push(...chosen);
        else missing.push(options[options.length - 1].join(' + '));
    }
    return { files, missing };
}

// --- Main Announcement Generation Function ---
const generateAnnouncement = async (req, res) => {
    const { trainNumber, platformNumber, anncType } = req.body;

    if (!trainNumber || !anncType) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    const { error: inputError, late } = parseInputs(req.body);
    if (inputError) return res.status(400).json({ error: inputError });

    try {
        const trimmedTrainNumber = String(trainNumber).trim();
        const trainDetails = await getTrainDetails(trimmedTrainNumber);

        if (!trainDetails) {
            return res.status(404).json({ error: "Train not found in the database." });
        }

        const fromStation = trainDetails['FROM'];
        const toStation = trainDetails['TO'];
        const trainName = trainDetails['Train Name'];
        const trainType = trainDetails['Train Type'];

        if (!fromStation || !toStation) {
             return res.status(500).json({ error: "Incomplete train data. Missing From/To." });
        }

        const platform = platformNumber ? String(platformNumber).trim() : null;
        const items = buildItems(
            { trainNo: trimmedTrainNumber, from: fromStation, to: toStation, name: trainName, type: trainType },
            anncType, platform, late
        );
        const { files: validFiles, missing: missingKeys } = await resolveItems(items);

        // The late/cancelled wording is all new clips - an announcement with
        // some of them silently skipped would say something wrong, so refuse
        // instead. The older types keep their skip-and-warn behaviour.
        if (missingKeys.length && !PLATFORM_TYPES.includes(anncType)) {
            return res.status(422).json({
                error: `These clips haven't been recorded yet: ${[...new Set(missingKeys)].join(', ')}`,
            });
        }
        if (missingKeys.length) {
            console.warn("Warning: no audio found (Mongo or disk) for these keys, they will be skipped:", missingKeys);
        }

        if (validFiles.length === 0) {
            return res.status(500).json({ error: "No audio available to build this announcement." });
        }

        // --- Use FFmpeg's concat FILTER (not the concat demuxer) to merge ---
        // The source clips are a mix of codecs/bitrates and some carry
        // inconsistent internal timestamps; the concat demuxer (-f concat)
        // trusts those timestamps and can silently truncate/corrupt the
        // output when they're inconsistent. The concat filter decodes every
        // input to raw samples and stitches by sample count instead, which
        // sidesteps that entirely.
        const outputDir = path.join(__dirname, 'public', 'announcements');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFileName = `SCR_${anncType.replace(/ /g, '')}_${trimmedTrainNumber}_${Date.now()}.mp3`;
        const outputFilePath = path.join(outputDir, outputFileName);

        const inputArgs = validFiles.flatMap(filePath => ['-i', filePath]);
        const filterInputs = validFiles.map((_, i) => `[${i}:a]`).join('');
        const filterComplex = `${filterInputs}concat=n=${validFiles.length}:v=0:a=1[concatenated];[concatenated]${SILENCE_STRIP_FILTER}[out]`;

        const args = [
            '-y',
            ...inputArgs,
            '-filter_complex', filterComplex,
            '-map', '[out]',
            '-c:a', 'libmp3lame', '-b:a', '128k',
            outputFilePath,
        ];

        try {
            await runFfmpeg(args);
        } catch (err) {
            console.error(`FFmpeg Error: ${err.message}`);
            return res.status(500).json({ error: 'Failed to generate announcement audio.' });
        }

        res.json({
            'Train No': trainDetails['Train No'],
            'Train Name': trainDetails['Train Name'],
            'FROM': fromStation,
            'TO': toStation,
            'Train Type': trainType,
            platformNumber: platform,
            announcementType: anncType,
            audioUrl: `/announcements/${outputFileName}`
        });

    } catch (err) {
        console.error("Server error:", err);
        res.status(500).json({ error: "An internal server error occurred." });
    }
};

module.exports = { generateAnnouncement };
