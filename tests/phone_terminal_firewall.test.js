'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { makeFirewall } = require('../native/phone-bridge/firewall');
const { makeBridge } = require('../native/phone-bridge/server');

function nftFake() {
    let rows = ['iifname "some_other_iface" tcp dport 1234 accept comment "unrelated" # handle 1'];
    let nextHandle = 2;
    const calls = [];
    async function run(args) {
        calls.push(args);
        if (args[0] === '-a') return 'table ip filter {\nchain input {\n' + rows.join('\n') + '\n}\n}\n';
        if (args[0] === 'insert') {
            rows.unshift(args.slice(5).join(' ') + ' # handle ' + nextHandle++);
            return '';
        }
        if (args[0] === 'delete') {
            rows = rows.filter((row) => !row.endsWith('# handle ' + args[6]));
            return '';
        }
        throw new Error('unexpected nft args: ' + args.join(' '));
    }
    return { run, calls, rows: () => rows, reset: () => { rows = []; } };
}

async function testRules() {
    const fake = nftFake();
    const fw = makeFirewall({ run: fake.run, port: 18890 });
    assert.strictEqual(await fw.ensure(), 'added');
    assert.ok(fake.rows()[0].includes('iifname "wlan_bridge" tcp dport 18890 accept'), 'only the Wi-Fi bridge may receive inbound HTTP');
    const changed = fake.calls.length;
    assert.strictEqual(await fw.ensure(), 'kept');
    assert.strictEqual(fake.calls.length, changed + 1, 'idempotent check must not add rules');
    fake.reset();
    assert.strictEqual(await fw.ensure(), 'added', 'reopen after a firmware firewall reload');
    await fw.close();
    assert.ok(fake.rows().every((row) => !row.includes('mgu-phone-bridge')), 'revoke removes tagged accept rule');
    await fw.close();
    assert.ok(fake.rows().every((row) => !row.includes('mgu-phone-bridge')));
    const broken = makeFirewall({ run: async () => { throw new Error('Operation not permitted'); } });
    await assert.rejects(broken.ensure(), /Operation not permitted/, 'never report firewall ready after nft failure');
    console.log('Firewall tests passed: scoped accept, idempotence, reload, cleanup, and error');
}

function ask(port, method, route, key) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method, path: route,
            headers: { 'X-Bridge-Key': key } }, (res) => {
            let raw = '';
            res.on('data', (part) => { raw += part; });
            res.on('end', () => resolve(JSON.parse(raw)));
        });
        req.on('error', reject);
        req.end();
    });
}

async function testBridgeFirewallLifecycle() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgu-fw-bridge-'));
    let permitted = false, denyNext = false;
    const fw = {
        ensure: async () => { if (denyNext) throw new Error('nft denied'); permitted = true; },
        close: async () => { permitted = false; }
    };
    const bridge = makeBridge({ dataDir: dir, localPort: 0, publicPort: 0,
        publicHost: '127.0.0.1', firewall: fw });
    const ports = await bridge.start();
    const key = fs.readFileSync(path.join(dir, 'phone-bridge.key'), 'utf8').trim();
    try {
        assert.strictEqual(permitted, false, 'port blocked at startup');
        await ask(ports.localPort, 'POST', '/local/start', key);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.strictEqual(permitted, true);
        const open = await ask(ports.localPort, 'GET', '/local/status', key);
        assert.strictEqual(open.firewall.ready, true);
        await ask(ports.localPort, 'POST', '/local/stop', key);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.strictEqual(permitted, false, 'revoke closes port');

        denyNext = true;
        await ask(ports.localPort, 'POST', '/local/start', key);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const failed = await ask(ports.localPort, 'GET', '/local/status', key);
        assert.strictEqual(failed.firewall.ready, false, 'broken firewall must not display ready QR');
        assert.ok(failed.firewall.error.includes('nft denied'));
        console.log('Bridge firewall lifecycle tests passed');
    } finally {
        await bridge.stop();
        fs.unlinkSync(path.join(dir, 'phone-bridge.key'));
        fs.rmdirSync(dir);
    }
}

testRules().then(testBridgeFirewallLifecycle).catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
