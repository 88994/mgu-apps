'use strict';
// Offline safety unit test. No vehicle writes are made.
const assert = require('assert');
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
    if (request === './kit/diag' && parent && parent.filename.endsWith('/g21_wheelheat/safe_diag.js'))
        return require.resolve('../kit/runtime/diag');
    return originalResolve.call(this, request, parent, ...rest);
};
const { SafeDiag } = require('../apps/g21_wheelheat/safe_diag');
Module._resolveFilename = originalResolve;

async function run() {
    let permit = false, calls = 0;
    const ctx = { settings: { get: () => permit }, signals: {}, log: { info() {}, warn() {} } };
    const ctl = new SafeDiag(ctx, 0x40, 0xD074);
    ctl.diag.p = {};
    ctl.diag.available = true;
    ctl.diag.physical = async () => { calls++; return [0x6E, 0xD0, 0x74]; };
    const data = [0xD0, 0x74, 0x3C];
    const fresh = () => { ctl.readAt = Date.now(); };
    assert.equal(await ctl.autoWrite(data, 'Heating ON'), false, 'off by default');
    assert.equal(calls, 0);
    permit = true;
    fresh();
    assert.equal(await ctl.autoWrite(data, 'Heating ON'), false, 'unknown speed blocks');
    assert.equal(calls, 0);
    ctl.speed = 0;
    ctl.speedAt = Date.now();
    fresh();
    assert.equal(await ctl.autoWrite(data, 'Heating ON'), true, 'positive BDC reply');
    assert.equal(calls, 1);
    // The read-back cache must be populated only from an actual 0x62 response,
    // and must never silently reuse the last requested 0x2E value.
    ctl.diag.physical = async (_target, service, request) => service === 0x22
        ? [0x62, request[0], request[1], 0x01, 0x7F]
        : [0x6E, request[0], request[1]];
    assert.equal(await ctl.read(0xD074), true);
    assert.deepEqual(ctl.readbacks[0xD074].payload, [0x01, 0x7F]);
    assert.equal(ctl.readbacks[0xD074].ok, true);
    ctl.diag.physical = async () => [0x7F, 0x22, 0x31];
    assert.equal(await ctl.read(0xE432), false);
    assert.match(ctl.readbacks[0xE432].error, /NRC/);
    assert.equal(await ctl.autoWrite(data, 'Heating ON'), false, 'fresh ECU read required');
    assert.equal(calls, 1);
    ctl.speed = 10;
    ctl.speedAt = Date.now();
    ctl.lastWriteAt = 0;
    fresh();
    ctl.diag.physical = async (_ecu, sid, req) => {
        if (sid === 0x2E) { calls++; return [0x6E, req[0], req[1]]; }
        return [0x62, req[0], req[1]];
    };
    assert.equal(await ctl.autoWrite(data, 'Heating ON'), true,
        'vehicle moving with fresh BDC and speed signal may auto-start');
    assert.equal(calls, 2);
    ctl.speedAt = Date.now() - 10000;
    ctl.lastWriteAt = 0;
    fresh();
    assert.equal(await ctl.autoWrite(data, 'Heating ON'), false,
        'stale vehicle-speed signal blocks moving writes');
    assert.equal(calls, 2);
    console.log('OK: automatic moving writes require consent, live speed and fresh BDC read');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
