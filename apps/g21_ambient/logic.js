'use strict';

// RAM01.prg, SG_FUNKTIONEN LIN_RGB_MODULE, DID 0xE311, service 2E;22.
const ECU = 0x37;
const DID = 0xE311;
// The car rejects both E310 and E311 reads with NRC 31. Standard 22 F150
// identifies an ECU by numeric SGBD index; it does not return "RAM01" text.
// Until that index is mapped to the uploaded RAM01 PRG, writes stay blocked.
const PROBE_DID = 0xF150;
const COLORS = Object.freeze([
    { name: 'Warm white', rgb: [254, 155, 65], on: 1 },
    { name: 'Blue', rgb: [0, 90, 254], on: 1 },
    { name: 'Red', rgb: [254, 0, 0], on: 1 },
    { name: 'Green', rgb: [0, 254, 85], on: 1 },
    { name: 'Violet', rgb: [145, 0, 254], on: 1 },
    { name: 'Off', rgb: [0, 0, 0], on: 0 },
]);
const BRIGHTNESS = [10, 25, 50, 75, 100];
const HUES = Array.from({ length: 24 }, (_, i) => i * 15);
const SATURATIONS = Array.from({ length: 11 }, (_, i) => i * 10);
const SLOT11_PROFILE_OFFSET = 20;
const ORIGINAL_PROFILES = Object.freeze([
    1,1,1,0,2,2,2,0,0,0,3,3,3,0,4,4,4,0,5,5,5,0,
]);
const ORIGINAL_LILAC_RGB = Object.freeze([0x78, 0x3C, 0xFE]);
/** HSV hue/saturation in the picker's grid; BMW's PRG RGB channel maximum is 254. */
function hsvToRgb(hue, saturation) {
    if (!Number.isInteger(hue) || hue < 0 || hue >= 360) throw new RangeError('Hue must be 0..359');
    if (!Number.isInteger(saturation) || saturation < 0 || saturation > 100) throw new RangeError('Saturation must be 0..100');
    const s = saturation / 100, h = hue / 60;
    const x = s * (1 - Math.abs(h % 2 - 1)), lo = 1 - s;
    const rgb = h < 1 ? [s, x, 0] : h < 2 ? [x, s, 0] : h < 3 ? [0, s, x]
        : h < 4 ? [0, x, s] : h < 5 ? [x, 0, s] : [s, 0, x];
    return rgb.map(v => Math.max(0, Math.min(254, Math.round((v + lo) * 254))));
}
/** Presets remain accessible; tapping a hue/saturation square selects the custom mode. */
function chooseColor(mode, presetIndex, hue, saturation) {
    if (mode === 'custom') return { name: 'Custom color', rgb: hsvToRgb(hue, saturation), on: 1 };
    if (mode !== 'preset' || !Number.isInteger(presetIndex) || !COLORS[presetIndex]) {
        throw new RangeError('Unknown color selection');
    }
    return COLORS[presetIndex];
}
/** The RGB sliders are an alternative input to the existing hue/saturation grid. */
function exactColor(rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3) throw new RangeError('RGB requires three channels');
    rgb.forEach((v, i) => uint('RGB ' + i, v, 254));
    return { name: 'Custom color', rgb: rgb.slice(), on: 1 };
}
/** True nearest color from *all 24 x 11 displayed swatches* by RGB distance.
 * Do not quantize the precise RGB input; only the selection marker is snapped. */
function rgbToGrid(rgb) {
    exactColor(rgb);
    let match = null, minDistance = Infinity;
    for (const hue of HUES) {
        for (const saturation of SATURATIONS) {
            const swatch = hsvToRgb(hue, saturation);
            const distance = rgb.reduce((sum, v, i) => sum + (v - swatch[i]) ** 2, 0);
            if (distance < minDistance) {
                minDistance = distance;
                match = { hue, saturation, rgb: swatch, distanceSq: distance };
            }
        }
    }
    return match;
}
/** A separate custom color needs a *verified* 360A library entry.
 * Do not mistake the profile index 05 for RGB bytes, or silently sacrifice
 * another slot by repurposing color index 00..05. */
function slot11Plan(rgb) {
    const color = exactColor(rgb);
    return {
        slot: 11, offset: SLOT11_PROFILE_OFFSET,
        oldProfile: ORIGINAL_PROFILES.slice(SLOT11_PROFILE_OFFSET),
        desiredRGB: color.rgb,
        newProfile: null, // unknown until BDC's 360A free indices are verified
        status: 'BDC 360A / unused color index not verified',
    };
}
function slot11RestorePlan() {
    return { slot: 11, offset: SLOT11_PROFILE_OFFSET, profile: [5,0],
        factoryLilacRGB: ORIGINAL_LILAC_RGB.slice(),
        status: 'Verify original NCD before restoration; no automatic ECU write' };
}
/** Convert a picker tap into persisted hue/saturation selections. */
function pickerCell(x, y, left, top, width, height) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < left || x >= left + width ||
        y < top || y >= top + height) return null;
    const col = Math.min(23, Math.floor((x - left) * 24 / width));
    const row = Math.min(10, Math.floor((y - top) * 11 / height));
    return { hue: HUES[col], saturation: 100 - SATURATIONS[row] };
}
function uint(name, value, max) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new RangeError(name + ' must be an integer between 0 and ' + max);
    }
    return value;
}
/** 2E DATA: DID high, DID low, 7 unsigned char arguments in PRG order. */
function encode({ id, on, brightness, red, green, blue, seconds }) {
    return [DID >> 8, DID & 255, uint('ID', id, 254), uint('ON_OFF', on, 1),
        uint('BRIGHTNESS', brightness, 100), uint('RED', red, 254),
        uint('GREEN', green, 254), uint('BLUE', blue, 254), uint('SECONDS', seconds, 254)];
}
function fromPreset(preset, id, brightness, seconds) {
    if (!preset || !Array.isArray(preset.rgb) || preset.rgb.length !== 3) throw new Error('Unknown color');
    return encode({ id, on: preset.on, brightness: preset.on ? brightness : 0,
        red: preset.rgb[0], green: preset.rgb[1], blue: preset.rgb[2], seconds });
}
module.exports = { ECU, DID, PROBE_DID, COLORS, BRIGHTNESS, HUES, SATURATIONS, hsvToRgb,
    chooseColor, pickerCell, exactColor, rgbToGrid, slot11Plan, slot11RestorePlan,
    ORIGINAL_PROFILES, ORIGINAL_LILAC_RGB, SLOT11_PROFILE_OFFSET, encode, fromPreset };
