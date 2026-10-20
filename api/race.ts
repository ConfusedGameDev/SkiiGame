// Spike: WebSocket echo that proves Vercel serves WebSockets for this project and bundles shared code.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { MARK_M } from '../src/net/protocol.ts';

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'spike', markM: MARK_M, now: Date.now() }));
  ws.on('message', (data) => ws.send(JSON.stringify({ t: 'echo', data: data.toString() })));
});

export default server;
