'use strict';

// Pure, testable cycle-rearming policy. A repeat is never requested while a
// scheduled heating session is active, and a NEW repeated cycle requires
// a fresh speed signal confirming vehicle motion.
const REPEAT_OPTIONS = [30, 45, 60, 90, 120, 180];
const MIN_REARM_SPEED_KMH = 0.5;
function minutes(value) {
    const n = Number(value);
    return REPEAT_OPTIONS.indexOf(n) >= 0 ? n : 30;
}
function restore(lastAcceptedOnAt, now, repeatMinutes) {
    const at = Number(lastAcceptedOnAt);
    return Number.isFinite(at) && at > 0 && now >= at &&
        now - at < minutes(repeatMinutes) * 60000;
}
function check(state) {
    const now = Number(state.now);
    const at = Number(state.lastCycleAt);
    const intervalMs = minutes(state.repeatMinutes) * 60000;
    if (!state.fired || !Number.isFinite(at) || at <= 0 ||
        !Number.isFinite(now) || now < at)
        return { ready: false, reason: 'not-armed', remainingMs: 0 };
    const remainingMs = Math.max(0, at + intervalMs - now);
    if (state.activeCount > 0)
        return { ready: false, reason: 'session-active', remainingMs };
    if (remainingMs > 0)
        return { ready: false, reason: 'cooldown', remainingMs };
    if (!state.motionKnown || !Number.isFinite(state.speedKmh) ||
        state.speedKmh <= MIN_REARM_SPEED_KMH)
        return { ready: false, reason: 'await-moving', remainingMs: 0 };
    return { ready: true, reason: 'rearm', remainingMs: 0 };
}
module.exports = { REPEAT_OPTIONS, MIN_REARM_SPEED_KMH, minutes, restore, check };
