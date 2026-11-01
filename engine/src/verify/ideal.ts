// "The ideal way" (beat 7): a level's reference solution, its known-wrong solutions and why.
// Served with the verify response once allowed (passed, or 3 attempts) and on request.

import { readFile } from 'node:fs/promises';
import {
  renderTemplate,
  resolveLevelPath,
  type LoadedLevel,
  type TemplateContext,
} from '@quest/shared';

export const IDEAL_AFTER_ATTEMPTS = 3;

export interface IdealFile {
  path: string;
  content: string;
}

export type Ideal =
  | {
      mode: 'cli' | 'code' | 'ops';
      reference: IdealFile;
      wrong: Array<IdealFile & { expect: 'wrong' | 'works_but_wrong'; because: string }>;
      /** The reference file's own comments, then why each wrong solution is wrong. */
      reasoning: string;
    }
  | {
      mode: 'decision';
      reference: { options: string[] };
      quizzes: Array<{ index: number; question: string; correct: string[]; explanation: string }>;
      wrong: Array<{ option: string; expect: 'wrong'; because: string }>;
      reasoning: string;
    };

export interface IdealAccess {
  allowed: boolean;
  reason: string;
}

export function idealAccess(status: string, attempts: number): IdealAccess {
  if (status === 'passed') return { allowed: true, reason: 'You passed this level.' };
  if (attempts >= IDEAL_AFTER_ATTEMPTS)
    return {
      allowed: true,
      reason: `Shown after ${IDEAL_AFTER_ATTEMPTS} attempts (${attempts} so far).`,
    };
  return {
    allowed: false,
    reason: `Not passed yet, and ${attempts} of ${IDEAL_AFTER_ATTEMPTS} attempts used. You can still reveal it.`,
  };
}

/** Comment lines of a solution file: `#` for .redis and .sh (not the shebang), `//` for JavaScript. */
export function solutionComments(path: string, content: string): string[] {
  const js = /\.(m?js)$/.test(path);
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#!')) continue;
    if (!js && line.startsWith('#')) out.push(line.replace(/^#+\s?/, ''));
    if (js && line.startsWith('//')) out.push(line.replace(/^\/\/+\s?/, ''));
  }
  return out.filter((l) => l.length > 0);
}

async function readSolution(
  level: LoadedLevel,
  rel: string,
  ctx: TemplateContext,
): Promise<IdealFile> {
  const text = await readFile(resolveLevelPath(level, rel), 'utf8');
  // Only .redis files are templated (P0-05 decision 17); .sh and .js are shown as written.
  return { path: rel, content: rel.endsWith('.redis') ? renderTemplate(text, ctx) : text };
}

export async function buildIdeal(level: LoadedLevel, ctx: TemplateContext): Promise<Ideal> {
  const lv = level.level;
  if (lv.mode === 'decision') {
    const quizzes = lv.verify.flatMap((v, index) =>
      v.type === 'quiz'
        ? [{ index, question: v.question, correct: v.correct, explanation: v.explanation }]
        : [],
    );
    const wrong = lv.solutions.wrong.map((w) => ({
      option: w.option,
      expect: 'wrong' as const,
      because: w.because,
    }));
    const reasoning = [
      ...quizzes.map((q) => q.explanation),
      ...wrong.map((w) => `Not ${w.option}: ${w.because}`),
    ].join('\n');
    return {
      mode: 'decision',
      reference: { options: lv.solutions.reference },
      quizzes,
      wrong,
      reasoning,
    };
  }
  const reference = await readSolution(level, lv.solutions.reference, ctx);
  const wrong = await Promise.all(
    lv.solutions.wrong.map(async (w) => ({
      ...(await readSolution(level, w.path, ctx)),
      expect: w.expect,
      because: w.because,
    })),
  );
  const comments = solutionComments(reference.path, reference.content);
  const reasoning = [
    ...comments,
    ...(wrong.length ? ['', 'Why the others fall short:'] : []),
    ...wrong.map((w) => `- ${w.path} (${w.expect.replace(/_/g, ' ')}): ${w.because}`),
  ].join('\n');
  return { mode: lv.mode, reference, wrong, reasoning };
}
