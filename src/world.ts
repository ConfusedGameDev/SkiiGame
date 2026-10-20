// Infinite, deterministic obstacle field generated per chunk from a seeded RNG.

import { LIFT_X, POLE_SPACING } from './lift.ts';

export type ObstacleKind =
  'treeS' | 'treeL' | 'treeD' | 'rock' | 'stump' | 'snowman' | 'flag' | 'mogul' | 'ramp' | 'rampL' | 'pole';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number; // world x, centre
  y: number; // world y, base (feet)
}

export const CHUNK = 128;
export const PX_PER_M = 8;

/** Hitbox relative to (x, y): [half width, height above base]. */
export const HITBOX: Record<ObstacleKind, [number, number]> = {
  treeS: [3, 5],
  treeL: [4, 7],
  treeD: [3, 6],
  rock: [6, 6],
  stump: [6, 6],
  snowman: [5, 6],
  flag: [4, 4],
  mogul: [4, 3],
  ramp: [8, 6],
  rampL: [15, 6],
  pole: [3, 4],
};

export const SOLID: Record<ObstacleKind, boolean> = {
  treeS: true, treeL: true, treeD: true, rock: true, stump: true, snowman: true, flag: true,
  mogul: false, ramp: false, rampL: false, pole: true,
};

/** Minimum airborne height needed to clear this obstacle. Infinity = never. */
export const CLEAR_HEIGHT: Record<ObstacleKind, number> = {
  treeS: 16, treeL: Infinity, treeD: 24, rock: 8, stump: 8, snowman: 16, flag: 16, mogul: 3, ramp: 4,
  rampL: 4, pole: Infinity,
};

function hash32(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: [ObstacleKind, number][] = [
  ['treeS', 26], ['treeL', 20], ['treeD', 6], ['rock', 12], ['stump', 8], ['snowman', 4], ['flag', 6],
  ['mogul', 12], ['ramp', 10], ['rampL', 5],
];
const KIND_TOTAL = KINDS.reduce((s, k) => s + k[1], 0);

function pickKind(r: number): ObstacleKind {
  let v = r * KIND_TOTAL;
  for (const [kind, w] of KINDS) {
    v -= w;
    if (v <= 0) return kind;
  }
  return 'treeS';
}

export class World {
  private chunks = new Map<string, Obstacle[]>();
  private nextId = 1;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  private gen(cx: number, cy: number): Obstacle[] {
    const rng = mulberry32(hash32(cx, cy, this.seed));
    const list: Obstacle[] = [];
    // Lift poles run the whole height of the mountain, above the start line too.
    if (cx * CHUNK <= LIFT_X && LIFT_X < (cx + 1) * CHUNK) {
      for (let y = Math.ceil((cy * CHUNK) / POLE_SPACING) * POLE_SPACING; y < (cy + 1) * CHUNK; y += POLE_SPACING) {
        list.push({ id: this.nextId++, kind: 'pole', x: LIFT_X, y });
      }
    }
    const depthM = (cy * CHUNK) / PX_PER_M;
    // Above the start line: nothing. Density climbs gently with distance.
    if (cy < -1) return list;
    const base = 1.4 + Math.min(3.0, depthM / 1500);
    const n = Math.floor(rng() * 2.5 + base);
    for (let i = 0; i < n; i++) {
      const x = cx * CHUNK + rng() * CHUNK;
      const y = cy * CHUNK + rng() * CHUNK;
      // Keep a clear lane at the very start.
      if (y < 160 && Math.abs(x) < 70) continue;
      // And keep the lift's pole line free.
      if (Math.abs(x - LIFT_X) < 14) continue;
      list.push({ id: this.nextId++, kind: pickKind(rng()), x, y });
    }
    return list;
  }

  private chunk(cx: number, cy: number): Obstacle[] {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (!c) {
      c = this.gen(cx, cy);
      this.chunks.set(key, c);
    }
    return c;
  }

  /** All obstacles overlapping the world rectangle. */
  query(x0: number, y0: number, x1: number, y1: number): Obstacle[] {
    const out: Obstacle[] = [];
    const cx0 = Math.floor(x0 / CHUNK), cx1 = Math.floor(x1 / CHUNK);
    const cy0 = Math.floor(y0 / CHUNK), cy1 = Math.floor(y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const o of this.chunk(cx, cy)) {
          if (o.x >= x0 - 16 && o.x <= x1 + 16 && o.y >= y0 - 8 && o.y <= y1 + 32) out.push(o);
        }
      }
    }
    return out;
  }

  /** Drop chunks far from the camera so memory stays flat on long runs. */
  prune(camX: number, camY: number): void {
    if (this.chunks.size < 400) return;
    const ccx = Math.floor(camX / CHUNK), ccy = Math.floor(camY / CHUNK);
    for (const key of this.chunks.keys()) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - ccx) > 8 || Math.abs(cy - ccy) > 8) this.chunks.delete(key);
    }
  }
}
