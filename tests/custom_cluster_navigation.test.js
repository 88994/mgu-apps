'use strict';
// Regressions: after a QR report or diagnostics visit, re-opening MAIN must
// not keep a sticky full-screen diagnostics mode; pages must have clear exits.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps', 'custom_cluster');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const icon = fs.readFileSync(path.join(root, 'icon.png'));
const referenceIcon = fs.readFileSync(path.join(__dirname, '..', 'apps', 'g21_wheelheat', 'icon.png'));
assert.strictEqual(icon.subarray(1, 4).toString('ascii'), 'PNG', 'Custom Cluster must ship a PNG icon');
assert.strictEqual(icon.readUInt32BE(16), referenceIcon.readUInt32BE(16), 'BMW app icon width must match peer apps');
assert.strictEqual(icon.readUInt32BE(20), referenceIcon.readUInt32BE(20), 'BMW app icon height must match peer apps');
assert.strictEqual(icon.readUInt32BE(16), 140, 'ID7 installed-app tile should be 140px');
assert.deepStrictEqual(spec.screens.map((s) => s.name), ['MAIN', 'DIAGNOSTICS', 'QR_REPORT']);
for (const screen of spec.screens) {
    const ids = screen.buttons.map((b) => b[0]);
    assert.strictEqual(ids.length, new Set(ids).size, screen.name + ' duplicate buttons');
}

const clicks = new Map(), pages = [], loops = [], events = [];
let reportCount = 0;
const ui = {
    onClick: (name, fn) => clicks.set(name, fn),
    onVisible: (fn) => events.push(fn),
    open: (name) => { pages.push(name); return Promise.resolve(); },
};
const values = { layout: 'g80', panelTestMode: 'probe', panelTarget: 'panel',
    accent: 'm', colorMode: 'palette', colorBrightness: 100, cycleSeconds: 20,
    sixwbTheme: 'comfort', sixwbColorSource: 'original',
    phoneBridge: false, wazeMap: 'auto', phoneBadge: false };
const ctx = {
    dataDir: '/tmp', spec, ui,
    settings: { get: (key) => values[key], onChange() {} },
    log: { info() {}, warn() {} },
    loop: (name) => loops.push(name),
};
const cluster = {
    settings() {}, sample() {}, observeVehicle() {}, apply() {}, pollStatus() {}, badge() {}, close() {},
    armPanel() { return false; },
    status() { return { disarmReason: 'Selector N - P required' }; },
};
class FakeCar { onSample() {} data() { return { stage: 'N' }; } }
class FakeCluster { constructor() { return cluster; } }
class FakePhone { setEnabled() {} reported() { return 'none'; } stop() {} }
class FakeWaze { constructor() { this.status = 'auto'; } setChoice() {} }
const report = () => { reportCount++; return { id: 'test', pages: ['page1', 'page2'], storedAt: [] }; };
const deps = {
    './kit/mgu': { run: ({ start }) => start(ctx) },
    './kit/car': FakeCar,
    './kit/gauges': {},
    './cluster_layers.js': { ClusterLayers: FakeCluster },
    './phone_bridge.js': { PhoneBridge: FakePhone },
    './waze_control.js': { WazeControl: FakeWaze },
    './g80_preview.js': { drawG80Preview() {} },
    './sixwb_preview.js': { draw6WBPreview() {} },
    './cluster_colors.js': { resolveColor() { return []; }, resolve6WBColor() { return []; }, colorHex() { return ''; } },
    './kit/canvas': { withAlpha() { return ''; } },
    './cluster_diagnostics.js': { report, matrix: (data) => data, draw() {} },
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), {
    require: (name) => { assert.ok(deps[name], 'unexpected dependency ' + name); return deps[name]; },
    process: { once() {} }, setInterval: () => 1, clearInterval() {},
    Date, Math, console,
}, { filename: 'custom_cluster/main.js' });
assert.deepStrictEqual(loops, ['QR_REPORT', 'DIAGNOSTICS', 'MAIN']);
for (const screen of spec.screens) for (const [id] of screen.buttons)
    if (id !== 'BTN_SETTINGS') assert.ok(clicks.has(id), 'button handler missing: ' + id);

async function test() {
    await clicks.get('BTN_DIAG')();
    assert.strictEqual(pages.pop(), 'DIAGNOSTICS');
    await clicks.get('BTN_DIAG_HOME')();
    assert.strictEqual(pages.pop(), 'MAIN');
    await clicks.get('BTN_QR')();
    assert.strictEqual(pages.pop(), 'QR_REPORT');
    assert.strictEqual(reportCount, 1);
    clicks.get('BTN_QR_NEXT')();
    clicks.get('BTN_QR_NEXT')(); // wrap without closing the QR screen
    assert.strictEqual(reportCount, 1);
    clicks.get('BTN_QR_NEW')();
    assert.strictEqual(reportCount, 2);
    await clicks.get('BTN_QR_HOME')();
    assert.strictEqual(pages.pop(), 'MAIN');
    await clicks.get('BTN_DIAG_QR')();
    assert.strictEqual(pages.pop(), 'QR_REPORT');
    assert.strictEqual(reportCount, 3);
    assert.ok(events.length, 'HMI visibility should be logged');
    console.log('custom-cluster HMI navigation and QR page lifecycle tests passed');
}
test().catch((e) => { console.error(e); process.exitCode = 1; });
