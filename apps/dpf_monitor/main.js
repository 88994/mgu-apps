'use strict';

// DPF monitor for DDE D83BX7C0. Only genuine, read-only UDS data is shown.
const fs = require('fs');
const path = require('path');
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
        let pollRound = 0;
        const values = Object.create(null);
        // Real measurements only. No regeneration events are fabricated from
        // soot mass or distance alone. Retain a small chronological sample log.
        const historyFile = path.join(ctx.dataDir, 'dpf_readings.json');
        let history = [];
        try {
            const saved = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
            if (Array.isArray(saved)) history = saved.filter(v =>
                v && Number.isFinite(v.at) && v.at > 0 && v.at < 8640000000000000).slice(0, 50);
        } catch (e) { /* no previous samples */ }
        function recordSample() {
            const now = Date.now();
            if (history.length && now - history[0].at < 3 * 60000) return;
            const sample = { at: now, soot: latest('soot'), ash: latest('ash'),
                pressure: latest('pressure'), temperature: latest('temperature'),
                distance: latest('distance') };
            if (sample.soot === null && sample.ash === null && sample.pressure === null &&
                sample.distance === null && sample.temperature === null) return;
            history.unshift(sample);
            history = history.slice(0, 50);
            const tmp = historyFile + '.tmp-' + process.pid;
            try {
                fs.mkdirSync(ctx.dataDir, { recursive: true });
                fs.writeFileSync(tmp, JSON.stringify(history));
                fs.renameSync(tmp, historyFile);
            } catch (e) { log.warn('DPF history save failed: ' + e); }
        }
        const reported = Object.create(null);
        const reportedFailures = Object.create(null);
        const allowed = () => visible;
        const statusText = () => 'DDE: ' + diagState;
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        function latest(name) {
            const item = values[name];
            return item && Date.now() - item.at <
                (READINGS.find(x => x.name === name && x.tier === 'secondary') ? 180000 : 50000) ? item.value : null;
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
                const secondarySlot = (++pollRound % 3);
                let secondaryIndex = 0;
                for (const field of READINGS) {
                    if (field.tier === 'secondary' && (secondaryIndex++ % 3) !== secondarySlot) continue;
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
                if (good) recordSample();
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
        ui.onClick('BTN_PAGE', () => { page = (page + 1) % 4; });
        // Header tabs are drawn by G.frame. The renderer only routes their taps
        // when an onTab handler exists; without it they look active but do nothing.
        if (typeof ctx.onTab === 'function') ctx.onTab((index) => {
            if (Number.isInteger(index) && index >= 0 && index < 4) page = index;
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
        function detailLine(cv, x, y, caption, reading, unit) {
            label(cv, caption, x + 24, y, 22, C.dim);
            label(cv, reading === '--' ? '--' : reading + (unit ? ' ' + unit : ''),
                x + 705, y, 26, C.text, { align: 'right', font: 'bold' });
            if (y < 395) cv.fillRect(x + 24, y + 12, 684, 1, C.track);
        }
        // Fast overview on the first tab; the supporting PRG values are
        // grouped separately so a driver does not have to read a raw list.
        function details(cv) {
            card(cv, 43, 112, 736, 350);
            card(cv, 821, 112, 736, 350);
            label(cv, 'FILTER LOADING', 73, 152, 25, C.text, { font: 'bold' });
            label(cv, 'SENSORS / PRESSURE', 851, 152, 25, C.text, { font: 'bold' });
            detailLine(cv, 43, 211, 'Soot calculated', number('soot', 1), 'g');
            detailLine(cv, 43, 274, 'Soot measured', number('sootMeasured', 1), 'g');
            detailLine(cv, 43, 337, 'Soot model', number('sootModel', 1), 'g');
            detailLine(cv, 43, 400, 'Oil-ash load', number('ash', 1), 'g');
            detailLine(cv, 821, 211, 'DPF differential', number('pressure', 1), 'mbar');
            detailLine(cv, 821, 274, 'Filtered differential', number('pressureFiltered', 1), 'mbar');
            detailLine(cv, 821, 337, 'Temperature before DPF', number('temperature', 0), 'C');
            detailLine(cv, 821, 400, 'Time since regen', number('regenHours', 1), 'h');
            label(cv, statusText().slice(0, 117), 52, 490, 19, C.dim);
        }
        function regeneration(cv) {
            card(cv, 43, 112, 736, 350);
            card(cv, 821, 112, 736, 350);
            label(cv, 'REGENERATION HISTORY / ECU', 73, 152, 25, C.text, { font: 'bold' });
            detailLine(cv, 43, 211, 'Distance since last', number('distance', 1), 'km');
            detailLine(cv, 43, 274, 'Hours since last', number('regenHours', 1), 'h');
            detailLine(cv, 43, 337, 'Average interval', number('regenAverage', 0), 'km');
            detailLine(cv, 43, 400, 'Successful total', number('regenCount', 0), '');
            label(cv, 'REQUEST / SAFETY', 851, 152, 25, C.text, { font: 'bold' });
            label(cv, 'DDE request code: ' + number('regenRequestCode', 0), 851, 209, 24, C.dim);
            label(cv, 'DDE inhibit code: ' + number('regenInhibitCode', 0), 851, 258, 24, C.dim);
            label(cv, 'REQUEST DISABLED', 851, 327, 30, '#f0af67', { font: 'bold' });
            label(cv, 'D83BX7C0.prg has no validated request routine.', 851, 375, 20, C.text);
            label(cv, 'Use ISTA service function with verified preconditions.', 851, 420, 19, C.dim);
            label(cv, 'Raw status codes are not equivalent to regen ON/OFF.', 52, 490, 19, C.dim);
        }
        function readingHistory(cv) {
            card(cv, 43, 112, 736, 350);
            card(cv, 821, 112, 736, 350);
            label(cv, 'LAST 5 REGENERATIONS (DDE)', 73, 152, 25, C.text, { font: 'bold' });
            for (let n = 1; n <= 5; n++) {
                const y = 212 + (n - 1) * 48;
                label(cv, n === 1 ? 'Last successful regen' : n + ' regens ago', 73, y, 22, C.dim);
                const v = number('regenOdo' + n, 1);
                label(cv, v === '--' ? '--' : v + ' km', 746, y, 25, C.text,
                    { align: 'right', font: 'bold' });
            }
            label(cv, 'RECORDED LIVE SAMPLES', 851, 152, 25, C.text, { font: 'bold' });
            if (!history.length) {
                label(cv, 'No live samples saved yet.', 851, 233, 24, C.dim);
            } else {
                for (let i = 0; i < Math.min(4, history.length); i++) {
                    const e = history[i], y = 213 + i * 57;
                    const d = new Date(e.at).toISOString().slice(5, 16).replace('T', ' ');
                    const soot = Number.isFinite(e.soot) ? e.soot.toFixed(1) + ' g' : '--';
                    const pressure = Number.isFinite(e.pressure) ? e.pressure.toFixed(1) + ' mbar' : '--';
                    label(cv, d + ' UTC', 851, y, 21, C.dim);
                    label(cv, soot + '  /  ' + pressure, 1524, y, 22, C.text,
                        { align: 'right', font: 'bold' });
                }
            }
            label(cv, 'Mileage is reported by the DDE, not inferred from saved samples.',
                52, 490, 19, C.dim);
        }
        function render() {
            const cv = ctx.canvas(W, H).clear(C.bg);
            heading(cv);
            if (page === 0) live(cv);
            else if (page === 1) details(cv);
            else if (page === 2) readingHistory(cv);
            else regeneration(cv);
            G.frame(cv, ctx.theme(), ['Overview', 'Details', 'History', 'Regeneration'], page, []);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 2, render);
        render().catch((err) => log.warn('DPF first frame: ' + err));
    },
});
