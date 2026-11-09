'use strict';
const P = require('./protocol');

// This renderer has no transport dependency. The preview button cannot send
// a lamp command. Animation is finite and is labelled separately from LIVE.
function draw(cv, t, o) {
    const w = cv.width || 1600;
    cv.clear(t.bg);
    cv.fillRect(0, 0, 1600, 3, t.accent);
    cv.text('LIGHT SHOW', 58, 65, 36, t.text, { font: 'bold' });
    cv.text('SCREEN PREVIEW', 1540, 62, 22, t.accent, { align: 'right', font: 'bold' });
    cv.text('No vehicle lights are controlled', 1540, 94, 19, t.dim, { align: 'right' });
    const conf = o.config, pattern = P.pattern(conf);
    const elapsed = Math.max(0, o.now - o.startedAt), active = o.active && elapsed < conf.seconds * 1000;
    const mask = active ? pattern.steps[Math.floor(elapsed / conf.tempo) % pattern.steps.length] : [0, 0];
    const edge = '#596674', body = '#182029', shadow = '#10161D';
    // A symmetric front fascia with two independent headlight outlines.
    cv.roundRect(348, 185, 904, 235, 64, body);
    cv.polyline([[390, 197], [528, 145], [1072, 145], [1210, 197]], 3, edge);
    cv.line(425, 155, 1175, 155, 2, '#303B47');
    cv.roundRect(651, 234, 137, 124, 22, shadow);
    cv.roundRect(812, 234, 137, 124, 22, shadow);
    for (let x = 675; x < 775; x += 20) cv.line(x, 252, x, 340, 4, edge);
    for (let x = 835; x < 935; x += 20) cv.line(x, 252, x, 340, 4, edge);
    // Vehicle left appears on the right when viewed from the front.
    [1, 0].forEach((side, i) => {
        const x = i === 0 ? 395 : 985, lit = mask[side] === 1;
        if (lit) cv.roundRect(x - 12, 209, 232, 101, 24, '#263A4A');
        cv.roundRect(x, 221, 208, 77, 18, lit ? '#EDF9FF' : '#26313E');
        cv.line(x + 22, 286, x + 85, 286, 5, lit ? '#FFFFFF' : edge);
        cv.line(x + 116, 286, x + 183, 286, 5, lit ? '#FFFFFF' : edge);
        cv.text(side === 0 ? 'LEFT' : 'RIGHT', x + 104, 343, 17, lit ? t.text : t.dim, { align: 'center' });
    });
    cv.line(420, 382, 1180, 382, 4, '#303B47');
    cv.text(pattern.name, 58, 451, 32, t.text, { font: 'bold' });
    cv.text((conf.route === 'timed' ? P.FUNCTIONS[conf.lights].name : P.PAIRS[conf.lights].name)
        + '  |  ' + conf.tempo + ' ms / step', 58, 486, 22, t.dim);
    cv.text(active ? Math.max(0, Math.ceil(conf.seconds - elapsed / 1000)) + ' s' : 'STOPPED', 1540, 466,
        active ? 44 : 28, active ? t.accent : t.dim, { align: 'right', font: 'bold' });
    return cv;
}
module.exports = { draw };
