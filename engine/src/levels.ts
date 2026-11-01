import {
  formatLevelError,
  loadAllLevels,
  renderTemplates,
  type LoadedChapter,
  type LoadedLevel,
  type QuizVerifier,
  type TemplateContext,
  type VerifySpec,
} from '@quest/shared';
import type { Config } from './config.js';
import type { ProgressFile } from './progress.js';

export interface LevelIndexEntry {
  chapter: LoadedChapter;
  level: LoadedLevel;
  /** Position across all chapters, in play order. */
  index: number;
}

export class LevelService {
  chapters: LoadedChapter[] = [];
  errors: string[] = [];
  private byId = new Map<string, LevelIndexEntry>();
  orderedIds: string[] = [];

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    const r = await loadAllLevels(this.dir);
    this.chapters = r.chapters;
    this.errors = r.errors.map((e) => formatLevelError(e, this.dir));
    this.byId.clear();
    this.orderedIds = [];
    for (const chapter of this.chapters) {
      for (const level of chapter.levels) {
        this.byId.set(level.level.id, { chapter, level, index: this.orderedIds.length });
        this.orderedIds.push(level.level.id);
      }
    }
  }

  get(id: string): LevelIndexEntry | undefined {
    return this.byId.get(id);
  }
}

export function templateContext(
  cfg: Config,
  p: ProgressFile,
  entry: LevelIndexEntry,
): TemplateContext {
  return {
    player: { id: p.player.id, name: p.player.name },
    level: { id: entry.level.level.id },
    chapter: { id: entry.chapter.id },
    env: cfg.templateEnv,
  };
}

/** What the UI sees of a verifier: enough to draw a quiz or an answer box, never the expected values. */
export type PublicVerifier =
  | {
      index: number;
      type: 'quiz';
      question: string;
      options: { id: string; label: string }[];
      multiple: boolean;
    }
  | { index: number; type: 'answer'; prompt: string }
  | { index: number; type: string };

/** What a pool level takes from the level the interviewer drew (E-04). */
export interface DrawnPart {
  entry: LevelIndexEntry;
  /** Template context of the drawn level: its task, hints, checks and the follow-up questions render with it. */
  ctx: TemplateContext;
  /** The pool entry's follow-up quizzes, asked after the drawn level's own checks. */
  questions: readonly QuizVerifier[];
}

/** Shown in place of the task of a pool level until the first start draws one. */
export const NOT_DRAWN_TASK = 'The interviewer picks when you start.';

function publicVerifier(v: VerifySpec, index: number): PublicVerifier {
  if (v.type === 'quiz') {
    return {
      index,
      type: 'quiz',
      question: v.question,
      options: v.options.map((o) => ({ id: o.id, label: o.label })),
      multiple: v.correct.length > 1,
    };
  }
  if (v.type === 'answer') return { index, type: 'answer', prompt: v.prompt };
  return { index, type: v.type };
}

/**
 * The hints a learner can buy on a level, rendered. A pool level's own hints come first and the drawn level's
 * follow, so `hintsRevealed` keeps its meaning when the draw happens after the first hint was shown.
 */
export function levelHints(
  entry: LevelIndexEntry,
  ctx: TemplateContext,
  drawn?: DrawnPart | null,
): string[] {
  const own = renderTemplates(entry.level.level.hints ?? [], ctx);
  if (!drawn) return own;
  return [...own, ...renderTemplates(drawn.entry.level.level.hints ?? [], drawn.ctx)];
}

/**
 * The level as the learner sees it. For a pool level (`pool` given) the story, brainstorm, hints, title and
 * reward are the pool level's own; the task, show-me, docs, scenario and Redis version come from the drawn level,
 * and the verifiers are the drawn level's followed by the pool entry's questions (indices continue).
 * `pool: { drawn: null }` is a pool level nobody has started yet.
 */
export function renderLevel(
  entry: LevelIndexEntry,
  ctx: TemplateContext,
  lp: { hintsRevealed?: number },
  pool?: { drawn: DrawnPart | null },
) {
  const lv = entry.level.level;
  const d = pool?.drawn ?? null;
  const dl = d?.entry.level.level;
  const r = renderTemplates(
    {
      title: lv.title,
      story: lv.story,
      teach: lv.mode === 'code' && lv.interview ? '' : (lv.teach ?? ''),
      task: pool ? NOT_DRAWN_TASK : lv.task,
      brainstorm: lv.brainstorm,
      hints: lv.hints ?? [],
      verify: lv.verify,
      showMe: lv.show_me ?? null,
    },
    ctx,
  );
  const dr =
    d && dl
      ? renderTemplates(
          {
            task: dl.task,
            hints: dl.hints ?? [],
            verify: [...dl.verify, ...d.questions],
            showMe: dl.show_me ?? null,
          },
          d.ctx,
        )
      : null;
  const hints = dr ? [...r.hints, ...dr.hints] : r.hints;
  const revealed = Math.min(lp.hintsRevealed ?? 0, hints.length);
  const verifiers = (dr ? dr.verify : r.verify).map((v, i) => publicVerifier(v as VerifySpec, i));
  return {
    id: lv.id,
    chapter: entry.chapter.id,
    chapterTitle: entry.chapter.chapter.title,
    title: r.title,
    mode: lv.mode,
    story: r.story,
    teach: r.teach,
    task: dr ? dr.task : r.task,
    brainstorm: { prompt: r.brainstorm.prompt, options: r.brainstorm.options },
    hints: hints.slice(0, revealed),
    hintsTotal: hints.length,
    verifiers,
    docs: (pool ? dl?.docs : lv.docs) ?? [],
    showMe: dr ? dr.showMe : pool ? null : r.showMe,
    scenario: (pool ? dl?.scenario : lv.scenario) ?? null,
    minRedisVersion: (pool ? dl?.min_redis_version : lv.min_redis_version) ?? null,
    reward: lv.reward,
  };
}
