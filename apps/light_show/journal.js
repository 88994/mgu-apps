'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./protocol');

class Journal {
    constructor(dir) {
        this.file = path.join(dir, 'light-show-recovery.json'); this.value = null;
        try { this.value = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
        catch (e) { if (e.code !== 'ENOENT') this.value = { corrupted: true }; }
    }
    pending() { return !!this.value; }
    mark(index, control) {
        if (index !== P.INDEX) throw new Error('BDC_G05 identity required');
        const route = control && control.route || 'digital';
        if (['timed', 'digital'].indexOf(route) < 0 || (route === 'timed'
            && !Object.prototype.hasOwnProperty.call(P.FUNCTIONS, control.lights))) throw new Error('Invalid recovery context');
        const value = { index, address: P.ADDRESS, at: new Date().toISOString(), route,
            lights: control && control.lights || null };
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(value));
        fs.renameSync(this.file + '.tmp', this.file); this.value = value;
    }
    clear() { fs.unlinkSync(this.file); this.value = null; }
}
module.exports = Journal;
