/* eslint-disable @typescript-eslint/no-explicit-any -- the tests poke at raw parsed YAML */
// E-05: `interview.questions`, 1 to 5 follow-up quizzes on the `rebuild_of` form of an interview level (a pool entry
// carries its own). Asked after the level's own checks, like a pool entry's.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { levelFileSchema } from '../schema.js';

const SCRATCH = fileURLToPath(
  new URL('../../../../../engine/test/fixtures/scratch-e05', import.meta.url),
);
const FILE = join(SCRATCH, '01-cache-aside-questions.yaml');
const POOL = fileURLToPath(
  new URL('../../../../../engine/test/fixtures/scratch-e04/01-mock-one.yaml', import.meta.url),
);

async function raw(file = FILE): Promise<Record<string, any>> {
  return parse(await readFile(file, 'utf8')) as Record<string, any>;
}
const clone = <T>(v: T): T => structuredClone(v);
const errorsOf = (data: unknown): string[] => {
  const r = levelFileSchema.safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('interview.questions on a rebuild_of level', () => {
  it('accepts the scratch level: two questions, normalised like any quiz', async () => {
    const r = levelFileSchema.safeParse(await raw());
    expect(r.success).toBe(true);
    if (!r.success || r.data.mode !== 'code') return;
    const iv = r.data.interview!;
    expect(iv.rebuild_of).toBe('example-code-01-cache-aside');
    expect(iv.questions).toHaveLength(2);
    expect(iv.questions![0]!.correct).toEqual(['stale-heals']);
    expect(r.data.verify).toHaveLength(1); // the level's own check stays where it was
  });

  it('is optional: a rebuild_of level without questions is unchanged', async () => {
    const d = await raw();
    delete d.interview.questions;
    expect(errorsOf(d)).toEqual([]);
  });

  it('wants 1 to 5 questions', async () => {
    const none = await raw();
    none.interview.questions = [];
    expect(errorsOf(none)).toEqual([
      'interview.questions: an interview level needs at least one follow-up question',
    ]);
    const six = await raw();
    const q = six.interview.questions[0];
    six.interview.questions = Array.from({ length: 6 }, (_, i) => ({
      ...clone(q),
      options: q.options.map((o: any) => ({ ...o, id: `${o.id}-${i}` })),
      correct: `${q.correct}-${i}`,
    }));
    expect(errorsOf(six)).toEqual([
      'interview.questions: an interview level has at most 5 follow-up questions',
    ]);
    const five = await raw();
    five.interview.questions = six.interview.questions.slice(0, 5);
    expect(errorsOf(five)).toEqual([]);
  });

  it('keeps option ids unique across the questions, with the position of the clash', async () => {
    const d = await raw();
    d.interview.questions[1].options[0].id = d.interview.questions[0].options[0].id;
    d.interview.questions[1].correct = d.interview.questions[0].options[0].id;
    const msgs = errorsOf(d);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBe(
      'interview.questions.1.options.0.id: option id stale-heals is used by another question of this interview level',
    );
  });

  it('a question is a normal quiz: its correct id must be one of its options', async () => {
    const d = await raw();
    d.interview.questions[0].correct = 'nope';
    expect(errorsOf(d)).toEqual([
      "interview.questions.0.correct: nope is not one of this quiz's option ids",
    ]);
  });

  it('is only for the rebuild_of form: a pool level carries its questions per entry', async () => {
    const d = await raw(POOL);
    d.interview.questions = (await raw()).interview.questions;
    expect(errorsOf(d)).toEqual(['interview.questions: questions go with rebuild_of; a pool entry carries its own']);
  });
});
