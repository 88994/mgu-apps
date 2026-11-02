'use strict';

// Intentionally identical to g21_ambient/safe_diag.js. The SDK packages each
// app independently, so both carry their own self-contained safety gate.
const { Diag, hex, NRC, replyTo } = require('./kit/diag');
class SafeDiag {
    constructor(ctx, target, probeDid) {
        this.ctx = ctx;
        this.target = target;
        this.probeDid = probeDid;
        this.diag = new Diag(ctx.signals, ctx.log);
        this.speed = null;
        this.speedAt = 0;
        this.readAt = 0;
        this.readText = 'not read yet';
        this.info = 'Live ECU commands disabled until explicitly enabled.';
        this.pending = null;
        this.busy = false;
        this.lastWriteAt = 0;
    }
    async init() {
        this.ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: (v) => {
                const raw = v && v.speedVehicleCentreOfGravity;
                if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 65535) {
                    this.speed = raw * 0.015625;
                    this.speedAt = Date.now();
                    if (this.speed > 0.5) this.pending = null;
                }
            },
        }, this.ctx.log, { pollMs: 2000 }).catch(e => this.ctx.log.warn('Vehicle speed: ' + e));
        await this.diag.init();
    }
    get online() { return !!(this.diag.p && this.diag.available); }
    get parked() { return this.speed !== null && this.speed <= 0.5 && Date.now() - this.speedAt < 5000; }
    get verified() { return this.readAt > 0 && Date.now() - this.readAt < 60000; }
    get writeReady() {
        if (this.ctx.settings.get('liveControl') !== true) return 'Live BDC control disabled in Settings';
        if (!this.online) return 'TASU/ECU unavailable';
        if (!this.verified) return 'Read status first (max. 60s)';
        if (!this.parked) return 'Vehicle standstill not confirmed';
        if (Date.now() - this.lastWriteAt < 3000) return '3s cooldown active';
        return '';
    }
    cancel() { this.pending = null; }
    async read(did) {
        this.cancel();
        if (this.busy) { this.info = 'Diagnostics busy'; return; }
        if (!this.online) { this.info = 'TASU unavailable (expected in emulator)'; return; }
        this.busy = true;
        const data = [did >> 8, did & 255];
        try {
            const u = await this.diag.physical(this.target, 0x22, data, 2300, replyTo(0x22, data), { maxRetries: 0 });
            if (u && u[0] === 0x62 && u[1] === data[0] && u[2] === data[1]) {
                if (did === this.probeDid) this.readAt = Date.now();
                this.readText = bytes(u);
                this.info = 'Read OK: 0x' + hex(did, 4) + ' (raw reply)';
            } else {
                this.readAt = 0;
                this.readText = u ? bytes(u) : 'Timeout';
                this.info = errorFor(u);
            }
        } catch (e) { this.readAt = 0; this.info = 'Read error: ' + String(e.message || e); }
        finally { this.busy = false; }
    }
    async write(data, label) {
        if (this.busy) { this.info = 'Diagnostics busy'; return; }
        const reason = this.writeReady;
        if (reason) { this.cancel(); this.info = reason; return; }
        const signature = bytes(data);
        if (!this.pending || this.pending.signature !== signature || Date.now() > this.pending.until) {
            this.pending = { signature, until: Date.now() + 8000 };
            this.info = 'Press SEND AGAIN to confirm: ' + label + ' (8s)';
            return;
        }
        this.cancel();
        this.busy = true;
        try {
            const u = await this.diag.physical(this.target, 0x2E, data, 2300, replyTo(0x2E, data), { maxRetries: 0 });
            if (u && u[0] === 0x6E && u[1] === data[0] && u[2] === data[1]) {
                this.info = 'ECU acknowledged 0x2E; vehicle effect UNVERIFIED';
                this.lastWriteAt = Date.now();
                this.readAt = 0;
            } else this.info = errorFor(u);
        } catch (e) { this.info = 'Write error: ' + String(e.message || e); }
        finally { this.busy = false; }
    }
    /** Automation-specific write: the Settings opt-in authorizes commands,
     * but each command STILL requires a fresh 22 read and confirmed standstill.
     * No simulator or unknown-speed command is ever sent to the vehicle.
     * Returns true only on a positive 0x6E reply (not proof of physical heat).
     */
    async autoWrite(data, label) {
        if (this.busy) { this.info = 'BDC busy'; return false; }
        const reason = this.writeReady;
        if (reason) { this.info = reason; return false; }
        this.busy = true;
        this.info = 'Sending ' + label + ' to BDC ...';
        try {
            const u = await this.diag.physical(this.target, 0x2E, data, 2300,
                replyTo(0x2E, data), { maxRetries: 0 });
            if (u && u[0] === 0x6E && u[1] === data[0] && u[2] === data[1]) {
                this.info = label + ': BDC acknowledged (physical result unverified)';
                this.lastWriteAt = Date.now();
                this.readAt = 0;
                return true;
            }
            this.info = label + ': ' + errorFor(u);
        } catch (e) { this.info = label + ': ' + String(e.message || e); }
        finally { this.busy = false; }
        return false;
    }
}
function bytes(b) { return Array.from(b || []).map(n => hex(n)).join(' '); }
function errorFor(u) {
    if (!u) return 'No ECU response (timeout)';
    if (u[0] === 0x7F) return 'ECU rejected: NRC 0x' + hex(u[2]) + ' (' + (NRC[u[2]] || 'unknown') + ')';
    return 'Unexpected ECU reply: ' + bytes(u);
}
module.exports = { SafeDiag, bytes };
