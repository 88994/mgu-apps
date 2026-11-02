'use strict';

// BDC_G05.prg: LENKRADHEIZUNG 0xD074, LENKRADHEIZUNG_LED 0xD071.
const ECU = 0x40;
const DID_HEAT = 0xD074;
const DID_LED = 0xD071;
const DID_SEAT_DRIVER = 0xE432;
const DID_SEAT_PASSENGER = 0xE430;
const TIMES = [0, 30, 60, 120, 180, 240, 255];
function uint(name, value, max) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new RangeError(name + ' must be an integer between 0 and ' + max);
    }
    return value;
}
function heating(seconds) { return [DID_HEAT >> 8, DID_HEAT & 255, uint('SECONDS', seconds, 255)]; }
function led(action) { return [DID_LED >> 8, DID_LED & 255, uint('ACTION', action, 1)]; }
function seat(side, level, seconds) {
    const did = side === 'driver' ? DID_SEAT_DRIVER : side === 'passenger' ? DID_SEAT_PASSENGER : null;
    if (!did) throw new RangeError('Unknown seat side');
    return [did >> 8, did & 255, uint('LEVEL', level, 3), uint('SECONDS', seconds, 255)];
}
function exteriorTemp(raw) {
    return Number.isInteger(raw) && raw >= 0 && raw < 255 ? raw * 0.5 - 40 : null;
}
/** Source selection for the OFFLINE preview. Simulated values never reach ECU writes. */
function temperatureInput(realValue, realAt, simulationEnabled, simulationC, now) {
    if (simulationEnabled) {
        const value = Number(simulationC);
        if (!Number.isFinite(value) || value < -40 || value > 60) {
            return { value: null, at: 0, source: 'INVALID TEST VALUE' };
        }
        return { value, at: now, source: 'SIMULATION' };
    }
    return { value: realValue, at: realAt, source: 'MGU' };
}
module.exports = { ECU, DID_HEAT, DID_LED, DID_SEAT_DRIVER, DID_SEAT_PASSENGER,
    TIMES, heating, led, seat, exteriorTemp, temperatureInput };
