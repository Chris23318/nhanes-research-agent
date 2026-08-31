const zlib = require('zlib');

function writeString(buffer, offset, length, value) { buffer.write(String(value).slice(0, length), offset, length, 'utf8'); }
function writeOctal(buffer, offset, length, value) { writeString(buffer, offset, length, value.toString(8).padStart(length - 1, '0') + '\0'); }
function createTar(files) {
  const chunks = [];
  for (const [name, value] of Object.entries(files)) {
    const content = Buffer.from(String(value)), header = Buffer.alloc(512);
    writeString(header, 0, 100, name); writeOctal(header, 100, 8, 0o644); writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.length); writeOctal(header, 136, 12, Math.floor(Date.now() / 1000)); header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0); writeString(header, 257, 6, 'ustar'); writeString(header, 263, 2, '00');
    writeOctal(header, 148, 8, [...header].reduce((sum, byte) => sum + byte, 0)); chunks.push(header, content);
    const padding = content.length % 512; if (padding) chunks.push(Buffer.alloc(512 - padding));
  }
  chunks.push(Buffer.alloc(1024)); return Buffer.concat(chunks);
}
function createAnalysisArchive(artifact) { return zlib.gzipSync(createTar(artifact.files), { level: 9 }); }
module.exports = { createTar, createAnalysisArchive };
