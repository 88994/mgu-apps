'use strict';
const assert = require('assert');
const { Writable, Transform } = require('stream');
const { EventEmitter } = require('events');
const { MusicSource, MusicPlayer, TOTAL_FRAMES, RATE } = require('../apps/equalizer/test_music');

async function sourceTest() {
    const src = new MusicSource();
    let frames = 0, peak = 0, active = 0, stereo = 0;
    await new Promise((resolve, reject) => {
        src.on('data', b => {
            assert(b.length && b.length % 4 === 0);
            frames += b.length / 4;
            for (let i = 0; i < b.length; i += 4) {
                const a = b.readInt16LE(i), c = b.readInt16LE(i + 2);
                peak = Math.max(peak, Math.abs(a), Math.abs(c));
                if (a || c) active++;
                if (a !== c) stereo++;
            }
        });
        src.on('end', resolve); src.on('error', reject);
    });
    assert.strictEqual(frames, TOTAL_FRAMES);
    assert.strictEqual(frames / RATE, 32);
    assert(peak > 4000 && peak < 32768);
    assert(active > 900000 && stereo > 500000);
    console.log('PASS original test music: 32s stereo, non-silent, bounded peaks');
}
class PassThroughDsp extends Transform {
    _transform(buf, encoding, callback) { this.push(buf); callback(); }
}
async function playbackTest() {
    const states = [];
    let bytes = 0, childCalls = 0;
    const spawn = (bin, args) => {
        childCalls++;
        assert.strictEqual(bin, '/fake/aplay');
        assert.deepStrictEqual(args, ['-q', '-t', 'raw', '-f', 'S16_LE', '-c', '2', '-r', '44100']);
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = new Writable({ write(buf, enc, cb) { bytes += buf.length; cb(); } });
        child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0)));
        child.kill = () => { child.stdin.destroy(); child.emit('close', null); };
        return child;
    };
    const player = new MusicPlayer({ findAplay: () => '/fake/aplay', findFfmpeg: () => null, spawn, dspClient: { PcmFilter: PassThroughDsp },
        onState: s => states.push(s) });
    await new Promise((resolve, reject) => {
        const old = player.onState;
        player.onState = s => { old(s); if (s.status === 'finished') resolve(); if (s.status === 'error') reject(new Error(s.detail)); };
        assert.strictEqual(player.play(), true);
    });
    assert.strictEqual(childCalls, 1);
    assert.strictEqual(bytes, TOTAL_FRAMES * 4);
    assert.strictEqual(player.active, null);
    assert(states.some(s => s.status === 'playing') && states.some(s => s.status === 'finished'));
    const fail = [];
    const noAlsa = new MusicPlayer({ findAplay: () => null, findFfmpeg: () => null,
        dspClient: { PcmFilter: PassThroughDsp }, onState: s => fail.push(s) });
    assert.strictEqual(noAlsa.play(), false);
    assert.strictEqual(fail[0].status, 'error');
    assert.strictEqual(noAlsa.active, null);
    const ffmpegCalls = [];
    const fakeFfmpeg = (bin, args) => {
        ffmpegCalls.push({ bin, args });
        const child = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = new Writable({ write(buf, enc, cb) { cb(); } });
        child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0)));
        child.kill = () => child.stdin.destroy();
        return child;
    };
    const ffmpegPlayer = new MusicPlayer({ findAplay: () => null, findFfmpeg: () => '/fake/ffmpeg',
        dspClient: { PcmFilter: PassThroughDsp }, spawn: fakeFfmpeg });
    await new Promise((resolve, reject) => {
        ffmpegPlayer.onState = s => {
            if (s.status === 'finished') resolve();
            if (s.status === 'error') reject(new Error(s.detail));
        };
        assert.strictEqual(ffmpegPlayer.play(), true);
    });
    assert.strictEqual(ffmpegCalls.length, 1);
    assert.strictEqual(ffmpegCalls[0].bin, '/fake/ffmpeg');
    assert.deepStrictEqual(ffmpegCalls[0].args, ['-hide_banner', '-nostdin', '-loglevel', 'error',
        '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0', '-f', 'alsa', 'default']);
    console.log('PASS test music aplay and ffmpeg fallback, missing player, mock playback');
}
sourceTest().then(playbackTest).catch(e => { console.error(e.stack); process.exitCode = 1; });
