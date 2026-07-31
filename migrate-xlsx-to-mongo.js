require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const Train = require('./models/Train');

const XLSX_PATH = path.join(__dirname, 'audio_files', 'Train Details.xlsx');
const DRY_RUN = process.argv.includes('--dry-run');

function clean(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (str === '' || str.toLowerCase() === 'none') return null;
    return str;
}

// A real station name has at least one letter in it; catches garbage
// cells like a run of dots or punctuation left over from bad manual edits.
function looksLikeJunkStation(str) {
    return !str || !/[a-zA-Z]/.test(str);
}

function parseRows() {
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const dataRows = rows.slice(1); // drop header row

    const docs = [];
    const issues = [];
    const skipped = [];
    const seenTrainNos = new Map();

    dataRows.forEach((row, idx) => {
        const rowNum = idx + 2; // +1 for header, +1 for 1-index
        const [colA, colB, colC, colD, colE, colF] = row;

        // Col B holds the raw train number for most rows; a couple of
        // manually appended rows at the end only have it in Col A.
        const trainNo = clean(colB) || clean(colA);
        const from = clean(colC);
        const to = clean(colD);
        const trainName = clean(colE);
        const trainType = clean(colF);

        if (!trainNo) {
            skipped.push(`Row ${rowNum}: no train number.`);
            return;
        }
        if (trainNo.length > 6) {
            skipped.push(`Row ${rowNum}: train number "${trainNo}" has ${trainNo.length} digits — not a real train number.`);
            return;
        }
        if (looksLikeJunkStation(from) || looksLikeJunkStation(to)) {
            skipped.push(`Row ${rowNum} (Train ${trainNo}): garbage From/To ("${from}" -> "${to}").`);
            return;
        }
        if (!trainName) {
            issues.push(`Row ${rowNum} (Train ${trainNo}): no Train Name — will migrate without one.`);
        }
        if (seenTrainNos.has(trainNo)) {
            issues.push(`Row ${rowNum}: train number "${trainNo}" duplicates row ${seenTrainNos.get(trainNo)} — later row will overwrite the earlier one.`);
        }
        seenTrainNos.set(trainNo, rowNum);

        docs.push({
            'Train No': trainNo,
            'Train Name': trainName,
            'FROM': from,
            'TO': to,
            'Train Type': trainType,
        });
    });

    return { docs, issues, skipped };
}

async function migrate() {
    const { docs, issues, skipped } = parseRows();

    console.log(`Parsed ${docs.length} rows to migrate (${skipped.length} skipped as junk).`);
    console.log('\nSample (first 5):');
    docs.slice(0, 5).forEach(d => console.log(' ', d));

    if (skipped.length) {
        console.log(`\n${skipped.length} row(s) skipped entirely:`);
        skipped.forEach(s => console.log(' -', s));
    }

    if (issues.length) {
        console.log(`\n${issues.length} row(s) migrating with a caveat:`);
        issues.forEach(i => console.log(' -', i));
    }

    if (DRY_RUN) {
        console.log('\n--dry-run: nothing written to MongoDB. Re-run without --dry-run to migrate for real.');
        return;
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('\nConnected to MongoDB.');

    let inserted = 0, updated = 0, failed = 0;
    for (const doc of docs) {
        try {
            const result = await Train.updateOne(
                { 'Train No': doc['Train No'] },
                { $set: doc },
                { upsert: true, runValidators: true }
            );
            if (result.upsertedCount) inserted++;
            else if (result.modifiedCount) updated++;
        } catch (err) {
            failed++;
            console.error(`Failed to upsert Train No ${doc['Train No']}: ${err.message}`);
        }
    }

    console.log(`\nDone. Inserted: ${inserted}, Updated: ${updated}, Unchanged: ${docs.length - inserted - updated - failed}, Failed: ${failed}`);
    await mongoose.disconnect();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
