// Safely extracts a Node Buffer from a Mongoose/MongoDB audioData field,
// regardless of whether it came back as a real Buffer (non-lean query) or a
// BSON Binary-like object (lean query).
//
// Do NOT do `Buffer.from(x.buffer)` on a real Buffer: `.buffer` is its
// *backing* ArrayBuffer, which is not guaranteed to start at byte 0 or match
// the Buffer's own length (Node can carve small Buffers out of a shared
// pool) - blindly wrapping it pulls in unrelated neighboring memory. This
// exact mistake corrupted ~140 stored audio clips (they came out several
// times longer than the original, padded with garbage from other buffers
// allocated around the same time) before this helper existed.
function toBuffer(audioData) {
    if (Buffer.isBuffer(audioData)) return audioData;
    if (audioData && audioData.buffer) {
        const offset = audioData.byteOffset || 0;
        const length = audioData.byteLength ?? audioData.length ?? (audioData.buffer.byteLength - offset);
        return Buffer.from(audioData.buffer, offset, length);
    }
    return Buffer.from(audioData);
}

module.exports = { toBuffer };
