// Browser side of the race connection: reconnects with backoff, re-sends hello so the server
// re-attaches us to our room, and tracks the server clock so countdowns line up on every screen.

import type { ClientMsg, Pose, ServerMsg } from './protocol.ts';

const ID_KEY = 'skii.playerId';

/** Stable per tab (sessionStorage), so two tabs on one machine are two players but a reload keeps your place. */
export function playerId(): string {
  try {
    let id = sessionStorage.getItem(ID_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

export function raceUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/race`;
}

export class RaceClient {
  readonly room: string;
  readonly id: string;
  name: string;
  connected = false;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  private ws: WebSocket | null = null;
  private closed = false;
  private retryMs = 500;
  private offset = 0;             // serverNow - Date.now()
  private readonly url: string;

  constructor(url: string, room: string, id: string, name: string) {
    this.url = url;
    this.room = room;
    this.id = id;
    this.name = name;
  }

  connect(): void {
    this.closed = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retryMs = 500;
      this.connected = true;
      this.onStatus(true);
      this.hello();
    });
    ws.addEventListener('message', (e) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === 'snapshot') this.offset = m.serverNow - Date.now();
      this.onMessage(m);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.onStatus(false);
      if (this.closed) return;
      setTimeout(() => { if (!this.closed) this.connect(); }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8000);
    });
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  /** (Re)join the room: on connect, and to enter the next race after results. */
  hello(): void {
    this.send({ t: 'hello', room: this.room, id: this.id, name: this.name });
  }

  sendState(pose: Pose): void { this.send({ t: 'state', pose }); }
  ping(): void { this.send({ t: 'ping' }); }

  serverNow(): number { return Date.now() + this.offset; }

  private send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
