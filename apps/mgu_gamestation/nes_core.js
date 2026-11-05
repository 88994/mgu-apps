'use strict';

// nes-js by Takahiro (MIT): executes entirely in the BMW Node 8 OAP app.
const lib = require('./nes_vendor');
const C = lib.Joypad.BUTTONS;
const MAPPING = {
    a: C.A, b: C.B, select: C.SELECT,
    start: C.START, up: C.UP, down: C.DOWN,
    left: C.LEFT, right: C.RIGHT,
};

class NesGame {
    constructor(bytes, output) {
        this.title = 'NES'; this.width = 256; this.height = 240;
        this.output = output;
        this.rgba = Buffer.alloc(256 * 240 * 4);
        this.uint32 = new Uint32Array(this.rgba.buffer, this.rgba.byteOffset, 256 * 240);
        this.previous = [{}, {}];
        this.nes = new lib.Nes();
        // nes-js calls renderPixel/updateScreen; this sink is an RGBA frame
        // buffer, so it never touches a DOM canvas or WebAudio API.
        this.nes.setDisplay({
            renderPixel: (x, y, packed) => {
                if (x >= 0 && x < 256 && y >= 0 && y < 240) this.uint32[y * 256 + x] = packed;
            },
            updateScreen: () => output(this.rgba, 256, 240),
        });
        this.nes.setRom(new lib.Rom(Uint8Array.from(bytes).buffer));
        this.nes.bootup();
    }
    tick(pads) {
        for (let player = 0; player < 2; player++) {
            const next = pads[player] || {}, previous = this.previous[player];
            Object.keys(MAPPING).forEach(key => {
                if (!!previous[key] === !!next[key]) return;
                const joypad = player === 0 ? this.nes.pad1 : this.nes.pad2;
                if (next[key]) joypad.pressButton(MAPPING[key]);
                else joypad.releaseButton(MAPPING[key]);
            });
            this.previous[player] = next;
        }
        // One NTSC video frame = 341 dots * 262 scanlines / 3 PPU dots per CPU clock.
        for (let i = 0; i < 29781; i++) this.nes.runCycle();
    }
    stop() { this.nes.stop(); this.nes = null; }
}

module.exports = {NesGame};
