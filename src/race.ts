// Client-side view of a multiplayer race: the latest room snapshot, other players as interpolated
// "ghosts", and the events the game should react to. No DOM here, so it runs headlessly in tests.

import { MARK_M, roomPhase, type PlayerInfo, type PlayerStatus, type Pose, type RankEntry, type RoomPhase, type ServerMsg } from './net/protocol.ts';
import type { RaceClient } from './net/client.ts';

const INTERP_MS = 150;      // render other players this far in the past for smooth motion
const BUFFER = 24;
export const GHOST_EAT_MS = 2200;

export interface Ghost {
  id: string;
  name: string;
  slot: number;
  status: PlayerStatus;
  buf: { t: number; pose: Pose }[];
  eatenAt: number | null;    // local time the yeti took them (for the animation)
}

type Snapshot = Extract<ServerMsg, { t: 'snapshot' }>;

/** Start-line x for a join slot, inside the clear lane at the top of the mountain. */
export function slotX(slot: number): number {
  return ((slot % 8) - 3.5) * 18;
}

export class RaceSession {
  readonly client: RaceClient;
  snap: Snapshot | null = null;
  readonly ghosts = new Map<string, Ghost>();
  results: { raceId: number; ranking: RankEntry[] } | null = null;
  /** Popup lines queued for the game to show ("YETI ATE ABC"). */
  readonly events: string[] = [];
  /** Set when the server says the yeti took us; the game consumes it. */
  eatenMe = false;
  private myStatus: PlayerStatus | null = null;
  private now: () => number;

  constructor(client: RaceClient, now: () => number = () => performance.now()) {
    this.client = client;
    this.now = now;
    client.onMessage = (m) => this.handle(m);
  }

  get id(): string { return this.client.id; }
  get room(): string { return this.client.room; }

  handle(m: ServerMsg): void {
    switch (m.t) {
      case 'snapshot': {
        if (this.snap && m.raceId !== this.snap.raceId) {
          for (const g of this.ghosts.values()) g.buf = [];
        }
        this.snap = m;
        const ids = new Set<string>();
        for (const p of m.players) {
          ids.add(p.id);
          if (p.id === this.id) { this.myStatus = p.status; continue; }
          this.upsertGhost(p);
        }
        for (const [id, g] of this.ghosts) {
          const fading = g.eatenAt !== null && this.now() - g.eatenAt < GHOST_EAT_MS;
          if (!ids.has(id) && !fading) this.ghosts.delete(id);
        }
        break;
      }
      case 'state': {
        const g = this.ghosts.get(m.id);
        if (!g) break;
        g.buf.push({ t: this.now(), pose: m.pose });
        if (g.buf.length > BUFFER) g.buf.splice(0, g.buf.length - BUFFER);
        break;
      }
      case 'eaten': {
        if (this.snap) this.snap.nextMark = Math.max(this.snap.nextMark, m.mark + 1);
        if (m.id === this.id) {
          this.myStatus = 'eaten';
          this.eatenMe = true;
          break;
        }
        const g = this.ghosts.get(m.id);
        if (g) {
          g.status = 'eaten';
          g.eatenAt = this.now();
          this.events.push(`YETI ATE ${g.name}`);
        }
        break;
      }
      case 'results':
        this.results = { raceId: m.raceId, ranking: m.ranking };
        break;
      case 'error':
        console.warn('[race]', m.message);
        break;
    }
  }

  private upsertGhost(p: PlayerInfo): void {
    let g = this.ghosts.get(p.id);
    if (!g) {
      g = { id: p.id, name: p.name, slot: p.slot, status: p.status, buf: [], eatenAt: null };
      this.ghosts.set(p.id, g);
    }
    g.name = p.name;
    g.slot = p.slot;
    if (g.status !== 'eaten' || p.status !== 'racing') g.status = p.status;
    if (p.status !== 'eaten') g.eatenAt = null;
  }

  status(): PlayerStatus | null { return this.myStatus; }

  phase(): RoomPhase {
    return this.snap ? roomPhase(this.snap.startAt, this.client.serverNow()) : 'lobby';
  }

  countdownMs(): number {
    return this.snap?.startAt ? Math.max(0, this.snap.startAt - this.client.serverNow()) : 0;
  }

  nextMarkM(): number { return (this.snap?.nextMark ?? 1) * MARK_M; }

  /** Interpolated pose for a ghost, or null before we have heard from them. */
  ghostPose(g: Ghost): Pose | null {
    const b = g.buf;
    if (b.length === 0) return null;
    const t = this.now() - INTERP_MS;
    if (t <= b[0].t) return b[0].pose;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        const a = b[i - 1], c = b[i];
        if (t >= c.t) return c.pose;
        const k = (t - a.t) / Math.max(1, c.t - a.t);
        return { ...c.pose, x: a.pose.x + (c.pose.x - a.pose.x) * k, y: a.pose.y + (c.pose.y - a.pose.y) * k, z: a.pose.z + (c.pose.z - a.pose.z) * k };
      }
    }
    return b[b.length - 1].pose;
  }

  /** Racers still in it, furthest first, including us (pass our live distance). */
  standings(myDist: number): { id: string; name: string; dist: number }[] {
    const out: { id: string; name: string; dist: number }[] = [];
    if (this.myStatus === 'racing' || this.myStatus === 'lobby') out.push({ id: this.id, name: this.client.name, dist: myDist });
    for (const g of this.ghosts.values()) {
      if (g.status !== 'racing' && g.status !== 'lobby') continue;
      out.push({ id: g.id, name: g.name, dist: g.buf.at(-1)?.pose.dist ?? 0 });
    }
    return out.sort((a, b) => b.dist - a.dist);
  }

  /** The alive ghost furthest down the mountain (spectator camera target). */
  leaderGhost(): Ghost | null {
    let best: Ghost | null = null;
    for (const g of this.ghosts.values()) {
      if (g.status !== 'racing' || g.buf.length === 0) continue;
      if (!best || g.buf.at(-1)!.pose.dist > best.buf.at(-1)!.pose.dist) best = g;
    }
    return best;
  }
}
