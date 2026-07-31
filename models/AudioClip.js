const mongoose = require('mongoose');

const CATEGORIES = ['Station Name', 'Train Name', 'Train Type', 'Digit', 'Phrase', 'Uncategorized'];

const audioClipSchema = new mongoose.Schema({
    // e.g. "Vijayawada Junction", "Pinakini", "4_tel", "daya_chesi" -
    // matches the audio filename (without extension) generate.js looks up.
    key: { type: String, required: true, unique: true },
    audioData: { type: Buffer },
    mimeType: { type: String, default: 'audio/mpeg' },
    status: { type: String, enum: ['pending', 'recorded', 'archived'], default: 'pending' },
    category: { type: String, enum: CATEGORIES, default: 'Uncategorized' },

    durationSeconds: { type: Number },
    fileSizeBytes: { type: Number },
    // Bumped every time a recording is replaced, so the dashboard can show
    // "v3" and it's obvious a clip isn't on its original take.
    version: { type: Number, default: 0 },

    requestedAt: { type: Date, default: Date.now },
    recordedAt: { type: Date },
    updatedAt: { type: Date, default: Date.now },
});

audioClipSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('AudioClip', audioClipSchema, 'audioClips');
module.exports.CATEGORIES = CATEGORIES;
