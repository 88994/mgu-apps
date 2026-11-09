'use strict';
const mgu = require('./kit/mgu');
const fs = require('fs');
const path = require('path');
const P = require('./protocol');
const Link = require('./link');
const Guard = require('./guard');
const Journal = require('./journal');
const Engine = require('./engine');
const Preview = require('./preview');

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const journal = new Journal(ctx.dataDir);
        let engine, link, guard, preview = null, lastStatus = '', hiddenTimer = null, lastRoute = null;
        const config = () => P.settings((k) => settings.get(k));
        const refresh = () => {
            if (!engine) return;
            const s = engine.status(), text = (s.state === 'RUNNING' ? 'COMMANDS' : s.state) + ': ' + s.note;
            const route = settings.get('route');
            if (route !== lastRoute) {
                lastRoute = route;
                ui.visible('SET_PATTERN', route === 'digital');
                ui.visible('SET_TIMEDPATTERN', route === 'timed');
                ui.text('NOTICE', route === 'timed' ? 'NEW TEST: both lights together; physical effect not verified' : 'BDC outputs: no physical high-beam effect observed on the reported G21');
            }
            const line = text + (s.state === 'RUNNING' ? ' (' + s.remainingSeconds + ' s)' : '');
            if (line !== lastStatus) { lastStatus = line; ui.text('STATUS', line); }
            if (ui.isVisible('DIAGNOSTICS')) ui.text('DIAG_TEXT', diagnostics());
        };
        const changed = () => {
            if (engine && engine.run && ['STARTING', 'RUNNING'].indexOf(engine.state) >= 0) {
                const why = guard.reason();
                if (why || !link.available) engine.stop(why || 'Diagnostic connection lost');
            }
            refresh();
        };
        guard = new Guard(Date.now, changed);
        link = new Link(ctx.signals, log, changed);
        engine = new Engine({ link, guard, journal, log, changed: refresh });

        function diagnostics() {
            const s = engine.status(), g = guard.snapshot();
            return [
                'Light Show 0.2.0 - EXPERIMENTAL / physical effect not verified',
                'State: ' + s.state + ' - ' + s.note,
                'TASU: ' + (link.available ? 'available' : 'unavailable'),
                'BDC address: 40 | SGBD: ' + (link.index || 'not read') + ' | required: ' + P.INDEX,
                'Speed: ' + (g.speedKmh === null ? 'unknown' : g.speedKmh.toFixed(2) + ' km/h') + ' | age: ' + g.speedAgeMs + ' ms',
                'Selector: ' + (g.stage || 'unknown') + ' | ' + (g.blockedBy || 'P and stationary'),
                'Acknowledged commands (not proof of light): ' + s.sent + ' | measured step: ' + s.stepMs + ' ms',
                'Legacy IO return response: ' + (s.releaseConfirmed ? 'confirmed' : 'not confirmed this run'),
                'Stop command: ' + (s.stopConfirmed ? 'acknowledged' : 'not acknowledged') + ' | route: ' + s.control.route,
                'Recovery marker: ' + (journal.pending() ? 'PENDING - STOP or checked-light recovery' : 'clear'),
                'A positive diagnostic response is not a measured lamp state.',
                'Original start/show error: ' + (engine.originalFault || 'none recorded'),
                'Output status (raw, not physical proof):',
            ].concat(engine.outputSamples.map((x) => x.label + ': ' + (x.summary || x.error || 'raw only') + '\n' + (x.reply || ''))).concat([
                '', 'Recent diagnostic requests:',
            ]).concat(link.trace.slice(-14).map((r) => r.at.slice(11, 23) + ' > ' + r.tx + ' < ' + (r.rx || r.error || 'waiting'))).join('\n');
        }
        function saveLog() {
            try {
                const report = { app: 'light_show', version: '0.2.0', at: new Date().toISOString(),
                    physicalEffectVerified: false, status: engine.status(), guard: guard.snapshot(),
                    settings: config(), bdcIndex: link.index, recoveryPending: journal.pending(), originalFault: engine.originalFault, outputSamples: engine.outputSamples, trace: link.trace };
                const file = path.join(ctx.dataDir, 'light-show-diagnostics.json');
                fs.writeFileSync(file + '.tmp', JSON.stringify(report, null, 2)); fs.renameSync(file + '.tmp', file);
                ui.text('DIAG_TEXT', diagnostics() + '\n\nSaved: ' + file);
            } catch (e) { ui.text('DIAG_TEXT', diagnostics() + '\n\nLog save failed: ' + e.message); }
        }
        ui.onClick('BTN_FUNCTION_TEST', () => { preview = null; return engine.testFunction(settings.get('lights')); });
        ui.onClick('BTN_START', () => {
            preview = null;
            try { engine.start(config()); } catch (e) { engine.update('ERROR', e.message); }
        });
        ['BTN_STOP', 'BTN_DIAG_STOP'].forEach((name) => ui.onClick(name, () => {
            preview = null; return engine.stop('Stopped by user');
        }));
        ['BTN_IDENTIFY', 'BTN_DIAG_IDENTIFY'].forEach((name) => ui.onClick(name, () => engine.identify()));
        ui.onClick('BTN_DIAG', () => { ui.text('DIAG_TEXT', diagnostics()); return ui.open('DIAGNOSTICS'); });
        ui.onClick('BTN_EXPORT', saveLog);
        ui.onClick('BTN_CLEAR_LOCK', () => ui.open('CONFIRM_LIGHTS'));
        ui.onClick('BTN_CANCEL_CLEAR', () => ui.open('DIAGNOSTICS'));
        ui.onClick('BTN_CONFIRM_CLEAR', async () => {
            await engine.acknowledgeNormalLights(); await ui.open('DIAGNOSTICS');
        });
        ui.onClick('BTN_PREVIEW', async () => {
            // Stop an existing live show before entering the separate preview.
            await engine.stop('Opening screen preview');
            try { preview = { config: config(), startedAt: Date.now(), active: true }; await ui.open('PREVIEW'); }
            catch (e) { engine.update('ERROR', e.message); }
        });
        ui.onClick('BTN_PREVIEW_STOP', () => { if (preview) preview.active = false; });
        ui.onClick('BTN_BACK', () => ui.open('MAIN'));
        ctx.loop('PREVIEW', 15, () => {
            if (!preview) preview = { config: config(), startedAt: Date.now(), active: false };
            return ui.image('PREVIEW_GFX', Preview.draw(ctx.canvas(1600, 520), ctx.theme(), Object.assign({ now: Date.now() }, preview)));
        });
        settings.onChange(() => {
            preview = null;
            if (engine.run) engine.stop('Settings changed - start the show again');
            refresh();
        });
        ui.onVisible(() => {
            clearTimeout(hiddenTimer);
            hiddenTimer = setTimeout(() => {
                if (!['MAIN', 'PREVIEW', 'DIAGNOSTICS', 'CONFIRM_LIGHTS'].some((n) => ui.isVisible(n))) {
                    preview = null; if (engine.run) engine.stop('App closed');
                }
            }, 250);
        });
        // These are best-effort cleanup hooks: abrupt power loss cannot await
        // diagnostic replies. The persistent marker survives for the next open.
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => engine.stop('Head unit shutting down'));
        process.on('SIGTERM', () => { engine.stop('App stopped').then(() => process.exit(0)); });
        guard.init(ctx.signals, log).catch((e) => log.warn('Light Show vehicle signals: ' + e));
        let recoveryTried = false;
        function recover() {
            if (!recoveryTried && journal.pending() && link.available && !engine.run) {
                recoveryTried = true; engine.stop('Recovering previous lamp override');
            }
        }
        link.init().then(recover).catch((e) => log.warn('Light Show diagnostics: ' + e));
        setInterval(() => { changed(); recover(); }, 200);
        refresh();
    },
});
