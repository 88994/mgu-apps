'use strict';

// node tests/gamestation.test.js - no car, SDK, copyrighted ROMs or network needed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const {Pong} = require('../apps/mgu_gamestation/arcade');
const {NesGame} = require('../apps/mgu_gamestation/nes_core');
const {GameBoyGame} = require('../apps/mgu_gamestation/gb_core');
const {SnesGame, mask} = require('../apps/mgu_gamestation/snes_core');
const {ControllerServer, privateAddress, validRom} = require('../apps/mgu_gamestation/controller_server');

const quiet = {info() {}, warn() {}, error() {}};

function nesRom() {
    const b = Buffer.alloc(16 + 0x4000 + 0x2000);
    b.write('NES\x1a', 0, 'binary'); b[4] = 1; b[5] = 1;
    b[16] = 0x4c; b[17] = 0x00; b[18] = 0x80; // JMP $8000
    b[16 + 0x3ffc] = 0; b[16 + 0x3ffd] = 0x80;
    return b;
}
function snesRom() {
    const b = Buffer.alloc(0x8000);
    b[0] = 0x80; b[1] = 0xfe; // BRA -2 at $8000
    b.write('ORIGINAL SMOKE TEST', 0x7fc0);
    b[0x7fd5] = 0x20;
    b[0x7ffc] = 0; b[0x7ffd] = 0x80;
    return b;
}

function testCores() {
    let count = 0;
    const check = (bytes, Game, length) => {
        const g = new Game(bytes, (rgba, w, h) => {
            assert.strictEqual(rgba.length, length);
            assert.strictEqual(w * h * 4, length);
            count++;
        });
        g.tick([{a: true, start: true}, {b: true}], 1);
        g.tick([{}, {}], 1);
        g.stop();
    };
    check(nesRom(), NesGame, 256 * 240 * 4);
    const gb = Buffer.alloc(0x8000);
    gb[0x100] = 0; gb[0x143] = 0x80; // Color-capable cartridge header
    check(gb, GameBoyGame, 160 * 144 * 4);
    check(snesRom(), SnesGame, 512 * 208 * 4);
    assert.ok(count >= 5, 'expected video frames from all three console engines');
    assert.strictEqual(mask([{a: true}]), 0);
    assert.strictEqual(mask({a: true, up: true, select: true}), 0x2880);
    const pong = new Pong();
    pong.tick([{down: true}, {up: true}], 1);
    assert.ok(pong.left > 225 && pong.right < 225);
    pong.draw({roundRect() {}, fillRect() {}, text() {}, circle() {}}, 0, 0, 900, 450);
    console.log('ok: NES, GB/Color, SNES video; SNES two pads; Pong two players');
}

function testProtocol() {
    assert.ok(privateAddress('172.16.222.97'));
    assert.ok(privateAddress('192.168.12.8'));
    assert.ok(!privateAddress('8.8.8.8'));
    assert.ok(validRom('nes', 'hello.nes', nesRom()));
    assert.ok(!validRom('nes', '../hello.nes', Buffer.alloc(2048)));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestation-test-'));
    try {
        let uploads = 0;
        const server = new ControllerServer(dir, {upload: () => uploads++}, quiet);
        const response = () => ({
            status: null, body: null,
            writeHead(n) {this.status = n;}, end(b) {this.body = b;},
        });
        const forbidden = response();
        server.request({socket: {remoteAddress: '10.1.2.3'}, url: '/?t=wrong', method: 'GET'}, forbidden);
        assert.strictEqual(forbidden.status, 403);
        const req = new EventEmitter();
        req.socket = {remoteAddress: '192.168.2.5'};
        req.method = 'POST'; req.url = '/rom?t=' + server.token + '&platform=nes&name=hello.nes';
        req.headers = {'content-length': String(nesRom().length)};
        const res = response();
        server.request(req, res);
        req.emit('data', nesRom()); req.emit('end');
        assert.strictEqual(res.status, 201);
        assert.strictEqual(uploads, 1);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'roms/nes/hello.nes')).length, nesRom().length);
        assert.notStrictEqual(server.url(1), server.url(2));
        // Browser-to-BMW WebSockets must use masked frames (RFC6455).
        const pad = {closed: false, lastSeen: Date.now(), keys: {},
            buffered: Buffer.alloc(0), socket: {destroy() {throw Error('Unexpected disconnect');}, write() {}}};
        const payload = Buffer.from(JSON.stringify({type: 'buttons', keys: ['left', 'a', 'start']}));
        const key = Buffer.from([3, 7, 19, 42]);
        const wire = Buffer.alloc(2 + 4 + payload.length);
        wire[0] = 0x81; wire[1] = 0x80 | payload.length;
        key.copy(wire, 2);
        for (let i = 0; i < payload.length; i++) wire[6 + i] = payload[i] ^ key[i & 3];
        server.onData(pad, wire.slice(0, 4));
        server.onData(pad, wire.slice(4));
        assert.deepStrictEqual(Object.keys(pad.keys).sort(), ['a', 'left', 'start']);
        server.players[0] = pad;
        assert.strictEqual(server.pads()[0].a, true);
        assert.deepStrictEqual(server.pads()[1], {});
        pad.lastSeen -= 2000;
        assert.deepStrictEqual(server.pads()[0], {}, 'stale controller input releases');
    } finally {
        const game = path.join(dir, 'roms/nes/hello.nes');
        if (fs.existsSync(game)) fs.unlinkSync(game);
        const nes = path.join(dir, 'roms/nes');
        if (fs.existsSync(nes)) fs.rmdirSync(nes);
        const roms = path.join(dir, 'roms');
        if (fs.existsSync(roms)) fs.rmdirSync(roms);
        fs.rmdirSync(dir);
    }
    console.log('ok: offline controller protocol, authentication and ROM validation');
}

testCores();
testProtocol();
