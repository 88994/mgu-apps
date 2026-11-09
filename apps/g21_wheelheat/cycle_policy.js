'use strict';

// A new heating session is permitted only after the vehicle has actually been
// OFF for the configured time. Time passing while driving NEVER re-arms it.
// Unknown/missing vehicle states are deliberately not treated as ignition OFF.
const OFF_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90];

function minutes(value) {
    const n = Number(value);
    return OFF_OPTIONS.indexOf(n) >= 0 ? n : 30;
}

function condition(raw) {
    const named = {
        WOHNEN: 5, PRUEFEN_ANALYSE_DIAGNOSE: 7,
        FAHRBEREITSCHAFT_HERSTELLEN: 8, FAHREN: 10,
        FAHRBEREITSCHAFT_BEENDEN: 12,
    };
    const n = typeof raw === 'string' && named[raw.toUpperCase()] !== undefined ?
        named[raw.toUpperCase()] : Number(raw);
    if (!Number.isInteger(n)) return 'unknown';
    if (n >= 1 && n <= 5) return 'off';
    if (n === 7 || n === 8 || n === 10) return 'on';
    // 12 = ending driving readiness, but NOT proof ignition is already OFF.
    return 'unknown';
}

function validAt(value) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

class VehicleCycle {
    constructor(saved, offMinutes, testBypass) {
        const p = saved || {};
        this.offAt = validAt(p.offAt);
        this.onAt = validAt(p.onAt);
        this.usedOnAt = validAt(p.usedOnAt);
        this.cancelledOnAt = validAt(p.cancelledOnAt);
        this.mode = 'unknown';
        this.offMinutes = minutes(offMinutes);
        this.testBypass = !!testBypass;
        this.eligible = false;
        this.reason = 'WAITING FOR VERIFIED IGNITION STATE';
    }

    observe(raw, now) {
        const next = condition(raw);
        const t = validAt(now);
        if (!t) return { changed: false, transition: 'unknown', reason: this.reason };
        if (next === 'unknown') {
            // 12: readiness is ending. It is not yet a trustworthy OFF
            // timestamp, but issuing a new heat write is unsafe too.
            if (Number(raw) === 12 && this.mode === 'on') {
                this.mode = 'unknown';
                this.eligible = false;
                this.reason = 'DRIVING READINESS ENDING: waiting for confirmed vehicle OFF';
                return { changed: true, transition: 'ending', reason: this.reason };
            }
            return { changed: false, transition: 'unknown', reason: this.reason };
        }
        if (next === this.mode) return { changed: false, transition: 'unchanged', reason: this.reason };

        const previous = this.mode;
        this.mode = next;
        if (next === 'off') {
            // On a process restart during one parking period keep the original
            // timestamp. Never treat a HU/app restart as a new ignition cycle.
            if (!this.offAt || this.onAt >= this.offAt || this.offAt > t) this.offAt = t;
            this.eligible = false;
            this.reason = 'VEHICLE OFF since ' + new Date(this.offAt).toISOString();
            return { changed: true, transition: 'off', reason: this.reason };
        }

        // A first observation of ON is not proof the car JUST switched on.
        // E.g. opening the app after 40 min driving must not count as 40 min
        // parked merely because an old OFF timestamp exists. Only a witnessed
        // OFF -> ON edge allows normal re-arming. One-shot test is explicit.
        const freshOn = previous === 'off' || (previous === 'unknown' &&
            this.testBypass && !this.onAt);
        if (freshOn) {
            const parkedMs = this.offAt > 0 && t >= this.offAt ? t - this.offAt : -1;
            this.onAt = t;
            this.eligible = (parkedMs >= this.offMinutes * 60000 || this.testBypass) &&
                this.usedOnAt !== this.onAt && this.cancelledOnAt !== this.onAt;
            this.reason = this.eligible ?
                (this.testBypass ? 'ONE-SHOT TEST: IGNITION ON (parking time bypassed)' :
                    'NEW IGNITION: parked ' + Math.floor(parkedMs / 60000) + 'm, eligible') :
                'NEW IGNITION: parked ' + (parkedMs < 0 ? 'unknown' : Math.floor(parkedMs / 60000) + 'm') +
                ', requires ' + this.offMinutes + 'm; BLOCKED THIS DRIVE';
        } else {
            this.eligible = false;
            this.reason = 'IGNITION ON without a new verified OFF -> ON cycle; BLOCKED';
        }
        return { changed: true, transition: 'on', reason: this.reason };
    }

    canStart() {
        return this.mode === 'on' && this.eligible && this.usedOnAt !== this.onAt &&
            this.cancelledOnAt !== this.onAt;
    }

    mayContinue() {
        return this.mode === 'on' && this.cancelledOnAt !== this.onAt;
    }

    consume() {
        if (!this.canStart()) return false;
        this.usedOnAt = this.onAt;
        this.eligible = false;
        this.reason = 'AUTOMATIC CYCLE USED for this ignition; no repeat until next eligible start';
        return true;
    }

    cancel() {
        if (this.mode !== 'on' || !this.onAt) return false;
        this.cancelledOnAt = this.onAt;
        this.eligible = false;
        this.reason = 'MANUALLY CANCELLED for this ignition';
        return true;
    }

    snapshot() {
        return { offAt: this.offAt, onAt: this.onAt,
            usedOnAt: this.usedOnAt, cancelledOnAt: this.cancelledOnAt };
    }
}

module.exports = { OFF_OPTIONS, minutes, condition, VehicleCycle };
