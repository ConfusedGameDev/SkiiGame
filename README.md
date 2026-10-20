# Skii

A remake of the classic Windows 95 ski game. Ski down an endless mountain, dodge trees, rocks and stumps,
hit ramps and spin for trick points, ride past an endless chairlift, and try not to get eaten past 2000 m.
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
- `src/main.ts` – bootstrap, integer-scaled resolution, HUD and overlay panels.

The canvas renders at a low logical resolution and is scaled up by an integer factor with
`image-rendering: pixelated`, which gives the chunky look without any asset pipeline.

## Credits

Art: [Tiny Ski](https://kenney.nl/assets/tiny-ski) by Kenney, CC0 (see `Assets/License.txt`).

## Mobile later

The game already handles touch, `viewport-fit=cover` and safe-area insets. For store builds the plan is
to wrap the production bundle with Capacitor (`npx cap add ios` / `android`) and point it at `dist/`.
No gameplay code needs to change.
