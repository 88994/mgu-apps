'use strict';

// BMW BDC_G05 interior-light LIN status (22 DA5F / 22 E3D1) and temporary
// output (2E DA5E / 2E E3D1). These are *not* RAM01 E311 commands.
// No blind module IDs, broadcast NAD=0, animations, or background writes.
const { replyTo, hex, NRC } = require('./kit/diag');

const BDC = 0x40;
const BUSES = Object.freeze([
    { read: [0xDA, 0x5F], write: [0xDA, 0x5E] },
    { read: [0xE3, 0xD1], write: [0xE3, 0xD1] },
]);
const RECORDS_PER_BUS = 26;
const RECORD_SIZE = 10;
const SCAN_TTL_MS = 120000;
const MAX_WRITES = 32;
const NAMES = Object.freeze({
    1: 'Driver front footwell', 2: 'Driver rear footwell', 3: 'Passenger front footwell',
    4: 'Passenger rear footwell', 5: 'Driver door line', 6: 'Driver door decor',
    7: 'Driver door handle', 8: 'Driver door pocket', 9: 'Driver rear door line',
    10: 'Driver rear door decor', 11: 'Driver rear door pocket',
    12: 'Passenger door line', 13: 'Passenger door decor', 14: 'Passenger door handle',
    15: 'Passenger door pocket', 16: 'Passenger rear door line',
    17: 'Passenger rear door decor', 18: 'Passenger rear door pocket',
    19: 'Dash line driver', 20: 'Dash decor driver', 21: 'Dash line centre',
    22: 'Dash decor centre', 23: 'Dash line passenger', 24: 'Dash decor passenger',
    25: 'Driver B-pillar', 26: 'Passenger B-pillar', 27: 'Driver seat',
    28: 'Passenger seat', 29: 'Centre tray', 30: 'Console tray',
    31: 'Gear selector left', 32: 'Gear selector right', 33: 'Driver rear handle',
    34: 'Passenger rear handle',
});

function parseBus(bus, uds) {
    if (bus !== 0 && bus !== 1) throw new RangeError('unknown LIN bus');
    const did = BUSES[bus].read;
    if (!Array.isArray(uds) || uds[0] !== 0x62 || uds[1] !== did[0] ||
        uds[2] !== did[1] || uds.length < 3 + RECORDS_PER_BUS * RECORD_SIZE) return null;
    const modules = [];
    const usedLocations = new Set();
    for (let i = 0; i < RECORDS_PER_BUS; i++) {
        const p = 3 + i * RECORD_SIZE;
        const loc = uds[p];
        if (loc === 0xFF) continue;
        if (!Number.isInteger(loc) || loc < 1 || loc > 0x4C || usedLocations.has(loc)) return null;
        usedLocations.add(loc);
        modules.push({
            key: bus + ':' + (i + 1), bus, nad: i + 1, location: loc,
            name: NAMES[loc] || ('Light position ' + hex(loc)),
            rgb: [uds[p + 3], uds[p + 2], uds[p + 1]],
            brightness: uds[p + 4],
            fault: !!(uds[p + 6] || uds[p + 7] || uds[p + 8] || uds[p + 9]),
        });
    }
    return modules;
}

function colorByte(v) {
    if (!Number.isFinite(v)) throw new TypeError('non-finite RGB');
    return Math.max(0, Math.min(254, Math.round(v)));
}
function writeFrame(module, rgb, brightness, seconds, release) {
    if (!module || !BUSES[module.bus] || !Number.isInteger(module.nad) ||
        module.nad < 1 || module.nad > RECORDS_PER_BUS)
        throw new RangeError('module not discovered');
    const did = BUSES[module.bus].write;
    if (release) return did.concat([module.nad, 0, 0, 0, 0, 0, 0]);
    if (!Array.isArray(rgb) || rgb.length !== 3 || !Number.isFinite(brightness) || !Number.isFinite(seconds))
        throw new TypeError('invalid light settings');
    return did.concat([module.nad, 1, Math.max(0, Math.min(100, Math.round(brightness))),
        ...rgb.map(colorByte), Math.max(1, Math.min(254, Math.round(seconds)))]);
}

function requestFailure(uds) {
    if (!uds) return 'no response';
    if (uds[0] === 0x7F) return 'NRC ' + hex(uds[2]) + ' ' + (NRC[uds[2]] || '');
    return 'unexpected response';
}

class BdcLin {
    constructor(ctx, ram) {
        this.ctx = ctx;
        this.ram = ram; // reuse its TASU transport and current vehicle-speed signal
        this.modules = [];
        this.readStatus = ['not scanned', 'not scanned'];
        this.scannedAt = 0;
        this.busy = false;
        this.pending = null;
        this.lastWrite = 'No BDC write requested';
        this.info = 'Scan BDC LIN buses before controlling zones.';
    }
    cancel() { this.pending = null; }
    async scan() {
        this.cancel();
        if (this.busy) return;
        if (!this.ram.online) { this.info = 'TASU unavailable'; return; }
        this.busy = true;
        this.modules = [];
        this.scannedAt = 0;
        try {
            const found = [];
            for (let bus = 0; bus < BUSES.length; bus++) {
                const req = BUSES[bus].read;
                let uds;
                try {
                    uds = await this.ram.diag.physical(BDC, 0x22, req, 14000,
                        replyTo(0x22, req), { maxRetries: 0, pendingTimeoutMs: 14000, hardTimeoutMs: 18000 });
                } catch (e) { this.readStatus[bus] = String(e.message || e); continue; }
                const data = parseBus(bus, uds);
                if (data === null) { this.readStatus[bus] = requestFailure(uds); continue; }
                this.readStatus[bus] = data.length + ' modules';
                found.push(...data);
            }
            if (found.length > 0 && found.length <= 52) {
                this.modules = found;
                this.scannedAt = Date.now();
                this.info = 'BDC LIN discovered ' + found.length + ' modules; physical response not yet tested.';
            } else this.info = 'No verified BDC LIN modules found; writes disabled.';
            this.ctx.log.info('[AMBIENT BDC SCAN] ' + this.info + '; ' + this.readStatus.join(' / '));
        } finally { this.busy = false; }
    }
    plan(snapshot, seconds) {
        if (!snapshot || !snapshot.main || !Array.isArray(snapshot.main.rgb)) throw new TypeError('no scene');
        return this.modules.map(module => {
            const state = snapshot.zones && snapshot.zones[module.key];
            const setting = state && state.mode === 'own' ? state : snapshot.main;
            return { module, data: writeFrame(module, setting.rgb, setting.brightness, seconds,
                state && state.mode === 'car') };
        });
    }
    get ready() {
        if (this.busy) return 'Diagnostics busy';
        if (!this.ram.online) return 'TASU unavailable';
        if (!this.ram.parked) return 'Vehicle standstill not confirmed';
        if (!this.modules.length || !this.scannedAt || Date.now() - this.scannedAt > SCAN_TTL_MS)
            return 'Scan BDC modules again (max. 2 min)';
        return '';
    }
    async apply(snapshot, seconds, releaseAll) {
        const blocked = this.ready;
        if (blocked) { this.cancel(); this.info = blocked; return; }
        const commands = releaseAll
            ? this.modules.map(module => ({ module, data: writeFrame(module, null, 0, 0, true) }))
            : this.plan(snapshot, seconds);
        if (!commands.length || commands.length > MAX_WRITES) {
            this.info = 'More than ' + MAX_WRITES + ' modules: batch not allowed'; return;
        }
        const signature = JSON.stringify(commands.map(item => item.data));
        if (!this.pending || this.pending.signature !== signature || this.pending.until < Date.now()) {
            this.pending = { signature, until: Date.now() + 8000 };
            this.info = 'Press APPLY again within 8 seconds to send ' + commands.length + ' BDC requests.';
            return;
        }
        this.cancel();
        this.busy = true;
        let acknowledgements = 0;
        try {
            for (const item of commands) {
                // Recheck speed and scan age before *each* request; stop on first failure.
                if (!this.ram.parked || Date.now() - this.scannedAt > SCAN_TTL_MS) {
                    this.info = 'Aborted: vehicle moved or BDC scan expired'; break;
                }
                const req = item.data;
                let uds;
                try {
                    uds = await this.ram.diag.physical(BDC, 0x2E, req, 3000,
                        replyTo(0x2E, req), { maxRetries: 0, hardTimeoutMs: 5000 });
                } catch (e) { this.info = 'Write stopped: ' + String(e.message || e); break; }
                if (!uds || uds[0] !== 0x6E || uds[1] !== req[0] || uds[2] !== req[1]) {
                    this.info = 'BDC write stopped: ' + requestFailure(uds); break;
                }
                acknowledgements++;
            }
            this.lastWrite = acknowledgements + '/' + commands.length + ' BDC ACK; physical light effect UNVERIFIED';
            if (acknowledgements === commands.length) this.info = this.lastWrite;
            this.ctx.log.info('[AMBIENT BDC WRITE] ' + this.lastWrite + '; ' + this.info);
            // A new confirmation requires a new discovery, not just another double press.
            this.scannedAt = 0;
        } finally { this.busy = false; }
    }
}

module.exports = { BDC, BUSES, parseBus, writeFrame, BdcLin, MAX_WRITES };
