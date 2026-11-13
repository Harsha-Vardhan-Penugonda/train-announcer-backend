require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const AudioClip = require('./models/AudioClip');
const { getAudioMetadata } = require('./audioMetadata');

const TARGET_PEAK_DB = -1;
const SKIP_IF_PEAK_ABOVE_DB = -3;
const DRY_RUN = process.argv.includes('--dry-run');

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve(stderr);
        });
    });
}

async function measurePeakDb(filePath) {
    const stderr = await runFfmpeg(['-i', filePath, '-af', 'volumedetect', '-f', 'null', '-']);
    const match = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/);
    if (!match || match[1] === '-inf') return null;
    return parseFloat(match[1]);
}

async function main() {
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'corruption-report.json'), 'utf8'));
    const toRestore = report.corruptedWithDisk;
    console.log(`Restoring ${toRestore.length} clips from disk...`);

    await mongoose.connect(process.env.MONGO_URI);

    let restored = 0, failed = 0;

    for (const { key } of toRestore) {
        const diskPath = path.join(__dirname, 'audio_files', `${key}.mp3`);
        const outputPath = path.join(__dirname, 'audio_files', `.tmp_restore_${crypto.randomBytes(6).toString('hex')}.mp3`);

        try {
            if (!fs.existsSync(diskPath)) throw new Error('disk file missing');

            // Re-run the correct peak normalization from the clean source.
            const peakDb = await measurePeakDb(diskPath);
            let finalPath = diskPath;
            if (peakDb !== null && peakDb < SKIP_IF_PEAK_ABOVE_DB) {
                const gainDb = TARGET_PEAK_DB - peakDb;
                await runFfmpeg(['-y', '-i', diskPath, '-af', `volume=${gainDb}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);
                finalPath = outputPath;
            }

            const buffer = fs.readFileSync(finalPath);
            const { durationSeconds } = await getAudioMetadata(finalPath);

            if (!DRY_RUN) {
                await AudioClip.updateOne(
                    { key },
                    { $set: { audioData: buffer, fileSizeBytes: buffer.length, durationSeconds, updatedAt: new Date() } }
                );
            }
            restored++;
        } catch (err) {
            failed++;
            console.error(`Failed to restore "${key}": ${err.message}`);
        } finally {
            fs.existsSync(outputPath) && fs.unlinkSync(outputPath);
        }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Restored: ${restored}, Failed: ${failed}`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Restore failed:', err);
    process.exit(1);
});
