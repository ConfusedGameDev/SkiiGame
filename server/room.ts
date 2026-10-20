// Race room rules, independent of transport and storage:
// - 2+ players in the lobby start a 10 s countdown; every new join resets it.
// - The race starts when the countdown hits 0 (pure timestamp, no timer process).
// - Each time the leader passes nextMark * 1000 m, the yeti eats the racer furthest behind.
// - When nobody is left, results go out (ranked by score at the moment each was eaten) and the room
//   resets for the next race. Players who joined mid-race wait for that next race.

import {
  COUNTDOWN_MS, MARK_M, MIN_PLAYERS, STALE_MS, roomPhase,
  type PlayerInfo, type PlayerStatus, type Pose, type RankEntry, type ServerMsg,
} from '../src/net/protocol.ts';
import type { Bus, Live, Member, RoomRec, Store } from './store.ts';

type Members = Map<string, Member>;

const SWEEP_EVERY_MS = 2000;

export class RaceRooms {
  private readonly store: Store;
  private readonly bus: Bus;
  private readonly now: () => number;
  private readonly lastSweep = new Map<string, number>();

  constructor(store: Store, bus: Bus, now: () => number = Date.now) {
    this.store = store;
    this.bus = bus;
    this.now = now;
  }

  /** Add (or re-attach) a player. Returns the snapshot to send them. */
  async join(room: string, id: string, name: string): Promise<ServerMsg> {
    return this.store.lock(room, async () => {
      const now = this.now();
      const rec = (await this.store.getRoom(room)) ?? newRoom(1);
      const members = await this.store.getMembers(room);
      await this.settle(room, rec, members, now);
      const existing = members.get(id);
      if (existing) {
        // Reconnect: keep their place, just refresh the name.
        existing.name = name;
        await this.store.setMember(room, id, existing);
      } else {
        const racing = roomPhase(rec.startAt, now) === 'racing';
        const m: Member = {
          name, slot: freeSlot(members), status: racing ? 'waiting' : 'lobby', finalScore: null, dist: null,
        };
        members.set(id, m);
        await this.store.setMember(room, id, m);
        if (!racing) this.updateCountdown(rec, members, now, true);
      }
      const prev = existing ? (await this.store.getLive(room)).get(id) : undefined;
      await this.store.setLive(room, id, { dist: prev?.dist ?? 0, score: prev?.score ?? 0, lastSeen: now });
      await this.store.setRoom(room, rec);
      const snap = await this.snapshot(room, rec, members, now);
      await this.bus.publish(room, snap);
      return snap;
    });
  }

  /** Socket closed. Lobby players leave at once; racers get STALE_MS to reconnect. */
  async leave(room: string, id: string): Promise<void> {
    await this.store.lock(room, async () => {
      const now = this.now();
      const rec = await this.store.getRoom(room);
      if (!rec) return;
      const members = await this.store.getMembers(room);
      await this.settle(room, rec, members, now);
      const m = members.get(id);
      if (!m || m.status === 'racing' || m.status === 'eaten') return;
      members.delete(id);
      await this.store.delMember(room, id);
      await this.store.delLive(room, id);
      this.updateCountdown(rec, members, now, false);
      await this.store.setRoom(room, rec);
      await this.bus.publish(room, await this.snapshot(room, rec, members, now));
    });
  }

  /** Pose update from a racer: relay it, and let the yeti strike if the leader passed a mark. */
  async onState(room: string, id: string, pose: Pose): Promise<void> {
    const now = this.now();
    await this.store.setLive(room, id, { dist: pose.dist, score: pose.score, lastSeen: now });
    await this.bus.publish(room, { t: 'state', id, pose });
    const rec = await this.store.getRoom(room);
    if (rec && roomPhase(rec.startAt, now) === 'racing' && pose.dist >= rec.nextMark * MARK_M) {
      await this.resolve(room);
    } else {
      await this.maybeSweep(room, now);
    }
  }

  /** Keep-alive from a lobby player or spectator; also drives stale sweeps. */
  async onPing(room: string, id: string): Promise<void> {
    const now = this.now();
    const live = (await this.store.getLive(room)).get(id);
    if (live) await this.store.setLive(room, id, { ...live, lastSeen: now });
    await this.maybeSweep(room, now);
  }

  private async maybeSweep(room: string, now: number): Promise<void> {
    if (now - (this.lastSweep.get(room) ?? 0) < SWEEP_EVERY_MS) return;
    this.lastSweep.set(room, now);
    await this.resolve(room);
  }

  /** Under the lock: start the race if due, eat stale racers, run due yeti strikes, finish if empty. */
  async resolve(room: string): Promise<void> {
    await this.store.lock(room, async () => {
      const now = this.now();
      const rec = await this.store.getRoom(room);
      if (!rec) return;
      const members = await this.store.getMembers(room);
      const started = await this.settle(room, rec, members, now);
      if (roomPhase(rec.startAt, now) !== 'racing') return;
      const live = await this.store.getLive(room);
      const events: ServerMsg[] = [];

      // Racers who vanished are taken by the yeti where they stand.
      for (const [id, m] of members) {
        const l = live.get(id);
        const seen = Math.max(l?.lastSeen ?? 0, rec.startAt ?? 0);
        if (m.status === 'racing' && now - seen > STALE_MS) {
          events.push(await this.eat(room, rec, id, m, l, 0));
        }
      }

      // One victim per mark the leader has passed: whoever is furthest behind.
      for (;;) {
        const alive = [...members].filter(([, m]) => m.status === 'racing');
        if (alive.length === 0) break;
        const dist = (id: string) => live.get(id)?.dist ?? 0;
        const leader = Math.max(...alive.map(([id]) => dist(id)));
        if (leader < rec.nextMark * MARK_M) break;
        alive.sort(([a], [b]) => dist(a) - dist(b) || (live.get(a)?.score ?? 0) - (live.get(b)?.score ?? 0));
        const [victimId, victim] = alive[0];
        events.push(await this.eat(room, rec, victimId, victim, live.get(victimId), rec.nextMark));
        rec.nextMark++;
      }

      const anyRacing = [...members.values()].some((m) => m.status === 'racing');
      const anyEaten = [...members.values()].some((m) => m.status === 'eaten');
      if (!anyRacing && anyEaten) events.push(...(await this.finish(room, rec, members, now)));
      if (started || events.length) await this.store.setRoom(room, rec);
      if (started) await this.bus.publish(room, await this.snapshot(room, rec, members, now));
      for (const e of events) await this.bus.publish(room, e);
    });
  }

  private async eat(room: string, rec: RoomRec, id: string, m: Member, l: Live | undefined, mark: number): Promise<ServerMsg> {
    m.status = 'eaten';
    m.finalScore = l?.score ?? 0;
    m.dist = l?.dist ?? 0;
    await this.store.setMember(room, id, m);
    return { t: 'eaten', id, raceId: rec.raceId, mark, finalScore: m.finalScore };
  }

  /** Publish results and reset the room: racers go back to the menu, waiting players form the next lobby. */
  private async finish(room: string, rec: RoomRec, members: Members, now: number): Promise<ServerMsg[]> {
    const ranking: RankEntry[] = [...members]
      .filter(([, m]) => m.status === 'eaten')
      .map(([id, m]) => ({ id, name: m.name, finalScore: m.finalScore ?? 0, dist: Math.floor(m.dist ?? 0) }))
      .sort((a, b) => b.finalScore - a.finalScore || b.dist - a.dist);
    const results: ServerMsg = { t: 'results', raceId: rec.raceId, ranking };

    for (const [id, m] of [...members]) {
      if (m.status === 'eaten') {
        members.delete(id);
        await this.store.delMember(room, id);
        await this.store.delLive(room, id);
      } else if (m.status === 'waiting') {
        m.status = 'lobby';
        await this.store.setMember(room, id, m);
      }
    }
    Object.assign(rec, newRoom(rec.raceId + 1));
    this.updateCountdown(rec, members, now, true);
    return [results, await this.snapshot(room, rec, members, now)];
  }

  /** Once the countdown has passed, lobby members become racers. Returns true if that just happened. */
  private async settle(room: string, rec: RoomRec, members: Members, now: number): Promise<boolean> {
    if (roomPhase(rec.startAt, now) !== 'racing') return false;
    let changed = false;
    for (const [id, m] of members) {
      if (m.status !== 'lobby') continue;
      m.status = 'racing';
      changed = true;
      await this.store.setMember(room, id, m);
    }
    return changed;
  }

  /** Start/reset the countdown on a join, or cancel it when too few remain. */
  private updateCountdown(rec: RoomRec, members: Members, now: number, joined: boolean): void {
    const inLobby = [...members.values()].filter((m) => m.status === 'lobby').length;
    if (inLobby < MIN_PLAYERS) rec.startAt = null;
    else if (joined || rec.startAt === null) rec.startAt = now + COUNTDOWN_MS;
  }

  private async snapshot(room: string, rec: RoomRec, members: Members, now: number): Promise<ServerMsg> {
    const live = await this.store.getLive(room);
    const players: PlayerInfo[] = [...members].map(([id, m]) => ({
      id, name: m.name, slot: m.slot, status: m.status as PlayerStatus,
      dist: m.status === 'eaten' ? (m.dist ?? 0) : (live.get(id)?.dist ?? 0),
      score: m.status === 'eaten' ? (m.finalScore ?? 0) : (live.get(id)?.score ?? 0),
      finalScore: m.finalScore,
    }));
    return {
      t: 'snapshot', serverNow: now, room, startAt: rec.startAt, seed: rec.seed,
      raceId: rec.raceId, nextMark: rec.nextMark, players,
    };
  }
}

function newRoom(raceId: number): RoomRec {
  return { seed: (Math.random() * 0xffffffff) >>> 0, startAt: null, nextMark: 1, raceId };
}

function freeSlot(members: Members): number {
  const used = new Set([...members.values()].map((m) => m.slot));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}
