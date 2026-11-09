'use strict';
/**
 * Pixel-only brightness compensation for BMW's home widget skin.
 *
 * Some ID7 skins darken/crop the Drive Recorder widget at its edges. This
 * function can counter part of the dimming in the PNG before it reaches HMI.
 * It cannot disable a native compositor mask, which remains skin-controlled.
 * Only widget canvases are changed; the full app preview and GIF files are not.
 */
function compensateWidget(cv, mode) {
    if (mode === 'original') return cv;
    const strong = mode === 'strong';
    const gamma = strong ? 0.70 : 0.84;
    const centreGain = strong ? 1.28 : 1.12;
    const edgeGain = strong ? 0.86 : 0.42;
    const table = new Uint8Array(256);
    const d = cv.d, w = cv.w, h = cv.h;
    if (!w || !h) return cv;
    // The same tone curve for each channel retains the original hues.
    for (let i = 0; i < 256; i++) table[i] = Math.round(255 * Math.pow(i / 255, gamma));
    for (let y = 0; y < h; y++) {
        const edge = Math.abs((y + 0.5) * 2 / h - 1);
        const gain = centreGain + edgeGain * edge * edge;
        for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
            d[i] = Math.min(255, Math.round(table[d[i]] * gain));
            d[i + 1] = Math.min(255, Math.round(table[d[i + 1]] * gain));
            d[i + 2] = Math.min(255, Math.round(table[d[i + 2]] * gain));
        }
    }
    return cv;
}

module.exports = { compensateWidget };
