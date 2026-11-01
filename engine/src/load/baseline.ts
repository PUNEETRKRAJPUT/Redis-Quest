// Baselines: the same scenario run against the unmodified app (the level's learner slots off),
// stored at ${PROGRESS_DIR}/baselines/<scenario>.json with the configuration it ran under.

import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../progress.js';
import type { LoadRunResult } from './run.js';
import type { AppWindow } from './metrics-tap.js';

export interface RunSummary {
  load: LoadRunResult;
  app: AppWindow | null;
}

/** What must match for a stored baseline to be reused. Anything else changing re-records it. */
export interface BaselineFingerprint {
  scenarioHash: string;
  /** Slots active while the baseline ran (sorted): everything active except the level's own slots. */
  activeSlots: string[];
  dbExtraLatencyMs: number;
  connections: number;
  durationSec: number;
  appUrl: string;
}

export interface BaselineRecord {
  version: 1;
  scenario: string;
  recordedAt: string;
  fingerprint: BaselineFingerprint;
  run: RunSummary;
}

export function fingerprintDiff(a: BaselineFingerprint, b: BaselineFingerprint): string[] {
  const diffs: string[] = [];
  for (const k of Object.keys(b) as (keyof BaselineFingerprint)[]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(k);
  }
  return diffs;
}

export class BaselineStore {
  constructor(private readonly dir: string) {}

  file(scenario: string): string {
    return join(this.dir, `${scenario}.json`);
  }

  async read(scenario: string): Promise<BaselineRecord | null> {
    try {
      const v = JSON.parse(await readFile(this.file(scenario), 'utf8')) as BaselineRecord;
      return v && v.version === 1 && v.fingerprint && v.run ? v : null;
    } catch {
      return null;
    }
  }

  async write(rec: BaselineRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.file(rec.scenario), `${JSON.stringify(rec, null, 2)}\n`);
  }
}
