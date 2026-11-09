'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { StoreUplink, youtubeHost, streamHost, validDns, publicIpv4 } = require('../apps/mgu_video_hub/uplink');

function listening(server) {
    return new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
}

function connect(port, authority, auth, expected, payload) {
    return new Promise((resolve, reject) => {
        let result = '', sent = false;
        const socket = net.connect({host:'127.0.0.1', port}, () => {
            socket.write('CONNECT ' + authority + ' HTTP/1.1\r\nHost: ' + authority + '\r\n' +
                (auth ? 'Proxy-Authorization: Basic ' + auth + '\r\n' : '') + '\r\n');
        });
        const timeout = setTimeout(() => { socket.destroy(); reject(Error('Proxy test timeout: ' + result)); }, 1500);
        const finish = () => {
            clearTimeout(timeout); socket.destroy();
            try { assert.ok(result.indexOf(expected) >= 0, result); resolve(result); }
            catch (error) { reject(error); }
        };
        socket.on('data', part => {
            result += part.toString('utf8');
            if (payload && result.indexOf('200 Connection Established') >= 0 && !sent) {
                sent = true;
                socket.write(payload);
            }
            if (result.indexOf(expected) >= 0) finish();
        });
        socket.on('error', reject);
        socket.on('end', () => { if (!result.includes(expected)) finish(); });
    });
}

async function run() {
    assert.ok(youtubeHost('r5---sn-a5.googlevideo.com'));
    assert.ok(youtubeHost('www.youtube.com'));
    assert.ok(youtubeHost('youtubei.googleapis.com'));
    assert.ok(!youtubeHost('youtube.com.bad.example'));
    assert.ok(!youtubeHost('localhost'));
    assert.ok(streamHost('r5---sn-a5.googlevideo.com'));
    assert.ok(!streamHost('www.youtube.com'));
    for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '172.16.222.97',
        '192.168.0.1', '100.100.0.1', '160.48.199.225', '224.0.0.1'])
        assert.ok(!publicIpv4(ip), ip);
    assert.ok(publicIpv4('142.250.73.14'));
    assert.deepStrictEqual(validDns({dns:['1.1.1.1','invalid','8.8.8.8']}), ['1.1.1.1','8.8.8.8']);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vhub-uplink-'));
    const system = path.join(dir, 'system-lease.json');
    const upstream = net.createServer(socket => socket.on('data', data => socket.write(data)));
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const target = upstream.address().port;
    const proxy = new StoreUplink(dir, {warn() {}}, {
        systemLease:system, allowedPorts:[target], publicIpv4:() => true,
        resolve4: (_host, servers, done) => {
            assert.deepStrictEqual(servers, ['1.1.1.1']);
            done(null, '127.0.0.1');
        },
    });
    proxy.start();
    await listening(proxy.server);
    await listening(proxy.mediaServer);
    const port = proxy.server.address().port;
    const mediaPort = proxy.mediaServer.address().port;
    const auth = Buffer.from('video:' + proxy.credential).toString('base64');
    try {
        assert.strictEqual(proxy.status(), 'Store uplink offline');
        fs.writeFileSync(system, JSON.stringify({ip:'192.0.2.12', dns:['1.1.1.1']}));
        assert.strictEqual(proxy.status(), 'Store online - app not routed');
        await connect(port, 'www.youtube.com:' + target, auth, '503 Uplink Not Routed');

        fs.writeFileSync(path.join(dir, 'uplink.json'), JSON.stringify({ip:'192.0.2.13', dns:['1.1.1.1']}));
        assert.strictEqual(proxy.status(), 'ROUTED - DNS proxy ready');
        await connect(port, 'www.youtube.com:' + target, null, '407 Proxy Authentication Required');
        await connect(port, 'localhost:' + target, auth, '403 Destination Forbidden');
        await connect(port, 'www.youtube.com:80', auth, '403 Destination Forbidden');
        await connect(port, 'www.youtube.com:' + target, auth, 'PING', 'PING');
        await connect(mediaPort, 'www.youtube.com:' + target, null, '403 Destination Forbidden');
        await connect(mediaPort, 'r5---sn-a5.googlevideo.com:' + target, null, 'PONG', 'PONG');
    } finally {
        proxy.stop();
        await new Promise(resolve => upstream.close(resolve));
        for (const file of ['system-lease.json', 'uplink.json']) {
            try { fs.unlinkSync(path.join(dir, file)); } catch (_) {}
        }
        fs.rmdirSync(dir);
    }
    console.log('Video Hub Store uplink tests passed: own lease, DNS proxy, auth and destination isolation');
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
