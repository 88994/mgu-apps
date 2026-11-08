'use strict';
// Read-only audio-path inventory. No playback, ALSA config writes, injection,
// process restart, /proc/*/environ, command lines, keys or VIN collection.
const fs = require('fs');
function read(file, max) {
    try { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(max || 32768); let n;
        try { n = fs.readSync(fd, b, 0, b.length, 0); } finally { fs.closeSync(fd); } return b.slice(0, n).toString('utf8');
    } catch (e) { return null; }
}
function list(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }
function probe() {
    const configurations = {};
    for (const file of ['/etc/asound.conf', '/usr/share/alsa/alsa.conf', '/etc/alsa/alsa.conf']) {
        const s = read(file, 65536);
        if (s !== null) configurations[file] = { pcmNames: Array.from(new Set((s.match(/\bpcm\.[A-Za-z0-9_!.-]+/g) || []))),
            mentionsSmartx: /smartx/i.test(s), mentionsAvb: /avb/i.test(s) };
    }
    const processes = [];
    for (const id of list('/proc').filter((p) => /^[0-9]+$/.test(p))) {
        const name = (read('/proc/' + id + '/comm', 128) || '').trim();
        const snd = [];
        for (const fd of list('/proc/' + id + '/fd')) {
            try { const link = fs.readlinkSync('/proc/' + id + '/fd/' + fd); if (/^\/dev\/snd\//.test(link)) snd.push(link); } catch (e) {}
        }
        if (!snd.length && !/audio|carplay|smartx|avb|entertain|media|stream/i.test(name)) continue;
        const maps = read('/proc/' + id + '/maps', 65536) || '';
        const libraries = Array.from(new Set(maps.split('\n').map((line) => line.split(/\s+/).pop())
            .filter((s) => /^\//.test(s) && /alsa|asound|smartx|avb|audio/i.test(s))));
        processes.push({ pid: Number(id), name, soundDevices: Array.from(new Set(snd)), audioLibraries: libraries });
        if (processes.length >= 80) break;
    }
    return { schema: 1, created: new Date().toISOString(), arch: process.arch, node: process.version,
        soundCards: read('/proc/asound/cards'), pcmDevices: read('/proc/asound/pcm'), configurations, processes,
        note: 'Inventory only. A listed device or library does not prove that stock CarPlay/radio audio can be routed through this DSP.' };
}
if (require.main === module) process.stdout.write(JSON.stringify(probe(), null, 2) + '\n');
module.exports = { probe };
