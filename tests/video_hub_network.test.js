'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const {makeFirewall} = require('../native/video-net/firewall');
const {makeNetwork} = require('../native/video-net/server');
const {readNetworkStatus} = require('../apps/mgu_video_hub/network_status');

function fakeNft() {
    let rows = [
        'iifname "wlan_bridge" tcp dport 18890 accept comment "mgu-phone-bridge" # handle 1',
        'counter drop # handle 2'
    ];
    let handle = 3, inserted = 0;
    async function run(args) {
        if (args[0] === '-a') return 'table ip filter {\nchain input {\n' + rows.join('\n') + '\n}\n}\n';
        if (args[0] === 'insert') {
            rows.unshift(args.slice(5).join(' ') + ' # handle ' + handle++);
            inserted++;
            return '';
        }
        if (args[0] === 'delete') {
            rows = rows.filter(row => !row.endsWith('handle ' + args[6]));
            return '';
        }
        throw new Error('Unexpected nft arguments: ' + args.join(' '));
    }
    return {run, rows:() => rows, inserted:() => inserted,
        reload:() => { rows = ['counter drop # handle 90']; },
        phoneFirst:() => {
            rows.unshift('iifname "wlan_bridge" tcp dport 18890 accept comment "mgu-phone-bridge" # handle 91');
        }};
}

async function checkFirewall() {
    const nft = fakeNft(), fw = makeFirewall({run:nft.run});
    assert.strictEqual(await fw.ensure(), 'added');
    assert.ok(nft.rows()[0].indexOf('tcp dport 18879 accept') >= 0);
    nft.phoneFirst();
    const before = nft.inserted();
    assert.strictEqual(await fw.ensure(), 'kept', 'Phone Terminal rule may precede video rule');
    assert.strictEqual(nft.inserted(), before, 'no oscillating firewall reorder');
    await fw.close();
    assert.ok(nft.rows().some(row => row.indexOf('mgu-phone-bridge') >= 0), 'never remove Phone Terminal rule');
    assert.ok(nft.rows().every(row => row.indexOf('mgu-video-net') < 0));
    nft.reload();
    assert.strictEqual(await fw.ensure(), 'added', 'recover after BMW reload');
    await fw.close();
    assert.ok(nft.rows().every(row => row.indexOf('mgu-video-net') < 0));
    const failed = makeFirewall({run:async () => { throw Error('nft denied'); }});
    await assert.rejects(failed.ensure(), /nft denied/);
}

function readStatus(port) {
    return new Promise((resolve, reject) => {
        readNetworkStatus((error, response) => error ? reject(error) : resolve(response), port);
    });
}

async function checkService() {
    let available = false, firewallOpen = false, deny = false, closeCalls = 0;
    const fw = {
        ensure:async () => { if (deny) throw Error('nft denied'); firewallOpen = true; },
        close:async () => { firewallOpen = false; closeCalls++; }
    };
    const service = makeNetwork({firewall:fw, probe:async () => available,
        statusPort:0, intervalMs:100000});
    const port = await service.start();
    try {
        assert.strictEqual((await readStatus(port)).ready, false);
        available = true;
        await service.check();
        assert.strictEqual(firewallOpen, true);
        assert.strictEqual((await readStatus(port)).ready, true);

        available = false;
        await service.check();
        assert.strictEqual(firewallOpen, false, 'server stopped, close port');
        assert.strictEqual((await readStatus(port)).ready, false);

        deny = true; available = true;
        await service.check();
        const status = await readStatus(port);
        assert.strictEqual(status.ready, false, 'nft failure must never show ready');
        assert.ok(status.error.indexOf('nft denied') >= 0);
    } finally {
        await service.stop();
        assert.strictEqual(firewallOpen, false);
        assert.ok(closeCalls >= 2);
    }
    await assert.rejects(readStatus(port), /ECONNREFUSED/);
}

async function checkManifest() {
    const root = path.resolve(__dirname, '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'mgu-repo.json'), 'utf8'));
    const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/mgu_video_hub/app.json'), 'utf8'));
    const tool = JSON.parse(fs.readFileSync(path.join(root, 'native/video-net/component.json'), 'utf8'));
    assert.ok(/^[a-z0-9][a-z0-9-]*$/.test(tool.id));
    const toolEntry = catalog.components.find(c => c.id === tool.id);
    const appEntry = catalog.components.find(c => c.id === app.id);
    assert.strictEqual(toolEntry.version, tool.version);
    assert.strictEqual(appEntry.version, app.version);
    assert.strictEqual(appEntry.requires[tool.id], tool.version);
    for (const f of tool.files) assert.ok(fs.existsSync(path.join(root, 'native/video-net', f.path)));
    for (const u of tool.units) {
        const p = path.join(root, 'native/video-net', u.from || u.name);
        assert.ok(fs.readFileSync(p, 'utf8').indexOf('/var/opt/' + tool.id + '/current/') >= 0);
    }
}

checkFirewall().then(checkService).then(checkManifest).then(() => {
    console.log('Video Hub network tests passed: scoped firewall, Phone Terminal coexistence, readiness');
}).catch(e => {console.error(e.stack || e); process.exitCode = 1;});
