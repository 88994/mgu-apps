'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const B = require('../apps/g21_wheelheat/logic');
const { ComfortAuto } = require('../apps/g21_wheelheat/comfort_auto');

test('0.4.1 UI: English tabs, manual setup is not live heat state; auto preview ends OFF', async () => {
    const manifest = require('../apps/g21_wheelheat/app.json');
    const values = Object.fromEntries(manifest.settings.map(s => [s.key, s.default]));
    const buttons = new Map();
    const lines = [];
    const logs = [];
    let render, timer, started, onTab, ecuReads = 0, ecuWrites = 0;
    let fakeNow = 100000;
    class Clock extends Date { static now() { return fakeNow; } }
    const settings = {
        get: k => values[k],
        set: (k, v) => { values[k] = v; },
        cycle: (k) => {
            const s = manifest.settings.find(item => item.key === k);
            if (s.type === 'bool') { settings.set(k, !values[k]); return; }
            const steps = s.type === 'choice' ? s.options.map(x => x[0]) : s.steps;
            settings.set(k, steps[(steps.indexOf(values[k]) + 1) % steps.length]);
        },
        onChange() {},
    };
    const ctx = {
        settings,
        signals: { watch: async () => ({ available: false }) },
        log: { info: s => logs.push(s), warn() {} },
        ui: { onClick: (id, cb) => buttons.set(id, cb), image() {} },
        onTab: fn => { onTab = fn; },
        loop: (_name, _fps, cb) => { render = cb; },
        theme: () => ({ bg: '#000', text: '#fff', warn: '#fc0', dim: '#888', accent: '#6cf' }),
        canvas: () => ({ clear() { return this; }, fillRect() {}, text(s) { lines.push(String(s)); } }),
    };
    class MockSafeDiag {
        constructor() {
            this.online = false;
            this.speed = null;
            this.readText = 'not yet read';
            this.info = 'Test preview';
            this.verified = false;
            this.writeReady = 'Writes disabled';
        }
        async init() {}
        cancel() {}
        read() { ecuReads++; }
        write() { ecuWrites++; }
    }
    const imports = {
        './kit/mgu': { run: ({ start }) => { started = start(ctx); } },
        './kit/gauges': { frame() {}, panel() {} },
        './logic': B,
        './comfort_auto': { ComfortAuto },
        './safe_diag': { SafeDiag: MockSafeDiag,
            bytes: b => b.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') },
    };
    const file = path.join(root, 'apps/g21_wheelheat/main.js');
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
        require: k => { if (!imports[k]) throw Error('unbekannt: ' + k); return imports[k]; },
        setInterval: cb => { timer = cb; }, Date: Clock, Number, String, console,
    }, { filename: file });
    await started;
    assert.ok(logs.some(s => s.includes('[WHEELHEAT] process started')),
        'boot-start diagnostics are visible in MGU logs');
    const screenshotLines = () => { lines.length = 0; render(); return lines.slice(); };
    onTab(2);
    let display = screenshotLines().join('\n');
    assert.equal(manifest.version, '0.4.1');
    assert.match(display, /MANUAL\s+2E D0 74 3C\s+\(60s\)/);
    assert.match(display, /AUTO WHEEL\s+2E D0 74 B4\s+\(3min\)/);

    settings.set('manualSeconds', 120);
    settings.set('wheelMins', 4);
    settings.set('seatMins', 2);
    display = screenshotLines().join('\n');
    assert.match(display, /MANUAL\s+2E D0 74 78\s+\(120s\)/);
    assert.match(display, /AUTO WHEEL\s+2E D0 74 F0\s+\(4min\)/);
    assert.match(display, /AUTO DRIVER\s+2E E4 32 03 78/);
    onTab(0);
    buttons.get('BTN_SELECT')();
    onTab(2);
    assert.match(screenshotLines().join('\n'), /MANUAL\s+2E D0 74 B4\s+\(180s\)/);

    settings.set('autoEnabled', true);
    settings.set('simTempEnabled', true);
    settings.set('simTempC', -5);
    settings.set('coldDwell', 0);
    timer();
    onTab(0);
    display = screenshotLines().join('\n');
    assert.match(display, /TEST: -5\.0 C\s+Threshold 8 C/);
    assert.match(display, /COMMAND SELECTION - NOT LIVE HEATER STATUS/);
    assert.match(display, /Heat for 180 seconds/);
    assert.match(display, /This value does not indicate heating is active/);
    assert.ok(!display.includes('ON Driver seat: 2E'),
        'raw automatic commands belong in Diagnostics, not manual setup');
    onTab(2);
    assert.match(screenshotLines().join('\n'), /ON Driver seat: 2E E4 32 03 78/);
    assert.ok(logs.some(s => s.includes('[AUTO PREVIEW ONLY]')));
    fakeNow += 240000;
    timer();
    onTab(0);
    display = screenshotLines().join('\n');
    assert.match(display, /PREVIEW CYCLE FINISHED/);
    assert.match(display, /Heat for 180 seconds/, 'manual setup remains unchanged after AUTO OFF');
    assert.match(display, /COMMAND SELECTION - NOT LIVE HEATER STATUS/);
    onTab(2);
    assert.match(screenshotLines().join('\n'), /OFF Driver seat: 2E E4 32 00 00/);
    assert.equal(ecuReads, 0, 'boot-time preview must not read ECUs on its own');
    assert.equal(ecuWrites, 0, 'boot-time preview must never write ECU commands');
    onTab(1);
    assert.match(screenshotLines().join('\n'), /Comfort preview/);
    buttons.get('BTN_ADJUST')();
    assert.equal(settings.get('autoEnabled'), false);
});
