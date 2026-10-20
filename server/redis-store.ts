// Redis-backed Store + Bus so a room works no matter which Vercel Function instance each player's
// WebSocket landed on. Keys expire an hour after the room was last changed.

import { createClient } from 'redis';
import type { ServerMsg } from '../src/net/protocol.ts';
import type { Bus, Live, Member, RoomRec, Store } from './store.ts';

type Client = ReturnType<typeof createClient>;

const TTL_S = 3600;
const LOCK_MS = 3000;
const key = (room: string, part = '') => `skii:room:${room}${part}`;
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function redisUrl(): string {
  const url = process.env.REDIS_URL ?? process.env.KV_URL;
  if (!url) throw new Error('REDIS_URL is not set: connect a Redis database to the Vercel project');
  return url;
}

let shared: Promise<Client> | null = null;
/** One command connection per function instance, reused across requests. */
function client(): Promise<Client> {
  shared ??= (async () => {
    const c = createClient({ url: redisUrl() });
    c.on('error', (e) => console.error('[redis]', e));
    await c.connect();
    return c;
  })();
  return shared;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RedisStore implements Store {
  async lock<T>(room: string, fn: () => Promise<T>): Promise<T> {
    const c = await client();
    const k = key(room, ':lock');
    const token = Math.random().toString(36).slice(2);
    const deadline = Date.now() + LOCK_MS;
    while ((await c.set(k, token, { condition: 'NX', expiration: { type: 'PX', value: LOCK_MS } })) === null) {
      if (Date.now() > deadline) throw new Error(`lock timeout for room ${room}`);
      await sleep(15 + Math.random() * 20);
    }
    try {
      return await fn();
    } finally {
      await c.eval(RELEASE, { keys: [k], arguments: [token] });
    }
  }

  async getRoom(room: string): Promise<RoomRec | null> {
    const h = await (await client()).hGetAll(key(room));
    if (!h.seed) return null;
    return {
      seed: Number(h.seed), startAt: h.startAt ? Number(h.startAt) : null,
      nextMark: Number(h.nextMark), raceId: Number(h.raceId),
    };
  }

  async setRoom(room: string, rec: RoomRec): Promise<void> {
    const c = await client();
    await c.multi()
      .hSet(key(room), {
        seed: String(rec.seed), startAt: rec.startAt === null ? '' : String(rec.startAt),
        nextMark: String(rec.nextMark), raceId: String(rec.raceId),
      })
      .expire(key(room), TTL_S)
      .expire(key(room, ':m'), TTL_S)
      .expire(key(room, ':l'), TTL_S)
      .exec();
  }

  async getMembers(room: string): Promise<Map<string, Member>> {
    const h = await (await client()).hGetAll(key(room, ':m'));
    return new Map(Object.entries(h).map(([id, v]) => [id, JSON.parse(v) as Member]));
  }
  async setMember(room: string, id: string, m: Member): Promise<void> {
    await (await client()).hSet(key(room, ':m'), id, JSON.stringify(m));
  }
  async delMember(room: string, id: string): Promise<void> {
    await (await client()).hDel(key(room, ':m'), id);
  }

  async getLive(room: string): Promise<Map<string, Live>> {
    const h = await (await client()).hGetAll(key(room, ':l'));
    return new Map(Object.entries(h).map(([id, v]) => [id, JSON.parse(v) as Live]));
  }
  async setLive(room: string, id: string, l: Live): Promise<void> {
    await (await client()).hSet(key(room, ':l'), id, JSON.stringify(l));
  }
  async delLive(room: string, id: string): Promise<void> {
    await (await client()).hDel(key(room, ':l'), id);
  }
}

/** Pub/sub over a dedicated subscriber connection, fanned out to every socket in this instance. */
export class RedisBus implements Bus {
  private sub: Promise<Client> | null = null;
  private handlers = new Map<string, Set<(m: ServerMsg) => void>>();

  private subscriber(): Promise<Client> {
    this.sub ??= client().then(async (c) => {
      const s = c.duplicate();
      s.on('error', (e) => console.error('[redis sub]', e));
      await s.connect();
      return s;
    });
    return this.sub;
  }

  async publish(room: string, msg: ServerMsg): Promise<void> {
    await (await client()).publish(key(room), JSON.stringify(msg));
  }

  async subscribe(room: string, fn: (m: ServerMsg) => void): Promise<() => Promise<void>> {
    let set = this.handlers.get(room);
    if (!set) {
      set = new Set();
      this.handlers.set(room, set);
      const handlers = set;
      await (await this.subscriber()).subscribe(key(room), (raw) => {
        const msg = JSON.parse(raw) as ServerMsg;
        for (const h of handlers) h(msg);
      });
    }
    set.add(fn);
    return async () => {
      set!.delete(fn);
      if (set!.size === 0 && this.handlers.get(room) === set) {
        this.handlers.delete(room);
        await (await this.subscriber()).unsubscribe(key(room));
      }
    };
  }
}
