'use strict';

// Offline QR export of the complete currently retained Heating Comfort diagnostics.
// QR Code Generator by Kazuhiko Arase (MIT), licensed in apps/g21_wheelheat/NOTICE.
// Every QR page is plain UTF-8 text and can be scanned with a phone camera.
// Large logs are split into numbered pages; no cloud service or URL is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('./qr_vendor');
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const CHUNK_BYTES = 400;

function appendFile(lines, filename) {
    lines.push('');
    lines.push('=== FILE ' + filename + ' ===');
    try {
        const stat = fs.statSync(filename);
        lines.push('SIZE ' + stat.size + ' bytes');
        // All available contents of the SDK-rotated application log files are
        // included. Historical entries rotated beyond .log.1 cannot be recovered.
        lines.push(fs.readFileSync(filename, 'utf8'));
    } catch (e) {
        lines.push('UNAVAILABLE ' + String(e && (e.code || e.message) || e));
    }
}

function diagnosticText(ctx, detail) {
    const d = detail || {};
    const lines = [
        'HEATING COMFORT DIAGNOSTIC EXPORT v1',
        'Created: ' + new Date().toISOString(),
        'App: ' + String(ctx.spec && ctx.spec.id || 'g21_wheelheat'),
        'App version: ' + String(ctx.spec && ctx.spec.version || 'unknown'),
        'Data dir: ' + String(ctx.dataDir),
        'Settings path: ' + String(ctx.settings.file),
        'Settings load source: ' + String(ctx.settings.loadSource),
        'Settings save error: ' + String(ctx.settings.saveError || 'none'),
        'Event file write error: ' + String(d.eventWriteError || 'none'),
        'FS: ' + String(ctx.storageInfo || 'not available'),
        '',
        '=== LIVE CONTROLLER STATE ===',
        JSON.stringify(d.state || {}, null, 2),
        '',
        '=== SETTINGS IN MEMORY ===',
        JSON.stringify(ctx.settings.values, null, 2),
        '',
        '=== EVENT HISTORY (UP TO 60 RETAINED ENTRIES) ===',
        JSON.stringify(d.events || [], null, 2),
    ];
    appendFile(lines, ctx.settings.file);
    appendFile(lines, path.join(ctx.dataDir, 'heating_events.json'));
    appendFile(lines, path.join(ctx.dataDir, ctx.spec.id + '.log.1'));
    appendFile(lines, path.join(ctx.dataDir, ctx.spec.id + '.log'));
    return lines.join('\n');
}

function splitByUtf8Bytes(value, maxBytes) {
    const chunks = [];
    let chunk = '', bytes = 0;
    for (const ch of String(value)) {
        const size = Buffer.byteLength(ch, 'utf8');
        if (bytes + size > maxBytes && chunk) {
            chunks.push(chunk);
            chunk = '';
            bytes = 0;
        }
        chunk += ch;
        bytes += size;
    }
    if (chunk || !chunks.length) chunks.push(chunk);
    return chunks;
}

function createReport(ctx, detail) {
    const fullText = diagnosticText(ctx, detail);
    const chunks = splitByUtf8Bytes(fullText, CHUNK_BYTES);
    const id = crypto.createHash('sha256').update(fullText, 'utf8').digest('hex').slice(0, 10);
    const pages = chunks.map((chunk, index) =>
        'HCLOG1 ' + id + ' ' + (index + 1) + '/' + chunks.length + '\n' + chunk);
    return { id, pages, totalBytes: Buffer.byteLength(fullText, 'utf8'),
        createdAt: Date.now(), qrModules: null };
}

function matrix(payload) {
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    return qr;
}

function draw(cv, qr, x, y, maxSize) {
    const n = qr.getModuleCount();
    const quiet = 4;
    const pixel = Math.floor(maxSize / (n + quiet * 2));
    if (pixel < 2) throw new RangeError('QR is too dense to display legibly');
    const size = pixel * (n + quiet * 2);
    const left = x + Math.floor((maxSize - size) / 2);
    const top = y + Math.floor((maxSize - size) / 2);
    cv.fillRect(left, top, size, size, '#ffffff');
    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            if (qr.isDark(row, col))
                cv.fillRect(left + (col + quiet) * pixel,
                    top + (row + quiet) * pixel, pixel, pixel, '#000000');
        }
    }
    return { modules: n, pixel, size };
}

module.exports = { createReport, splitByUtf8Bytes, matrix, draw };
