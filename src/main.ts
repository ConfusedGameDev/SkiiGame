import { Game, type Phase } from './game.ts';
import { Input } from './input.ts';
import { loadSprites } from './sprites.ts';
import { loadScores } from './scores.ts';
import { RaceSession } from './race.ts';
import { RaceClient, playerId, raceUrl } from './net/client.ts';
import { normaliseName, normaliseRoomCode, randomRoomCode } from './net/protocol.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const ctx = canvas.getContext('2d', { alpha: false })!;
ctx.imageSmoothingEnabled = false;

const game = new Game(await loadSprites());
const input = new Input(canvas, $('touch'));

const panels = {
  title: $('panel-title'),
  pause: $('panel-pause'),
  help: $('panel-help'),
  mp: $('panel-mp'),
  lobby: $('panel-lobby'),
};
const overlay = $('overlay');
const st = {
  race: $('st-race'),
  score: $('st-score'), dist: $('st-dist'), speed: $('st-speed'), time: $('st-time'), style: $('st-style'), fast: $('st-fast'),
};
const tcFast = $('tc-fast');

function bestText(): string {
  const top = loadScores()[0];
  return top ? `High score: ${top.name} ${top.score}` : '';
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
    case 'paused':
      showPanel('pause');
      break;
    case 'lobby':
      renderLobby();
      showPanel('lobby');
      break;
    default:
      showPanel(null);
  }
};

// ---- Multiplayer -------------------------------------------------------------
const INITIALS_KEY = 'skii.initials';
let session: RaceSession | null = null;

function savedInitials(): string {
  try { return localStorage.getItem(INITIALS_KEY) ?? ''; } catch { return ''; }
}

function setRoomInUrl(code: string | null): void {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function joinRace(code: string): void {
  leaveRace();
  const name = normaliseName(($<HTMLInputElement>('mp-name').value || savedInitials()));
  try { localStorage.setItem(INITIALS_KEY, name); } catch { /* ignore */ }
  const client = new RaceClient(raceUrl(), code, playerId(), name);
  session = new RaceSession(client);
  client.onStatus = () => renderLobby();
  client.connect();
  setRoomInUrl(code);
  game.enterRace(session);
}

function leaveRace(): void {
  if (!session) return;
  session.client.close();
  session = null;
  game.leaveRace();
  setRoomInUrl(null);
}

function renderLobby(): void {
  if (!session) return;
  $('lobby-code').textContent = session.room;
  const list = $('lobby-players');
  list.replaceChildren(...(session.snap?.players ?? []).map((p) => {
    const li = document.createElement('li');
    const you = p.id === session!.id ? ' (you)' : '';
    li.textContent = `${p.name}${you}${p.status === 'waiting' ? ' — watching' : ''}`;
    return li;
  }));
  let status: string;
  if (!session.client.connected) status = 'Connecting…';
  else if (session.phase() === 'countdown') status = `Starting in ${Math.ceil(session.countdownMs() / 1000)}…`;
  else status = 'Waiting for at least one more player. Send them the link!';
  $('lobby-status').textContent = status;
}

$('btn-mp').addEventListener('click', () => {
  $<HTMLInputElement>('mp-name').value = savedInitials();
  $('mp-error').textContent = '';
  showPanel('mp');
});
$('mp-back').addEventListener('click', () => showPanel('title'));
$('mp-create').addEventListener('click', () => joinRace(randomRoomCode()));
$('mp-join').addEventListener('click', () => {
  const code = normaliseRoomCode($<HTMLInputElement>('mp-code').value);
  if (!code) { $('mp-error').textContent = 'Room codes are 4 letters.'; return; }
  joinRace(code);
});
$('lobby-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('lobby-copy').textContent = 'Copied!';
  } catch {
    $('lobby-copy').textContent = location.href;
  }
  setTimeout(() => { $('lobby-copy').textContent = 'Copy link'; }, 2000);
});
$('lobby-leave').addEventListener('click', () => {
  leaveRace();
  game.showTitle();
});

// ---- Solo controls -------------------------------------------------------------
function startSolo(): void {
  leaveRace();
  game.start();
}

$('btn-start').addEventListener('click', startSolo);
$('btn-resume').addEventListener('click', () => game.togglePause());
$('btn-help-close').addEventListener('click', () => {
  const back: Record<string, keyof typeof panels | null> = { title: 'title', paused: 'pause', lobby: 'lobby' };
  showPanel(back[game.phase] ?? null);
});
$('menu-restart').addEventListener('click', startSolo);
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

  // Any key / tap on the title screen starts a solo run (other screens handle their own input).
  if (game.phase === 'title' && input.any && !panels.title.classList.contains('hidden')) {
    if (input.jump || input.straight || input.turn !== 0) startSolo();
  }

  game.update(dt, input);
  input.flush();
  game.render(ctx);

  hudAcc += dt;
  if (hudAcc > 0.1) {
    hudAcc = 0;
    const s = game.stats();
    const race = game.raceHud();
    st.race.textContent = race ?? '';
    st.race.classList.toggle('hidden', race === null);
    st.score.textContent = `Score ${s.score}`;
    st.dist.textContent = `${Math.floor(s.distanceM)} m`;
    st.speed.textContent = `${s.speedMs.toFixed(1)} m/s`;
    st.time.textContent = fmtTime(s.time);
    st.style.textContent = `Style ${s.style}`;
    st.fast.classList.toggle('hidden', !s.fast);
    tcFast.classList.toggle('on', s.fast);
    if (game.phase === 'lobby') renderLobby();
  }
  requestAnimationFrame(frame);
}

// A shared link (?room=ABCD) drops you straight into that race's lobby.
const linked = normaliseRoomCode(new URLSearchParams(location.search).get('room') ?? '');
if (linked) {
  $<HTMLInputElement>('mp-name').value = savedInitials();
  joinRace(linked);
} else {
  game.onPhase('title');
}
requestAnimationFrame(frame);
