import { defineConfig } from 'vitest/config';

// Integration tests share one Redis and one Postgres (the quest-p07 compose project): run files serially.
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20_000, hookTimeout: 30_000 },
});
