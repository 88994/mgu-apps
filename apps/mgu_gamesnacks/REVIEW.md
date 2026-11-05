# Original GameSnacks offline-port review — 2026-11-05

No reviewed game has a confirmed redistribution grant for the public project.
No site assets, logos, executable game code or copyrighted game art are included.

| Original | GameSnacks URL | Rights / source | Offline rights | Technical compatibility |
| --- | --- | --- | --- | --- |
| Smarty Bubbles | https://gamesnacks.com/games/smartybubbles | Famobi: https://famobi.com/smarty-bubbles/?locale=en | Famobi offers licenses; permission for a local BMW app and public distribution not acquired | HTML5 title; original package and BMW browser runtime not tested |
| Train 2048 | https://gamesnacks.com/games/train2048 | Famobi: https://famobi.com/train-2048/?locale=en | Famobi offers licenses; permission not acquired | HTML5 title; original package and BMW browser runtime not tested |
| Om Nom Run | https://gamesnacks.com/games/omnomrun | ZeptoLab: https://www.zeptolab.com/games/om-nom-run | Separate holder permission required; not acquired | GameSnacks HTML5 edition not available as a licensed offline package; complex original game not benchmarked |
| BlockDrop | https://gamesnacks.com/games/51vi4vae20f8o | GameSnacks listing; holder not verified | No public offline license established | HTML5 listing; exact assets, dependencies and engine not examined |
| Classic Solitaire | https://gamesnacks.com/games/6uj90l2koon6g | GameSnacks listing; edition and holder not verified | No public offline license established | HTML5 listing; exact assets, dependencies and engine not examined |

## Sources / what they prove

- Google's Partner API: https://developers.google.com/gamesnacks/partner/api/rest — exposes **hosted** games to approved distribution partners, not download permission.
- Google's game.json: https://developers.google.com/gamesnacks/developer/config — `allowOfflineUse` lets a publisher make a game discoverable offline on partner surfaces, without guaranteeing a third-party game bundle download.
- Google's requirements: https://developers.google.com/gamesnacks/developer/requirements — HTML entrypoint, Canvas/WebGL, browser dependencies and bundle limits.
- Famobi licensing: https://famobi.com/license-html5-games/onboard-entertainment/?locale=en — Famobi says its HTML5 games can be uploaded to the licensee's own server. It also sells licenses; it does **not** publish these titles with free redistributable source.
- Famobi shop FAQ: https://html5games-shop.portals.famobi.com/faq — games use frameworks including Phaser, Haxe and Construct; standard web/app embed and local hosting options have distinct licensing constraints.
- ZeptoLab's Om Nom Run page: https://www.zeptolab.com/games/om-nom-run — first-party product information and IP attribution.

## Release gate for *each* game

1. Verify exact developer/publisher for the GameSnacks edition, not a similarly named clone.
2. Obtain explicit rights to copy the game files offline, adapt them for BMW controls and distribute the result in the intended repository/store model (including sublicensing, if required).
3. Receive a complete authorized archive (`index.html`, scripts, sprites, fonts, sounds, configuration) and inspect external network dependencies.
4. Identify its browser engine requirements (DOM, Canvas 2D/WebGL, WebAudio, storage) and test a local HTML renderer on the MGU. Node 8 plus `mgu-renderd` alone is not sufficient.
5. Verify offline cold start, state saves, input, 30+ fps where practical, memory and CPU budget, audio, and immediate pause on vehicle movement.
6. Record the authorization and version in a per-game provenance manifest before shipping the package.

**Decision:** None of the five may currently be packaged as an "original offline game" in the public GitHub repository. Famobi is the most concrete licensing lead. No purchases or external contacts were made.
