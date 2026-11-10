'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
    if (request === './kit/diag' && parent && parent.filename.endsWith('/g21_ambient/bdc_lin.js'))
        return require.resolve('../kit/runtime/diag');
    return originalResolve.call(this, request, parent, ...rest);
};
const { BdcLin, BUSES, parseBus, writeFrame } = require('../apps/g21_ambient/bdc_lin');
Module._resolveFilename = originalResolve;
const { AmbientProfiles, modeFromSignal, cleanSnapshot } = require('../apps/g21_ambient/ambient_profiles');

const moduleOf = (bus, location, rgb) => {
    const bytes = Array(3 + 26 * 10).fill(0xFF);
    bytes[0] = 0x62; bytes[1] = BUSES[bus].read[0]; bytes[2] = BUSES[bus].read[1];
    const r = 3;
    bytes[r] = location; bytes[r + 1] = rgb[2]; bytes[r + 2] = rgb[1];
    bytes[r + 3] = rgb[0]; bytes[r + 4] = 75;
    for (let k = 5; k < 10; k++) bytes[r + k] = 0;
    return bytes;
};
test('BDC LIN parser discovers only positively identified 26-record buses', () => {
    const first = parseBus(0, moduleOf(0, 5, [22, 66, 99]));
    assert.equal(first.length, 1);
    assert.equal(first[0].name, 'Driver door line');
    assert.deepEqual(first[0].rgb, [22, 66, 99]);
    assert.equal(first[0].key, '0:1');
    assert.equal(parseBus(0, moduleOf(1, 5, [22, 66, 99])), null);
    assert.equal(parseBus(1, [0x7F, 0x22, 0x31]), null);
    assert.equal(parseBus(0, moduleOf(0, 5, [0, 0, 0]).slice(0, -1)), null);
});

test('BDC frames are bounded, module-addressed, and never silently broadcast', () => {
    const device = { bus: 1, nad: 3 };
    assert.deepEqual(writeFrame(device, [255, 15, 0], 200, 500, false),
        [0xE3, 0xD1, 3, 1, 100, 254, 15, 0, 254]);
    assert.deepEqual(writeFrame(device, null, 0, 0, true),
        [0xE3, 0xD1, 3, 0, 0, 0, 0, 0, 0]);
    assert.throws(() => writeFrame({bus: 0, nad: 0}, [255, 0, 0], 30, 5), RangeError);
});

test('saved favourite contains all zone modes and survives settings reload', () => {
    let stored = {};
    const settings = { get(k) { return stored[k]; }, set(k, v) { stored[k] = v; } };
    const scene = new AmbientProfiles(settings);
    const module = { key: '0:1' };
    scene.setZone(module, 'own', [11, 22, 33], 55);
    scene.saveFavorite(2, scene.snapshot([100, 101, 102], 80));
    scene.saveMode('sport', scene.snapshot([100, 101, 102], 80));
    const loaded = new AmbientProfiles(settings);
    assert.deepEqual(loaded.loadFavorite(2).zones['0:1'],
        { mode: 'own', rgb: [11, 22, 33], brightness: 55 });
    assert.deepEqual(loaded.mode('sport').main.rgb, [100, 101, 102]);
    loaded.setZone(module, 'car');
    assert.equal(loaded.zone(module).mode, 'car');
    loaded.clearFavorite(2);
    assert.equal(new AmbientProfiles(settings).loadFavorite(2), null);
    assert.equal(cleanSnapshot({main:{rgb:[300,0,0],brightness:100}}), null);
});

test('mode parser reads both names and BMW FES numeric enum values', () => {
    assert.equal(modeFromSignal({actualValueModeDrivingExperience:'SPORT_EXPERT'}), 'sport');
    assert.equal(modeFromSignal({actualValueModeDrivingExperience:7}), 'eco');
    assert.equal(modeFromSignal({actualValueModeDrivingExperience:'COMFORT'}), 'comfort');
    assert.equal(modeFromSignal({actualValueModeDrivingExperience:'ADAPTIVE'}), 'adaptive');
    assert.equal(modeFromSignal({actualValueModeDrivingExperience:'UNKNOWN'}), null);
});

test('BDC never writes before scan, stationary confirmation and second press', async () => {
    const events = [], log = { info(v) { events.push(v); }, warn() {} };
    let writes = 0;
    const ram = { online: true, parked: false,
        diag: { physical: async (ecu, sid, data) => {
            assert.equal(ecu, 0x40);
            if (sid === 0x22) return moduleOf(data[0] === 0xDA ? 0 : 1, 5, [25, 50, 75]);
            writes++;
            return [0x6E, data[0], data[1]];
        } },
    };
    const ctl = new BdcLin({ log }, ram);
    const sample = { main: { rgb: [10, 20, 30], brightness: 60 }, zones: {} };
    await ctl.apply(sample, 5);
    assert.equal(writes, 0);
    await ctl.scan();
    assert.equal(ctl.modules.length, 2);
    await ctl.apply(sample, 5);
    assert.equal(writes, 0);
    ram.parked = true;
    await ctl.apply(sample, 5);
    assert.equal(writes, 0);
    assert.match(ctl.info, /Press APPLY again/);
    await ctl.apply(sample, 5);
    assert.equal(writes, 2);
    assert.match(ctl.lastWrite, /2\/2 BDC ACK; physical light effect UNVERIFIED/);
    await ctl.apply(sample, 5);
    assert.equal(writes, 2, 'new scan required for next BDC write');
    ram.parked = false;
    await ctl.scan();
    await ctl.apply(sample, 5);
    assert.equal(writes, 2, 'vehicle must remain parked');
});
