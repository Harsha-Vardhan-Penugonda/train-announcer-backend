require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const AudioClip = require('./models/AudioClip');

function measureDuration(filePath) {
    return new Promise((resolve) => {
        execFile(ffmpegPath, ['-i', filePath], (error, stdout, stderr) => {
            const m = (stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
            if (!m) return resolve(null);
            resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
        });
    });
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const clips = await AudioClip.find({ status: 'recorded' });
    console.log(`Checking ${clips.length} clips...`);

    const tmpDir = os.tmpdir();
    const corruptedWithDisk = [];
    const corruptedNoDisk = [];
    let checked = 0, clean = 0;

    for (const clip of clips) {
        checked++;
        if (!clip.audioData) continue;

        const token = crypto.randomBytes(6).toString('hex');
        const tmpPath = path.join(tmpDir, `diag_${token}.mp3`);
        try {
            fs.writeFileSync(tmpPath, clip.audioData);
            const actualDuration = await measureDuration(tmpPath);
            const storedDuration = clip.durationSeconds;

            // Corrupted = actual playback duration wildly exceeds what the DB
            // thinks it is (the stale metadata from before corruption).
            const isCorrupted = actualDuration && storedDuration && actualDuration > storedDuration * 1.5 + 0.5;

            if (isCorrupted) {
                const diskPath = path.join(__dirname, 'audio_files', `${clip.key}.mp3`);
                const hasDisk = fs.existsSync(diskPath);
                const entry = { key: clip.key, storedDuration, actualDuration, category: clip.category };
                if (hasDisk) corruptedWithDisk.push(entry);
                else corruptedNoDisk.push(entry);
            } else {
                clean++;
            }
        } finally {
            fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath);
        }
    }

    console.log(`\nChecked: ${checked}, Clean: ${clean}`);
    console.log(`Corrupted WITH disk backup (restorable): ${corruptedWithDisk.length}`);
    console.log(`Corrupted WITHOUT disk backup (NEEDS RE-RECORDING): ${corruptedNoDisk.length}`);

    if (corruptedNoDisk.length) {
        console.log('\n*** These have no disk fallback - cannot auto-restore: ***');
        corruptedNoDisk.forEach(c => console.log(` - ${c.key} (${c.category}): stored=${c.storedDuration}s actual=${c.actualDuration}s`));
    }

    fs.writeFileSync(path.join(__dirname, 'corruption-report.json'), JSON.stringify({ corruptedWithDisk, corruptedNoDisk }, null, 2));
    console.log('\nFull report written to corruption-report.json');

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Diagnosis failed:', err);
    process.exit(1);
});
