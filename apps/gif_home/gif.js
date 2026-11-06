'use strict';
/**
 * Small dependency-free GIF87a/GIF89a decoder for Node 8 on BMW MGU.
 * Handles LZW, local palettes, interlacing, transparency and disposal 2/3.
 * Limits avoid exhausting the Atom head unit's memory on uploaded files.
 * No network, no native modules, no vehicle control interfaces.
 */
const LIMIT = { bytes: 6 * 1024 * 1024, width: 640, height: 360, frames: 90, pixels: 32 * 1024 * 1024 };

function decodeLzw(data, minBits, count) {
    if (minBits < 2 || minBits > 8) throw new Error('Invalid GIF LZW code size');
    const clear = 1 << minBits, end = clear + 1;
    let dict, size, next, prev;
    function reset() {
        dict = new Array(4096);
        for (let i = 0; i < clear; i++) dict[i] = [i];
        size = minBits + 1;
        next = end + 1;
        prev = null;
    }
    reset();
    let bit = 0, out = new Uint8Array(count), pos = 0;
    while (bit + size <= data.length * 8 && pos < count) {
        let code = 0;
        for (let b = 0; b < size; b++) code |= ((data[(bit + b) >> 3] >> ((bit + b) & 7)) & 1) << b;
        bit += size;
        if (code === clear) { reset(); continue; }
        if (code === end) break;
        let entry;
        if (code < next && dict[code]) entry = dict[code];
        else if (code === next && prev) entry = prev.concat(prev[0]);
        else throw new Error('Corrupt GIF LZW stream');
        for (let i = 0; i < entry.length && pos < count; i++) out[pos++] = entry[i];
        if (prev && next < 4096) {
            dict[next++] = prev.concat(entry[0]);
            if (next === (1 << size) && size < 12) size++;
        }
        prev = entry;
    }
    if (pos !== count) throw new Error('Truncated GIF image');
    return out;
}

function decode(buf) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    if (buf.length > LIMIT.bytes) throw new Error('GIF is too large (max 6 MB)');
    if (buf.length < 13 || !/^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) throw new Error('Not a GIF87a/GIF89a file');
    let p = 6;
    const u8 = () => { if (p >= buf.length) throw new Error('Truncated GIF'); return buf[p++]; };
    const u16 = () => u8() | (u8() << 8);
    function block() {
        const out = [];
        let len, total = 0;
        while ((len = u8()) !== 0) {
            if (p + len > buf.length) throw new Error('Truncated GIF sub-block');
            out.push(buf.slice(p, p + len)); p += len;
            total += len;
            if (total > LIMIT.bytes) throw new Error('GIF sub-block too large');
        }
        return Buffer.concat(out, total);
    }
    function palette(n) {
        if (p + n * 3 > buf.length) throw new Error('Truncated GIF colour table');
        const value = buf.slice(p, p + n * 3); p += n * 3; return value;
    }
    const width = u16(), height = u16(), packed = u8(), background = u8();
    u8(); // pixel aspect ratio
    if (!width || !height || width > LIMIT.width || height > LIMIT.height) throw new Error('GIF dimensions must be at most 640x360');
    const globalColors = packed & 128 ? palette(1 << ((packed & 7) + 1)) : null;
    const rgba = new Uint8Array(width * height * 4);
    const frames = [];
    let gce = { disposal: 0, transparent: -1, delay: 100 };
    let duration = 0;
    for (;;) {
        const kind = u8();
        if (kind === 0x3b) break;
        if (kind === 0x21) {
            const label = u8();
            if (label === 0xf9) {
                if (u8() !== 4) throw new Error('Invalid GIF graphic-control block');
                const flags = u8(), hundredths = u16(), transparentIndex = u8();
                if (u8() !== 0) throw new Error('Invalid GIF graphic-control terminator');
                gce = { disposal: (flags >> 2) & 7, transparent: (flags & 1) ? transparentIndex : -1,
                    delay: Math.max(80, hundredths * 10) };
            } else block();
            continue;
        }
        if (kind !== 0x2c) throw new Error('Unexpected GIF block');
        const left = u16(), top = u16(), w = u16(), h = u16(), flags = u8();
        if (!w || !h || left + w > width || top + h > height) throw new Error('Invalid GIF frame bounds');
        const colors = flags & 128 ? palette(1 << ((flags & 7) + 1)) : globalColors;
        if (!colors) throw new Error('Missing GIF colour table');
        const minBits = u8(), indices = decodeLzw(block(), minBits, w * h);
        const saved = gce.disposal === 3 ? rgba.slice() : null;
        const rows = [];
        if (flags & 64) {
            [[0, 8], [4, 8], [2, 4], [1, 2]].forEach((pass) => {
                for (let y = pass[0]; y < h; y += pass[1]) rows.push(y);
            });
        } else for (let y = 0; y < h; y++) rows.push(y);
        for (let sy = 0; sy < h; sy++) {
            const dstRow = ((top + rows[sy]) * width + left) * 4;
            for (let x = 0; x < w; x++) {
                const idx = indices[sy * w + x];
                if (idx === gce.transparent) continue;
                const ci = idx * 3, di = dstRow + x * 4;
                if (ci + 2 >= colors.length) throw new Error('Invalid GIF colour index');
                rgba[di] = colors[ci]; rgba[di + 1] = colors[ci + 1]; rgba[di + 2] = colors[ci + 2]; rgba[di + 3] = 255;
            }
        }
        frames.push({ data: rgba.slice(), delay: gce.delay });
        duration += gce.delay;
        if (frames.length > LIMIT.frames || frames.length * rgba.length > LIMIT.pixels) throw new Error('GIF has too many frames for the MGU');
        if (gce.disposal === 2) {
            const bc = globalColors && background * 3 + 2 < globalColors.length ? background * 3 : -1;
            for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) {
                const i = (y * width + x) * 4;
                if (bc >= 0) { rgba[i] = globalColors[bc]; rgba[i + 1] = globalColors[bc + 1]; rgba[i + 2] = globalColors[bc + 2]; rgba[i + 3] = 255; }
                else { rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; }
            }
        } else if (gce.disposal === 3 && saved) rgba.set(saved);
        gce = { disposal: 0, transparent: -1, delay: 100 };
    }
    if (!frames.length) throw new Error('GIF contains no image');
    return { width, height, frames, duration };
}

module.exports = { decode, LIMIT };
