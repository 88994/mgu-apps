'use strict';
/*
 * Intentionally tiny GLSL ES 1.00 effect. It only covers a 260x110 rectangle
 * on the far left of the panel, outside the native 1088x480 map aperture.
 * The test proves whether a small layer can be drawn; it does NOT prove that
 * a full instrument display, the native map, or warning lamps work.
 */
module.exports = `#version 100
precision mediump float;
varying vec2 v_uv;
uniform vec4 u_accent;
void main() {
    vec2 p = v_uv;
    float edge = step(0.04, p.x) * step(0.06, p.y) *
                 step(p.x, 0.96) * step(p.y, 0.94);
    float bar = step(0.23, p.x) * step(p.x, 0.77) *
                step(0.24, p.y) * step(p.y, 0.76);
    vec3 c = mix(vec3(0.98, 0.98, 0.98), u_accent.rgb, bar);
    gl_FragColor = vec4(c, edge);
}`;
