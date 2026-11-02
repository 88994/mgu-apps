'use strict';

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const B = require('./logic');
const { ComfortAuto } = require('./comfort_auto');
const { SafeDiag, bytes } = require('./safe_diag');

const TABS = ['Comfort', 'Settings', 'Diagnostics'];
const SETTINGS = [
    ['autoEnabled', 'Comfort preview'], ['simTempEnabled', 'Simulate temperature'],
    ['simTempC', 'Simulated temperature'], ['belowTemp', 'Start below'],
    ['coldDwell', 'Stable for'], ['wheelAuto', 'Auto wheel heating'],
    ['wheelMins', 'Wheel heat duration'], ['seatDriver', 'Auto driver seat'],
    ['seatPassenger', 'Auto passenger seat'], ['seatLevel', 'Seat heat level'],
    ['seatMins', 'Seat heat duration'], ['manualSeconds', 'Manual test duration'],
];
const text = (cv, s, x, y, size, color, opts) => cv.text(String(s), x, y, size, color, opts || {});

mgu.run({
    async start(ctx) {
        ctx.log.info('[WHEELHEAT] process started; automatic heating remains PREVIEW ONLY');
        const ctl = new SafeDiag(ctx, B.ECU, B.DID_HEAT);
        const auto = new ComfortAuto();
        const outside = { value: null, at: 0 };
        let tab = 0, selectedRow = 0, autoBytes = 'No preview events yet';
        const setTab = i => { if (Number.isInteger(i) && i >= 0 && i < TABS.length) tab = i; };
        ctx.signals.watch('de.bmw.infrastructure.EnvironmentalInformation', '1', {
            ExteriorTemperature: (v) => {
                const temp = B.exteriorTemp(v && v.temperatureExterior);
                if (temp !== null && temp >= -40 && temp <= 60) {
                    outside.value = temp;
                    outside.at = Date.now();
                }
            },
        }, ctx.log).catch(e => ctx.log.warn('Outdoor temperature: ' + e));
        const autoConfig = () => ({
            autoEnabled: ctx.settings.get('autoEnabled') === true,
            belowTemp: Number(ctx.settings.get('belowTemp')),
            coldDwell: Number(ctx.settings.get('coldDwell')),
            wheelAuto: ctx.settings.get('wheelAuto') === true,
            wheelMins: Number(ctx.settings.get('wheelMins')),
            seatDriver: ctx.settings.get('seatDriver') === true,
            seatPassenger: ctx.settings.get('seatPassenger') === true,
            seatLevel: Number(ctx.settings.get('seatLevel')),
            seatMins: Number(ctx.settings.get('seatMins')),
        });
        const selectedOutside = (now) => B.temperatureInput(outside.value, outside.at,
            ctx.settings.get('simTempEnabled') === true, ctx.settings.get('simTempC'), now);
        const seconds = () => Number(ctx.settings.get('manualSeconds'));
        function autoStep() {
            try {
                const now = Date.now(), current = selectedOutside(now);
                const intents = auto.step({ now, tempC: current.value, tempAt: current.at, cfg: autoConfig() });
                for (const intent of intents) {
                    // No automatic ECU 2E writes; this is a deterministic offline preview.
                    const d = intent.device === 'Steering wheel' ? B.heating(intent.data.seconds)
                        : B.seat(intent.data.side, intent.data.level,
                            intent.type === 'OFF' ? 0 : autoConfig().seatMins * 60);
                    autoBytes = intent.type + ' ' + intent.device + ': 2E ' + bytes(d);
                    ctx.log.info('[AUTO PREVIEW ONLY] ' + autoBytes);
                }
            } catch (e) { autoBytes = 'Invalid automation settings: ' + e.message; }
        }
        setInterval(autoStep, 1000); // The process must stay alive for background planning.
        autoStep();

        const changeSetting = () => ctx.settings.cycle(SETTINGS[selectedRow][0]);
        ctx.ui.onClick('BTN_PAGE', () => setTab((tab + 1) % TABS.length));
        ctx.ui.onClick('BTN_SELECT', () => tab === 1 ? selectedRow = (selectedRow + 1) % SETTINGS.length
            : tab === 0 ? ctx.settings.cycle('manualSeconds') : setTab(1));
        ctx.ui.onClick('BTN_ADJUST', () => tab === 1 ? changeSetting()
            : tab === 0 ? ctx.settings.cycle('manualSeconds') : ctx.settings.cycle('ledAction'));
        ctx.ui.onClick('BTN_ACTION', () => {
            if (tab === 1) { changeSetting(); return; }
            if (tab === 0) { setTab(2); return; }
            if (!ctl.verified) ctl.read(B.DID_HEAT);
            else ctl.write(B.heating(seconds()), seconds() ? 'Heating ' + seconds() + 's' : 'Heating OFF');
        });
        ctx.ui.onClick('BTN_LED', () => {
            if (tab !== 2) return; // no accidental LED command from the overview
            if (!ctl.verified) { ctl.info = 'Read BDC status before the LED test'; return; }
            const action = Number(ctx.settings.get('ledAction'));
            ctl.write(B.led(action), action ? 'LED ON for 1s' : 'LED OFF');
        });
        if (typeof ctx.onTab === 'function') ctx.onTab(setTab);
        if (typeof ctx.onTap === 'function') ctx.onTap((x, y) => {
            if (tab !== 1 || x < 54 || x > 1535 || y < 105 || y >= 465) return;
            const col = x < 800 ? 0 : 1, line = Math.floor((y - 105) / 58);
            const index = col * 6 + line;
            if (index < SETTINGS.length) selectedRow = index;
        });
        ctx.settings.onChange(() => ctl.cancel());
        ctl.init().catch(e => { ctl.info = 'TASU initialization: ' + e; });

        ctx.loop('MAIN', 8, () => {
            const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
            const now = Date.now(), selected = selectedOutside(now), c = autoConfig();
            const sensorFresh = selected.value !== null && now - selected.at <= 120000;
            const tempLabel = sensorFresh ? selected.value.toFixed(1) + ' C' : 'no valid reading';
            const sourceLabel = selected.source === 'SIMULATION' ? 'TEST' : 'MGU';
            const autoState = !c.autoEnabled ? 'PREVIEW DISABLED'
                : auto.active.size ? 'PREVIEW RUNNING'
                    : auto.fired ? 'PREVIEW CYCLE FINISHED' : 'WAITING FOR TEMPERATURE';
            G.frame(cv, t, TABS, tab, [{ text: c.autoEnabled ? 'AUTO PREVIEW' : 'AUTO OFF', color: t.dim }]);

            if (tab === 0) {
                G.panel(cv, t, 24, 62, 740, 445, 'Comfort automation / Preview');
                text(cv, autoState, 55, 155, 36, auto.active.size ? t.warn : t.accent, { font: 'bold' });
                text(cv, sourceLabel + ': ' + tempLabel + '     Threshold ' + c.belowTemp + ' C', 55, 217, 27, t.text);
                text(cv, 'Temperature stable for: ' + c.coldDwell + ' seconds', 55, 267, 23, t.dim);
                text(cv, 'Remaining time (simulation only):', 55, 328, 24, t.text);
                text(cv, 'Steering wheel    ' + auto.remaining('Steering wheel', now) + ' s', 67, 373, 25, t.text);
                text(cv, 'Driver seat          ' + auto.remaining('Driver seat', now) + ' s', 67, 410, 25, t.text);
                text(cv, 'Passenger seat    ' + auto.remaining('Passenger seat', now) + ' s', 67, 447, 25, t.text);
                text(cv, 'Automation preview NEVER sends ECU commands.', 55, 483, 19, t.warn);

                G.panel(cv, t, 785, 62, 791, 445, 'Manual test / Setup');
                text(cv, 'COMMAND SELECTION - NOT LIVE HEATER STATUS', 819, 143, 25, t.warn);
                text(cv, 'Selected manual action', 819, 205, 24, t.dim);
                text(cv, seconds() ? 'Heat for ' + seconds() + ' seconds' : 'Turn heating OFF',
                    819, 272, 39, t.accent, { font: 'bold' });
                text(cv, 'This value does not indicate heating is active.', 819, 317, 22, t.text);
                cv.fillRect(819, 339, 715, 2, '#2e4052');
                text(cv, 'Change duration: Select / Change value', 819, 380, 23, t.text);
                text(cv, 'Read status and test: Diagnostics tab', 819, 424, 23, t.text);
                text(cv, ctx.settings.get('engineeringWrites') === true
                    ? 'ECU writes: enabled, safety checks still required'
                    : 'ECU writes: DISABLED in Settings', 819, 479, 21, t.warn);
            } else if (tab === 1) {
                G.panel(cv, t, 24, 62, 760, 445, 'Temperature / Automation');
                G.panel(cv, t, 805, 62, 771, 445, 'Heating / Durations');
                SETTINGS.forEach(([key, label], index) => {
                    const col = index < 6 ? 0 : 1, line = col ? index - 6 : index;
                    const x = col ? 830 : 50, y = 145 + line * 57;
                    const value = ctx.settings.display ? ctx.settings.display(key)
                        : typeof ctx.settings.get(key) === 'boolean'
                            ? (ctx.settings.get(key) ? 'On' : 'Off') : String(ctx.settings.get(key));
                    if (selectedRow === index) cv.fillRect(x - 7, y - 27, 702, 47, '#203448');
                    text(cv, (index === selectedRow ? '> ' : '  ') + label, x, y, 22,
                        index === selectedRow ? t.accent : t.text);
                    text(cv, String(value), x + 375, y, 23, t.text);
                });
                text(cv, 'Select: next row   |   Adjust: change value', 50, 487, 18, t.dim);
                text(cv, 'All settings: indicator LED / write approval', 831, 487, 18, t.warn);
            } else {
                G.panel(cv, t, 24, 62, 762, 445, 'BDC / Diagnostic commands');
                text(cv, 'MANUAL  2E ' + bytes(B.heating(seconds())) + '  (' + seconds() + 's)',
                    55, 139, 29, t.accent, { font: 'num' });
                text(cv, 'AUTO WHEEL  ' + (c.wheelAuto ? '2E ' + bytes(B.heating(c.wheelMins * 60)) +
                    '  (' + c.wheelMins + 'min)' : 'OFF'), 55, 194, 25, t.text);
                text(cv, 'AUTO DRIVER  ' + (c.seatDriver ? '2E ' + bytes(B.seat('driver', c.seatLevel, c.seatMins * 60)) : 'OFF'),
                    55, 247, 24, t.text);
                text(cv, 'AUTO PASSENGER  ' + (c.seatPassenger
                    ? '2E ' + bytes(B.seat('passenger', c.seatLevel, c.seatMins * 60)) : 'OFF'),
                    55, 298, 24, t.text);
                text(cv, 'WHEEL LED   2E ' + bytes(B.led(Number(ctx.settings.get('ledAction')))), 55, 351, 23, t.dim);
                text(cv, 'LED controls the indicator, not heat output', 55, 399, 22, t.dim);
                text(cv, 'Only the manual diagnostic can request a 2E write.', 55, 467, 22, t.warn);

                G.panel(cv, t, 806, 62, 770, 445, 'Connection / Safety approval');
                text(cv, 'ECU: ' + (ctl.online ? 'TASU ready' : 'offline'), 835, 140, 27, t.text);
                text(cv, 'Speed: ' + (ctl.speed === null ? 'not available' : ctl.speed.toFixed(1) + ' km/h'), 835, 192, 23, t.text);
                text(cv, 'Status (22 D074): ' + ctl.readText.slice(0, 40), 835, 250, 21, t.dim);
                text(cv, 'Manual write: ' + (ctl.writeReady || 'not approved').slice(0, 40), 835, 304, 22, t.warn);
                text(cv, ctl.info.slice(0, 58), 835, 365, 21, t.text);
                text(cv, autoBytes.slice(0, 57), 835, 423, 21, t.accent);
                text(cv, 'AUTO = preview only; never sends 2E', 835, 474, 20, t.dim);
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
