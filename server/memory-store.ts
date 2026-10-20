// In-process Store + Bus for local development and tests. Everything lives in one Node process.

import type { ServerMsg } from '../src/net/protocol.ts';
import type { Bus, Live, Member, RoomRec, Store } from './store.ts';

export class MemoryStore implements Store {
  private rooms = new Map<string, RoomRec>();
  private members = new Map<string, Map<string, Member>>();
  private live = new Map<string, Map<string, Live>>();
  private locks = new Map<string, Promise<unknown>>();

  async lock<T>(room: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(room) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(room, run.catch(() => {}));
    return run;
  }

  async getRoom(room: string) { const r = this.rooms.get(room); return r ? { ...r } : null; }
  async setRoom(room: string, rec: RoomRec) { this.rooms.set(room, { ...rec }); }

  private bucket<V>(map: Map<string, Map<string, V>>, room: string): Map<string, V> {
    let b = map.get(room);
    if (!b) { b = new Map(); map.set(room, b); }
    return b;
  }

  async getMembers(room: string) {
    return new Map([...this.bucket(this.members, room)].map(([k, v]) => [k, { ...v }]));
  }
  async setMember(room: string, id: string, m: Member) { this.bucket(this.members, room).set(id, { ...m }); }
  async delMember(room: string, id: string) { this.bucket(this.members, room).delete(id); }

  async getLive(room: string) {
    return new Map([...this.bucket(this.live, room)].map(([k, v]) => [k, { ...v }]));
  }
  async setLive(room: string, id: string, l: Live) { this.bucket(this.live, room).set(id, { ...l }); }
  async delLive(room: string, id: string) { this.bucket(this.live, room).delete(id); }
}

export class MemoryBus implements Bus {
  private subs = new Map<string, Set<(m: ServerMsg) => void>>();

  async publish(room: string, msg: ServerMsg) {
    for (const fn of this.subs.get(room) ?? []) fn(msg);
  }

  async subscribe(room: string, fn: (m: ServerMsg) => void) {
    let s = this.subs.get(room);
    if (!s) { s = new Set(); this.subs.set(room, s); }
    s.add(fn);
    return async () => { s!.delete(fn); };
  }
}
