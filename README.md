# Skii

A remake of the classic Windows 95 ski game. Ski down an endless mountain, dodge trees, rocks and stumps,
hit ramps and spin for trick points, ride past an endless chairlift, and try not to get eaten past 1000 m.
Make the local top ten and you enter your initials, arcade style.

Web first (HTML5 canvas, no framework), built so it can be wrapped for mobile later.

## Run it

```
npm install
npm run dev
```

Open http://localhost:5173. The dev server also listens on your LAN, so you can open the printed
`Network` URL on a phone to test touch controls.

```
npm run build     # production bundle in dist/
npm run preview   # serve the production bundle
```

## Multiplayer races

Press **Multiplayer**, create a race and send friends the link (`?room=ABCD`) or the 4-letter code.

- The race starts 10 s after the second player joins; every new arrival resets the countdown.
- Everyone skis the same mountain (shared seed). Other players appear as green skiers with their initials.
- Each time the leader passes 1000, 2000, 3000 m… the yeti eats whoever is furthest behind,
  until everyone is eaten. The winner is whoever had the most points when they were eaten.
- Joining mid-race lets you watch; you're in the next race automatically.

Locally, run the race server next to Vite (Vite proxies `/api/race` to it):

```
npm run dev:server   # ws://localhost:8787, in-memory rooms
npm run dev
npm test             # room rule unit tests
```

In production `api/race.ts` is a Vercel Function serving WebSockets. Rooms live in Redis (`REDIS_URL`,
from a Marketplace Redis database connected to the project) so players on different function instances
share a room; without it the function falls back to in-memory rooms, which only works while everyone
lands on the same instance.

## Controls

| Action                | Keyboard                | Mouse                              | Touch                                     |
| --------------------- | ----------------------- | ---------------------------------- | ----------------------------------------- |
| Turn                  | ← → or A D              | skier heads toward the pointer     | hold a finger beside the skier, or ◀ ▶    |
| Straight down         | ↓ or S                  | pointer directly below the skier   | ▼                                         |
| Stop                  | turn fully sideways     | pointer above the skier            | finger above the skier                    |
| Jump / flip in air    | Space or ↑              | left click                         | JUMP                                      |
| Spin in air (hold)    | ← → or A D              |                                    | hold ◀ ▶ or a finger beside the skier     |
| Fast mode (toggle)    | F or Shift              |                                    | FAST                                      |
| Pause                 | P or Esc                | menu bar                           | menu bar                                  |
| Restart               | R                       | menu bar                           | menu bar                                  |

## How it works

- `src/game.ts` – game state, physics, collisions, tricks (spins, flips, bails), the Yeti, and rendering to a
  low-res canvas. Score = metres + trick points.
- `src/world.ts` – infinite deterministic obstacle field. Each 128 px chunk is generated from a seeded RNG,
  so the mountain is endless in every direction and never stored in full.
- `src/sprites.ts` – cuts sprites out of `Assets/Tilemap/tilemap_packed.png` (16×16 tiles, 12 per row),
  trims them and caches them as canvases. Tile indices live in the `T` table at the top. Skis are drawn
  procedurally so they rotate with the heading.
- `src/input.ts` – keyboard, mouse and touch collapsed into one intent struct read each frame.
- `src/lift.ts` – the endless chairlift: poles are solid obstacles from `world.ts`; cables, crossbars and
  wagons are drawn overhead, positioned purely from time so the line never needs storing.
- `src/highscores.ts` / `src/scores.ts` – initials entry and top-ten board (canvas), saved in `localStorage`.
- `src/font.ts` – text drawn with the Kenney letter tiles.
- `server/room.ts` – race rules (countdown, yeti eliminations, results) over a small storage interface;
  `server/redis-store.ts` for production, `server/memory-store.ts` for dev/tests, `server/handler.ts` for the
  WebSocket wiring, `api/race.ts` as the Vercel Function entry.
- `src/race.ts` / `src/net/` – client side of a race: room snapshot, interpolated ghosts, reconnecting socket.
- `src/main.ts` – bootstrap, integer-scaled resolution, HUD and overlay panels.

The canvas renders at a low logical resolution and is scaled up by an integer factor with
`image-rendering: pixelated`, which gives the chunky look without any asset pipeline.

## Credits

Art: [Tiny Ski](https://kenney.nl/assets/tiny-ski) by Kenney, CC0 (see `Assets/License.txt`).

## Mobile later

The game already handles touch, `viewport-fit=cover` and safe-area insets. For store builds the plan is
to wrap the production bundle with Capacitor (`npx cap add ios` / `android`) and point it at `dist/`.
No gameplay code needs to change.
