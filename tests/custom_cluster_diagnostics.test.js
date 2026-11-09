'use strict';
const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { ClusterLayers } = require('../apps/custom_cluster/cluster_layers');
const QR = require('../apps/custom_cluster/cluster_diagnostics');

class FakeRenderer extends EventEmitter {
    constructor(targets) {
        super();
        this.backend = 'id7';
        this.targets = targets || 'map:1088x480,panel:1920x720';
        this.effects = [];
        this.drops = [];
        this.uniforms = [];
        this.statusRequests = 0;
    }
    connect() { this.emit('ready'); }
    close() {}
    effect(options) { this.effects.push(options); return this.effects.length; }
    uniform(ref, name, value) { this.uniforms.push({ ref, name, value }); }
    drop(ref) { this.drops.push(ref); }
    status() { this.statusRequests++; }
}
const log = { info() {}, warn() {} };
const settings = (more) => Object.assign({
    layout: 'g80', panelTestMode: 'probe', panelTarget: 'panel',
    accent: 'm', sixwbTheme: 'comfort', sixwbColorSource: 'original',
    colorMode: 'palette', colorBrightness: 100,
    wazeMap: 'auto', phoneBadge: false,
}, more || {});

function parked(c) { c.sample({ speed: 0, rpm: 790, stage: 'P', gear: 0 }); }

const fake = new FakeRenderer();
const cluster = new ClusterLayers(log, null, fake);
cluster.settings(settings());
assert.strictEqual(cluster.status().ready, true);
assert.strictEqual(cluster.status().panelActive, false);
assert.strictEqual(cluster.armPanel(), false, 'no car signal should not activate panel');
parked(cluster);
assert.strictEqual(cluster.armPanel(), true);
assert.strictEqual(cluster.status().panelActive, true);
assert.strictEqual(cluster.status().panelLayer, 'requesting', 'created does not mean shown');
assert.strictEqual(fake.effects[0].target, 'panel');
assert.strictEqual(fake.effects[0].klass, 'content');
assert.strictEqual(fake.effects[0].x, 86);
assert.strictEqual(fake.effects[0].w, 260, 'small marker, not whole panel');
assert.ok(fake.effects[0].x + fake.effects[0].w < 416,
    'the diagnostic effect never overlaps the native map aperture');
assert.strictEqual(fake.effects[0].contend, true);
fake.emit('layer', 1, 'shown', '');
fake.emit('target', 'panel', 'mapped', 'custom_cluster', '');
fake.emit('status', 'slot 0x203 status 3: content class 2 map 1');
assert.strictEqual(cluster.status().panelLayer, 'shown');
assert.strictEqual(cluster.status().panelTargetState, 'mapped (custom_cluster)');
assert.ok(cluster.rendererStatus().includes('0x203'));
assert.strictEqual(cluster.armPanel(), false, 'press again stops');
assert.deepStrictEqual(fake.drops, [1]);

cluster.settings(settings({ panelTestMode: 'design', panelTarget: 'panel201', layout: 'sixwb' }));
assert.strictEqual(cluster.armPanel(), false, 'unsupported slot must not be requested');
assert.ok(/not advertised/.test(cluster.status().disarmReason));
cluster.settings(settings({ panelTestMode: 'design', layout: 'sixwb' }));
assert.strictEqual(cluster.armPanel(), true);
assert.strictEqual(fake.effects[1].w, 1920, 'opt-in full design covers panel');
cluster.observeVehicle({ stage: 'N' });
assert.strictEqual(cluster.status().panelActive, false, 'leaving P drops full design');
assert.deepStrictEqual(fake.drops, [1, 2]);
fake.emit('status', 'slot 0x203 status 3: content class 2 map 1');

const altRenderer = new FakeRenderer('panel:1920x720, panel201:1920x720, panel202:1920x720');
const altCluster = new ClusterLayers(log, null, altRenderer);
altCluster.settings(settings({ panelTarget: 'panel201', panelTestMode: 'probe' }));
parked(altCluster);
assert.strictEqual(altCluster.armPanel(), true, 'advertised alternative slot may be tested in P');
assert.strictEqual(altRenderer.effects[0].target, 'panel201');
altCluster.close();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-qr-test-'));
const ctx = { dataDir: tempDir, spec: { version: '0.5.2' } };
const testReport = QR.report(ctx, cluster, 'auto', 'none');
assert.ok(testReport.pages.length > 0);
const payloads = testReport.pages.map((page, idx) => {
    const m = /^CCLOG1 ([a-f0-9]{10}) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)$/.exec(page);
    assert.ok(m, 'header is machine readable');
    assert.strictEqual(Number(m[2]), idx + 1);
    assert.strictEqual(Number(m[3]), testReport.pages.length);
    return m[4];
});
const decoded = zlib.inflateSync(Buffer.from(payloads.join(''), 'base64')).toString('utf8');
assert.ok(decoded.includes('CUSTOM CLUSTER DIAGNOSTICS'));
assert.ok(decoded.includes('slot 0x203'));
assert.ok(QR.matrix(testReport.pages[0]).getModuleCount() > 0);
assert.strictEqual(testReport.storedAt.length > 0, true);
for (const source of ['g80_panel_shader', 'sixwb_panel_shader']) {
    const shader = require('../apps/custom_cluster/' + source);
    assert.ok(shader.includes('vec3 color=bg;'), source + ' keeps a uniform background');
    assert.ok(!shader.includes('vignette=') && !shader.includes('float shade='),
        source + ' has no edge-darkening vignette');
}
cluster.close();
console.log('custom-cluster staged render and QR diagnostics tests passed');
