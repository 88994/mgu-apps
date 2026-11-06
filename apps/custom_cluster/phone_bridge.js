'use strict';
// Local event bridge for iOS Shortcuts; this DOES NOT identify background app activity.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = 18977;
const FRESH_MS = 5 * 60 * 1000;
function ipv4OnCarWifi(interfaces) {
    const net = interfaces || os.networkInterfaces();
    // The car's bridge is usually wlan_bridge. Never bind to all interfaces.
    const names = Object.keys(net).filter((n) => /^wlan_bridge$|^wlan\d+$|^wlan\d+_bridge$/.test(n));
    for (const n of names) {
        const a = (net[n] || []).find((x) => x.family === 'IPv4' && !x.internal);
        if (a) return a.address;
    }
    return null;
}

class PhoneBridge {
    constructor(dataDir, log, changed, opts) {
        this.log = log;
        this.changed = changed || (() => {});
        this.server = null;
        this.host = null;
        this.mode = 'unknown';
        this.updated = 0;
        this.port = (opts && opts.port) || PORT;
        this.address = opts && opts.address;
        this.tokenFile = path.join(dataDir, 'phone-bridge-token');
        try {
            this.token = fs.readFileSync(this.tokenFile, 'utf8').trim();
            if (!/^[a-f0-9]{32}$/.test(this.token)) throw new Error('invalid token');
        } catch (e) {
            this.token = crypto.randomBytes(16).toString('hex');
            try { fs.writeFileSync(this.tokenFile, this.token + '\n', { mode: 0o600, flag: 'wx' }); }
            catch (writeError) { this.log.warn('phone token could not be saved: ' + writeError); }
        }
    }

    setEnabled(enabled) {
        if (!enabled) { this.stop(); return; }
        if (this.server) return;
        const host = this.address || ipv4OnCarWifi();
        if (!host) { this.log.warn('No CarPlay Wi-Fi address, phone bridge not started'); return; }
        this.host = host;
        const server = http.createServer((req, res) => this._handle(req, res));
        this.server = server;
        server.on('error', (err) => {
            this.log.warn('phone bridge: ' + err.message);
            if (this.server === server) this.server = null;
            this.host = null;
        });
        server.listen(this.port, host);
    }

    _handle(req, res) {
        const route = '/s/' + this.token + '/';
        const pathname = (req.url || '').split('?')[0];
        // A passworded, same-network, write-only signal; no third-party access.
        if (req.method !== 'GET' || (pathname !== route + 'on' && pathname !== route + 'off')) {
            res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
            res.end('Not found');
            return;
        }
        this.mode = pathname === route + 'on' ? 'opened' : 'closed';
        this.updated = Date.now();
        this.changed();
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('OK');
    }

    reported() {
        if (!this.updated || Date.now() - this.updated > FRESH_MS) return 'unknown';
        return this.mode;
    }
    url(state) {
        if (!this.server || !this.server.listening || !this.host) return null;
        return 'http://' + this.host + ':' + this.port + '/s/' + this.token + '/' + state;
    }
    stop() {
        if (this.server) { try { this.server.close(); } catch (e) {} }
        this.server = null;
        this.host = null;
        this.mode = 'unknown';
        this.updated = 0;
        this.changed();
    }
}

module.exports = { PhoneBridge, ipv4OnCarWifi, PORT, FRESH_MS };
