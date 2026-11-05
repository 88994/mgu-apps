'use strict';

const fs = require('fs');
const path = require('path');
const EXT = ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi'];
const USB_ROOTS = ['/media', '/run/media', '/mnt/usb', '/media/usb', '/media/usb0', '/mnt/media_rw'];
const MAX_FILES = 300;

function isMedia(name) { return EXT.some(x => String(name).toLowerCase().endsWith(x)); }
function safeName(name) {
    return path.basename(String(name || '')).replace(/[^A-Za-z0-9_.() -]/g, '_')
        .replace(/^\.+/, '').slice(0, 110);
}
function youtubeId(input) {
    const text = String(input || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    let u;
    try { u = new (require('url').URL)(text); } catch (_) { return null; }
    const host = String(u.hostname || '').toLowerCase();
    const parts = (u.pathname || '').split('/').filter(Boolean);
    let id = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') id = parts[0];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].indexOf(host) >= 0) {
        if (parts[0] === 'watch') id = u.searchParams.get('v');
        else if (['shorts', 'embed', 'live'].indexOf(parts[0]) >= 0) id = parts[1];
    }
    return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) && u.protocol === 'https:' ? id : null;
}
function scan(root, usbRoots) {
    const out = [], visited = {};
    const bases = [{base: path.join(root, 'videos'), source: 'Library'}]
        .concat((usbRoots || USB_ROOTS).map(base => ({base, source: 'USB'})));
    function walk(top, cur, depth, source) {
        if (out.length >= MAX_FILES || depth > 4) return;
        let st;
        try { st = fs.lstatSync(cur); } catch (_) { return; }
        if (st.isSymbolicLink()) return; // Do not traverse USB symlinks / escape the selected roots.
        if (st.isFile() && isMedia(cur)) {
            out.push({ id: source + ':' + cur, name: path.basename(cur), path: cur,
                source, size: st.size });
            return;
        }
        if (!st.isDirectory()) return;
        // Avoid traversing a repeated USB mount and scanning the same file twice.
        const key = st.dev + ':' + st.ino;
        if (visited[key]) return;
        visited[key] = true;
        let names;
        try { names = fs.readdirSync(cur); } catch (_) { return; }
        for (const name of names.sort()) {
            if (name[0] === '.' || out.length >= MAX_FILES) continue;
            walk(top, path.join(cur, name), depth + 1, source);
        }
    }
    bases.forEach(v => walk(v.base, v.base, 0, v.source));
    return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
function bytesTotal(dir) {
    let total = 0;
    try { for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        try { const st = fs.lstatSync(file); if (st.isFile()) total += st.size; } catch (_) {}
    } } catch (_) {}
    return total;
}
module.exports = { EXT, USB_ROOTS, isMedia, safeName, youtubeId, scan, bytesTotal };
