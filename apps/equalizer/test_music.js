'use strict';
// Original instrumental written for MGU EQ testing. No third-party sound samples.
// Output: bounded 44.1 kHz stereo signed 16-bit PCM through existing PcmFilter.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { Readable } = require('stream');

const RATE = 44100;
const BPM = 120;
const BARS = 16;
const TOTAL_FRAMES = Math.round(BARS * 4 * 60 / BPM * RATE);
const TABLE_SIZE = 4096;
const SINE = new Float32Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) SINE[i] = Math.sin(i * 2 * Math.PI / TABLE_SIZE);
const PITCH = Array.from({ length: 128 }, (_, i) => 440 * Math.pow(2, (i - 69) / 12));
// Unique 8-bar progression, repeated with a different lead phrase in the second half.
const CHORDS = [
    [45, 57, 60, 64], [41, 53, 57, 60], [48, 60, 64, 67], [43, 55, 59, 62],
    [45, 57, 60, 64], [41, 53, 57, 60], [50, 62, 65, 69], [43, 55, 59, 62],
];
// Eight eighth notes per bar; -1 is a deliberate rest. Original composition.
const MELODY = [
    [76,-1,72,69,72,-1,76,79], [77,-1,72,69,72,69,-1,72],
    [79,-1,76,72,76,-1,79,83], [74,71,-1,74,79,74,71,-1],
    [76,-1,81,79,76,72,-1,69], [72,77,-1,76,72,69,-1,72],
    [74,-1,77,81,77,-1,74,72], [71,74,79,-1,74,71,-1,67],
    [81,-1,79,76,72,-1,76,79], [84,-1,81,77,72,69,-1,72],
    [83,-1,79,76,72,76,-1,79], [79,74,71,-1,74,-1,79,83],
    [81,-1,84,81,79,76,72,-1], [77,81,-1,77,76,72,-1,69],
    [81,-1,77,74,77,81,84,-1], [79,74,71,67,71,-1,67,-1],
];
function osc(hz, seconds) {
    const phase = hz * seconds;
    const x = (phase - Math.floor(phase)) * TABLE_SIZE;
    const i = x | 0;
    return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
}
function noise(n) {
    let x = (n + 1) | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x & 0xffff) / 32768 - 1;
}
function clamp(x) { return Math.max(-0.78, Math.min(0.78, x)); }
class MusicSource extends Readable {
    constructor() {
        super({ highWaterMark: 16384 });
        this.pos = 0;
        this.framesEmitted = 0;
    }
    _read() {
        if (this.pos >= TOTAL_FRAMES) { this.push(null); return; }
        const frames = Math.min(2048, TOTAL_FRAMES - this.pos);
        const out = Buffer.allocUnsafe(frames * 4);
        for (let i = 0; i < frames; i++) {
            const n = this.pos + i;
            const t = n / RATE;
            const beat = t * BPM / 60;
            const bar = Math.min(BARS - 1, (beat / 4) | 0);
            const chord = CHORDS[bar % CHORDS.length];
            const beatPart = beat - Math.floor(beat);
            const beatInBar = beat - bar * 4;
            const eighth = Math.min(7, (beatInBar * 2) | 0);
            const eighthPart = beatInBar * 2 - eighth;
            const lead = MELODY[bar][eighth];
            const fadeIn = Math.min(1, t / 0.38);
            const fadeOut = Math.min(1, (TOTAL_FRAMES - n) / (RATE * 1.2));
            const fade = Math.max(0, fadeIn * fadeOut);
            const bassEnv = Math.pow(1 - beatPart, 1.3);
            const bass = 0.19 * bassEnv * (0.82 * osc(PITCH[chord[0]], t) + 0.18 * osc(PITCH[chord[0]] * 2, t));
            const padEnv = Math.min(1, beatInBar * 1.7 + 0.08) * Math.min(1, (4 - beatInBar) * 1.7 + 0.08);
            const pluckEnv = lead < 0 ? 0 : Math.pow(1 - eighthPart, 1.7);
            const pluck = lead < 0 ? 0 : 0.19 * pluckEnv * (0.85 * osc(PITCH[lead], t) + 0.15 * osc(PITCH[lead] * 2, t));
            const kickPhase = beatInBar % 2;
            const kickEnv = Math.pow(Math.max(0, 1 - kickPhase * 5.2), 2);
            const kick = 0.22 * kickEnv * osc(58 + (1 - kickEnv) * 22, t);
            const snarePart = beatInBar % 2;
            const snareEnv = ((beatInBar | 0) % 2 === 1) ? Math.pow(Math.max(0, 1 - snarePart * 4), 2) : 0;
            const snare = 0.11 * snareEnv * noise(n);
            const hat = 0.037 * Math.pow(Math.max(0, 1 - eighthPart * 5), 2) * noise(n + 70001);
            const rhythm = bass + kick + snare + hat;
            const leftPad = 0.11 * padEnv * (0.55 * osc(PITCH[chord[1]], t) + 0.45 * osc(PITCH[chord[2]], t));
            const rightPad = 0.11 * padEnv * (0.55 * osc(PITCH[chord[3]], t) + 0.45 * osc(PITCH[chord[2]], t));
            const left = Math.round(clamp((rhythm + pluck * 0.94 + leftPad) * fade) * 32767);
            const right = Math.round(clamp((rhythm + pluck * 1.06 + rightPad) * fade) * 32767);
            out.writeInt16LE(left, i * 4);
            out.writeInt16LE(right, i * 4 + 2);
        }
        this.pos += frames;
        this.framesEmitted += frames;
        this.push(out);
    }
}
function aplayPath() {
    const candidates = String(process.env.PATH || '').split(':').filter(Boolean).map(p => path.join(p, 'aplay'));
    for (const p of candidates) {
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {}
    }
    return null;
}
class MusicPlayer {
    constructor(opts) {
        opts = opts || {};
        this.dspRuntime = opts.dspRuntime;
        this.spawn = opts.spawn || cp.spawn;
        this.findAplay = opts.findAplay || aplayPath;
        this.dspClient = opts.dspClient || require('./kit/dsp-client');
        this.onState = opts.onState || (() => {});
        this.active = null;
    }
    state(status, detail) { this.onState({ status, detail: detail || '', playing: status === 'playing' }); }
    play() {
        this.stop();
        const bin = this.findAplay();
        if (!bin) { this.state('error', 'aplay fehlt auf der MGU. Keine Audiowiedergabe möglich.'); return false; }
        let child;
        try {
            child = this.spawn(bin, ['-q', '-t', 'raw', '-f', 'S16_LE', '-c', '2', '-r', String(RATE)],
                { stdio: ['pipe', 'ignore', 'pipe'] });
        } catch (e) { this.state('error', 'ALSA-Start fehlgeschlagen: ' + e.message); return false; }
        const source = new MusicSource();
        const filter = new this.dspClient.PcmFilter({ sampleRate: RATE, channels: 2,
            source: 'equalizer_test_music', runtime: this.dspRuntime, timeout: 600,
            onFallback: (e) => { if (this.active && this.active.child === child) this.state('playing', 'DSP nicht erreichbar; Testmusik läuft ohne Filter: ' + e); } });
        const run = { source, filter, child, error: '' };
        this.active = run;
        this.state('playing', 'Testmusik gestartet · Wiedergabe über ALSA noch nicht bestätigt');
        child.stderr.on('data', data => { if (run.error.length < 700) run.error += data.toString('utf8'); });
        child.on('error', e => { if (this.active === run) this.fail(run, 'aplay: ' + e.message); });
        child.on('close', (code) => {
            if (this.active !== run) return;
            this.active = null;
            source.destroy(); filter.destroy();
            if (code === 0) this.state('finished', 'Testmusik beendet. Hörbare Ausgabe hängt vom ALSA-Routing ab.');
            else this.state('error', 'ALSA-Ausgabe fehlgeschlagen (Code ' + code + '): ' + (run.error.trim().slice(0, 180) || 'keine Ausgabegerät-Details'));
        });
        filter.on('error', e => { if (this.active === run) this.fail(run, 'DSP-Pipeline: ' + e.message); });
        child.stdin.on('error', e => { if (this.active === run) this.fail(run, 'ALSA-Stream: ' + e.message); });
        source.on('error', e => { if (this.active === run) this.fail(run, 'Musikgenerator: ' + e.message); });
        source.pipe(filter).pipe(child.stdin);
        return true;
    }
    fail(run, msg) {
        if (this.active !== run) return;
        this.stop(); this.state('error', msg);
    }
    stop() {
        const run = this.active;
        if (!run) return;
        this.active = null;
        run.source.unpipe(); run.filter.unpipe();
        run.source.destroy(); run.filter.destroy();
        try { run.child.stdin.destroy(); } catch (_) {}
        try { run.child.kill('SIGTERM'); } catch (_) {}
        this.state('stopped', 'Testmusik gestoppt');
    }
    toggle() { return this.active ? (this.stop(), false) : this.play(); }
}
module.exports = { MusicSource, MusicPlayer, RATE, BPM, BARS, TOTAL_FRAMES };
