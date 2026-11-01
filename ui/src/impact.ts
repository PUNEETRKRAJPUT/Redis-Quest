// F-13: the impact log on "What you built". Everything here is read from the save (GET /api/progress); a level with
// no numbers is not listed, and a phrase appears only when the save holds the numbers it needs. The wording follows
// the portfolio page the engine writes (engine/src/portfolio.ts), so the two never disagree.
import { formatClock } from './level/interview';
import type { ChapterSummary, Progress, VerdictMetrics } from './types';

const group = (n: number): string => Math.round(n).toLocaleString('en-US');
const ms = (n: number): string => (n >= 100 ? group(n) : String(Math.round(n * 10) / 10));
// Two significant digits below 1, so a small number is never rounded down to 0.
const small = (n: number): string =>
  String(n >= 1 ? Math.round(n * 100) / 100 : Number(n.toPrecision(2)));

/** The numbers of a traffic check as phrases (same words as the portfolio). */
export function metricPhrases(m: VerdictMetrics): string[] {
  const out: string[] = [];
  if (m.p99Ms !== undefined && m.baselineP99Ms !== undefined)
    out.push(`p99 ${ms(m.baselineP99Ms)} ms to ${ms(m.p99Ms)} ms`);
  else if (m.p99Ms !== undefined) out.push(`p99 ${ms(m.p99Ms)} ms under the check's load`);
  if (m.dbPerRequest !== undefined && m.baselineDbPerRequest !== undefined)
    out.push(
      `Postgres calls per request ${small(m.baselineDbPerRequest)} to ${small(m.dbPerRequest)}`,
    );
  else if (m.dbPerRequest !== undefined)
    out.push(`${small(m.dbPerRequest)} Postgres calls per request`);
  if (m.redisPerRequest !== undefined)
    out.push(`Redis commands per request ${small(m.redisPerRequest)}`);
  if (m.hitRatio !== undefined)
    out.push(`${Math.floor(m.hitRatio * 1000) / 10}% of requests made no Postgres call`);
  if (m.rps !== undefined) out.push(`${group(m.rps)} requests per second`);
  return out;
}

export interface ImpactEntry {
  levelId: string;
  title: string;
  chapter: string;
  phrases: string[];
}

export interface Impact {
  /** "8 chapters, 40 of 96 levels passed, 1,230 XP": the line above the log. */
  summary: string;
  entries: ImpactEntry[];
}

/** Passed levels, in play order, whose first passing verdict carries metrics or that have an interview time. */
export function buildImpact(chapters: ChapterSummary[], progress: Progress): Impact {
  const entries: ImpactEntry[] = [];
  let passed = 0;
  let total = 0;
  for (const c of chapters) {
    for (const l of c.levels) {
      total += 1;
      const lp = progress.levels[l.id];
      if (!lp || lp.status !== 'passed') continue;
      passed += 1;
      const first = lp.verdicts.find((v) => v.verdict === 'right');
      const phrases = first?.metrics ? metricPhrases(first.metrics) : [];
      if (lp.interviewElapsedMs !== undefined)
        phrases.push(
          `rebuilt in ${formatClock(lp.interviewElapsedMs)}${lp.overtime ? ', over the time limit' : ''}`,
        );
      if (phrases.length > 0)
        entries.push({ levelId: l.id, title: l.title, chapter: c.title, phrases });
    }
  }
  const chapterWord = chapters.length === 1 ? 'chapter' : 'chapters';
  return {
    summary: `${chapters.length} ${chapterWord}, ${passed} of ${total} levels passed, ${group(progress.xp)} XP.`,
    entries,
  };
}
