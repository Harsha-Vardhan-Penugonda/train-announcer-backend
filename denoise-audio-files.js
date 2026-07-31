const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const AUDIO_DIR = path.join(__dirname, 'audio_files');
const FILTER = 'afftdn=nf=-25:nr=12,loudnorm=I=-16:TP=-1.5:LRA=11';

function getCodec(filePath) {
    try {
        execFileSync(ffmpegPath, ['-i', filePath], { stdio: ['ignore', 'ignore', 'pipe'] });
        return null;
    } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : '';
        const match = stderr.match(/Audio: (\w+)/);
        return match ? match[1] : null;
    }
}

function denoiseInPlace(filePath) {
    const tmpPath = filePath + '.denoised.tmp.mp3';
    execFileSync(ffmpegPath, [
        '-y', '-i', filePath,
        '-af', FILTER,
        tmpPath
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const stats = fs.statSync(tmpPath);
    if (stats.size === 0) {
        fs.unlinkSync(tmpPath);
        throw new Error('Output file is empty');
    }
    fs.renameSync(tmpPath, filePath);
}

function main() {
    const files = fs.readdirSync(AUDIO_DIR).filter(f => f.toLowerCase().endsWith('.mp3'));

    let skippedClean = 0, processed = 0, failed = 0;
    const failures = [];

    files.forEach((name, idx) => {
        const filePath = path.join(AUDIO_DIR, name);
        const codec = getCodec(filePath);

        if (codec !== 'mp3') {
            skippedClean++;
            return;
        }

        try {
            denoiseInPlace(filePath);
            processed++;
            if (processed % 20 === 0) console.log(`  ...${processed} processed so far`);
        } catch (err) {
            failed++;
            failures.push({ name, error: err.message });
        }
    });

    console.log(`\nDone. ${files.length} total .mp3 files scanned.`);
    console.log(`  Skipped (already clean PCM): ${skippedClean}`);
    console.log(`  Denoised + normalized: ${processed}`);
    console.log(`  Failed: ${failed}`);

    if (failures.length) {
        console.log('\nFailures:');
        failures.forEach(f => console.log(` - ${f.name}: ${f.error}`));
    }
}

main();
