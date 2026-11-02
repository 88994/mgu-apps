'use strict';
// Offline regression test; does not contact a vehicle or require the BMW SDK.
const assert = require('assert');
const { DidReader } = require('../kit/runtime/dids');
const { ECU, READINGS } = require('../apps/dpf_monitor/dpf-dids');

const fixtures = {
    soot: { did: '44BE', raw: 1200, expected: 18.310824 },
    ash: { did: '44BD', raw: 4000, expected: 61.03608 },
    pressure: { did: '44ED', raw: 22500, expected: 29.984075 },
    temperature: { did: '4502', raw: 11000, expected: 294.09089 },
    distance: { did: '44BF', raw: 287000, expected: 287 },
    regens: { did: '44B8', raw: 180, expected: 180 },
    interval: { did: '44C7', raw: 500, expected: 500 },
    request: { did: '44BB', raw: 1, expected: 1 },
};

let calls = 0;
const diag = {
    async physical(target, sid, data) {
        assert.strictEqual(target, 0x12, 'physical DDE target');
        assert.strictEqual(sid, 0x22, 'only UDS ReadDataByIdentifier is permitted');
        const did = data.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
        const reading = READINGS.find((r) => r.request.did === did);
        assert(reading, 'DID is allowlisted');
        const raw = fixtures[reading.name].raw;
        const count = reading.request.bytes;
        const payload = Array.from({ length: count }, (_, n) =>
            Math.floor(raw / Math.pow(256, count - n - 1)) % 256);
        calls++;
        return [0x62].concat(data, payload);
    },
};

(async () => {
    assert.strictEqual(READINGS.length, 8);
    assert.strictEqual(ECU, 0x12);
    const reader = new DidReader(diag, { ecu: ECU });
    for (const field of READINGS) {
        const fixture = fixtures[field.name];
        assert(fixture, 'fixture for ' + field.name);
        assert.strictEqual(field.request.did, fixture.did);
        const value = await reader.read(field.request);
        assert(value !== null, 'valid reading for ' + field.name);
        assert(Math.abs(value - fixture.expected) < 1e-6,
            field.name + ': expected ' + fixture.expected + ', got ' + value);
    }
    assert.strictEqual(calls, 8);
    process.stdout.write('PASS: 8 DPF DIDs, conversions, ECU target, and UDS 0x22-only requests\n');
})().catch((err) => {
    process.stderr.write(String(err.stack || err) + '\n');
    process.exitCode = 1;
});
