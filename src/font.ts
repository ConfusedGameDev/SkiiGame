// Bitmap text drawn with Kenney's 16x16 letter tiles. Glyphs are 12 px wide with a 2 px outline,
// so an 11 px advance lets neighbouring outlines merge into one, arcade style.

import type { Sprite } from './sprites.ts';

export const GLYPH_ADVANCE = 11;
export const GLYPH_HEIGHT = 16;

export type Align = 'left' | 'center' | 'right';

export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * GLYPH_ADVANCE + 1;
}

/** Draw text with its top-left (or top-centre / top-right) at (x, y). Returns the drawn width. */
export function drawText(
  ctx: CanvasRenderingContext2D, glyphs: Map<string, Sprite>,
  text: string, x: number, y: number, align: Align = 'left', scale = 1,
): number {
  if (scale !== 1) {
    // Whole-pixel upscale for big text (countdown); smoothing is off so it stays crisp.
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(scale, scale);
    const w = drawText(ctx, glyphs, text, 0, 0, align);
    ctx.restore();
    return w * scale;
  }
  const w = textWidth(text);
  let gx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x) - 2;
  const gy = Math.round(y) - 1;
  for (const ch of text.toUpperCase()) {
    const g = glyphs.get(ch);
    if (g) ctx.drawImage(g.img, gx, gy);
    gx += GLYPH_ADVANCE;
  }
  return w;
}
