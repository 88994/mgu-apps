'use strict';
/**
 * Custom Cluster 0.5.0 - G80, G21 and 6WB-inspired parked panels, colour studio.
 * Stock is the default. Real values only can reach cluster-render; emulator
 * and demo values stay exclusively on the centre-screen preview.
 */
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const G = require('./kit/gauges');
const { ClusterLayers } = require('./cluster_layers.js');
const { PhoneBridge } = require('./phone_bridge.js');
const { WazeControl } = require('./waze_control.js');
const { drawG80Preview } = require('./g80_preview.js');
const { draw6WBPreview } = require('./sixwb_preview.js');
const { resolveColor, resolve6WBColor, colorHex } = require('./cluster_colors.js');
const { withAlpha } = require('./kit/canvas');

function fmt(v, unit) { return G.isNum(v) ? String(Math.round(v)) + (unit || '') : '--'; }

mgu.run({
    async start(ctx) {
        const { settings, log, ui } = ctx;
        const car = new Car(ctx, ['rpm', 'speed', 'temps', 'gear']);
        const cluster = new ClusterLayers(log);
        const waze = new WazeControl(log);
        const bridge = new PhoneBridge(ctx.dataDir, log, () => {
            cluster.badge(bridge.reported() === 'opened');
        });

        function syncSettings() {
            cluster.settings({ layout: settings.get('layout'), accent: settings.get('accent'),
                sixwbTheme: settings.get('sixwbTheme'), sixwbColorSource: settings.get('sixwbColorSource'),
                colorMode: settings.get('colorMode'), rgbRed: settings.get('rgbRed'),
                rgbGreen: settings.get('rgbGreen'), rgbBlue: settings.get('rgbBlue'),
                colorBrightness: settings.get('colorBrightness'), cycleSeconds: settings.get('cycleSeconds'),
                phoneBadge: !!settings.get('phoneBadge'), wazeMap: settings.get('wazeMap') });
            bridge.setEnabled(!!settings.get('phoneBridge'));
            waze.setChoice(settings.get('wazeMap'));
        }
        syncSettings();
        settings.onChange(syncSettings);
        car.onSample((d) => { if (!d.demo) cluster.sample(d); });
        ui.onClick('BTN_TEST', () => {
            const enabled = cluster.armPanel();
            log.info('panel test: ' + (enabled ? 'armed for 12 s' : cluster.status().disarmReason));
        });

        // A stale Shortcut event is never displayed as proof that an app runs.
        const cleanup = setInterval(() => {
            cluster.observeVehicle(car.data());
            cluster.badge(bridge.reported() === 'opened');
            cluster.apply();
        }, 250);
        process.once('exit', () => { clearInterval(cleanup); cluster.close(); bridge.stop(); });

        ctx.loop('MAIN', 2, () => {
            const t = ctx.theme(), d = car.data(), st = cluster.status();
            const cv = ctx.canvas(1600, 520).clear(t.bg);
            const layout = settings.get('layout');
            const activeOptions = { accent: settings.get('accent'),
                colorMode: settings.get('colorMode'), rgbRed: settings.get('rgbRed'),
                rgbGreen: settings.get('rgbGreen'), rgbBlue: settings.get('rgbBlue'),
                colorBrightness: settings.get('colorBrightness'), cycleSeconds: settings.get('cycleSeconds'),
                sixwbTheme: settings.get('sixwbTheme'), sixwbColorSource: settings.get('sixwbColorSource') };
            const accentHex = colorHex(layout === 'sixwb' ? resolve6WBColor(activeOptions, Date.now())
                : resolveColor(activeOptions, Date.now()));
            G.frame(cv, t, ['Custom Cluster'], 0,
                [d.demo ? { text: 'PREVIEW' } : { text: st.ready ? 'RENDERER READY' : 'RENDERER OFFLINE' }]);

            G.panel(cv, t, 24, 48, 1070, 450, 'Cluster design: ' + layout.toUpperCase());
            if (layout === 'sixwb') {
                draw6WBPreview(cv, { x: 38, y: 86, w: 1042, h: 398 }, d,
                    { wazeMap: settings.get('wazeMap'), color: accentHex, mode: settings.get('sixwbTheme') }, st);
            } else if (layout === 'g80' || layout === 'oem') {
                drawG80Preview(cv, { x: 38, y: 86, w: 1042, h: 398 }, d,
                    { wazeMap: settings.get('wazeMap'), color: accentHex, variant: layout }, st);
            } else if (layout === 'classic') {
                G.radial(cv, t, 300, 302, 156, { value: d.speed, min: 0, max: 260, label: 'SPEED', unit: 'km/h', ticks: 13, color: accentHex });
                G.radial(cv, t, 824, 302, 156, { value: d.rpm, min: 0, max: 5000, label: 'RPM', ticks: 10, color: accentHex });
            } else if (layout === 'sport') {
                G.segBar(cv, t, 75, 135, 964, 120, { label: 'Engine speed', value: d.rpm, min: 0, max: 5000,
                    unit: 'rpm', step: 250, limit: 4800, color: accentHex });
                cv.text(fmt(d.speed), 115, 407, 82, t.text, { font: 'num' });
                cv.text('km/h', 420, 407, 30, t.dim);
                cv.text('OIL ' + fmt(d.oil, ' C'), 800, 394, 27, t.dim);
            } else if (layout === 'minimal') {
                cv.text(fmt(d.speed), 170, 310, 128, t.text, { font: 'num' });
                cv.text('km/h', 520, 308, 36, t.dim);
                cv.text('RPM  ' + fmt(d.rpm), 175, 415, 36, accentHex);
            } else {
                cv.text('BMW ORIGINAL CLUSTER', 80, 255, 46, t.text, { font: 'bold' });
                cv.text('Waze map remains unchanged', 85, 330, 28, t.dim);
            }

            G.panel(cv, t, 1120, 48, 456, 450, 'Renderer / panel test');
            cv.text('Cluster render: ' + (st.ready ? 'Connected' : 'Waiting'), 1150, 137, 24, st.ready ? '#2fd27a' : t.warn);
            cv.text('Live data: ' + (st.live ? 'YES' : 'NO') + '  |  Gear P: ' + (st.parked ? 'YES' : 'NO'),
                1150, 180, 21, st.parked ? '#2fd27a' : t.dim);
            cv.text('Panel: ' + (st.panelActive ? 'TEST ACTIVE (' + st.secondsLeft + 's)' : 'STOCK'),
                1150, 224, 20, st.panelActive ? '#2fd27a' : t.text);
            cv.text('Button: Parked panel test', 1150, 260, 19, t.dim);
            cv.text('Last: ' + st.disarmReason.slice(0, 38), 1150, 291, 17, t.dim);
            cv.text('Waze: ' + waze.status.slice(0, 34), 1150, 325, 18, t.text);
            cv.text('iPhone event: ' + bridge.reported(), 1150, 355, 19, t.text);
            cv.text('Phone bridge: ' + (bridge.url('on') ? 'ready' : 'off'), 1150, 385, 19, t.text);
            if (bridge.url('on')) {
                cv.text(bridge.url('on'), 1135, 415, 12, t.text);
                cv.text(bridge.url('off'), 1135, 444, 12, t.text);
            } else cv.text('Shortcuts URLs in Settings', 1150, 423, 18, t.dim);

            if (layout === 'g80' || layout === 'oem' || layout === 'sixwb') {
                cv.text('Parked test only · Never assume this replaces OEM warnings',
                    1136, 474, 17, t.warn);
            } else if (!st.live && layout !== 'stock') {
                cv.fillRect(54, 460, 1000, 33, withAlpha('#e6ad37', 0.12));
                cv.text(d.demo ? 'PREVIEW ONLY - never sent to the cluster' : 'No real signals: BMW cluster stays in control',
                    70, 483, 20, t.warn);
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
