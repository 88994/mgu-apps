'use strict';
const G = require('./kit/gauges');

const TINT = { m: '#28a6fa', red: '#ff4652', ice: '#d0edff', amber: '#ffaf53' };

/** iDrive screen preview only. Nothing drawn here is transmitted to the KOMBI. */
function drawG80Preview(cv, box, car, options, state) {
    const { x, y, w, h } = box;
    const blue = TINT[options.accent] || TINT.m;
    cv.roundRect(x, y, w, h, 18, '#050d19');
    cv.roundRect(x + 12, y + 14, w - 24, h - 28, 12, '#0b1423');
    cv.fillRect(x + 14, y + 25, 10, 30, '#2347c1');
    cv.fillRect(x + 29, y + 25, 10, 30, '#61b8ec');
    cv.fillRect(x + 44, y + 25, 10, 30, '#ee424b');
    cv.text('G80-INSPIRED DESIGN  ·  318d', x + 72, y + 49, 19, '#a7b4ca');
    cv.text(state.panelActive ? 'PANEL TEST · ' + state.secondsLeft + 's' : 'HMI PREVIEW ONLY',
        x + w - 245, y + 49, 19, state.panelActive ? '#67dea5' : '#8199b7');
    const cy = y + h * 0.52;
    const left = x + w * .225, right = x + w * .775, radius = h * .365;
    const track = '#28354b';
    const speed = G.isNum(car.speed) ? car.speed : 0;
    const rpm = G.isNum(car.rpm) ? car.rpm : 0;
    [left, right].forEach((cx) => {
        cv.arc(cx, cy, radius - 8, radius, -135, 135, track);
        for (let i = 0; i <= 12; i++) {
            const a = (-135 + i * 270 / 12) * Math.PI / 180;
            const ex = cx + Math.sin(a) * (radius - 20), ey = cy - Math.cos(a) * (radius - 20);
            const sx = cx + Math.sin(a) * (radius - (i % 3 === 0 ? 35 : 27));
            const sy = cy - Math.cos(a) * (radius - (i % 3 === 0 ? 35 : 27));
            cv.line(sx, sy, ex, ey, i % 3 === 0 ? 3 : 1, '#aebdd3');
        }
    });
    cv.arc(left, cy, radius - 9, radius + 1, -135, -135 + Math.min(260, speed) / 260 * 270, blue);
    cv.arc(right, cy, radius - 9, radius + 1, -135, -135 + Math.min(5000, rpm) / 5000 * 270, blue);
    cv.text('SPEED', left - 53, cy - 46, 21, '#8fa8c5');
    cv.text(G.isNum(car.speed) ? Math.round(car.speed).toString() : '--', left - 72, cy + 30, 70, '#f2f5fc', { font: 'num' });
    cv.text('km/h', left - 32, cy + 72, 23, '#9bb1cd');
    cv.text('ENGINE', right - 57, cy - 46, 21, '#8fa8c5');
    cv.text(G.isNum(car.rpm) ? (car.rpm / 1000).toFixed(1) : '--', right - 73, cy + 30, 70, '#f2f5fc', { font: 'num' });
    cv.text('x1000 rpm', right - 61, cy + 72, 22, '#9bb1cd');

    const midX = x + w * .5;
    const showMap = options.wazeMap !== 'off';
    cv.roundRect(midX - 142, cy - 109, 284, 231, 8, '#0c192a');
    if (showMap) {
        cv.line(midX - 90, cy - 74, midX + 85, cy - 74, 14, '#2e4258');
        cv.line(midX - 90, cy - 74, midX - 90, cy + 71, 14, '#2e4258');
        cv.line(midX - 120, cy + 43, midX + 117, cy + 43, 10, '#2f465e');
        cv.line(midX + 52, cy - 87, midX + 52, cy + 82, 17, '#4b617b');
        cv.line(midX - 87, cy + 42, midX + 52, cy + 42, 6, blue);
        cv.line(midX + 52, cy + 42, midX + 52, cy - 36, 6, blue);
        cv.circle(midX + 52, cy - 36, 8, '#eff8ff');
        cv.text('WAZE MAP AREA', midX - 100, cy + 104, 17, '#dde9fa');
    } else {
        cv.text(car.stage || '--', midX - 35, cy + 20, 72, '#eef4fc', { font: 'num' });
        cv.text('CENTRE DISPLAY', midX - 96, cy + 75, 18, '#a2b7d0');
        cv.text('WAZE HIDDEN', midX - 88, cy + 107, 17, blue);
    }
    cv.line(x + 72, y + h - 65, x + w - 72, y + h - 65, 2, '#244c7c');
    cv.text('OIL  ' + (G.isNum(car.oil) ? Math.round(car.oil) + ' °C' : '--'), x + 70, y + h - 25, 23, '#b4c3d5');
    cv.text('COOLANT  ' + (G.isNum(car.coolant) ? Math.round(car.coolant) + ' °C' : '--'), x + w - 270, y + h - 25, 23, '#b4c3d5');
}
module.exports = { drawG80Preview };
