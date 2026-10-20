// Arcade-style end-of-run screens drawn on the canvas with the Kenney letter tiles:
// "entry" lets the player pick three initials, "board" shows the local top ten.

import { drawText, GLYPH_ADVANCE } from './font.ts';
import { COLORS, type Sprite } from './sprites.ts';
import { insertScore, loadScores, qualifies, type ScoreEntry } from './scores.ts';
import type { Input } from './input.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INITIALS_KEY = 'skii.initials';
const SLOT_GAP = 24;
const BOARD_DELAY = 0.6;    // ignore input briefly so the confirm press doesn't also restart

export type HighScoreMode = 'entry' | 'board';
type Run = Omit<ScoreEntry, 'name'>;

function lastInitials(): number[] {
  try {
    const s = localStorage.getItem(INITIALS_KEY) ?? '';
    if (/^[A-Z]{3}$/.test(s)) return [...s].map((c) => ALPHABET.indexOf(c));
  } catch { /* ignore */ }
  return [0, 0, 0];
}

function saveInitials(name: string): void {
  try { localStorage.setItem(INITIALS_KEY, name); } catch { /* ignore */ }
}

interface Box { x0: number; y0: number; x1: number; y1: number; }
const inside = (b: Box, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

export class HighScores {
  mode: HighScoreMode = 'board';
  private run: Run = { score: 0, dist: 0, style: 0 };
  private letters = [0, 0, 0];
  private slot = 0;
  private rank = -1;
  private t = 0;

  /** Start the end-of-run flow; returns the first screen to show. */
  begin(run: Run): HighScoreMode {
    this.run = run;
    this.rank = -1;
    this.t = 0;
    this.slot = 0;
    this.letters = lastInitials();
    this.mode = qualifies(run.score) ? 'entry' : 'board';
    return this.mode;
  }

  /** Returns 'saved' once initials are confirmed, 'again' when the player wants another run. */
  update(dt: number, input: Input, W: number, H: number): 'saved' | 'again' | null {
    this.t += dt;
    const tap = input.tap ? input.toLogical({ active: true, ...input.tap }, 1) : null;

    if (this.mode === 'board') {
      if (this.t < BOARD_DELAY) return null;
      const go = tap || input.codes.some((c) => c === 'Space' || c === 'Enter' || c === 'KeyR');
      return go ? 'again' : null;
    }

    for (const code of input.codes) {
      if (code === 'ArrowLeft') this.slot = Math.max(0, this.slot - 1);
      else if (code === 'ArrowRight') this.slot = Math.min(2, this.slot + 1);
      else if (code === 'ArrowUp') this.cycle(-1);
      else if (code === 'ArrowDown') this.cycle(1);
      else if (code === 'Backspace') this.slot = Math.max(0, this.slot - 1);
      else if (code === 'Enter' || code === 'Space') return this.confirm();
      else if (/^Key[A-Z]$/.test(code)) {
        this.letters[this.slot] = ALPHABET.indexOf(code[3]);
        this.slot = Math.min(2, this.slot + 1);
      }
    }

    if (tap) {
      const L = this.entryLayout(W, H);
      if (inside(L.ok, tap.x, tap.y)) return this.confirm();
      L.slots.forEach((s, i) => {
        if (inside(s.up, tap.x, tap.y)) { this.slot = i; this.cycle(-1); }
        else if (inside(s.down, tap.x, tap.y)) { this.slot = i; this.cycle(1); }
        else if (inside(s.letter, tap.x, tap.y)) this.slot = i;
      });
    }
    return null;
  }

  private cycle(d: number): void {
    this.letters[this.slot] = (this.letters[this.slot] + d + ALPHABET.length) % ALPHABET.length;
  }

  private confirm(): 'saved' {
    const name = this.letters.map((i) => ALPHABET[i]).join('');
    saveInitials(name);
    this.rank = insertScore({ name, ...this.run });
    this.mode = 'board';
    this.t = 0;
    return 'saved';
  }

  // ---- Layout + render -------------------------------------------------------
  private entryLayout(W: number, H: number) {
    const top = Math.max(4, Math.round(H / 2 - 64));
    const ly = top + 54;                       // letter row
    const slots = [0, 1, 2].map((i) => {
      const cx = Math.round(W / 2 + (i - 1) * SLOT_GAP);
      return {
        cx,
        up: { x0: cx - 11, y0: ly - 16, x1: cx + 11, y1: ly - 1 },
        letter: { x0: cx - 11, y0: ly, x1: cx + 11, y1: ly + 15 },
        down: { x0: cx - 11, y0: ly + 16, x1: cx + 11, y1: ly + 31 },
      };
    });
    const okY = ly + 38;
    const ok = { x0: W / 2 - 18, y0: okY - 3, x1: W / 2 + 18, y1: okY + 17 };
    return { top, ly, slots, okY, ok };
  }

  render(ctx: CanvasRenderingContext2D, glyphs: Map<string, Sprite>, W: number, H: number): void {
    // Dim the frozen slope behind the text.
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    if (this.mode === 'entry') this.renderEntry(ctx, glyphs, W, H);
    else this.renderBoard(ctx, glyphs, W, H);
  }

  private renderEntry(ctx: CanvasRenderingContext2D, glyphs: Map<string, Sprite>, W: number, H: number): void {
    const L = this.entryLayout(W, H);
    drawText(ctx, glyphs, 'NEW HIGH SCORE', W / 2, L.top, 'center');
    drawText(ctx, glyphs, String(this.run.score), W / 2, L.top + 20, 'center');
    const blink = Math.floor(this.t * 4) % 2 === 0;
    L.slots.forEach((s, i) => {
      const active = i === this.slot;
      if (active) {
        triangle(ctx, s.cx, L.ly - 9, -1);
        triangle(ctx, s.cx, L.ly + 24, 1);
      }
      if (!active || blink) drawText(ctx, glyphs, ALPHABET[this.letters[i]], s.cx, L.ly, 'center');
      if (active) {
        ctx.fillStyle = COLORS.snow;
        ctx.fillRect(s.cx - 5, L.ly + 16, 10, 1);
      }
    });
    drawText(ctx, glyphs, 'OK', W / 2, L.okY, 'center');
  }

  private renderBoard(ctx: CanvasRenderingContext2D, glyphs: Map<string, Sprite>, W: number, H: number): void {
    const list = loadScores();
    let y = 6;
    drawText(ctx, glyphs, 'HIGH SCORES', W / 2, y, 'center');
    y += 20;
    if (this.rank < 0 && this.run.score > 0) {
      drawText(ctx, glyphs, `YOUR SCORE ${this.run.score}`, W / 2, y, 'center');
      y += 18;
    }
    const footer = H - 18;
    const rows = Math.max(0, Math.min(list.length, Math.floor((footer - y - 2) / 16)));
    const rowW = 13 * GLYPH_ADVANCE;
    const x = Math.round(W / 2 - rowW / 2);
    const blink = Math.floor(this.t * 4) % 2 === 0;
    if (list.length === 0) drawText(ctx, glyphs, 'NO SCORES YET', W / 2, y, 'center');
    for (let i = 0; i < rows; i++) {
      if (i === this.rank && !blink) continue;
      const e = list[i];
      const line = `${String(i + 1).padStart(2, ' ')} ${e.name} ${String(e.score).padStart(6, ' ')}`;
      drawText(ctx, glyphs, line, x, y + i * 16);
    }
    if (this.t >= BOARD_DELAY) drawText(ctx, glyphs, 'SPACE OR TAP', W / 2, footer, 'center');
  }
}

/** Small pixel arrow; dir -1 points up, +1 points down. */
function triangle(ctx: CanvasRenderingContext2D, cx: number, y: number, dir: number): void {
  for (let r = 0; r < 4; r++) {
    const half = dir < 0 ? r : 3 - r;
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(cx - half - 2, y + r - 1, half * 2 + 4, 3);
  }
  for (let r = 0; r < 4; r++) {
    const half = dir < 0 ? r : 3 - r;
    ctx.fillStyle = COLORS.snow;
    ctx.fillRect(cx - half - 1, y + r, half * 2 + 2, 1);
  }
}
