'use strict';

// MGU Store grants Internet to opted-in OAP app UIDs (package.json:
// "mguInternet": true). The BMW system resolver points at 127.0.0.1, which
// does not necessarily resolve public names. yt-dlp and ffmpeg are child
// executables: patching Node's dns.lookup cannot fix their DNS lookups.
// A loopback-only authenticated CONNECT proxy resolves hostnames against the
// DNS servers in this app's own Store uplink lease, then tunnels HTTPS bytes.

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const SYSTEM_LEASE = '/run/mgu-uplink/lease.json';
const CONNECT_TIMEOUT_MS = 9000;

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function youtubeHost(host) {
    host = String(host || '').toLowerCase();
    return ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'googlevideo.com',
        'ytimg.com', 'ggpht.com', 'googleapis.com', 'googleusercontent.com',
        'gstatic.com'].some(suffix => host === suffix || host.endsWith('.' + suffix));
}

function streamHost(host) {
    host = String(host || '').toLowerCase();
    return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
}

function validDns(lease) {
    return lease && Array.isArray(lease.dns) ?
        lease.dns.filter(ip => typeof ip === 'string' && net.isIP(ip) !== 0).slice(0, 4) : [];
}

function publicIpv4(ip) {
    if (net.isIP(ip) !== 4) return false;
    const n = ip.split('.').map(Number), a = n[0], b = n[1], c = n[2];
    // Reject vehicle, LAN, carrier NAT, link-local, multicast and documentation
    // ranges even if a permitted hostname gets a forged private DNS answer.
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a < 3) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a === 160 && (b === 46 || b === 48 || b === 50)) return false; // BMW in-vehicle VLAN routes
    return true;
}

class StoreUplink {
    constructor(dataDir, log, options) {
        options = options || {};
        this.log = log || console;
        this.appLeasePath = path.join(dataDir, 'uplink.json');
        this.systemLeasePath = options.systemLease || SYSTEM_LEASE;
        this.readLease = options.readLease || readJson;
        this.resolve4 = options.resolve4 || null;
        this.publicIpv4 = options.publicIpv4 || publicIpv4;
        this.allowedPorts = options.allowedPorts || [443];
        this.credential = crypto.randomBytes(24).toString('hex');
        this.server = null;
        this.mediaServer = null;
        this.sockets = new Set();
        this.proxyUrl = null;
        this.mediaProxyUrl = null;
        this.error = '';
    }

    ownLease() {
        const lease = this.readLease(this.appLeasePath);
        return lease && typeof lease.ip === 'string' && net.isIP(lease.ip) && validDns(lease).length ? lease : null;
    }

    status() {
        if (this.ownLease()) return this.proxyUrl && this.mediaProxyUrl ?
            'ROUTED - DNS proxy ready' : 'ROUTED - proxy starting';
        const system = this.readLease(this.systemLeasePath);
        return system && system.ip ? 'Store online - app not routed' : 'Store uplink offline';
    }

    start() {
        if (this.server) return;
        const makeServer = (auth, allowed, ready) => {
            const server = http.createServer((req, res) => {
                res.writeHead(405, {'content-type':'text/plain'});
                res.end('HTTPS CONNECT only');
            });
            server.maxConnections = 12;
            server.on('connection', socket => {
                this.sockets.add(socket);
                socket.on('close', () => this.sockets.delete(socket));
            });
            server.on('connect', (req, client, head) => this._connect(req, client, head, auth, allowed));
            server.on('clientError', (_error, client) => { if (!client.destroyed) client.destroy(); });
            server.on('error', e => {
                this.error = e.message;
                this.log.warn('[VideoHub] Store uplink proxy: ' + e.message);
            });
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (address && typeof address.port === 'number') ready(address.port);
            });
            return server;
        };
        this.server = makeServer(true, youtubeHost, port => {
            this.proxyUrl = 'http://video:' + this.credential + '@127.0.0.1:' + port;
        });
        // FFmpeg's native HTTP transport does not send Proxy-Authorization even
        // when credentials are present in -http_proxy (verified with FFmpeg 7).
        // Its separate media tunnel is loopback-only, on a random port, and
        // strictly limited to HTTPS googlevideo.com CDN addresses.
        this.mediaServer = makeServer(false, streamHost, port => {
            this.mediaProxyUrl = 'http://127.0.0.1:' + port;
        });
    }

    _reject(client, code, message) {
        if (client.destroyed) return;
        const challenge = code === 407 ? 'Proxy-Authenticate: Basic realm="MGU Video Hub"\r\n' : '';
        client.end('HTTP/1.1 ' + code + ' ' + message + '\r\n' + challenge +
            'Content-Length: 0\r\nConnection: close\r\n\r\n');
    }

    _resolve(host, lease, done) {
        if (this.resolve4) return this.resolve4(host, validDns(lease), done);
        const resolver = new dns.Resolver();
        resolver.setServers(validDns(lease));
        resolver.resolve4(host, (error, list) => done(error, list && list[0]));
    }

    _connect(req, client, head, requireAuth, allowedHost) {
        const expected = 'Basic ' + Buffer.from('video:' + this.credential).toString('base64');
        if (requireAuth && req.headers['proxy-authorization'] !== expected)
            return this._reject(client, 407, 'Proxy Authentication Required');
        const lease = this.ownLease();
        if (!lease) return this._reject(client, 503, 'Uplink Not Routed');

        // Explicitly restrict what can be reached through this local proxy:
        // no arbitrary IPs, loopback, vehicle networks, or non-HTTPS ports.
        const match = /^([A-Za-z0-9.-]+):([0-9]{1,5})$/.exec(req.url || '');
        const host = match && match[1];
        const port = match ? Number(match[2]) : 0;
        if (!host || !allowedHost(host) || this.allowedPorts.indexOf(port) < 0)
            return this._reject(client, 403, 'Destination Forbidden');

        let settled = false, upstream = null;
        const timer = setTimeout(() => fail('Gateway Timeout'), CONNECT_TIMEOUT_MS);
        const fail = message => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (upstream) upstream.destroy();
            this._reject(client, 502, message);
        };
        client.on('error', () => { if (upstream) upstream.destroy(); });
        client.on('close', () => { if (upstream) upstream.destroy(); });

        try {
            this._resolve(host, lease, (error, address) => {
                if (settled) return;
                if (error || !this.publicIpv4(address)) return fail('DNS Lookup Failed');
                upstream = net.connect({host:address, port}, () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head && head.length) upstream.write(head);
                    upstream.pipe(client);
                    client.pipe(upstream);
                });
                upstream.on('error', () => {
                    if (!settled) fail('Connection Failed');
                    else client.destroy();
                });
            });
        } catch (_) { fail('DNS Lookup Failed'); }
    }

    stop() {
        this.proxyUrl = null;
        this.mediaProxyUrl = null;
        this.sockets.forEach(socket => socket.destroy());
        if (this.server) this.server.close();
        if (this.mediaServer) this.mediaServer.close();
        this.server = null;
        this.mediaServer = null;
    }
}

module.exports = { StoreUplink, youtubeHost, streamHost, validDns, publicIpv4 };
