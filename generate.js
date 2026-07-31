const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const Train = require('./models/Train');
const AudioClip = require('./models/AudioClip');

const audioFilesDir = path.join(__dirname, 'audio_files');
const SILENCE_CLIP = path.join(audioFilesDir, '_silence.mp3');

const audioCacheDir = path.join(os.tmpdir(), 'rly-audio-cache');
if (!fs.existsSync(audioCacheDir)) fs.mkdirSync(audioCacheDir, { recursive: true });

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
// file path. A re-recorded clip in MongoDB always wins over the legacy file
// on disk, since that's the whole point of the re-recording workflow.
const resolveAudioKey = async (key) => {
    const clip = await AudioClip.findOne({ key, status: 'recorded' }).lean();
    if (clip && clip.audioData) {
        const cachedPath = path.join(audioCacheDir, `${key}.mp3`);
        fs.writeFileSync(cachedPath, clip.audioData.buffer ? Buffer.from(clip.audioData.buffer) : clip.audioData);
        return cachedPath;
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

// --- Main Announcement Generation Function ---
const generateAnnouncement = async (req, res) => {
    const { trainNumber, platformNumber, anncType } = req.body;

    if (!trainNumber || !platformNumber || !anncType) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const trimmedTrainNumber = String(trainNumber).trim();
        const trainDetails = await getTrainDetails(trimmedTrainNumber);

        if (!trainDetails) {
            return res.status(404).json({ error: "Train not found in the database." });
        }

        // --- Build the ordered list of audio keys (not paths yet) ---
        const keys = [];

        const fromStation = trainDetails['FROM'];
        const toStation = trainDetails['TO'];
        const trainName = trainDetails['Train Name'];
        const trainType = trainDetails['Train Type'];

        if (!fromStation || !toStation) {
             return res.status(500).json({ error: "Incomplete train data. Missing From/To." });
        }

        // --- Telugu Announcement ---
        keys.push('daya_chesi');
        trimmedTrainNumber.split('').forEach(ch => keys.push(`${ch}_tel`));
        keys.push(fromStation);
        keys.push(toStation);
        if (trainName) keys.push(trainName);
        keys.push(trainType);

        if (anncType === "Arrive Shortly") {
            keys.push("marikoddi");
            keys.push(`${platformNumber}_tel`);
            keys.push("vacchunu");
        } else if (anncType === "Is On") {
            keys.push(`${platformNumber}_tel`);
            keys.push("vunnadi");
        } else { // Ready to Leave
            keys.push(`${platformNumber}_tel`);
            keys.push("bayalderutaku");
        }

        // --- English Announcement ---
        keys.push('kindAttention');
        trimmedTrainNumber.split('').forEach(ch => keys.push(`${ch}_eng`));
        keys.push(fromStation);
        keys.push(toStation);
        if (trainName) keys.push(trainName);
        if (trainType) keys.push(trainType);

        if (anncType === "Arrive Shortly") {
            keys.push("willArive");
            keys.push(`${platformNumber}_eng`);
        } else if (anncType === "Is On") {
            keys.push("isOn");
            keys.push(`${platformNumber}_eng`);
        } else { // Ready to Leave
            keys.push("isReadytoLeave");
            keys.push(`${platformNumber}_eng`);
        }

        // --- Hindi Announcement ---
        keys.push('yaatrikan');
        trimmedTrainNumber.split('').forEach(ch => keys.push(`${ch}_hin`));
        keys.push(fromStation);
        keys.push(toStation);
        if (trainName) keys.push(trainName);
        if (trainType) keys.push(trainType);

        if (anncType === "Arrive Shortly") {
            keys.push("krmank");
            keys.push(`${platformNumber}_hin`);
            keys.push("parThodi");
        } else if (anncType === "Is On") {
            keys.push("krmank");
            keys.push(`${platformNumber}_hin`);
            keys.push("ghadi");
        } else { // Ready to Leave
            keys.push("krmank");
            keys.push(`${platformNumber}_hin`);
            keys.push("ravana");
        }

        // --- Resolve each key to a real file (MongoDB re-recording, else legacy disk file) ---
        const resolved = await Promise.all(keys.map(async key => ({ key, filePath: await resolveAudioKey(key) })));

        const missingKeys = resolved.filter(r => !r.filePath).map(r => r.key);
        if (missingKeys.length) {
            console.warn("Warning: no audio found (Mongo or disk) for these keys, they will be skipped:", missingKeys);
        }

        const validFiles = resolved.filter(r => r.filePath).map(r => r.filePath);
        if (validFiles.length === 0) {
            return res.status(500).json({ error: "No audio available to build this announcement." });
        }

        // Insert a short pause between every clip so the announcement doesn't
        // sound like one rushed word - matches the cadence of real PA audio.
        const withPauses = [];
        validFiles.forEach((filePath, idx) => {
            withPauses.push(filePath);
            if (idx < validFiles.length - 1) withPauses.push(SILENCE_CLIP);
        });

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

        const inputArgs = withPauses.flatMap(filePath => ['-i', filePath]);
        const filterInputs = withPauses.map((_, i) => `[${i}:a]`).join('');
        const filterComplex = `${filterInputs}concat=n=${withPauses.length}:v=0:a=1[out]`;

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
            platformNumber: platformNumber,
            announcementType: anncType,
            audioUrl: `/announcements/${outputFileName}`
        });

    } catch (err) {
        console.error("Server error:", err);
        res.status(500).json({ error: "An internal server error occurred." });
    }
};

module.exports = { generateAnnouncement };
