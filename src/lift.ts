// An endless chairlift running down the mountain beside the start lane. Poles are ordinary solid
// obstacles (see World.gen); the cables, crossbars and wagons hang overhead and are drawn on top of
// everything else. Wagon positions are a pure function of time, so the line never needs storing.

import type { SpriteSet } from './sprites.ts';

export const LIFT_X = 110;          // world x of the pole line
export const POLE_SPACING = 160;    // world px between poles
const POLE_HEIGHT = 48;             // pole top sits this far above its base
const LANE_OFFSET = 16;             // cable centres at LIFT_X ± this
const WAGON_SPACING = 72;
const WAGON_SPEED = 28;             // px/s; the left lane rides up, the right lane comes down

function hash(k: number, lane: number): number {
  let h = Math.imul(k ^ (lane * 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Draw the overhead part of the lift for the view whose top-left is world (cx, cy). */
export function renderLift(
  ctx: CanvasRenderingContext2D, sp: SpriteSet, cx: number, cy: number, W: number, H: number, t: number,
): void {
  const lx = Math.round(LIFT_X - cx);
  if (lx < -LANE_OFFSET - 32 || lx > W + LANE_OFFSET + 32) return;

  // Cables: the rotated cable tile repeated down both lanes, locked to the world grid.
  const cable = sp.liftCable;
  const startY = Math.floor(cy / cable.h) * cable.h;
  for (let wy = startY; wy < cy + H; wy += cable.h) {
    const y = Math.round(wy - cy);
    ctx.drawImage(cable.img, lx - LANE_OFFSET - 8, y);
    ctx.drawImage(cable.img, lx + LANE_OFFSET - 8, y);
  }

  // Crossbars on top of each pole (the poles themselves are drawn with the other obstacles).
  const firstPole = Math.floor(cy / POLE_SPACING) * POLE_SPACING;
  for (let py = firstPole; py < cy + H + POLE_HEIGHT; py += POLE_SPACING) {
    const y = Math.round(py - POLE_HEIGHT - cy);
    ctx.drawImage(sp.liftCrossbar.img, lx - 24, y);
    ctx.drawImage(sp.liftTop.img, lx - 8, y);
    ctx.drawImage(sp.liftCrossbar.img, lx + 8, y);
  }

  // Wagons: lane 0 rides up (y decreases), lane 1 comes down.
  for (const lane of [0, 1]) {
    const dir = lane === 0 ? -1 : 1;
    const shift = dir * t * WAGON_SPEED + lane * (WAGON_SPACING / 2);
    const k0 = Math.floor((cy - 40 - shift) / WAGON_SPACING);
    const k1 = Math.ceil((cy + H - shift) / WAGON_SPACING);
    const laneX = lx + (lane === 0 ? -LANE_OFFSET : LANE_OFFSET);
    for (let k = k0; k <= k1; k++) {
      const wy = k * WAGON_SPACING + shift;
      const spr = hash(k, lane) % 3 === 0 ? sp.gondola : sp.chair;
      const sway = Math.round(Math.sin(t * 2 + k * 1.7));
      ctx.drawImage(spr.img, laneX - (spr.w >> 1) + sway, Math.round(wy - cy));
    }
  }
}
