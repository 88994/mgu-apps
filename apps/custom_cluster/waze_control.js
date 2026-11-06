'use strict';
/**
 * Optional cooperation with the *existing* Waze on Cluster tool.
 * Only the map cluster on/off request is sent; HUD state, CarPlay patch,
 * renderer installation and all other Waze preferences are untouched.
 * The two socket endpoints are private upstream interfaces, not a stable API.
 */
const net = require('net');
const RENDER_PATH = '/dev/shm/waze-on-cluster/ctl.sock';
const PATCH_PATH = '/dev/shm/waze-on-cluster/patch.sock';

function connect(path, timeoutMs, dial) {
    return new Promise((resolve, reject) => {
        const sock = (dial || net.connect)(path);
        let finished = false;
        const timer = setTimeout(() => finish(new Error('timeout connecting ' + path)), timeoutMs);
        function finish(err) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (err) { sock.destroy(); reject(err); } else resolve(sock);
        }
        sock.on('error', (e) => { if (!finished) finish(e); });
        sock.once('connect', () => finish());
    });
}

class WazeControl {
    constructor(log, opts) {
        this.log = log;
        this.opts = opts || {};
        this.choice = 'auto';
        this.status = 'Waze settings unchanged';
        this.generation = 0;
    }
    async setChoice(choice) {
        if (!['auto', 'on', 'off'].includes(choice) || this.choice === choice) return;
        this.choice = choice;
        const token = ++this.generation;
        if (choice === 'auto') { this.status = 'Waze settings unchanged'; return; }
        this.status = 'Requesting Waze ' + choice;
        let sockets = [];
        let sent = false;
        try {
            sockets.push(await connect(this.opts.renderPath || RENDER_PATH, 1800, this.opts.dial));
            sockets.push(await connect(this.opts.patchPath || PATCH_PATH, 1800, this.opts.dial));
            if (token !== this.generation) return;
            sockets[0].end(JSON.stringify({ cmd: 'cluster', on: choice === 'on' ? '1' : '0' }) + '\n');
            sockets[1].end(JSON.stringify({ cmd: 'cluster', on: choice === 'on' ? 1 : 0 }) + '\n');
            sent = true;
            this.status = 'Requested Waze ' + choice + ' (not confirmed)';
            this.log.info(this.status);
        } catch (e) {
            if (token === this.generation) {
                this.status = 'Waze service unavailable';
                this.log.info('Waze control not connected: ' + (e.code || e.message));
            }
        } finally {
            if (!sent) sockets.forEach((s) => s.destroy());
        }
    }
}
module.exports = { WazeControl, connect, RENDER_PATH, PATCH_PATH };
