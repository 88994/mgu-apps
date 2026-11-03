'use strict';

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const B = require('./logic');
const { ComfortAuto } = require('./comfort_auto');
const { SafeDiag, bytes } = require('./safe_diag');

// Settings is automatically provided as ONE native tab by the renderer.
const TABS = ['Comfort', 'Diagnostics'];
const text = (cv, s, x, y, size, color, opts) =>
    cv.text(String(s), x, y, size, color, opts || {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

mgu.run({
    async start(ctx) {
        ctx.log.info('[WHEELHEAT] all ECU writes require explicit automatic heating opt-in');
        const ctl = new SafeDiag(ctx, B.ECU, B.DID_HEAT);
        const auto = new ComfortAuto();
        // Prevent a crash/restart of the OAP process from immediately
        // triggering another physical heating cycle in the same cold start.
        const previousCycle = Number(ctx.settings.get('_autoCycleAt'));
        if (Number.isFinite(previousCycle) && previousCycle > 0 &&
            Date.now() >= previousCycle && Date.now() - previousCycle < 30 * 60000)
            auto.fired = true;
        let cycleSaved = false;
        const outside = { value: null, at: 0, raw: null };
        const acknowledged = new Set();
        let tab = 0, busy = false, statusBusy = false, statusAt = 0;
        let lastAction = 'No heating command has been sent.';
        const setTab = i => {
            if (Number.isInteger(i) && i >= 0 && i < TABS.length) {
                tab = i;
                if (tab === 1) refreshReadbacks().catch(e => { ctl.info = 'BDC read error: ' + e.message; });
            }
        };

        // Use only a real, fresh MGU outdoor temperature. No test/simulated
        // values can reach the automatic ECU actuator.
        ctx.signals.watch('de.bmw.infrastructure.EnvironmentalInformation', '1', {
            ExteriorTemperature: v => {
                const raw = v && v.temperatureExterior;
                const temp = B.exteriorTemp(raw);
                if (temp !== null && temp >= -40 && temp <= 60) {
                    if (outside.value !== temp || outside.raw !== raw)
                        ctx.log.info('[WHEELHEAT TEMP] raw=' + raw + ' decoded=' +
                            temp + 'C threshold=' + ctx.settings.get('belowTemp'));
                    outside.value = temp;
                    outside.raw = raw;
                    outside.at = Date.now();
                }
            },
        }, ctx.log).catch(e => ctx.log.warn('Outdoor temperature: ' + e));

        const config = () => ({
            autoEnabled: ctx.settings.get('autoEnabled') === true,
            belowTemp: Number(ctx.settings.get('belowTemp')),
            coldDwell: 15,
            wheelAuto: ctx.settings.get('wheelAuto') === true,
            wheelMins: Number(ctx.settings.get('wheelMins')),
            seatDriver: ctx.settings.get('seatDriver') === true,
            seatPassenger: ctx.settings.get('seatPassenger') === true,
            seatLevel: Number(ctx.settings.get('seatLevel')),
            seatMins: Number(ctx.settings.get('seatMins')),
        });
        // The one visible automatic-heating switch is explicit consent for
        // guarded control. Preserve its saved value across app updates.
        const permitted = () => ctx.settings.get('autoEnabled') === true;
        const tempReading = now => B.temperatureInput(outside.value, outside.at, false, null, now);

        // A planner event is not a live heater state. Report an actual request
        // only if the BDC positively acknowledged it. The vehicle's physical
        // response remains unverified until an on-car test.
        async function sendIntent(intent) {
            if (intent.type === 'OFF' && !acknowledged.has(intent.device)) return false;
            if (!permitted() || !ctl.online || !ctl.parked) {
                lastAction = intent.device + ': NOT sent (permission / BDC / stationary check).';
                ctx.log.warn('[AUTO BLOCKED] ' + lastAction);
                return false;
            }
            const data = intent.device === 'Steering wheel'
                ? B.heating(intent.data.seconds)
                : B.seat(intent.data.side, intent.data.level,
                    intent.type === 'OFF' ? 0 : intent.data.seconds);

            // BDC is polled before every 2E write. Commands are serialized with
            // >=3s between writes. Driving away or losing vehicle speed blocks it.
            const remaining = 3000 - (Date.now() - ctl.lastWriteAt);
            if (remaining > 0) await wait(remaining);
            if (!permitted() || !ctl.parked || !ctl.online) {
                lastAction = intent.device + ': NOT sent (conditions changed).';
                return false;
            }
            if (!ctl.verified) await ctl.read(B.DID_HEAT);
            if (!ctl.verified || !ctl.parked || !permitted()) {
                lastAction = intent.device + ': NOT sent (' + ctl.info + ').';
                return false;
            }
            const ok = await ctl.autoWrite(data, intent.device + ' ' + intent.type);
            lastAction = (ok ? 'BDC ACK' : 'NOT CONFIRMED') + ': ' + intent.device + ' ' +
                intent.type + ' (2E ' + bytes(data) + ')';
            ctx.log.info('[AUTO LIVE] ' + lastAction);
            if (ok && (intent.type === 'ON' || intent.type === 'EXTEND')) acknowledged.add(intent.device);
            if (ok && intent.type === 'OFF') acknowledged.delete(intent.device);
            if (ok && intent.type === 'ON' && !cycleSaved) {
                cycleSaved = true;
                ctx.settings.set('_autoCycleAt', Date.now());
            }
            return ok;
        }

        // Read independently of the planner and the last 2E commands.
        // BDC_G05.prg explicitly documents the 22 D074 / E432 / E430
        // result fields and their byte order. Show only valid decoded states.
        async function refreshReadbacks() {
            if (statusBusy || busy || !ctl.online) return;
            statusBusy = true;
            try {
                for (const did of [B.DID_HEAT, B.DID_SEAT_DRIVER, B.DID_SEAT_PASSENGER]) {
                    if (!ctl.online) break;
                    await ctl.read(did);
                    const reply = ctl.readbacks[did];
                    if (reply) ctx.log.info('[HEATER STATUS SNAPSHOT] DID 0x' +
                        did.toString(16).toUpperCase() + ' ' +
                        (reply.ok ? reply.raw : reply.error));
                }
                statusAt = Date.now();
            } finally { statusBusy = false; }
        }
        setInterval(() => {
            if (tab === 1) refreshReadbacks().catch(e => ctx.log.warn('Readback: ' + e));
        }, 15000);

        async function autoStep() {
            if (busy || statusBusy) return;
            busy = true;
            try {
                const now = Date.now(), cfg = config(), reading = tempReading(now);
                const canStart = cfg.autoEnabled && permitted() && ctl.online && ctl.parked;
                // Continue an acknowledged session's timer when the car moves;
                // no new commands are sent while speed cannot be confirmed zero.
                const enabledForPlanner = cfg.autoEnabled && (canStart || auto.active.size > 0);
                const intents = auto.step({ now, tempC: reading.value, tempAt: reading.at,
                    cfg: Object.assign({}, cfg, { autoEnabled: enabledForPlanner }) });
                for (const intent of intents) {
                    const ok = await sendIntent(intent);
                    auto.acknowledge(intent, ok, Date.now());
                }
            } catch (e) {
                lastAction = 'Automatic heating error: ' + (e.message || String(e));
                ctx.log.warn(lastAction);
            } finally { busy = false; }
        }
        setInterval(() => { autoStep().catch(e => ctx.log.error(e)); }, 1000);
        autoStep().catch(e => ctx.log.error(e));

        ctx.ui.onClick('BTN_PAGE', () => setTab((tab + 1) % TABS.length));
        ctx.ui.onClick('BTN_ACTION', () => {
            if (tab === 0) setTab(1);
            else refreshReadbacks().catch(e => { ctl.info = 'Read error: ' + e.message; });
        });
        if (typeof ctx.onTab === 'function') ctx.onTab(setTab);
        ctl.init().catch(e => { ctl.info = 'TASU unavailable: ' + e; });

        ctx.loop('MAIN', 5, () => {
            const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
            const now = Date.now(), c = config(), r = tempReading(now);
            const fresh = r.value !== null && now - r.at <= 120000;
            const temp = fresh ? r.value.toFixed(1) + ' °C' : 'unavailable';
            const startReady = c.autoEnabled && permitted() && ctl.online && ctl.parked && fresh;
            const status = !c.autoEnabled ? 'AUTOMATION OFF'
                    : auto.active.size ? 'HEATING SCHEDULE ACTIVE'
                    : !fresh ? 'WAITING FOR OUTDOOR TEMPERATURE'
                        : !ctl.online ? 'BDC CONNECTION UNAVAILABLE'
                            : !ctl.parked ? 'WAITING FOR CONFIRMED STANDSTILL'
                                : auto.fired ? 'CYCLE FINISHED' : 'READY / WAITING FOR COLD';
            G.frame(cv, t, TABS, tab,
                [{ text: auto.active.size ? 'AUTO SCHEDULED' :
                    startReady ? 'AUTO READY' : 'AUTO NOT READY', color: t.dim }]);
            if (tab === 0) {
                G.panel(cv, t, 24, 62, 743, 445, 'Automatic heating');
                text(cv, status, 54, 148, 32, auto.active.size ? t.warn : t.accent, { font: 'bold' });
                text(cv, 'Outdoor ' + temp + '    Start at or below ' + c.belowTemp + ' °C',
                    54, 205, 27, t.text);
                cv.fillRect(54, 226, 667, 2, '#2e4052');
                text(cv, 'Steering wheel', 54, 273, 27, t.text);
                text(cv, c.wheelAuto ? c.wheelMins + ' min' : 'Off', 693, 273, 26,
                    c.wheelAuto ? t.accent : t.dim, { align: 'right' });
                text(cv, 'Driver seat', 54, 319, 27, t.text);
                text(cv, c.seatDriver ? 'Level ' + c.seatLevel + ' / ' + c.seatMins + ' min' : 'Off',
                    693, 319, 25, c.seatDriver ? t.accent : t.dim, { align: 'right' });
                text(cv, 'Passenger seat', 54, 365, 27, t.text);
                text(cv, c.seatPassenger ? 'Level ' + c.seatLevel + ' / ' + c.seatMins + ' min' : 'Off',
                    693, 365, 25, c.seatPassenger ? t.accent : t.dim, { align: 'right' });
                G.panel(cv, t, 788, 62, 788, 445, 'Heating overview');
                text(cv, 'BDC  ' + (ctl.online ? 'CONNECTED' : 'UNAVAILABLE'), 820, 149, 29,
                    ctl.online ? t.accent : t.warn, { font: 'bold' });
                text(cv, 'Steering wheel: ' + (c.wheelAuto ? c.wheelMins + ' min selected' : 'Off'),
                    820, 219, 26, t.text);
                text(cv, 'Driver seat: ' + (c.seatDriver ? c.seatMins + ' min / level ' + c.seatLevel : 'Off'),
                    820, 276, 26, t.text);
                text(cv, 'Passenger seat: ' + (c.seatPassenger ? c.seatMins + ' min / level ' + c.seatLevel : 'Off'),
                    820, 333, 26, t.text);
                cv.fillRect(820, 356, 710, 1, '#2e4052');
                text(cv, 'Remaining scheduled time', 820, 406, 22, t.dim);
                text(cv, 'Wheel ' + auto.remaining('Steering wheel', now) + 's   Seats ' +
                    Math.max(auto.remaining('Driver seat', now),
                        auto.remaining('Passenger seat', now)) + 's', 820, 453, 30, t.accent);
                if (ctx.settings.saveError)
                    text(cv, 'Settings could not be saved; see log', 820, 482, 20, t.warn);
            } else {
                G.panel(cv, t, 24, 62, 1552, 445, 'Actual BDC read-back (read-only)');
                text(cv, 'ECU 0x40    Service 22    Refresh: Diagnostics / Action',
                    54, 138, 26, t.text);
                const readRow = (label, did, y, seat) => {
                    const entry = ctl.readbacks[did];
                    const stale = !entry || now - entry.at > 30000;
                    const decoded = !stale && entry.ok ? (seat ?
                        B.decodeSeatReadback(entry.payload) :
                        B.decodeWheelReadback(entry.payload)) : null;
                    const detail = !decoded ? stale ? 'NOT AVAILABLE' :
                        entry.ok ? 'Unsupported reply format' : 'ECU read rejected' :
                        seat ? decoded.on ? 'ON  |  Level ' + decoded.level : 'OFF' :
                            decoded.on ? 'ON  |  Indicator ' + (decoded.led ? 'ON' : 'OFF') : 'OFF';
                    text(cv, label, 54, y, 25, t.text);
                    text(cv, detail, 665, y, 23, decoded ?
                        decoded.on ? t.accent : t.text : t.warn);
                };
                readRow('Steering wheel', B.DID_HEAT, 207, false);
                readRow('Driver seat', B.DID_SEAT_DRIVER, 267, true);
                readRow('Passenger seat', B.DID_SEAT_PASSENGER, 327, true);
                cv.fillRect(54, 354, 1450, 1, '#2e4052');
                text(cv, 'Actual heater status decoded from BDC_G05 ECU result fields.',
                    54, 400, 24, t.accent);
                text(cv, statusBusy ? 'Reading BDC ...' : 'Last ECU read: ' + (statusAt ?
                    Math.round((now - statusAt) / 1000) + 's ago' : 'not yet'), 54, 448, 22, t.dim);
                text(cv, 'Outside sensor: ' + (outside.raw === null ? 'unavailable' :
                    'raw ' + outside.raw + ' -> ' + outside.value.toFixed(1) + ' °C') +
                    '   |   start threshold ' + c.belowTemp + ' °C',
                54, 486, 20, t.dim);
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
