// Same peak-normalization fix as normalize-existing-audio.js (see that file
// for why loudnorm doesn't work on clips this short), applied directly to
// audio_files/*.mp3 - needed now that generate.js is reading from disk
// instead of MongoDB (see USE_MONGO_AUDIO in generate.js).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const AUDIO_DIR = path.join(__dirname, 'audio_files');
// -0.4dB is where the digit/phrase clips (daya_chesi, kindAttention, 0-9 in
// all 3 languages) actually peak - matching it exactly is what makes
// station/train-name/type clips sound consistent with everything else
// instead of a little quieter.
const TARGET_PEAK_DB = -0.4;
const SKIP_IF_PEAK_ABOVE_DB = -0.6; // tight band around the target - only reapply if not already this close
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

// Every libmp3lame encode pass shifts the decoded peak down by ~0.4dB from
// whatever the pre-encode gain math predicts (lossy reconstruction filter
// overshoot - confirmed by re-encoding a file at 0dB gain and watching its
// measured peak drop anyway). Re-encoding a second time to "correct" that
// just introduces the same shift again and cancels itself out, which is
// what happened here. The fix is to compensate for the shift up front in a
// single encode pass, not to chase it with more passes.
const ENCODE_SHIFT_COMPENSATION_DB = 0.4;

async function normalizeToPeak(inputPath, outputPath, targetDb, initialPeakDb) {
    const gainDb = (targetDb - initialPeakDb) + ENCODE_SHIFT_COMPENSATION_DB;
    await runFfmpeg(['-y', '-i', inputPath, '-af', `volume=${gainDb}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath]);
}

async function main() {
    const files = fs.readdirSync(AUDIO_DIR).filter(f => f.toLowerCase().endsWith('.mp3'));
    console.log(`Scanning ${files.length} disk files...`);

    let skippedLoud = 0, skippedSilent = 0, fixed = 0, failed = 0;
    const fixedList = [];

    for (const filename of files) {
        const filePath = path.join(AUDIO_DIR, filename);
        const outputPath = path.join(AUDIO_DIR, `.tmp_norm_${crypto.randomBytes(6).toString('hex')}.mp3`);

        try {
            const peakDb = await measurePeakDb(filePath);
            if (peakDb === null) { skippedSilent++; continue; }
            if (peakDb >= SKIP_IF_PEAK_ABOVE_DB) { skippedLoud++; continue; }

            fixedList.push(`${filename}: ${peakDb}dB -> ${TARGET_PEAK_DB}dB`);

            if (DRY_RUN) { fixed++; continue; }

            await normalizeToPeak(filePath, outputPath, TARGET_PEAK_DB, peakDb);
            fs.renameSync(outputPath, filePath);
            fixed++;
        } catch (err) {
            failed++;
            console.error(`Failed on "${filename}": ${err.message}`);
        } finally {
            fs.existsSync(outputPath) && fs.unlinkSync(outputPath);
        }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done.`);
    console.log(`  Already loud enough (skipped): ${skippedLoud}`);
    console.log(`  Digital silence (skipped): ${skippedSilent}`);
    console.log(`  ${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixed}`);
    console.log(`  Failed: ${failed}`);
    if (fixedList.length) {
        console.log('\nSample:');
        fixedList.slice(0, 10).forEach(l => console.log(' -', l));
        if (fixedList.length > 10) console.log(`   ...and ${fixedList.length - 10} more`);
    }
}

main().catch(err => {
    console.error('Normalization failed:', err);
    process.exit(1);
});
