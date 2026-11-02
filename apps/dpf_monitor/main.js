'use strict';

// DPF monitor for DDE D83BX7C0. Experimental read-only UDS reads are opt-in.
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./kit/dids');
const { ECU, READINGS } = require('./dpf-dids');
const CBS = 'de.bmw.infotainment.ConditionBasedServicesLegacy';
const W = 1600, H = 520;
const C = { bg: '#0a101b', card: '#182333', text: '#f5f7fb', dim: '#a6b5c9',
    track: '#3b5068', green: '#25d392', badge: '#293442' };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        let page = 0;
        let visible = false, timer = null, busy = false;
        let diag = null, reader = null, diagState = 'Off';
        const values = Object.create(null);
        const reported = Object.create(null);
        const enabled = () => settings.get('dde_live') === 'on' && settings.get('demo') !== 'on';
        const allowed = () => visible && enabled();
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        function latest(name) {
            const item = values[name];
            return item && Date.now() - item.at < 45000 ? item.value : null;
        }
        function number(name, digits) {
            if (!enabled()) return '--';
            const value = latest(name);
            return value === null ? '--' : value.toFixed(digits || 0);
        }
        function schedule(delay) {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            if (allowed() && !busy) timer = setTimeout(pollDde, delay || 0);
        }
        async function pollDde() {
            timer = null;
            if (!allowed() || busy) return;
            busy = true;
            try {
                if (!diag || !diag.p) {
                    diagState = 'Connecting to DDE ...';
                    diag = new Diag(ctx.signals, log);
                    diag.quiet = true;
                    await diag.init();
                    if (diag.p) reader = new DidReader(diag, { ecu: ECU });
                }
                if (!diag || !diag.p || !diag.available) {
                    diagState = 'TASU unavailable';
                    return;
                }
                diagState = 'Reading DDE ...';
                let good = 0;
                for (const field of READINGS) {
                    if (!allowed()) break;
                    const value = await reader.read(field.request);
                    if (value !== null && Number.isFinite(value)) {
                        values[field.name] = { value, at: Date.now() };
                        good++;
                        if (!reported[field.name]) {
                            const raw = reader.raws[reader.key(field.request)];
                            log.info('DDE first response ' + field.name + ' DID ' +
                                field.request.did + ': ' + (raw ? raw.bytes : 'unknown'));
                            reported[field.name] = true;
                        }
                    }
                    await pause(180); // one request at a time; avoid stressing gateway
                }
                diagState = good ? 'DDE readings (unverified)' : 'No DDE response';
                if (!good) log.warn('DDE D83BX7C0: no usable replies');
            } catch (err) {
                diagState = 'Diagnostic error';
                log.warn('DDE read-only polling: ' + err);
            } finally {
                busy = false;
                if (allowed()) schedule(10000);
            }
        }
        ui.onVisible((name, on) => {
            if (name !== 'MAIN') return;
            visible = on;
            if (on) schedule(0);
            else if (timer !== null) { clearTimeout(timer); timer = null; }
        });
        settings.onChange((key) => {
            if (key !== 'dde_live' && key !== 'demo') return;
            if (!enabled()) {
                diagState = 'Off';
                Object.keys(values).forEach((name) => delete values[name]);
                if (timer !== null) { clearTimeout(timer); timer = null; }
            } else schedule(0);
        });

        ctx.signals.watch(CBS, '1', {
            cBSMessageParticleFilter: () => {
                // CBS is a service reminder, not a DPF measurement or regeneration event.
                log.info('DPF CBS service notification received');
            },
        }, log).then((sub) => {
            if (sub.error) log.warn('DPF CBS unavailable: ' + sub.error);
        }).catch((err) => log.warn('DPF CBS subscription: ' + err));
        ui.onClick('BTN_PAGE', () => { page = (page + 1) % 3; });
        // Header tabs are drawn by G.frame. The renderer only routes their taps
        // when an onTab handler exists; without it they look active but do nothing.
        if (typeof ctx.onTab === 'function') ctx.onTab((index) => {
            if (Number.isInteger(index) && index >= 0 && index < 3) page = index;
        });

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
            else if (enabled()) badge(cv, 'DDE TEST', 1370, 61, 178);
        }
        function footer(cv, demo, text) {
            label(cv, demo ? 'Simulated values - not from the vehicle' : text,
                50, 494, 22, C.dim);
        }
        function tile(cv, x, y, title, value, unit) {
            card(cv, x, y, 736, 132);
            label(cv, title, x + 27, y + 44, 24, C.dim);
            const width = label(cv, value, x + 27, y + 104, 43, C.text, { font: 'bold' });
            if (unit && value !== '--') label(cv, unit, x + 36 + width, y + 104, 22, C.dim);
        }
        function live(cv, demo) {
            tile(cv, 43, 112, 'Soot mass', demo ? '18.4' : number('soot', 1), 'g');
            tile(cv, 821, 112, 'Differential pressure', demo ? '24' : number('pressure', 1), 'mbar');
            tile(cv, 43, 254, 'Exhaust temperature', demo ? '312' : number('temperature', 0), '°C');
            tile(cv, 821, 254, 'Since last regen', demo ? '287' : number('distance', 1), 'km');
            card(cv, 43, 396, 1514, 68);
            label(cv, 'Regeneration activity', 70, 439, 28);
            // There is no validated active-regeneration flag in the supplied
            // DDE data. Never draw a fake progress bar or infer an active cycle.
            badge(cv, demo ? 'Inactive (demo)' : 'Not decoded', 1258, 409, 264);
            footer(cv, demo, enabled() ? diagState : 'Enable DDE read test in Settings');
        }
        function row(cv, y, left, right) {
            label(cv, left, 73, y, 28, C.dim);
            label(cv, right, 1510, y, 28, C.text, { align: 'right', font: 'bold' });
        }
        function regeneration(cv, demo) {
            card(cv, 43, 112, 1514, 352);
            badge(cv, demo ? 'Inactive (demo)' : 'No verified activity flag',
                70, 131, demo ? 350 : 399);
            const ash = number('ash', 1);
            row(cv, 238, 'Filter oil-ash load (lifetime)', demo ? '15.5 g' : ash === '--' ? '--' : ash + ' g');
            cv.fillRect(70, 264, 1440, 1, C.track);
            const t = number('temperature', 0);
            row(cv, 335, 'Exhaust temperature (reading)', demo ? '312 °C' : t === '--' ? '--' : t + ' °C');
            cv.fillRect(70, 360, 1440, 1, C.track);
            const d = number('distance', 1);
            row(cv, 427, 'Distance since last regen', demo ? '287 km' : d === '--' ? '--' : d + ' km');
            footer(cv, demo, 'Oil ash is a filter-load estimate, not a past regeneration event');
        }
        function history(cv, demo) {
            card(cv, 43, 112, 1514, 352);
            label(cv, demo ? 'Simulated regeneration events' : 'Recorded regeneration events',
                72, 162, 29, C.text, { font: 'bold' });
            if (!demo) {
                label(cv, 'No verified regeneration event log has been recorded.',
                    72, 264, 29, C.text);
                label(cv, 'The DDE values alone cannot reconstruct event dates or durations.',
                    72, 331, 24, C.dim);
                label(cv, 'Event recording requires a validated active-regeneration flag.',
                    72, 399, 23, C.dim);
                footer(cv, false, 'No invented regeneration timestamps or durations');
                return;
            }
            [['287 km ago', '14 min'], ['601 km ago', '18 min'], ['924 km ago', '16 min']]
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
            G.frame(cv, ctx.theme(), ['Live', 'Regeneration', 'History'], page, []);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 2, render);
        render().catch((err) => log.warn('DPF first frame: ' + err));
    },
});
