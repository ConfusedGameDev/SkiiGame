// WebSocket wiring shared by the Vercel function (api/race.ts) and the local dev server (server/dev.ts).

import type { WebSocket, WebSocketServer } from 'ws';
import {
  normaliseName, normaliseRoomCode, type ClientMsg, type Pose, type ServerMsg,
} from '../src/net/protocol.ts';
import { RaceRooms } from './room.ts';
import type { Bus, Store } from './store.ts';

const KEEPALIVE_MS = 20_000;

const num = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
};

/** Clamp a client-reported pose so a bad message can't poison the room. */
function cleanPose(p: Partial<Pose> | undefined): Pose {
  return {
    x: num(p?.x, -1e7, 1e7), y: num(p?.y, -1e7, 1e8), z: num(p?.z, 0, 1000),
    heading: num(p?.heading, -4, 4), spin: num(p?.spin, -1e5, 1e5),
    flip: !!p?.flip, crash: !!p?.crash, fire: !!p?.fire,
    dist: num(p?.dist, 0, 1e7), score: num(p?.score, 0, 1e8),
  };
}

export function attachRace(wss: WebSocketServer, store: Store, bus: Bus): void {
  const rooms = new RaceRooms(store, bus);

  wss.on('connection', (ws: WebSocket) => {
    let room: string | null = null;
    let id = '';
    let unsubscribe: (() => Promise<void>) | null = null;
    const send = (m: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

    const alive = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, KEEPALIVE_MS);

    ws.on('message', async (raw) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try {
        if (msg.t === 'hello') {
          const code = normaliseRoomCode(String(msg.room ?? ''));
          const pid = String(msg.id ?? '').replace(/[^\w-]/g, '').slice(0, 64);
          if (!code || !pid) { send({ t: 'error', message: 'bad room code or player id' }); return; }
          id = pid;
          if (room !== code) {
            await unsubscribe?.();
            room = code;
            unsubscribe = await bus.subscribe(code, (m) => {
              if (m.t === 'state' && m.id === id) return;   // don't echo a player's own pose
              send(m);
            });
          }
          send(await rooms.join(code, id, normaliseName(String(msg.name ?? ''))));
        } else if (room && msg.t === 'state') {
          await rooms.onState(room, id, cleanPose(msg.pose));
        } else if (room && msg.t === 'ping') {
          await rooms.onPing(room, id);
        }
      } catch (e) {
        console.error('[race]', e);
      }
    });

    ws.on('close', async () => {
      clearInterval(alive);
      try {
        await unsubscribe?.();
        if (room) await rooms.leave(room, id);
      } catch (e) {
        console.error('[race] close', e);
      }
    });
  });
}
