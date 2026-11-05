'use strict';

// Reusable, renderer-independent pointer coordinates for future licensed
// HTML5 games. The MGU GPU renderer supplies touch phases in logical pixels.
const PHASES = {1: 'down', 2: 'move', 3: 'up'};

function normalizeTouch(phase, x, y, rect) {
    if (!PHASES[phase] || !isFinite(x) || !isFinite(y) || !rect ||
        !isFinite(rect.x) || !isFinite(rect.y) ||
        !(rect.w > 0) || !(rect.h > 0)) return null;
    if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) return null;
    return {phase: PHASES[phase], x: (x - rect.x) / rect.w, y: (y - rect.y) / rect.h};
}

module.exports = {normalizeTouch};
