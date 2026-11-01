'use strict';
// BMW G21 318d B47, ECU variant D83BX7C0.
// Values are extracted from D83BX7C0.prg, SG_FUNKTIONEN.
// UDS 0x22 ReadDataByIdentifier, ECU address candidate 0x12.
// Responses, byte order and scaling still require in-vehicle verification.
// Strict read-only allowlist: no write, actuation or routine services.
const ECU = 0x12;
const READINGS = [
    { name: 'soot', request: { did: '44BE', bytes: 2, factor: 0.01525902, min: 0, max: 250, timeoutMs: 2500 } },
    { name: 'ash', request: { did: '44BD', bytes: 2, factor: 0.01525902, min: 0, max: 500, timeoutMs: 2500 } },
    { name: 'pressure', request: { did: '44ED', bytes: 2, factor: 0.04577707, offset: -1000, min: -100, max: 1500, timeoutMs: 2500 } },
    { name: 'temperature', request: { did: '4502', bytes: 2, factor: 0.03128099, offset: -50, min: -50, max: 1100, timeoutMs: 2500 } },
    { name: 'distance', request: { did: '44BF', bytes: 4, factor: 0.001, min: 0, max: 100000, timeoutMs: 2500 } },
    { name: 'regens', request: { did: '44B8', bytes: 2, factor: 1, min: 0, max: 65535, timeoutMs: 2500 } },
    { name: 'interval', request: { did: '44C7', bytes: 2, factor: 1, min: 0, max: 65535, timeoutMs: 2500 } },
    { name: 'request', request: { did: '44BB', bytes: 1, factor: 1, min: 0, max: 255, timeoutMs: 2500 } },
];
module.exports = { ECU, READINGS };
