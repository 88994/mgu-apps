'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const BASE = path.resolve(__dirname, '..');
const A = require('../apps/g21_ambient/logic');
const B = require('../apps/g21_wheelheat/logic');
const { ComfortAuto } = require('../apps/g21_wheelheat/comfort_auto');

test('RAM01 E311: order, bounds and all-module address', () => {
    assert.deepEqual(A.encode({ id: 0, on: 1, brightness: 100, red: 254,
        green: 0, blue: 45, seconds: 254 }), [0xE3, 0x11, 0, 1, 100, 254, 0, 45, 254]);
    assert.deepEqual(A.fromPreset(A.COLORS[5], 1, 100, 5), [0xE3, 0x11, 1, 0, 0, 0, 0, 0, 5]);
    for (const bad of [255, -1, 1.1, NaN]) {
        assert.throws(() => A.encode({ id: bad, on: 1, brightness: 50, red: 1,
            green: 1, blue: 1, seconds: 5 }), RangeError);
    }
    assert.throws(() => A.encode({ id: 1, on: 1, brightness: 101, red: 1,
        green: 1, blue: 1, seconds: 5 }), RangeError);
    assert.throws(() => A.encode({ id: 1, on: 1, brightness: 10, red: 255,
        green: 1, blue: 1, seconds: 5 }), RangeError);
});

test('RAM01 Colorpicker: HSV, limits, grid hit and payload', () => {
    assert.deepEqual(A.hsvToRgb(0, 100), [254, 0, 0]);
    assert.deepEqual(A.hsvToRgb(120, 100), [0, 254, 0]);
    assert.deepEqual(A.hsvToRgb(240, 100), [0, 0, 254]);
    assert.deepEqual(A.hsvToRgb(0, 0), [254, 254, 254]);
    assert.deepEqual(A.pickerCell(48, 130, 48, 130, 452, 154), { hue: 0, saturation: 100 });
    assert.deepEqual(A.pickerCell(499, 283, 48, 130, 452, 154), { hue: 345, saturation: 0 });
    assert.equal(A.pickerCell(500, 130, 48, 130, 452, 154), null);
    assert.throws(() => A.hsvToRgb(360, 100), RangeError);
    assert.throws(() => A.hsvToRgb(0, 101), RangeError);
    const red = A.chooseColor('custom', 0, 0, 100);
    assert.deepEqual(A.fromPreset(red, 1, 50, 5), [0xE3, 0x11, 1, 1, 50, 254, 0, 0, 5]);
    assert.equal(A.chooseColor('preset', 5, 0, 100).on, 0);
});

test('Ambient slot 11: original mapping, one RGB color, no guessed FDL index', () => {
    assert.equal(A.ORIGINAL_PROFILES.length, 22);
    assert.equal(A.SLOT11_PROFILE_OFFSET, 20);
    assert.deepEqual(A.ORIGINAL_PROFILES.slice(18, 20), [5, 5],
        'slot 10 remains lilac/lilac');
    const draft = A.slot11Plan([178, 102, 224]);
    assert.deepEqual(draft.oldProfile, [5, 0]);
    assert.deepEqual(draft.desiredRGB, [178, 102, 224]);
    assert.equal(draft.newProfile, null, 'never invent a free color index');
    assert.deepEqual(A.slot11RestorePlan().profile, [5, 0]);
    assert.deepEqual(A.slot11RestorePlan().factoryLilacRGB, [120, 60, 254]);
    assert.throws(() => A.slot11Plan([255, 0, 0]), RangeError);
    const nearest = A.rgbToGrid([254, 127, 0]);
    assert.equal(nearest.hue, 30);
    assert.equal(nearest.saturation, 100);
    assert.deepEqual(nearest.rgb, [254, 127, 0]);
    assert.equal(nearest.distanceSq, 0);
    const offGrid = [193, 79, 157];
    const match = A.rgbToGrid(offGrid);
    const expected = Math.min(...A.HUES.flatMap(hue => A.SATURATIONS.map(sat =>
        A.hsvToRgb(hue, sat).reduce((sum, n, i) => sum + (n - offGrid[i]) ** 2, 0))));
    assert.equal(match.distanceSq, expected, 'nearest of all 264 visible grid colors');
    assert.deepEqual(A.exactColor(offGrid).rgb, offGrid, 'precise RGB never gets quantized');
});

test('BDC D074/D071: precise 2E byte payloads and bounds', () => {
    assert.deepEqual(B.heating(0), [0xD0, 0x74, 0]);
    assert.deepEqual(B.heating(255), [0xD0, 0x74, 255]);
    assert.deepEqual(B.led(1), [0xD0, 0x71, 1]);
    assert.throws(() => B.heating(256), RangeError);
    assert.throws(() => B.led(2), RangeError);
    assert.deepEqual(B.seat('driver', 3, 240), [0xE4, 0x32, 3, 240]);
    assert.deepEqual(B.seat('passenger', 0, 0), [0xE4, 0x30, 0, 0]);
    assert.throws(() => B.seat('driver', 4, 60), RangeError);
    assert.throws(() => B.seat('rear', 1, 60), RangeError);
    assert.equal(B.exteriorTemp(80), 0);
    assert.equal(B.exteriorTemp(96), 8);
    assert.equal(B.exteriorTemp(255), null);
});

test('Temperature test source: selectable, bounded and independent of real sensor', () => {
    assert.deepEqual(B.temperatureInput(15, 100, false, -5, 200),
        { value: 15, at: 100, source: 'MGU' });
    assert.deepEqual(B.temperatureInput(null, 0, true, -5, 200),
        { value: -5, at: 200, source: 'SIMULATION' });
    assert.deepEqual(B.temperatureInput(15, 100, true, -55, 200),
        { value: null, at: 0, source: 'INVALID TEST VALUE' });
});

test('0.4.1 manifest: manually metadata, independent manual and auto heating settings', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(BASE, 'apps/g21_wheelheat/app.json'), 'utf8'));
    const settings = Object.fromEntries(spec.settings.map(x => [x.key, x]));
    assert.equal(spec.version, '0.4.1');
    assert.equal(spec.mguAppStartType, 'manually');
    assert.equal(settings.engineeringWrites.default, false, 'boot may never enable writes');
    assert.equal(settings.autoEnabled.default, false, 'boot preview is opt-in');
    assert.deepEqual(settings.manualSeconds.steps, B.TIMES);
    assert.equal(settings.manualSeconds.default, 60);
    assert.equal(settings.wheelMins.default, 3);
    assert.equal(settings.simTempEnabled.default, false);
    assert.ok(settings.simTempC.steps.includes(-5));
    assert.ok(settings.simTempC.steps.includes(15));
});

const cfg = { autoEnabled: true, belowTemp: 8, wheelAuto: true, wheelMins: 3,
    seatDriver: true, seatPassenger: false, seatLevel: 3, seatMins: 4 };
const frame = (auto, now, tempC, overrides, tempAt = now) => auto.step({now, tempC, tempAt, cfg: {...cfg, ...overrides} });

test('Comfort auto: temp threshold, 15s dwell, independent ON and OFF intents', () => {
    const a = new ComfortAuto();
    const t = 100000;
    assert.deepEqual(frame(a, t, 9), []);
    assert.deepEqual(frame(a, t + 1000, 5), []);
    assert.deepEqual(frame(a, t + 14000, 5), []);
    const on = frame(a, t + 16000, 5);
    assert.deepEqual(on.map(x => [x.type,x.device]), [['ON','Steering wheel'],['ON','Driver seat']]);
    assert.deepEqual(B.heating(on[0].data.seconds), [0xD0,0x74,180]);
    assert.deepEqual(B.seat(on[1].data.side,on[1].data.level,240), [0xE4,0x32,3,240]);
    assert.equal(a.remaining('Steering wheel', t + 16000), 180);
    assert.deepEqual(frame(a, t + 196000, 5).map(x=>[x.type,x.device]), [['OFF','Steering wheel']]);
    assert.deepEqual(frame(a, t + 256000, 5).map(x=>[x.type,x.device]), [['OFF','Driver seat']]);
    assert.deepEqual(frame(a, t + 300000, 5), [], 'one cycle only, no repeated activation');
});

test('Comfort auto: missing/stale temperature never activates', () => {
    const a = new ComfortAuto();
    assert.deepEqual(frame(a, 130000, null), []);
    assert.deepEqual(frame(a, 250000, 0, {}, 10000), []);
    assert.deepEqual(frame(a, 260000, 0), []);
    assert.deepEqual(frame(a, 270000, 12), []);
    assert.deepEqual(frame(a, 280000, 4), []);
    assert.equal(a.fired, false);
});

test('Comfort auto: stable temperature duration can be set to zero or one minute', () => {
    const immediate = new ComfortAuto();
    assert.equal(frame(immediate, 1000, 0, {coldDwell: 0}).length, 2);
    const slow = new ComfortAuto();
    assert.equal(frame(slow, 1000, 0, {coldDwell: 60}).length, 0);
    assert.equal(frame(slow, 60000, 0, {coldDwell: 60}).length, 0);
    assert.equal(frame(slow, 61000, 0, {coldDwell: 60}).length, 2);
});

test('Comfort auto: driver + passenger independently configurable, disable stops session', () => {
    const a = new ComfortAuto();
    const opts = { seatPassenger: true, seatDriver: false, wheelAuto: false, seatLevel: 1, seatMins: 2 };
    frame(a, 500000, 0, opts);
    const on = frame(a, 516000, 0, opts);
    assert.deepEqual(on.map(x => x.device), ['Passenger seat']);
    assert.deepEqual(B.seat(on[0].data.side,on[0].data.level,120), [0xE4,0x30,1,120]);
    const off = frame(a, 526000, 0, { ...opts, autoEnabled: false });
    assert.deepEqual(off.map(x => [x.type,x.device]), [['OFF','Passenger seat']]);
    assert.equal(a.remaining('Passenger seat', 526000), 0);
});

function fixture(kind) {
    const file = path.join(BASE, 'apps', kind, 'safe_diag.js');
    const calls = [];
    let speedHandler;
    let answer = (target, sid, data) => sid === 0x22
        ? [0x62, data[0], data[1], 0, 1, 0] : [0x6E, data[0], data[1]];
    class MockDiag {
        constructor() { this.p = true; this.available = true; }
        async init() { return this; }
        async physical(target, sid, data) { calls.push({ target, sid, data }); return answer(target, sid, data); }
    }
    const requireStub = (id) => {
        if (id !== './kit/diag') throw new Error('unbekanntes require: ' + id);
        return { Diag: MockDiag, hex: n => n.toString(16).toUpperCase().padStart(2, '0'),
            NRC: {}, replyTo: () => () => true };
    };
    const moduleStub = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: requireStub, module: moduleStub,
        Date, String, Number, Array, Promise });
    const settings = new Map([['engineeringWrites', false]]);
    const ctx = { settings: { get: (k) => settings.get(k) },
        signals: { watch: async (_a, _b, cb) => { speedHandler = cb.statusCarSpeed2; } },
        log: { info() {}, warn() {} } };
    return { safe: new moduleStub.exports.SafeDiag(ctx, kind === 'g21_ambient' ? A.ECU : B.ECU,
        kind === 'g21_ambient' ? A.DID : B.DID_HEAT), calls, settings,
        speed: (raw) => speedHandler({ speedVehicleCentreOfGravity: raw }),
        respond: (fn) => { answer = fn; } };
}

for (const kind of ['g21_ambient', 'g21_wheelheat']) {
    test(`${kind}: no writes until explicit opt-in, fresh read, stationary and second press`, async () => {
        const f = fixture(kind);
        await f.safe.init();
        const payload = kind === 'g21_ambient' ? A.fromPreset(A.COLORS[1], 1, 25, 5) : B.heating(60);
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 0, 'write disabled by default');
        f.settings.set('engineeringWrites', true);
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 0, 'status read required');
        await f.safe.read(kind === 'g21_ambient' ? A.DID : B.DID_HEAT);
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 1, 'unknown speed blocks even with read');
        f.speed(64); // 1 km/h, still blocks
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 1);
        f.speed(0);
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 1, 'first press arms only');
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 2, 'second press performs exactly one write');
        assert.equal(f.calls[1].sid, 0x2E);
        assert.deepEqual(f.calls[1].data, payload);
        await f.safe.write(payload, 'test');
        assert.equal(f.calls.length, 2, 'new read required for next write');
    });
    test(`${kind}: speed change and ECU negative reply both block writing`, async () => {
        const f = fixture(kind);
        await f.safe.init();
        f.settings.set('engineeringWrites', true);
        f.speed(0);
        const did = kind === 'g21_ambient' ? A.DID : B.DID_HEAT;
        const data = kind === 'g21_ambient' ? A.fromPreset(A.COLORS[0], 1, 50, 5) : B.heating(30);
        await f.safe.read(did);
        await f.safe.write(data, 'test');
        f.speed(640); // 10 km/h
        await f.safe.write(data, 'test');
        assert.equal(f.calls.filter(x => x.sid === 0x2E).length, 0);
        f.respond(() => [0x7F, 0x22, 0x33]);
        f.speed(0);
        await f.safe.read(did);
        await f.safe.write(data, 'test');
        assert.equal(f.calls.filter(x => x.sid === 0x2E).length, 0);
    });
}
