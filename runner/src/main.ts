import type { LevelId } from '@quest/shared';

// Placeholder entrypoint; real behaviour arrives in later tasks.
export const packageName = '@quest/runner';
export const exampleLevel: LevelId = 'placeholder';

console.log(packageName);

// Compose sets PORT for the runner service; without it (P0-01 and P0-02 checks run `node main.js`
// bare) this stays the print-and-exit stub those checks expect. `scripts/check/P0-08.sh` sets PORT.
if (process.env.PORT) await import('./start.js');
