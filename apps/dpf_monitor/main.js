'use strict';

// DPF monitor for DDE D83BX7C0. Only genuine, read-only UDS data is shown.
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
        // Start read-only polling even if an initial HMI Visible event was
        // missed while the app was loading. Later hide events still stop it.
        let visible = true, timer = null, busy = false;
        let diag = null, reader = null, diagState = 'Connecting';
        let identityChecked = false;
        const values = Object.create(null);
        const reported = Object.create(null);
        const reportedFailures = Object.create(null);
        const allowed = () => visible;
        const statusText = () => 'DDE: ' + diagState;
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        function latest(name) {
            const item = values[name];
            return item && Date.now() - item.at < 45000 ? item.value : null;
        }
        function number(name, digits) {
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
                let good = 0, firstFailure = '';
                for (const field of READINGS) {
                    if (!allowed()) break;
                    const value = await reader.read(field.request);
                    const raw = reader.raws[reader.key(field.request)];
                    if (value !== null && Number.isFinite(value)) {
                        values[field.name] = { value, at: Date.now() };
                        good++;
                        if (!reported[field.name]) {
                            log.info('DDE first response ' + field.name + ' DID ' +
                                field.request.did + ': ' + (raw ? raw.bytes : 'unknown'));
                            reported[field.name] = true;
                        }
                    } else if (raw && raw.why) {
                        if (!firstFailure) firstFailure = field.name + ': ' + raw.why;
                        if (!reportedFailures[field.name]) {
                            log.warn('DDE read ' + field.name + ' DID ' +
                                field.request.did + ': ' + raw.why);
                            reportedFailures[field.name] = true;
                        }
                    }
                    await pause(180); // one request at a time; avoid stressing gateway
                }
                diagState = good ? 'Live data received from ECU 0x' + reader.ecu.toString(16).toUpperCase() :
                    'No usable DDE response' + (firstFailure ? ' (' + firstFailure + ')' : '');
                // The engine ECU is the unit which answers the standard OBD
                // engine-speed PID 01 0C (41 0C A B). The BMW SGBD index
                // from 22 F150 is numeric and cannot be decoded as a name.
                // This is one read-only functional discovery per app start.
                if (!good && !identityChecked && allowed()) {
                    identityChecked = true;
                    diagState = 'Checking DDE diagnostic address ...';
                    try {
                        const found = await diag.functional(0x01, [0x0C], {
                            idleMs: 1500, maxMs: 9000,
                        });
                        const engines = [];
                        for (const [address, uds] of found) {
                            if (uds && uds.length >= 4 && uds[0] === 0x41 && uds[1] === 0x0C)
                                engines.push(address);
                        }
                        if (engines.length === 1) {
                            reader.ecu = engines[0];
                            diagState = 'Engine ECU responding at 0x' +
                                reader.ecu.toString(16).toUpperCase() + '; checking DPF DIDs';
                            log.info('DPF read-only engine address: 0x' +
                                reader.ecu.toString(16).toUpperCase());
                        } else {
                            diagState = engines.length ? 'Engine ECU ambiguous; keeping address 0x12' :
                                'Engine ECU not responding; check ignition / DDE connection';
                        }
                    } catch (err) {
                        diagState = 'DDE address check failed: ' + String(err.message || err);
                        log.warn('DDE identification: ' + err);
                    }
                }
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
        // A Renderd-backed page may already be visible before its callback is
        // registered. The first polling attempt must not depend on it.
        schedule(1500);
        ctx.signals.watch(CBS, '1', {
            cBSMessageParticleFilter: () => {
                // CBS is a service reminder, not a DPF measurement or regeneration event.
                log.info('DPF CBS service notification received');
            },
        }, log).then((sub) => {
            if (sub.error) log.warn('DPF CBS unavailable: ' + sub.error);
        }).catch((err) => log.warn('DPF CBS subscription: ' + err));
        ui.onClick('BTN_PAGE', () => { page = (page + 1) % 2; });
        // Header tabs are drawn by G.frame. The renderer only routes their taps
        // when an onTab handler exists; without it they look active but do nothing.
        if (typeof ctx.onTab === 'function') ctx.onTab((index) => {
            if (Number.isInteger(index) && index >= 0 && index < 2) page = index;
        });

        function card(cv, x, y, w, h, colour) {
            cv.roundRect(x, y, w, h, 17, colour || C.card);
        }
        function label(cv, txt, x, y, size, colour, opt) {
            return cv.text(txt, x, y, size, colour || C.text, Object.assign({ literal: true }, opt || {}));
        }
        function heading(cv) {
            label(cv, 'DPF MONITOR', 50, 93, 29, C.text, { font: 'bold' });
        }
        function tile(cv, x, y, title, value, unit) {
            card(cv, x, y, 736, 164);
            label(cv, title, x + 27, y + 44, 24, C.dim);
            const width = label(cv, value, x + 27, y + 120, 43, C.text, { font: 'bold' });
            if (unit && value !== '--') label(cv, unit, x + 36 + width, y + 120, 22, C.dim);
        }
        function live(cv) {
            tile(cv, 43, 112, 'Soot mass', number('soot', 1), 'g');
            tile(cv, 821, 112, 'Differential pressure', number('pressure', 1), 'mbar');
            tile(cv, 43, 290, 'Exhaust temperature', number('temperature', 0), '°C');
            tile(cv, 821, 290, 'Since last regen', number('distance', 1), 'km');
            if (latest('soot') === null && latest('pressure') === null)
                label(cv, statusText().slice(0, 86), 50, 490, 19, C.dim);
        }
        function row(cv, y, left, right) {
            label(cv, left, 73, y, 28, C.dim);
            label(cv, right, 1510, y, 28, C.text, { align: 'right', font: 'bold' });
        }
        function regeneration(cv) {
            card(cv, 43, 112, 1514, 352);
            label(cv, 'DPF load and regeneration data', 72, 164, 29, C.text, { font: 'bold' });
            const ash = number('ash', 1);
            row(cv, 238, 'Filter oil-ash load (lifetime)', ash === '--' ? '--' : ash + ' g');
            cv.fillRect(70, 264, 1440, 1, C.track);
            const t = number('temperature', 0);
            row(cv, 335, 'Exhaust temperature (reading)', t === '--' ? '--' : t + ' °C');
            cv.fillRect(70, 360, 1440, 1, C.track);
            const d = number('distance', 1);
            row(cv, 427, 'Distance since last regen', d === '--' ? '--' : d + ' km');
            if (latest('ash') === null && latest('temperature') === null)
                label(cv, statusText().slice(0, 86), 50, 490, 19, C.dim);
        }
        function render() {
            const cv = ctx.canvas(W, H).clear(C.bg);
            heading(cv);
            if (page === 0) live(cv);
            else regeneration(cv);
            G.frame(cv, ctx.theme(), ['Live', 'Regeneration'], page, []);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 2, render);
        render().catch((err) => log.warn('DPF first frame: ' + err));
    },
});
