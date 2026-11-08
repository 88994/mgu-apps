'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Core = require('../native/equalizer-dsp/core');
const { Service } = require('../native/equalizer-dsp/server');
const { PcmFilter, request } = require('../kit/runtime/dsp-client');
function remove(p) {
    if (fs.statSync(p).isDirectory()) { fs.readdirSync(p).forEach((n) => remove(path.join(p, n))); fs.rmdirSync(p); }
    else fs.unlinkSync(p);
}
async function main() {
    for (const dir of ['apps/equalizer', 'native/equalizer-dsp']) {
        fs.readdirSync(path.join(__dirname, '..', dir)).filter((s) => /\.js$/.test(s)).forEach((n) => cp.execFileSync(process.execPath, ['--check', path.join(__dirname, '..', dir, n)]));
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-node8-')), runtime = path.join(root, 'run');
    const service = new Service({ runtime, stateFile: path.join(root, 'state.json') });
    try {
        await service.start();
        const config = Core.defaults(); config.enabled = true; config.autoHeadroom = false; config.bands[3].gainDb = 6;
        const status = await request({ op: 'set', config, expectedRevision: 0 }, { runtime }); assert.equal(status.revision, 1);
        const input = Buffer.alloc(48000 * 4);
        for (let i = 0; i < 48000; i++) {
            const v = Math.round(Math.sin(2 * Math.PI * 1000 * i / 48000) * 3000);
            input.writeInt16LE(v, i * 4); input.writeInt16LE(0, i * 4 + 2);
        }
        const filter = new PcmFilter({ runtime, sampleRate: 48000, channels: 2 }), out = [];
        const done = new Promise((resolve, reject) => { filter.on('data', (b) => out.push(b)); filter.on('end', resolve); filter.on('error', reject); });
        filter.end(input); await done;
        const output = Buffer.concat(out); assert.equal(output.length, input.length);
        let x = 0, y = 0;
        for (let i = 24000; i < 48000; i++) { x += Math.pow(input.readInt16LE(i * 4), 2); y += Math.pow(output.readInt16LE(i * 4), 2); assert.equal(output.readInt16LE(i * 4 + 2), 0); }
        assert(Math.abs(10 * Math.log10(y / x) - 6) < 0.04);
        console.log('PASS Node ' + process.version + ': syntax, native Unix sockets, live 7-band PCM filtering, revision RPC and stereo isolation');
    } finally { await service.stop(); remove(root); }
}
main().catch((e) => { console.error(e.stack); process.exit(1); });
