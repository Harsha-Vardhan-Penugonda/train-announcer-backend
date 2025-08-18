// /*
// ================================================================================
// |                                                                              |
// |   File: generate.js (Final Local FFmpeg Version)                             |
// |   Description: This version is for local development. It reads credentials   |
// |                from a JSON file and uses FFmpeg to merge audio files into a  |
// |                single file on the server.                                    |
// |                                                                              |
// ================================================================================
// */
// const { exec } = require('child_process');
// const fs = require('fs');
// const path = require('path');
// const { GoogleSpreadsheet } = require('google-spreadsheet');
// const { JWT } = require('google-auth-library');

// // --- Local JSON File Configuration ---
// const credentials = require('./google-credentials.json'); 
// const SPREADSHEET_ID = '1oPWMm-QLAvNVS3-61Y4lSBa32KQSthc2HziDVcQ8cxU';

// // Initialize auth
// const serviceAccountAuth = new JWT({
//   email: credentials.client_email,
//   key: credentials.private_key,
//   scopes: ['https://www.googleapis.com/auth/spreadsheets'],
// });

// const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

// // --- Database Function ---
// const getTrainDetails = async (trainNo) => {
//     await doc.loadInfo();
//     const sheet = doc.sheetsByIndex[0];
//     const rows = await sheet.getRows();
//     const trainRow = rows.find(row => String(row.get('Train No')) === String(trainNo));

//     if (trainRow) {
//         return {
//             'Train No': trainRow.get('Train No'),
//             'Train Name': trainRow.get('Train Name'),
//             'FROM': trainRow.get('From'),
//             'TO': trainRow.get('To'),
//             'train type': trainRow.get('Train Type')
//         };
//     }
//     return null;
// };

// // --- Main Announcement Generation Function ---
// const generateAnnouncement = async (req, res) => {
//     const { trainNumber, platformNumber, anncType } = req.body;

//     if (!trainNumber || !platformNumber || !anncType) {
//         return res.status(400).json({ error: "Missing required fields" });
//     }

//     try {
//         const trimmedTrainNumber = String(trainNumber).trim();
//         const trainDetails = await getTrainDetails(trimmedTrainNumber);

//         if (!trainDetails) {
//             return res.status(404).json({ error: "Train not found in the Google Sheet." });
//         }

//         // --- Build the list of audio file names ---
//         const audioFileNames = [];
//         const fromStation = trainDetails['FROM'];
//         const toStation = trainDetails['TO'];
//         const trainName = trainDetails['Train Name'];
//         const trainType = trainDetails['train type'];

//         if (!fromStation || !toStation || !trainName) {
//              return res.status(500).json({ error: "Incomplete train data in sheet. Missing From/To/Name." });
//         }
        
//         // --- Telugu Announcement ---
//         audioFileNames.push('daya_chesi.mp3');
//         trimmedTrainNumber.split('').forEach(ch => audioFileNames.push(`${ch}_tel.mp3`));
//         audioFileNames.push(`${fromStation}.mp3`);
//         audioFileNames.push(`${toStation}.mp3`);
//         audioFileNames.push(`${trainName}.mp3`);
//         if (trainType) audioFileNames.push(`${trainType}.mp3`);

//         if (anncType === "Arrive Shortly") {
//             audioFileNames.push("marikoddi.mp3");
//             audioFileNames.push(`${platformNumber}_tel.mp3`);
//             audioFileNames.push("vacchunu.mp3");
//         } else if (anncType === "Is On") {
//             audioFileNames.push(`${platformNumber}_tel.mp3`);
//             audioFileNames.push("vunnadi.mp3");
//         } else { // Ready to Leave
//             audioFileNames.push(`${platformNumber}_tel.mp3`);
//             audioFileNames.push("bayalderutaku.mp3");
//         }

//         // --- English Announcement ---
//         audioFileNames.push('kindAttention.mp3');
//         trimmedTrainNumber.split('').forEach(ch => audioFileNames.push(`${ch}_eng.mp3`));
//         audioFileNames.push(`${fromStation}.mp3`);
//         audioFileNames.push(`${toStation}.mp3`);
//         audioFileNames.push(`${trainName}.mp3`);
//         if (trainType) audioFileNames.push(`${trainType}.mp3`);

//         if (anncType === "Arrive Shortly") {
//             audioFileNames.push("willArive.mp3");
//             audioFileNames.push(`${platformNumber}_eng.mp3`);
//         } else if (anncType === "Is On") {
//             audioFileNames.push( "isOn.mp3");
//             audioFileNames.push(`${platformNumber}_eng.mp3`);
//         } else { // Ready to Leave
//             audioFileNames.push("isReadytoLeave.mp3");
//             audioFileNames.push(`${platformNumber}_eng.mp3`);
//         }

//         // --- Hindi Announcement ---
//         audioFileNames.push('yaatrikan.mp3');
//         trimmedTrainNumber.split('').forEach(ch => audioFileNames.push(`${ch}_hin.mp3`));
//         audioFileNames.push(`${fromStation}.mp3`);
//         audioFileNames.push(`${toStation}.mp3`);
//         audioFileNames.push(`${trainName}.mp3`);
//         if (trainType) audioFileNames.push(`${trainType}.mp3`);

//         if (anncType === "Arrive Shortly") {
//             audioFileNames.push("krmank.mp3");
//             audioFileNames.push(`${platformNumber}_hin.mp3`);
//             audioFileNames.push("parThodi.mp3");
//         } else if (anncType === "Is On") {
//             audioFileNames.push("krmank.mp3");
//             audioFileNames.push(`${platformNumber}_hin.mp3`);
//             audioFileNames.push("ghadi.mp3");
//         } else { // Ready to Leave
//             audioFileNames.push("krmank.mp3");
//             audioFileNames.push(`${platformNumber}_hin.mp3`);
//             audioFileNames.push("ravana.mp3");
//         }

//         // --- Use FFmpeg to merge the audio files ---
//         const audioFilesDir = path.join(__dirname, 'audio_files');
//         const outputDir = path.join(__dirname, 'public', 'announcements');
//         if (!fs.existsSync(outputDir)) {
//             fs.mkdirSync(outputDir, { recursive: true });
//         }

//         const outputFileName = `SCR_${anncType.replace(/ /g, '')}_${trimmedTrainNumber}_${Date.now()}.mp3`;
//         const outputFilePath = path.join(outputDir, outputFileName);
//         const listFileName = `audio_list_${Date.now()}.txt`;
//         const listFilePath = path.join(__dirname, listFileName);
        
//         const audioFilePaths = audioFileNames.map(file => path.join(audioFilesDir, file));
//         const validFiles = audioFilePaths.filter(file => fs.existsSync(file));
        
//         if (validFiles.length !== audioFilePaths.length) {
//             const missingFiles = audioFilePaths.filter(file => !fs.existsSync(file));
//             console.warn("Warning: The following audio files are missing:", missingFiles);
//         }
        
//         const fileContent = validFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
//         fs.writeFileSync(listFilePath, fileContent);

//         const command = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputFilePath}"`;

//         exec(command, (error, stdout, stderr) => {
//             fs.unlinkSync(listFilePath);

//             if (error) {
//                 console.error(`FFmpeg Error: ${stderr}`);
//                 return res.status(500).json({ error: 'Failed to generate announcement audio.' });
//             }
            
//             res.json({
//                 details: trainDetails,
//                 audioUrl: `/announcements/${outputFileName}`
//             });
//         });

//     } catch (err) {
//         console.error("Server error:", err);
//         res.status(500).json({ error: "An internal server error occurred." });
//     }
// };

// module.exports = { generateAnnouncement };
/*
================================================================================
|                                                                                |
|  File: generate.js (Google Sheets & ffmpeg-static Version)                     |
|  Description: Contains the core logic for generating the announcement.         |
|               It fetches train data from a Google Sheet and uses a static      |
|               FFmpeg build to stitch the audio files together, making it       |
|               compatible with hosting platforms like Render.com.               |
|  FIX: Updated to use modern google-spreadsheet (v4) syntax.                    |
|  FIX: Integrated ffmpeg-static to remove system dependency.                    |
|                                                                                |
================================================================================
*/

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const ffmpegStatic = require('ffmpeg-static'); // <-- 1. IMPORT FFMPEG-STATIC
require('dotenv').config();

// --- Google Sheet Configuration ---
// The ID of your Google Sheet (from the URL)
const SPREADSHEET_ID = '1oPWMm-QLAvNVS3-61Y4lSBa32KQSthc2HziDVcQ8cxU'; // Your verified Sheet ID
const credentials = require('./google-credentials.json');

// Initialize auth - this is the modern syntax for google-spreadsheet v4
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

// Initialize the Sheet with the auth client
const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);


// --- Database Function (reads from Google Sheets) ---
const getTrainDetails = async (trainNo) => {
    try {
        await doc.loadInfo(); // loads document properties and worksheets

        const sheet = doc.sheetsByIndex[0]; // or use doc.sheetsByTitle['Sheet1']
        const rows = await sheet.getRows();

        // Find the row that matches the train number.
        // Convert both to strings for a reliable comparison.
        const trainRow = rows.find(row => String(row.get('Train No')) === String(trainNo));

        if (trainRow) {
            // Return the data from the found row using the .get() method
            return {
                'Train No': trainRow.get('Train No'),
                'Train Name': trainRow.get('Train Name'),
                'FROM': trainRow.get('From'),
                'TO': trainRow.get('To'),
                'Train Type': trainRow.get('Train Type')
            };
        }
        return null; // Return null if no match is found

    } catch (error) {
        console.error('Error accessing Google Sheet:', error);
        // In a real app, you might want to throw the error to be caught by the main function
        return null;
    }
};

// --- Main Announcement Generation Function ---
const generateAnnouncement = async (req, res) => {
    const { trainNumber, platformNumber, anncType } = req.body;

    if (!trainNumber || !platformNumber || !anncType) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const trimmedTrainNumber = String(trainNumber).trim();
        const trainDetails = await getTrainDetails(trimmedTrainNumber);

        if (!trainDetails) {
            return res.status(404).json({ error: "Train not found in the Google Sheet." });
        }

        // --- Build the list of audio files ---
        const audioFilesDir = path.join(__dirname, 'audio_files');
        const audios = [];

        const fromStation = trainDetails['FROM'];
        const toStation = trainDetails['TO'];
        const trainName = trainDetails['Train Name'];
        const trainType = trainDetails['Train Type'];

        if (!fromStation || !toStation || !trainName) {
             return res.status(500).json({ error: "Incomplete train data in sheet. Missing From/To/Name." });
        }
        
        // --- Telugu Announcement ---
        audios.push(path.join(audioFilesDir, 'daya_chesi.mp3'));
        trimmedTrainNumber.split('').forEach(ch => audios.push(path.join(audioFilesDir, `${ch}_tel.mp3`)));
        audios.push(path.join(audioFilesDir, `${fromStation}.mp3`));
        audios.push(path.join(audioFilesDir, `${toStation}.mp3`));
        audios.push(path.join(audioFilesDir, `${trainName}.mp3`));
        audios.push(path.join(audioFilesDir, `${trainType}.mp3`));

        if (anncType === "Arrive Shortly") {
            audios.push(path.join(audioFilesDir, "marikoddi.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_tel.mp3`));
            audios.push(path.join(audioFilesDir, "vacchunu.mp3"));
        } else if (anncType === "Is On") {
            audios.push(path.join(audioFilesDir, `${platformNumber}_tel.mp3`));
            audios.push(path.join(audioFilesDir, "vunnadi.mp3"));
        } else { // Ready to Leave
            audios.push(path.join(audioFilesDir, `${platformNumber}_tel.mp3`));
            audios.push(path.join(audioFilesDir, "bayalderutaku.mp3"));
        }

        // --- English Announcement ---
        audios.push(path.join(audioFilesDir, 'kindAttention.mp3'));
        trimmedTrainNumber.split('').forEach(ch => audios.push(path.join(audioFilesDir, `${ch}_eng.mp3`)));
        audios.push(path.join(audioFilesDir, `${fromStation}.mp3`));
        audios.push(path.join(audioFilesDir, `${toStation}.mp3`));
        audios.push(path.join(audioFilesDir, `${trainName}.mp3`));
        if (trainType) audios.push(path.join(audioFilesDir, `${trainType}.mp3`));

        if (anncType === "Arrive Shortly") {
            audios.push(path.join(audioFilesDir, "willArive.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_eng.mp3`));
        } else if (anncType === "Is On") {
            audios.push(path.join(audioFilesDir, "isOn.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_eng.mp3`));
        } else { // Ready to Leave
            audios.push(path.join(audioFilesDir, "isReadytoLeave.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_eng.mp3`));
        }

        // --- Hindi Announcement ---
        audios.push(path.join(audioFilesDir, 'yaatrikan.mp3'));
        trimmedTrainNumber.split('').forEach(ch => audios.push(path.join(audioFilesDir, `${ch}_hin.mp3`)));
        audios.push(path.join(audioFilesDir, `${fromStation}.mp3`));
        audios.push(path.join(audioFilesDir, `${toStation}.mp3`));
        audios.push(path.join(audioFilesDir, `${trainName}.mp3`));
        if (trainType) audios.push(path.join(audioFilesDir, `${trainType}.mp3`));

        if (anncType === "Arrive Shortly") {
            audios.push(path.join(audioFilesDir, "krmank.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_hin.mp3`));
            audios.push(path.join(audioFilesDir, "parThodi.mp3"));
        } else if (anncType === "Is On") {
            audios.push(path.join(audioFilesDir, "krmank.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_hin.mp3`));
            audios.push(path.join(audioFilesDir, "ghadi.mp3"));
        } else { // Ready to Leave
            audios.push(path.join(audioFilesDir, "krmank.mp3"));
            audios.push(path.join(audioFilesDir, `${platformNumber}_hin.mp3`));
            audios.push(path.join(audioFilesDir, "ravana.mp3"));
        }

        // --- Use FFmpeg to merge the audio files ---
        const outputDir = path.join(__dirname, 'public', 'announcements');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFileName = `SCR_${anncType.replace(/ /g, '')}_${trimmedTrainNumber}_${Date.now()}.mp3`;
        const outputFilePath = path.join(outputDir, outputFileName);
        const listFileName = `audio_list_${Date.now()}.txt`;
        const listFilePath = path.join(__dirname, listFileName);
        
        const validFiles = audios.filter(file => fs.existsSync(file));
        if (validFiles.length !== audios.length) {
            const missingFiles = audios.filter(file => !fs.existsSync(file));
            console.warn("Warning: The following audio files are missing and will be skipped:", missingFiles);
        }
        
        const fileContent = validFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listFilePath, fileContent);

        // <-- 2. USE FFMPEG-STATIC IN THE COMMAND -->
        // The 'ffmpeg' command is replaced with the path to the static binary
        const command = `"${ffmpegStatic}" -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputFilePath}"`;

        exec(command, (error, stdout, stderr) => {
            fs.unlinkSync(listFilePath); // Clean up the temporary list file

            if (error) {
                console.error(`FFmpeg Error: ${stderr}`);
                return res.status(500).json({ error: 'Failed to generate announcement audio.' });
            }
            
            // Success: send back the details and the URL to the new audio file
            res.json({
                'Train No': trainDetails['Train No'],
                'Train Name': trainDetails['Train Name'],
                'FROM': fromStation,
                'TO': toStation,
                'Train Type': trainType,
                platformNumber: platformNumber,
                announcementType: anncType,
                audioUrl: `/announcements/${outputFileName}`
            });
        });

    } catch (err) {
        console.error("Server error:", err);
        res.status(500).json({ error: "An internal server error occurred." });
    }
};

module.exports = { generateAnnouncement };
