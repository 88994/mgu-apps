'use strict';

// Grounded research candidates, not bundled games. No title has an offline
// distribution grant for this open-source MGU project as of 2026-11-05.
const CANDIDATES = [
    {
        id: 'smarty-bubbles', title: 'Smarty Bubbles', developer: 'Famobi', genre: 'Puzzle',
        license: 'Vendor offers licenses; no grant for this app',
        bundle: 'No authorized offline package', browser: 'Canvas/HTML5; MGU not verified',
        source: 'https://famobi.com/smarty-bubbles/?locale=en',
    },
    {
        id: 'train-2048', title: 'Train 2048', developer: 'Famobi', genre: 'Puzzle',
        license: 'Vendor offers licenses; no grant for this app',
        bundle: 'No authorized offline package', browser: 'HTML5; MGU not verified',
        source: 'https://famobi.com/train-2048/?locale=en',
    },
    {
        id: 'om-nom-run', title: 'Om Nom Run', developer: 'ZeptoLab', genre: 'Arcade',
        license: 'Permission not established',
        bundle: 'No authorized offline package', browser: 'HTML5 GameSnacks version; MGU not verified',
        source: 'https://www.zeptolab.com/games/om-nom-run',
    },
    {
        id: 'blockdrop', title: 'BlockDrop', developer: 'Unverified', genre: 'Puzzle',
        license: 'Rights holder and permission not established',
        bundle: 'No authorized offline package', browser: 'HTML5; MGU not verified',
        source: 'https://gamesnacks.com/games/51vi4vae20f8o',
    },
    {
        id: 'classic-solitaire', title: 'Classic Solitaire', developer: 'Unverified', genre: 'Cards',
        license: 'Exact GameSnacks edition and permission not established',
        bundle: 'No authorized offline package', browser: 'HTML5; MGU not verified',
        source: 'https://gamesnacks.com/games/6uj90l2koon6g',
    },
];

// A game may only become playable once each gate is positively established.
function playable(game) {
    return game && game.licenseCleared === true && game.bundleVerified === true &&
        game.rendererVerified === true && typeof game.launch === 'function';
}

module.exports = {CANDIDATES, playable};
