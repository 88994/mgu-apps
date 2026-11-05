'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {CANDIDATES, playable} = require('../apps/mgu_gamesnacks/reviewed_games');
const {normalizeTouch} = require('../apps/mgu_gamesnacks/touch_input');

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/mgu_gamesnacks/app.json'), 'utf8'));
const store = JSON.parse(fs.readFileSync(path.join(__dirname, '../mgu-repo.json'), 'utf8'));

assert.strictEqual(spec.id, 'mgu_gamesnacks');
assert.notStrictEqual(spec.id, 'mgu_gamestation');
assert.ok(spec.signals['de.bmw.infotainment.vehicle.Vehicle2']);
assert.ok(store.components.some(component => component.id === spec.id && component.version === spec.version));
assert.strictEqual(CANDIDATES.length, 5);
assert.strictEqual(new Set(CANDIDATES.map(game => game.id)).size, 5);
CANDIDATES.forEach(game => {
    assert.ok(game.source.startsWith('https://'));
    assert.strictEqual(playable(game), false);
    assert.ok(game.license && game.bundle && game.browser);
});
assert.strictEqual(playable({licenseCleared: true, bundleVerified: true, rendererVerified: true}), false);
assert.strictEqual(playable({licenseCleared: true, bundleVerified: true, rendererVerified: true,
    launch() {}}), true);
assert.deepStrictEqual(normalizeTouch(1, 100, 200, {x: 0, y: 100, w: 200, h: 200}),
    {phase: 'down', x: 0.5, y: 0.5});
assert.deepStrictEqual(normalizeTouch(2, 200, 300, {x: 0, y: 100, w: 200, h: 200}),
    {phase: 'move', x: 1, y: 1});
assert.strictEqual(normalizeTouch(3, -1, 200, {x: 0, y: 100, w: 200, h: 200}), null);
assert.strictEqual(normalizeTouch(4, 100, 200, {x: 0, y: 100, w: 200, h: 200}), null);
console.log('ok: independent GameSnacks preview; no unauthorized original games enabled');
console.log('ok: MGU touch phases and normalized pointer coordinates');
