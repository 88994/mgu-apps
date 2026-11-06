'use strict';
// One client in the existing shared cluster-render service. No binary patch,
// no second RAMSES participant and no reconfiguration of Waze on cluster.
const { ClusterRender } = require('./cluster_render_client.js');
const fragmentShader = require('./cluster_shader.js');
const g80Shader = require('./g80_panel_shader.js');
const sixwbShader = require('./sixwb_panel_shader.js');
const { PALETTE, resolveColor, resolve6WBColor, colorHex } = require('./cluster_colors.js');
const COLORS = Object.keys(PALETTE).reduce((m, k) => { m[k] = PALETTE[k].concat([1]); return m; }, {});
const BADGE_FS = `#version 100
precision mediump float;
varying vec2 v_uv;
void main() {
  vec2 p=v_uv-vec2(0.5);
  float r=length(p);
  float outside=1.0-smoothstep(0.43,0.48,r);
  float inside=1.0-smoothstep(0.16,0.20,r);
  vec3 c=mix(vec3(0.03,0.26,0.17),vec3(0.36,1.0,0.60),inside);
  gl_FragColor=vec4(c,outside);
}`;
const MODES = { stock: 0, sport: 1, classic: 2, minimal: 3, g80: 4, oem: 5, sixwb: 6 };
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const PANEL_TEST_MS = 12000;

class ClusterLayers {
    constructor(log, socket) {
        this.log = log;
        this.cr = new ClusterRender('custom_cluster', socket);
        this.effectRef = 0;
        this.panelRef = 0;
        this.badgeRef = 0;
        this.ready = false;
        this.layerState = 'inactive';
        this.targetState = 'unknown';
        this.lastSample = 0;
        this.data = {};
        this.options = { layout: 'stock', accent: 'm', phoneBadge: false, wazeMap: 'auto',
            sixwbTheme: 'comfort', sixwbColorSource: 'original',
            colorMode: 'palette', colorBrightness: 100 };
        this.phoneOpen = false;
        this.lastSent = 0;
        this.armedUntil = 0;
        this.disarmReason = 'Off by default';
        this.cr.on('ready', () => { this.ready = true; this.apply(); this.log.info('cluster renderer connected'); });
        this.cr.on('disconnected', () => { this.ready = false; this.layerState = 'disconnected'; });
        this.cr.on('layer', (ref, state, reason) => {
            if (ref === this.effectRef || ref === this.badgeRef || ref === this.panelRef) {
                this.layerState = state;
                if (state === 'error') this.log.warn('cluster layer: ' + reason);
            }
        });
        this.cr.on('target', (target, state) => { if (target === 'map' || target === 'panel') this.targetState = target + ': ' + state; });
        this.cr.on('refused', (op, ref, reason) => this.log.warn('cluster ' + op + ' ref=' + ref + ': ' + reason));
        this.cr.connect();
    }

    settings(options) {
        const previous = this.options.layout;
        this.options = options;
        if (previous !== options.layout) this.disarm('Layout changed');
        this.apply();
    }
    sample(d) {
        if (!d || d.demo || !finite(d.speed) || !finite(d.rpm) || d.speed < 0 || d.speed > 350 || d.rpm < 0 || d.rpm > 8000) return;
        this.data = d;
        this.lastSample = Date.now();
        this.apply();
    }
    // Gear selection can change without an rpm/speed notification. Observe it
    // separately, without falsely refreshing the last real telemetry sample.
    observeVehicle(d) {
        if (!d || d.demo) {
            if (this.armedUntil) { this.disarm('Non-live vehicle data'); this.apply(); }
            return;
        }
        if (this.data.stage !== d.stage) {
            this.data.stage = d.stage;
            this.apply();
        }
    }
    badge(opened) { this.phoneOpen = !!opened; this.apply(); }
    live() { return !!this.lastSample && Date.now() - this.lastSample < 30000; }
    parked() { return this.live() && this.data.stage === 'P' && this.data.speed >= 0 && this.data.speed < 0.5; }
    armPanel() {
        if (this.armedUntil) { this.disarm('Stopped by user'); this.apply(); return false; }
        if (this.options.layout !== 'g80' && this.options.layout !== 'oem' && this.options.layout !== 'sixwb') {
            this.disarmReason = 'Choose a full-panel design first'; return false;
        }
        if (!this.parked()) { this.disarmReason = 'Real speed and gear P required'; return false; }
        if (!this.ready) { this.disarmReason = 'Renderer not connected'; return false; }
        this.armedUntil = Date.now() + PANEL_TEST_MS;
        this.disarmReason = 'Parked panel test: 12 seconds maximum';
        this.apply();
        return true;
    }
    disarm(reason) {
        this.armedUntil = 0;
        if (reason) this.disarmReason = reason;
        if (this.panelRef) { this.cr.drop(this.panelRef); this.panelRef = 0; }
    }
    apply() {
        const mode = MODES[this.options.layout] || 0;
        const valid = this.live();
        if (this.armedUntil && (!this.parked() || Date.now() >= this.armedUntil)) {
            this.disarm(this.parked() ? 'Test timeout — original cluster restored' : 'Left P, moving, or stale data');
        }
        const panelActive = (mode === 4 || mode === 5 || mode === 6) && this.armedUntil > Date.now() && this.parked();
        if (panelActive && !this.panelRef) {
            this.panelRef = this.cr.effect({ target: 'panel', klass: 'overlay',
                contend: true, guide_hold: false, x: 0, y: 0, w: 1920, h: 720,
                fs: mode === 6 ? sixwbShader : g80Shader });
            this.lastSent = 0;
        }
        if (!panelActive && this.panelRef) this.disarm('Original cluster restored');
        const show = mode > 0 && mode < 4 && valid;
        if (show && !this.effectRef) {
            this.effectRef = this.cr.effect({ target: 'map', klass: 'overlay',
                // NEVER evict the BMW stock map merely to show coloured dials.
                // Waze may hold the map slot; otherwise the OEM map wins.
                contend: false, guide_hold: false, x: 0, y: 0, w: 1088, h: 480,
                fs: fragmentShader });
        }
        if (!show && this.effectRef) { this.cr.drop(this.effectRef); this.effectRef = 0; }
        if (panelActive && this.panelRef && Date.now() - this.lastSent >= 150) {
            const d = this.data;
            this.cr.uniform(this.panelRef, 'u_values', [d.speed, d.rpm, finite(d.oil) ? d.oil : -1,
                finite(d.coolant) ? d.coolant : -1]);
            const sixwbMode = { comfort: 0, sport: 1, eco: 2 }[this.options.sixwbTheme] || 0;
            this.cr.uniform(this.panelRef, 'u_options', [1,
                finite(d.gear) ? d.gear : 0, this.options.phoneBadge && this.phoneOpen ? 1 : 0,
                mode === 6 ? sixwbMode : mode === 5 ? 1 : 0]);
            this.cr.uniform(this.panelRef, 'u_accent', mode === 6 ? resolve6WBColor(this.options, Date.now())
                : resolveColor(this.options, Date.now()));
            this.lastSent = Date.now();
        }
        if (show && this.effectRef && Date.now() - this.lastSent >= 150) {
            const d = this.data;
            this.cr.uniform(this.effectRef, 'u_values', [d.speed, d.rpm, finite(d.oil) ? d.oil : -1,
                finite(d.coolant) ? d.coolant : -1]);
            this.cr.uniform(this.effectRef, 'u_style', [mode, 1, 0, 0]);
            this.cr.uniform(this.effectRef, 'u_accent', resolveColor(this.options, Date.now()));
            this.lastSent = Date.now();
        }
        const wantBadge = this.options.phoneBadge && this.phoneOpen && !panelActive;
        if (wantBadge && !this.badgeRef) {
            // No contend: a stock layout does NOT seize the centre-slot from BMW.
            // When Waze has that slot, this floats over it (same compositor).
            this.badgeRef = this.cr.effect({ target: 'map', klass: 'overlay',
                contend: false, x: 992, y: 9, w: 74, h: 74, fs: BADGE_FS });
        }
        if (!wantBadge && this.badgeRef) { this.cr.drop(this.badgeRef); this.badgeRef = 0; }
    }
    status() {
        return { ready: this.ready, layer: this.layerState, target: this.targetState,
            live: this.live(), layout: this.options.layout, parked: this.parked(),
            panelActive: !!this.panelRef, disarmReason: this.disarmReason,
            secondsLeft: this.panelRef ? Math.max(0, Math.ceil((this.armedUntil - Date.now()) / 1000)) : 0,
            color: colorHex(this.options.layout === 'sixwb' ? resolve6WBColor(this.options, Date.now())
                : resolveColor(this.options, Date.now())) };
    }
    close() { this.disarm('App closed'); this.cr.close(); }
}
module.exports = { ClusterLayers, MODES, COLORS, PANEL_TEST_MS };
