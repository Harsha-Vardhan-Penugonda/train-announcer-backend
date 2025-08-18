/*
================================================================================
|                                                                              |
|   File: server.js (Local FFmpeg Version)                                     |
|   Description: This server is configured for local development. It includes  |
|                middleware to serve the generated audio files statically.     |
|                                                                              |
================================================================================
*/

const express = require('express');
const cors = require('cors');
const path = require('path');
const { generateAnnouncement } = require('./generate.js');

const app = express();
const port = 5001; 

// --- Middleware ---
app.use(cors()); 
app.use(express.json());

// **IMPORTANT**: This line serves files from the 'public' folder.
// This allows the frontend to access '/announcements/somefile.mp3'
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---
app.get('/', (req, res) => {
    res.send('Railway Announcement Backend is running!');
});

app.post('/api/generate', generateAnnouncement);

// --- Start the Server ---
app.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
});
