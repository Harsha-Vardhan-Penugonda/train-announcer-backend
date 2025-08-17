const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config(); // Loads variables from .env file

const { generateAnnouncement } = require('./generate.js');

// Initialize the Express app
const app = express();
const port = process.env.PORT || 5000;

// --- Middleware ---
// Enable Cross-Origin Resource Sharing (CORS) for all routes
app.use(cors());
// Allow the server to parse JSON in the body of requests
app.use(express.json());
// Statically serve the generated announcements from the 'public/announcements' directory
app.use('/announcements', express.static(path.join(__dirname, 'public', 'announcements')));


// --- Database Connection ---
// Connect to the MongoDB Atlas database using the connection string from the .env file
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connection established successfully."))
    .catch(err => console.error("MongoDB connection error:", err));


// --- API Routes ---
// A simple test route to confirm the server is running
app.get('/', (req, res) => {
    res.send('Railway Announcement Backend is running!');
});

// The main API route for generating announcements. It calls the function from generate.js
app.post('/api/generate', generateAnnouncement);


// --- Start the Server ---
// Start listening for incoming requests on the specified port
app.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
});

//vercel code

// const express = require('express');
// const cors = require('cors');
// const path = require('path');
// // Note: We don't need dotenv for Vercel, as we'll use environment variables
// const { generateAnnouncement } = require('./generate.js');

// // Initialize the Express app
// const app = express();

// // --- Middleware ---
// app.use(cors());
// app.use(express.json());

// // This is no longer needed as Vercel handles serving files differently
// // app.use('/announcements', express.static(path.join(__dirname, 'public', 'announcements')));


// // --- API Routes ---
// app.get('/', (req, res) => {
//     res.send('Railway Announcement Backend is running!');
// });

// app.post('/api/generate', generateAnnouncement);


// // Vercel doesn't need app.listen. It handles the server itself.
// // We just need to export the app.
// module.exports = app;
