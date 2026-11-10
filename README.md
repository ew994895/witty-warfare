# Witty Warfare

A Witty Games original, by WiT Web Co.

Original desktop browser arena FPS. Static Three.js app, bundled locally; no build step or paid services. Google Fonts is optional and falls back to installed fonts.

## Run and check

- Preview: `python3 -m http.server 8765 --directory dist`
- Regression checks: `npm test`
- Syntax checks: `npm run check`

## Gameplay

WASD moves; hold Space for bunny hops; tap Shift before landing for slide boosts. Releasing Shift primes the next boost. Right mouse aims, left mouse fires, R reloads, 1 selects the primary, 2/E selects the pistol, 3/Q selects the knife, Tab shows standings, Esc pauses. T toggles ADS, F is an alternate fire key, and arrow keys provide an alternate look control. Pause settings persist mouse sensitivity, ADS multiplier, FOV, and volume locally.

Normal browsers use Pointer Lock. Embedded browsers that reject it use relative cursor movement plus continuous horizontal turning near the screen edges. M retries pointer lock. Fullscreen is available when supported by the browser.

The match is local free-for-all against five bots, with actual hitscan, headshot bonuses, streak tracking, safe spawns, brief spawn protection, and delayed health regeneration. Practice mode disables bot movement and fire. No online multiplayer or accounts are implemented.

## Source layout

- `dist/core.js`: deterministic movement, collision, weapons, ray hit tests, and bot route search.
- `dist/game.js`: scene, input, audio, viewmodel, AI, match lifecycle, and HUD.
- `tests/core.test.mjs`: movement/collision/weapon/hitscan/navigation regressions.

World simulation runs at 120 Hz. Input pose is used for shots, weapon rendering uses a separate camera, and each weapon keeps its own magazine. Bots acquire opponents, navigate the arena grid, and shoot rays subject to the same world cover and actor hit volumes.

## Loadouts

Choose one of six primaries: Ranger assault rifle, Longshot sniper, Breacher shotgun, Viper SMG, Relay three-round burst rifle, or Titan 60-round machine gun. Each kit includes the semi-automatic Sidekick pistol and the Edge knife. Pistol shots require a fresh click; Relay completes a three-round burst after a click and requires another click for the next burst. Knife swings have a 2.2-unit reach, respect cover, and deal 65 damage without using ammunition.

Each slot keeps its magazine and cooldown. Switching cancels reloads and unfinished bursts; respawning restores the chosen primary kit. The knife offers slightly faster movement, while the Titan has heavier handling.

## Arenas

The lobby map selector previews the chosen arena live and remembers the selection locally. Matches, practice, replay, spawn selection, scoreboard labels and results all use that arena.

- Switchyard (small, 36 × 36): container lanes and a quick outer loop.
- Dust Court (medium, 58 × 58): the original courtyard with mixed ranges.
- Pine Ridge (large, 84 × 84): mountain outpost, long lanes, firing pads and covered flanks.

`dist/maps.js` supplies shared box geometry, collision volumes, spawn locations, practice positions, lighting, and navigation bounds. Changing maps disposes old scene geometry and sign textures, rebuilds navigation, and resets preview actors. `tests/maps.test.mjs` checks spawn clearance, all spawn-to-spawn routes, wall collisions, practice sightlines, large-map routing, and isolation between builds.


## Private multiplayer (first online release)

Run `npm install` then `npm run dev` for the full local Worker and room service. Open the printed localhost URL. Create a room, or paste an eight-character room code and join. The chosen arena, duration and bot difficulty become the room settings. Seven bots initially fill the remaining slots. Humans replace bots, and disconnected players have a 15-second reconnect grace period before a bot fills their slot. Each browser tab has its own guest session.

Cloudflare Worker deployment: `npm run deploy`. The Worker serves the same game and owns a SQLite-backed Durable Object namespace for room configuration. Gameplay runs at 120 Hz with snapshots at 30 Hz. Clients predict movement using the shared core and reconcile acknowledged inputs; the server controls health, collision, weapon cadence, ammunition, respawns, bots and standings. Names fade with distance and require line of sight near the crosshair. Opening the online pause menu does not pause the shared match. The host can start the next match from results; host rights transfer when their disconnected slot expires. Live round state is held in memory, so a service deployment/restart resets affected rounds and reconnects clients.

The existing Cloudflare Pages frontend connects to `witty-warfare-online.ejwit004.workers.dev`. Production CORS allows only the Worker itself and `https://witty-warfare.pages.dev`. Invite codes are unlisted room links, not authenticated accounts. Public matchmaking, accounts/friends, additional modes and controller support belong to later releases.

`server/match.js` is the testable shared-room simulation; `server.js` handles Worker routing, WebSocket sessions and room clocks. `dist/network.js` handles input batches and reconnects. `npm test` includes multiplayer simulation regressions. With the local dev server running, `node tests/rooms.integration.mjs` checks real multi-client WebSockets. Set `ROOM_TEST_ORIGIN` to test a deployed Worker.
