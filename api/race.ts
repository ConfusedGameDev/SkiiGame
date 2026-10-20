// Multiplayer race WebSocket endpoint: wss://<host>/api/race
// Rooms live in Redis so players on different function instances share them. Without REDIS_URL it
// falls back to in-memory rooms, which only works while everyone lands on the same instance.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { attachRace } from '../server/handler.ts';
import { MemoryBus, MemoryStore } from '../server/memory-store.ts';
import { RedisBus, RedisStore } from '../server/redis-store.ts';

const server = http.createServer((_req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('WebSocket endpoint for Skii races');
});
const wss = new WebSocketServer({ server });

if (process.env.REDIS_URL || process.env.KV_URL) {
  attachRace(wss, new RedisStore(), new RedisBus());
} else {
  console.warn('[race] REDIS_URL not set; using in-memory rooms (single instance only)');
  attachRace(wss, new MemoryStore(), new MemoryBus());
}

export default server;
