// The two small files Match Day keeps in the progress folder, apart from progress.json.

import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addResult,
  coerceResults,
  emptyResults,
  type MatchResult,
  type ResultsFile,
} from '@quest/shared';
import { writeFileAtomic } from '../progress.js';
import type { UndoEntry, UndoJournal } from './changes.js';

export const RESULTS_FILE = 'matchday-results.json';
export const UNDO_FILE = 'matchday-undo.json';

export class ResultsStore {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, RESULTS_FILE);
  }

  async read(): Promise<ResultsFile> {
    try {
      return coerceResults(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return emptyResults();
    }
  }

  /** Records one finished match. Writes are serialised so two never interleave. */
  add(r: MatchResult): Promise<ResultsFile> {
    const run = async (): Promise<ResultsFile> => {
      const next = addResult(await this.read(), r);
      await mkdir(join(this.file, '..'), { recursive: true });
      await writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }
}

export class FileJournal implements UndoJournal {
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, UNDO_FILE);
  }

  async read(): Promise<UndoEntry | null> {
    try {
      const v = JSON.parse(await readFile(this.file, 'utf8')) as Partial<UndoEntry>;
      return typeof v.maxmemory === 'string' && /^\d+$/.test(v.maxmemory)
        ? { maxmemory: v.maxmemory, setAt: String(v.setAt ?? '') }
        : null;
    } catch {
      return null;
    }
  }

  async write(e: UndoEntry): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeFileAtomic(this.file, `${JSON.stringify(e)}\n`);
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
