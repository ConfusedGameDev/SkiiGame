import { COLORS, pixelLine, type Sprite, type SpriteSet } from './sprites.ts';
import { World, HITBOX, SOLID, CLEAR_HEIGHT, PX_PER_M, type Obstacle } from './world.ts';
import { renderLift } from './lift.ts';
import { drawText } from './font.ts';
import { HighScores } from './highscores.ts';
import type { Input } from './input.ts';

// ---- Tuning ---------------------------------------------------------------
const MAX_SPEED = 120;         // logical px/s, straight down
const FAST_SPEED = 190;
const ACCEL = 2.2;             // approach rate toward target speed
const DECEL = 5.0;
const GRAVITY = 420;
const HOP_VZ = 95;
const RAMP_VZ = 150;
const RAMP_BIG_VZ = 230;
const MOGUL_VZ = 70;
const AIR_DRAW_SCALE = 0.6;    // big jumps would leave the screen, so height is drawn compressed
const FLIP_TIME = 0.55;
const FLIP_POINTS = 50;
const SPIN_RATE = 660;         // degrees per second while a steering key is held in the air
const LAND_TOLERANCE = 45;     // degrees off a whole turn that still counts as a clean landing
const COMBO_MULT = 1.5;        // spin + flip in the same jump
const CRASH_TIME = 1.1;
const YETI_DISTANCE_M = 2000;
const YETI_SPEED = 205;
const YETI_EAT_TIME = 2.2;
const HEADING_STEPS = 4;       // 0 = straight down, ±4 = sideways (stopped)
const TRACK_SPACING = 3;
const MAX_TRACKS = 700;
const POPUP_TIME = 1.1;

export type Phase = 'title' | 'playing' | 'paused' | 'entry' | 'board';

interface Track { x: number; y: number; }

interface Skier {
  x: number; y: number;
  z: number; vz: number;
  heading: number;             // -4..4
  speed: number;
  fast: boolean;
  state: 'ski' | 'crash' | 'eaten';
  stateT: number;
  flipT: number;               // >0 while flipping
  airFlips: number;            // flips completed during the current jump
  spin: number;                // degrees rotated during the current jump (signed)
  lastJumpId: number;
  ignoreId: number;             // obstacle we just crashed into; ignored until we move off it
  trackDist: number;
}

interface Yeti {
  state: 'none' | 'chase' | 'eat';
  x: number; y: number;
  t: number;
  frame: number;
}

interface Popup { lines: string[]; x: number; y: number; t: number; }

export interface Stats {
  distanceM: number;
  time: number;
  speedMs: number;
  style: number;
  score: number;
  fast: boolean;
}

/** Points for landing n whole turns: 360 = 100, 720 = 250, 1080 = 500, then +250 per turn. */
function spinPoints(n: number): number {
  if (n <= 0) return 0;
  return [0, 100, 250, 500][n] ?? 500 + 250 * (n - 3);
}

export class Game {
  phase: Phase = 'title';
  readonly sprites: SpriteSet;
  private world!: World;
  private skier!: Skier;
  private yeti!: Yeti;
  private tracks: Track[] = [];
  private popups: Popup[] = [];
  private style = 0;
  private time = 0;
  private animT = 0;           // wall clock for scenery animation; runs on every screen
  private readonly scores = new HighScores();
  private viewW = 320;
  private viewH = 240;
  onPhase: (p: Phase) => void = () => {};

  constructor(sprites: SpriteSet) {
    this.sprites = sprites;
    this.reset();
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  reset(): void {
    this.world = new World((Math.random() * 0xffffffff) >>> 0);
    this.skier = {
      x: 0, y: 0, z: 0, vz: 0, heading: 0, speed: 0, fast: false,
      state: 'ski', stateT: 0, flipT: 0, airFlips: 0, spin: 0, lastJumpId: 0, ignoreId: 0, trackDist: 0,
    };
    this.yeti = { state: 'none', x: 0, y: 0, t: 0, frame: 0 };
    this.tracks = [];
    this.popups = [];
    this.style = 0;
    this.time = 0;
  }

  start(): void {
    this.reset();
    this.setPhase('playing');
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.onPhase(p);
  }

  togglePause(): void {
    if (this.phase === 'playing') this.setPhase('paused');
    else if (this.phase === 'paused') this.setPhase('playing');
  }

  stats(): Stats {
    const distanceM = Math.max(0, this.skier.y / PX_PER_M);
    return {
      distanceM,
      time: this.time,
      speedMs: this.skier.speed / PX_PER_M,
      style: this.style,
      score: Math.floor(distanceM) + this.style,
      fast: this.skier.fast,
    };
  }

  // Screen position of the skier's feet.
  private skierScreen(): { sx: number; sy: number } {
    return { sx: Math.floor(this.viewW / 2), sy: Math.floor(this.viewH * 0.38) };
  }

  private camera(): { cx: number; cy: number } {
    const { sx, sy } = this.skierScreen();
    return { cx: this.skier.x - sx, cy: this.skier.y - sy };
  }

  // ---- Update --------------------------------------------------------------
  update(dt: number, input: Input): void {
    if (this.phase !== 'paused') this.animT += dt;

    if (this.phase === 'entry' || this.phase === 'board') {
      const r = this.scores.update(dt, input, this.viewW, this.viewH);
      if (r === 'saved') this.setPhase('board');
      else if (r === 'again') this.start();
      return;
    }

    if (input.restart) { this.start(); return; }
    if (input.pause) { this.togglePause(); }
    if (this.phase !== 'playing') return;

    this.time += dt;
    const s = this.skier;

    this.readSteering(input);

    if (s.state === 'crash') {
      s.stateT -= dt;
      s.speed = 0;
      if (s.stateT <= 0) s.state = 'ski';
    } else if (s.state === 'ski') {
      this.moveSkier(dt, input);
    }

    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < POPUP_TIME);

    this.updateYeti(dt);
    this.world.prune(s.x, s.y);
  }

  private readSteering(input: Input): void {
    const s = this.skier;
    if (s.state !== 'ski') return;
    if (input.fastToggle) s.fast = !s.fast;
    // In the air the steering keys spin the skier instead (see moveSkier).
    if (s.z > 0) return;

    if (input.turn !== 0) {
      s.heading = Math.max(-HEADING_STEPS, Math.min(HEADING_STEPS, s.heading + input.turn));
    }
    if (input.straight) s.heading = 0;

    // Pointer steering (mouse hover or held touch): head toward the pointer.
    const p = input.touch.active ? input.touch : input.mouse.active ? input.mouse : null;
    if (p) {
      const { x, y } = input.toLogical(p, 1);
      const { sx, sy } = this.skierScreen();
      const dx = x - sx, dy = y - (sy - 6);
      if (dy <= 2) {
        s.heading = dx < 0 ? -HEADING_STEPS : HEADING_STEPS;
      } else {
        const ang = Math.atan2(Math.abs(dx), dy) * (180 / Math.PI); // 0 = down, 90 = sideways
        const h = Math.min(HEADING_STEPS, Math.round(ang / (90 / HEADING_STEPS)));
        s.heading = dx < 0 ? -h : h;
      }
    }
  }

  /** -1 / 0 / +1: held steering keys or buttons, or a finger held left/right of the skier. */
  private spinInput(input: Input): number {
    const d = input.spinDir();
    if (d !== 0 || !input.touch.active) return d;
    const { x } = input.toLogical(input.touch, 1);
    const dx = x - this.skierScreen().sx;
    return Math.abs(dx) < 8 ? 0 : Math.sign(dx);
  }

  private moveSkier(dt: number, input: Input): void {
    const s = this.skier;
    const ang = (Math.abs(s.heading) / HEADING_STEPS) * (Math.PI / 2);
    const max = s.fast ? FAST_SPEED : MAX_SPEED;
    const target = s.z > 0 ? s.speed : max * Math.cos(ang);
    const rate = target > s.speed ? ACCEL : DECEL;
    s.speed += (target - s.speed) * Math.min(1, rate * dt);
    if (s.speed < 1 && target < 1) s.speed = 0;

    const vx = s.speed * Math.sin(ang) * Math.sign(s.heading);
    const vy = s.speed * Math.cos(ang);

    // Jump / flip.
    if (input.jump) {
      if (s.z <= 0 && s.speed > 20) {
        this.takeOff(HOP_VZ);
      } else if (s.z > 0 && s.flipT <= 0) {
        s.flipT = FLIP_TIME;
      }
    }
    if (s.z > 0) {
      s.spin += this.spinInput(input) * SPIN_RATE * dt;
      s.vz -= GRAVITY * dt;
      s.z += s.vz * dt;
      if (s.flipT > 0) {
        s.flipT -= dt;
        if (s.flipT <= 0) { s.flipT = 0; s.airFlips++; }
      }
      if (s.z <= 0 && !this.land()) return;
    }

    s.x += vx * dt;
    s.y += vy * dt;

    // Ski tracks.
    if (s.z <= 0 && s.speed > 0) {
      s.trackDist += s.speed * dt;
      if (s.trackDist >= TRACK_SPACING) {
        s.trackDist = 0;
        this.tracks.push({ x: s.x, y: s.y });
        if (this.tracks.length > MAX_TRACKS) this.tracks.splice(0, this.tracks.length - MAX_TRACKS);
      }
    }

    this.collide();
  }

  private takeOff(vz: number): void {
    const s = this.skier;
    if (s.z <= 0) { s.spin = 0; s.airFlips = 0; }
    s.vz = Math.max(s.vz, vz);
    s.z = Math.max(s.z, 0.01);
  }

  /** Touch down: score the jump's tricks, or bail. Returns false if the skier crashed. */
  private land(): boolean {
    const s = this.skier;
    s.z = 0; s.vz = 0;
    const turns = Math.round(Math.abs(s.spin) / 360);
    const off = Math.abs(Math.abs(s.spin) - turns * 360);
    const midFlip = s.flipT > 0;
    const flips = s.airFlips;
    s.spin = 0; s.airFlips = 0; s.flipT = 0;

    if (midFlip || off > LAND_TOLERANCE) {
      this.popup(['BAIL']);
      this.crash();
      return false;
    }
    let pts = spinPoints(turns) + flips * FLIP_POINTS;
    if (pts === 0) return true;
    if (turns > 0 && flips > 0) pts = Math.round(pts * COMBO_MULT);
    this.style += pts;
    const name = [turns > 0 ? String(turns * 360) : '', flips > 0 ? (flips > 1 ? `${flips} FLIP` : 'FLIP') : '']
      .filter(Boolean).join(' ');
    this.popup([name, `+${pts}`]);
    return true;
  }

  private popup(lines: string[]): void {
    this.popups.push({ lines, x: this.skier.x, y: this.skier.y - 24, t: 0 });
  }

  private collide(): void {
    const s = this.skier;
    const near = this.world.query(s.x - 24, s.y - 24, s.x + 24, s.y + 24);
    let stillOnIgnored = false;
    for (const o of near) {
      const [hw, hh] = HITBOX[o.kind];
      if (Math.abs(o.x - s.x) > hw + 3) continue;
      if (s.y < o.y - hh || s.y > o.y + 1) continue;
      if (o.id === s.ignoreId) { stillOnIgnored = true; continue; }
      if (s.z >= CLEAR_HEIGHT[o.kind]) continue;

      if (SOLID[o.kind]) {
        this.crash(o);
        return;
      }
      if (o.id === s.lastJumpId) continue;
      s.lastJumpId = o.id;
      if (o.kind === 'ramp' || o.kind === 'rampL') {
        const big = o.kind === 'rampL';
        this.takeOff((big ? RAMP_BIG_VZ : RAMP_VZ) + s.speed * (big ? 0.3 : 0.45));
        s.speed *= 1.05;
        this.style += big ? 20 : 10;
      } else if (o.kind === 'mogul') {
        this.takeOff(MOGUL_VZ);
      }
    }
    if (!stillOnIgnored) s.ignoreId = 0;
  }

  private crash(o?: Obstacle): void {
    const s = this.skier;
    s.ignoreId = o ? o.id : 0;
    s.state = 'crash';
    s.stateT = CRASH_TIME;
    s.z = 0; s.vz = 0; s.flipT = 0; s.spin = 0; s.airFlips = 0;
    s.speed = 0;
    s.fast = false;
  }

  private updateYeti(dt: number): void {
    const y = this.yeti, s = this.skier;
    if (y.state === 'none') {
      if (s.y / PX_PER_M >= YETI_DISTANCE_M) {
        const side = Math.random() < 0.5 ? -1 : 1;
        y.state = 'chase';
        y.x = s.x + side * (this.viewW / 2 + 24);
        y.y = s.y - this.viewH * 0.3;
        y.t = 0;
      }
      return;
    }
    y.t += dt;
    if (y.state === 'chase') {
      y.frame = Math.floor(y.t * 8) % 2;
      const dx = s.x - y.x, dy = s.y - 2 - y.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        y.state = 'eat';
        y.t = 0;
        y.x = s.x; y.y = s.y;
        s.state = 'eaten';
        s.speed = 0;
        s.z = 0;
        return;
      }
      const step = Math.min(d, YETI_SPEED * dt);
      y.x += (dx / d) * step;
      y.y += (dy / d) * step;
    } else if (y.state === 'eat') {
      y.frame = Math.floor(y.t * 4) % 2;
      if (y.t >= YETI_EAT_TIME) {
        const st = this.stats();
        this.setPhase(this.scores.begin({ score: st.score, dist: Math.floor(st.distanceM), style: st.style }));
      }
    }
  }

  // ---- Render --------------------------------------------------------------
  render(ctx: CanvasRenderingContext2D): void {
    const W = this.viewW, H = this.viewH;
    if (this.phase === 'title') { this.renderTitleBackdrop(ctx); return; }

    const { cx, cy } = this.camera();
    const s = this.skier, sp = this.sprites;
    this.drawGround(ctx, cx, cy);

    // Tracks.
    ctx.fillStyle = COLORS.track;
    for (const t of this.tracks) {
      const tx = Math.round(t.x - cx), ty = Math.round(t.y - cy);
      if (ty < -2 || ty > H + 2) continue;
      ctx.fillRect(tx - 2, ty, 1, 1);
      ctx.fillRect(tx + 2, ty, 1, 1);
    }

    // Collect drawables and sort by base y so nearer things overlap farther ones.
    type Drawable = { y: number; draw: () => void };
    const items: Drawable[] = [];

    for (const o of this.world.query(cx, cy, cx + W, cy + H)) {
      items.push({ y: o.y, draw: () => this.drawObstacle(ctx, o, cx, cy) });
    }

    items.push({ y: s.y, draw: () => this.drawSkier(ctx, cx, cy) });

    // Yeti.
    const yt = this.yeti;
    if (yt.state !== 'none') {
      items.push({
        y: yt.y + 0.5,
        draw: () => {
          const frames = yt.state === 'eat' ? sp.yetiEat : sp.yetiRun;
          const f = frames[yt.frame];
          const yx = Math.round(yt.x - cx), yy = Math.round(yt.y - cy);
          ctx.drawImage(f.img, yx - (f.w >> 1), yy - f.h + 1);
        },
      });
    }

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // Overhead: lift cables and wagons, then trick popups.
    renderLift(ctx, sp, cx, cy, W, H, this.animT);
    for (const p of this.popups) {
      if (p.t > POPUP_TIME - 0.3 && Math.floor(p.t * 12) % 2 === 0) continue;
      const px = Math.round(p.x - cx), py = Math.round(p.y - cy - p.t * 18);
      p.lines.forEach((line, i) => drawText(ctx, sp.glyphs, line, px, py - (p.lines.length - 1 - i) * 16, 'center'));
    }

    if (this.phase === 'entry' || this.phase === 'board') this.scores.render(ctx, sp.glyphs, W, H);
  }

  private drawSkier(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = this.skier, sp = this.sprites;
    const sx = Math.round(s.x - cx), sy = Math.round(s.y - cy);
    if (s.state === 'eaten') return;
    if (s.state === 'crash') {
      const c = sp.skierCrash;
      ctx.drawImage(c.img, sx - (c.w >> 1), sy - c.h + 2);
      return;
    }
    if (s.z <= 0) {
      // The sprite already shows ski tips pointing downhill; only draw rotated skis when turned.
      if (s.heading !== 0) this.drawSkis(ctx, sx, sy, s.heading);
      ctx.drawImage(sp.skier.img, sx - (sp.skier.w >> 1), sy - sp.skier.h + 2);
      return;
    }

    // Airborne: shadow on the snow, body lifted and rotated by the spin (snapped to 45°).
    ctx.fillStyle = COLORS.track;
    ctx.fillRect(sx - 5, sy - 1, 10, 2);
    const lift = Math.round(s.z * AIR_DRAW_SCALE);
    const b = s.flipT > 0 ? sp.skierFlip : sp.skierAir;
    const snap = Math.round(s.spin / 45) * 45;
    const midY = sy - lift - (b.h >> 1) + 2 - (s.flipT > 0 ? 6 : 0);
    if (snap % 360 === 0) {
      ctx.drawImage(b.img, sx - (b.w >> 1), midY - (b.h >> 1));
      return;
    }
    ctx.save();
    ctx.translate(sx, midY);
    ctx.rotate((snap * Math.PI) / 180);
    ctx.drawImage(b.img, -(b.w >> 1), -(b.h >> 1));
    ctx.restore();
  }

  private drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, cx: number, cy: number): void {
    const spr = this.spriteFor(o);
    const x = Math.round(o.x - cx) - (spr.w >> 1);
    const y = Math.round(o.y - cy) - spr.h;
    ctx.drawImage(spr.img, x, y);
  }

  private spriteFor(o: Obstacle): Sprite {
    const sp = this.sprites;
    switch (o.kind) {
      case 'treeS': return sp.treeS;
      case 'treeL': return sp.treeL;
      case 'treeD': return sp.treeD;
      case 'rock': return sp.rock;
      case 'stump': return sp.stump;
      case 'snowman': return sp.snowman;
      case 'flag': return sp.flags[o.id % sp.flags.length];
      case 'mogul': return sp.mogul;
      case 'ramp': return sp.ramp;
      case 'rampL': return sp.rampBig;
      case 'pole': return sp.liftPole;
    }
  }

  /** Two skis under the skier, rotated to the heading; drawn pixel-perfect. */
  private drawSkis(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number): void {
    const ang = (heading / HEADING_STEPS) * (Math.PI / 2); // 0 = down, ±90° = sideways
    const dirX = Math.sin(ang), dirY = Math.cos(ang);
    const perpX = dirY, perpY = -dirX;
    const len = 14, gap = 3;
    for (const side of [-1, 1]) {
      const ox = perpX * gap * side, oy = perpY * gap * side;
      const x0 = x + ox - dirX * len * 0.45, y0 = y + oy - dirY * len * 0.45;
      const x1 = x + ox + dirX * len * 0.55, y1 = y + oy + dirY * len * 0.55;
      pixelLine(ctx, x0, y0, x1, y1, COLORS.outline);
    }
  }

  /** Snow texture, anchored to the world so it scrolls with the camera. */
  private drawGround(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const g = this.sprites.ground;
    const ox = -(((Math.round(cx) % g.w) + g.w) % g.w);
    const oy = -(((Math.round(cy) % g.h) + g.h) % g.h);
    for (let y = oy; y < this.viewH; y += g.h) {
      for (let x = ox; x < this.viewW; x += g.w) ctx.drawImage(g.img, x, y);
    }
  }

  private renderTitleBackdrop(ctx: CanvasRenderingContext2D): void {
    // A calm slope with a few trees and the lift running past, so the title screen feels alive.
    const sp = this.sprites;
    const W = this.viewW, H = this.viewH;
    const cx = -Math.floor(W / 2), cy = 0;
    this.drawGround(ctx, cx, cy);
    const seed = 7;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97 + seed * 13) % W);
      const y = ((i * 61 + seed * 29) % H);
      const spr = [sp.treeL, sp.treeS, sp.rock, sp.snowman, sp.treeD][i % 5];
      ctx.drawImage(spr.img, x, y);
    }
    for (const o of this.world.query(cx, cy, cx + W, cy + H)) {
      if (o.kind === 'pole') this.drawObstacle(ctx, o, cx, cy);
    }
    renderLift(ctx, sp, cx, cy, W, H, this.animT);
  }
}
