import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Multiplayer: `npm run dev:server` runs the race WebSocket server locally.
    proxy: { '/api/race': { target: 'ws://localhost:8787', ws: true } },
  },
  preview: { host: true, port: 4173 },
});
