/*
================================================================================
|                                                                              |
|   File: test-sheet-connection.js                                             |
|   Description: A simple script to verify the connection to your Google Sheet.|
|                It will attempt to load all rows and print the 'Train Name'   |
|                from each one.                                                |
|   FIX: Updated to use modern google-spreadsheet (v4) syntax.                 |
|                                                                              |
================================================================================
*/

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// --- Configuration ---
// The ID of your Google Sheet (from the URL)
const SPREADSHEET_ID = '1oPWMm-QLAvNVS3-61Y4lSBa32KQSthc2HziDVcQ8cxU'; // <-- IMPORTANT: Updated with your Sheet ID
const credentials = require('./google-credentials.json');

// Initialize auth - this is the modern syntax for google-spreadsheet v4
const serviceAccountAuth = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

// Initialize the Sheet with the auth client
const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

async function testConnection() {
    console.log('Attempting to connect to Google Sheet...');

    try {
        // loads document properties and worksheets
        await doc.loadInfo();
        console.log('✅ Authentication successful.');
        console.log(`✅ Successfully loaded spreadsheet: "${doc.title}"`);

        // Get the first worksheet
        const sheet = doc.sheetsByIndex[0];
        console.log(`✅ Accessing sheet: "${sheet.title}"`);

        // Load all rows from the sheet
        const rows = await sheet.getRows();
        console.log(`✅ Found ${rows.length} rows in the sheet.`);

        if (rows.length > 0) {
            console.log('\n--- Printing Train Names from Sheet ---');
            rows.forEach(row => {
                // Access the data by the header name using the .get() method
                console.log(`- ${row.get('Train Name')}`);
            });
            console.log('\n--- Test Complete ---');
            console.log('\n🎉 SUCCESS! Your connection to Google Sheets is working correctly.');
        } else {
            console.warn('⚠️ The sheet was accessed successfully, but it appears to be empty.');
        }

    } catch (error) {
        console.error('\n❌ ERROR: Failed to connect to Google Sheets.');
        console.error('--------------------------------------------------');
        console.error('Please check the following:');
        console.error('1. Is the SPREADSHEET_ID in this file correct?');
        console.error('2. Is the "client_email" from your google-credentials.json file shared with your Google Sheet (with "Viewer" access)?');
        console.error('3. Is the Google Sheets API enabled in your Google Cloud project?');
        console.error('4. Is the google-credentials.json file present in the `backend` folder?');
        console.error('\nOriginal Error Message:', error.message);
        console.error('--------------------------------------------------');
    }
}

// Run the test function
testConnection();
