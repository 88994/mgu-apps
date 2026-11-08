'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const { PassThrough, Transform, Writable } = require('stream');
const cp = require('child_process');
const Core = require('../native/equalizer-dsp/core');
const { VideoBridge } = require('../apps/mgu_video_hub/video_bridge');
async function main() {
    const config = Core.defaults(); config.enabled = true; config.autoHeadroom = false; config.bands[3].gainDb = 6;
    class TestFilter extends Transform {
        constructor() { super(); this.processor = new Core.Processor(44100, 2, config); }
        _transform(b, enc, cb) { for (let i = 0; i < b.length; i += 4096) this.push(this.processor.process(b.slice(i, i + 4096))); cb(); }
    }
    const children = [], chunks = [], original = cp.spawn;
    const finish = {};
    const done = new Promise((resolve) => { finish.resolve = resolve; });
    cp.spawn = () => {
        const p = new EventEmitter(); p.kill = () => {}; p.stdout = new PassThrough();
        p.stdin = new Writable({ write(b, enc, cb) { chunks.push(Buffer.from(b)); cb(); } });
        p.stdin.on('finish', () => finish.resolve()); children.push(p); return p;
    };
    const bridge = new VideoBridge({ warn() {} }, { ffmpeg: '/test/ffmpeg', aplay: '/test/aplay', resolver: null, dspClient: { PcmFilter: TestFilter } });
    try {
        bridge._startAudio('/test/audio.mp4', 0);
        assert(bridge.audioFilter, 'DSP must be physically in the stream pipeline');
        const input = Buffer.alloc(44100 * 4);
        for (let i = 0; i < 44100; i++) { input.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 1000 * i / 44100)), i * 4); input.writeInt16LE(0, i * 4 + 2); }
        children[0].stdout.end(input); await done;
        const output = Buffer.concat(chunks); assert.equal(output.length, input.length);
        let x = 0, y = 0;
        for (let i = 22050; i < 44100; i++) { x += Math.pow(input.readInt16LE(i * 4), 2); y += Math.pow(output.readInt16LE(i * 4), 2); }
        assert(Math.abs(10 * Math.log10(y / x) - 6) < 0.04);
        bridge._stopAudio(); assert.equal(bridge.audioFilter, null); assert.equal(bridge.audioDec, null); assert.equal(bridge.audioOut, null);
        console.log('PASS Video Hub decoder -> actual DSP core -> audio sink: +6 dB measured, bytes preserved, cleanup');
    } finally { cp.spawn = original; bridge.dispose(); }
}
main().catch((e) => { console.error(e.stack); process.exit(1); });
