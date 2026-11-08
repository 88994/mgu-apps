'use strict';
// The kit's Ubuntu atlases omit German umlauts. Compose the diacritics from
// the same baked glyphs, before the recorder uploads an atlas to the renderer.
// This is local to this app's process and does not change the shared kit files.
function install() {
    const fonts = require('./kit/fonts');
    if (fonts._equalizerGerman) return;
    const original = fonts.get;
    fonts.get = function (name, size, text) {
        const f = original(name, size, text);
        if (!f || f._equalizerGerman) return f;
        f._equalizerGerman = true;
        const added = [], dot = Math.max(1, Math.round(f.size * 0.075)), gap = Math.max(1, Math.round(f.size * 0.045));
        let x = 0, extraH = 0;
        for (const pair of [['a', 'ä'], ['o', 'ö'], ['u', 'ü'], ['A', 'Ä'], ['O', 'Ö'], ['U', 'Ü']]) {
            const g = f.glyphs[pair[0].charCodeAt(0)]; if (!g) continue;
            const h = g[3] + dot + gap, w = Math.max(g[2], 2 * dot + 3);
            if (x + w >= f.atlasW) break;
            added.push({ code: pair[1].charCodeAt(0), g, x, h, w });
            x += w + 2; extraH = Math.max(extraH, h);
        }
        if (added.length) {
            const oldH = f.atlasH, old = f.alpha, pixels = Buffer.alloc(f.atlasW * (oldH + extraH + 2)); old.copy(pixels);
            for (const a of added) {
                const g = a.g, top = oldH + 1;
                for (let yy = 0; yy < g[3]; yy++) old.copy(pixels,
                    (top + dot + gap + yy) * f.atlasW + a.x, (g[1] + yy) * f.atlasW + g[0], (g[1] + yy) * f.atlasW + g[0] + g[2]);
                for (const dx of [Math.round(a.w * 0.29 - dot / 2), Math.round(a.w * 0.71 - dot / 2)]) {
                    for (let yy = 0; yy < dot; yy++) for (let xx = 0; xx < dot; xx++) pixels[(top + yy) * f.atlasW + a.x + dx + xx] = 255;
                }
                f.glyphs[a.code] = [a.x, top, a.w, a.h, g[4], g[5] - dot - gap, g[6]];
            }
            f.alpha = pixels; f.atlasH = oldH + extraH + 2;
        }
        if (f.glyphs[45]) f.glyphs[0x2212] = f.glyphs[45];
        if (f.glyphs[183]) f.glyphs[0x25cf] = f.glyphs[183];
        f.cacheKey = (f.cacheKey || '') + ':equalizer-de-v1';
        return f;
    };
    fonts._equalizerGerman = true;
}
module.exports = { install };
