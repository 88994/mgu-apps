'use strict';

/**
 * BMW iDrive 7 standalone GameSnacks license/compatibility preview.
 * Original games are intentionally NOT bundled or playable in this version.
 * This never modifies vehicle ECU data and never guesses that a game is legal.
 */
const mgu = require('./kit/mgu');
const {CANDIDATES, playable} = require('./reviewed_games');
const {normalizeTouch} = require('./touch_input');

const W = 1600, H = 520;
const TOUCH_RECT = {x: 90, y: 157, w: 1420, h: 260};
function label(cv, value, x, y, size, color, extra) {
    cv.text(String(value).replace(/[^\x20-\x7e]/g, '?'), x, y, size, color, extra || {});
}

mgu.run({
    async start(ctx) {
        let page = 'catalog', selected = 0, speed = null, speedAt = 0;
        let touchPoint = null, touchCount = 0;
        const safe = () => speed !== null && Date.now() - speedAt < 5000 && speed <= 0.5;
        ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusCarSpeed2: message => {
                const raw = message && message.speedVehicleCentreOfGravity;
                if (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw !== 65535) {
                    speed = raw * 0.015625;
                    speedAt = Date.now();
                }
            },
        }, ctx.log, {pollMs: 2000}).catch(err => ctx.log.warn('GameSnacks speed: ' + err.message));

        const next = () => { selected = (selected + 1) % CANDIDATES.length; page = 'catalog'; };
        const details = index => { if (typeof index === 'number') selected = index; page = 'details'; };
        const back = () => { page = 'catalog'; };
        const touchTest = () => { page = 'touch'; touchPoint = null; touchCount = 0; };
        ctx.ui.onClick('BTN_NEXT', next);
        ctx.ui.onClick('BTN_DETAILS', () => details());
        ctx.ui.onClick('BTN_TOUCH', touchTest);
        ctx.ui.onClick('BTN_BACK', back);
        ctx.onTouch((phase, x, y) => {
            if (page !== 'touch') return;
            const point = normalizeTouch(phase, x, y, TOUCH_RECT);
            if (!point) return;
            touchPoint = point;
            if (point.phase === 'down') touchCount++;
        });

        function button(cv, title, x, y, w, click, key) {
            cv.roundRect(x, y, w, 49, 11, '#254563');
            label(cv, title, x + w / 2, y + 32, 20, '#f2f8ff', {align: 'center'});
            cv.target(x, y, w, 49, click, key, 11);
        }
        function catalog(cv, accent) {
            label(cv, 'ORIGINAL GAMES - REVIEW QUEUE', 47, 91, 23, '#b4cbe0');
            CANDIDATES.forEach((game, index) => {
                const x = 40 + index % 3 * 520, y = 111 + Math.floor(index / 3) * 153;
                const current = index === selected;
                cv.roundRect(x, y, 500, 133, 17, current ? '#20435b' : '#182a3c');
                cv.fillRect(x + 16, y + 20, 6, 93, current ? accent : '#68839a');
                label(cv, game.title, x + 39, y + 45, 28, '#f1f8ff');
                label(cv, game.genre + ' / ' + game.developer, x + 39, y + 76, 18, '#a7bed2');
                label(cv, 'NOT LICENSED - OFFLINE PENDING', x + 39, y + 109, 16, '#ffd08b');
                if (current) cv.strokeRoundRect(x, y, 500, 133, 17, 3, accent);
                cv.target(x, y, 500, 133, () => details(index), 'GAME_' + index, 17);
            });
            label(cv, 'No original games are installed. This is a research/build prototype.',
                47, 469, 20, '#ffc994');
            button(cv, 'Touch test', 786, 447, 244, touchTest, 'TOUCH_TEST');
            button(cv, 'Next title', 1038, 447, 242, next, 'NEXT_GAME');
            button(cv, 'Details', 1290, 447, 265, () => details(), 'DETAILS');
        }
        function detail(cv, accent) {
            const game = CANDIDATES[selected];
            label(cv, game.title, 67, 103, 44, '#f7fbff');
            cv.fillRect(67, 125, 1460, 3, accent);
            const rows = [
                ['DEVELOPER / OWNER', game.developer],
                ['DISTRIBUTION RIGHTS', game.license],
                ['OFFLINE GAME FILES', game.bundle],
                ['HEADUNIT ENGINE', game.browser],
            ];
            rows.forEach((row, i) => {
                const y = 169 + i * 68;
                label(cv, row[0], 68, y, 18, '#90b0c9');
                label(cv, row[1].length > 74 ? row[1].slice(0, 72) + '..' : row[1], 440, y, 20, '#f2f8ff');
            });
            label(cv, playable(game) && safe() ? 'READY' : 'PLAY UNAVAILABLE - LICENSE AND RUNTIME VERIFICATION REQUIRED',
                68, 458, 18, '#ffcd93');
            button(cv, 'Back to catalog', 1253, 447, 301, back, 'BACK');
        }
        function touchScreen(cv, accent) {
            label(cv, 'TOUCH INPUT DIAGNOSTICS', 67, 100, 38, '#f7fbff');
            label(cv, 'Tap or drag inside the panel. Input is local MGU touch, not a browser simulation.',
                67, 135, 20, '#aac5dc');
            cv.roundRect(TOUCH_RECT.x, TOUCH_RECT.y, TOUCH_RECT.w, TOUCH_RECT.h, 18, '#18334b');
            cv.strokeRoundRect(TOUCH_RECT.x, TOUCH_RECT.y, TOUCH_RECT.w, TOUCH_RECT.h,
                18, 2, accent);
            label(cv, 'TOUCH AREA', 123, 200, 26, '#8aabc5');
            label(cv, 'Touches: ' + touchCount, 123, 243, 22, '#b7d2e8');
            if (touchPoint) {
                const px = TOUCH_RECT.x + TOUCH_RECT.w * touchPoint.x;
                const py = TOUCH_RECT.y + TOUCH_RECT.h * touchPoint.y;
                cv.circle(px, py, 19, touchPoint.phase === 'up' ? '#ffc483' : '#6eebbb');
                label(cv, touchPoint.phase.toUpperCase() + ' / X ' + Math.round(touchPoint.x * 100) +
                    '% / Y ' + Math.round(touchPoint.y * 100) + '%',
                123, 285, 20, '#f2f8ff');
            } else label(cv, 'Waiting for touchscreen input...', 123, 285, 20, '#f2f8ff');
            label(cv, 'Touch routing requires mgu-renderd and mgu-inputgate on the real head unit.',
                67, 474, 18, '#ffd095');
            button(cv, 'Back', 1300, 447, 254, back, 'TOUCH_BACK');
        }
        ctx.loop('MAIN', 10, () => {
            const cv = ctx.canvas(W, H);
            const accent = ctx.settings.get('theme') === 'amber' ? '#f5ac5c' : '#5bc8f5';
            cv.clear('#0c1726');
            cv.fillRect(0, 0, W, 10, accent);
            label(cv, 'MGU / GAMESNACKS (UNOFFICIAL PROTOTYPE)', 47, 48, 23, '#a8cbe0');
            label(cv, safe() ? 'PARKED' : 'PLAY LOCKED', 1537, 47, 16,
                safe() ? '#90e6be' : '#ffbaaf', {align: 'right'});
            if (page === 'details') detail(cv, accent);
            else if (page === 'touch') touchScreen(cv, accent);
            else catalog(cv, accent);
            return ctx.ui.image('MAIN_GFX', cv);
        });
    },
});
