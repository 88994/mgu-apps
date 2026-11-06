'use strict';
/** Ephemeral, token-protected HTTP upload for a phone on the same reachable car network. */
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const MAX_BYTES = 6 * 1024 * 1024;
const SESSION_MS = 10 * 60 * 1000;

function localAddresses() {
    const list = [];
    // Some software-only emulators block interface enumeration; the car normally does not.
    let all;
    try { all = os.networkInterfaces(); } catch (e) { all = {}; }
    Object.keys(all).forEach((name) => {
        (all[name] || []).forEach((it) => {
            const ipv4 = it.family === 'IPv4' || it.family === 4;
            if (!ipv4 || it.internal || !it.address || /^169\.254\./.test(it.address)) return;
            if (list.some((item) => item.ip === it.address)) return;
            const priority = /p2p|wlan|wifi|wl/i.test(name) ? 0 : /eth|en/i.test(name) ? 1 : 2;
            list.push({ interface: name, ip: it.address, priority });
        });
    });
    if (process.env.GIF_HOME_DEV_IP && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(process.env.GIF_HOME_DEV_IP)) {
        const ip = process.env.GIF_HOME_DEV_IP;
        if (!list.some((item) => item.ip === ip)) list.unshift({ interface: 'preview', ip, priority: -1 });
    }
    return list.sort((a, b) => a.priority - b.priority || a.interface.localeCompare(b.interface));
}

function uploadPage(token) {
    // Token consists exclusively of crypto-generated hexadecimal digits.
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GIF Home — Upload</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#080d1a;color:#edf4ff;
font:16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;padding:22px}
.box{width:min(440px,100%);padding:30px;border-radius:24px;background:#151d30;border:1px solid #2d3c60;
box-shadow:0 20px 70px #0007}h1{font-size:27px;margin:0 0 8px}p{color:#aab9d3;line-height:1.5}
.mark{color:#58adff;letter-spacing:3px;font-size:12px;font-weight:800;margin-bottom:12px}
input{width:100%;margin:16px 0;padding:18px;background:#0b1120;border:1px dashed #3e6085;border-radius:12px;color:#fff}
button{width:100%;background:#2679e8;color:white;border:0;border-radius:12px;padding:15px 18px;
font-weight:750;font-size:16px}button:disabled{background:#39455d}#result{margin-top:16px;min-height:40px;
color:#a9c5ff}small{display:block;color:#8091af;margin-top:18px;line-height:1.5}
</style></head><body><main class="box"><div class="mark">BMW MGU / IDRIVE 7</div>
<h1>GIF Home</h1><p>Choose a GIF from your phone. It will appear in the BMW home-screen widget.</p>
<input id="file" type="file" accept=".gif,image/gif" aria-label="Select GIF">
<button id="send">Upload GIF</button><div id="result" role="status">Ready to upload.</div>
<small>Offline transfer to your own car. Maximum 6 MB, 640 × 360 pixels and 90 frames.
This QR session expires after 10 minutes.</small></main>
<script>
(function(){'use strict';
var button=document.getElementById('send'),result=document.getElementById('result');
button.addEventListener('click',function(){
var file=document.getElementById('file').files[0];
if(!file){result.textContent='Choose a GIF first.';return;}
if(file.size> ${MAX_BYTES}){result.textContent='GIF exceeds the 6 MB limit.';return;}
button.disabled=true;result.textContent='Uploading...';
var xhr=new XMLHttpRequest();
xhr.open('POST','/upload?t=${token}',true);
xhr.setRequestHeader('Content-Type','image/gif');
xhr.upload.onprogress=function(e){if(e.lengthComputable)result.textContent='Uploading '+Math.round(e.loaded/e.total*100)+'%';};
xhr.onload=function(){
button.disabled=false;
try{var data=JSON.parse(xhr.responseText);result.textContent=data.message||'Done';}
catch(e){result.textContent='Upload failed (HTTP '+xhr.status+').';}
if(xhr.status===200)button.disabled=true;
};
xhr.onerror=function(){button.disabled=false;result.textContent='Cannot reach the car. Check Wi-Fi connection.';};
xhr.send(file);
});
})();</script></body></html>`;
}

class GifUploadServer {
    constructor(options) {
        this.port = options.port === undefined ? 18883 : options.port;
        this.onUpload = options.onUpload;
        this.log = options.log || { info() {}, warn() {} };
        this.token = null;
        this.expires = 0;
        this.listening = false;
        this.uploading = false;
        this.server = http.createServer((req, res) => this.handle(req, res));
        this.server.on('clientError', (e, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {} });
    }

    start() {
        if (this.listening) return Promise.resolve(this.port);
        return new Promise((resolve, reject) => {
            const failed = (err) => { this.server.removeListener('listening', ready); reject(err); };
            const ready = () => {
                this.server.removeListener('error', failed);
                this.listening = true;
                this.port = this.server.address().port;
                resolve(this.port);
            };
            this.server.once('error', failed);
            this.server.once('listening', ready);
            this.server.listen(this.port, '0.0.0.0');
        });
    }

    begin() {
        this.token = crypto.randomBytes(16).toString('hex');
        this.expires = Date.now() + SESSION_MS;
        return this.token;
    }
    end() { this.token = null; this.expires = 0; }
    valid(token) { return !!(this.token && Date.now() < this.expires &&
        typeof token === 'string' && token.length === this.token.length &&
        crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.token))); }
    link(ip) { return this.token && Date.now() < this.expires ? 'http://' + ip + ':' + this.port + '/?t=' + this.token : ''; }
    close() { this.end(); return new Promise((done) => this.server.close(() => { this.listening = false; done(); })); }
    headers(res, code, kind) {
        res.writeHead(code, { 'Content-Type': kind, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'" });
    }
    json(res, code, message) {
        this.headers(res, code, 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: code === 200, message }));
    }
    handle(req, res) {
        let route;
        try { route = new URL(req.url || '/', 'http://localhost'); }
        catch (e) { this.json(res, 400, 'Invalid URL.'); req.resume(); return; }
        if (!this.valid(route.searchParams.get('t'))) { this.json(res, 403, 'QR session is not active or has expired.'); req.resume(); return; }
        if (req.method === 'GET' && route.pathname === '/') {
            this.headers(res, 200, 'text/html; charset=utf-8'); res.end(uploadPage(this.token)); return;
        }
        if (req.method !== 'POST' || route.pathname !== '/upload') {
            this.json(res, 404, 'Page not found.'); req.resume(); return;
        }
        if (this.uploading) { this.json(res, 409, 'An upload is already running.'); req.resume(); return; }
        const advertised = Number(req.headers['content-length'] || 0);
        if (advertised > MAX_BYTES) { this.json(res, 413, 'GIF is larger than 6 MB.'); req.resume(); return; }
        this.uploading = true;
        let total = 0, chunks = [], finished = false;
        req.on('data', (chunk) => {
            if (finished) return;
            total += chunk.length;
            if (total > MAX_BYTES) {
                finished = true; chunks = [];
                this.uploading = false;
                this.json(res, 413, 'GIF is larger than 6 MB.');
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (finished) return;
            finished = true;
            if (!total) { this.uploading = false; this.json(res, 400, 'No GIF data received.'); return; }
            const data = Buffer.concat(chunks, total);
            Promise.resolve().then(() => this.onUpload(data)).then(() => {
                this.uploading = false;
                this.end();
                this.json(res, 200, 'Uploaded! The new GIF is now active in the car.');
            }).catch((e) => {
                this.uploading = false;
                this.log.warn('Phone GIF rejected: ' + (e && e.message || e));
                this.json(res, 422, 'GIF rejected: ' + (e && e.message || 'Invalid format'));
            });
        });
        req.on('aborted', () => { if (!finished) { finished = true; this.uploading = false; } });
        req.on('error', () => { if (!finished) { finished = true; this.uploading = false; if (!res.headersSent) this.json(res, 400, 'Upload interrupted.'); } });
    }
}

module.exports = { GifUploadServer, localAddresses, uploadPage, MAX_BYTES, SESSION_MS };
