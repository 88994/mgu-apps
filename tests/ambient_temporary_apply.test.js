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
    const ctl = new SafeDiag(ctx, 0x37, 0xF150);
    ctl.diag.p = {};
    ctl.diag.available = true;
    ctl.diag.physical = async (_ecu, sid, data) => {
        if (sid === 0x22 && data[0] === 0xE3) return [0x7F, 0x22, 0x31];
        if (sid === 0x22) return [0x62, 0xF1, 0x50, 0x12, 0x34, 0x56];
        writes++;
        return [0x6E, 0xE3, 0x11];
    };
    ctl.speed = 0;
    ctl.speedAt = Date.now();
    await ctl.read(0xE311);
    assert(!ctl.verified, 'unsupported read E311 does not approve writes');
    await ctl.read(0xE310);
    assert(!ctl.verified, 'unsupported E310 must not approve writes');
    await ctl.read(0xF150);
    assert(!ctl.verified, 'numeric SGBD index must not be mistaken for a verified RAM01 identity');
    assert.equal(ctl.identity, '12 34 56');
    const command = [0xE3, 0x11, 0x01, 0x01, 0x64, 0x20, 0x64, 0xFE, 0x05];
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 0, 'unknown ECU variant prevents writes altogether');
    assert.match(ctl.info, /Read status first/);
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 0, 'two presses do not bypass the missing ECU verification');
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 0, 'fresh read required for further writes');
    ctl.diag.physical = async () => [0x62, 0xF1, 0x50, ...Buffer.from('OTHER_ECU')];
    await ctl.read(0xF150);
    assert(!ctl.verified, 'an unknown ECU identity must not authorize LIN writes');
    console.log('OK: E310/E311 NRC31, numeric SGBD identity shown, unmatched ECU writes blocked');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
