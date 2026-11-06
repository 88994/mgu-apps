'use strict';
const G = require('./kit/gauges');

/** BMW 6WB-inspired centre-screen mockup. Never sent to the cluster. */
function draw6WBPreview(cv, box, data, options, state) {
    const { x, y, w, h } = box;
    const mode = options.mode || 'comfort';
    const color = options.color || (mode === 'sport' ? '#ff3844' : mode === 'eco' ? '#39aaff' : '#e3e8ee');
    const speed = G.isNum(data.speed) ? Math.max(0, data.speed) : 0;
    const rpm = G.isNum(data.rpm) ? Math.max(0, data.rpm) : 0;
    const white = '#f2f4f7', dim = '#94a6b8';
    cv.roundRect(x, y, w, h, 18, mode === 'sport' ? '#0f080e' : '#04080e');
    cv.roundRect(x + 10, y + 11, w - 20, h - 22, 12, '#0b1019');
    cv.text('BMW 6WB  ·  ' + mode.toUpperCase() + '  ·  318d', x + 36, y + 43, 21, white);
    cv.roundRect(x + w - 271, y + 23, 16, 16, 5, color);
    cv.text(state.panelActive ? 'PANEL TEST · ' + state.secondsLeft + 's' : 'HMI PREVIEW ONLY',
        x + w - 248, y + 39, 18, state.panelActive ? '#67dea5' : dim);

    const cy = y + h * .535;
    const left = x + w * .228, right = x + w * .772, r = h * .367;
    const track = mode === 'sport' ? '#432129' : mode === 'eco' ? '#1d354d' : '#323b47';
    [[left, speed, 260, 'km/h'], [right, rpm, 5000, 'rpm']].forEach((dial, idx) => {
        const cx = dial[0], value = dial[1], max = dial[2];
        cv.arc(cx, cy, r - 10, r - 4, -145, 145, track);
        cv.arc(cx, cy, r - 10, r - 2, -145, -145 + Math.min(value, max) / max * 290, color);
        cv.arc(cx, cy, r - 41, r - 39, -145, 145, '#1f2835');
        for (let i = 0; i <= 26; i++) {
            const angle = (-145 + (290 * i / 26)) * Math.PI / 180;
            const major = i % 2 === 0;
            const outer = r - 19, inner = outer - (major ? 13 : 6);
            const sx = cx + Math.sin(angle) * inner, sy = cy - Math.cos(angle) * inner;
            const ex = cx + Math.sin(angle) * outer, ey = cy - Math.cos(angle) * outer;
            cv.line(sx, sy, ex, ey, major ? 2.1 : 1, major ? white : '#7b8b9d');
        }
        const pointer = (-145 + Math.min(value, max) / max * 290) * Math.PI / 180;
        cv.line(cx, cy, cx + Math.sin(pointer) * (r - 52), cy - Math.cos(pointer) * (r - 52), 3, color);
        cv.circle(cx, cy, 8, '#d6dee9');
        cv.circle(cx, cy, 4, color);
        const readout = idx === 0 ? Math.round(value).toString() : (value / 1000).toFixed(1);
        cv.text(readout, cx - (idx === 0 ? 56 : 50), cy + 91, 53, white, { font: 'num' });
        cv.text(idx === 0 ? 'km/h' : 'x1000 rpm', cx - (idx === 0 ? 28 : 52), cy + 118, 18, dim);
    });

    // Graphic-only map placeholder. All real 6WB shader variants have an
    // alpha-transparent opening at this position instead of this drawing.
    const mx = x + w / 2;
    cv.roundRect(mx - 143, cy - 99, 286, 204, 9, '#0e1c2a');
    cv.line(mx - 104, cy + 47, mx + 113, cy + 47, 13, '#354a62');
    cv.line(mx - 84, cy - 65, mx - 84, cy + 68, 14, '#354a62');
    cv.line(mx + 78, cy - 76, mx + 78, cy + 65, 16, '#405776');
    cv.line(mx - 80, cy + 45, mx + 77, cy + 45, 6, color);
    cv.line(mx + 77, cy + 45, mx + 77, cy - 40, 6, color);
    cv.circle(mx + 77, cy - 40, 7, '#e8f8ff');
    cv.text(options.wazeMap === 'off' ? 'BMW MAP WINDOW' : 'MAP WINDOW', mx - 94, cy + 93, 17, white);

    cv.line(x + 66, y + h - 54, x + w - 66, y + h - 54, 2, color);
    cv.text('SPEED', x + 80, y + h - 21, 20, dim);
    cv.text('ENGINE RPM', x + w - 220, y + h - 21, 20, dim);
}

module.exports = { draw6WBPreview };
