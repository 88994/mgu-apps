'use strict';

// mgu-deploy accepts only hyphen-separated tool ids. The updater's catalog
// parser also accepts underscores, so catalog validation alone misses this.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repo = JSON.parse(fs.readFileSync(path.join(root, 'mgu-repo.json'), 'utf8'));
const tool = JSON.parse(fs.readFileSync(path.join(root, 'native/phone-bridge/component.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/mgu_phone_terminal/app.json'), 'utf8'));
const toolEntry = repo.components.find((entry) => entry.kind === 'tool' && entry.path === 'native/phone-bridge');
const appEntry = repo.components.find((entry) => entry.id === app.id);

assert.ok(/^[a-z0-9][a-z0-9-]*$/.test(tool.id), 'mgu-deploy rejects underscores in tool IDs');
assert.strictEqual(toolEntry.id, tool.id);
assert.strictEqual(appEntry.version, app.version);
assert.strictEqual(appEntry.requires[tool.id], tool.version);

for (const file of tool.files) {
    assert.ok(fs.statSync(path.join(root, 'native/phone-bridge', file.from || file.path)).isFile(), 'missing tool file: ' + file.path);
}
for (const unit of tool.units) {
    const p = path.join(root, 'native/phone-bridge', unit.from || unit.name);
    assert.ok(fs.statSync(p).isFile(), 'missing tool unit: ' + unit.name);
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(content.indexOf('/var/opt/' + tool.id + '/current/') >= 0, 'unit references wrong tool path');
}
console.log('Phone Terminal manifest: valid deploy tool id, dependency and service paths');
