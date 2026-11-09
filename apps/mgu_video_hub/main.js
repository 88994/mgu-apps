'use strict';

const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const media = require('./media');
const { VideoBridge, rendererRegister, videoOp, ID } = require('./video_bridge');
const { Companion } = require('./companion');
const { readNetworkStatus } = require('./network_status');
const { StoreUplink } = require('./uplink');
const { Diagnostics, safeText } = require('./diagnostics');
const { openEq } = require('./audio_eq');
const qrcode = require('./qr_vendor');

const W = 1600, H = 520;
const TABS = ['Library', 'YouTube', 'Player', 'Connection'];
const COLOR = { bg:'#08131f', panel:'#142738', soft:'#1b3448', muted:'#9ab1c3',
    white:'#f0f6fd', cyan:'#62d1ff', green:'#82e7bb', amber:'#f7be7b', red:'#ff918c' };
const videoDir = dir => path.join(dir, 'videos');
function trim(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 3) + '...' : s; }
function text(cv, s, x, y, sz, c, opts) { cv.text(String(s).replace(/[^\x20-\x7e]/g, '?'), x, y, sz, c, opts || {}); }
function btn(cv, title, x, y, w, h, cb, key, fill) {
    cv.roundRect(x, y, w, h, 11, fill || COLOR.soft);
    text(cv, title, x + w / 2, y + h / 2 + 7, 19, COLOR.white, {align:'center'});
    cv.target(x, y, w, h, cb, key, 11);
}
function mmss(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function qrDraw(cv, link, x, y, size) {
    if (!link) return;
    let qr;
    try { qr = qrcode(0, 'M'); qr.addData(link); qr.make(); } catch (_) { return; }
    const n = qr.getModuleCount(), q = 4, cell = Math.floor(size / (n + q * 2));
    const span = cell * (n + q * 2);
    cv.fillRect(x, y, span, span, '#ffffff');
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++)
        if (qr.isDark(yy, xx)) cv.fillRect(x + (xx + q) * cell, y + (yy + q) * cell, cell, cell, '#0a1723');
}
function loadLinks(dir) {
    try { const a = JSON.parse(fs.readFileSync(path.join(dir, 'youtube.json'), 'utf8'));
        return Array.isArray(a) ? a.filter(x => /^[A-Za-z0-9_-]{11}$/.test(x)).slice(-100) : [];
    } catch (_) { return []; }
}
function saveLinks(dir, links) {
    const filename = path.join(dir, 'youtube.json');
    fs.writeFileSync(filename + '.tmp', JSON.stringify(links));
    fs.renameSync(filename + '.tmp', filename);
}

mgu.run({
    async start(ctx) {
        const log = ctx.log;
        const diagnostics = new Diagnostics(ctx.dataDir, ctx.spec && ctx.spec.version || '0.1.4');
        const record = (level, event, detail) => diagnostics.add(level, event, detail);
        const uplink = new StoreUplink(ctx.dataDir, log);
        uplink.start();
        const video = new VideoBridge(log, {
            proxyProvider: () => uplink.ownLease() ? uplink.proxyUrl : null,
            mediaProxyProvider: () => uplink.ownLease() ? uplink.mediaProxyUrl : null,
            onEvent: record,
        });
        let page = 0, selected = 0, startAt = 0, files = [], links = loadLinks(ctx.dataDir);
        let notice = '', lastScan = 0, lastVideoBind = 0, boundGpu = null;
        let network = {ready:false, error:'Network tool not responding'};
        let lastNetworkPoll = 0, lastNetworkReply = 0, networkPollPending = false;
        let lastNetworkState = '', lastUplinkState = '', lastRendererReady = null, lastVehicleState = '';
        let lastPhoneError = '', lastUplinkError = '';
        let lastDiagnosticPoll = 0;
        let speed = null, speedAt = 0, lastSource = null, importCount = 0;
        record('INFO', 'app.started', 'Node ' + process.version + ' / ' + process.arch +
            '; ffmpeg=' + !!video.ffmpeg + '; yt-dlp=' + !!video.resolver + '; aplay=' + !!video.aplay);
        if (!video.ffmpeg) record('WARN', 'decoder.missing', 'ffmpeg not installed or not executable for OAP user');
        if (!video.resolver) record('WARN', 'youtube.resolver_missing', 'yt-dlp not installed or not executable for OAP user');
        const canPlay = () => speed !== null && Date.now() - speedAt < 5000 && speed <= .5;
        const speedHint = () => speed === null || Date.now() - speedAt >= 5000 ?
            'Waiting for real vehicle-speed data. Playback is locked.' :
            speed > .5 ? 'Moving vehicle. Playback stopped.' : '';
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: v => {
                const raw = v && v.speedVehicleCentreOfGravity;
                if (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw !== 65535) {
                    speed = raw * .015625; speedAt = Date.now();
                    if (!canPlay() && (video.playing || video.resolving)) {
                        video.stop(); notice = 'Playback stopped: moving vehicle.';
                        record('WARN', 'safety.playback_stopped', 'Vehicle speed exceeds parked threshold');
                    }
                }
            },
        }, log, {pollMs:2000}).then(s => {
            if (s && s.error) {
                log.warn('[VideoHub] speed: ' + s.error);
                record('WARN', 'vehicle.signal_error', s.error);
            }
        }).catch(e => {
            log.warn('[VideoHub] speed: ' + e.message);
            record('ERROR', 'vehicle.watch_failed', e.message);
        });

        function rescan() {
            const previous = files.length;
            files = media.scan(ctx.dataDir);
            selected = Math.max(0, Math.min(selected, Math.max(0, entries().length - 1)));
            lastScan = Date.now();
            if (files.length !== previous) record('INFO', 'library.changed', 'files=' + files.length);
        }
        function addYoutube(id) {
            links = links.filter(x => x !== id).concat([id]).slice(-100);
            saveLinks(ctx.dataDir, links);
            notice = 'Added YouTube video ' + id;
            log.info('[VideoHub] YouTube video added: ' + id);
            record('INFO', 'youtube.link_added', 'videoId=' + id);
        }
        function statusSnapshot() {
            return {
                capabilities:{rendererV4:gpuReady(), ffmpeg:!!video.ffmpeg,
                    ytDlp:!!video.resolver, aplay:!!video.aplay},
                uplink:{state:uplink.status(), appLease:!!uplink.ownLease()},
                phone:{serverListening:phone.listening, firewallReady:!!network.ready,
                    firewallError:safeText(network.error || phone.error || '')},
                vehicle:{speedState:speedHint() || 'Parked and signal fresh', playbackAllowed:canPlay()},
                player:{status:safeText(video.status), error:safeText(video.error),
                    frames:video.frames, sourceType:lastSource ? lastSource.type : null,
                    playing:video.playing, paused:video.paused},
                library:{files:files.length, youtubeLinks:links.length, imports:importCount},
            };
        }
        const phone = new Companion(ctx.dataDir, {
            youtube: addYoutube,
            upload: name => {
                importCount++; rescan(); notice = 'Imported ' + name;
                record('INFO', 'phone.upload_completed', 'file=' + name);
            },
            fileCount: () => files.length,
            linkCount: () => links.length,
            logCount: () => diagnostics.events.length,
            failure: (event, detail) => record('WARN', event, detail),
            diagnostics: () => {
                record('INFO', 'diagnostics.exported', 'Phone diagnostic JSON requested');
                return diagnostics.snapshot(statusSnapshot());
            },
        }, log);
        try { phone.start(); record('INFO', 'phone.server_starting', 'port=' + phone.port); }
        catch (e) {
            phone.error = e.message; log.warn('[VideoHub] phone server: ' + e.message);
            record('ERROR', 'phone.server_failed', e.message);
        }
        rescan();
        const link = phone.link();
        function refreshNetwork() {
            if (networkPollPending) return;
            networkPollPending = true;
            readNetworkStatus((error, result) => {
                networkPollPending = false;
                network = error ? {ready:false, error:'Network tool unavailable: ' + error.message} : result;
                lastNetworkReply = Date.now();
                const state = network.ready ? 'ready' : network.error ? 'error:' + safeText(network.error) : 'waiting';
                if (state !== lastNetworkState) {
                    lastNetworkState = state;
                    record(network.ready ? 'INFO' : 'WARN', 'phone.network_state', state);
                }
            });
        }
        function entries() {
            if (page === 0) return files;
            if (page === 1) return links.map(id => ({id, name:'YouTube: ' + id, type:'youtube'}));
            return [];
        }
        function gpuReady() {
            const gpu = ctx.display.gpu;
            return !!(ctx.display.active('MAIN') && gpu && gpu.ready && gpu.native && gpu.info && gpu.info.video);
        }
        function stop() { video.stop(); lastVideoBind = 0; }
        function play(item, seek) {
            if (!item) {
                notice = 'Select a video first.';
                record('WARN', 'playback.blocked', 'No video selected');
                return;
            }
            record('INFO', 'playback.request', 'source=' + (item.type || 'local') +
                (item.id ? ' videoId=' + item.id : '') + ' seek=' + (seek || 0));
            if (!canPlay()) {
                notice = speedHint();
                record('WARN', 'safety.playback_blocked', notice);
                return;
            }
            if (!gpuReady()) {
                notice = 'Video renderer v4 unavailable; check Connection.';
                record('ERROR', 'renderer.unavailable', notice);
                return;
            }
            if (!video.ffmpeg) {
                notice = 'ffmpeg missing on MGU; check Connection.';
                record('ERROR', 'decoder.missing', notice);
                return;
            }
            lastSource = item.type === 'youtube' || item.id && /^[A-Za-z0-9_-]{11}$/.test(item.id) ?
                {type:'youtube', id:item.id, name:item.name} : {type:'local', path:item.path, name:item.name};
            video.start(lastSource, seek || 0, Number(ctx.settings.get('resolution')), ctx.settings.get('audio'));
            page = 2; notice = ''; lastVideoBind = 0;
        }
        function action() {
            if (page === 2) {
                if (!canPlay()) { stop(); notice = speedHint(); return; }
                if (video.child) video.pause();
                else if (lastSource) play(lastSource, video.position);
            } else if (page === 0 || page === 1) play(entries()[selected]);
            else if (page === 4) tab(3);
            else { page = 0; rescan(); }
        }
        function tab(i) {
            if (i === 2 && !lastSource) { notice = 'Choose a video in Library or YouTube.'; return; }
            if (page === 2 && i !== 2) stop();
            page = i; selected = 0; startAt = 0; notice = '';
            if (i === 0) rescan();
        }
        ctx.ui.onClick('BTN_TAB', () => tab((page + 1) % TABS.length));
        ctx.ui.onClick('BTN_ACTION', action);
        ctx.ui.onClick('BTN_BACK', () => { if (page === 4) tab(3); else { stop(); tab(0); } });
        ctx.ui.onClick('BTN_IMPORT', () => tab(3));
        ctx.ui.onClick('BTN_AUDIO_EQ', () => openEq(ctx).catch((e) => { notice = String(e.message || e); }));
        ctx.ui.onVisible((name, visible) => {
            if (name === 'MAIN' && !visible && (video.playing || video.resolving)) {
                stop(); notice = 'Playback stopped when the app was closed.';
                record('WARN', 'safety.screen_hidden', notice);
            }
        });
        if (ctx.ui.onFocus) ctx.ui.onFocus(() => {
            if (!ctx.ui.hasFocus('MAIN') && (video.playing || video.resolving)) {
                stop(); notice = 'Playback stopped: another screen has focus.';
                record('WARN', 'safety.focus_lost', notice);
            }
        });
        const onExit = () => {
            record('INFO', 'app.exiting', 'Stopping video and companion');
            stop(); phone.stop(); uplink.stop();
        };
        process.on('exit', onExit);

        function drawHeader(cv) {
            cv.fillRect(0, 0, W, 8, COLOR.cyan);
            text(cv, 'MGU  /  VIDEO HUB', 45, 50, 25, COLOR.white);
            text(cv, canPlay() ? 'PARKED' : 'PLAYBACK LOCKED', 1540, 49, 17,
                canPlay() ? COLOR.green : COLOR.red, {align:'right'});
            TABS.forEach((t, i) => {
                const x = 45 + i * 385, current = page === i || page === 4 && i === 3;
                cv.roundRect(x, 69, 368, 48, 12, current ? '#24475c' : COLOR.panel);
                if (current) cv.fillRect(x + 14, 112, 338, 4, COLOR.cyan);
                text(cv, t.toUpperCase(), x + 184, 101, 19, current ? COLOR.white : COLOR.muted, {align:'center'});
                cv.target(x, 69, 368, 48, () => tab(i), 'TAB_' + i, 10);
            });
        }
        function drawList(cv, type) {
            const all = entries();
            text(cv, type === 'youtube' ? 'SAVED YOUTUBE LINKS' : 'LOCAL VIDEOS + USB MEDIA', 54, 157, 23, COLOR.white);
            text(cv, all.length + ' items', 1529, 157, 18, COLOR.muted, {align:'right'});
            if (!all.length) {
                cv.roundRect(48, 183, 1500, 260, 18, COLOR.panel);
                text(cv, type === 'youtube' ? 'No YouTube links yet.' : 'No videos found.', 800, 270, 32, COLOR.white, {align:'center'});
                text(cv, type === 'youtube' ? 'Open Phone / USB and send a YouTube link.' :
                    'Upload from the phone or connect a USB stick with MP4 / MKV / MOV.',
                    800, 319, 21, COLOR.muted, {align:'center'});
            }
            all.slice(startAt, startAt + 6).forEach((item, k) => {
                const i = startAt + k, col = k % 3, row = Math.floor(k / 3);
                const x = 46 + col * 517, y = 187 + row * 132, active = i === selected;
                cv.roundRect(x, y, 490, 115, 15, active ? '#21475b' : COLOR.panel);
                cv.roundRect(x + 15, y + 13, 94, 88, 12, active ? '#32617a' : '#263e51');
                text(cv, type === 'youtube' ? 'YT' : item.source === 'USB' ? 'USB' : 'FILE',
                    x + 62, y + 64, 24, COLOR.cyan, {align:'center'});
                text(cv, trim(item.name, 29), x + 128, y + 45, 20, COLOR.white);
                text(cv, type === 'youtube' ? 'Online - not downloaded' :
                    item.source + '  /  ' + (item.size / 1048576).toFixed(1) + ' MB',
                    x + 128, y + 77, 16, COLOR.muted);
                cv.target(x, y, 490, 115, () => { selected = i; play(item); }, 'ITEM_' + i, 13);
            });
            if (all.length > 6) {
                btn(cv, 'Previous', 1037, 450, 244, 49, () => {startAt = Math.max(0, startAt - 6);}, 'PREV');
                btn(cv, 'Next', 1294, 450, 244, 49, () => {startAt = Math.min(all.length - 1, startAt + 6);}, 'NEXT');
            }
        }
        function drawPlayer(cv) {
            cv.roundRect(46, 137, 1180, 342, 14, '#01050b');
            const active = video.playing || video.frames > 0;
            if (gpuReady() && active && video.fd !== null) {
                const gpu = ctx.display.gpu;
                if (boundGpu !== gpu || Date.now() - lastVideoBind >= 1300) {
                    if (rendererRegister(gpu, video.path, ID)) {boundGpu = gpu; lastVideoBind = Date.now();}
                }
                videoOp(cv, ID, 46, 137, 1180, 342, 13);
            } else text(cv, video.status, 635, 305, 34, COLOR.muted, {align:'center'});
            // Controls are drawn over the VIDEO op (and remain touch/iDrive targets).
            cv.roundRect(1250, 137, 305, 342, 16, COLOR.panel);
            text(cv, trim(lastSource && lastSource.name, 25), 1273, 179, 21, COLOR.white);
            text(cv, video.status, 1274, 217, 20, video.error ? COLOR.amber : COLOR.green);
            text(cv, mmss(video.position), 1274, 259, 31, COLOR.white);
            btn(cv, video.paused ? 'Resume' : 'Pause', 1271, 291, 263, 49, action, 'PAUSE');
            btn(cv, '- 15 s', 1271, 350, 124, 49, () => {
                if (canPlay() && lastSource) play(lastSource, Math.max(0, video.position - 15));
            }, 'SEEK_BACK');
            btn(cv, '+ 15 s', 1410, 350, 124, 49, () => {
                if (canPlay() && lastSource) play(lastSource, video.position + 15);
            }, 'SEEK_FORWARD');
            btn(cv, 'Stop', 1271, 410, 263, 49, () => { stop(); tab(0); }, 'STOP', '#5a343c');
            if (video.error) text(cv, trim(video.error, 112), 58, 501, 17, COLOR.amber);
        }
        function drawConnection(cv) {
            cv.roundRect(49, 142, 1497, 350, 19, COLOR.panel);
            text(cv, 'PHONE IMPORT + PLAYER CHECK', 78, 180, 28, COLOR.white);
            const ready = !!(link && phone.listening && network.ready &&
                Date.now() - lastNetworkReply < 6000);
            if (ready) qrDraw(cv, link, 89, 209, 244);
            else {
                cv.roundRect(89, 209, 244, 244, 14, '#0b1726');
                text(cv, 'QR LOCKED', 211, 327, 26, COLOR.amber, {align:'center'});
            }
            text(cv, link ? trim(link.replace(/\?t=.*/, ''), 57) : 'Connect to a reachable MGU network.', 377, 238, 24, COLOR.cyan);
            text(cv, ready ? 'Scan to upload videos or send YouTube links.' :
                'Waiting for the local server and BMW Wi-Fi firewall.', 377, 276, 20, ready ? COLOR.green : COLOR.amber);
            const netError = phone.error || (!phone.listening ? 'HTTP server starting' :
                network.error ? network.error : network.ready ? 'READY - Wi-Fi port 18879 open' :
                network.listening ? 'Opening BMW Wi-Fi firewall...' : 'Waiting for network helper');
            const rows = [
                ['Render v4 video', gpuReady() ? 'READY' : 'NOT AVAILABLE'],
                ['ffmpeg decoder', video.ffmpeg || 'NOT INSTALLED'],
                ['yt-dlp for YouTube', video.resolver || 'NOT INSTALLED'],
                ['MGU Store Internet', uplink.status()],
                ['Experimental audio', ctx.settings.get('audio') === 'alsa' ? (video.aplay || 'aplay missing') : 'OFF'],
                ['Local companion', trim(netError, 49)],
            ];
            rows.forEach((r, i) => {
                const y = 302 + i * 31;
                text(cv, r[0], 380, y, 17, COLOR.muted);
                text(cv, trim(r[1], 49), 740, y, 17, r[1].indexOf('READY') === 0 ? COLOR.green : COLOR.white);
            });
            btn(cv, 'Rescan library', 1160, 320, 330, 50, () => {
                rescan(); notice = files.length + ' media files found';
                record('INFO', 'library.rescanned', 'files=' + files.length);
            }, 'RESCAN');
            btn(cv, 'Diagnostics / Logs', 1160, 389, 330, 52, () => tab(4), 'DIAGNOSTICS');
            if (phone.error) text(cv, trim(phone.error, 70), 90, 479, 18, COLOR.red);
        }
        function drawDiagnostics(cv) {
            cv.roundRect(49, 140, 1497, 352, 19, COLOR.panel);
            text(cv, 'VIDEO HUB  /  DIAGNOSTICS', 78, 179, 27, COLOR.white);
            const ready = !!(link && phone.listening && network.ready &&
                Date.now() - lastNetworkReply < 6000);
            const download = link ? link.replace('/?t=', '/diagnostics.json?t=') : null;
            if (ready && download) qrDraw(cv, download, 95, 204, 222);
            else {
                cv.roundRect(95, 204, 222, 222, 12, '#0b1726');
                text(cv, 'QR LOCKED', 206, 327, 23, COLOR.amber, {align:'center'});
            }
            text(cv, ready ? 'Scan to download diagnostic JSON' : 'Waiting for BMW Wi-Fi firewall',
                93, 456, 17, ready ? COLOR.cyan : COLOR.amber);
            text(cv, diagnostics.events.length + ' saved events  /  current and previous sessions',
                370, 220, 20, COLOR.muted);
            diagnostics.recent(6).forEach((entry, i) => {
                const y = 256 + i * 31;
                const line = entry.at.slice(11, 19) + '  ' + entry.level + '  ' + entry.event +
                    (entry.detail ? ': ' + entry.detail : '');
                text(cv, trim(line, 106), 371, y, 17,
                    entry.level === 'ERROR' ? COLOR.red : entry.level === 'WARN' ? COLOR.amber : COLOR.white);
            });
            btn(cv, 'Back to Connection', 1135, 439, 364, 48, () => tab(3), 'DIAG_BACK');
        }
        ctx.loop('MAIN', 12, () => {
            if (Date.now() - lastNetworkPoll > 2500) {
                lastNetworkPoll = Date.now(); refreshNetwork();
            }
            // Stale or missing speed must fail closed, even without another signal event.
            if (!canPlay() && (video.playing || video.resolving)) {
                stop(); notice = speedHint();
                record('WARN', 'safety.signal_stale', notice);
            }
            if (Date.now() - lastDiagnosticPoll > 3000) {
                lastDiagnosticPoll = Date.now();
                const uplinkState = uplink.status();
                if (uplinkState !== lastUplinkState) {
                    lastUplinkState = uplinkState;
                    record(uplink.ownLease() ? 'INFO' : 'WARN', 'uplink.state', uplinkState);
                }
                if (uplink.error && uplink.error !== lastUplinkError) {
                    lastUplinkError = uplink.error;
                    record('ERROR', 'uplink.proxy_failed', uplink.error);
                }
                if (phone.error && phone.error !== lastPhoneError) {
                    lastPhoneError = phone.error;
                    record('ERROR', 'phone.server_error', phone.error);
                }
                const rendererReady = gpuReady();
                if (rendererReady !== lastRendererReady) {
                    lastRendererReady = rendererReady;
                    record(rendererReady ? 'INFO' : 'WARN', 'renderer.state', rendererReady ? 'READY' : 'NOT AVAILABLE');
                }
                const vehicleState = canPlay() ? 'PARKED' : speedHint();
                if (vehicleState !== lastVehicleState) {
                    lastVehicleState = vehicleState;
                    record(canPlay() ? 'INFO' : 'WARN', 'vehicle.speed_state', vehicleState);
                }
            }
            if (Date.now() - lastScan > 15000 && page === 0) rescan();
            const cv = ctx.canvas(W, H);
            cv.clear(COLOR.bg);
            drawHeader(cv);
            if (page === 0) drawList(cv, 'local');
            else if (page === 1) drawList(cv, 'youtube');
            else if (page === 2) drawPlayer(cv);
            else if (page === 4) drawDiagnostics(cv);
            else drawConnection(cv);
            if (notice && page !== 2) {
                cv.roundRect(50, 451, 950, 52, 11, '#4a3339');
                text(cv, trim(notice, 77), 65, 482, 19, '#ffd4cb');
            }
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
