// Pushes the current (corrected, verified) audio_files/*.mp3 bytes into
// MongoDB, overwriting whatever's there for each matching key. Disk is
// being treated as the source of truth here since it's what all the recent
// noise/silence/volume fixes were verified against. Clips that exist only
// in Mongo (no disk file - e.g. something recorded fresh through the app,
// like "Maheshwara") are left untouched, not deleted.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const AudioClip = require('./models/AudioClip');
const Train = require('./models/Train');
const { getAudioMetadata } = require('./audioMetadata');

const AUDIO_DIR = path.join(__dirname, 'audio_files');
const DRY_RUN = process.argv.includes('--dry-run');

const KNOWN_PHRASES = new Set([
    'daya_chesi', 'kindattention', 'yaatrikan', 'ison', 'vunnadi', 'marikoddi',
    'vacchunu', 'bayalderutaku', 'willarive', 'isreadytoleave', 'krmank',
    'ghadi', 'parthodi', 'ravana',
].map(s => s.toLowerCase()));

const DIGIT_PATTERN = /^\d+_(tel|eng|hin)$/i;

async function buildCategoryMatcher() {
    const [fromValues, toValues, nameValues, typeValues] = await Promise.all([
        Train.distinct('FROM'),
        Train.distinct('TO'),
        Train.distinct('Train Name'),
        Train.distinct('Train Type'),
    ]);

    const stationSet = new Set([...fromValues, ...toValues].filter(Boolean));
    const nameSet = new Set(nameValues.filter(Boolean));
    const typeSet = new Set(typeValues.filter(Boolean));

    return (key) => {
        if (DIGIT_PATTERN.test(key)) return 'Digit';
        if (KNOWN_PHRASES.has(key.toLowerCase())) return 'Phrase';
        if (stationSet.has(key)) return 'Station Name';
        if (nameSet.has(key)) return 'Train Name';
        if (typeSet.has(key)) return 'Train Type';
        return 'Uncategorized';
    };
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const categorize = await buildCategoryMatcher();

    const files = fs.readdirSync(AUDIO_DIR)
        .filter(f => f.toLowerCase().endsWith('.mp3') && f !== '_silence.mp3');

    const existing = new Map((await AudioClip.find({}, 'key category version').lean()).map(c => [c.key, c]));

    let created = 0, updated = 0, failed = 0;

    for (const filename of files) {
        const key = filename.slice(0, -4);
        const filePath = path.join(AUDIO_DIR, filename);

        try {
            const buffer = fs.readFileSync(filePath);
            const { durationSeconds } = await getAudioMetadata(filePath);
            const existingDoc = existing.get(key);

            if (DRY_RUN) {
                existingDoc ? updated++ : created++;
                continue;
            }

            if (existingDoc) {
                await AudioClip.updateOne(
                    { key },
                    {
                        $set: {
                            audioData: buffer,
                            mimeType: 'audio/mpeg',
                            status: 'recorded',
                            durationSeconds,
                            fileSizeBytes: buffer.length,
                            updatedAt: new Date(),
                        },
                    }
                );
                updated++;
            } else {
                const mtime = fs.statSync(filePath).mtime;
                await AudioClip.create({
                    key,
                    audioData: buffer,
                    mimeType: 'audio/mpeg',
                    status: 'recorded',
                    category: categorize(key),
                    durationSeconds,
                    fileSizeBytes: buffer.length,
                    version: 0,
                    requestedAt: mtime,
                    recordedAt: mtime,
                    updatedAt: mtime,
                });
                created++;
            }
        } catch (err) {
            failed++;
            console.error(`Failed to sync "${key}": ${err.message}`);
        }
    }

    const mongoOnlyKeys = [...existing.keys()].filter(k => !files.some(f => f.slice(0, -4) === k));

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Scanned ${files.length} disk files.`);
    console.log(`  ${DRY_RUN ? 'Would create' : 'Created'}: ${created}`);
    console.log(`  ${DRY_RUN ? 'Would update' : 'Updated'}: ${updated}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Left untouched (Mongo-only, no disk file): ${mongoOnlyKeys.length}${mongoOnlyKeys.length ? ' -> ' + mongoOnlyKeys.join(', ') : ''}`);

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Sync failed:', err);
    process.exit(1);
});
