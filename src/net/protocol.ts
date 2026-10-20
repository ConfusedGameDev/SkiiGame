// Multiplayer race protocol, shared by the browser client and the WebSocket function.
// Kept dependency-free so both sides can import it.

export const COUNTDOWN_MS = 10_000;  // every join resets the countdown to this
export const MARK_M = 1000;          // the yeti strikes each time the leader passes a multiple of this
export const STALE_MS = 10_000;      // a racer silent for this long is treated as eaten
export const STATE_HZ = 5;           // client pose updates per second while racing
export const MIN_PLAYERS = 2;

export type PlayerStatus = 'lobby' | 'racing' | 'eaten' | 'waiting';

export interface Pose {
  x: number; y: number; z: number;
  heading: number; spin: number;
  flip: boolean; crash: boolean;
  fire: boolean;  // going fast enough to trail flames
  dist: number;   // metres
  score: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  slot: number;
  status: PlayerStatus;
  dist: number;
  score: number;
  finalScore: number | null;
}

export interface RankEntry { id: string; name: string; finalScore: number; dist: number; }

export type ClientMsg =
  | { t: 'hello'; room: string; id: string; name: string }
  | { t: 'state'; pose: Pose }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'snapshot'; serverNow: number; room: string; startAt: number | null; seed: number;
      raceId: number; nextMark: number; players: PlayerInfo[] }
  | { t: 'state'; id: string; pose: Pose }
  | { t: 'eaten'; id: string; raceId: number; mark: number; finalScore: number }
  | { t: 'results'; raceId: number; ranking: RankEntry[] }
  | { t: 'error'; message: string };

export type RoomPhase = 'lobby' | 'countdown' | 'racing';

export function roomPhase(startAt: number | null, now: number): RoomPhase {
  if (startAt === null) return 'lobby';
  return now >= startAt ? 'racing' : 'countdown';
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read aloud

export function randomRoomCode(rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
  return s;
}

/** Upper-cases and strips a user-typed room code; returns null if it isn't 4 letters. */
export function normaliseRoomCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return s.length === 4 ? s : null;
}

/** Three upper-case letters, or 'AAA'. */
export function normaliseName(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return s.length === 3 ? s : (s + 'AAA').slice(0, 3);
}
