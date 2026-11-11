'use strict';

// Offline QR export of the current ignition/app-process session diagnostics.
// QR Code Generator by Kazuhiko Arase (MIT), licensed in apps/g21_wheelheat/NOTICE.
// Every QR page is plain UTF-8 text and can be scanned with a phone camera.
// Large reports are split into numbered pages; no cloud service or URL is used.
// Old SDK log files stay on disk, but are never included wholesale in a QR.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('./qr_vendor');
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const CHUNK_BYTES = 400;
const RAW_FILE_TAIL_BYTES = 64000;
const WARNING_RE = /SDK_(?:ERROR|WARN)|UNHANDLED REJECTION|\b(?:ERROR|FATAL)\b/i;
const IMPORTANT_RE = /REJECT|ERROR|BLOCK|FAILED|UNCONFIRMED|BUSY|VEHICLE ON|PROCESS START|UI OPEN/i;

function readTail(filename, maxBytes) {
    let fd;
    try {
        const stat = fs.statSync(filename);
        const size = Math.min(stat.size, maxBytes);
        if (!size) return '';
        const offset = stat.size - size;
        const buffer = Buffer.alloc(size);
        fd = fs.openSync(filename, 'r');
        const read = fs.readSync(fd, buffer, 0, size, offset);
        let result = buffer.toString('utf8', 0, read);
        if (offset > 0) result = result.slice(result.indexOf('\n') + 1);
        return result;
    } catch (_) { return ''; }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
}

function sessionWarnings(ctx, sinceAt, maxLines) {
    const wanted = Number.isFinite(sinceAt) ? sinceAt : Date.now();
    const id = String(ctx.spec && ctx.spec.id || 'g21_wheelheat');
    const all = [];
    for (const suffix of ['.log.1', '.log']) {
        const raw = readTail(path.join(ctx.dataDir, id + suffix), RAW_FILE_TAIL_BYTES);
        for (const line of raw.split(/\r?\n/)) {
            const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z)\s+(.+)$/.exec(line);
            if (!match || !WARNING_RE.test(match[2])) continue;
            const at = Date.parse(match[1]);
            if (!Number.isFinite(at) || at < wanted) continue;
            all.push({ at, kind: 'SDK', message: match[2].slice(0, 270) });
        }
    }
    all.sort((a, b) => a.at - b.at);
    return all.filter((e, index) => index === 0 || e.at !== all[index - 1].at ||
        e.message !== all[index - 1].message).slice(-Math.max(0, Math.min(300, maxLines || 80)));
}

function consoleLines(events, warnings, sinceAt) {
    const entries = (events || []).filter(e => e && Number.isFinite(e.at) && e.at >= sinceAt)
        .map(e => ({ at: e.at, kind: e.kind || 'INFO', message: String(e.message || '') }))
        .concat((warnings || []).filter(e => e.at >= sinceAt));
    entries.sort((a, b) => a.at - b.at);
    const lines = [];
    for (const e of entries) {
        const time = new Date(e.at).toISOString().slice(11, 19);
        const prefix = time + '  ' + String(e.kind).padEnd(13, ' ') + ' ';
        const width = Math.max(30, 132 - prefix.length);
        let rest = String(e.message).replace(/[\r\n]+/g, ' ');
        let first = true;
        do {
            const part = rest.slice(0, width);
            rest = rest.slice(width);
            lines.push({ text: (first ? prefix : ' '.repeat(prefix.length)) + part,
                error: IMPORTANT_RE.test(e.kind) || e.kind === 'SDK' });
            first = false;
        } while (rest);
    }
    return lines.slice(-800);
}

function selectedEvents(events) {
    const source = (events || []).filter(e => e && Number.isFinite(e.at));
    const chosen = new Map();
    for (const e of source.slice(0, 25).concat(source.filter(e => IMPORTANT_RE.test(e.kind)).slice(0, 15)))
        chosen.set(e.at + ':' + e.kind + ':' + e.message, e);
    return Array.from(chosen.values()).sort((a, b) => a.at - b.at);
}

function diagnosticText(ctx, detail) {
    const d = detail || {}, at = Number.isFinite(d.sessionStartedAt) ? d.sessionStartedAt : Date.now();
    const lines = [
        'HEATING COMFORT SESSION DIAGNOSTIC v2',
        'Created: ' + new Date().toISOString(),
        'Session start: ' + new Date(at).toISOString(),
        'Session reason: ' + String(d.sessionReason || 'process start'),
        'App: ' + String(ctx.spec && ctx.spec.id || 'g21_wheelheat'),
        'App version: ' + String(ctx.spec && ctx.spec.version || 'unknown'),
        'Settings save error: ' + String(ctx.settings.saveError || 'none'),
        'Event file write error: ' + String(d.eventWriteError || 'none'),
        '=== LIVE CONTROLLER STATE ===',
        JSON.stringify(d.state || {}),
        '=== SETTINGS IN MEMORY ===',
        JSON.stringify(ctx.settings.values),
        '=== RECENT SESSION EVENTS ===',
    ];
    for (const e of selectedEvents((d.events || []).filter(e => e && e.at >= at)))
        lines.push(new Date(e.at).toISOString() + ' ' + e.kind + ' ' + e.message);
    lines.push('=== SESSION SDK ERRORS / WARNINGS ===');
    for (const e of sessionWarnings(ctx, at, 18))
        lines.push(new Date(e.at).toISOString() + ' ' + e.message);
    lines.push('Complete chronological detail: scrollable Log tab.');
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
        'HCLOG2 ' + id + ' ' + (index + 1) + '/' + chunks.length + '\n' + chunk);
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

module.exports = { createReport, diagnosticText, consoleLines, sessionWarnings,
    splitByUtf8Bytes, matrix, draw };
