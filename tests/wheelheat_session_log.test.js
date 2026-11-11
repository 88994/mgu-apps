'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const QR = require('../apps/g21_wheelheat/qr_log');
const { seatOnWithBusyRetry } = require('../apps/g21_wheelheat/seat_retry');

test('session QR excludes previous SDK log rotations and stays compact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g21-heat-session-test-'));
    const start = Date.parse('2026-11-11T07:00:00.000Z');
    try {
        const old = '2026-11-10T18:00:00.000Z SDK_ERROR OLD_SESSION_PRIVATE_MARKER\n';
        const latest = '2026-11-11T07:01:00.000Z SDK_WARN CURRENT_SESSION_SEAT_BUSY\n';
        fs.writeFileSync(path.join(dir, 'g21_wheelheat.log.1'), old.repeat(20000));
        fs.writeFileSync(path.join(dir, 'g21_wheelheat.log'), latest);
        const ctx = {
            dataDir: dir, spec: { id: 'g21_wheelheat', version: '0.4.17' },
            settings: { values: { autoEnabled: true, seatDriver: true }, saveError: '' },
        };
        const report = QR.createReport(ctx, { sessionStartedAt: start,
            sessionReason: 'MGU process restart', state: { bdcOnline: true },
            events: [
                { at: start - 5000, kind: 'ECU REJECT', message: 'PREVIOUS_DRIVE' },
                { at: start + 1000, kind: 'ECU REJECT', message: 'Driver seat NRC 0x21 busy' },
            ],
        });
        const payload = report.pages.join('\n');
        assert.match(payload, /CURRENT_SESSION_SEAT_BUSY/);
        assert.match(payload, /Driver seat NRC 0x21 busy/);
        assert.doesNotMatch(payload, /OLD_SESSION_PRIVATE_MARKER|PREVIOUS_DRIVE/);
        assert(report.pages.length < 20, 'one short session should not produce hundreds of QR pages');
        assert(report.pages[0].startsWith('HCLOG2 '));
        assert(QR.matrix(report.pages[0]).getModuleCount() > 0);
        const lines = QR.consoleLines([
            { at: start - 1, kind: 'ERROR', message: 'old' },
            { at: start + 1, kind: 'ECU REJECT', message: 'new busy' },
        ], QR.sessionWarnings(ctx, start), start);
        assert(lines.some(x => x.text.includes('new busy')));
        assert(!lines.some(x => x.text.includes('old')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only seat ON gets at most two retries for explicit NRC 0x21', async () => {
    const attempts = [], delays = [], notices = [];
    const send = async n => {
        attempts.push(n);
        return n < 3 ? { ok: false, nrc: 0x21 } : { ok: true, nrc: null };
    };
    const opts = { device: 'Driver seat', type: 'ON', send,
        allowed: () => true, wait: async ms => { delays.push(ms); },
        event: (...args) => notices.push(args),
    };
    assert.equal((await seatOnWithBusyRetry(opts)).ok, true);
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(delays, [4500, 7000]);
    assert.equal(notices.length, 2);
    attempts.length = 0;
    delays.length = 0;
    assert.equal((await seatOnWithBusyRetry({ ...opts, device: 'Steering wheel' })).ok, false);
    assert.deepEqual(attempts, [1]);
    assert.deepEqual(delays, []);
    let permitted = true;
    const blocked = await seatOnWithBusyRetry({ ...opts,
        allowed: () => permitted,
        wait: async () => { permitted = false; },
    });
    assert.equal(blocked.blocked, true);
});

test('NRC 0x31 and seat OFF never trigger additional writes', async () => {
    for (const type of ['ON', 'OFF']) {
        let requests = 0;
        const result = await seatOnWithBusyRetry({
            device: 'Passenger seat', type,
            send: async () => { requests++; return { ok: false, nrc: type === 'ON' ? 0x31 : 0x21 }; },
            allowed: () => true, wait: async () => { throw new Error('must not wait'); },
            event: () => {},
        });
        assert.equal(result.ok, false);
        assert.equal(requests, 1);
    }
});
