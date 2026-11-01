import { defineConfig } from 'vitest/config';

// Every test forks real Node children (the runner's execution model); on a shared CI runner one file of them
// took 5.07 s against vitest's 5 s default, so the limit is the same as the app's. Files run one at a time:
// targets.test.ts counts connected_clients on the shared Redis, which a neighbouring file's client skews (seen on CI).
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20_000, hookTimeout: 30_000 },
});
