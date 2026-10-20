// Local race server for development: `npm run dev:server`, then `npm run dev`.
// Vite proxies /api/race to this port. Uses in-memory rooms unless REDIS_URL is set.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { attachRace } from './handler.ts';
import { MemoryBus, MemoryStore } from './memory-store.ts';
import { RedisBus, RedisStore } from './redis-store.ts';

const PORT = Number(process.env.RACE_PORT ?? 8787);
const server = http.createServer();
const wss = new WebSocketServer({ server });
const redis = !!(process.env.REDIS_URL || process.env.KV_URL);
attachRace(wss, redis ? new RedisStore() : new MemoryStore(), redis ? new RedisBus() : new MemoryBus());
server.listen(PORT, () => console.log(`race server on ws://localhost:${PORT} (${redis ? 'redis' : 'memory'})`));
