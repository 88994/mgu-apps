'use strict';

// FLM02_L/R STEUERN_ROUTINE -> FLM_KANAL, RID A54B.
// The STOP request (31 02 A5 4B) was captured by executing the user's
// original FLM02_L.prg offline against a recording-only interface.
// The START argument layout is taken from ARG_0xA54B_R (KANAL/PWM/ZEIT),
// but its complete telegram and physical effects remain vehicle-unverified.
const MODULES = Object.freeze({
    left: Object.freeze({ address: 0x43, index: '0F26C0', name: 'FLM02_L' }),
    right: Object.freeze({ address: 0x44, index: '0F26D0', name: 'FLM02_R' }),
});
const PWM = 20;
const SECONDS = 1;

function moduleFor(side) {
    if (!Object.prototype.hasOwnProperty.call(MODULES, side)) throw new Error('Unsupported FLM side');
    return MODULES[side];
}
function channelNumber(channel) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 15)
        throw new Error('FLM channel must be 1 to 15; all-channel control is disabled');
    return channel;
}
function start(channel) {
    // No user-adjustable PWM, duration, or 255 = indefinite duration.
    return [0x01, 0xA5, 0x4B, channelNumber(channel), PWM, SECONDS];
}
function stop() { return [0x02, 0xA5, 0x4B]; }
function isPermittedRoutine(data) {
    if (!Array.isArray(data)) return false;
    if (data.length === 3) return data.every((x, i) => x === stop()[i]);
    if (data.length !== 6 || !Number.isInteger(data[3]) || data[3] < 1 || data[3] > 15) return false;
    return data.every((x, i) => x === start(data[3])[i]);
}

module.exports = { MODULES, PWM, SECONDS, moduleFor, channelNumber, start, stop, isPermittedRoutine };
