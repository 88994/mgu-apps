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

    let permit = true, writes = 0;
    const ctx = { settings: { get: () => permit }, signals: {}, log: { info() {}, warn() {} } };
    const ctl = new SafeDiag(ctx, 0x37, 0xE311);
    ctl.diag.p = {};
    ctl.diag.available = true;
    ctl.diag.physical = async (_ecu, sid) => {
        if (sid === 0x22) return [0x62, 0xE3, 0x11, 0x00];
        writes++;
        return [0x6E, 0xE3, 0x11];
    };
    ctl.speed = 0;
    ctl.speedAt = Date.now();
    await ctl.read(0xE311);
    assert(ctl.verified, 'read status succeeded');
    const command = [0xE3, 0x11, 0x01, 0x01, 0x64, 0x20, 0x64, 0xFF, 0x05];
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 0, 'first press must not write');
    assert.match(ctl.info, /SEND AGAIN/);
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 1, 'explicit second press sends');
    assert(!ctl.verified, 'subsequent actions need a fresh read');
    permit = false;
    await ctl.write(command, 'custom RGB');
    assert.equal(writes, 1, 'turned off stops writes');
    console.log('OK: validated DID replies, explicit approval and Apply confirmation');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
