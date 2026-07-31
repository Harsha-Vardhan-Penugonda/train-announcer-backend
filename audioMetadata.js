const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Runs ffmpeg against a file with no output, and parses the duration/bitrate
// it prints to stderr about the input. There's no separate ffprobe binary
// bundled here, but ffmpeg reports the same info on stderr for free.
function getAudioMetadata(filePath) {
    return new Promise((resolve) => {
        execFile(ffmpegPath, ['-i', filePath], (error, stdout, stderr) => {
            const output = stderr || '';
            const durationMatch = output.match(/Duration: (\d+):(\d+):([\d.]+)/);
            let durationSeconds = null;
            if (durationMatch) {
                const [, h, m, s] = durationMatch;
                durationSeconds = (Number(h) * 3600) + (Number(m) * 60) + Number(s);
            }
            resolve({ durationSeconds });
        });
    });
}

module.exports = { getAudioMetadata };
