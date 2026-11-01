import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, `pnpm --filter @quest/ui dev` serves the UI on 5173 and forwards the engine's routes to the proxy
// (default PROXY_PORT 3000). Production is the same-origin build served by the engine itself.
const target = `http://127.0.0.1:${process.env.PROXY_PORT ?? '3000'}`;

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': target, '/health': target, '/ws': { target, ws: true } } },
  // Monaco is loaded lazily with the editor panel and is large by nature.
  build: { chunkSizeWarningLimit: 4000 },
});
