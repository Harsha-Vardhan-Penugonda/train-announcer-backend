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

async function migrate() {
    await mongoose.connect(process.env.MONGO_URI);

    const categorize = await buildCategoryMatcher();

    const files = fs.readdirSync(AUDIO_DIR)
        .filter(f => f.toLowerCase().endsWith('.mp3') && f !== '_silence.mp3');

    const existingKeys = new Set((await AudioClip.find({}, 'key').lean()).map(c => c.key));

    let inserted = 0, skipped = 0, failed = 0;
    const categoryTally = {};

    for (const filename of files) {
        const key = filename.slice(0, -4); // strip ".mp3"

        if (existingKeys.has(key)) {
            skipped++;
            continue;
        }

        const filePath = path.join(AUDIO_DIR, filename);
        const category = categorize(key);
        categoryTally[category] = (categoryTally[category] || 0) + 1;

        if (DRY_RUN) {
            inserted++;
            continue;
        }

        try {
            const buffer = fs.readFileSync(filePath);
            const { durationSeconds } = await getAudioMetadata(filePath);
            const mtime = fs.statSync(filePath).mtime;

            await AudioClip.create({
                key,
                audioData: buffer,
                mimeType: 'audio/mpeg',
                status: 'recorded',
                category,
                durationSeconds,
                fileSizeBytes: buffer.length,
                version: 0,
                requestedAt: mtime,
                recordedAt: mtime,
                updatedAt: mtime,
            });
            inserted++;
        } catch (err) {
            failed++;
            console.error(`Failed to migrate "${key}": ${err.message}`);
        }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Scanned ${files.length} disk files.`);
    console.log(`  Already in Mongo (skipped): ${skipped}`);
    console.log(`  ${DRY_RUN ? 'Would insert' : 'Inserted'}: ${inserted}`);
    console.log(`  Failed: ${failed}`);
    console.log('\nCategory breakdown:', categoryTally);

    await mongoose.disconnect();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
