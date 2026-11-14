const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Average level (volumedetect mean_volume) of the station, train-name and
// phrase clips already in use. Matching this average, rather than only the
// loudest instant, is what makes a new recording sound as loud as the rest:
// two clips that both peak at -0.4dB can still differ by 5dB or more in how
// loud they sound.
const TARGET_MEAN_DB = -13.3;
// The limiter catches the peaks the extra gain would push into clipping.
// 0.95 is about -0.45dBFS, the same ceiling the existing clips peak at.
const LIMIT = 0.95;
// Cap the boost so a near-silent recording isn't turned into loud hiss.
const MAX_GAIN_DB = 18;
// Limiting eats a little of the gain, so re-measure and correct a few times.
const PASSES = 3;

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve(stderr);
        });
    });
}

// Returns { meanDb, peakDb }, or null if the file is digital silence or
// can't be read at all (e.g. silence removal stripped it to nothing).
async function measureVolume(filePath) {
    let stderr;
    try {
        stderr = await runFfmpeg(['-i', filePath, '-af', 'volumedetect', '-f', 'null', '-']);
    } catch {
        return null;
    }
    const mean = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/);
    const peak = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/);
    if (!mean || !peak || mean[1] === '-inf' || peak[1] === '-inf') return null;
    return { meanDb: parseFloat(mean[1]), peakDb: parseFloat(peak[1]) };
}

const clampGain = (db) => Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, db));

// Converts any clip to mono 44.1kHz and sets its average level to
// TARGET_MEAN_DB, then writes a 128k MP3 to outputPath.
//
// Mono first: browsers often record a stereo file with the mic on the left
// channel and the right channel silent. Kept as stereo, that clip plays at
// half volume once the generator mixes it with the mono clips.
async function matchLoudness(inputPath, outputPath) {
    const monoPath = `${outputPath}.mono.wav`;
    const passPath = `${outputPath}.pass.wav`;
    try {
        await runFfmpeg(['-y', '-i', inputPath, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_f32le', monoPath]);

        const start = await measureVolume(monoPath);
        let source = monoPath;
        if (start) {
            let gainDb = clampGain(TARGET_MEAN_DB - start.meanDb);
            for (let i = 0; i < PASSES; i++) {
                await runFfmpeg([
                    '-y', '-i', monoPath,
                    '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${LIMIT}:attack=1:release=40:level=0`,
                    '-c:a', 'pcm_f32le', passPath,
                ]);
                const now = await measureVolume(passPath);
                if (!now) break;
                const missing = TARGET_MEAN_DB - now.meanDb;
                if (Math.abs(missing) < 0.3) break;
                gainDb = clampGain(gainDb + missing);
            }
            source = passPath;
        }

        await runFfmpeg(['-y', '-i', source, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', outputPath]);
    } finally {
        for (const f of [monoPath, passPath]) fs.existsSync(f) && fs.unlinkSync(f);
    }
}

module.exports = { matchLoudness, measureVolume, TARGET_MEAN_DB };
