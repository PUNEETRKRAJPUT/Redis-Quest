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

/** One measured number for the scoreboard: a value, and the value before when the check measured one. */
export interface ImpactFigure {
  key: string;
  label: string;
  before?: string;
  value: string;
  unit?: string;
  /** Percent change from before to value (negative is lower), only when both are measured and before > 0. */
  change?: number;
  /** Lower is better for latency and calls; the rest are plain readings. */
  lowerIsBetter?: boolean;
}

export interface ImpactEntry {
  levelId: string;
  title: string;
  chapter: string;
  phrases: string[];
  /** The same numbers as `phrases`, split for the scoreboard. */
  figures: ImpactFigure[];
  /** When the passing verdict was recorded (ISO), if the save says. */
  at?: string;
}

const pct = (before: number, after: number): number | undefined =>
  before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : undefined;

/** The numbers of a traffic check as scoreboard figures (same numbers as `metricPhrases`). */
export function metricFigures(m: VerdictMetrics): ImpactFigure[] {
  const out: ImpactFigure[] = [];
  if (m.p99Ms !== undefined)
    out.push({
      key: 'p99',
      label: 'p99',
      before: m.baselineP99Ms !== undefined ? ms(m.baselineP99Ms) : undefined,
      value: ms(m.p99Ms),
      unit: 'ms',
      change: m.baselineP99Ms !== undefined ? pct(m.baselineP99Ms, m.p99Ms) : undefined,
      lowerIsBetter: true,
    });
  if (m.dbPerRequest !== undefined)
    out.push({
      key: 'db',
      label: 'Postgres calls per request',
      before: m.baselineDbPerRequest !== undefined ? small(m.baselineDbPerRequest) : undefined,
      value: small(m.dbPerRequest),
      change:
        m.baselineDbPerRequest !== undefined
          ? pct(m.baselineDbPerRequest, m.dbPerRequest)
          : undefined,
      lowerIsBetter: true,
    });
  if (m.redisPerRequest !== undefined)
    out.push({
      key: 'redis',
      label: 'Redis commands per request',
      value: small(m.redisPerRequest),
    });
  if (m.hitRatio !== undefined)
    out.push({
      key: 'hit',
      label: 'Requests with no Postgres call',
      value: String(Math.floor(m.hitRatio * 1000) / 10),
      unit: '%',
    });
  if (m.rps !== undefined)
    out.push({ key: 'rps', label: 'Requests per second', value: group(m.rps), unit: 'rps' });
  return out;
}

/** The biggest measured win across the log: the p99 (else Postgres-calls) pair with the largest drop. */
export function headlineWin(
  entries: ImpactEntry[],
): { title: string; figure: ImpactFigure } | null {
  let best: { title: string; figure: ImpactFigure; drop: number } | null = null;
  for (const e of entries)
    for (const f of e.figures) {
      if (!f.lowerIsBetter || f.before === undefined || f.change === undefined || f.change >= 0)
        continue;
      const drop = -f.change + (f.key === 'p99' ? 1000 : 0);
      if (!best || drop > best.drop) best = { title: e.title, figure: f, drop };
    }
  return best ? { title: best.title, figure: best.figure } : null;
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
      const figures = first?.metrics ? metricFigures(first.metrics) : [];
      if (lp.interviewElapsedMs !== undefined) {
        phrases.push(
          `rebuilt in ${formatClock(lp.interviewElapsedMs)}${lp.overtime ? ', over the time limit' : ''}`,
        );
        figures.push({
          key: 'rebuilt',
          label: lp.overtime ? 'Rebuilt, over the time limit' : 'Rebuilt in',
          value: formatClock(lp.interviewElapsedMs),
        });
      }
      if (phrases.length > 0) {
        const at = first?.at && !Number.isNaN(Date.parse(first.at)) ? first.at : undefined;
        entries.push({ levelId: l.id, title: l.title, chapter: c.title, phrases, figures, at });
      }
    }
  }
  const chapterWord = chapters.length === 1 ? 'chapter' : 'chapters';
  return {
    summary: `${chapters.length} ${chapterWord}, ${passed} of ${total} levels passed, ${group(progress.xp)} XP.`,
    entries,
  };
}
