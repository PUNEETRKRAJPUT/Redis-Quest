// D-05: validating a studio draft with the real loader. The draft compiles to the files of one community level
// (packages/shared/src/levels/draft.ts); they are written to a scratch directory, loaded with loadCommunityPack (the
// same schema, id, file, template and community rules the engine applies to levels/community/), and the directory is
// removed. Errors come back positioned in the YAML the studio shows, with paths as they will be in the repository.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  compileDraft,
  loadCommunityPack,
  COMMUNITY_DIR,
  type DraftFile,
  type DraftProblem,
  type LevelError,
  type LoadedLevel,
} from '@quest/shared';

export interface DraftError {
  /** Repository path, e.g. `levels/community/mine/01-a-counter.yaml`. */
  file: string;
  line: number;
  col: number;
  /** `verify[0].checks[1]`, or `(root)`. */
  path: string;
  message: string;
  /** `file:line:col path: message`, as `pnpm levels:validate` prints it. */
  text: string;
}

export interface DraftValidation {
  ok: boolean;
  id: string | null;
  /** Where the files go in the repository. */
  directory: string | null;
  files: DraftFile[];
  /** Problems with the draft's own shape (a missing key, an unknown check kind). */
  problems: DraftProblem[];
  /** The loader's positioned errors. */
  errors: DraftError[];
}

export interface ValidatedDraft {
  result: DraftValidation;
  /** The level as the engine would load it; present only when `result.ok`. */
  loaded?: LoadedLevel;
  /** Solution scripts by the path written in the level file. */
  scripts: Map<string, string>;
}

function toDraftError(e: LevelError, tmpRoot: string): DraftError {
  const rel = e.file.startsWith(tmpRoot)
    ? e.file.slice(tmpRoot.length).replace(/^[\\/]+/, '')
    : e.file;
  const file = `${COMMUNITY_DIR}/${rel.split('\\').join('/')}`;
  return {
    file,
    line: e.line,
    col: e.col,
    path: e.path,
    message: e.message,
    text: `${file}:${e.line}:${e.col} ${e.path}: ${e.message}`,
  };
}

export async function validateDraft(input: unknown): Promise<ValidatedDraft> {
  const compiled = compileDraft(input);
  const scripts = new Map<string, string>();
  const base: DraftValidation = {
    ok: false,
    id: compiled.id ?? null,
    directory: compiled.directory ?? null,
    files: compiled.files,
    problems: compiled.problems,
    errors: [],
  };
  if (compiled.problems.length > 0 || !compiled.pack || !compiled.directory)
    return { result: base, scripts };
  const prefix = `${compiled.directory}/`;
  for (const f of compiled.files)
    if (f.path.endsWith('.redis')) scripts.set(f.path.slice(prefix.length), f.content);

  const tmp = await mkdtemp(join(tmpdir(), 'quest-studio-'));
  try {
    for (const f of compiled.files) {
      const abs = join(tmp, f.path.slice(`${COMMUNITY_DIR}/`.length));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, f.content);
    }
    const pack = await loadCommunityPack(join(tmp, compiled.pack));
    const errors = pack.errors.map((e) => toDraftError(e, tmp));
    const loaded = pack.chapter?.levels[0];
    const ok = errors.length === 0 && loaded !== undefined;
    return { result: { ...base, ok, errors }, ...(ok && loaded ? { loaded } : {}), scripts };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
