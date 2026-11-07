'use strict';
/*
 * Offline diagnostics inspired by the Cluster Layouts QR log workflow.
 * No phone network, remote commands, BMW ECU writes or daemon patching.
 * Multi-page QR codes contain a zlib-compressed diagnostic text; the matching
 * tools/decode_custom_cluster_logs.py reassembles scanned CCLOG1 strings.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const qrcode = require('./qr_vendor');
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const CHUNK = 280;
const MEDIA_ROOTS = ['/media', '/run/media'];

function snapshot(ctx, cluster, wazeStatus, phoneStatus) {
    const data = [
        'CUSTOM CLUSTER DIAGNOSTICS v1',
        'Created: ' + new Date().toISOString(),
        'App version: ' + (ctx.spec && ctx.spec.version || 'unknown'),
        'Gear and real vehicle values only (not a measured GPU image).',
        '',
        '=== CLUSTER STATE ===',
        JSON.stringify(cluster.status(), null, 2),
        '',
        '=== WAZE CONTROL ===',
        String(wazeStatus || ''),
        '',
        '=== PHONE EVENT ===',
        String(phoneStatus || ''),
        '',
        '=== RENDERER SLOT AND LAYER STATUS ===',
        cluster.rendererStatus() || '(no renderer status response yet)',
    ];
    return data.join('\n') + '\n';
}

function save(ctx, data) {
    const result = [];
    const filename = 'cluster-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    const tryWrite = (dir) => {
        try {
            fs.writeFileSync(path.join(dir, filename), data, 'utf8');
            result.push(path.join(dir, filename));
        } catch (_) { /* read-only USB or no permission: use the offline QR */ }
    };
    try {
        const directory = path.join(ctx.dataDir, 'exports');
        try { fs.mkdirSync(directory, { recursive: true }); }
        catch (e) { if (e.code !== 'EEXIST') throw e; }
        tryWrite(directory);
    } catch (_) { /* QR works without writable storage */ }
    MEDIA_ROOTS.forEach((root) => {
        let names;
        try { names = fs.readdirSync(root); } catch (_) { return; }
        names.forEach((name) => {
            const p = path.join(root, name);
            try {
                if (fs.statSync(p).isDirectory()) tryWrite(p);
            } catch (_) { /* not a writable USB mount */ }
        });
    });
    return result;
}

function report(ctx, cluster, wazeStatus, phoneStatus) {
    const full = snapshot(ctx, cluster, wazeStatus, phoneStatus);
    const packed = zlib.deflateSync(Buffer.from(full, 'utf8')).toString('base64');
    const id = crypto.createHash('sha256').update(full).digest('hex').slice(0, 10);
    const count = Math.max(1, Math.ceil(packed.length / CHUNK));
    const pages = [];
    for (let i = 0; i < count; i++)
        pages.push('CCLOG1 ' + id + ' ' + (i + 1) + '/' + count + ' ' + packed.slice(i * CHUNK, (i + 1) * CHUNK));
    return { id, pages, totalBytes: Buffer.byteLength(full, 'utf8'),
        storedAt: save(ctx, full), createdAt: Date.now() };
}

function matrix(content) {
    const qr = qrcode(0, 'M');
    qr.addData(content);
    qr.make();
    return qr;
}

function draw(cv, qr, x, y, maxSize) {
    const n = qr.getModuleCount(), quiet = 4;
    const pixel = Math.floor(maxSize / (n + quiet * 2));
    if (pixel < 2) throw new RangeError('QR modules too dense');
    const side = pixel * (n + quiet * 2);
    const left = x + Math.floor((maxSize - side) / 2);
    const top = y + Math.floor((maxSize - side) / 2);
    cv.fillRect(left, top, side, side, '#ffffff');
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++)
        if (qr.isDark(row, col)) cv.fillRect(left + (col + quiet) * pixel,
            top + (row + quiet) * pixel, pixel, pixel, '#000000');
}

module.exports = { report, matrix, draw, snapshot };
