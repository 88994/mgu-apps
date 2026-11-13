'use strict';
/**
 * CarPlay Cluster — 把 CarPlay 画面显示到仪表中央地图区。
 *
 * 本应用只是一个控制面板：它不安装原生组件，也不修改 /usr/bin/carplay。
 * 投屏由已安装的开源 waze-on-cluster 服务完成（robertnisipeanu/idrive-apps，
 * GPL-3.0-or-later）。这里使用的两个 Unix socket 是它的私有接口，
 * 报文格式见上游 apps/robertn_waze_cluster/src/waze_cluster_control.js。
 */
const net = require('net');
const fs = require('fs');
const mgu = require('./kit/mgu');

const RENDER_PATH = '/dev/shm/waze-on-cluster/ctl.sock';
const PATCH_PATH = '/dev/shm/waze-on-cluster/patch.sock';
const PENDING_PATH = '/dev/shm/waze-on-cluster/activation-pending';
const RETRY_MS = 1500;

/** CarPlay 画面在仪表里的尺寸，与补丁向手机通告的一致。 */
const SIZE = '1088x480';
const SAFE = '504x368+286+72';

/* 一条按行分隔的 JSON socket，打开期间自动重连。
 * link: 'down' | 'up' | 'absent'（socket 不存在）| 'refused' | 'failed'。 */
class LineSocket {
    constructor(path, log, onMessage) {
        this.path = path;
        this.log = log;
        this.onMessage = onMessage || function () {};
        this.link = 'down';
        this.linkCode = null;
        this.open_ = false;
        this.socket = null;
        this.buf = '';
        this.retry = null;
    }
    open() {
        if (this.open_) return;
        this.open_ = true;
        this.connect();
    }
    close() {
        this.open_ = false;
        clearTimeout(this.retry);
        this.retry = null;
        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }
        this.link = 'down';
    }
    connected() {
        return this.link === 'up';
    }
    send(obj) {
        if (this.socket && this.link === 'up') this.socket.write(JSON.stringify(obj) + '\n');
    }
    connect() {
        if (!this.open_ || this.socket) return;
        const sock = net.connect(this.path);
        this.socket = sock;
        this.buf = '';
        sock.setEncoding('utf8');
        sock.on('connect', () => {
            if (this.socket !== sock) return;
            this.link = 'up';
            this.linkCode = null;
            this.log.info('connected: ' + this.path);
        });
        sock.on('data', (chunk) => {
            if (this.socket === sock) this.onData(chunk);
        });
        sock.on('error', (err) => {
            if (this.socket !== sock) return;
            const code = (err && err.code) || 'ERROR';
            this.link = code === 'ENOENT' ? 'absent' : code === 'ECONNREFUSED' ? 'refused' : 'failed';
            this.linkCode = code;
        });
        sock.on('close', () => {
            if (this.socket !== sock) return;
            this.socket = null;
            if (this.link === 'up') this.link = 'refused';
            this.retry = setTimeout(() => {
                this.retry = null;
                this.connect();
            }, RETRY_MS);
        });
    }
    onData(chunk) {
        this.buf += chunk;
        let nl;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl).trim();
            this.buf = this.buf.slice(nl + 1);
            if (!line) continue;
            try {
                this.onMessage(JSON.parse(line));
            } catch (e) {
                this.log.warn('bad line from ' + this.path);
            }
        }
    }
}

function linkText(link) {
    if (link === 'up') return 'connected';
    if (link === 'absent') return 'service not installed';
    if (link === 'refused') return 'service not running';
    return 'waiting';
}

/** 两个 socket 的状态机：补丁、投屏开关、转向提示开关。 */
class Control {
    constructor(log) {
        this.log = log;
        this.renderStatus = null;
        this.patchStatus = null;
        this.lastError = '';
        this.render = this.makeSocket(RENDER_PATH, (m) => this.onRender(m));
        this.patch = this.makeSocket(PATCH_PATH, (m) => this.onPatch(m));
    }
    makeSocket(path, handler) {
        return new LineSocket(path, this.log, handler);
    }
    open() {
        this.render.open();
        this.patch.open();
    }
    close() {
        this.render.close();
        this.patch.close();
    }

    /* ---- 补丁状态 ---- */
    pending() {
        const ps = this.patchStatus;
        if (this.patch.connected()) {
            if (!ps) return null;
            if (ps.pending) return ps.pending;
            return ps.carplay === 'deferred' ? 'unknown' : null;
        }
        /* 守护进程还没起来时，读安装器留下的标记 */
        try {
            const marker = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
            if (marker && (marker.action === 'apply' || marker.action === 'revert')) return marker.action;
        } catch (e) { /* 没有标记 */ }
        return null;
    }
    busy() {
        const ps = this.patchStatus;
        return !!(ps && (ps.busy || ps.state === 'busy' || ps.restart && ps.restart.state === 'restarting'));
    }
    outdated() {
        const ps = this.patchStatus;
        return !!(ps && (ps.mode && ps.mode !== 'avb' || ps.panel && ps.panel !== 'high' ||
            ps.res && ps.res !== SIZE || ps.safe && ps.safe !== SAFE));
    }
    canPatch() {
        const ps = this.patchStatus;
        if (!this.patch.connected() || !ps || this.busy() || this.pending()) return false;
        if (ps.state === 'patched') return this.outdated();
        return ps.state === 'original' || ps.state === 'unknown' || ps.state === 'error';
    }
    canRemove() {
        const ps = this.patchStatus;
        if (!this.patch.connected() || !ps || this.busy()) return false;
        if (this.pending()) return false;
        return ps.state === 'patched' || ps.state === 'unknown' || ps.state === 'error';
    }
    patchNow() {
        if (this.canPatch()) {
            this.log.info('patch: apply');
            this.patch.send({ cmd: 'apply', panel: 'high', mode: 'avb' });
        }
    }
    removePatch() {
        if (this.canRemove()) {
            this.log.info('patch: revert');
            this.patch.send({ cmd: 'revert' });
        }
    }

    /* ---- 仪表地图开关 ---- */
    clusterOn() {
        const rs = this.renderStatus;
        return rs && (rs.cluster === 0 || rs.cluster === 1) ? rs.cluster === 1 : null;
    }
    canShow() {
        return this.render.connected();
    }
    show(on) {
        if (!this.canShow()) return;
        this.log.info('cluster ' + (on ? 'on' : 'off'));
        this.render.send({ cmd: 'cluster', on: on ? '1' : '0' });
        this.patch.send({ cmd: 'cluster', on: on ? 1 : 0 });
    }

    /* ---- BMW 转向提示框 ---- */
    hideGuidance() {
        const rs = this.renderStatus;
        return rs && (rs.hide_bmw_guidance === 0 || rs.hide_bmw_guidance === 1) ? rs.hide_bmw_guidance === 1 : null;
    }
    guidanceLocked() {
        return !!(this.renderStatus && this.renderStatus.guide_disabled === 1);
    }
    toggleGuidance() {
        const hide = this.hideGuidance();
        if (hide === null || this.guidanceLocked() || !this.render.connected()) return;
        this.render.send({ cmd: 'guide', hide: hide ? 0 : 1 });
    }

    /* ---- 重启（补丁延后生效时） ---- */
    restartNeeded() {
        const ps = this.patchStatus;
        return !!(ps && (ps.carplay === 'deferred' || ps.pending));
    }
    canRestart() {
        const ps = this.patchStatus;
        if (!this.patch.connected() || !ps || this.busy() || !this.restartNeeded()) return false;
        const r = ps.restart;
        return !(r && r.possibleAt && r.possibleAt > Date.now());
    }
    restart() {
        if (this.canRestart()) {
            this.log.info('requesting head-unit restart');
            this.patch.send({ cmd: 'reboot' });
        }
    }

    /* ---- 状态文字 ---- */
    patchText() {
        const link = this.patch.link;
        if (link === 'absent') return 'Service not installed';
        if (link === 'down' || link === 'refused' || link === 'failed') return 'Service not running';
        const ps = this.patchStatus;
        const pending = this.pending();
        if (pending) return pending === 'revert' ? 'Removed after restart' : 'Patched after restart';
        if (!ps) return 'Connected, no status yet';
        if (ps.state === 'busy' || ps.busy === 'carplay') return 'Working…';
        if (ps.state === 'error') return 'Failed';
        if (ps.conflict && ps.state !== 'patched') return 'Not supported: ' + String(ps.conflict).slice(0, 46);
        if (ps.state === 'patched') return this.outdated() ? 'Patched (update needed)' : 'Patched';
        return ps.state === 'original' ? 'Not patched' : 'Partly patched';
    }
    mapText() {
        if (this.clusterOn() === false) return 'Off';
        if (!this.render.connected()) return linkText(this.render.link);
        const rs = this.renderStatus;
        if (!rs) return 'Connected, no status yet';
        switch (rs.state) {
        case 'showing': return 'Showing CarPlay' + (rs.reason ? ' — ' + String(rs.reason).slice(0, 40) : '');
        case 'starting': return 'Starting…';
        case 'frozen': return 'Frozen';
        case 'error': return 'Error: ' + String(rs.reason || 'unknown').slice(0, 40);
        case 'unsupported': return 'Not supported on this car';
        default: return String(rs.reason || 'Waiting for CarPlay').slice(0, 52);
        }
    }
    guideText() {
        if (this.guidanceLocked()) return 'Fixed by renderer';
        const hide = this.hideGuidance();
        if (hide === null) return 'Unknown';
        return hide ? 'Hidden' : 'BMW original';
    }

    onRender(msg) {
        if (msg.ev === 'status') this.renderStatus = msg;
    }
    onPatch(msg) {
        if (msg.ev === 'status') this.patchStatus = msg;
        else if (msg.ev === 'refused' && msg.reason) this.lastError = String(msg.reason).slice(0, 60);
    }
}

/* ---------------- 界面 ---------------- */
const COL_OK = '#2fd27a';
const COL_WARN = '#e6ad37';

function panel(cv, t, x, y, w, h, title, titleColor) {
    cv.fillRect(x, y, w, h, '#14181d');
    cv.text(title, x + 18, y + 12, 20, titleColor || t.text, { font: 'bold' });
}

function row(cv, t, x, y, label, value, color, size) {
    cv.text(label, x, y, size || 19, t.dim);
    cv.text(value, x + 210, y, size || 19, color || t.text);
}

mgu.run({
    async start(ctx) {
        const log = ctx.log;
        const settings = ctx.settings;
        const ctl = new Control(log);
        let autoStartDone = false;

        ctl.open();
        ctx.ui.onClick('BTN_PATCH', () => {
            if (ctl.canPatch()) ctl.patchNow();
            else if (ctl.canRemove()) ctl.removePatch();
        });
        ctx.ui.onClick('BTN_SHOW', () => {
            const on = ctl.clusterOn();
            ctl.show(on !== true);
        });
        ctx.ui.onClick('BTN_GUIDE', () => ctl.toggleGuidance());
        ctx.ui.onClick('BTN_RESTART', () => ctl.restart());
        ctx.ui.onVisible((name, visible) => {
            if (!visible || name !== 'MAIN' || autoStartDone) return;
            autoStartDone = true;
            setTimeout(() => {
                if (settings.get('autoStart')) {
                    if (ctl.canPatch()) ctl.patchNow();
                    if (ctl.clusterOn() !== true) ctl.show(true);
                }
                if (settings.get('hideGuidance') && ctl.hideGuidance() === false) ctl.toggleGuidance();
            }, 900);
        });

        ctx.loop('MAIN', 2, () => {
            const t = ctx.theme();
            const cv = ctx.canvas(1600, 520).clear(t.bg);
            cv.text('CARPLAY CLUSTER', 40, 26, 34, t.text, { font: 'bold' });
            cv.text('Instrument-cluster mirroring via the open source waze-on-cluster service',
                42, 70, 20, t.dim);

            const patchOk = ctl.patch.connected();
            const renderOk = ctl.render.connected();
            cv.text('patch daemon: ' + (patchOk ? 'connected' : linkText(ctl.patch.link)),
                1200, 30, 17, patchOk ? COL_OK : COL_WARN);
            cv.text('render service: ' + (renderOk ? 'connected' : linkText(ctl.render.link)),
                1200, 54, 17, renderOk ? COL_OK : COL_WARN);

            panel(cv, t, 40, 104, 900, 356, 'CarPlay projection');
            row(cv, t, 70, 160, '1  Patch', ctl.patchText(),
                ctl.patchStatus && ctl.patchStatus.state === 'patched' ? COL_OK : t.text);
            row(cv, t, 70, 204, '2  Cluster map', ctl.mapText(),
                ctl.clusterOn() === true ? COL_OK : t.text);
            row(cv, t, 70, 248, '3  BMW turn box', ctl.guideText(), t.text);
            row(cv, t, 70, 292, 'Size advertised', SIZE + '  (safe ' + SAFE + ')', t.dim, 17);

            const hint = ctl.patch.link === 'absent' || ctl.render.link === 'absent'
                ? 'waze-on-cluster is not installed on this head unit — install it from the upstream project first'
                : ctl.patch.link !== 'up'
                    ? 'Patch daemon unreachable — the CarPlay patch cannot be applied right now'
                    : ctl.patchStatus && ctl.patchStatus.conflict
                        ? 'This head unit refused the patch: ' + String(ctl.patchStatus.conflict).slice(0, 70)
                        : 'Patch writes CarPlay\'s own stream into the cluster map slot; Show turns the map on';
            cv.text(hint, 70, 340, 17, COL_WARN);
            cv.text('Buttons below apply the change at once; a deferred patch needs Restart.',
                70, 372, 16, t.dim);
            if (ctl.lastError) cv.text('Last refusal: ' + ctl.lastError, 70, 400, 15, COL_WARN);

            panel(cv, t, 968, 104, 592, 356, 'How it works');
            cv.text('1  Patch: writes the open source patch into the', 992, 156, 16, t.text);
            cv.text('   head unit, so CarPlay\'s own video can be', 992, 176, 16, t.text);
            cv.text('   captured (no Apple/MFi bypass, no re-encoding).', 992, 196, 16, t.text);
            cv.text('2  Show: maps that stream into the cluster\'s', 992, 232, 16, t.text);
            cv.text('   central map slot (' + SIZE + ').', 992, 252, 16, t.text);
            cv.text('3  Turn box: hides BMW\'s own guidance box so', 992, 288, 16, t.text);
            cv.text('   CarPlay directions are not drawn twice.', 992, 308, 16, t.text);
            cv.text('CarPlay must be started from BMW\'s own menu;', 992, 348, 16, t.dim);
            cv.text('this app never launches a CarPlay session.', 992, 368, 16, t.dim);
            cv.text('Park only while testing. No safety approval.', 992, 412, 16, COL_WARN);
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
