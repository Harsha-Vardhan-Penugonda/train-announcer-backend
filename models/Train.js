const mongoose = require('mongoose');

const trainSchema = new mongoose.Schema({
    // **FIX:** Corrected the schema error. The `type` property is required.
    // To allow both Numbers and Strings, we use `mongoose.Schema.Types.Mixed`.
    // This tells Mongoose that the data for 'Train No' can be of any type,
    // which resolves the conflict and the TypeError.
    'Train No': { type: mongoose.Schema.Types.Mixed, required: true, unique: true },

    // These fields from your CSV have inconsistent casing, so we match them here.
    'Train Name': { type: String },
    'FROM': { type: String },
    'TO': { type: String },
    'Train Type': { type: String }
}, {
    // This option allows for fields not strictly defined in the schema
    // which can help with inconsistent CSV headers.
    strict: false
});

// 'trains' is the name of the collection in your railwayDB database
const Train = mongoose.model('Train', trainSchema, 'trains');

module.exports = Train;
