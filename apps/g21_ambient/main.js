'use strict';

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const A = require('./logic');
const { SafeDiag, bytes } = require('./safe_diag');

// The renderer itself adds the single native Settings tab via BTN_SETTINGS.
const TABS = ['Color', 'Diagnostics'];
const PICKER = { x: 56, y: 130, w: 632, h: 140, cols: 24, rows: 11 };
const RGB_SLIDERS = [
    { key: 'customRed', label: 'R', y: 285 },
    { key: 'customGreen', label: 'G', y: 324 },
    { key: 'customBlue', label: 'B', y: 363 },
];
const BRIGHTNESS_Y = 419;
const SLIDER_X = 145, SLIDER_W = 490;
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
        const ctl = new SafeDiag(ctx, A.ECU, A.PROBE_DID);
        let tab = 0, rgbChannel = 0;
        let touchedSlider = null;
        let lastDragUpdate = 0;
        let actionNotice = 'No action requested.';
        let plan = null;
        // Settings from 0.3.0 may still contain the removed local lilac mode.
        if (ctx.settings.get('colorMode') === 'saved') ctx.settings.set('colorMode', 'preset');
        if (ctx.settings.get('presetColor') === '6') ctx.settings.set('presetColor', '0');
        const setTab = i => {
            if (Number.isInteger(i) && i >= 0 && i < TABS.length) {
                tab = i;
                if (tab === 1) ctl.read(A.PROBE_DID).catch(e => {
                    ctl.info = 'RAM status read: ' + e.message;
                });
            }
        };
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
                const change = {
                    customRed: rgb[0], customGreen: rgb[1], customBlue: rgb[2],
                    customHue: grid.hue, customSat: grid.saturation,
                };
                if (!keepPreset) change.colorMode = 'custom';
                // One persistence operation per sampled drag position; previously
                // each finger move caused six synchronous flash/file writes.
                if (typeof ctx.settings.setMany === 'function') ctx.settings.setMany(change);
                else Object.keys(change).forEach(k => ctx.settings.set(k, change[k]));
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
        const setBrightness = value => {
            const next = Math.max(0, Math.min(100, Math.round(value)));
            if (next !== Number(ctx.settings.get('brightness'))) ctx.settings.set('brightness', next);
        };
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
        const applyChoice = async () => {
            if (ctx.settings.get('applyTarget') === 'slot11') {
                prepareSlot11();
                return;
            }
            plan = null;
            if (!ctl.online) {
                actionNotice = 'No connection to RAM / TASU. No command sent.';
                return;
            }
            if (!ctl.verified) {
                // E310 and E311 readbacks are rejected by this vehicle.
                // Validate the RAM01 numeric identity before a LIN write.
                actionNotice = 'Checking RAM variant (22 F150) ...';
                await ctl.read(A.PROBE_DID);
                if (!ctl.verified) { actionNotice = ctl.info; return; }
            }
            await ctl.write(raw(), 'RAM-LIN RGB #' + rgbHex(selected().rgb));
            actionNotice = ctl.info;
        };
        ctx.ui.onClick('BTN_PAGE', () => setTab((tab + 1) % TABS.length));
        ctx.ui.onClick('BTN_MODE', () => {
            if (tab === 0) {
                ctx.settings.cycle('colorMode');
                if (mode() === 'preset') syncPreset();
            } else setTab((tab + 1) % TABS.length);
        });
        ctx.ui.onClick('BTN_COLOR', () => {
            if (tab === 0) {
                ctx.settings.cycle(mode() === 'custom' ? 'customHue' : 'presetColor');
                if (mode() === 'custom') updateFromGrid();
                else syncPreset();
            }
        });
        ctx.ui.onClick('BTN_SAT', () => {
            if (tab === 0) {
                ctx.settings.cycle('customSat');
                updateFromGrid();
            }
        });
        ctx.ui.onClick('BTN_RGB_NEXT', () => { if (tab === 0) rgbChannel = (rgbChannel + 1) % 3; });
        ctx.ui.onClick('BTN_RGB_DOWN', () => { if (tab === 0) adjustRGB(-1); });
        ctx.ui.onClick('BTN_RGB_UP', () => { if (tab === 0) adjustRGB(1); });
        ctx.ui.onClick('BTN_TARGET', () => cycleTarget());
        ctx.ui.onClick('BTN_RESTORE', () => prepareOriginal());
        ctx.ui.onClick('BTN_BRIGHT', () => { if (tab === 0) nextBrightnessPreset(); });
        ctx.ui.onClick('BTN_BRIGHT_DOWN', () => { if (tab === 0) setBrightness(Number(ctx.settings.get('brightness')) - 1); });
        ctx.ui.onClick('BTN_BRIGHT_UP', () => { if (tab === 0) setBrightness(Number(ctx.settings.get('brightness')) + 1); });
        ctx.ui.onClick('BTN_ACTION', () => {
            if (tab === 0) { applyChoice().catch(e => { actionNotice = 'Apply error: ' + e.message; }); return; }
            // Diagnostics is strictly read-only; writes belong to Color / APPLY.
            ctl.read(A.PROBE_DID).catch(e => { ctl.info = 'Read error: ' + e.message; });
        });
        if (typeof ctx.onTab === 'function') ctx.onTab(setTab);
        const moveSlider = (kind, x, y) => {
            if (kind === 'picker') {
                const px = Math.max(PICKER.x, Math.min(PICKER.x + PICKER.w - 1, x));
                const py = Math.max(PICKER.y, Math.min(PICKER.y + PICKER.h - 1, y));
                const cell = A.pickerCell(px, py, PICKER.x, PICKER.y, PICKER.w, PICKER.h);
                if (cell) updateRGB(A.hsvToRgb(cell.hue, cell.saturation));
            } else if (kind === 'brightness') {
                setBrightness((x - SLIDER_X) * 100 / SLIDER_W);
            } else if (kind >= 0 && kind < RGB_SLIDERS.length) {
                rgbChannel = kind;
                const rgb = RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key)));
                rgb[kind] = Math.max(0, Math.min(254, Math.round((x - SLIDER_X) * 254 / SLIDER_W)));
                updateRGB(rgb);
            }
        };
        if (typeof ctx.onTouch === 'function') ctx.onTouch((phase, x, y) => {
            if (tab !== 0) { touchedSlider = null; return; }
            if (phase === 1) {
                touchedSlider = null;
                if (x >= PICKER.x && x <= PICKER.x + PICKER.w && y >= PICKER.y && y <= PICKER.y + PICKER.h)
                    touchedSlider = 'picker';
                else if (x >= SLIDER_X - 12 && x <= SLIDER_X + SLIDER_W + 12) {
                    touchedSlider = RGB_SLIDERS.findIndex(s => y >= s.y - 12 && y <= s.y + 32);
                    if (touchedSlider < 0 && y >= BRIGHTNESS_Y - 12 && y <= BRIGHTNESS_Y + 32)
                        touchedSlider = 'brightness';
                }
            }
            if (touchedSlider !== null && touchedSlider !== -1 && (phase === 1 || phase === 2 || phase === 3)) {
                // Sample at <= 10 Hz, always commit final release position.
                // Reading/settings writes on every raw touch-move overloads MGU.
                const now = Date.now();
                if (phase !== 2 || now - lastDragUpdate >= 100) {
                    moveSlider(touchedSlider, x, y);
                    lastDragUpdate = now;
                }
            }
            if (phase === 3) touchedSlider = null;
        });
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
                    applyChoice().catch(e => { actionNotice = 'Apply error: ' + e.message; });
                else if (y >= 414 && y < 459 && x >= 778 && x < 1110)
                    prepareOriginal();
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
            G.frame(cv, t, TABS, tab, []);
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
                    'TEMPORARY COLOR' : 'IDRIVE SLOT 11 / FDL PLAN'), 785, 342, 20, t.text);
                const choice = (x, w, label, active) => {
                    cv.fillRect(x, 356, w, 42, active ? '#23475b' : '#1d2632');
                    text(cv, label, x + 14, 385, 21, active ? t.accent : t.text);
                };
                choice(778, 217, 'Temporary', target === 'temporary');
                choice(1001, 228, 'Menu slot 11', target === 'slot11');
                // Keep the main action stable. The preparation sequence is
                // explained below instead of relabelling the button itself.
                cv.fillRect(1245, 356, 292, 42, '#1b5565');
                text(cv, 'APPLY', 1330, 385, 24, '#ffffff', { font: 'bold' });
                cv.fillRect(778, 416, 332, 40, '#1d2632');
                text(cv, 'Prepare factory restore', 793, 445, 20, t.text);
                text(cv, actionNotice.slice(0, 72), 785, 466, 18, t.warn);
                text(cv, target === 'slot11'
                    ? 'Slot 11: prepare the FDL plan; no ECU coding is sent.'
                    : !ctl.verified ? 'Apply: check RAM -> arm -> confirm (parked only).'
                        : ctl.pending ? 'Ready to send: tap APPLY again within 8 seconds.'
                            : 'ECU ready: tap APPLY to arm, then confirm.',
                    785, 497, 18, t.dim);
            } else {
                G.panel(cv, t, 24, 62, 761, 445, 'RAM / Live diagnostics');
                text(cv, 'Connection', 56, 145, 25, t.dim);
                text(cv, ctl.online ? 'TASU connected' : 'TASU unavailable',
                    350, 145, 25, ctl.online ? t.accent : t.warn);
                text(cv, 'RAM identity (F150)', 56, 205, 25, t.dim);
                text(cv, ctl.identity === null ? 'Not identified' :
                    ctl.verified ? 'RAM01 verified (0F2590)' :
                        'SGBD index ' + ctl.identity + ' (unverified)',
                350, 205, 25, ctl.verified ? t.accent : t.warn);
                text(cv, 'Vehicle speed', 56, 265, 25, t.dim);
                text(cv, ctl.speed === null ? 'Unavailable' : ctl.speed.toFixed(1) + ' km/h',
                    350, 265, 25, t.text);
                text(cv, 'Last ECU write', 56, 325, 25, t.dim);
                text(cv, ctl.lastWriteOk === null ? 'Not requested' :
                    ctl.lastWriteOk ? 'Acknowledged (not visually verified)' : 'Rejected',
                350, 325, 23, ctl.lastWriteOk ? t.accent : t.warn);
                text(cv, 'Press DIAGNOSTICS / ACTION to refresh read-only status.',
                    56, 422, 22, t.text);
                G.panel(cv, t, 805, 62, 771, 445, 'ECU response / LED target');
                text(cv, 'RAM target 0x37  |  Read 22 F150', 835, 142, 24, t.text);
                text(cv, 'Readback: ' + ctl.readText.slice(0, 42), 835, 197, 23, t.dim);
                text(cv, 'LED target: ' + (Number(ctx.settings.get('linId')) === 0 ?
                    'All LIN RGB modules' : 'Module ' + ctx.settings.get('linId')),
                835, 255, 25, t.text);
                text(cv, 'Control duration: ' + ctx.settings.get('duration') + ' s',
                    835, 307, 25, t.text);
                text(cv, 'Last response: ' + ctl.info.slice(0, 43), 835, 377, 20, t.warn);
                text(cv, 'Temporary output only; not iDrive slot 11 coding.',
                    835, 449, 19, t.dim);
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
