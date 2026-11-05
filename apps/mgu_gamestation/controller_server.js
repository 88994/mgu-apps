'use strict';

// Minimal, dependency-free RFC6455 server: BMW OAP Node 8 does not bundle ws.
// Exposes only a local HTTP controller and an authenticated upload endpoint.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const page = require('./phone_page');

const PORT = 18878;
const MAX_MESSAGE = 1024;
const MAX_ROM = 8 * 1024 * 1024;
const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'select', 'start'];
const ACCEPT = {nes: ['.nes'], gb: ['.gb', '.gbc'], snes: ['.sfc', '.smc']};

function privateAddress(ip) {
    ip = String(ip || '').replace(/^::ffff:/, '');
    if (ip === '::1' || ip === '127.0.0.1') return true;
    const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const n = m.slice(1).map(Number);
    return n.every(x => x >= 0 && x <= 255) &&
        (n[0] === 10 || n[0] === 172 && n[1] >= 16 && n[1] <= 31 || n[0] === 192 && n[1] === 168);
}
function ownAddress() {
    let all;
    try { all = os.networkInterfaces(); }
    catch (_) { return '172.16.222.97'; } // No interface enumeration inside some OAP sandboxes.
    const addresses = [];
    Object.keys(all).forEach(k => (all[k] || []).forEach(i => {
        if (i.family === 'IPv4' && !i.internal && privateAddress(i.address)) addresses.push(i.address);
    }));
    return addresses.find(ip => ip.indexOf('172.16.222.') === 0) || addresses[0] || '172.16.222.97';
}
function mkdir(p) { try { fs.mkdirSync(p); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
function basename(name) { return String(name || '').replace(/[^a-zA-Z0-9_. -]/g, '_').replace(/^\.+/, '').slice(0, 90); }
function validRom(kind, name, bytes) {
    if (!ACCEPT[kind] || !ACCEPT[kind].some(ext => name.toLowerCase().endsWith(ext))) return false;
    if (!bytes || bytes.length < 32 || bytes.length > MAX_ROM) return false;
    if (kind === 'nes') return bytes.slice(0, 4).toString('binary') === 'NES\x1a';
    if (kind === 'gb') return bytes.length >= 0x150;
    return true; // SNES copier headers may or may not be present.
}
function reply(res, status, body, type) {
    res.writeHead(status, {'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self' 'unsafe-inline' ws:; object-src 'none'; frame-ancestors 'none'"});
    res.end(body);
}
function frame(payload, op) {
    const data = Buffer.from(payload || '');
    const header = data.length < 126 ? 2 : 4;
    const out = Buffer.allocUnsafe(header + data.length);
    out[0] = 0x80 | (op || 1);
    if (header === 2) out[1] = data.length;
    else { out[1] = 126; out.writeUInt16BE(data.length, 2); }
    data.copy(out, header); return out;
}

class ControllerServer {
    constructor(dataDir, callbacks, log) {
        this.token = crypto.randomBytes(16).toString('hex');
        this.dataDir = dataDir; this.callbacks = callbacks || {}; this.log = log || console;
        this.players = [null, null]; this.http = null; this.error = null;
        this.address = ownAddress(); this.port = PORT;
    }
    url(player) { return 'http://' + this.address + ':' + PORT + '/?p=' + player + '&t=' + this.token; }
    status() { return this.players.map(p => !!(p && !p.closed && Date.now() - p.lastSeen < 1600)); }
    pads() { return this.players.map(p => p && !p.closed && Date.now() - p.lastSeen < 1600 ? p.keys : {}); }
    start() {
        if (this.http) return;
        const server = http.createServer((req, res) => this.request(req, res));
        server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
        server.on('error', err => { this.error = err.message; this.log.warn('GameStation phone server: ' + err.message); });
        server.listen(PORT, '0.0.0.0'); this.http = server;
    }
    request(req, res) {
        if (!privateAddress(req.socket.remoteAddress)) return reply(res, 403, 'Local network only');
        const q = url.parse(req.url, true), authorized = q.query.t === this.token;
        if (!authorized) return reply(res, 403, 'Invalid pairing link');
        if (req.method === 'GET' && q.pathname === '/') return reply(res, 200, page, 'text/html; charset=utf-8');
        if (req.method === 'POST' && q.pathname === '/rom') return this.upload(req, res, q.query);
        reply(res, 404, 'Not found');
    }
    upload(req, res, query) {
        const kind = query.platform, name = basename(query.name), limit = Number(req.headers['content-length'] || 0);
        if (!ACCEPT[kind] || !name || limit > MAX_ROM) return reply(res, 400, 'Invalid game / too large');
        let size = 0, buffers = [], done = false;
        req.on('data', part => {
            size += part.length;
            if (size > MAX_ROM) { done = true; req.destroy(); return; }
            buffers.push(part);
        });
        req.on('end', () => {
            if (done) return;
            const bytes = Buffer.concat(buffers); buffers = [];
            if (!validRom(kind, name, bytes)) return reply(res, 400, 'Invalid ROM format');
            try {
                mkdir(path.join(this.dataDir, 'roms'));
                mkdir(path.join(this.dataDir, 'roms', kind));
                const filename = path.join(this.dataDir, 'roms', kind, name);
                fs.writeFileSync(filename, bytes, {flag: 'wx'});
                this.log.info('GameStation imported ' + kind + '/' + name + ' (' + bytes.length + ' bytes)');
                if (this.callbacks.upload) this.callbacks.upload(kind, name);
                reply(res, 201, 'Uploaded: ' + name + '. Select it on the BMW screen.');
            } catch (e) { reply(res, e.code === 'EEXIST' ? 409 : 500, e.code === 'EEXIST' ? 'Filename already exists' : 'Cannot store ROM: ' + e.message); }
        });
    }
    upgrade(req, socket, head) {
        const q = url.parse(req.url, true), player = Number(q.query.p) - 1;
        if (!privateAddress(socket.remoteAddress) || q.query.t !== this.token || !(player === 0 || player === 1) ||
            req.headers.upgrade !== 'websocket' || req.headers['sec-websocket-version'] !== '13' ||
            !/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key'] || '')) { socket.destroy(); return; }
        // Do not let a second browser silently steal a connected player's slot.
        if (this.players[player] && !this.players[player].closed) { socket.destroy(); return; }
        const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
        const p = {socket, keys: {}, lastSeen: Date.now(), closed: false, buffered: Buffer.alloc(0)};
        this.players[player] = p;
        const close = () => { p.closed = true; p.keys = {}; if (this.players[player] === p) this.players[player] = null; };
        socket.on('close', close); socket.on('error', close);
        socket.on('data', d => this.onData(p, d));
        if (head && head.length) this.onData(p, head);
        socket.setNoDelay(true);
    }
    onData(p, part) {
        p.buffered = Buffer.concat([p.buffered, part]);
        if (p.buffered.length > 2048) { p.socket.destroy(); return; }
        while (p.buffered.length >= 2) {
            const b = p.buffered, opcode = b[0] & 15, masked = !!(b[1] & 0x80), size0 = b[1] & 127;
            if (!(b[0] & 0x80) || !masked || size0 === 127) { p.socket.destroy(); return; }
            const prefix = size0 === 126 ? 4 : 2;
            if (b.length < prefix) return;
            const size = size0 === 126 ? b.readUInt16BE(2) : size0;
            if (size > MAX_MESSAGE) { p.socket.destroy(); return; }
            if (b.length < prefix + 4 + size) return;
            const mask = b.slice(prefix, prefix + 4), data = Buffer.from(b.slice(prefix + 4, prefix + 4 + size));
            for (let i = 0; i < size; i++) data[i] ^= mask[i & 3];
            p.buffered = b.slice(prefix + 4 + size);
            if (opcode === 8) { p.socket.end(frame('', 8)); return; }
            if (opcode === 9) { p.socket.write(frame(data, 10)); continue; }
            if (opcode !== 1) { p.socket.destroy(); return; }
            let msg; try { msg = JSON.parse(data.toString('utf8')); } catch (_) { continue; }
            if (msg && msg.type === 'buttons' && Array.isArray(msg.keys) && msg.keys.length <= BUTTONS.length) {
                const next = {};
                msg.keys.forEach(k => { if (BUTTONS.indexOf(k) >= 0) next[k] = true; });
                p.keys = next; p.lastSeen = Date.now();
            }
        }
    }
    stop() {
        this.players.forEach(p => { if (p) { p.closed = true; p.socket.destroy(); } });
        if (this.http) this.http.close(); this.http = null;
    }
}

module.exports = {ControllerServer, privateAddress, validRom, basename};
