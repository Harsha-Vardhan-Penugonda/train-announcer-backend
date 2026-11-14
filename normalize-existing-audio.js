require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const AudioClip = require('./models/AudioClip');
const { toBuffer } = require('./toBuffer');
const { getAudioMetadata } = require('./audioMetadata');

// -0.4dB is where the original digit/phrase clips actually peak - see
// normalize-disk-audio.js for how this and the compensation below were
// calibrated (a real mismatch was audible even after a first pass at -1dB).
const TARGET_PEAK_DB = -0.4;
const ENCODE_SHIFT_COMPENSATION_DB = 0.4;
const SKIP_IF_PEAK_ABOVE_DB = -0.6; // already this close to target, don't touch it
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
    await mongoose.connect(process.env.MONGO_URI);
    const clips = await AudioClip.find({ status: 'recorded' });
    console.log(`Found ${clips.length} recorded clips.`);

    const tmpDir = os.tmpdir();
    let skippedLoud = 0, skippedSilent = 0, fixed = 0, failed = 0;
    const fixedList = [];

    for (const clip of clips) {
        if (!clip.audioData) { failed++; continue; }
        const token = crypto.randomBytes(6).toString('hex');
        const inputPath = path.join(tmpDir, `norm_${token}_in.mp3`);
        const outputPath = path.join(tmpDir, `norm_${token}_out.mp3`);

        try {
            fs.writeFileSync(inputPath, toBuffer(clip.audioData));

            const peakDb = await measurePeakDb(inputPath);
            if (peakDb === null) { skippedSilent++; continue; }
            if (peakDb >= SKIP_IF_PEAK_ABOVE_DB) { skippedLoud++; continue; }

            const gainDb = (TARGET_PEAK_DB - peakDb) + ENCODE_SHIFT_COMPENSATION_DB;
            fixedList.push(`${clip.key} (${clip.category}): ${peakDb}dB -> ${TARGET_PEAK_DB}dB`);

            if (DRY_RUN) { fixed++; continue; }

            await runFfmpeg(['-y', '-i', inputPath, '-af', `volume=${gainDb}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);
            const newBuffer = fs.readFileSync(outputPath);
            const { durationSeconds } = await getAudioMetadata(outputPath);

            clip.audioData = newBuffer;
            clip.fileSizeBytes = newBuffer.length;
            clip.durationSeconds = durationSeconds;
            clip.updatedAt = new Date();
            await clip.save();
            fixed++;
        } catch (err) {
            failed++;
            console.error(`Failed on "${clip.key}": ${err.message}`);
        } finally {
            fs.existsSync(inputPath) && fs.unlinkSync(inputPath);
            fs.existsSync(outputPath) && fs.unlinkSync(outputPath);
        }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done.`);
    console.log(`  Already loud enough (skipped): ${skippedLoud}`);
    console.log(`  Digital silence (skipped): ${skippedSilent}`);
    console.log(`  ${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixed}`);
    console.log(`  Failed: ${failed}`);
    if (fixedList.length) {
        console.log('\nSample of fixed clips:');
        fixedList.slice(0, 15).forEach(l => console.log(' -', l));
        if (fixedList.length > 15) console.log(`   ...and ${fixedList.length - 15} more`);
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Normalization failed:', err);
    process.exit(1);
});
