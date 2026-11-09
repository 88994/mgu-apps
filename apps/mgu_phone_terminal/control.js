'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const PORT = 18891;

// The app owns its private data directory. Provisioning here is independent
// of whether the native Store tool was installed before the app was started.
function localKey(dataDir) {
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('App data directory unavailable');
    const file = path.join(dataDir, 'phone-bridge.key');
    let key;
    try {
        key = fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        let fd;
        try { fd = fs.openSync(file, 'wx', 0o600); }
        catch (openError) { if (openError.code !== 'EEXIST') throw openError; }
        if (fd !== undefined) {
            try {
                fs.writeSync(fd, crypto.randomBytes(32).toString('hex') + '\n');
                fs.fchmodSync(fd, 0o600);
            } finally { fs.closeSync(fd); }
        }
        key = fs.readFileSync(file, 'utf8').trim();
    }
    const st = fs.statSync(file);
    if ((st.mode & 0o077) !== 0 || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Private bridge key has unsafe format or permissions');
    return key;
}

function keySetupError(error, dataDir) {
    const code = error.code || error.message;
    if (error.code !== 'EACCES' && error.code !== 'EPERM') return 'App key setup: ' + code;
    const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
    try {
        const owner = fs.statSync(path.join(dataDir, 'phone-bridge.key')).uid;
        return 'Key access ' + code + ' (file uid ' + owner + ', app uid ' + uid + ')';
    } catch (ignored) {
        try {
            const folder = fs.statSync(dataDir);
            return 'Key creation ' + code + ' (dir uid ' + folder.uid + ', app uid ' + uid + ')';
        } catch (ignoredAgain) { return 'App key setup: ' + code + ' (app uid ' + uid + ')'; }
    }
}

function request(dataDir, method, endpoint, callback) {
    let key;
    try { key = localKey(dataDir); }
    catch (e) { return callback(new Error(keySetupError(e, dataDir))); }
    const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: endpoint, method,
        headers: { 'X-Bridge-Key': key, 'Content-Type': 'application/json' }, timeout: 1400,
    }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; if (raw.length > 16000) req.destroy(); });
        res.on('end', () => {
            try {
                const body = JSON.parse(raw);
                if (res.statusCode !== 200) return callback(new Error('Bridge HTTP ' + res.statusCode + ': ' + (body.error || 'request rejected')));
                callback(null, body);
            } catch (e) { callback(e); }
        });
    });
    req.on('timeout', () => req.destroy(new Error('Bridge timeout; check background tool')));
    req.on('error', (e) => callback(new Error('Bridge connection: ' + (e.code || e.message))));
    req.end();
}

module.exports = {
    localKey,
    status: (dir, fn) => request(dir, 'GET', '/local/status', fn),
    start: (dir, fn) => request(dir, 'POST', '/local/start', fn),
    stop: (dir, fn) => request(dir, 'POST', '/local/stop', fn),
};
