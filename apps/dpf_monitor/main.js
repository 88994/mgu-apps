'use strict';

// Read-only DPF display. No DDE diagnostic request or ECU write is performed.
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const CBS = 'de.bmw.infotainment.ConditionBasedServicesLegacy';
const W = 1600, H = 520;
const C = { bg: '#0a101b', card: '#182333', text: '#f5f7fb', dim: '#a6b5c9',
    track: '#3b5068', green: '#25d392', badge: '#293442' };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        let page = 0;
        ctx.signals.watch(CBS, '1', {
            cBSMessageParticleFilter: () => {
                // CBS is a service reminder, not a DPF measurement or regeneration event.
                log.info('DPF CBS service notification received');
            },
        }, log).then((sub) => {
            if (sub.error) log.warn('DPF CBS unavailable: ' + sub.error);
        }).catch((err) => log.warn('DPF CBS subscription: ' + err));
        ui.onClick('BTN_PAGE', () => { page = (page + 1) % 3; });

        function card(cv, x, y, w, h, colour) {
            cv.roundRect(x, y, w, h, 17, colour || C.card);
        }
        function label(cv, txt, x, y, size, colour, opt) {
            return cv.text(txt, x, y, size, colour || C.text, Object.assign({ literal: true }, opt || {}));
        }
        function badge(cv, txt, x, y, w) {
            card(cv, x, y, w, 35, C.badge);
            label(cv, txt, x + w / 2, y + 26, 20, C.text, { align: 'center' });
        }
        function heading(cv, demo) {
            label(cv, 'DPF MONITOR', 50, 93, 29, C.text, { font: 'bold' });
            if (demo) badge(cv, 'DEMO', 1420, 61, 128);
        }
        function footer(cv, demo, text) {
            label(cv, demo ? 'Beispielwerte – keine echten Fahrzeugdaten' : text,
                50, 494, 22, C.dim);
        }
        function tile(cv, x, y, title, value, unit) {
            card(cv, x, y, 736, 132);
            label(cv, title, x + 27, y + 44, 24, C.dim);
            const width = label(cv, value, x + 27, y + 104, 43, C.text, { font: 'bold' });
            if (unit && value !== '--') label(cv, unit, x + 36 + width, y + 104, 22, C.dim);
        }
        function live(cv, demo) {
            tile(cv, 43, 112, 'Russmasse', demo ? '18,4' : '--', 'g');
            tile(cv, 821, 112, 'Differenzdruck', demo ? '24' : '--', 'mbar');
            tile(cv, 43, 254, 'Abgastemperatur', demo ? '312' : '--', '°C');
            tile(cv, 821, 254, 'Seit letzter Reg.', demo ? '287' : '--', 'km');
            card(cv, 43, 396, 1514, 68);
            label(cv, 'Regenerationsstatus', 70, 439, 28);
            badge(cv, demo ? 'Inaktiv' : 'Unbekannt', 1325, 409, 195);
            cv.roundRect(70, 451, 1450, 6, 3, C.track);
            footer(cv, demo, 'DPF-Datenquelle noch nicht verifiziert');
        }
        function row(cv, y, left, right) {
            label(cv, left, 73, y, 28, C.dim);
            label(cv, right, 1510, y, 28, C.text, { align: 'right', font: 'bold' });
        }
        function regeneration(cv, demo) {
            card(cv, 43, 112, 1514, 352);
            badge(cv, demo ? 'Keine aktive Regeneration' : 'Regeneration unbekannt',
                70, 131, demo ? 368 : 322);
            row(cv, 238, 'Regeneration angefordert', demo ? 'Nein' : '--');
            cv.fillRect(70, 264, 1440, 1, C.track);
            row(cv, 335, 'Abgastemperatur', demo ? '312 °C' : '--');
            cv.fillRect(70, 360, 1440, 1, C.track);
            row(cv, 427, 'Letzte Regeneration', demo ? '287 km' : '--');
            footer(cv, demo, 'Regenerationsdaten noch nicht vorhanden');
        }
        function history(cv, demo) {
            card(cv, 43, 112, 1514, 352);
            label(cv, 'Regenerationshistorie', 72, 162, 29, C.text, { font: 'bold' });
            if (!demo) {
                label(cv, 'Noch keine verifizierten Regenerationsereignisse', 72, 256, 28, C.dim);
                footer(cv, false, 'Die App zeichnet derzeit keine DDE-Historie auf');
                return;
            }
            [['vor 287 km', '14 min'], ['vor 601 km', '18 min'], ['vor 924 km', '16 min']]
                .forEach(([distance, duration], i) => {
                    const y = 239 + i * 76;
                    cv.circle(85, y - 9, 12, C.green);
                    label(cv, '✓', 85, y - 3, 17, C.bg, { align: 'center', font: 'bold' });
                    label(cv, distance, 118, y, 28);
                    label(cv, duration, 1509, y, 26, C.dim, { align: 'right' });
                });
            footer(cv, true);
        }
        function render() {
            const cv = ctx.canvas(W, H).clear(C.bg);
            const demo = settings.get('demo') === 'on';
            heading(cv, demo);
            if (page === 0) live(cv, demo);
            else if (page === 1) regeneration(cv, demo);
            else history(cv, demo);
            G.frame(cv, ctx.theme(), ['Live', 'Regeneration', 'Historie'], page, []);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 2, render);
        render().catch((err) => log.warn('DPF first frame: ' + err));
    },
});
