'use strict';

// Persist only bounded, purpose-built diagnostic events in the app data dir.
// Never export the QR pairing token, the authenticated proxy URL, raw HTTP
// headers, signed Googlevideo URLs, or arbitrary subprocess command lines.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'video-hub-diagnostics.json';
const MAX_EVENTS = 350;
const MAX_BYTES = 160 * 1024;

function safeText(input) {
    return String(input === undefined || input === null ? '' : input)
        .replace(/https?:\/\/[^\s<>'"]+/gi, '[URL redacted]')
        .replace(/\b(?:pair|token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[credential redacted]')
        .replace(/\b[t]=[a-f0-9]{18,}\b/gi, 't=[redacted]')
        .replace(/[\x00-\x1f\x7f]+/g, ' ')
        .trim().slice(0, 260);
}

function normalize(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const at = typeof entry.at === 'string' && /^\d{4}-\d\d-\d\dT/.test(entry.at) ? entry.at : null;
    if (!at) return null;
    const level = ['INFO', 'WARN', 'ERROR'].indexOf(entry.level) >= 0 ? entry.level : 'INFO';
    const event = safeText(entry.event).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 44);
    return {at, level, event:event || 'unknown', detail:safeText(entry.detail)};
}

class Diagnostics {
    constructor(dir, version) {
        this.file = path.join(dir, FILE);
        this.version = version;
        this.session = crypto.randomBytes(5).toString('hex');
        this.events = [];
        this.writeError = '';
        try {
            if (fs.statSync(this.file).size > MAX_BYTES) throw new Error('Previous diagnostic log is oversized');
            const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (Array.isArray(stored.events))
                this.events = stored.events.map(normalize).filter(Boolean).slice(-MAX_EVENTS);
        } catch (_) { /* fresh install or unreadable previous data */ }
    }

    add(level, event, detail) {
        const row = normalize({at:new Date().toISOString(), level, event, detail});
        if (!row) return;
        this.events.push(row);
        if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        this.persist();
    }

    persist() {
        const output = () => JSON.stringify({schema:1, app:'mgu_video_hub', events:this.events});
        let text = output();
        while (Buffer.byteLength(text, 'utf8') > MAX_BYTES && this.events.length > 1) {
            this.events.splice(0, Math.min(20, this.events.length - 1));
            text = output();
        }
        const temp = this.file + '.tmp';
        try {
            fs.writeFileSync(temp, text, {encoding:'utf8', mode:0o600});
            fs.renameSync(temp, this.file);
            this.writeError = '';
        } catch (e) {
            this.writeError = safeText(e.message);
            try { fs.unlinkSync(temp); } catch (_) {}
        }
    }

    recent(n) { return this.events.slice(-Math.max(0, Math.min(30, n || 8))); }

    snapshot(status) {
        const s = status && typeof status === 'object' ? status : {};
        return {
            schema:1,
            app:'mgu_video_hub',
            version:this.version,
            generatedAt:new Date().toISOString(),
            session:this.session,
            runtime:{node:process.version, arch:process.arch, platform:process.platform},
            status:s,
            logWriteError:this.writeError || null,
            events:this.events.slice(),
        };
    }
}

module.exports = {Diagnostics, FILE, MAX_EVENTS, MAX_BYTES, safeText};
