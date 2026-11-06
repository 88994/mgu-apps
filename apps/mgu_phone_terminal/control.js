'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = 18891;

function request(dataDir, method, endpoint, callback) {
    let key;
    try { key = fs.readFileSync(path.join(dataDir, 'phone-bridge.key'), 'utf8').trim(); }
    catch (e) { return callback(new Error('Bridge is not ready; install both Store components, then reopen this app')); }
    const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: endpoint, method,
        headers: { 'X-Bridge-Key': key, 'Content-Type': 'application/json' }, timeout: 1400,
    }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; if (raw.length > 16000) req.destroy(); });
        res.on('end', () => {
            try {
                const body = JSON.parse(raw);
                if (res.statusCode !== 200) return callback(new Error(body.error || 'Bridge refused request'));
                callback(null, body);
            } catch (e) { callback(e); }
        });
    });
    req.on('timeout', () => req.destroy(new Error('Bridge response timed out')));
    req.on('error', callback);
    req.end();
}

module.exports = {
    status: (dir, fn) => request(dir, 'GET', '/local/status', fn),
    start: (dir, fn) => request(dir, 'POST', '/local/start', fn),
    stop: (dir, fn) => request(dir, 'POST', '/local/stop', fn),
};
