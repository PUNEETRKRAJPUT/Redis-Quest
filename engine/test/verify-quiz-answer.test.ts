import { describe, expect, test } from 'vitest';
import type { AnswerVerifier, QuizVerifier } from '@quest/shared';
import { cleanTyped, gradeAnswer, gradeQuiz } from '../src/verify/quiz-answer.js';

const quiz: QuizVerifier = {
  type: 'quiz',
  question: 'Q?',
  options: [
    { id: 'a', label: 'Sorted set' },
    { id: 'b', label: 'List' },
    { id: 'c', label: 'Set' },
  ],
  correct: ['a'],
  explanation: 'It needs ordering.',
};

describe('quiz', () => {
  test('correct option, with the explanation', () => {
    expect(gradeQuiz(quiz, 'a')).toMatchObject({
      ok: true,
      message: 'Correct. It needs ordering.',
    });
  });
  test('wrong option does not reveal the answer', () => {
    const r = gradeQuiz(quiz, 'b');
    expect(r).toMatchObject({ ok: false, message: 'Not quite: you picked "List".' });
    expect(JSON.stringify(r)).not.toContain('ordering');
  });
  test('missing, unknown and multi-select answers', () => {
    expect(gradeQuiz(quiz, undefined).message).toBe('No answer was submitted for this question.');
    expect(gradeQuiz(quiz, 'zz').message).toBe('zz is not one of the options for this question.');
    const multi = { ...quiz, correct: ['a', 'c'] };
    expect(gradeQuiz(multi, ['c', 'a']).ok).toBe(true);
    expect(gradeQuiz(multi, ['a']).message).toBe(
      'Not quite: you picked "Sorted set". This question has 2 correct options.',
    );
  });
});

const answer = (a: Partial<AnswerVerifier>): AnswerVerifier =>
  ({
    type: 'answer',
    prompt: 'P?',
    expected: { cmd: ['HGET', 'h', 'name'] },
    message: 'That is not the name.',
    ...a,
  }) as AnswerVerifier;

describe('answer', () => {
  test('string equals, lenient about redis-cli quotes', async () => {
    const send = async () => 'Puneet';
    expect((await gradeAnswer(answer({}), 'Puneet', send)).ok).toBe(true);
    expect((await gradeAnswer(answer({}), ' "Puneet" ', send)).ok).toBe(true);
    const miss = await gradeAnswer(answer({}), 'puneet', send);
    expect(miss).toMatchObject({
      ok: false,
      message: 'That is not the name. (you typed "puneet")',
    });
    expect(miss.message).not.toContain('Puneet');
  });
  test('number transform accepts "(integer) 0"', async () => {
    const send = async () => 0;
    const a = answer({ expected: { cmd: ['ZREVRANK', 'lb', 'u'], transform: 'number' } });
    expect((await gradeAnswer(a, '(integer) 0', send)).ok).toBe(true);
    expect((await gradeAnswer(a, '1', send)).ok).toBe(false);
    expect((await gradeAnswer(a, 'zero', send)).ok).toBe(false);
  });
  test('numeric_within for a moving TTL', async () => {
    const send = async () => 86000;
    const a = answer({
      expected: { cmd: ['TTL', 'g'], transform: 'number' },
      compare: 'numeric_within',
      tolerance: 600,
    });
    expect((await gradeAnswer(a, '85500', send)).ok).toBe(true);
    expect((await gradeAnswer(a, '0', send)).ok).toBe(false);
  });
  test('length transform', async () => {
    const send = async () => ['a', 'b', 'c'];
    const a = answer({ expected: { cmd: ['LRANGE', 'l', '0', '-1'], transform: 'length' } });
    expect((await gradeAnswer(a, '3', send)).ok).toBe(true);
  });
  test('nothing typed, nil expected, Redis down', async () => {
    expect((await gradeAnswer(answer({}), '  ', async () => 'x')).message).toBe(
      'That is not the name. (nothing was typed)',
    );
    expect((await gradeAnswer(answer({}), 'x', async () => null)).message).toMatch(
      /Redis has no value to compare it with/,
    );
    const down = await gradeAnswer(answer({}), 'x', async () => {
      throw new Error('redis is down');
    });
    expect(down.message).toMatch(/Redis is not reachable/);
  });
  test('cleanTyped', () => {
    expect(cleanTyped('(integer) 42')).toBe('42');
    expect(cleanTyped('"a b"')).toBe('a b');
  });
});
