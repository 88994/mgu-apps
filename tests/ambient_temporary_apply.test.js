'use strict';
const assert = require('assert');
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
    if (request === './kit/diag' && parent && parent.filename.endsWith('/g21_ambient/safe_diag.js'))
        return require.resolve('../kit/runtime/diag');
    return originalResolve.call(this, request, parent, ...rest);
};
const { SafeDiag } = require('../apps/g21_ambient/safe_diag');
Module._resolveFilename = originalResolve;
const { replyTo } = require('../kit/runtime/diag');

async function run() {
    const target = [0xE3, 0x11];
    const matchRead = replyTo(0x22, target), matchWrite = replyTo(0x2E, target);
    assert(matchRead([0x62, 0xE3, 0x11, 0x20]));
    assert(matchWrite([0x6E, 0xE3, 0x11]));
    assert(!matchWrite([0x6E, 0xD0, 0x74]));
    assert(matchWrite([0x7F, 0x2E, 0x31]));

    let writes = 0;
    const ctx = { settings: { get: () => null }, signals: {}, log: { info() {}, warn() {} } };
    const ctl = new SafeDiag(ctx, 0x37, 0xE310);
    ctl.diag.p = {};
    ctl.diag.available = true;
    ctl.diag.physical = async (_ecu, sid, data) => {
        if (sid === 0x22 && data[1] === 0x11) return [0x7F, 0x22, 0x31];
        if (sid === 0x22) return [0x62, 0xE3, 0x10, 0x01];
        writes++;
        return [0x6E, 0xE3, 0x11];
    };
    ctl.speed = 0;
    ctl.speedAt = Date.now();
    await ctl.read(0xE311);
    assert(!ctl.verified, 'unsupported read E311 does not approve writes');
    await ctl.read(0xE310);
    assert(ctl.verified, 'independent LIN-active preflight succeeded');
    assert.equal(ctl.linActive, 1);
    const command = [0xE3, 0x11, 0x01, 0x01, 0x64, 0x20, 0x64, 0xFF, 0x05];
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 0, 'first press must not write');
    assert.match(ctl.info, /SEND AGAIN/);
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 1, 'explicit second press sends');
    assert(!ctl.verified, 'subsequent actions need a fresh read');
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 1, 'fresh read required for further writes');
    console.log('OK: E311 NRC31 fallback to E310, stationary double-confirmation gate');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
