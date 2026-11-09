'use strict';

// The production MGU firewall drops unsolicited INPUT traffic. A listening
// HTTP socket alone is not reachable from a phone on wlan_bridge.
const child = require('child_process');

const TAG = 'mgu-phone-bridge';
const IFACE = 'wlan_bridge';

function execNft(args) {
    return new Promise((resolve, reject) => {
        child.execFile('nft', args, { timeout: 15000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
            if (error) return reject(new Error('nft: ' + (String(stderr || '').trim() || error.message)));
            resolve(stdout);
        });
    });
}

function makeFirewall(options) {
    options = options || {};
    const run = options.run || execNft;
    const port = options.port || 18890;
    const iface = options.iface || IFACE;
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(iface) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Invalid firewall interface or port');
    }

    const table = ['ip', 'filter', 'input'];
    const comment = 'comment "' + TAG + '"';

    function rules() {
        return run(['-a', 'list', 'chain'].concat(table)).then((listing) => {
            const rows = String(listing).split('\n').filter((line) =>
                /# handle \d+\s*$/.test(line) && !/^\s*(chain|table)\b/.test(line));
            const tagged = rows.filter((line) => line.indexOf(comment) >= 0);
            return { rows, tagged };
        });
    }

    function removeTagged(lines) {
        return lines.reduce((pending, line) => pending.then(() => {
            const match = /# handle (\d+)\s*$/.exec(line);
            return match ? run(['delete', 'rule'].concat(table, ['handle', match[1]])) : undefined;
        }), Promise.resolve());
    }

    async function ensure() {
        const existing = await rules();
        const expected = 'iifname "' + iface + '" tcp dport ' + port + ' accept';
        if (existing.tagged.length === 1 && existing.rows[0] === existing.tagged[0] &&
            existing.tagged[0].indexOf(expected) >= 0) return 'kept';
        await removeTagged(existing.tagged);
        await run(['insert', 'rule'].concat(table, [
            'iifname', '"' + iface + '"', 'tcp', 'dport', String(port), 'accept',
            'comment', '"' + TAG + '"'
        ]));
        return 'added';
    }

    async function close() {
        let existing;
        try { existing = await rules(); }
        catch (error) {
            // A missing chain on a development system is already closed.
            if (/No such file or directory|does not exist/i.test(error.message)) return;
            throw error;
        }
        await removeTagged(existing.tagged);
    }

    return { ensure, close };
}

module.exports = { makeFirewall };

if (require.main === module && process.argv[2] === 'close') {
    makeFirewall().close().catch((error) => {
        console.error('[phone-bridge] final firewall cleanup: ' + error.message);
        process.exitCode = 1;
    });
}
