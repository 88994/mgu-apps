'use strict';

/* Root daemon. Node 8 compatible and dependency-free. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const child = require('child_process');

const APP_ID = 'mgu_phone_terminal';
const DEFAULT_LOCAL_PORT = 18891;
const DEFAULT_PUBLIC_PORT = 18890;
const PAIR_MS = 3 * 60 * 1000;
const SESSION_MS = 15 * 60 * 1000;
const LIMIT_MS = 15000;
const MAX_OUT = 60000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 4096;

function token() { return crypto.randomBytes(32).toString('hex'); }
function same(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const aa = Buffer.from(a), bb = Buffer.from(b);
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        'Content-Type': 'application/json; charset=utf-8'
    }, headers || {}));
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req, callback) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return callback(new Error('Content-Type must be application/json'));
    let raw = '', done = false;
    req.on('data', (part) => {
        raw += part;
        if (raw.length > MAX_BODY && !done) { done = true; callback(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
        if (done) return;
        try { callback(null, JSON.parse(raw)); } catch (e) { callback(new Error('Invalid JSON')); }
    });
    req.on('error', () => { if (!done) { done = true; callback(new Error('Request failed')); } });
}
function addresses() {
    let nics;
    try { nics = os.networkInterfaces(); }
    catch (e) { return []; }
    const out = [];
    Object.keys(nics).forEach((name) => (nics[name] || []).forEach((item) => {
        if ((item.family !== 'IPv4' && item.family !== 4) || item.internal || !item.address) return;
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(item.address)) return;
        const score = /p2p|wlan|wifi|wlp|ap0/i.test(name) ? 0 : /^eth|enp|usb|rndis|br/i.test(name) ? 1 : 2;
        out.push({ ip: item.address, interface: name, score: score + (item.address.indexOf('169.254.') === 0 ? 10 : 0) });
    }));
    return out.sort((a, b) => a.score - b.score || a.interface.localeCompare(b.interface)).map((x) => ({ ip: x.ip, interface: x.interface }));
}
function findDataDir(options) {
    if (options && options.dataDir) return options.dataDir;
    const f = '/var/opt/public/oap/oap_12201/data/apps/' + APP_ID + '.json';
    const reg = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Number.isInteger(+reg.userId) || +reg.userId < 1 || +reg.userId > 999999) throw new Error('Unexpected app userId');
    return '/var/opt/public/oap/oap_' + reg.userId + '/data';
}
function secretFromDataDir(dir) {
    const secretPath = path.join(dir, 'phone-bridge.key');
    const st = fs.statSync(dir);
    try {
        const fd = fs.openSync(secretPath, 'wx', 0o600);
        try {
            fs.writeSync(fd, token() + '\n');
            fs.fchownSync(fd, st.uid, st.gid);
            fs.fchmodSync(fd, 0o600);
        } finally { fs.closeSync(fd); }
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const keyFile = fs.statSync(secretPath);
    if ((keyFile.mode & 0o077) !== 0 || keyFile.uid !== st.uid) throw new Error('Insecure bridge key permissions/ownership');
    return fs.readFileSync(secretPath, 'utf8').trim();
}

function makeBridge(options) {
    options = options || {};
    const localPort = options.localPort === undefined ? DEFAULT_LOCAL_PORT : options.localPort;
    const publicPort = options.publicPort === undefined ? DEFAULT_PUBLIC_PORT : options.publicPort;
    const now = options.now || Date.now;
    let controlKey = null, pairToken = null, pairUntil = 0;
    let sessionToken = null, sessionUntil = 0, running = false, runningProc = null, failureCount = 0, blockUntil = 0;
    let localServer, publicServer, keyPoll;

    function terminateCommand() {
        if (!runningProc) return;
        try { process.kill(-runningProc.pid, 'SIGKILL'); }
        catch (e) { try { runningProc.kill('SIGKILL'); } catch (ignored) {} }
    }

    function ensureKey() {
        if (controlKey) return controlKey;
        try { controlKey = secretFromDataDir(findDataDir(options)); }
        catch (e) { return null; }
        return controlKey;
    }
    function closed() {
        if (pairToken && now() >= pairUntil) pairToken = null;
        if (sessionToken && now() >= sessionUntil) { sessionToken = null; terminateCommand(); }
        return !pairToken && !sessionToken;
    }
    function revoke() { terminateCommand(); pairToken = null; pairUntil = 0; sessionToken = null; sessionUntil = 0; }
    function status() {
        closed();
        return { state: sessionToken ? 'active' : pairToken ? 'pairing' : 'closed', expiresAt: sessionToken ? sessionUntil : pairToken ? pairUntil : 0, addresses: addresses(), port: publicPort, version: '0.1.0' };
    }

    function local(req, res) {
        const key = ensureKey();
        if (!key) return send(res, 503, { error: 'Waiting for Phone Terminal app data directory' });
        if (!same(req.headers['x-bridge-key'], key)) return send(res, 403, { error: 'Forbidden' });
        const route = String(req.url || '').split('?')[0];
        if (req.method === 'GET' && route === '/local/status') return send(res, 200, status());
        if (req.method === 'POST' && route === '/local/stop') { revoke(); return send(res, 200, status()); }
        if (req.method === 'POST' && route === '/local/start') {
            revoke();
            pairToken = token();
            pairUntil = now() + PAIR_MS;
            return send(res, 200, Object.assign(status(), { token: pairToken }));
        }
        send(res, 404, { error: 'Not found' });
    }

    function hasSession(req) {
        closed();
        const cookie = (req.headers.cookie || '').split(';').map((x) => x.trim()).filter((x) => x.indexOf('mgu_session=') === 0)[0] || '';
        return !!sessionToken && same(cookie.slice('mgu_session='.length), sessionToken);
    }
    function originOk(req) {
        const raw = req.headers.origin || '';
        if (!raw || !req.headers.host) return false;
        return raw === 'http://' + req.headers.host && /^\[(?:[\da-f:]+)\]:\d+$|^(?:\d{1,3}\.){3}\d{1,3}:\d+$|^localhost:\d+$/i.test(req.headers.host);
    }
    function command(req, res, cmd) {
        if (running) return send(res, 409, { error: 'Another command is running' });
        if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 1000 || /\0/.test(cmd)) return send(res, 400, { error: 'Command must be 1–1000 characters' });
        running = true;
        let out = '', err = '', truncated = false, timedOut = false, completed = false;
        const startAt = now();
        const proc = child.spawn('/bin/sh', ['-c', cmd], {
            cwd: '/', detached: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', HOME: '/root' }
        });
        runningProc = proc;
        const kill = terminateCommand;
        const timer = setTimeout(() => { timedOut = true; kill(); }, LIMIT_MS);
        function append(which, buf) {
            const text = buf.toString('utf8');
            const total = out.length + err.length;
            if (total + text.length > MAX_OUT) {
                truncated = true;
                const remaining = Math.max(0, MAX_OUT - total);
                if (which === 'out') out += text.slice(0, remaining); else err += text.slice(0, remaining);
                kill();
            } else if (which === 'out') out += text; else err += text;
        }
        proc.stdout.on('data', (c) => append('out', c));
        proc.stderr.on('data', (c) => append('err', c));
        proc.on('error', (e) => { err += '\nFailed to start: ' + e.message; });
        proc.on('close', (code, signal) => {
            if (completed) return;
            completed = true; clearTimeout(timer); running = false; runningProc = null;
            send(res, 200, { stdout: out, stderr: err, code: code, signal: signal, truncated: truncated, timedOut: timedOut, elapsedMs: now() - startAt });
        });
    }
    function publicAccess(req, res) {
        const route = String(req.url || '').split('?')[0];
        const publicFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/client.js': ['client.js', 'application/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
        if (req.method === 'GET' && publicFiles[route]) {
            const p = publicFiles[route];
            return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, p[0]), 'utf8'), { 'Content-Type': p[1] });
        }
        if (req.method === 'GET' && route === '/api/status') {
            if (!hasSession(req)) return send(res, 401, { error: 'Not paired' });
            return send(res, 200, { authenticated: true, expiresAt: sessionUntil, running: running });
        }
        if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
        if (!originOk(req) || req.headers['x-terminal-request'] !== '1') return send(res, 403, { error: 'Invalid request origin' });
        if (route === '/api/pair') {
            if (now() < blockUntil) return send(res, 429, { error: 'Too many pairing attempts' });
            return readBody(req, (e, body) => {
                if (e) return send(res, 400, { error: e.message });
                closed();
                if (!pairToken || !body || !same(body.token, pairToken)) {
                    failureCount++;
                    if (failureCount >= 8) { blockUntil = now() + 60000; failureCount = 0; }
                    return send(res, 403, { error: 'Pairing code expired or incorrect' });
                }
                failureCount = 0; pairToken = null; pairUntil = 0;
                sessionToken = token(); sessionUntil = now() + SESSION_MS;
                send(res, 200, { authenticated: true, expiresAt: sessionUntil }, {
                    'Set-Cookie': 'mgu_session=' + sessionToken + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=900'
                });
            });
        }
        if (!hasSession(req)) return send(res, 401, { error: 'Session ended. Start a new session on iDrive.' });
        if (route === '/api/logout') { revoke(); return send(res, 200, { ok: true }, { 'Set-Cookie': 'mgu_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
        if (route === '/api/exec') return readBody(req, (e, body) => {
            if (e) return send(res, 400, { error: e.message });
            command(req, res, body && body.command);
        });
        send(res, 404, { error: 'Not found' });
    }

    async function start() {
        // On a car the app may be installed after the service, so absence is not fatal.
        // When its data directory already exists, provision the private control key now.
        ensureKey();
        localServer = http.createServer(local);
        publicServer = http.createServer(publicAccess);
        const listen = (server, port, address) => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, address, () => { server.removeListener('error', reject); resolve(); });
        });
        await listen(localServer, localPort, '127.0.0.1');
        try { await listen(publicServer, publicPort, options.publicHost || '0.0.0.0'); }
        catch (e) { localServer.close(); throw e; }
        // The Store installs this required tool before the OAP app. Provision
        // its control key as soon as the app directory appears, without needing
        // an unauthenticated HTTP provisioning request.
        if (!controlKey) keyPoll = setInterval(() => { if (ensureKey()) { clearInterval(keyPoll); keyPoll = null; } }, 2000);
        console.log('[phone-bridge] listening on HTTP ' + publicServer.address().port + ' (locked until pairing), local control ' + localServer.address().port);
        return { localPort: localServer.address().port, publicPort: publicServer.address().port };
    }
    async function stop() {
        revoke();
        if (keyPoll) { clearInterval(keyPoll); keyPoll = null; }
        return Promise.all([localServer, publicServer].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
    }
    return { start, stop, status };
}

module.exports = { makeBridge, start: () => makeBridge().start(), addresses };
