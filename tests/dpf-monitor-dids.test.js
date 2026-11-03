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
    pressureFiltered: { did: '44FA', raw: 22500, expected: 29.984075 },
    sootMeasured: { did: '44AC', raw: 100, expected: 10 },
    sootModel: { did: '44C1', raw: 1200, expected: 12 },
    regenOdo1: { did: '44D1', raw: 92700000, expected: 92700 },
    regenOdo2: { did: '44D2', raw: 92000000, expected: 92000 },
    regenOdo3: { did: '44D3', raw: 91400000, expected: 91400 },
    regenOdo4: { did: '44D4', raw: 90800000, expected: 90800 },
    regenOdo5: { did: '44D5', raw: 90100000, expected: 90100 },
    regenCount: { did: '44B8', raw: 180, expected: 180 },
    regenAverage: { did: '44C7', raw: 500, expected: 500 },
    regenHours: { did: '44B7', raw: 7200, expected: 2 },
    regenRequestCode: { did: '44BB', raw: 1, expected: 1 },
    regenInhibitCode: { did: '44C2', raw: 0, expected: 0 },
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
    assert.strictEqual(READINGS.length, 18);
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
    assert.strictEqual(calls, 18);
    process.stdout.write('PASS: 18 DPF DIDs, conversions, ECU target, and UDS 0x22-only requests\n');
})().catch((err) => {
    process.stderr.write(String(err.stack || err) + '\n');
    process.exitCode = 1;
});
