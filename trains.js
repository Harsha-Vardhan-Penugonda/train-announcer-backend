const express = require('express');
const Train = require('./models/Train');
const AudioClip = require('./models/AudioClip');

const router = express.Router();

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Ensures an AudioClip exists for this key. If it's already there (recorded
// or pending), leave it alone - $setOnInsert means we never downgrade an
// existing 'recorded' clip back to 'pending' just because it got reused.
// Returns the clip's current status and whether this call is what created it.
async function ensureAudioClip(key, category) {
    const result = await AudioClip.findOneAndUpdate(
        { key },
        { $setOnInsert: { key, status: 'pending', category } },
        { upsert: true, new: true, includeResultMetadata: true }
    );
    return {
        key,
        category,
        status: result.value.status,
        isNew: Boolean(result.lastErrorObject?.upserted),
    };
}

// GET /api/trains/field-options - real distinct values already in use, so the
// Add Train form can suggest reusing existing station/name/type audio instead
// of accidentally creating a near-duplicate under a slightly different key.
router.get('/field-options', async (req, res) => {
    const [fromValues, toValues, trainNames, trainTypes] = await Promise.all([
        Train.distinct('FROM'),
        Train.distinct('TO'),
        Train.distinct('Train Name'),
        Train.distinct('Train Type'),
    ]);

    const stations = Array.from(new Set([...fromValues, ...toValues].filter(Boolean))).sort();
    res.json({
        stations,
        trainNames: trainNames.filter(Boolean).sort(),
        trainTypes: trainTypes.filter(Boolean).sort(),
    });
});

// GET /api/trains - list existing trains, optionally searching by number/name.
router.get('/', async (req, res) => {
    const { search = '', page = 1, limit = 20 } = req.query;

    const query = {};
    if (search) {
        const re = { $regex: escapeRegex(String(search)), $options: 'i' };
        query.$or = [{ 'Train No': re }, { 'Train Name': re }, { 'FROM': re }, { 'TO': re }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [items, total] = await Promise.all([
        Train.find(query).sort({ _id: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        Train.countDocuments(query),
    ]);

    res.json({ items, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) });
});

// POST /api/trains - add a new train, and make sure every audio key it needs
// (from/to/name/type) exists in AudioClip - as 'recorded' if it's already
// there, or freshly created as 'pending' so it shows up in the recording
// queue if it's genuinely new.
router.post('/', async (req, res) => {
    const { trainNo, trainName, from, to, trainType } = req.body;

    if (!trainNo || !String(trainNo).trim()) {
        return res.status(400).json({ error: 'trainNo is required' });
    }
    if (!from || !String(from).trim() || !to || !String(to).trim()) {
        return res.status(400).json({ error: 'from and to stations are required' });
    }

    const trimmedTrainNo = String(trainNo).trim();

    const existing = await Train.findOne({ 'Train No': trimmedTrainNo });
    if (existing) {
        return res.status(409).json({ error: `Train ${trimmedTrainNo} already exists.` });
    }

    const trimmedFrom = String(from).trim();
    const trimmedTo = String(to).trim();
    const trimmedName = trainName ? String(trainName).trim() : null;
    const trimmedType = trainType ? String(trainType).trim() : null;

    const train = await Train.create({
        'Train No': trimmedTrainNo,
        'Train Name': trimmedName,
        'FROM': trimmedFrom,
        'TO': trimmedTo,
        'Train Type': trimmedType,
    });

    // One AudioClip check/creation per required field, tagged with the
    // category that matches its role so it shows up right in the dashboard.
    const fieldsNeedingAudio = [
        { key: trimmedFrom, category: 'Station Name' },
        { key: trimmedTo, category: 'Station Name' },
    ];
    if (trimmedName) fieldsNeedingAudio.push({ key: trimmedName, category: 'Train Name' });
    if (trimmedType) fieldsNeedingAudio.push({ key: trimmedType, category: 'Train Type' });

    const audioStatus = await Promise.all(
        fieldsNeedingAudio.map(({ key, category }) => ensureAudioClip(key, category))
    );

    res.status(201).json({ train, audioStatus });
});

module.exports = router;
