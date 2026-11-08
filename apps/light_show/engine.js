'use strict';
const P = require('./protocol');

// One serialized conversation. Stop sets the cancellation flag immediately;
// a possibly accepted in-flight command must finish before OEM is sent.
// No interval callback can queue another lamp command behind Stop.
class Engine {
    constructor(o) {
        this.link = o.link; this.guard = o.guard; this.journal = o.journal;
        this.now = o.now || Date.now; this.sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
        this.changed = o.changed || (() => {}); this.log = o.log;
        this.state = 'IDLE'; this.note = 'Ready'; this.mask = [0, 0];
        this.sent = 0; this.stepMs = 0; this.run = null; this.cancel = false;
        this.releaseConfirmed = false; this.stopRequested = false;
    }
    status() {
        return { state: this.state, note: this.note, mask: this.mask.slice(), sent: this.sent,
            stepMs: this.stepMs, releaseConfirmed: this.releaseConfirmed,
            remainingSeconds: this.deadline ? Math.max(0, Math.ceil((this.deadline - this.now()) / 1000)) : 0 };
    }
    update(state, note) { this.state = state; this.note = note; this.changed(); }
    async identify() {
        if (this.run) return;
        this.update('CHECKING', 'Reading BDC identity');
        let resolve;
        this.run = new Promise((r) => { resolve = r; });
        try { await this.link.identify(); this.update('IDLE', 'BDC_G05 identified - lamp operation untested'); }
        catch (e) { this.update('ERROR', String(e.message || e)); }
        finally { this.run = null; resolve(); }
    }
    start(config) {
        if (this.run) return this.run;
        // Revalidate at the command boundary, including settings loaded from disk.
        try { config = P.settings((k) => ({ pattern: config.pattern, lights: config.lights, tempo: config.tempo, duration: config.seconds })[k]); }
        catch (e) { this.update('ERROR', e.message); return Promise.resolve(); }
        const reason = this.guard.reason();
        if (reason) { this.update('BLOCKED', reason); return Promise.resolve(); }
        if (this.journal.pending()) { this.update('ERROR', 'OEM release pending - press STOP first'); return Promise.resolve(); }
        this.cancel = false; this.stopRequested = false; this.stopReason = null; this.releaseConfirmed = false;
        this.sent = 0; this.stepMs = 0; this.mask = [0, 0];
        this.update('STARTING', 'Checking BDC_G05');
        let resolve;
        this.run = new Promise((r) => { resolve = r; });
        this._play(config).then(() => { this.run = null; resolve(); }, (e) => {
            this.update('ERROR', String(e.message || e)); this.run = null; resolve();
        });
        return this.run;
    }
    allowed() {
        if (this.cancel) return false;
        const why = this.guard.reason();
        if (why) { this.cancel = true; this.stopRequested = true; this.stopReason = why; return false; }
        return true;
    }
    async _play(c) {
        let dirty = false, fault = null;
        try {
            await this.link.identify();
            if (!this.allowed()) return;
            // A durable marker is written BEFORE any request that can change the
            // session/lamps. If persistence fails, no control request is sent.
            this.journal.mark(this.link.index); dirty = true;
            await this.link.session();
            if (!this.allowed()) return;
            const pair = P.PAIRS[c.lights], pattern = P.PATTERNS[c.pattern].steps;
            const outputs = [pair.left, pair.right];
            let previous = [null, null], step = 0, keepAt = this.now(), lastStep = null;
            this.deadline = this.now() + c.seconds * 1000;
            this.update('RUNNING', P.PATTERNS[c.pattern].name + ' - ' + pair.name);
            while (this.allowed() && this.now() < this.deadline) {
                const begin = this.now(), mask = pattern[step % pattern.length];
                // Switch old lights off before switching new ones on. Each
                // request requires a matching positive BDC response.
                const order = [0, 1].filter((i) => mask[i] === 0).concat([0, 1].filter((i) => mask[i] === 1));
                for (const i of order) {
                    if (!this.allowed() || this.now() >= this.deadline) break;
                    if (previous[i] !== mask[i]) {
                        await this.link.set(outputs[i], mask[i]); this.sent++;
                        previous[i] = mask[i]; this.mask[i] = mask[i]; this.changed();
                    }
                }
                if (!this.allowed() || this.now() >= this.deadline) break;
                if (this.now() - keepAt >= 1000) { await this.link.keepalive(); keepAt = this.now(); }
                if (lastStep !== null) this.stepMs = this.now() - lastStep;
                lastStep = this.now(); step++;
                // Slow round trips slow the pattern. Never catch up by flooding
                // TASU, and never overlap with tester-present or cleanup.
                const wait = Math.max(0, c.tempo - (this.now() - begin));
                for (let slept = 0; slept < wait && !this.cancel; slept += 25) await this.sleep(Math.min(25, wait - slept));
            }
        } catch (e) { fault = String(e.message || e); }
        finally {
            this.deadline = 0;
            if (dirty) {
                const released = await this._release();
                if (released) this.update(fault ? 'ERROR' : 'IDLE', fault || this.stopReason || 'Show finished - vehicle controls lights');
            } else this.update(fault ? 'ERROR' : 'IDLE', fault || this.stopReason || 'Stopped before lamp control');
            this.stopReason = null;
        }
    }
    stop(reason) {
        this.cancel = true; this.stopRequested = true; this.stopReason = reason || 'Stopped - vehicle controls lights';
        const wasChecking = this.state === 'CHECKING';
        if (this.run) return this.run.then(() => {
            // identify() may have been running; a recovery marker still needs
            // cleaning even when that operation sent no lamp controls itself.
            if (wasChecking && this.journal.pending()) return this.stop(reason);
        });
        if (!this.journal.pending()) { this.update('IDLE', 'No active lamp override from this app'); return Promise.resolve(); }
        let resolve;
        this.run = new Promise((r) => { resolve = r; });
        this._recover().then(() => { this.run = null; resolve(); }, (e) => {
            this.update('ERROR', String(e.message || e)); this.run = null; resolve();
        });
        return this.run;
    }
    async _recover() {
        try {
            await this.link.identify();
            if (await this._release()) this.update('IDLE', 'OEM release confirmed');
        } catch (e) { this.update('ERROR', 'OEM release pending: ' + String(e.message || e)); }
    }
    async _release() {
        this.update('STOPPING', 'Returning light control to vehicle');
        let error = null, released = false;
        // Always attempt the session return even if 2F times out. A positive
        // session reply alone is not presented as proof of physical lamp state.
        try { await this.link.release(); released = true; } catch (e) { error = e.message || String(e); }
        try { await this.link.defaultSession(); } catch (e) { error = error || e.message || String(e); }
        this.mask = [0, 0]; this.releaseConfirmed = released;
        if (!error && released) {
            try { this.journal.clear(); } catch (e) { error = 'Could not clear recovery marker: ' + e.message; }
        }
        if (error) { this.update('ERROR', 'OEM release pending: ' + error); return false; }
        return true;
    }
}
module.exports = Engine;
