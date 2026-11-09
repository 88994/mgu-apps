'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const URL = require('url').URL;
const media = require('./media');
const page = require('./phone_page');
const PORT = 18879;
const LIMIT = 256 * 1024 * 1024, QUOTA = 768 * 1024 * 1024;

function privateAddress(addr) {
    addr = String(addr || '').replace(/^::ffff:/, '');
    if (addr === '127.0.0.1' || addr === '::1') return true;
    const p = addr.split('.').map(Number);
    if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
    return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
        (p[0] === 169 && p[1] === 254);
}
function address() {
    const candidates = [];
    try { Object.keys(os.networkInterfaces()).forEach(name =>
        (os.networkInterfaces()[name] || []).forEach(it => {
            if (!it.internal && it.family === 'IPv4' && privateAddress(it.address)) candidates.push(it.address);
        })); } catch (_) {}
    return candidates.find(x => x.indexOf('172.16.222.') === 0) || candidates[0] || null;
}
function reply(res, code, body, mime) {
    res.writeHead(code, {'Content-Type': mime || 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'"});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

class Companion {
    constructor(dir, events, log) {
        this.dir = dir; this.events = events || {}; this.log = log || console;
        this.token = crypto.randomBytes(18).toString('hex');
        this.host = address(); this.port = PORT; this.http = null; this.error = ''; this.listening = false;
        this.inflightBytes = 0;
    }
    link() { return this.host ? 'http://' + this.host + ':' + this.port + '/?t=' + this.token : null; }
    start() {
        if (this.http) return;
        this.http = http.createServer((req, res) => this.handle(req, res));
        this.http.on('error', e => {
            this.listening = false;
            this.error = e.message;
            this.log.warn('[VideoHub] phone server: ' + e.message);
        });
        this.http.listen(PORT, '0.0.0.0', () => { this.listening = true; this.error = ''; });
    }
    handle(req, res) {
        if (!privateAddress(req.socket.remoteAddress)) return reply(res, 403, {error:'Local network only'});
        let u;
        try { u = new URL(req.url, 'http://localhost'); }
        catch (_) { return reply(res, 400, {error:'Invalid URL'}); }
        // The installed root network helper probes this endpoint via loopback.
        // No pairing token or other app data is revealed here.
        const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (u.pathname === '/.mgu-video-health' && req.method === 'GET' &&
            (remote === '127.0.0.1' || remote === '::1')) {
            res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store',
                'X-MGU-Video-Hub':'1'});
            return res.end('{"ok":true}');
        }
        if (u.searchParams.get('t') !== this.token) return reply(res, 403, {error:'Invalid pairing token'});
        if (u.pathname === '/' && req.method === 'GET') return reply(res, 200, page, 'text/html; charset=utf-8');
        if (u.pathname === '/status' && req.method === 'GET') return reply(res, 200, {
            files: this.events.fileCount ? this.events.fileCount() : 0,
            links: this.events.linkCount ? this.events.linkCount() : 0,
        });
        if (u.pathname === '/youtube' && req.method === 'POST') return this.youtube(req, res);
        if (u.pathname === '/upload' && req.method === 'POST') return this.upload(req, res);
        return reply(res, 404, {error:'Not found'});
    }
    youtube(req, res) {
        let raw = '';
        req.on('data', b => {
            raw += b.toString('utf8');
            if (raw.length > 4096) req.destroy();
        });
        req.on('end', () => {
            let input;
            try { input = JSON.parse(raw).url; } catch (_) { return reply(res, 400, {error:'Invalid JSON'}); }
            const id = media.youtubeId(input);
            if (!id) return reply(res, 400, {error:'Expected a YouTube video URL (not a playlist)'});
            try { if (this.events.youtube) this.events.youtube(id); }
            catch (e) { return reply(res, 500, {error:e.message}); }
            return reply(res, 201, {id});
        });
    }
    upload(req, res) {
        let name;
        try { name = media.safeName(decodeURIComponent(req.headers['x-filename'] || '')); }
        catch (_) { return reply(res, 400, {error:'Invalid filename'}); }
        const len = Number(req.headers['content-length']);
        if (!name || !media.isMedia(name) || !Number.isSafeInteger(len) || len < 1 || len > LIMIT)
            return reply(res, 400, {error:'Invalid video or size (max 256 MB)'});
        const dir = path.join(this.dir, 'videos');
        try { if (!fs.existsSync(dir)) fs.mkdirSync(dir); } catch (e) { return reply(res, 500, {error:e.message}); }
        if (media.bytesTotal(dir) + this.inflightBytes + len > QUOTA)
            return reply(res, 413, {error:'Video library quota exceeded'});
        this.inflightBytes += len;
        const target = path.join(dir, name);
        let file;
        try { file = fs.createWriteStream(target, {flags:'wx', mode:0o600}); }
        catch (e) { this.inflightBytes -= len; return reply(res, 500, {error:e.message}); }
        let received = 0, done = false, created = false;
        file.on('open', () => { created = true; });
        // Cleanup only a file WE opened. EEXIST must never unlink a user's video.
        file.on('close', () => {
            if (done && received !== len && created) {
                try { fs.unlinkSync(target); } catch (_) {}
            }
        });
        const finish = (error) => {
            if (done) return;
            done = true;
            this.inflightBytes -= len;
            if (error) {
                file.destroy();
                if (created) { try { fs.unlinkSync(target); } catch (_) {} }
                if (!res.headersSent && !res.destroyed) reply(res, error.code === 'EEXIST' ? 409 : 400, {error:error.message});
            } else {
                if (this.events.upload) this.events.upload(name);
                reply(res, 201, {name, bytes:received});
            }
        };
        file.on('error', e => finish(e));
        req.on('aborted', () => finish(new Error('Upload aborted')));
        req.on('close', () => { if (!req.complete) finish(new Error('Upload connection closed')); });
        req.on('data', b => { received += b.length; if (received > len || received > LIMIT) {
            req.unpipe(file); finish(new Error('Upload exceeds declared size'));
        } });
        req.on('end', () => { if (received !== len) finish(new Error('Incomplete upload')); });
        file.on('finish', () => { if (received === len) finish(null); });
        req.pipe(file);
    }
    stop() { if (this.http) this.http.close(); this.http = null; this.listening = false; }
}
module.exports = { Companion, privateAddress, address, PORT, LIMIT, QUOTA };
