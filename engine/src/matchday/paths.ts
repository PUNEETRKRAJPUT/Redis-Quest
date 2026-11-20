import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<root>/incidents`, or INCIDENTS_DIR. The folder sits next to `scenarios/` and `levels/` in the repo and the image. */
export function incidentsDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'); // <root>/engine/dist/matchday
  return resolve(env.INCIDENTS_DIR ?? resolve(root, 'incidents'));
}
