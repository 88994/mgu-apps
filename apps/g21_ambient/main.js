'use strict';

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const A = require('./logic');
const { SafeDiag, bytes } = require('./safe_diag');

const TABS = ['Color', 'Settings', 'Diagnostics'];
const PICKER = { x: 56, y: 130, w: 632, h: 140, cols: 24, rows: 11 };
const RGB_SLIDERS = [
    { key: 'customRed', label: 'R', y: 285 },
    { key: 'customGreen', label: 'G', y: 324 },
    { key: 'customBlue', label: 'B', y: 363 },
];
const BRIGHTNESS_Y = 419;
const SLIDER_X = 145, SLIDER_W = 490;
const SETTINGS = [
    ['colorMode', 'Color mode'], ['presetColor', 'Preset color'],
    ['customHue', 'Hue'], ['customSat', 'Saturation'],
    ['applyTarget', 'Apply mode'], ['brightness', 'Brightness'],
    ['customRed', 'RGB red'], ['customGreen', 'RGB green'], ['customBlue', 'RGB blue'],
    ['linId', 'LIN module'], ['duration', 'Duration'],
];
const text = (cv, s, x, y, size, color, options) => cv.text(String(s), x, y, size, color, options || {});
const rgbHex = rgb => rgb.map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();

function drawPicker(cv, hue, saturation, active) {
    const p = PICKER;
    for (let row = 0; row < p.rows; row++) {
        for (let col = 0; col < p.cols; col++) {
            const left = p.x + Math.round(col * p.w / p.cols);
            const top = p.y + Math.round(row * p.h / p.rows);
            cv.fillRect(left, top, Math.ceil(p.w / p.cols) + 1, Math.ceil(p.h / p.rows) + 1,
                '#' + rgbHex(A.hsvToRgb(A.HUES[col], 100 - A.SATURATIONS[row])));
        }
    }
    if (active) {
        const col = A.HUES.indexOf(hue), row = (100 - saturation) / 10;
        if (col >= 0 && Number.isInteger(row) && row >= 0 && row < p.rows) {
            cv.strokeRoundRect(p.x + Math.round(col * p.w / p.cols) - 2,
                p.y + Math.round(row * p.h / p.rows) - 2,
                Math.ceil(p.w / p.cols) + 4, Math.ceil(p.h / p.rows) + 4, 4, 3, '#ffffff');
        }
    }
}
function drawRgbSlider(cv, t, spec, value, isSelected) {
    const y = spec.y;
    text(cv, spec.label, 58, y + 15, 24, isSelected ? t.accent : t.text, { font: 'bold' });
    cv.fillRect(SLIDER_X, y, SLIDER_W, 18, '#233243');
    cv.fillRect(SLIDER_X, y, Math.round(SLIDER_W * value / 254), 18,
        spec.label === 'R' ? '#ee5866' : spec.label === 'G' ? '#49d59e' : '#5c91ff');
    cv.strokeRoundRect(SLIDER_X + Math.round(SLIDER_W * value / 254) - 5, y - 4, 10, 25,
        4, 2, '#ffffff');
    text(cv, String(value).padStart(3, ' '), 650, y + 16, 22, t.text, { font: 'num' });
}
function drawBrightnessSlider(cv, t, value) {
    text(cv, 'BRT', 58, BRIGHTNESS_Y + 15, 22, t.text, { font: 'bold' });
    cv.fillRect(SLIDER_X, BRIGHTNESS_Y, SLIDER_W, 18, '#233243');
    cv.fillRect(SLIDER_X, BRIGHTNESS_Y, Math.round(SLIDER_W * value / 100), 18, '#f1c65b');
    cv.strokeRoundRect(SLIDER_X + Math.round(SLIDER_W * value / 100) - 5,
        BRIGHTNESS_Y - 4, 10, 25, 4, 2, '#ffffff');
    text(cv, value + '%', 650, BRIGHTNESS_Y + 16, 22, t.text, { font: 'num' });
}

mgu.run({
    async start(ctx) {
        const ctl = new SafeDiag(ctx, A.ECU, A.DID);
        let tab = 0, selectedRow = 0, rgbChannel = 0;
        let actionNotice = 'No action requested.';
        let plan = null;
        // Settings from 0.3.0 may still contain the removed local lilac mode.
        if (ctx.settings.get('colorMode') === 'saved') ctx.settings.set('colorMode', 'preset');
        if (ctx.settings.get('presetColor') === '6') ctx.settings.set('presetColor', '0');
        const setTab = i => { if (Number.isInteger(i) && i >= 0 && i < TABS.length) tab = i; };
        const mode = () => ctx.settings.get('colorMode');
        const selected = () => mode() === 'custom'
            ? A.exactColor(RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key))))
            : A.chooseColor('preset', Number(ctx.settings.get('presetColor')),
                Number(ctx.settings.get('customHue')), Number(ctx.settings.get('customSat')));
        const raw = () => A.fromPreset(selected(), Number(ctx.settings.get('linId')),
            Number(ctx.settings.get('brightness')), Number(ctx.settings.get('duration')));
        const trackedKeys = ['colorMode', 'presetColor', 'customHue', 'customSat',
            ...RGB_SLIDERS.map(s => s.key)];
        const pickerSnapshot = () => trackedKeys.map(k => ctx.settings.get(k));
        let previousPicker = pickerSnapshot(), pickerSyncing = false;
        const updateSafely = fn => {
            if (pickerSyncing) return;
            pickerSyncing = true;
            try { fn(); }
            finally { previousPicker = pickerSnapshot(); pickerSyncing = false; }
        };
        const syncRGB = (rgb, keepPreset = false) => {
            updateSafely(() => {
                const grid = A.rgbToGrid(rgb);
                RGB_SLIDERS.forEach((s, i) => ctx.settings.set(s.key, rgb[i]));
                ctx.settings.set('customHue', grid.hue);
                ctx.settings.set('customSat', grid.saturation);
                if (!keepPreset) ctx.settings.set('colorMode', 'custom');
            });
        };
        const updateRGB = rgb => syncRGB(rgb);
        const syncPreset = () => syncRGB(A.chooseColor('preset',
            Number(ctx.settings.get('presetColor')), 0, 100).rgb, true);
        if (mode() === 'preset') syncPreset(); // initial sliders and marker match the preset
        const updateFromGrid = () => updateRGB(A.hsvToRgb(
            Number(ctx.settings.get('customHue')), Number(ctx.settings.get('customSat'))));
        const adjustRGB = delta => {
            const rgb = RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key)));
            rgb[rgbChannel] = Math.max(0, Math.min(254, rgb[rgbChannel] + delta));
            updateRGB(rgb);
        };
        const changeSetting = () => {
            const key = SETTINGS[selectedRow][0];
            ctx.settings.cycle(key);
            if (key === 'customHue' || key === 'customSat') updateFromGrid();
            else if (key === 'presetColor' || key === 'colorMode') {
                if (mode() === 'preset') syncPreset();
            }
            else if (RGB_SLIDERS.some(s => s.key === key))
                updateRGB(RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key))));
        };
        const setBrightness = value => ctx.settings.set('brightness',
            Math.max(0, Math.min(100, Math.round(value))));
        const nextBrightnessPreset = () => {
            const current = Number(ctx.settings.get('brightness'));
            setBrightness(current >= 100 ? 0 : Math.floor(current / 10) * 10 + 10);
        };
        const cycleTarget = () => ctx.settings.cycle('applyTarget');
        const prepareSlot11 = () => {
            plan = { kind: 'apply', result: A.slot11Plan(selected().rgb) };
            actionNotice = 'SLOT 11: FDL PLAN ONLY. NOT CODED.';
        };
        const prepareOriginal = () => {
            plan = { kind: 'restore', result: A.slot11RestorePlan() };
            actionNotice = 'FACTORY PLAN: 05 00 / 78 3C FE. NOT CODED.';
        };
        const applyChoice = () => {
            if (ctx.settings.get('applyTarget') === 'slot11') {
                prepareSlot11();
                return;
            }
            plan = null;
            if (!ctl.verified) {
                actionNotice = 'TEMPORARY: Reading ECU status (22 E311).';
                ctl.read(A.DID);
            } else {
                actionNotice = 'TEMPORARY: Safety checks / confirm twice.';
                ctl.write(raw(), 'RAM-LIN RGB #' + rgbHex(selected().rgb));
            }
        };
        ctx.ui.onClick('BTN_PAGE', () => setTab((tab + 1) % TABS.length));
        ctx.ui.onClick('BTN_MODE', () => {
            if (tab === 1) selectedRow = (selectedRow + 1) % SETTINGS.length;
            else if (tab === 0) {
                ctx.settings.cycle('colorMode');
                if (mode() === 'preset') syncPreset();
            } else setTab((tab + 1) % TABS.length);
        });
        ctx.ui.onClick('BTN_COLOR', () => {
            if (tab === 1) selectedRow = (selectedRow + 1) % SETTINGS.length;
            else if (tab === 0) {
                ctx.settings.cycle(mode() === 'custom' ? 'customHue' : 'presetColor');
                if (mode() === 'custom') updateFromGrid();
                else syncPreset();
            }
        });
        ctx.ui.onClick('BTN_SAT', () => {
            if (tab === 1) changeSetting();
            else if (tab === 0) {
                ctx.settings.cycle('customSat');
                updateFromGrid();
            }
        });
        ctx.ui.onClick('BTN_RGB_NEXT', () => { if (tab === 0) rgbChannel = (rgbChannel + 1) % 3; });
        ctx.ui.onClick('BTN_RGB_DOWN', () => { if (tab === 0) adjustRGB(-1); });
        ctx.ui.onClick('BTN_RGB_UP', () => { if (tab === 0) adjustRGB(1); });
        ctx.ui.onClick('BTN_TARGET', () => cycleTarget());
        ctx.ui.onClick('BTN_RESTORE', () => prepareOriginal());
        ctx.ui.onClick('BTN_BRIGHT', () => tab === 1 ? changeSetting()
            : tab === 0 ? nextBrightnessPreset() : null);
        ctx.ui.onClick('BTN_BRIGHT_DOWN', () => { if (tab === 0) setBrightness(Number(ctx.settings.get('brightness')) - 1); });
        ctx.ui.onClick('BTN_BRIGHT_UP', () => { if (tab === 0) setBrightness(Number(ctx.settings.get('brightness')) + 1); });
        ctx.ui.onClick('BTN_ACTION', () => {
            if (tab === 0) { applyChoice(); return; }
            if (tab === 1) { changeSetting(); return; }
            // Diagnostics only: first press reads. Manual writes remain behind SafeDiag gates.
            if (!ctl.verified) ctl.read(A.DID);
            else {
                try { ctl.write(raw(), 'RGB ' + selected().name); }
                catch (e) { ctl.info = 'Invalid PRG value: ' + e.message; }
            }
        });
        if (typeof ctx.onTab === 'function') ctx.onTab(setTab);
        if (typeof ctx.onTap === 'function') ctx.onTap((x, y) => {
            if (tab === 0) {
                const hit = A.pickerCell(x, y, PICKER.x, PICKER.y, PICKER.w, PICKER.h);
                if (hit) {
                    updateRGB(A.hsvToRgb(hit.hue, hit.saturation));
                    return;
                }
                const channel = RGB_SLIDERS.findIndex(s => x >= SLIDER_X && x <= SLIDER_X + SLIDER_W &&
                    y >= s.y - 8 && y < s.y + 29);
                if (channel >= 0) {
                    rgbChannel = channel;
                    const rgb = RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key)));
                    rgb[channel] = Math.max(0, Math.min(254,
                        Math.round((x - SLIDER_X) * 254 / SLIDER_W)));
                    updateRGB(rgb);
                    return;
                }
                if (x >= SLIDER_X && x <= SLIDER_X + SLIDER_W &&
                    y >= BRIGHTNESS_Y - 8 && y < BRIGHTNESS_Y + 29) {
                    setBrightness((x - SLIDER_X) * 100 / SLIDER_W);
                    return;
                }
                if (y >= 354 && y < 400 && x >= 778 && x < 997)
                    ctx.settings.set('applyTarget', 'temporary');
                else if (y >= 354 && y < 400 && x >= 1000 && x < 1227)
                    ctx.settings.set('applyTarget', 'slot11');
                else if (y >= 354 && y < 400 && x >= 1245 && x < 1535)
                    applyChoice();
                else if (y >= 414 && y < 459 && x >= 778 && x < 1110)
                    prepareOriginal();
            } else if (tab === 1 && x >= 50 && x < 1510 && y >= 120 && y < 467) {
                const col = x < 800 ? 0 : 1, line = Math.floor((y - 120) / 58);
                const index = col * 6 + line;
                if (index < SETTINGS.length) selectedRow = index;
            }
        });
        ctx.settings.onChange(() => {
            ctl.cancel();
            if (pickerSyncing) return;
            const current = pickerSnapshot();
            const modified = key => current[trackedKeys.indexOf(key)] !==
                previousPicker[trackedKeys.indexOf(key)];
            if (modified('colorMode') || (mode() === 'preset' && modified('presetColor'))) {
                if (mode() === 'preset') syncPreset();
                else previousPicker = current;
            } else if (RGB_SLIDERS.some(s => modified(s.key))) {
                updateRGB(RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key))));
            } else if (modified('customHue') || modified('customSat')) {
                updateFromGrid();
            } else previousPicker = current;
        });
        ctl.init().catch(e => { ctl.info = 'TASU initialization: ' + e; });

        ctx.loop('MAIN', 8, () => {
            const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
            const color = selected();
            const brightness = Number(ctx.settings.get('brightness'));
            const hex = rgbHex(color.rgb);
            const closest = A.rgbToGrid(color.rgb);
            const target = ctx.settings.get('applyTarget');
            const badge = target === 'slot11' ? 'FDL-PLAN / OFFLINE' :
                ctx.settings.get('engineeringWrites') === true ? 'LIN TEST ENABLED' : 'LIN TEST LOCKED';
            G.frame(cv, t, TABS, tab, [{ text: badge, color: t.dim }]);
            if (tab === 0) {
                G.panel(cv, t, 24, 62, 701, 445, 'Color picker / RGB sliders');
                text(cv, 'Choose a color or adjust precise RGB values', 56, 119, 21, t.text);
                drawPicker(cv, closest.hue, closest.saturation, !!color.on);
                RGB_SLIDERS.forEach((s, index) =>
                    drawRgbSlider(cv, t, s, Number(ctx.settings.get(s.key)), index === rgbChannel));
                drawBrightnessSlider(cv, t, brightness);
                text(cv, 'Nearest palette: #' + rgbHex(closest.rgb) +
                    '  |  Exact RGB retained', 56, 481, 19, t.dim);

                G.panel(cv, t, 746, 62, 830, 445, 'Color preview / Apply');
                cv.fillRect(778, 120, 760, 106, color.on ? '#' + rgbHex(color.rgb.map(n =>
                    Math.round(n * brightness / 100))) : '#151923');
                text(cv, color.name + '  #' + hex, 785, 273, 34, t.text, { font: 'bold' });
                text(cv, 'RGB ' + color.rgb.join(' / ') + '   |   Brightness ' +
                    brightness + ' %', 785, 315, 23, t.accent);
                text(cv, 'Apply mode: ' + (target === 'temporary' ?
                    'TEMPORARY / LIN TEST' : 'IDRIVE SLOT 11 / FDL PLAN'), 785, 342, 20, t.text);
                const choice = (x, w, label, active) => {
                    cv.fillRect(x, 356, w, 42, active ? '#23475b' : '#1d2632');
                    text(cv, label, x + 14, 385, 21, active ? t.accent : t.text);
                };
                choice(778, 217, 'Temporary', target === 'temporary');
                choice(1001, 228, 'Menu slot 11', target === 'slot11');
                choice(1245, 292, 'Apply', false);
                cv.fillRect(778, 416, 332, 40, '#1d2632');
                text(cv, 'Prepare factory restore', 793, 445, 20, t.text);
                text(cv, actionNotice.slice(0, 47), 1125, 443, 17, t.warn);
                text(cv, target === 'slot11'
                    ? 'Slot 11: matching colors. FDL coding still unavailable.'
                    : 'LIN 0xE311 requires explicit approval and vehicle standstill.',
                    785, 483, 18, t.dim);
            } else if (tab === 1) {
                G.panel(cv, t, 24, 62, 760, 445, 'Color / Apply mode');
                G.panel(cv, t, 805, 62, 771, 445, 'RGB / LIN parameters');
                SETTINGS.forEach(([key, label], index) => {
                    const col = index < 6 ? 0 : 1, line = col ? index - 6 : index;
                    const x = col ? 832 : 50, y = 154 + 57 * line;
                    const value = ctx.settings.display ? ctx.settings.display(key) : ctx.settings.get(key);
                    if (index === selectedRow) cv.fillRect(x - 5, y - 29, col ? 715 : 706, 48, '#203448');
                    text(cv, (index === selectedRow ? '> ' : '  ') + label, x, y, 21,
                        index === selectedRow ? t.accent : t.text);
                    text(cv, String(value), x + 328, y, 20, t.text);
                });
                text(cv, 'Select: Mode / Color   |   Change: Saturation', 50, 489, 19, t.dim);
                text(cv, 'More options: All settings', 832, 489, 19, t.dim);
            } else {
                G.panel(cv, t, 24, 62, 761, 445, 'RAM01 / Diagnostics');
                text(cv, 'Control unit   RAM  |  Address 0x37', 56, 142, 26, t.text);
                text(cv, 'DID 0xE311    UDS 22 / 2E', 56, 190, 25, t.text);
                text(cv, '2E  ' + bytes(raw()), 56, 260, 32, t.accent, { font: 'num' });
                text(cv, 'ID   ON   BRIGHT   R   G   B   TIME', 56, 305, 21, t.dim);
                text(cv, 'Diagnostics button: read status 22 first', 56, 388, 22, t.text);
                text(cv, 'Writing requires manual safety approval', 56, 450, 20, t.warn);
                G.panel(cv, t, 805, 62, 771, 445, 'Connection / Safety');
                text(cv, 'ECU: ' + (ctl.online ? 'TASU ready' : 'offline'), 835, 143, 27, t.text);
                text(cv, 'Speed: ' + (ctl.speed === null ? 'not available' : ctl.speed.toFixed(1) + ' km/h'), 835, 195, 23, t.text);
                text(cv, 'Status 22: ' + ctl.readText.slice(0, 43), 835, 248, 20, t.dim);
                text(cv, 'Approval: ' + (ctl.writeReady || 'not approved').slice(0, 36), 835, 303, 22, t.warn);
                text(cv, ctl.info.slice(0, 54), 835, 376, 20, t.text);
                text(cv, plan ? (plan.kind === 'restore'
                    ? 'Slot 11 FACTORY PLAN: 05 00, RGB 78 3C FE'
                    : 'Slot 11 REQUESTED COLOR: #' + rgbHex(plan.result.desiredRGB)) :
                    'Slot 11: no FDL plan requested', 835, 422, 19, t.text);
                text(cv, 'FDL / CAFD writing not available', 835, 470, 21, t.warn);
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
