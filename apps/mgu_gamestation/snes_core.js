'use strict';

// jssnes (MIT), full JavaScript SNES core. On-car performance is unverified.
const SNES = require('./snes_vendor').SNES;
const INPUTS = {
    b: 0x8000, y: 0x4000, select: 0x2000, start: 0x1000,
    up: 0x0800, down: 0x0400, left: 0x0200, right: 0x0100,
    a: 0x0080, x: 0x0040, l: 0x0020, r: 0x0010,
};

function mask(pad) {
    let bits = 0;
    Object.keys(INPUTS).forEach(key => { if (pad && pad[key]) bits |= INPUTS[key]; });
    return bits;
}

class SnesGame {
    constructor(bytes, output) {
        this.title = 'Super Nintendo'; this.width = 512; this.height = 208;
        this.snes = new SNES();
        this.snes.loadRom(bytes);
        this.output = output;
    }
    tick(pads) {
        this.snes.mmu.joy1 = mask(pads[0]);
        this.snes.mmu.joy2 = mask(pads[1]);
        this.snes.frame();
        // Upstream PPU packs 0xAABBGGRR in a Uint32Array; little-endian
        // views yield the RGBA bytes expected by the MGU renderer.
        const pixels = new Uint8Array(this.snes.ppu.frameBuffer.buffer,
            this.snes.ppu.frameBuffer.byteOffset, 512 * 208 * 4);
        this.output(pixels, 512, 208);
    }
    stop() { this.snes = null; }
}

module.exports = {SnesGame, mask};
