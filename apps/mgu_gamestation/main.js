'use strict';

/**
 * BMW ID7 GameStation - all emulation is local to the MGU JavaScript process.
 * Phones are input devices only; neither browser nor car needs cloud services.
 * Emulation is strictly inhibited without a recent, valid speed of <= 0.5 km/h.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const {setImage} = require('./kit/record');
const {ControllerServer} = require('./controller_server');
const {Pong} = require('./arcade');
const {NesGame} = require('./nes_core');
const {GameBoyGame} = require('./gb_core');
const {SnesGame} = require('./snes_core');
const qrcode = require('./qr_vendor');

const W = 1600, H = 520, IMAGE = 71;
const PLATFORMS = [
    {id: 'nes', title: 'Nintendo', short: 'NES', subtitle: '8-bit classics', color: '#eb5961'},
    {id: 'snes', title: 'Super Nintendo', short: 'SNES', subtitle: '16-bit classics', color: '#9e8cff'},
    {id: 'gb', title: 'Game Boy / Color', short: 'GB / GBC', subtitle: 'Handheld classics', color: '#64c9aa'},
    {id: 'arcade', title: 'Arcade', short: 'ARCADE', subtitle: 'Two-player Pong', color: '#f6b951'},
];
const ALLOWED = {nes: ['.nes'], snes: ['.smc', '.sfc'], gb: ['.gb', '.gbc']};

function roman(name) { return String(name || '').replace(/[^\x20-\x7e]/g, '?'); }
function txt(cv, value, x, y, size, color, options) {
    cv.text(roman(value), x, y, size, color, options || {});
}
function qrData(url) {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); return qr;
}
function qrDraw(cv, qr, x, y, max) {
    const n = qr.getModuleCount(), quiet = 4;
    const pixel = Math.floor(max / (n + quiet * 2));
    if (pixel < 2) return false;
    const size = pixel * (n + quiet * 2);
    const ox = x + Math.floor((max - size) / 2), oy = y + Math.floor((max - size) / 2);
    cv.fillRect(ox, oy, size, size, '#ffffff');
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
        if (qr.isDark(yy, xx)) cv.fillRect(ox + (xx + quiet) * pixel,
            oy + (yy + quiet) * pixel, pixel, pixel, '#09121d');
    }
    return true;
}

mgu.run({
    async start(ctx) {
        let page = 'library', platform = 3, selection = 0, gameOffset = 0, game = null;
        let status = '', gameName = '', frameAt = 0, frameSlowness = 0, romsDirty = true;
        let speed = null, speedAt = 0, serverStatus = '', server = null;
        const qr = [null, null];
        let roms = [];
        const log = ctx.log;

        // Fail closed if the vehicle does not provide a valid, fresh speed.
        const speedOk = () => speed !== null && Date.now() - speedAt < 5000 && speed <= 0.5;
        const speedReason = () => speed === null || Date.now() - speedAt >= 5000
            ? 'Waiting for a valid vehicle-speed signal. Game play is disabled.'
            : speed > 0.5 ? 'Vehicle in motion - game paused.' : '';
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: v => {
                const raw = v && v.speedVehicleCentreOfGravity;
                if (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw !== 65535) {
                    speed = raw * 0.015625;
                    speedAt = Date.now();
                }
            },
        }, log, {pollMs: 2000}).then(s => {
            if (s && s.error) log.warn('[GameStation] Speed subscription: ' + s.error);
        }).catch(e => log.warn('[GameStation] Speed subscription: ' + e.message));

        function listGames() {
            const spec = PLATFORMS[platform];
            if (spec.id === 'arcade') return ['Pong - two players'];
            try {
                const dir = path.join(ctx.dataDir, 'roms', spec.id);
                return fs.readdirSync(dir).filter(name =>
                    ALLOWED[spec.id].some(ext => name.toLowerCase().endsWith(ext)))
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
            } catch (_) { return []; }
        }
        function reloadGames() { roms = listGames(); romsDirty = false; selection = Math.min(selection, Math.max(0, roms.length - 1)); }

        const controller = new ControllerServer(ctx.dataDir, {
            upload: (kind, name) => {
                romsDirty = true;
                log.info('[GameStation] ROM uploaded: ' + kind + '/' + name);
            },
        }, log);
        server = controller;
        try {
            server.start();
            qr[0] = qrData(server.url(1)); qr[1] = qrData(server.url(2));
        } catch (e) {
            serverStatus = e.message;
            log.warn('[GameStation] Controller link unavailable: ' + e.message);
        }

        function stopGame() {
            if (game && game.stop) {
                try { game.stop(); } catch (e) { log.warn('[GameStation] Stop: ' + e.message); }
            }
            game = null; gameName = ''; frameAt = 0; frameSlowness = 0;
        }
        function back() {
            if (page === 'game') stopGame();
            page = 'library';
            romsDirty = true;
        }
        function play(index) {
            if (romsDirty) reloadGames();
            if (typeof index === 'number') selection = index;
            if (!roms[selection]) { status = 'No games yet. Use a phone to upload your own ROM.'; return; }
            if (!speedOk()) { status = speedReason(); return; }
            stopGame();
            try {
                const spec = PLATFORMS[platform];
                const name = roms[selection];
                const paint = (pixels, width, height) => setImage(IMAGE, width, height, pixels);
                if (spec.id === 'arcade') game = new Pong();
                else {
                    const filename = path.join(ctx.dataDir, 'roms', spec.id, name);
                    const bytes = fs.readFileSync(filename);
                    if (bytes.length > 8 * 1024 * 1024) throw new Error('ROM is too large');
                    if (spec.id === 'nes') game = new NesGame(bytes, paint);
                    else if (spec.id === 'gb') game = new GameBoyGame(bytes, paint);
                    else if (spec.id === 'snes') game = new SnesGame(bytes, paint);
                }
                if (!game) throw new Error('Emulator unavailable');
                gameName = name;
                page = 'game'; status = ''; frameAt = Date.now();
                log.info('[GameStation] Started: ' + spec.id + '/' + name);
            } catch (e) {
                stopGame(); status = 'Could not start this game: ' + e.message;
                log.warn('[GameStation] ' + status);
            }
        }

        const setPlatform = next => {
            if (page === 'game') back();
            page = 'library'; platform = (next + PLATFORMS.length) % PLATFORMS.length;
            selection = 0; gameOffset = 0; romsDirty = true; status = '';
        };
        ctx.ui.onClick('BTN_PLATFORM', () => setPlatform(platform + 1));
        ctx.ui.onClick('BTN_ACTION', () => {
            if (page === 'game' || page === 'pair') back(); else play();
        });
        ctx.ui.onClick('BTN_PAIR', () => { if (page === 'game') stopGame(); page = page === 'pair' ? 'library' : 'pair'; });

        let rendered = 0;
        const colors = () => {
            const current = ctx.settings.get('theme');
            return {accent: current === 'amber' ? '#f5a953' : current === 'm_tricolour' ? '#e66a75' : '#56c2ee'};
        };

        function button(cv, label, x, y, w, h, onClick, key, fill) {
            cv.roundRect(x, y, w, h, 13, fill || '#243347');
            txt(cv, label, x + w / 2, y + h / 2 + 9, 21, '#f2f7ff', {align: 'center'});
            cv.target(x, y, w, h, onClick, key, 13);
        }
        function drawLibrary(cv, accent) {
            txt(cv, 'CHOOSE A CONSOLE', 52, 79, 20, '#aabed2');
            PLATFORMS.forEach((p, index) => {
                const x = 40 + index * 392, chosen = index === platform;
                cv.roundRect(x, 100, 370, 158, 18, chosen ? '#203e52' : '#192536');
                cv.fillRect(x + 20, 119, 7, 115, p.color);
                txt(cv, p.short, x + 42, 151, 34, '#ffffff');
                txt(cv, p.title, x + 42, 191, 20, '#d1dce9');
                txt(cv, p.subtitle, x + 42, 225, 16, '#8fa4ba');
                if (chosen) cv.strokeRoundRect(x, 100, 370, 158, 18, 3, accent);
                cv.target(x, 100, 370, 158, () => setPlatform(index), 'PLATFORM_' + index, 18);
            });
            txt(cv, 'GAME LIBRARY', 53, 312, 22, '#e6f3ff');
            if (roms.length > 6) {
                button(cv, 'PREV', 805, 276, 155, 50,
                    () => {gameOffset = Math.max(0, gameOffset - 6);}, 'GAME_PREV');
                button(cv, 'NEXT', 974, 276, 155, 50,
                    () => {gameOffset = Math.min(Math.floor((roms.length - 1) / 6) * 6, gameOffset + 6);}, 'GAME_NEXT');
            }
            button(cv, 'Connect phones / Import', 1190, 276, 363, 50,
                () => {page = 'pair';}, 'GO_PAIR', '#245c6b');
            if (!roms.length) {
                txt(cv, 'No ROMs imported for this console.', 55, 381, 23, '#aebfd0');
                txt(cv, 'Connect a phone to the BMW hotspot, then scan its QR code to upload a game.',
                    55, 425, 18, '#7e9db4');
            } else {
                roms.slice(gameOffset, gameOffset + 6).forEach((name, i) => {
                    const col = i % 3, row = Math.floor(i / 3), x = 40 + col * 516, y = 335 + row * 75;
                    cv.roundRect(x, y, 495, 63, 10, selection === i ? '#29516b' : '#1c2d3e');
                    txt(cv, name.length > 31 ? name.slice(0, 28) + '...' : name, x + 18, y + 38, 19, '#ffffff');
                    cv.target(x, y, 495, 63, () => play(i + gameOffset), 'GAME_' + (i + gameOffset), 10);
                });
                if (roms.length > 6) txt(cv, 'Games ' + (gameOffset + 1) + '-' +
                    Math.min(roms.length, gameOffset + 6) + ' / ' + roms.length, 52, 495, 16, '#9eb1c1');
            }
        }
        function drawPair(cv) {
            txt(cv, 'TWO PHONES. ONE GAME.', 65, 89, 38, '#f3f8ff');
            txt(cv, 'Join the BMW Wi-Fi hotspot on both phones, then scan a different code on each phone.',
                66, 129, 20, '#b3c6db');
            [0, 1].forEach(i => {
                const x = i === 0 ? 185 : 870;
                cv.roundRect(x, 162, 548, 300, 19, '#1b293a');
                txt(cv, 'PLAYER ' + (i + 1), x + 25, 202, 25, i === 0 ? '#62c7ff' : '#fd789f');
                if (qr[i]) qrDraw(cv, qr[i], x + 24, 213, 226);
                else txt(cv, serverStatus || 'No QR', x + 24, 302, 19, '#ffa68d');
                const st = server.status()[i] ? 'CONNECTED' : 'WAITING FOR PHONE';
                txt(cv, st, x + 265, 288, 20, server.status()[i] ? '#68e5ac' : '#fdc085');
                txt(cv, 'Controller + ROM import', x + 265, 333, 17, '#adc5d6');
                txt(cv, server.address + ':' + server.port, x + 265, 377, 17, '#739eb9');
            });
            if (server.error) txt(cv, 'Controller server error: ' + server.error.slice(0, 70),
                64, 493, 18, '#ff9d9d');
            button(cv, 'Back to games', 1235, 467, 313, 45, back, 'PAIR_BACK');
        }
        function drawGame(cv) {
            const connected = server.status();
            txt(cv, gameName, 49, 77, 29, '#ffffff');
            txt(cv, 'P1 ' + (connected[0] ? 'ON' : 'OFF') + '  /  P2 ' + (connected[1] ? 'ON' : 'OFF'),
                1300, 76, 19, '#a8d6e2');
            if (game instanceof Pong) game.draw(cv, 210, 92, 1180, 385);
            else if (game) {
                cv.fillRect(175, 88, 1250, 396, '#10151f');
                const ratio = Math.min(1250 / game.width, 396 / game.height);
                const w = game.width * ratio, h = game.height * ratio;
                cv.image(IMAGE, 175 + (1250 - w) / 2, 88 + (396 - h) / 2, w, h);
            }
            if (!speedOk()) {
                cv.roundRect(195, 206, 1210, 157, 19, '#402c33');
                txt(cv, 'GAME PAUSED', 800, 266, 35, '#ffb0a1', {align: 'center'});
                txt(cv, speedReason(), 800, 323, 22, '#f4e0dc', {align: 'center'});
            }
            button(cv, 'Exit', 1420, 446, 127, 55, back, 'GAME_EXIT');
        }

        ctx.loop('MAIN', 30, () => {
            if (romsDirty && page === 'library') reloadGames();
            const cv = ctx.canvas(W, H), accent = colors().accent;
            cv.clear('#0c1726');
            cv.fillRect(0, 0, W, 11, accent);
            txt(cv, 'MGU  /  GAMESTATION', 49, 48, 23, '#a5c6df');
            if (page === 'library') drawLibrary(cv, accent);
            else if (page === 'pair') drawPair(cv);
            else if (page === 'game' && game) {
                if (ctx.ui.hasFocus('MAIN') && speedOk()) {
                    const now = Date.now();
                    if (!frameAt || now - frameAt >= 15) {
                        const start = Date.now(), delta = Math.max(.5, Math.min(2, (now - frameAt) / 16.66));
                        frameAt = now;
                        try {
                            game.tick(server.pads(), delta);
                            const time = Date.now() - start;
                            frameSlowness = time > 200 ? frameSlowness + 1 : 0;
                            if (frameSlowness > 2) throw new Error('Emulator exceeded 200 ms per frame');
                        } catch (e) {
                            log.warn('[GameStation] Game stopped: ' + e.message);
                            status = 'Emulator stopped: ' + e.message; back();
                        }
                    }
                } else frameAt = Date.now();
                if (page === 'game' && game) drawGame(cv);
            }
            if (page === 'library' && status) {
                cv.roundRect(38, 463, 1525, 42, 9, '#482d34');
                txt(cv, status.slice(0, 112), 58, 491, 18, '#ffccbb');
            }
            if (page !== 'game') {
                txt(cv, speedOk() ? 'PARKED - READY' : 'PLAY DISABLED',
                    1518, 49, 17, speedOk() ? '#87efba' : '#ffb19d', {align: 'right'});
            }
            rendered++;
            if (rendered % 300 === 0 && server.error) log.warn('[GameStation] Phone server: ' + server.error);
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
