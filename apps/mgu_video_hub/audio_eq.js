'use strict';
const DSP = require('./kit/dsp-client');
// An in-app sheet keeps the Video Hub's existing stop-on-leave/focus rules.
// It changes the running PCM DSP without opening a second OAP app.
async function openEq(ctx) {
    let status = await DSP.request({ op: 'status' }), band = 0, focus = 0, busy = false, note = '';
    const names = ['Band waehlen', 'Gain -0.5 dB', 'Gain +0.5 dB', 'DSP ein / Bypass', 'Fertig'];
    async function act(i) {
        if (busy) return;
        if (i === 0) { band = (band + 1) % 7; return; }
        if (i === 4) return 'close';
        busy = true;
        try {
            const config = JSON.parse(JSON.stringify(status.config));
            if (i === 3) config.enabled = !config.enabled;
            else config.bands[band].gainDb = Math.max(-12, Math.min(12, config.bands[band].gainDb + (i === 1 ? -0.5 : 0.5)));
            status = await DSP.request({ op: 'set', config, expectedRevision: status.revision });
            note = config.enabled ? 'PCM-DSP aktiv' : 'Bypass';
        } catch (e) {
            note = 'EQ: ' + String(e.message || e).slice(0, 80);
            try { status = await DSP.request({ op: 'status' }); } catch (_) {}
        } finally { busy = false; }
    }
    const sheet = {
        title: 'Audio DSP',
        draw(r, theme) {
            r.clear('#07111d'); const b = status.config.bands[band];
            r.text('LIVE PCM EQUALIZER', 60, 100, 36, '#eef5ff');
            r.text('Band ' + (band + 1) + ' / 7  |  ' + b.frequencyHz + ' Hz  |  Q ' + b.q.toFixed(1), 60, 167, 28, '#a5c7e8');
            r.text((b.gainDb > 0 ? '+' : '') + b.gainDb.toFixed(1) + ' dB', 60, 240, 54, '#7bc6ff', { font: 'num' });
            r.text(status.config.enabled ? 'DSP eingeschaltet' : 'Bypass: unveraenderte PCM-Daten', 60, 299, 25, '#d3e5f7');
            r.text('Nur verbundene PCM-Apps. Stock-CarPlay und Radio sind nicht angebunden.', 60, 350, 23, '#90a1b6');
            r.text(busy ? 'Wird gespeichert ...' : note, 60, 393, 23, '#ffbd69');
            return names.map((label, i) => {
                const x = 48 + i * 307, y = 430, w = 290, h = 60;
                r.roundRect(x, y, w, h, 12, i === focus ? '#244c76' : '#182738');
                r.text(label, x + w / 2, y + 39, 23, '#ffffff', { align: 'center' });
                return { x, y, w, h, act: () => { focus = i; return act(i); } };
            });
        },
        move(d) { focus = (focus + d + names.length * 10) % names.length; },
        press() { return act(focus); }, back() { return 'close'; },
    };
    if (!ctx.sheet(sheet)) throw new Error('Live-EQ braucht den GPU-Renderer. Profile vorher in der Equalizer-App einstellen.');
}
module.exports = { openEq };
