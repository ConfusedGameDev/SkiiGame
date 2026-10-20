import { Game, type Phase } from './game.ts';
import { Input } from './input.ts';
import { loadSprites } from './sprites.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const ctx = canvas.getContext('2d', { alpha: false })!;
ctx.imageSmoothingEnabled = false;

const game = new Game(await loadSprites());
const input = new Input(canvas, $('touch'));

const panels = {
  title: $('panel-title'),
  over: $('panel-over'),
  pause: $('panel-pause'),
  help: $('panel-help'),
};
const overlay = $('overlay');
const st = {
  dist: $('st-dist'), speed: $('st-speed'), time: $('st-time'), style: $('st-style'), fast: $('st-fast'),
};
const tcFast = $('tc-fast');

const BEST_KEY = 'skii.best';
function best(): number {
  try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0; } catch { return 0; }
}
function saveBest(m: number): void {
  try { if (m > best()) localStorage.setItem(BEST_KEY, String(Math.floor(m))); } catch { /* ignore */ }
}
function bestText(): string {
  const b = best();
  return b > 0 ? `Best run: ${b} m` : '';
}

// ---- Resolution: integer-scaled low-res canvas for chunky pixels ----------
let scale = 3;
function resize(): void {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
  scale = Math.max(2, Math.min(6, Math.floor(Math.min(w, h) / 190)));
  canvas.width = Math.ceil(w / scale);
  canvas.height = Math.ceil(h / scale);
  ctx.imageSmoothingEnabled = false;
  game.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('stage'));
resize();

// ---- Phase → UI --------------------------------------------------------------
function showPanel(name: keyof typeof panels | null): void {
  for (const [k, el] of Object.entries(panels)) el.classList.toggle('hidden', k !== name);
  overlay.classList.toggle('hidden', name === null);
}

game.onPhase = (p: Phase) => {
  switch (p) {
    case 'title':
      $('best-title').textContent = bestText();
      showPanel('title');
      break;
    case 'playing':
      showPanel(null);
      break;
    case 'paused':
      showPanel('pause');
      break;
    case 'over': {
      const s = game.stats();
      saveBest(s.distanceM);
      $('over-stats').innerHTML =
        `You made it <b>${Math.floor(s.distanceM)} m</b> in ${fmtTime(s.time)}<br />Style points: ${s.style}`;
      $('best-over').textContent = bestText();
      showPanel('over');
      break;
    }
  }
};

$('btn-start').addEventListener('click', () => game.start());
$('btn-retry').addEventListener('click', () => game.start());
$('btn-resume').addEventListener('click', () => game.togglePause());
$('btn-help-close').addEventListener('click', () => {
  showPanel(game.phase === 'playing' ? null : game.phase === 'over' ? 'over' : game.phase === 'paused' ? 'pause' : 'title');
});
$('menu-restart').addEventListener('click', () => game.start());
$('menu-pause').addEventListener('click', () => game.togglePause());
$('menu-help').addEventListener('click', () => {
  if (game.phase === 'playing') game.togglePause();
  showPanel('help');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase === 'playing') game.togglePause();
});

function fmtTime(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---- Loop ------------------------------------------------------------------
let last = performance.now();
let hudAcc = 0;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Any key / tap on the title or game-over screen starts a run.
  if ((game.phase === 'title' || game.phase === 'over') && input.any && !panels.help.offsetParent) {
    if (input.jump || input.straight || input.turn !== 0) game.start();
  }

  game.update(dt, input);
  input.flush();
  game.render(ctx);

  hudAcc += dt;
  if (hudAcc > 0.1) {
    hudAcc = 0;
    const s = game.stats();
    st.dist.textContent = `${Math.floor(s.distanceM)} m`;
    st.speed.textContent = `${s.speedMs.toFixed(1)} m/s`;
    st.time.textContent = fmtTime(s.time);
    st.style.textContent = `Style ${s.style}`;
    st.fast.classList.toggle('hidden', !s.fast);
    tcFast.classList.toggle('on', s.fast);
  }
  requestAnimationFrame(frame);
}

game.onPhase('title');
requestAnimationFrame(frame);
