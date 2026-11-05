'use strict';

// Serverboy.js (GPL-2.0), Game Boy / Game Boy Color, executes on Node 8.
const GameBoy = require('./gb_vendor');
const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'select', 'start'];

class GameBoyGame {
    constructor(bytes, output) {
        this.title = 'Game Boy / Color'; this.width = 160; this.height = 144;
        this.gb = new GameBoy(); this.gb.loadRom(bytes);
        this.output = output;
        this.rgba = Buffer.alloc(160 * 144 * 4);
    }
    tick(pads) {
        const p = pads[0] || {};
        this.gb.pressKeys(BUTTONS.filter(k => !!p[k]));
        const pixels = this.gb.doFrame();
        if (!pixels || pixels.length !== this.rgba.length) throw new Error('Invalid Game Boy video frame');
        for (let i = 0; i < pixels.length; i++) this.rgba[i] = pixels[i];
        this.output(this.rgba, 160, 144);
    }
    stop() { this.gb = null; }
}

module.exports = {GameBoyGame};
