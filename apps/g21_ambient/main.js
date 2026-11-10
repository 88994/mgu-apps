'use strict';

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const A = require('./logic');
const { SafeDiag, bytes } = require('./safe_diag');
const { BdcLin } = require('./bdc_lin');
const { AmbientProfiles, MODES, modeFromSignal } = require('./ambient_profiles');

// The renderer itself adds the single native Settings tab via BTN_SETTINGS.
const TABS = ['Color', 'Zones', 'Favorites', 'Drive modes', 'Diagnostics'];
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
function softButton(cv, t, x, y, w, label, active) {
    cv.fillRect(x, y, w, 44, active ? '#216071' : '#253342');
    text(cv, label, x + 13, y + 29, 20, active ? '#ffffff' : t.text);
}

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
        const bdc = new BdcLin(ctx, ctl);
        const profiles = new AmbientProfiles(ctx.settings);
        let tab = 0, rgbChannel = 0;
        let zoneSelected = 0, zoneScroll = 0, favoriteSelected = 0, modeSelected = 0;
        let driveMode = null;
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
                if (tab === 4) ctl.read(A.PROBE_DID).catch(e => {
                    ctl.info = 'RAM status read: ' + e.message;
                });
            }
        };
        const mode = () => ctx.settings.get('colorMode');
        const selected = () => mode() === 'custom'
            ? A.exactColor(RGB_SLIDERS.map(s => Number(ctx.settings.get(s.key))))
            : A.chooseColor('preset', Number(ctx.settings.get('presetColor')),
                Number(ctx.settings.get('customHue')), Number(ctx.settings.get('customSat')));
        const currentSnapshot = () => profiles.snapshot(selected().rgb, Number(ctx.settings.get('brightness')));
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
        const loadSnapshot = snapshot => {
            if (!snapshot) return false;
            syncRGB(snapshot.main.rgb);
            setBrightness(snapshot.main.brightness);
            profiles.replaceZones(snapshot);
            bdc.cancel();
            return true;
        };
        const selectedModule = () => bdc.modules[zoneSelected] || null;
        const nextZone = () => {
            if (!bdc.modules.length) return;
            zoneSelected = (zoneSelected + 1) % bdc.modules.length;
            zoneScroll = Math.floor(zoneSelected / 7) * 7;
        };
        const changeZonePolicy = value => {
            const module = selectedModule();
            if (!module) { actionNotice = 'Scan BDC LIN modules first.'; return; }
            const old = profiles.zone(module), next = value ||
                (old.mode === 'main' ? 'own' : old.mode === 'own' ? 'car' : 'main');
            profiles.setZone(module, next, selected().rgb, Number(ctx.settings.get('brightness')));
            bdc.cancel();
        };
        const activeModeName = () => MODES[modeSelected];
        const selectFavorite = i => { if (i >= 0 && i < 6) favoriteSelected = i; };
        const saveFavorite = () => {
            profiles.saveFavorite(favoriteSelected, currentSnapshot());
            actionNotice = 'Favorite ' + (favoriteSelected + 1) + ' saved.';
        };
        const loadFavorite = () => {
            if (loadSnapshot(profiles.loadFavorite(favoriteSelected)))
                actionNotice = 'Favorite ' + (favoriteSelected + 1) + ' loaded. Press APPLY for ECU output.';
            else actionNotice = 'Favorite is empty.';
        };
        const saveDriveMode = () => {
            profiles.saveMode(activeModeName(), currentSnapshot());
            actionNotice = activeModeName() + ' RGB profile saved (manual APPLY required).';
        };
        const cycleTarget = () => ctx.settings.cycle('applyTarget');
        const prepareSlot11 = () => {
            plan = { kind: 'apply', result: A.slot11Plan(selected().rgb) };
            actionNotice = 'MENU 11: RGB #' + rgbHex(selected().rgb) + ' requested; isolated palette not verified. NOT CODED.';
        };
        const prepareOriginal = () => {
            plan = { kind: 'restore', result: A.slot11RestorePlan() };
            actionNotice = 'FACTORY MENU 11: 05/00; original NCD required. NOT CODED.';
        };
        const applyChoice = async () => {
            if (ctx.settings.get('applyTarget') === 'slot11') {
                prepareSlot11();
                return;
            }
            plan = null;
            if (ctx.settings.get('applyTarget') === 'bdc') {
                await bdc.apply(currentSnapshot(), Number(ctx.settings.get('duration')), false);
                actionNotice = bdc.info;
                return;
            }
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
        ctx.ui.onClick('BTN_BDC_SCAN', () => bdc.scan().catch(e => {
            bdc.info = 'BDC scan failed: ' + String(e.message || e);
        }));
        ctx.ui.onClick('BTN_ZONE_NEXT', () => { if (tab === 1) nextZone(); });
        ctx.ui.onClick('BTN_ZONE_POLICY', () => { if (tab === 1) changeZonePolicy(); });
        ctx.ui.onClick('BTN_FAV_NEXT', () => { if (tab === 2) favoriteSelected = (favoriteSelected + 1) % 6; });
        ctx.ui.onClick('BTN_FAV_SAVE', () => { if (tab === 2) saveFavorite(); });
        ctx.ui.onClick('BTN_FAV_LOAD', () => { if (tab === 2) loadFavorite(); });
        ctx.ui.onClick('BTN_MODE_NEXT', () => { if (tab === 3) modeSelected = (modeSelected + 1) % MODES.length; });
        ctx.ui.onClick('BTN_MODE_SAVE', () => { if (tab === 3) saveDriveMode(); });
        ctx.ui.onClick('BTN_BDC_RESET', () => {
            if (tab === 1 || tab === 4) bdc.apply(currentSnapshot(), 1, true)
                .then(() => { actionNotice = bdc.info; })
                .catch(e => { actionNotice = 'BDC reset error: ' + String(e.message || e); });
        });
        ctx.ui.onClick('BTN_BRIGHT', () => { if (tab === 0) nextBrightnessPreset(); });
        ctx.ui.onClick('BTN_BRIGHT_DOWN', () => { if (tab === 0) setBrightness(Number(ctx.settings.get('brightness')) - 1); });
        ctx.ui.onClick('BTN_BRIGHT_UP', () => { if (tab === 0) setBrightness(Number(ctx.settings.get('brightness')) + 1); });
        ctx.ui.onClick('BTN_ACTION', () => {
            if (tab === 0) { applyChoice().catch(e => { actionNotice = 'Apply error: ' + e.message; }); return; }
            if (tab === 4) ctl.read(A.PROBE_DID).catch(e => { ctl.info = 'Read error: ' + e.message; });
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
                if (y >= 354 && y < 400 && x >= 778 && x < 946)
                    ctx.settings.set('applyTarget', 'temporary');
                else if (y >= 354 && y < 400 && x >= 948 && x < 1115)
                    ctx.settings.set('applyTarget', 'bdc');
                else if (y >= 354 && y < 400 && x >= 1117 && x < 1283)
                    ctx.settings.set('applyTarget', 'slot11');
                else if (y >= 354 && y < 400 && x >= 1288 && x < 1535)
                    applyChoice().catch(e => { actionNotice = 'Apply error: ' + e.message; });
                else if (y >= 414 && y < 459 && x >= 778 && x < 1110)
                    prepareOriginal();
            } else if (tab === 1) {
                if (x >= 52 && x < 780 && y >= 122 && y < 122 + 7 * 46) {
                    const index = zoneScroll + Math.floor((y - 122) / 46);
                    if (index < bdc.modules.length) zoneSelected = index;
                } else if (x >= 52 && x < 270 && y >= 450 && y < 499) {
                    zoneScroll = Math.max(0, zoneScroll - 7);
                } else if (x >= 280 && x < 498 && y >= 450 && y < 499) {
                    zoneScroll = Math.min(Math.max(0, bdc.modules.length - 7), zoneScroll + 7);
                } else if (x >= 930 && x < 1108 && y >= 248 && y < 298) changeZonePolicy('main');
                else if (x >= 1116 && x < 1294 && y >= 248 && y < 298) changeZonePolicy('own');
                else if (x >= 1302 && x < 1480 && y >= 248 && y < 298) changeZonePolicy('car');
                else if (x >= 930 && x < 1207 && y >= 334 && y < 383)
                    bdc.scan().catch(e => { bdc.info = 'Scan: ' + e.message; });
                else if (x >= 1212 && x < 1510 && y >= 334 && y < 383) {
                    if (ctx.settings.get('applyTarget') !== 'bdc')
                        ctx.settings.set('applyTarget', 'bdc');
                    bdc.apply(currentSnapshot(), Number(ctx.settings.get('duration')), false)
                        .then(() => { actionNotice = bdc.info; })
                        .catch(e => { actionNotice = 'BDC apply: ' + e.message; });
                } else if (x >= 930 && x < 1330 && y >= 408 && y < 456)
                    bdc.apply(currentSnapshot(), 1, true)
                        .then(() => { actionNotice = bdc.info; })
                        .catch(e => { actionNotice = 'BDC restore: ' + e.message; });
            } else if (tab === 2) {
                if (x >= 45 && x < 1530 && y >= 110 && y < 374) {
                    const column = Math.floor((x - 45) / 495);
                    const row = Math.floor((y - 110) / 130);
                    if (column < 3 && row < 2) selectFavorite(row * 3 + column);
                } else if (y >= 404 && y < 455) {
                    if (x >= 310 && x < 610) saveFavorite();
                    else if (x >= 620 && x < 920) loadFavorite();
                    else if (x >= 930 && x < 1230) {
                        profiles.clearFavorite(favoriteSelected);
                        actionNotice = 'Favorite cleared.';
                    }
                }
            } else if (tab === 3) {
                if (x >= 54 && x < 790 && y >= 130 && y < 434)
                    modeSelected = Math.min(3, Math.max(0, Math.floor((y - 130) / 76)));
                else if (x >= 900 && x < 1190 && y >= 252 && y < 302) saveDriveMode();
                else if (x >= 1204 && x < 1510 && y >= 252 && y < 302) {
                    if (loadSnapshot(profiles.mode(activeModeName())))
                        actionNotice = 'Mode look loaded. APPLY manually for BDC output.';
                } else if (x >= 900 && x < 1202 && y >= 326 && y < 375) {
                    profiles.clearMode(activeModeName());
                    actionNotice = 'Mode profile deleted.';
                } else if (x >= 1210 && x < 1510 && y >= 326 && y < 375) {
                    const follow = profiles.toggleFollow();
                    actionNotice = follow ? 'Mode following is preview-only; no automatic BDC writes.' :
                        'Mode following disabled.';
                }
            } else if (tab === 4) {
                if (x >= 835 && x < 1150 && y >= 410 && y < 460)
                    bdc.scan().catch(e => { bdc.info = 'Scan: ' + e.message; });
            }
        });
        ctx.settings.onChange(() => {
            ctl.cancel();
            bdc.cancel();
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
        // Drive mode signal is read-only. In this version mode profiles can be
        // saved/loaded, but never write to BDC automatically while driving.
        ctx.signals.watch('de.bmw.infotainment.drivingexcitement.FES', '1', {
            statusFESVehicleDynamicSwitchHMI: value => {
                const next = modeFromSignal(value);
                if (next && driveMode !== next) {
                    driveMode = next;
                    if (profiles.data.follow && profiles.mode(next)) {
                        loadSnapshot(profiles.mode(next));
                        actionNotice = next + ' look selected (preview only; press APPLY).';
                    }
                    ctx.log.info('[AMBIENT MODE] vehicle=' + next +
                        '; RGB switching remains manual until BDC output is physically verified');
                }
            },
        }, ctx.log, { pollMs: 2500 }).catch(e => ctx.log.warn('FES ambient mode: ' + e));

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
                text(cv, 'Output: ' + (target === 'temporary' ? 'RAM01 temporary test' :
                    target === 'bdc' ? 'Detected BDC LIN zones' : 'Menu position 11 / FDL preview'),
                785, 342, 20, t.text);
                const choice = (x, w, label, active) => {
                    cv.fillRect(x, 356, w, 42, active ? '#23475b' : '#1d2632');
                    text(cv, label, x + 14, 385, 21, active ? t.accent : t.text);
                };
                choice(778, 166, 'RAM', target === 'temporary');
                choice(947, 167, 'BDC zones', target === 'bdc');
                choice(1117, 166, 'Menu 11', target === 'slot11');
                // Keep the main action stable. The preparation sequence is
                // explained below instead of relabelling the button itself.
                cv.fillRect(1288, 356, 249, 42, '#1b5565');
                text(cv, 'APPLY', 1360, 385, 24, '#ffffff', { font: 'bold' });
                cv.fillRect(778, 416, 332, 40, '#1d2632');
                text(cv, 'Prepare factory restore', 793, 445, 20, t.text);
                text(cv, actionNotice.slice(0, 80), 785, 466, 18, t.warn);
                text(cv, target === 'slot11'
                    ? 'Existing menu position 11; no new slot. Isolated RGB coding not yet verified.'
                    : target === 'bdc' ? bdc.info.slice(0, 77)
                    : !ctl.verified ? 'Apply: check RAM -> arm -> confirm (parked only).'
                        : ctl.pending ? 'Ready to send: tap APPLY again within 8 seconds.'
                            : 'ECU ready: tap APPLY to arm, then confirm.',
                    785, 497, 18, t.dim);
            } else if (tab === 1) {
                G.panel(cv, t, 24, 62, 766, 445, 'Detected BDC LIN zones');
                G.panel(cv, t, 805, 62, 771, 445, 'Individual colour policy');
                for (let row = 0; row < 7; row++) {
                    const index = zoneScroll + row, module = bdc.modules[index];
                    if (!module) break;
                    const y = 122 + row * 46, state = profiles.zone(module);
                    cv.fillRect(52, y, 701, 43, index === zoneSelected ? '#214b5d' : '#222e3c');
                    text(cv, (index + 1) + '. ' + module.name, 60, y + 29, 21, t.text);
                    text(cv, state.mode.toUpperCase(), 640, y + 29, 18,
                        state.mode === 'car' ? t.dim : t.accent);
                }
                softButton(cv, t, 52, 452, 218, 'Previous', false);
                softButton(cv, t, 280, 452, 218, 'Next 7', false);
                const module = selectedModule(), zone = module && profiles.zone(module);
                if (module) {
                    text(cv, module.name, 842, 123, 29, t.text, { font: 'bold' });
                    text(cv, 'Bus ' + (module.bus + 1) + ' / NAD ' + module.nad +
                        ' / location 0x' + module.location.toString(16).toUpperCase(),
                    842, 163, 21, t.dim);
                    text(cv, 'BDC last read: RGB ' + module.rgb.join('/') +
                        ', ' + module.brightness + '%' + (module.fault ? '  / fault!' : ''),
                    842, 198, 20, module.fault ? t.warn : t.text);
                    text(cv, 'Active policy: ' + zone.mode.toUpperCase(), 842, 234, 24, t.accent);
                } else {
                    text(cv, 'No verified modules. Scan while stationary.', 842, 145, 24, t.warn);
                }
                softButton(cv, t, 930, 250, 178, 'Main RGB', !!zone && zone.mode === 'main');
                softButton(cv, t, 1116, 250, 178, 'Own RGB', !!zone && zone.mode === 'own');
                softButton(cv, t, 1302, 250, 178, 'BMW original', !!zone && zone.mode === 'car');
                text(cv, 'Own RGB = current picker colour at selection time.', 842, 323, 18, t.dim);
                softButton(cv, t, 930, 337, 277, 'SCAN BDC', false);
                softButton(cv, t, 1212, 337, 298, 'APPLY / confirm', false);
                softButton(cv, t, 930, 411, 400, 'RETURN TO BMW / confirm', false);
                text(cv, bdc.info.slice(0, 85), 842, 488, 18, t.warn);
            } else if (tab === 2) {
                G.panel(cv, t, 24, 62, 1552, 445, 'Six saved looks (RGB + individual zone settings)');
                for (let i = 0; i < 6; i++) {
                    const x = 44 + (i % 3) * 495, y = 110 + Math.floor(i / 3) * 130;
                    const f = profiles.loadFavorite(i), active = i === favoriteSelected;
                    cv.fillRect(x, y, 477, 112, active ? '#204b5b' : '#222e3c');
                    text(cv, 'Favorite ' + (i + 1), x + 20, y + 35, 27, t.text, { font: 'bold' });
                    if (f) {
                        cv.fillRect(x + 20, y + 52, 75, 38, '#' + rgbHex(f.main.rgb));
                        text(cv, '#' + rgbHex(f.main.rgb) + '  ' + f.main.brightness + '%',
                            x + 112, y + 78, 23, t.text);
                        text(cv, Object.keys(f.zones).length + ' individual policies', x + 289, y + 103, 17, t.dim);
                    } else text(cv, 'Empty – select then save', x + 20, y + 81, 21, t.dim);
                }
                softButton(cv, t, 310, 406, 300, 'SAVE selected', false);
                softButton(cv, t, 620, 406, 300, 'LOAD selected', false);
                softButton(cv, t, 930, 406, 300, 'DELETE selected', false);
                text(cv, 'Load edits the picker and zones. ECU colours change only after APPLY.',
                    67, 483, 20, t.dim);
            } else if (tab === 3) {
                G.panel(cv, t, 24, 62, 766, 445, 'Colour looks by driving mode');
                G.panel(cv, t, 805, 62, 771, 445, 'Selected mode');
                text(cv, 'Live BMW mode: ' + (driveMode || 'not available'), 55, 480, 21, t.dim);
                MODES.forEach((name, i) => {
                    const y = 130 + i * 76, profile = profiles.mode(name);
                    cv.fillRect(54, y, 710, 70, i === modeSelected ? '#214b5d' : '#222e3c');
                    text(cv, name.toUpperCase(), 75, y + 40, 27, t.text, { font: 'bold' });
                    if (profile) {
                        cv.fillRect(410, y + 12, 65, 40, '#' + rgbHex(profile.main.rgb));
                        text(cv, '#' + rgbHex(profile.main.rgb), 492, y + 40, 21, t.text);
                    } else text(cv, 'No custom look', 492, y + 40, 20, t.dim);
                });
                text(cv, 'Editing: ' + activeModeName().toUpperCase(), 843, 139, 29, t.text);
                const savedMode = profiles.mode(activeModeName());
                if (savedMode) {
                    cv.fillRect(848, 166, 100, 55, '#' + rgbHex(savedMode.main.rgb));
                    text(cv, '#' + rgbHex(savedMode.main.rgb) + ' / ' + savedMode.main.brightness + '%',
                        980, 204, 23, t.text);
                } else text(cv, 'No RGB snapshot saved', 843, 208, 22, t.dim);
                softButton(cv, t, 900, 254, 290, 'SAVE current look', false);
                softButton(cv, t, 1204, 254, 306, 'LOAD into editor', false);
                softButton(cv, t, 900, 329, 302, 'CLEAR mode', false);
                softButton(cv, t, 1210, 329, 300, profiles.data.follow ? 'Follow preview ON' : 'Follow preview OFF',
                    profiles.data.follow);
                text(cv, 'Mode detection is read-only. Automatic writes remain disabled until',
                    844, 436, 19, t.warn);
                text(cv, 'the BDC route and physical output are verified on this G21.',
                    844, 465, 19, t.warn);
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
                G.panel(cv, t, 805, 62, 771, 445, 'BDC 0x40 / LIN discovery');
                text(cv, 'LIN 1: ' + bdc.readStatus[0], 835, 137, 24, t.text);
                text(cv, 'LIN 2: ' + bdc.readStatus[1], 835, 184, 24, t.text);
                text(cv, 'Discovered: ' + bdc.modules.length + ' actual modules',
                    835, 230, 24, bdc.modules.length ? t.accent : t.warn);
                text(cv, 'Last write: ' + bdc.lastWrite.slice(0, 61), 835, 276, 19, t.dim);
                text(cv, 'RAM: ' + ctl.info.slice(0, 65), 835, 321, 18, t.dim);
                text(cv, bdc.info.slice(0, 65), 835, 370, 18, t.warn);
                softButton(cv, t, 835, 415, 315, 'SCAN BDC (read only)', false);
                text(cv, 'No blind addresses; 2x confirmation and parked only.', 1170, 449, 17, t.dim);
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
