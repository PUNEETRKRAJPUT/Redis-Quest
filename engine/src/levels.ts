import {
  formatLevelError,
  loadAllLevels,
  renderTemplates,
  type LoadedChapter,
  type LoadedLevel,
  type TemplateContext,
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

export function templateContext(cfg: Config, p: ProgressFile, entry: LevelIndexEntry): TemplateContext {
  return {
    player: { id: p.player.id, name: p.player.name },
    level: { id: entry.level.level.id },
    chapter: { id: entry.chapter.id },
    env: cfg.templateEnv,
  };
}

/** What the UI sees of a verifier: enough to draw a quiz or an answer box, never the expected values. */
export type PublicVerifier =
  | { index: number; type: 'quiz'; question: string; options: { id: string; label: string }[]; multiple: boolean }
  | { index: number; type: 'answer'; prompt: string }
  | { index: number; type: string };

export function renderLevel(entry: LevelIndexEntry, ctx: TemplateContext, lp: { hintsRevealed?: number }) {
  const lv = entry.level.level;
  const r = renderTemplates(
    {
      title: lv.title,
      story: lv.story,
      teach: lv.teach,
      task: lv.task,
      brainstorm: lv.brainstorm,
      hints: lv.hints ?? [],
      verify: lv.verify,
    },
    ctx,
  );
  const revealed = Math.min(lp.hintsRevealed ?? 0, r.hints.length);
  const verifiers: PublicVerifier[] = r.verify.map((v, index): PublicVerifier => {
    if (v.type === 'quiz') {
      return { index, type: 'quiz', question: v.question, options: v.options.map((o) => ({ id: o.id, label: o.label })), multiple: v.correct.length > 1 };
    }
    if (v.type === 'answer') return { index, type: 'answer', prompt: v.prompt };
    return { index, type: v.type };
  });
  return {
    id: lv.id,
    chapter: entry.chapter.id,
    chapterTitle: entry.chapter.chapter.title,
    title: r.title,
    mode: lv.mode,
    story: r.story,
    teach: r.teach,
    task: r.task,
    brainstorm: { prompt: r.brainstorm.prompt, options: r.brainstorm.options },
    hints: r.hints.slice(0, revealed),
    hintsTotal: r.hints.length,
    verifiers,
    docs: lv.docs ?? [],
    showMe: lv.show_me ?? null,
    scenario: lv.scenario ?? null,
    minRedisVersion: lv.min_redis_version ?? null,
    reward: lv.reward,
  };
}
