import type { LevelId } from '@quest/shared';

export const packageName = '@quest/app';
export const exampleLevel: LevelId = 'placeholder';

console.log(packageName);

// Compose sets PORT for the app service; without it (the P0-01 and P0-02 checks run `node main.js`
// bare) this stays the print-and-exit stub those checks expect.
if (process.env.PORT) await import('./start.js');
