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

All three play options support Free-for-all and Team Deathmatch. They share hitscan, headshot bonuses, streak tracking, brief spawn protection, and delayed health regeneration. Vs AI runs locally with five bots. Its optional aim practice difficulty disables bot movement and fire.

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


## Play options

- **Public Online** starts Quick Play. New guests join a live public match with room when one is available. A new match starts with bots immediately when a seat is unavailable. Public rounds are three minutes at regular difficulty. Free-for-all and 4v4 Team Deathmatch use separate matchmaking pools.
- **Vs AI** runs offline. Choose your starting arena, round length, and bot difficulty before playing.
- **Custom Rooms** uses an eight-character invite code or link. The creator chooses the starting arena and can expand **Customize room** to set the game rules, round length, slots, bot count and difficulty, kill limit, and respawn delay. Team Deathmatch also offers friendly fire and Humans vs Bots.

Public rooms hold eight players including bots. Custom rooms have two to eight total slots, with an even cap in Team Deathmatch. Humans take priority over bots. A dropped connection has a 15-second grace period. Quick Play tries to reconnect you to your assigned match before looking for a new one.

Every mode shows standings, lets you vote on the next map, and lets you pick your next primary. Public Online and Vs AI start the next round automatically after a 15-second vote. Custom Rooms wait for the host to select **Start Next Match**. Players can join, leave, and vote during the untimed break. If nobody votes, the arenas rotate. Online ties are randomized among the leaders.

In Team Deathmatch, an enemy elimination adds one to the team's score. The highest team score wins when time expires, or a team can win early by reaching the kill limit. Public TDM and Vs AI default to 30 kills with friendly fire off. Vs AI plays 3v3. In mixed custom TDM, players can request a team for the next round, subject to available space. Humans vs Bots puts players on Blue and bots on Red.

Custom hosts can open **Esc → Host controls** during play or open the same controls on the results screen. On the results screen, use **Save Next Match Rules** to save changes while everyone waits, or apply the form directly with **Start Next Match**. The map vote closes when the host starts. Everyone keeps the same room and invite. The server rejects a new cap that would displace a connected or reconnecting player. Set bots to **0** for human-only matches, **Fill open slots** for automatic backfill, or a fixed maximum. Choose one skill for the room, random skills, or overrides for named bots.

Run `npm install` then `npm run dev` for the full local Worker and matchmaking service. Open the printed localhost URL.

Cloudflare Worker deployment: `npm run deploy`. The Worker serves the same game and owns a SQLite-backed Durable Object namespace for room configuration. Gameplay runs at 120 Hz with snapshots at 30 Hz. Clients predict movement using the shared core and reconcile acknowledged inputs; the server controls health, collision, weapon cadence, ammunition, respawns, bots and standings. Hit tests use up to 200 ms of target history, based on server-measured round-trip time, while retaining present-life and spawn-shield checks. Names fade with distance and require line of sight near the crosshair. Opening the online pause menu does not pause the shared match. Host rights transfer when their disconnected slot expires. Live scores and votes are held in memory. A service restart reconnects clients and resets active matches. A custom room that was already waiting for its host resumes that intermission with its saved rules.

The existing Cloudflare Pages frontend connects to `witty-warfare-online.ejwit004.workers.dev`. Production CORS allows only the Worker itself and `https://witty-warfare.pages.dev`. Invite codes are unlisted room links, not authenticated accounts. Accounts, friends, additional game rules, and controller support belong to later releases.

`server/match.js` is the testable shared-room simulation; `server.js` handles Worker routing, WebSocket sessions and room clocks. `server/quick-play.js` assigns guests to public rooms. `dist/network.js` handles input batches and reconnects. `npm test` includes multiplayer simulation regressions. With the local dev server running, `node tests/rooms.integration.mjs` checks real multi-client WebSockets. Run `node tests/quick-play.integration.mjs` against an empty local server to check concurrent public matchmaking, bot backfill, room isolation, and a complete public round. Set `ROOM_TEST_SKIP_ROUND=1` to run only the matchmaking checks.


## Staying in the room

Press Esc during a match to choose any of the six primaries. The choice applies on the next respawn, or use Respawn with [weapon] to equip immediately at the cost of one death. Scores and room identity remain intact. A pistol and knife are included after every change. The results screen also allows choosing the next round's primary while voting for a map. Room codes and invite links remain the same across all rounds.

Use `node tests/tdm.integration.mjs` to verify the separate public queues, custom permissions, and queued room changes through a complete round.

To exercise the complete two-player loop on a running server, use `node tests/room-round.integration.mjs` (takes one two-minute round). It checks queued and immediate loadouts, changed votes, a host-started map change, the same room/WebSockets, and loadouts retained into the next round.
