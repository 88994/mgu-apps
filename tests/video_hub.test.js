'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const media = require('../apps/mgu_video_hub/media');
const v = require('../apps/mgu_video_hub/video_bridge');
const { Companion } = require('../apps/mgu_video_hub/companion');
const { probeVideoHub } = require('../native/video-net/server');

function checkIds() {
    const id = 'dQw4w9WgXcQ';
    for (const s of [id, 'https://youtu.be/' + id, 'https://www.youtube.com/watch?v=' + id,
        'https://m.youtube.com/shorts/' + id, 'https://www.youtube-nocookie.com/embed/' + id])
        assert.strictEqual(media.youtubeId(s), id);
    for (const s of ['http://youtu.be/' + id, 'https://evil.youtube.com/watch?v=' + id,
        'file:///etc/passwd', 'https://youtube.com/playlist?list=123', 'https://youtube.com/watch?v=abc'])
        assert.strictEqual(media.youtubeId(s), null);
    assert.strictEqual(media.safeName('../strange/x?.mp4'), 'x_.mp4');
}
function checkProtocol() {
    const h = v.frameHeader(640, 360, 17, 2);
    assert.strictEqual(h.length, 64);
    assert.strictEqual(h.readUInt32LE(0), v.MAGIC);
    assert.strictEqual(h.readUInt32LE(24), 3);
    assert.strictEqual(h.readUInt32LE(28), 1);
    const writes = [];
    assert.strictEqual(v.rendererRegister({native:true, ready:true, info:{video:true},
        _write: b => {writes.push(b); return true;}}, '/dev/shm/mgu-video-test', 73), true);
    assert.strictEqual(writes[0].readUInt32LE(0), 13);
    assert.strictEqual(writes[0].readUInt32LE(8), 73);
    assert.strictEqual(v.rendererRegister({native:false, ready:true}, '/dev/shm/mgu-video-x', 73), false);
    const r = {n:0, u:new Uint32Array(16), f:null, _grow() {}};
    r.f = new Float32Array(r.u.buffer);
    v.videoOp(r, 73, 10, 11, 200, 120, 8);
    assert.strictEqual(r.n, 7);
    assert.strictEqual(r.u[0], 19); assert.strictEqual(r.u[6], 73);
    assert.strictEqual(r.f[3], 200);
}
function checkScan(dir) {
    fs.mkdirSync(path.join(dir, 'videos'));
    fs.writeFileSync(path.join(dir, 'videos', 'One.mp4'), 'abc');
    fs.writeFileSync(path.join(dir, 'videos', 'Readme.txt'), 'abc');
    fs.symlinkSync('/etc/passwd', path.join(dir, 'videos', 'bad.mkv'));
    const scanned = media.scan(dir, []);
    assert.strictEqual(scanned.length, 1);
    assert.strictEqual(scanned[0].name, 'One.mp4');
}
function req(method, port, target, body, headers) {
    return new Promise((resolve, reject) => {
        const r = http.request({host:'127.0.0.1', port, path:target, method,
            headers:headers || {}}, res => {
            let s = '';
            res.on('data', b => {s += b;});
            res.on('end', () => resolve({code:res.statusCode, data:s}));
        });
        r.on('error', reject);
        r.end(body);
    });
}
async function checkCompanion(dir) {
    const added = [];
    const c = new Companion(dir, {youtube:id => added.push(id), fileCount:() => 0, linkCount:() => added.length});
    c.start();
    await new Promise(resolve => c.http.once('listening', resolve));
    assert.strictEqual(c.listening, true, 'QR must not become ready before HTTP listen succeeds');
    const port = c.http.address().port;
    let r = await req('GET', port, '/.mgu-video-health');
    assert.strictEqual(r.code, 200, 'loopback-only root network health check');
    assert.strictEqual(await probeVideoHub(port), true, 'root helper recognizes the real companion');
    r = await req('GET', port, '/status?t=wrong');
    assert.strictEqual(r.code, 403);
    const token = c.token;
    r = await req('POST', port, '/youtube?t='+token,
        JSON.stringify({url:'https://youtu.be/dQw4w9WgXcQ'}), {'content-type':'application/json'});
    assert.strictEqual(r.code, 201);
    assert.deepStrictEqual(added, ['dQw4w9WgXcQ']);
    const buf = Buffer.from('fake mp4 data');
    r = await req('POST', port, '/upload?t='+token, buf,
        {'x-filename':encodeURIComponent('Test.mp4'), 'content-length':buf.length});
    assert.strictEqual(r.code, 201, r.data);
    assert.strictEqual(fs.readFileSync(path.join(dir,'videos','Test.mp4'),'utf8'), buf.toString());
    r = await req('POST', port, '/upload?t='+token, buf,
        {'x-filename':encodeURIComponent('Test.mp4'), 'content-length':buf.length});
    assert.strictEqual(r.code, 409);
    assert.strictEqual(fs.readFileSync(path.join(dir,'videos','Test.mp4'),'utf8'), buf.toString(),
        'duplicate import must preserve original file');
    await new Promise(resolve => c.http.close(resolve));
    c.listening = false;
    assert.strictEqual(await probeVideoHub(port), false, 'root helper detects companion shutdown');
}
async function checkVideo(dir) {
    const ffmpeg = v.executable('ffmpeg');
    if (!ffmpeg) { console.log('Skipping decoder integration: ffmpeg missing'); return; }
    const movie = path.join(dir, 'test.mp4');
    cp.execFileSync(ffmpeg, ['-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=15',
        '-t','0.7','-c:v','mpeg4','-y', movie]);
    const p = new v.VideoBridge(console, {ffmpeg, resolver:null, aplay:null});
    p.start({type:'local', path:movie, name:'test'}, 0, 640, 'off');
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.ok(p.frames > 0, 'decoded frames reach shared memory');
    const h = fs.readFileSync(p.path).slice(0, 64);
    assert.strictEqual(h.readUInt32LE(16), p.frames);
    assert.strictEqual(h.readUInt32LE(8), 640);
    assert.strictEqual(h.readUInt32LE(12), 360);
    p.dispose();
    assert.strictEqual(fs.existsSync(p.path), false);
}
async function run() {
    checkIds(); checkProtocol();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vhub-'));
    try {
        checkScan(dir); await checkCompanion(dir); await checkVideo(dir);
    } finally {
        for (const n of ['test.mp4']) {try{fs.unlinkSync(path.join(dir,n));}catch(_){}}
        for (const n of ['One.mp4','Readme.txt','bad.mkv','Test.mp4']) {try{fs.unlinkSync(path.join(dir,'videos',n));}catch(_){}}
        try{fs.rmdirSync(path.join(dir,'videos'));}catch(_){}
        try{fs.rmdirSync(dir);}catch(_){}
    }
    console.log('Video Hub tests passed');
}
run().catch(e => {console.error(e); process.exitCode=1;});
