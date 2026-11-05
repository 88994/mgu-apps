'use strict';

// MGU render protocol v4: I420 ring buffer, not an HTML5 video/web browser.
// Decoder is deliberately external: the BMW OAP Node 8 runtime has no video codec.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const FPS = 15, SLOTS = 3, HEADER = 64, ID = 73;
const MAGIC = 0x4656474d;

function executable(name) {
    const parts = name.indexOf('/') >= 0 ? [name] :
        String(process.env.PATH || '').split(':').filter(Boolean).map(p => path.join(p, name));
    return parts.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { return false; } }) || null;
}
function frameHeader(w, h, seq, slot) {
    const b = Buffer.alloc(HEADER);
    [MAGIC, 1, w, h, seq, slot, SLOTS, 1, 0].forEach((x, i) => b.writeUInt32LE(x >>> 0, i * 4));
    return b;
}
function videoOp(cv, id, x, y, w, h, radius) {
    cv._grow(7);
    const i = cv.n;
    cv.u[i] = 19;
    cv.f[i + 1] = x; cv.f[i + 2] = y;
    cv.f[i + 3] = w; cv.f[i + 4] = h;
    cv.f[i + 5] = radius || 0;
    cv.u[i + 6] = id;
    cv.n += 7;
}
function rendererRegister(gpu, file, id) {
    if (!gpu || !gpu.ready || !gpu.native || !gpu.info || !gpu.info.video || !gpu._write) return false;
    const p = Buffer.from(file + '\0', 'utf8');
    const len = (p.length + 3) & ~3;
    const b = Buffer.alloc(8 + 4 + len);
    b.writeUInt32LE(13, 0); b.writeUInt32LE(4 + len, 4);
    b.writeUInt32LE(id, 8); p.copy(b, 12);
    return !!gpu._write(b);
}
function resolveYoutube(id, resolver, callback) {
    if (!resolver) { callback(new Error('yt-dlp is missing on the MGU')); return {kill() {}}; }
    const url = 'https://www.youtube.com/watch?v=' + id;
    const p = cp.spawn(resolver, ['--no-playlist', '--no-warnings', '--get-url',
        '-f', 'best[height<=720]/best', url], {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', done = false;
    const timer = setTimeout(() => finish(new Error('YouTube resolver timed out')), 25000);
    function finish(error, value) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (error) { try { p.kill('SIGKILL'); } catch (_) {} }
        callback(error, value);
    }
    p.stdout.on('data', b => { stdout += b.toString('utf8'); if (stdout.length > 8192) finish(new Error('Resolver output too large')); });
    p.stderr.on('data', b => { if (stderr.length < 1500) stderr += b.toString('utf8'); });
    p.on('error', e => finish(e));
    p.on('close', code => {
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        if (code !== 0 || lines.length !== 1 || !/^https:\/\//.test(lines[0]))
            finish(new Error((stderr.trim() || 'No playable single-stream format') .slice(0, 180)));
        else finish(null, lines[0]);
    });
    return p;
}

class VideoBridge {
    constructor(log, opts) {
        this.log = log || console;
        opts = opts || {};
        this.ffmpeg = opts.ffmpeg === undefined ? executable(process.env.MGU_FFMPEG || 'ffmpeg') : opts.ffmpeg;
        this.aplay = opts.aplay === undefined ? executable('aplay') : opts.aplay;
        this.resolver = opts.resolver === undefined ? executable(process.env.MGU_YTDLP || 'yt-dlp') : opts.resolver;
        this.path = '/dev/shm/mgu-video-vhub-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
        this.fd = null;
        this.status = 'Idle'; this.error = '';
        this.position = 0; this.duration = null;
        this.playing = false; this.paused = false;
        this.child = null; this.audioDec = null; this.audioOut = null; this.resolving = null;
        this.source = null; this.generation = 0; this.frames = 0; this.tail = Buffer.alloc(0);
        this.width = 640; this.height = 360; this.frameSize = 0;
    }
    compatible() { return !!this.ffmpeg; }
    _open(w, h) {
        this._closeFile();
        this.width = w; this.height = h;
        this.frameSize = w * h * 3 / 2;
        this.fd = fs.openSync(this.path, 'w+', 0o600);
        fs.ftruncateSync(this.fd, HEADER + this.frameSize * SLOTS);
        fs.writeSync(this.fd, frameHeader(w, h, 0, 0), 0, HEADER, 0);
    }
    _closeFile() {
        if (this.fd !== null) { try { fs.closeSync(this.fd); } catch (_) {} this.fd = null; }
        try { fs.unlinkSync(this.path); } catch (_) {}
    }
    _writeFrame(frame) {
        if (this.fd === null || !this.playing || this.paused) return;
        const next = (this.frames + 1) % SLOTS;
        fs.writeSync(this.fd, frame, 0, this.frameSize, HEADER + next * this.frameSize);
        // Commit order: slot first, then sequence. The renderer samples newest sequence.
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32LE(next, 0); b.writeUInt32LE(this.frames + 1, 4);
        fs.writeSync(this.fd, b.slice(0, 4), 0, 4, 20);
        fs.writeSync(this.fd, b.slice(4), 0, 4, 16);
        this.frames++;
        this.position = this.startedAt + this.frames / FPS;
    }
    _onData(data) {
        if (!this.playing) return;
        let b = this.tail.length ? Buffer.concat([this.tail, data]) : data;
        while (b.length >= this.frameSize) {
            this._writeFrame(b.slice(0, this.frameSize));
            b = b.slice(this.frameSize);
        }
        this.tail = b;
    }
    start(source, seconds, width, audio) {
        this.stop();
        this.source = source;
        const gen = this.generation;
        this.position = Math.max(0, Number(seconds) || 0);
        this.error = '';
        this.status = 'Preparing video...';
        if (!this.ffmpeg) { this.status = 'Decoder unavailable'; this.error = 'ffmpeg is not installed'; return; }
        if (source.type === 'youtube') {
            this.status = 'Resolving YouTube stream...';
            this.resolving = resolveYoutube(source.id, this.resolver, (err, direct) => {
                this.resolving = null;
                if (gen !== this.generation) return;
                if (err) { this.status = 'YouTube unavailable'; this.error = err.message; return; }
                this._decode(direct, this.position, width, audio, gen);
            });
        } else this._decode(source.path, this.position, width, audio, gen);
    }
    _decode(input, seconds, width, audio, gen) {
        if (gen !== this.generation) return;
        const w = width === 960 ? 960 : 640, h = w * 9 / 16;
        try { this._open(w, h); } catch (e) { this.status = 'Frame buffer failed'; this.error = e.message; return; }
        this.frames = 0; this.startedAt = seconds; this.tail = Buffer.alloc(0);
        const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-re'];
        if (seconds) args.push('-ss', String(seconds));
        args.push('-i', input, '-an', '-vf', 'fps=' + FPS + ',scale=' + w + ':' + h + ',format=yuv420p',
            '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1');
        let err = '';
        try { this.child = cp.spawn(this.ffmpeg, args, {stdio: ['ignore', 'pipe', 'pipe']}); }
        catch (e) { this.status = 'Decoder failed'; this.error = e.message; this._closeFile(); return; }
        const child = this.child;
        this.playing = true; this.paused = false; this.status = 'Playing';
        child.stdout.on('data', b => { if (gen === this.generation) this._onData(b); });
        child.stderr.on('data', b => { if (err.length < 1200) err += b.toString('utf8'); });
        child.on('error', e => { if (gen === this.generation) { this.error = e.message; this.status = 'Decoder error'; } });
        child.on('close', code => {
            if (gen !== this.generation || this.child !== child) return;
            this.child = null; this.playing = false; this.paused = false;
            this._stopAudio();
            this.status = code === 0 && this.frames ? 'Finished' : 'Decoder stopped';
            if (code !== 0 && !this.error) this.error = err.trim().slice(0, 180) || 'ffmpeg exited ' + code;
        });
        if (audio === 'alsa') this._startAudio(input, seconds);
    }
    _startAudio(input, seconds) {
        if (!this.aplay) { this.error = 'aplay missing; playback is silent'; return; }
        const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-re'];
        if (seconds) args.push('-ss', String(seconds));
        args.push('-i', input, '-vn', '-ac', '2', '-ar', '44100', '-f', 's16le', 'pipe:1');
        try {
            this.audioDec = cp.spawn(this.ffmpeg, args, {stdio: ['ignore', 'pipe', 'ignore']});
            this.audioOut = cp.spawn(this.aplay, ['-q', '-f', 'S16_LE', '-c', '2', '-r', '44100'], {stdio: ['pipe', 'ignore', 'ignore']});
            this.audioDec.stdout.pipe(this.audioOut.stdin);
            this.audioDec.on('error', e => { this.error = 'Audio decoder: ' + e.message; });
            this.audioOut.on('error', e => { this.error = 'Audio output: ' + e.message; });
        } catch (e) { this.error = 'Audio unavailable: ' + e.message; this._stopAudio(); }
    }
    pause() {
        if (!this.child) return;
        const signal = this.paused ? 'SIGCONT' : 'SIGSTOP';
        try {
            this.child.kill(signal);
            [this.audioDec, this.audioOut].forEach(p => { if (p) try { p.kill(signal); } catch (_) {} });
            this.paused = !this.paused;
            this.status = this.paused ? 'Paused' : 'Playing';
        } catch (e) { this.error = e.message; }
    }
    seek(delta, width, audio) {
        if (!this.source) return;
        this.start(this.source, Math.max(0, this.position + delta), width, audio);
    }
    _stopAudio() {
        if (this.audioDec) { try { this.audioDec.kill('SIGCONT'); this.audioDec.kill('SIGKILL'); } catch (_) {} this.audioDec = null; }
        if (this.audioOut) { try { this.audioOut.kill('SIGCONT'); this.audioOut.kill('SIGKILL'); } catch (_) {} this.audioOut = null; }
    }
    stop() {
        this.generation++;
        if (this.resolving) { try { this.resolving.kill('SIGKILL'); } catch (_) {} this.resolving = null; }
        if (this.child) { try { this.child.kill('SIGCONT'); this.child.kill('SIGKILL'); } catch (_) {} this.child = null; }
        this._stopAudio();
        this._closeFile();
        this.playing = false; this.paused = false;
        this.status = 'Stopped'; this.tail = Buffer.alloc(0);
    }
    dispose() { this.stop(); }
}
module.exports = { VideoBridge, executable, frameHeader, rendererRegister, videoOp, resolveYoutube,
    FPS, HEADER, SLOTS, ID, MAGIC };
