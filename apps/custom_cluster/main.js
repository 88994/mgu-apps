'use strict';
/**
 * Custom Cluster 0.5.1 - staged KOMBI probe, diagnostic logs, map-safe panels.
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
const QR = require('./cluster_diagnostics.js');

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
        let showDiagnostics = false, qrReport = null, qrPage = 0, qrMatrix = null, qrError = '';

        function syncSettings() {
            cluster.settings({ layout: settings.get('layout'), accent: settings.get('accent'),
                sixwbTheme: settings.get('sixwbTheme'), sixwbColorSource: settings.get('sixwbColorSource'),
                colorMode: settings.get('colorMode'), rgbRed: settings.get('rgbRed'),
                rgbGreen: settings.get('rgbGreen'), rgbBlue: settings.get('rgbBlue'),
                colorBrightness: settings.get('colorBrightness'), cycleSeconds: settings.get('cycleSeconds'),
                phoneBadge: !!settings.get('phoneBadge'), wazeMap: settings.get('wazeMap'),
                panelTestMode: settings.get('panelTestMode'), panelTarget: settings.get('panelTarget') });
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
        ui.onClick('BTN_DIAG', () => {
            qrReport = null;
            showDiagnostics = !showDiagnostics;
            cluster.pollStatus(true);
        });
        // Photographed QR pages can be transferred without any phone-to-MGU network.
        // First press captures a fresh report; successive presses show the next page.
        ui.onClick('BTN_QR', () => {
            showDiagnostics = false;
            try {
                if (!qrReport) {
                    cluster.pollStatus(true);
                    qrReport = QR.report(ctx, cluster, waze.status, bridge.reported());
                    qrPage = 0;
                    log.info('cluster log export ' + qrReport.id + ': ' + qrReport.pages.length +
                        ' QR pages; saved to ' + qrReport.storedAt.join(', '));
                } else {
                    qrPage++;
                    if (qrPage >= qrReport.pages.length) { qrReport = null; qrMatrix = null; return; }
                }
                qrMatrix = QR.matrix(qrReport.pages[qrPage]);
                qrError = '';
            } catch (e) {
                qrReport = null;
                qrMatrix = null;
                qrError = String(e && e.message || e);
                log.warn('cluster QR: ' + qrError);
            }
        });

        // A stale Shortcut event is never displayed as proof that an app runs.
        const cleanup = setInterval(() => {
            cluster.observeVehicle(car.data());
            cluster.badge(bridge.reported() === 'opened');
            cluster.apply();
            cluster.pollStatus(false);
        }, 250);
        process.once('exit', () => { clearInterval(cleanup); cluster.close(); bridge.stop(); });

        ctx.loop('MAIN', 2, () => {
            const t = ctx.theme(), d = car.data(), st = cluster.status();
            const cv = ctx.canvas(1600, 520).clear(t.bg);
            const layout = settings.get('layout');
            if (qrReport && qrMatrix) {
                G.frame(cv, t, ['Custom Cluster', 'QR diagnostics'], 0, [{ text: 'OFFLINE LOG' }]);
                cv.text('Cluster diagnostic QR export', 60, 98, 37, t.text, { font: 'bold' });
                cv.text('Page ' + (qrPage + 1) + ' / ' + qrReport.pages.length +
                    '   Report ' + qrReport.id, 60, 151, 27, t.text);
                cv.text('Photograph/scan every page in order.', 60, 215, 25, t.dim);
                cv.text('Press QR logs for next page; after last: close.', 60, 257, 22, t.dim);
                cv.text('No Wi-Fi or internet is required.', 60, 302, 22, t.dim);
                cv.text('Full text also saved in app data and on USB if available.', 60, 346, 19, t.dim);
                cv.text('To decode: tools/decode_custom_cluster_logs.py', 60, 407, 18, t.text);
                QR.draw(cv, qrMatrix, 1080, 75, 395);
                return ctx.ui.image('MAIN_GFX', cv);
            }
            if (showDiagnostics) {
                const current = cluster.status();
                const statusLines = cluster.rendererStatus().split('\n')
                    .filter((line) => /^(slot |target |layer |panel|scene|Dcsm|cluster|error|guard)/i.test(line))
                    .slice(0, 13);
                G.frame(cv, t, ['Custom Cluster', 'Diagnostics'], 0, [{ text: 'PARKED TEST' }]);
                cv.text('Renderer: ' + current.rendererBackend +
                    '  /  ' + (current.ready ? 'connected' : 'offline'), 48, 85, 25, t.text);
                cv.text('Targets: ' + current.rendererTargets.slice(0, 110), 48, 118, 17, t.dim);
                cv.text('Requested: ' + (current.panelActive ? 'YES' : 'NO') +
                    ' / ' + current.panelTarget + ' / ' + (current.activeTestMode || '-'), 48, 158, 21, t.text);
                cv.text('Layer: ' + current.panelLayer +
                    '  |  Slot: ' + current.panelTargetState, 48, 188, 20, t.text);
                cv.text('Slot reason: ' + (current.panelTargetReason || '-').slice(0, 112), 48, 216, 17, t.warn);
                cv.text('Last refusal: ' + (current.lastRefusal || '-').slice(0, 115), 48, 244, 17, t.warn);
                cv.text('Renderer status lines (read-only):', 48, 285, 19, t.text);
                if (!statusLines.length)
                    cv.text('No status reply yet. The renderer may not support status reports.', 48, 310, 16, t.dim);
                statusLines.forEach((line, i) =>
                    cv.text(line.slice(0, 205), 48, 306 + i * 15, 12, t.dim));
                return ctx.ui.image('MAIN_GFX', cv);
            }
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
            cv.text('Panel: ' + (st.panelActive ? 'REQUESTED (' + st.secondsLeft + 's)' : 'STOCK'),
                1150, 224, 20, st.panelActive ? '#2fd27a' : t.text);
            cv.text('Layer: ' + st.panelLayer.slice(0, 29) +
                '  / Slot: ' + st.panelTargetState.slice(0, 12), 1150, 257, 16, t.dim);
            cv.text('Test: ' + (st.activeTestMode || settings.get('panelTestMode')) +
                ' @ ' + settings.get('panelTarget'), 1150, 286, 16, t.dim);
            cv.text('Last: ' + st.disarmReason.slice(0, 39), 1150, 314, 16, t.dim);
            cv.text('Waze: ' + waze.status.slice(0, 34), 1150, 341, 18, t.text);
            cv.text('iPhone event: ' + bridge.reported(), 1150, 369, 17, t.text);
            cv.text('Phone bridge: ' + (bridge.url('on') ? 'ready' : 'off'), 1150, 396, 17, t.text);
            if (bridge.url('on')) {
                cv.text(bridge.url('on'), 1135, 418, 11, t.text);
                cv.text(bridge.url('off'), 1135, 442, 11, t.text);
            } else cv.text('Shortcuts URLs in Settings', 1150, 434, 17, t.dim);
            if (qrError) cv.text('QR: ' + qrError.slice(0, 48), 1140, 463, 13, t.warn);

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
