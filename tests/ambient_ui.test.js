'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..', 'apps', 'g21_ambient');
const spec = require('../apps/g21_ambient/app.json');
const A = require('../apps/g21_ambient/logic');

test('0.3.3 ambient: synchronized picker, precise RGB, brightness and safe FDL plan', async () => {
    const values = Object.fromEntries(spec.settings.map(s => [s.key, s.default]));
    values.colorMode = 'saved'; // persisted legacy values from the removed 0.3.0 favorite
    values.presetColor = '6';
    const buttons = new Map();
    const drawnText = [];
    let tap, render, started, onTab, reads = 0, writes = 0, notifySettings = () => {};
    const settings = {
        get: k => values[k],
        set: (k, v) => { values[k] = v; notifySettings(); },
        cycle: k => {
            const item = spec.settings.find(s => s.key === k);
            const options = item.type === 'choice' ? item.options.map(o => o[0]) : item.steps;
            settings.set(k, options[(options.indexOf(values[k]) + 1) % options.length]);
        },
        onChange: cb => { notifySettings = cb; },
    };
    const ctx = {
        settings,
        ui: { onClick: (k, fn) => buttons.set(k, fn), image() {} },
        onTap: fn => { tap = fn; },
        onTab: fn => { onTab = fn; },
        signals: { watch: async () => ({available:false}) },
        log: { info() {}, warn() {} },
        theme: () => ({ bg:'#000', text:'#fff', warn:'#fc0', dim:'#888', accent:'#6cf' }),
        loop: (_id, _fps, fn) => { render = fn; },
        canvas: () => ({ clear() { return this; }, fillRect() {}, strokeRoundRect() {},
            text(s,x,y) { drawnText.push([String(s),x,y]); } }),
    };
    class MockSafeDiag {
        constructor() { this.verified=false; this.speed=null; this.online=false; this.readText='not yet read';
            this.info='Test preview'; this.writeReady='ECU WRITE OFF'; }
        init() { return Promise.resolve(); }
        cancel() {}
        read() { reads++; }
        write() { writes++; }
    }
    const imports = {
        './kit/mgu': { run: ({start}) => { started = start(ctx); } },
        './kit/gauges': { frame() {}, panel() {} },
        './logic': A,
        './safe_diag': { SafeDiag: MockSafeDiag,
            bytes: b => b.map(v => v.toString(16).toUpperCase().padStart(2,'0')).join(' ') },
    };
    const file = path.join(appDir, 'main.js');
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
        require: k => { if (!imports[k]) throw Error('unknown '+k); return imports[k]; },
        Number, String, console,
    }, {filename:file});
    await started;
    const page = () => { drawnText.length=0; render(); return drawnText.slice(); };
    assert.equal(spec.version, '0.3.3');
    assert.equal(settings.get('colorMode'), 'preset');
    assert.equal(settings.get('presetColor'), '0');
    assert.equal(spec.settings.some(s => s.key === 'savedLilacRgb'), false);
    assert.deepEqual(['customRed','customGreen','customBlue'].map(k => settings.get(k)), [254,155,65],
        'preset color initializes both RGB controls and palette marker');
    assert.match(page().map(x=>x[0]).join('\n'), /Color picker \/ RGB sliders|Warm white/);
    buttons.get('BTN_PAGE')();
    buttons.get('BTN_PAGE')();
    assert.match(page().map(x=>x[0]).join('\n'), /2E\s+E3 11 01 01 32 FE 9B 41 05/);
    assert.ok(page().find(x=>x[0].startsWith('Control unit'))[2] > 104,
        'diagnostic first line is below panel title, no overlap');
    onTab(0);
    tap(56+7, 130+7); // HSV palette selects red and updates RGB
    assert.deepEqual(['customRed','customGreen','customBlue'].map(k => settings.get(k)), [254,0,0]);
    assert.equal(settings.get('colorMode'), 'custom');
    assert.match(page().map(x=>x[0]).join('\n'), /#FE0000/);
    buttons.get('BTN_RGB_NEXT')(); // green
    buttons.get('BTN_RGB_UP')();
    assert.equal(settings.get('customGreen'), 1);
    assert.match(page().map(x=>x[0]).join('\n'), /#FE0100/);
    tap(145 + 245, 324 + 10); // RGB slider sets green ~127
    assert.equal(settings.get('customGreen'), 127);
    assert.equal(settings.get('customHue'), A.rgbToGrid([254,127,0]).hue);
    assert.equal(settings.get('customSat'), A.rgbToGrid([254,127,0]).saturation);
    buttons.get('BTN_BRIGHT')();
    assert.equal(settings.get('brightness'), 60);
    tap(145 + 392, 419 + 9); // brightness slider: 80%
    assert.equal(settings.get('brightness'), 80);
    buttons.get('BTN_BRIGHT_UP')();
    assert.equal(settings.get('brightness'), 81);
    buttons.get('BTN_BRIGHT')();
    assert.equal(settings.get('brightness'), 90, 'preset button advances from arbitrary slider values');
    buttons.get('BTN_BRIGHT_DOWN')();
    assert.equal(settings.get('brightness'), 89);
    tap(145 + 392, 419 + 9);
    assert.equal(settings.get('brightness'), 80);
    onTab(2);
    assert.match(page().map(x=>x[0]).join('\n'), /2E\s+E3 11 01 01 50 FE 7F 00 05/);
    onTab(0);
    const previousHue = settings.get('customHue');
    buttons.get('BTN_COLOR')();
    assert.equal(settings.get('customHue'), (previousHue + 15) % 360);
    buttons.get('BTN_TARGET')();
    assert.equal(settings.get('applyTarget'), 'slot11');
    buttons.get('BTN_ACTION')(); // prepares FDL plan, never sends UDS
    assert.match(page().map(x=>x[0]).join('\n'), /NOT CODED/);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    buttons.get('BTN_RESTORE')();
    onTab(2);
    assert.match(page().map(x=>x[0]).join('\n'), /FACTORY PLAN: 05 00, RGB 78 3C FE/);
    assert.equal(writes, 0);
    onTab(1);
    assert.match(page().map(x=>x[0]).join('\n'), /Color mode/);
    buttons.get('BTN_SAT')(); // selected settings row: colorMode
    assert.equal(settings.get('colorMode'), 'preset');
    assert.deepEqual(['customRed','customGreen','customBlue'].map(k=>settings.get(k)), [254,155,65],
        'switching to presets synchronizes the RGB controls again');
    onTab(0);
    buttons.get('BTN_TARGET')();
    assert.equal(settings.get('applyTarget'), 'temporary');
    buttons.get('BTN_ACTION')(); // temporary starts with read, no unsolicited write
    assert.equal(reads, 1);
    assert.equal(writes, 0);
    onTab(2);
    assert.match(page().map(x=>x[0]).join('\n'), /FDL \/ CAFD writing not available/);
    assert.equal(settings.get('savedLilacRgb'), undefined);

    onTab(0);
    settings.set('customRed', 193); // user changes precise RGB in the emulator side panel
    const expectedRgb = [193, 155, 65];
    assert.equal(settings.get('colorMode'), 'custom');
    assert.deepEqual(['customRed','customGreen','customBlue'].map(k=>settings.get(k)), expectedRgb);
    assert.equal(settings.get('customHue'), A.rgbToGrid(expectedRgb).hue);
    assert.equal(settings.get('customSat'), A.rgbToGrid(expectedRgb).saturation);
    assert.match(page().map(x=>x[0]).join('\n'), /#C19B41/);

    settings.set('customHue', 120); // side-panel hue updates precise RGB in reverse
    assert.deepEqual(['customRed','customGreen','customBlue'].map(k => settings.get(k)),
        A.hsvToRgb(120, settings.get('customSat')));
});
