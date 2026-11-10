'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../apps/g21_ambient/app.json');
const main = fs.readFileSync(path.join(__dirname, '../apps/g21_ambient/main.js'), 'utf8');

test('ambient color controls retain touch drag and a visible Apply button', () => {
    assert.equal(app.version, '0.4.0');
    assert.match(main, /ctx\.onTouch\(/);
    assert.match(main, /phase === 2/);
    assert.match(main, /text\(cv, 'APPLY'/);
    assert.match(main, /actionNotice = ctl\.info/);
    assert.match(main, /PROBE_DID/);
    assert(!app.settings.some(x => x.key === 'engineeringWrites'));
    assert.equal(app.settings.find(x => x.key === 'linId').default, 0);
    assert(app.settings.find(x => x.key === 'applyTarget').options.some(x => x[0] === 'bdc'));
    assert.match(main, /Detected BDC LIN zones/);
    assert.match(main, /Six saved looks/);
    assert.match(main, /Colour looks by driving mode/);
    assert.match(main, /Scan BDC/);
    assert.deepEqual(app.settings.find(x => x.key === 'brightness').steps.slice(0, 2), [0, 10]);
});
