'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../apps/g21_wheelheat/app.json');
const main = fs.readFileSync(path.join(__dirname, '../apps/g21_wheelheat/main.js'), 'utf8');

test('WheelHeat autostart uses a single explicit opt-in and honest diagnostic states', () => {
    assert.equal(app.version, '0.4.5');
    assert.equal(app.mguAppStartType, 'autostart');
    assert(!app.settings.some(s => s.key === 'liveControl'));
    assert.equal(app.settings.find(s => s.key === 'autoEnabled').default, false);
    assert.equal(app.settings.find(s => s.key === 'autoEnabled').reset, 'single-consent-0.4.5');
    assert.match(main, /ctl\.autoWrite\(data/);
    assert.match(main, /HEATER STATUS SNAPSHOT/);
    assert(!main.includes('One automatic cycle'));
    assert(!main.includes('Last ECU action:'));
    assert(!main.includes('Live writes enabled'));
    assert.match(main, /state not yet decoded/);
});
