'use strict';

const KEY = 'ambientProfilesV1';
const MODES = ['sport', 'comfort', 'eco', 'adaptive'];

function boundedRgb(values) {
    if (!Array.isArray(values) || values.length !== 3 ||
        values.some(n => !Number.isInteger(n) || n < 0 || n > 254)) return null;
    return values.slice();
}
function brightness(n) {
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
}
function cleanZone(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.mode === 'car' || value.mode === 'main') return { mode: value.mode };
    const rgb = boundedRgb(value.rgb);
    return value.mode === 'own' && rgb ? { mode: 'own', rgb, brightness: brightness(value.brightness) } : null;
}
function cleanSnapshot(value) {
    if (!value || typeof value !== 'object' || !value.main) return null;
    const rgb = boundedRgb(value.main.rgb);
    if (!rgb) return null;
    const zones = {};
    const source = value.zones && typeof value.zones === 'object' ? value.zones : {};
    for (const key of Object.keys(source).slice(0, 52)) {
        if (!/^[01]:(?:[1-9]|1\d|2[0-6])$/.test(key)) continue;
        const zone = cleanZone(source[key]);
        if (zone) zones[key] = zone;
    }
    return { main: { rgb, brightness: brightness(value.main.brightness) }, zones };
}
function modeFromSignal(value) {
    const raw = value && value.actualValueModeDrivingExperience;
    if (raw === null || raw === undefined) return null;
    const s = String(raw).toUpperCase();
    if (s.indexOf('SPORT') >= 0 || s.indexOf('BOOST') >= 0 || [1, 2, 3, 15, 16, 23, 28].includes(Number(s))) return 'sport';
    if (s.indexOf('ECO') >= 0 || [7, 8, 9].includes(Number(s))) return 'eco';
    if (s.indexOf('ADAPT') >= 0 || Number(s) === 10) return 'adaptive';
    if (s.indexOf('COMFORT') >= 0 || [4, 5, 6].includes(Number(s))) return 'comfort';
    return null;
}

class AmbientProfiles {
    constructor(settings) {
        this.settings = settings;
        this.data = { zones: {}, favorites: Array(6).fill(null), modes: {}, follow: false };
        try {
            const old = JSON.parse(settings.get(KEY) || '{}');
            if (old && typeof old === 'object' && !Array.isArray(old)) {
                if (old.zones && typeof old.zones === 'object') {
                    for (const key of Object.keys(old.zones).slice(0, 52)) {
                        if (!/^[01]:(?:[1-9]|1\d|2[0-6])$/.test(key)) continue;
                        const zone = cleanZone(old.zones[key]);
                        if (zone) this.data.zones[key] = zone;
                    }
                }
                if (Array.isArray(old.favorites)) this.data.favorites = Array.from({ length: 6 }, (_, i) => cleanSnapshot(old.favorites[i]));
                if (old.modes && typeof old.modes === 'object') MODES.forEach(k => { const m = cleanSnapshot(old.modes[k]); if (m) this.data.modes[k] = m; });
                this.data.follow = old.follow === true;
            }
        } catch (_) { /* corrupted older state: use empty saved profiles */ }
    }
    save() { this.settings.set(KEY, JSON.stringify(this.data)); }
    snapshot(rgb, bright) {
        const clean = cleanSnapshot({ main: { rgb, brightness: bright }, zones: this.data.zones });
        if (!clean) throw new TypeError('invalid active colours');
        return clean;
    }
    zone(module) { return this.data.zones[module.key] || { mode: 'main' }; }
    setZone(module, mode, rgb, bright) {
        if (!module || !/^[01]:(?:[1-9]|1\d|2[0-6])$/.test(module.key)) throw new TypeError('module missing');
        const record = cleanZone({ mode, rgb, brightness: bright });
        if (!record) throw new TypeError('invalid zone');
        if (mode === 'main') delete this.data.zones[module.key];
        else this.data.zones[module.key] = record;
        this.save();
    }
    saveFavorite(index, snapshot) {
        if (!Number.isInteger(index) || index < 0 || index >= 6) throw new RangeError('favorite index');
        const clean = cleanSnapshot(snapshot);
        if (!clean) throw new TypeError('invalid snapshot');
        this.data.favorites[index] = clean;
        this.save();
    }
    loadFavorite(index) { return cleanSnapshot(this.data.favorites[index]); }
    clearFavorite(index) {
        if (!Number.isInteger(index) || index < 0 || index >= 6) throw new RangeError('favorite index');
        this.data.favorites[index] = null;
        this.save();
    }
    replaceZones(snapshot) {
        const clean = cleanSnapshot(snapshot);
        if (!clean) return false;
        this.data.zones = clean.zones;
        this.save();
        return true;
    }
    saveMode(mode, snapshot) {
        if (!MODES.includes(mode)) throw new RangeError('unknown mode');
        const clean = cleanSnapshot(snapshot);
        if (!clean) throw new TypeError('invalid snapshot');
        this.data.modes[mode] = clean;
        this.save();
    }
    clearMode(mode) {
        if (!MODES.includes(mode)) throw new RangeError('unknown mode');
        delete this.data.modes[mode];
        this.save();
    }
    mode(mode) { return MODES.includes(mode) ? cleanSnapshot(this.data.modes[mode]) : null; }
    toggleFollow() { this.data.follow = !this.data.follow; this.save(); return this.data.follow; }
}

module.exports = { AmbientProfiles, MODES, KEY, cleanSnapshot, modeFromSignal };
