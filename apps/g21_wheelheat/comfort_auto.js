'use strict';

/**
 * Pure, deterministic comfort planner. No ECU access here.
 * Its intents must pass a separately authorized, fail-closed ECU controller.
 * One cycle per arming. The host may re-arm after a configured cooldown,
 * with fresh confirmed vehicle motion and no active sessions (manual cabin
 * settings remain authoritative).
 */
const COLD_DWELL_MS = 15000;
const SENSOR_AGE_MS = 120000;
// UDS 2E D074 / E432 / E430 carries one duration byte (0..255s).
// Extend only by an additional authorized BDC request while parked.
const SEGMENT_SECONDS = 240;
const RENEW_EARLY_MS = 12000;
const RENEW_RETRY_MS = 12000;

class ComfortAuto {
    constructor() {
        this.fired = false;
        this.coldSince = null;
        this.active = new Map();
        this.lastEvent = 'Automation not started yet';
        this.events = [];
    }
    step({ now, tempC, tempAt, cfg }) {
        if (!Number.isFinite(now)) throw new TypeError('Time missing');
        const out = [];
        const publish = (type, device, data) => {
            const e = { type, device, data, at: now };
            out.push(e);
            this.events.push(e);
            this.lastEvent = device + ' ' + type + ' requested (not ECU-confirmed)';
        };
        const enabled = !!cfg.autoEnabled;
        // Complete previously started sessions even if the sensor falls silent.
        // Disable switch stops the preview immediately and never arms it again.
        for (const [device, s] of this.active) {
            if (!enabled || now >= s.deadline) {
                publish('OFF', device, s.off);
                this.active.delete(device);
            } else if (now >= s.nextRenewAt && now < s.deadline - RENEW_EARLY_MS) {
                // Not a confirmation: request an extension and retry if it is
                // blocked. The ECU may already have expired while moving.
                const remainingS = Math.ceil((s.deadline - now) / 1000);
                publish('EXTEND', device, Object.assign({}, s.on,
                    { seconds: Math.min(SEGMENT_SECONDS, remainingS) }));
                s.nextRenewAt = now + RENEW_RETRY_MS;
            }
        }
        if (!enabled || this.fired) { this.coldSince = null; return out; }
        if (!Number.isFinite(tempC) || !Number.isFinite(tempAt) || now - tempAt > SENSOR_AGE_MS || tempAt > now) {
            this.coldSince = null;
            return out;
        }
        const threshold = Number(cfg.belowTemp);
        if (!Number.isFinite(threshold) || tempC > threshold) { this.coldSince = null; return out; }
        const dwellS = cfg.coldDwell === undefined ? COLD_DWELL_MS / 1000 : Number(cfg.coldDwell);
        if (!Number.isInteger(dwellS) || dwellS < 0 || dwellS > 60) throw new RangeError('Dwell time must be 0..60 seconds');
        if (this.coldSince === null) this.coldSince = now;
        if (now - this.coldSince < dwellS * 1000) return out;

        const plan = [];
        const secs = (minutes) => {
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20) throw new RangeError('Duration must be 1..20 minutes');
            return minutes * 60;
        };
        if (cfg.wheelAuto) plan.push(['Steering wheel', secs(cfg.wheelMins), { seconds: secs(cfg.wheelMins) }, { seconds: 0 }]);
        const level = Number(cfg.seatLevel);
        if (cfg.seatDriver) plan.push(['Driver seat', secs(cfg.seatMins), { side: 'driver', level }, { side: 'driver', level: 0 }]);
        if (cfg.seatPassenger) plan.push(['Passenger seat', secs(cfg.seatMins), { side: 'passenger', level }, { side: 'passenger', level: 0 }]);
        // Validate all parameter values before emitting any action.
        for (const [device, sec, value] of plan) {
            if (sec < 1 || sec > 1200 || ((device !== 'Steering wheel') && (!Number.isInteger(value.level) || value.level < 1 || value.level > 3))) {
                throw new RangeError('Invalid heating value');
            }
        }
        this.fired = true;
        this.coldSince = null;
        for (const [device, seconds, data, off] of plan) {
            const firstSeconds = Math.min(seconds, SEGMENT_SECONDS);
            this.active.set(device, { deadline: now + seconds * 1000, off, on: data,
                nextRenewAt: seconds > SEGMENT_SECONDS ? now + (firstSeconds * 1000) - RENEW_EARLY_MS : Infinity });
            publish('ON', device, Object.assign({}, data, { seconds: firstSeconds }));
        }
        if (!plan.length) this.lastEvent = 'No heating selected';
        return out;
    }
    rearm() {
        if (this.active.size > 0) return false;
        this.fired = false;
        this.coldSince = null;
        this.lastEvent = 'Automatic repeat armed; waiting for cold dwell';
        return true;
    }
    remaining(device, now) {
        const a = this.active.get(device);
        return a ? Math.max(0, Math.ceil((a.deadline - now) / 1000)) : 0;
    }
    /** Feed the ECU acknowledgement back into the scheduling decision. */
    acknowledge(intent, ok, now) {
        const s = this.active.get(intent.device);
        if (!s) return;
        if (intent.type === 'ON' && !ok) {
            this.active.delete(intent.device); // no live session to extend
            return;
        }
        if (intent.type === 'EXTEND') {
            s.nextRenewAt = ok
                ? now + intent.data.seconds * 1000 - RENEW_EARLY_MS
                : now + RENEW_RETRY_MS;
        }
    }
}
module.exports = { ComfortAuto, COLD_DWELL_MS, SENSOR_AGE_MS, SEGMENT_SECONDS };
