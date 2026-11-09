'use strict';
const P = require('./protocol');
// Identity map from the kit's SGBD index. D9FC offsets verified in the
// supplied FLM02_L/R PRGs: four low-beam bytes, then ten high-beam bytes.
// Raw channel codes are deliberately not used as actuator channel numbers.
const MODULES = [
    { side: 'Left', address: 0x43, index: '0F26C0', name: 'FLM02_L' },
    { side: 'Right', address: 0x44, index: '0F26D0', name: 'FLM02_R' },
];
async function read(link) {
    const results = [];
    for (const m of MODULES) {
        const row = { side: m.side, address: m.address };
        results.push(row);
        try {
            const identity = await link.request(0x22, [0xF1, 0x50], false, m.address);
            row.index = P.indexOf(identity.slice(3));
            if (row.index !== m.index) { row.note = 'Variant not yet mapped; no further requests'; continue; }
            row.name = m.name;
            const mapping = await link.request(0x22, [0xD9, 0xFC], false, m.address);
            row.raw = P.hex(mapping);
            if (mapping.length < 17) throw new Error('Incomplete LED mapping response');
            row.highBeamRaw = P.hex(mapping.slice(7, 17));
            row.note = 'Raw high-beam mapping; no lights or motors commanded';
        } catch (e) { row.error = String(e.message || e); }
    }
    return results;
}
module.exports = { read };
