// Storage and messaging seams for the race server. Production uses Redis (redis-store.ts) so rooms
// work across Vercel Function instances; local dev and tests use the in-memory version (memory-store.ts).

import type { PlayerStatus, ServerMsg } from '../src/net/protocol.ts';

export interface RoomRec {
  seed: number;
  startAt: number | null;   // countdown deadline / race start, ms since epoch
  nextMark: number;         // the yeti's next strike is at nextMark * MARK_M metres
  raceId: number;
}

/** Membership; only ever written while holding the room lock. */
export interface Member {
  name: string;
  slot: number;
  status: PlayerStatus;
  finalScore: number | null;
  dist: number | null;      // frozen distance once eaten
}

/** Latest reported progress; written on every pose update without the lock. */
export interface Live {
  dist: number;
  score: number;
  lastSeen: number;
}

export interface Store {
  /** Run fn with exclusive access to the room's room/member records. */
  lock<T>(room: string, fn: () => Promise<T>): Promise<T>;
  getRoom(room: string): Promise<RoomRec | null>;
  setRoom(room: string, rec: RoomRec): Promise<void>;
  getMembers(room: string): Promise<Map<string, Member>>;
  setMember(room: string, id: string, m: Member): Promise<void>;
  delMember(room: string, id: string): Promise<void>;
  getLive(room: string): Promise<Map<string, Live>>;
  setLive(room: string, id: string, live: Live): Promise<void>;
  delLive(room: string, id: string): Promise<void>;
}

export interface Bus {
  publish(room: string, msg: ServerMsg): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(room: string, fn: (msg: ServerMsg) => void): Promise<() => Promise<void>>;
}
