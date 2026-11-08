'use strict';
// Actuator-facing tests: independent PRG reference telegrams, abort ordering,
// timeouts, invalid vehicle state, persistence and recovery. No vehicle I/O.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const app = path.join(root, 'apps', 'light_show');
const P = require(path.join(app, 'protocol'));
const Guard = require(path.join(app, 'guard'));
const Journal = require(path.join(app, 'journal'));
const Engine = require(path.join(app, 'engine'));
// Test the transport as packaged, including the project's actual TASU frame
// decoder and reply correlator (build.py light_show before running this file).
const Link = require(path.join(root, 'dist', 'light_show', 'source', 'javascript', 'link'));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const cfg = { pattern: 'double', lights: 'high', tempo: 100, seconds: 5 };
const tick = () => new Promise((r) => setImmediate(r));

function rig(o) {
    o = o || {}; let clock = 10000, pending = !!o.pending;
    const calls = [], state = { block: null };
    const journal = { pending: () => pending,
        mark: (index) => { calls.push('mark'); if (o.writeFail) throw Error('disk full'); assert.strictEqual(index, P.INDEX); pending = true; },
        clear: () => { calls.push('clear'); pending = false; } };
    const link = {
        index: P.INDEX, available: true,
        identify: async () => { calls.push('identify'); if (o.badIdentity) throw Error('Unsupported BDC'); },
        session: async () => { calls.push('session'); if (o.sessionFail) throw Error('session refused'); },
        set: async (output, on) => {
            calls.push(['set', output, on]); if (o.onSet) await o.onSet(output, on, r);
            if (o.setFail) throw Error('NRC 31');
        },
        keepalive: async () => { calls.push('keepalive'); if (o.keepFail) throw Error('keepalive timed out'); },
        release: async () => { calls.push('release'); if (o.releaseFail) throw Error('release timed out'); },
        defaultSession: async () => { calls.push('default'); if (o.defaultFail) throw Error('default timed out'); },
    };
    const engine = new Engine({ link, journal, guard: { reason: () => state.block }, now: () => clock,
        sleep: async (ms) => { clock += ms; if (o.onSleep) await o.onSleep(r); }, changed: () => {}, log: { info() {}, warn() {} } });
    const r = { engine, calls, link, state, journal, advance: (ms) => { clock += ms; } }; return r;
}
function controls(r) { return r.calls.filter(Array.isArray); }

test('All 16 lamp commands and OEM release match the original PRG bytecode', () => {
    const e = require(path.join(app, 'protocol-evidence.json'));
    assert.strictEqual(e.captured.length, 17);
    for (const r of e.captured) {
        const actual = r.release ? [0x2F].concat(P.release())
            : [0x2F].concat(P.control(P.PAIRS[r.pair][/_L$/.test(r.output) ? 'left' : 'right'], r.on));
        assert.deepStrictEqual(actual, r.uds, r.output || 'OEM');
    }
    assert.deepStrictEqual(P.release(), [0xE3, 0xB5, 0, 0xFF]);
});
test('Unsupported light outputs and corrupt persisted settings are rejected', () => {
    [0xFE, 0x18, -1, 999].forEach((v) => assert.throws(() => P.control(v, 1)));
    assert.throws(() => P.control(7, 2));
    assert.throws(() => P.settings((k) => ({ pattern: 'double', lights: 'high', tempo: 1, duration: 5 })[k]));
});
test('Vehicle gate rejects missing, stale, invalid speed and N_OR_P', () => {
    let clock = 10000; const g = new Guard(() => clock);
    g.speedSub = { available: true }; g.gearSub = { available: true };
    assert(g.reason()); g.feedSpeed({ speedVehicleCentreOfGravity: 0 }); g.feedStage({ statusActualStageDrive: 1 });
    assert.strictEqual(g.reason(), null);
    g.feedSelection({ statusGearSelectionDrive: 4 }); assert(g.reason());
    g.feedSelection({ statusGearSelectionDrive: 'P' }); assert.strictEqual(g.reason(), null);
    g.feedSpeed({ speedVehicleCentreOfGravity: 64 }); assert.strictEqual(g.reason(), 'Vehicle must be stationary');
    g.feedSpeed({ speedVehicleCentreOfGravity: 65535 }); assert(g.reason());
    g.feedSpeed({ speedVehicleCentreOfGravity: 0 }); clock += 2501; assert(g.reason());
    g.feedSpeed({ speedVehicleCentreOfGravity: 0 }); g.gearSub.available = false; assert(g.reason());
});
test('Quiet gear notifications are retained while their provider stays available', () => {
    let clock = 10000; const g = new Guard(() => clock);
    g.speedSub = g.gearSub = { available: true };
    g.feedStage({ statusActualStageDrive: 'P' }); clock += 120000;
    g.feedSpeed({ speedVehicleCentreOfGravity: 0 }); assert.strictEqual(g.reason(), null);
    for (const v of ['NP', 4, 'INVALID', null]) { g.feedSelection({ statusGearSelectionDrive: v }); assert(g.reason()); }
});
test('Blocked start sends no diagnostics or actuator requests', async () => {
    const r = rig(); r.state.block = 'Select P'; await r.engine.start(cfg);
    assert.deepStrictEqual(r.calls, []); assert.strictEqual(r.engine.state, 'BLOCKED');
});
test('Unknown BDC identity sends no session or actuator requests', async () => {
    const r = rig({ badIdentity: true }); await r.engine.start(cfg);
    assert.deepStrictEqual(r.calls, ['identify']); assert.strictEqual(r.engine.state, 'ERROR');
});
test('A failed recovery journal write prevents all session and lamp changes', async () => {
    const r = rig({ writeFail: true }); await r.engine.start(cfg);
    assert.deepStrictEqual(r.calls, ['identify', 'mark']); assert.strictEqual(r.engine.state, 'ERROR');
});
test('Show completes in finite time, serializes keepalive and releases OEM before clearing journal', async () => {
    const r = rig(); await r.engine.start(cfg);
    assert(controls(r).length > 10); assert(r.calls.includes('keepalive'));
    assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
    assert.strictEqual(r.journal.pending(), false); assert.strictEqual(r.engine.releaseConfirmed, true);
});
test('Six patterns only touch the selected pair and all finish with OEM release', async () => {
    for (const pattern of Object.keys(P.PATTERNS)) for (const lights of Object.keys(P.PAIRS)) {
        const r = rig(); await r.engine.start(Object.assign({}, cfg, { pattern, lights }));
        assert(controls(r).every((v) => [P.PAIRS[lights].left, P.PAIRS[lights].right].includes(v[1])));
        assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
    }
});
test('STOP waits for the in-flight command, then releases before any new lamp command', async () => {
    let unlock, entered; const reached = new Promise((r) => { entered = r; });
    const r = rig({ onSet: () => new Promise((resolve) => { unlock = resolve; entered(); }) });
    const show = r.engine.start(cfg); await reached;
    const stopped = r.engine.stop('User stop'); await tick(); assert(!r.calls.includes('release'));
    unlock(); await stopped; await show;
    assert.strictEqual(controls(r).length, 1); assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
});
test('P loss while a command is in flight prevents another ON and still releases', async () => {
    const r = rig({ onSet: async (output, on, r) => { r.state.block = 'Select P'; } });
    await r.engine.start(cfg); assert.strictEqual(controls(r).length, 1);
    assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
});
test('Rejected lamp request is never retried and is followed by OEM release', async () => {
    const r = rig({ setFail: true }); await r.engine.start(cfg);
    assert.strictEqual(controls(r).length, 1); assert.strictEqual(r.engine.state, 'ERROR');
    assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
});
test('Session refusal still attempts release and default-session return', async () => {
    const r = rig({ sessionFail: true }); await r.engine.start(cfg);
    assert.strictEqual(controls(r).length, 0); assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
});
test('Keepalive failure stops the sequence and releases OEM', async () => {
    const r = rig({ keepFail: true }); await r.engine.start(cfg);
    assert(r.calls.includes('keepalive')); assert.strictEqual(r.engine.state, 'ERROR');
    assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
});
test('Failed release keeps recovery pending, attempts default session and does not retry forever', async () => {
    const r = rig({ releaseFail: true, onSleep: async (r) => { r.engine.stop(); } });
    await r.engine.start(cfg); assert.strictEqual(r.calls.filter((v) => v === 'release').length, 1);
    assert.strictEqual(r.journal.pending(), true); assert.strictEqual(r.engine.releaseConfirmed, false);
    assert(r.calls.includes('default')); assert.strictEqual(r.engine.state, 'ERROR');
});
test('Default-session timeout keeps the recovery marker even when OEM acknowledged', async () => {
    const r = rig({ defaultFail: true }); await r.engine.start(cfg);
    assert.strictEqual(r.journal.pending(), true); assert.strictEqual(r.engine.state, 'ERROR');
});
test('Duplicate Start does not create a second conversation', async () => {
    let unlock; const r = rig({ onSet: () => new Promise((resolve) => { unlock = resolve; }) });
    const a = r.engine.start(cfg); const b = r.engine.start(cfg); assert.strictEqual(a, b);
    await tick(); r.engine.stop(); unlock(); await a;
    assert.strictEqual(r.calls.filter((v) => v === 'session').length, 1);
});
test('A pending marker blocks Start; explicit recovery re-identifies and only releases', async () => {
    const r = rig({ pending: true }); await r.engine.start(cfg); assert.deepStrictEqual(r.calls, []);
    await r.engine.stop(); assert.deepStrictEqual(r.calls, ['identify', 'release', 'default', 'clear']);
    assert.strictEqual(r.journal.pending(), false);
});
test('Slow diagnostics slow the pattern without queuing stale commands after duration expires', async () => {
    const r = rig({ onSet: async (output, on, r) => { r.advance(3000); } });
    await r.engine.start(cfg); assert.strictEqual(controls(r).length, 2);
    assert.deepStrictEqual(r.calls.slice(-3), ['release', 'default', 'clear']);
});
test('Real journal survives a process restart and corrupt records remain pending', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-show-'));
    try {
        const a = new Journal(dir); assert.strictEqual(a.pending(), false); a.mark(P.INDEX);
        const b = new Journal(dir); assert.strictEqual(b.pending(), true); b.clear();
        fs.writeFileSync(a.file, '{broken'); assert.strictEqual(new Journal(dir).pending(), true);
        assert.throws(() => new Journal(dir).mark('UNKNOWN'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

async function tasu(respond) {
    let receive; const requests = [];
    const emit = (ecu, uds) => receive({ errorCode: 0, udsResponse: Buffer.from([0, 0, 0, 0, 0, 0, ecu, 0, 0].concat(uds)) });
    const signals = {
        proxy: async () => ({}), on: async (p, name, fn) => { receive = fn; },
        onAvailable: async (p, fn) => fn(true),
        call: async (p, name, args) => { requests.push(args); return respond(args, emit); },
    };
    const link = await new Link(signals, { info() {}, warn() {} }).init();
    return { link, requests };
}
test('Real TASU decoding ignores other ECUs and other DIDs before identifying BDC_G05', async () => {
    const r = await tasu((args, emit) => {
        emit(0x12, [0x62, 0xF1, 0x50, 0, 0, 0]);
        emit(0x40, [0x62, 0xF1, 0x90, 0, 0, 0]);
        setImmediate(() => emit(0x40, [0x62, 0xF1, 0x50, 0x0F, 0x26, 0x80]));
        return 'NO_ERROR';
    });
    await r.link.identify(); assert.strictEqual(r.link.index, P.INDEX);
    assert.strictEqual(r.requests[0].targetAddress, 0x40);
    assert.strictEqual(r.requests[0].serviceID, 0x22);
});
test('Real TASU transport rejects a different BDC variant and sends only the identity read', async () => {
    const r = await tasu((args, emit) => {
        setImmediate(() => emit(0x40, [0x62, 0xF1, 0x50, 0x0F, 0x22, 0x00])); return 'NO_ERROR';
    });
    await assert.rejects(r.link.identify(), /not supported/); assert.strictEqual(r.requests.length, 1);
});
test('Real TASU transport sends the PRG control-enable mask and surfaces BDC NRC31', async () => {
    const r = await tasu((args, emit) => { setImmediate(() => emit(0x40, [0x7F, 0x2F, 0x31])); return 'NO_ERROR'; });
    await assert.rejects(r.link.set(7, 1), /NRC 31/);
    assert.deepStrictEqual(Array.from(r.requests[0].udsData), [0xE3, 0xB5, 3, 7, 1, 0xC0]);
    assert.strictEqual(r.requests.length, 1);
});
test('Busy TASU verdict is surfaced without retrying or flooding the shared transport', async () => {
    const r = await tasu(() => 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED');
    await assert.rejects(r.link.request(0x2F, P.release()), /transport refused/); assert.strictEqual(r.requests.length, 1);
});

(async () => {
    let failed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); console.log('PASS ' + name); }
        catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); }
    }
    console.log((tests.length - failed) + '/' + tests.length + ' Light Show tests passed');
    process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
