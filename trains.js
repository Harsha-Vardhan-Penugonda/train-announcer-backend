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

// GET /api/trains/suggest?prefix=127 - trains whose number starts with the
// typed digits, for the Generator page's live lookup. Anchored regex on the
// indexed 'Train No' field, so it stays fast as the list grows.
router.get('/suggest', async (req, res) => {
    const prefix = String(req.query.prefix || '').trim();
    if (!prefix) return res.json([]);
    const items = await Train.find({ 'Train No': { $regex: '^' + escapeRegex(prefix) } })
        .sort({ 'Train No': 1 })
        .limit(8)
        .lean();
    res.json(items);
});

// Validates and trims an add/edit request body. Returns { error } or { fields }.
function parseTrainBody(body) {
    const { trainNo, trainName, from, to, trainType } = body || {};
    if (!trainNo || !String(trainNo).trim()) return { error: 'trainNo is required' };
    if (!from || !String(from).trim() || !to || !String(to).trim()) {
        return { error: 'from and to stations are required' };
    }
    return {
        fields: {
            'Train No': String(trainNo).trim(),
            'Train Name': trainName && String(trainName).trim() ? String(trainName).trim() : null,
            'FROM': String(from).trim(),
            'TO': String(to).trim(),
            'Train Type': trainType && String(trainType).trim() ? String(trainType).trim() : null,
        },
    };
}

// Make sure every audio key a train needs (from/to/name/type) exists in
// AudioClip - as 'recorded' if it's already there, or freshly created as
// 'pending' so it shows up in the recording queue if it's genuinely new.
// Each one is tagged with the category matching its role for the dashboard.
function ensureTrainAudio(fields) {
    const fieldsNeedingAudio = [
        { key: fields['FROM'], category: 'Station Name' },
        { key: fields['TO'], category: 'Station Name' },
    ];
    if (fields['Train Name']) fieldsNeedingAudio.push({ key: fields['Train Name'], category: 'Train Name' });
    if (fields['Train Type']) fieldsNeedingAudio.push({ key: fields['Train Type'], category: 'Train Type' });
    return Promise.all(fieldsNeedingAudio.map(({ key, category }) => ensureAudioClip(key, category)));
}

// POST /api/trains - add a new train.
router.post('/', async (req, res) => {
    const { error, fields } = parseTrainBody(req.body);
    if (error) return res.status(400).json({ error });

    const existing = await Train.findOne({ 'Train No': fields['Train No'] });
    if (existing) {
        return res.status(409).json({ error: `Train ${fields['Train No']} already exists.` });
    }

    const train = await Train.create(fields);
    const audioStatus = await ensureTrainAudio(fields);
    res.status(201).json({ train, audioStatus });
});

// PUT /api/trains/:trainNo - edit an existing train's number, route, name or
// type. Changing the number is allowed as long as no other train has it.
router.put('/:trainNo', async (req, res) => {
    const currentNo = String(req.params.trainNo).trim();
    const { error, fields } = parseTrainBody(req.body);
    if (error) return res.status(400).json({ error });

    const train = await Train.findOne({ 'Train No': currentNo });
    if (!train) return res.status(404).json({ error: `Train ${currentNo} not found.` });

    if (fields['Train No'] !== currentNo) {
        const clash = await Train.findOne({ 'Train No': fields['Train No'] });
        if (clash) return res.status(409).json({ error: `Train ${fields['Train No']} already exists.` });
    }

    try {
        train.set(fields);
        await train.save();
        const audioStatus = await ensureTrainAudio(fields);
        res.json({ train, audioStatus });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: `Train ${fields['Train No']} already exists.` });
        }
        console.error(`Update failed for train ${currentNo}:`, err.message);
        res.status(500).json({ error: 'Failed to update train.' });
    }
});

module.exports = router;
