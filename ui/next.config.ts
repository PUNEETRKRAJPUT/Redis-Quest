import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));
// The pnpm workspace root: Turbopack resolves modules from here and the standalone trace starts here, so the
// production server lands at .next/standalone/ui/server.js.
const repoRoot = path.join(here, '..');

// `pnpm --filter @quest/ui dev` serves the UI on 3100 next to a running stack and forwards the engine's and the
// app's routes to that stack's proxy (PROXY_PORT, default 3000). In production Caddy routes those paths itself,
// before a request ever reaches this server, so the rewrites exist in development only.
const dev = process.env.NODE_ENV === 'development';
const proxyPort = process.env.PROXY_PORT ?? '3000';
const stack = `http://127.0.0.1:${proxyPort}`;

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  cacheComponents: true,
  partialPrefetching: true,
  // The learner stops the stack on purpose in some levels: a navigation waits and retries instead of failing.
  experimental: { useOffline: true },
  allowedDevOrigins: ['127.0.0.1'],
  // The dev server cannot proxy a WebSocket, so in development src/ws.ts connects to the stack's proxy directly.
  // Empty in a production build: the socket stays same-origin behind Caddy.
  env: { NEXT_PUBLIC_QUEST_WS_PORT: dev ? proxyPort : '' },
  turbopack: {
    root: repoRoot,
    rules: { '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' } },
  },
  async rewrites() {
    if (!dev) return [];
    return [
      { source: '/api/:path*', destination: `${stack}/api/:path*` },
      { source: '/app/:path*', destination: `${stack}/app/:path*` },
      { source: '/health', destination: `${stack}/health` },
    ];
  },
};

export default nextConfig;
