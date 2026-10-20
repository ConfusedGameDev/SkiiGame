// Sprites cut from Kenney's "Tiny Ski" tilesheet (CC0, www.kenney.nl), trimmed and cached as canvases.

import sheetUrl from '../Assets/Tilemap/tilemap_packed.png';

const TILE = 16;
const COLS = 12;

/** Tile indices in the packed sheet (row * 12 + col). */
const T = {
  snow: 0,
  snowSpeckle: 5,
  treeTop: 6,
  treeBottom: 18,
  deadTop: 7,
  deadBottom: 19,
  treeSmall: 30,
  stump: 47,
  rock: 81,
  mogul: 95,
  ramp: 36,
  rampBigL: 62,
  rampBigR: 63,
  liftTop: 42,
  liftPole: 54,
  liftBase: 66,
  cable: 46,
  gondolaTL: 55,
  gondolaTR: 56,
  gondolaBL: 67,
  gondolaBR: 68,
  chair: 57,
  snowman: 69,
  flagRed: 20,
  flagBlue: 21,
  yetiA: 78,
  yetiB: 79,
  yetiRoar: 80,
  skier: 82,
  skierPoles: 83,
  rival: 70,          // the green skier: other players in a race
  rivalPoles: 71,
} as const;

/** Colours taken from the sheet so procedural bits (skis, tracks, shadows) match the art. */
export const COLORS = {
  snow: '#eef8fe',
  track: '#b7d2eb',
  shadow: '#cfe7f7',
  outline: '#3f2631',
  fire: ['#fff6a0', '#ffc23a', '#ff7a1a', '#d8321e'],   // flame colour by age, hot to cooling
} as const;

export interface Sprite {
  img: HTMLCanvasElement;
  w: number;
  h: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

type Transform = 'none' | 'flipY' | 'rot90';

/** Compose a grid of tiles (rows top to bottom) into one sprite, then trim transparent edges. */
function cut(sheet: HTMLImageElement, grid: number[][], transform: Transform = 'none', doTrim = true): Sprite {
  const w = TILE * grid[0].length, h = TILE * grid.length;
  const c = document.createElement('canvas');
  c.width = transform === 'rot90' ? h : w;
  c.height = transform === 'rot90' ? w : h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (transform === 'flipY') { ctx.translate(0, h); ctx.scale(1, -1); }
  if (transform === 'rot90') { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
  grid.forEach((row, r) => row.forEach((t, col) => {
    ctx.drawImage(sheet, (t % COLS) * TILE, Math.floor(t / COLS) * TILE, TILE, TILE, col * TILE, r * TILE, TILE, TILE);
  }));
  return doTrim ? trim(c) : { img: c, w: c.width, h: c.height };
}

/** Font tiles: digits, ':' and a snowball, then A-Z, then symbols. */
const GLYPH_ORDER = '0123456789:o' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '!#$%+-x/=.';
const GLYPH_FIRST = 84;

function glyphs(sheet: HTMLImageElement): Map<string, Sprite> {
  const m = new Map<string, Sprite>();
  [...GLYPH_ORDER].forEach((ch, i) => m.set(ch, cut(sheet, [[GLYPH_FIRST + i]], 'none', false)));
  return m;
}

function trim(src: HTMLCanvasElement): Sprite {
  const { width: w, height: h } = src;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { img: src, w, h };
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  if (tw === w && th === h) return { img: src, w, h };
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  c.getContext('2d')!.drawImage(src, x0, y0, tw, th, 0, 0, tw, th);
  return { img: c, w: tw, h: th };
}

/** A ground texture of plain and speckled snow tiles, tiled across the screen with a world offset. */
function ground(sheet: HTMLImageElement, tilesAcross: number): Sprite {
  const size = TILE * tilesAcross;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let ty = 0; ty < tilesAcross; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const t = rnd() < 0.18 ? T.snowSpeckle : T.snow;
      ctx.drawImage(sheet, (t % COLS) * TILE, Math.floor(t / COLS) * TILE, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  return { img: c, w: size, h: size };
}

export interface SpriteSet {
  ground: Sprite;
  treeS: Sprite;
  treeL: Sprite;
  treeD: Sprite;
  rock: Sprite;
  stump: Sprite;
  mogul: Sprite;
  ramp: Sprite;
  rampBig: Sprite;
  snowman: Sprite;
  flags: Sprite[];
  liftPole: Sprite;
  liftTop: Sprite;
  liftCrossbar: Sprite;
  liftCable: Sprite;
  gondola: Sprite;
  chair: Sprite;
  skier: Sprite;
  skierAir: Sprite;
  skierCrash: Sprite;
  skierFlip: Sprite;
  rival: Sprite;
  rivalAir: Sprite;
  rivalFlip: Sprite;
  rivalCrash: Sprite;
  yetiRun: Sprite[];
  yetiEat: Sprite[];
  glyphs: Map<string, Sprite>;
}

export async function loadSprites(): Promise<SpriteSet> {
  const sheet = await loadImage(sheetUrl);
  return {
    ground: ground(sheet, 16),
    treeS: cut(sheet, [[T.treeSmall]]),
    treeL: cut(sheet, [[T.treeTop], [T.treeBottom]]),
    treeD: cut(sheet, [[T.deadTop], [T.deadBottom]]),
    rock: cut(sheet, [[T.rock]]),
    stump: cut(sheet, [[T.stump]]),
    mogul: cut(sheet, [[T.mogul]]),
    ramp: cut(sheet, [[T.ramp]]),
    rampBig: cut(sheet, [[T.rampBigL, T.rampBigR]]),
    snowman: cut(sheet, [[T.snowman]]),
    flags: [cut(sheet, [[T.flagRed]]), cut(sheet, [[T.flagBlue]])],
    // Lift pieces stay untrimmed so they line up on the 16 px grid.
    liftPole: cut(sheet, [[T.liftPole], [T.liftBase]], 'none', false),
    liftTop: cut(sheet, [[T.liftTop]], 'none', false),
    liftCrossbar: cut(sheet, [[T.cable]], 'none', false),
    liftCable: cut(sheet, [[T.cable]], 'rot90', false),
    gondola: cut(sheet, [[T.gondolaTL, T.gondolaTR], [T.gondolaBL, T.gondolaBR]], 'none', false),
    chair: cut(sheet, [[T.chair]], 'none', false),
    skier: cut(sheet, [[T.skier]]),
    skierAir: cut(sheet, [[T.skierPoles]]),
    skierCrash: cut(sheet, [[T.skier]], 'rot90'),
    skierFlip: cut(sheet, [[T.skierPoles]], 'flipY'),
    rival: cut(sheet, [[T.rival]]),
    rivalAir: cut(sheet, [[T.rivalPoles]]),
    rivalFlip: cut(sheet, [[T.rivalPoles]], 'flipY'),
    rivalCrash: cut(sheet, [[T.rival]], 'rot90'),
    yetiRun: [cut(sheet, [[T.yetiA]]), cut(sheet, [[T.yetiB]])],
    yetiEat: [cut(sheet, [[T.yetiRoar]]), cut(sheet, [[T.yetiA]])],
    glyphs: glyphs(sheet),
  };
}

/** Pixel-perfect line (Bresenham) so skis stay crisp at low resolution. */
export function pixelLine(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number, color: string,
): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (let i = 0; i < 1000; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
