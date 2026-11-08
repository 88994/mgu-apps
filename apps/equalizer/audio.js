'use strict';
const C = require('./controls');
const COMMAND = 'org.genivi.am.commandinterface.CommandControl';
const CAREQ = 'de.bmw.infotainment.am.carequalizing.CarSpecificEqualizingData';

function checked(reply) {
    if (!reply || (reply.amError !== 0 && reply.amError !== 6)) throw new Error('Audio-Manager: ' + (reply && reply.amError !== undefined ? 'Fehler ' + reply.amError : 'keine gültige Antwort'));
    return reply;
}
function array(reply, key) {
    checked(reply);
    if (!Array.isArray(reply[key])) throw new Error('Audio-Antwort enthält keine Werteliste: ' + key);
    return reply[key];
}

class Audio {
    constructor(signals, log) {
        this.signals = signals; this.log = log; this.command = null; this.car = {};
        this.errors = []; this.last = null; this.onChange = null; this.writing = false; this.reading = null;
        this.ready = false; this.connecting = null;
    }
    note(e) { const s = String(e && e.message || e); this.errors.push(s); this.errors = this.errors.slice(-12); this.log.warn(s); }
    async call(p, name, args) { return checked(await this.signals.call(p, name, args || {}, 2000)); }
    async connect() {
        if (this.connecting) return this.connecting;
        this.connecting = this._connect().then(() => { this.connecting = null; }, (e) => { this.connecting = null; throw e; });
        return this.connecting;
    }
    async _connect() {
        if (!this.command) {
            try {
                this.command = await this.signals.proxy(COMMAND, '1');
                for (const name of ['mainSinkSoundPropertyChanged', 'systemPropertyChanged']) {
                    if (this.signals.on) await this.signals.on(this.command, name, () => this.changed(), this.log).catch((e) => this.note(e));
                }
            } catch (e) { this.note(e); }
        }
        for (const instance of [1, 2]) {
            if (this.car[instance]) continue;
            try {
                const p = await this.signals.proxy(CAREQ, String(instance)); this.car[instance] = p;
                if (this.signals.on) await this.signals.on(p, 'eqDataChanged', () => this.changed(), this.log).catch((e) => this.note(e));
            } catch (e) { this.note(e); }
        }
        this.ready = true;
    }
    changed() { if (this.onChange) this.onChange(); }
    async snapshot() {
        // Coalesce UI refreshes, and never overlap a native request with another refresh.
        if (this.reading) return this.reading;
        this.reading = this._snapshot().then((s) => { this.last = s; this.reading = null; return s; }, (e) => { this.reading = null; throw e; });
        return this.reading;
    }
    async _snapshot() {
        const points = [], errors = [], scopes = [];
        const attempt = async (scope, fn) => { try { const p = await fn(); C.index(p); points.push.apply(points, p); scopes.push(scope); } catch (e) { errors.push(scope + ': ' + String(e.message || e)); } };
        if (this.command) {
            await attempt('system', async () => array(await this.call(this.command, 'getListSystemProperties'), 'listSystemProperties')
                .map((p) => ({ kind: 'system', entity: 0, key: p.type, value: p.value })));
            try {
                const sinks = array(await this.call(this.command, 'getListMainSinks'), 'listMainSinks');
                if (sinks.length > 100) throw new Error('Zu viele Audioausgänge.');
                for (const sink of sinks) {
                    if (!Number.isInteger(sink.sinkID) || sink.sinkID < 1 || sink.sinkID > 65535) continue;
                    await attempt('sink:' + sink.sinkID, async () => array(await this.call(this.command, 'getListMainSinkSoundProperties', { sinkID: sink.sinkID }), 'listSoundProperties')
                        .map((p) => ({ kind: 'sink', entity: sink.sinkID, key: p.type, value: p.value, name: String(sink.name || '').slice(0, 80) })));
                }
            } catch (e) { errors.push('sinks: ' + String(e.message || e)); }
        }
        for (const entity of Object.keys(this.car)) {
            await attempt('car:' + entity, async () => array(await this.call(this.car[entity], 'getAllEQData'), 'eqDataSetArray')
                .map((p) => ({ kind: 'car', entity: Number(entity), key: p.key, value: p.data })));
        }
        C.index(points);
        return { at: Date.now(), points, scopes, errors };
    }
    async writePoint(b, value) {
        if (!C.validBinding(b) || !C.rawValue(value) || value < b.low || value > b.high) throw new Error('Wert außerhalb des gelernten Bereichs.');
        if (b.kind === 'car') {
            if (!this.car[b.entity]) throw new Error('Audio-Schnittstelle nicht verbunden.');
            return this.call(this.car[b.entity], 'setEQData', { eqData: value, eqKey: b.key });
        }
        if (!this.command) throw new Error('Audio-Manager nicht verbunden.');
        return b.kind === 'system' ? this.call(this.command, 'setSystemProperty', { property: { type: b.key, value } })
            : this.call(this.command, 'setMainSinkSoundProperty', { sinkID: b.entity, soundProperty: { type: b.key, value } });
    }
    async readBinding(b) {
        if (b.kind === 'car') {
            const r = await this.call(this.car[b.entity], 'getEQData', { eqKey: b.key });
            if (!C.rawValue(r.eqData)) throw new Error('Ungültiger Rücklesewert.');
            return r.eqData;
        }
        const r = b.kind === 'system' ? await this.call(this.command, 'getListSystemProperties')
            : await this.call(this.command, 'getListMainSinkSoundProperties', { sinkID: b.entity });
        const found = array(r, b.kind === 'system' ? 'listSystemProperties' : 'listSoundProperties').filter((p) => p.type === b.key);
        if (found.length !== 1 || !C.rawValue(found[0].value)) throw new Error('Regler nicht mehr vorhanden.');
        return found[0].value;
    }
    async verify(b, expected) {
        let last;
        for (let i = 0; i < 3; i++) {
            if (i) await new Promise((resolve) => setTimeout(resolve, 180));
            last = await this.readBinding(b);
            if (last === expected) return;
        }
        throw new Error('Rücklesen weicht ab: erwartet ' + expected + ', erhalten ' + last);
    }
    async apply(bindings, draft, base) {
        if (this.writing) throw new Error('Übernahme läuft bereits.');
        const ids = Object.keys(draft), seen = {};
        if (!ids.length) return { count: 0 };
        for (const id of ids) {
            const b = bindings[id], value = draft[id];
            if (!C.validBinding(b) || b.control !== id || seen[b.id] || !C.rawValue(value) || value < b.low || value > b.high || !C.rawValue(base[id])) throw new Error('Ungültige Reglerzuordnung oder Werte.');
            seen[b.id] = true;
        }
        this.writing = true;
        const originals = {}, attempted = [];
        try {
            // Validate every target and check external edits before the first mutation.
            for (const id of ids) {
                const b = bindings[id], raw = await this.readBinding(b);
                if (raw < b.low || raw > b.high || raw !== base[id]) throw new Error('Klang wurde außerhalb der App verändert. Neu lesen und erneut einstellen.');
                originals[id] = raw;
            }
            for (const id of ids) {
                if (draft[id] === originals[id]) continue;
                attempted.push(id); // A timed-out write might still have reached the provider.
                await this.writePoint(bindings[id], draft[id]);
                await this.verify(bindings[id], draft[id]);
            }
            // Recheck the entire set: a later write can modify an earlier coupled property.
            for (const id of ids) await this.verify(bindings[id], draft[id]);
            return { count: attempted.length };
        } catch (e) {
            const failed = [];
            for (const id of attempted.slice().reverse()) {
                try { await this.writePoint(bindings[id], originals[id]); await this.verify(bindings[id], originals[id]); }
                catch (restoreError) { failed.push(id); this.note(restoreError); }
            }
            for (const id of attempted) {
                try { await this.verify(bindings[id], originals[id]); }
                catch (restoreError) { if (failed.indexOf(id) < 0) failed.push(id); this.note(restoreError); }
            }
            const error = new Error(String(e.message || e) + (attempted.length ? failed.length ? ' Wiederherstellung unbestätigt: ' + failed.join(', ') : ' Vorherige Werte wiederhergestellt.' : ''));
            error.rollbackFailed = failed; this.note(error); throw error;
        } finally { this.writing = false; }
    }
}
module.exports = { Audio, COMMAND, CAREQ, checked };
