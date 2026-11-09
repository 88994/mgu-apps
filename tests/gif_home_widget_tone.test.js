'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compensateWidget } = require('../apps/gif_home/widget_tone');

function image() {
    const w = 12, h = 10, d = new Uint8Array(w * h * 4);
    for (let i = 0; i < d.length; i += 4) {
        d[i] = 42; d[i + 1] = 88; d[i + 2] = 154; d[i + 3] = 255;
    }
    return { w, h, d };
}

const unchanged = image();
const bytes = Buffer.from(unchanged.d);
assert.strictEqual(compensateWidget(unchanged, 'original'), unchanged);
assert.deepStrictEqual(Buffer.from(unchanged.d), bytes);

const balanced = compensateWidget(image(), 'balanced');
const strong = compensateWidget(image(), 'strong');
function colorAt(cv, row) { return cv.d[(row * cv.w + 5) * 4 + 2]; }
assert.ok(colorAt(balanced, 0) > colorAt(balanced, 5), 'outer edge is boosted more');
assert.ok(colorAt(strong, 0) >= colorAt(balanced, 0), 'strong boosts edges more');
assert.ok(colorAt(balanced, 5) > 154, 'middle is brighter, too');
assert.ok(balanced.d.every((value, i) => i % 4 !== 3 || value === 255), 'alpha remains opaque');

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/gif_home/app.json'), 'utf8'));
assert.strictEqual(app.startWidget.cells.background[0], false);
assert.strictEqual(app.settings.find((s) => s.key === 'widgetBackground').default, false);
assert.ok(app.settings.find((s) => s.key === 'widgetTone').options.some(([key]) => key === 'original'));
console.log('GIF Home edge-compensation and native-background controls passed');
