'use strict';

const CONTROLS = [
    { id: 'eq100', label: '100 Hz', group: 'eq' },
    { id: 'eq200', label: '200 Hz', group: 'eq' },
    { id: 'eq500', label: '500 Hz', group: 'eq' },
    { id: 'eq1k', label: '1 kHz', group: 'eq' },
    { id: 'eq2k', label: '2 kHz', group: 'eq' },
    { id: 'eq5k', label: '5 kHz', group: 'eq' },
    { id: 'eq10k', label: '10 kHz', group: 'eq' },
    { id: 'bass', label: 'Bass', group: 'tone' },
    { id: 'treble', label: 'Höhen', group: 'tone' },
    { id: 'balance', label: 'Balance', group: 'tone' },
    { id: 'fader', label: 'Fader', group: 'tone' },
];
const integer = (n) => typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rawValue = (n) => integer(n) && n >= -32768 && n <= 32767;

function pointId(p) { return p.kind + ':' + p.entity + ':' + p.key; }
function validPoint(p) {
    if (!p || !rawValue(p.value) || !integer(p.key) || !integer(p.entity)) return false;
    return p.kind === 'car' ? (p.entity === 1 || p.entity === 2) && rawValue(p.key)
        : (p.kind === 'system' && p.entity === 0 || p.kind === 'sink' && p.entity > 0 && p.entity <= 65535)
          && p.key >= 0 && p.key <= 65535;
}
function index(points) {
    const out = {};
    for (const p of points || []) {
        if (!validPoint(p) || out[pointId(p)]) throw new Error('Ungültige oder doppelte Audiowerte.');
        out[pointId(p)] = p;
    }
    return out;
}
function validBinding(b) {
    return !!b && CONTROLS.some((c) => c.id === b.control) && validPoint(Object.assign({}, b, { value: b.center }))
        && b.id === pointId(b) && rawValue(b.low) && rawValue(b.high) && b.low < b.high
        && b.center > b.low && b.center < b.high && (b.direction === 1 || b.direction === -1)
        && b.learned === true;
}

// All four snapshots come from explicit user captures. No speculative key, unit,
// frequency mapping or value range is used to write the car's audio settings.
function learn(control, snapshots, bindings) {
    if (!CONTROLS.some((c) => c.id === control) || snapshots.length !== 4) throw new Error('Vier Messungen erforderlich.');
    const [center, minimum, maximum, back] = snapshots.map(index);
    const inventory = Object.keys(center).sort().join('|');
    if ([minimum, maximum, back].some((s) => Object.keys(s).sort().join('|') !== inventory)) throw new Error('Audio-Werteliste hat sich während der Einrichtung verändert. Messung wiederholen.');
    const matches = Object.keys(center).filter((id) => {
        const c = center[id], l = minimum[id], h = maximum[id], r = back[id];
        return l && h && r && c.value === r.value && l.value !== h.value
            && c.value > Math.min(l.value, h.value) && c.value < Math.max(l.value, h.value);
    });
    if (matches.length !== 1) throw new Error(matches.length
        ? 'Mehrere Werte ändern sich. Zuordnung nicht eindeutig; Messung wiederholen.'
        : 'Kein passender Regler erkannt. BMW-Regler prüfen und Messung wiederholen.');
    const id = matches[0], p = center[id];
    if (Object.keys(bindings || {}).some((k) => k !== control && bindings[k].id === id)) throw new Error('Dieser Audiowert ist bereits einem anderen Regler zugeordnet.');
    const b = Object.assign({}, p, { id, control, center: p.value,
        low: Math.min(minimum[id].value, maximum[id].value), high: Math.max(minimum[id].value, maximum[id].value),
        direction: maximum[id].value > minimum[id].value ? 1 : -1, learned: true, at: new Date().toISOString() });
    delete b.value;
    if (!validBinding(b)) throw new Error('Reglerbereich nicht plausibel.');
    return b;
}
function normalized(b, raw) {
    if (!validBinding(b) || !rawValue(raw) || raw < b.low || raw > b.high) return null;
    const d = raw - b.center;
    return (d >= 0 ? d / (b.high - b.center) : d / (b.center - b.low)) * b.direction;
}
function rawFromNormalized(b, n) {
    if (!validBinding(b) || typeof n !== 'number' || !isFinite(n)) throw new Error('Ungültiger Reglerwert.');
    n = clamp(n, -1, 1) * b.direction;
    return clamp(Math.round(b.center + n * (n >= 0 ? b.high - b.center : b.center - b.low)), b.low, b.high);
}
function percent(b, raw) {
    const n = normalized(b, raw);
    return n === null ? '--' : (n > 0 ? '+' : '') + Math.round(n * 100) + ' %';
}
function preset(name, bindings) {
    const out = {}, eq = name === 'bass' ? [0.25, 0.18, 0.05, 0, 0, 0.05, 0.08]
        : name === 'voice' ? [-0.12, -0.08, 0.05, 0.18, 0.22, 0.08, 0] : [0, 0, 0, 0, 0, 0, 0];
    CONTROLS.forEach((c, i) => {
        const b = bindings[c.id];
        // Music presets leave speaker distribution where the user set it.
        if (!validBinding(b) || c.id === 'balance' || c.id === 'fader') return;
        const n = c.group === 'eq' ? eq[i] : c.id === 'bass' ? (name === 'bass' ? 0.2 : name === 'voice' ? -0.1 : 0)
            : name === 'voice' ? 0.12 : name === 'bass' ? 0.05 : 0;
        out[c.id] = rawFromNormalized(b, n);
    });
    return out;
}
module.exports = { CONTROLS, clamp, rawValue, validPoint, pointId, index, validBinding, learn, normalized, rawFromNormalized, percent, preset };
