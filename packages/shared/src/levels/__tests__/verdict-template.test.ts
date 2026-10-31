import { describe, expect, test } from 'vitest';
import { renderTemplate, renderTemplates, scanTemplate, TemplateError, verdict, type TemplateContext, type VerifierResult } from '../index.js';

describe('verdict', () => {
  const r = (type: VerifierResult['type'], passed: boolean): VerifierResult => ({ type, passed });

  test('all pass is right', () => {
    expect(verdict([r('redis', true), r('antipattern', true), r('behavior', true)])).toBe('right');
  });

  test('any failing non-antipattern verifier is wrong', () => {
    for (const t of ['redis', 'behavior', 'traffic', 'event', 'quiz'] as const) {
      expect(verdict([r('redis', true), r(t, false)])).toBe('wrong');
    }
  });

  test('an antipattern hit with everything else passing is works_but_wrong', () => {
    expect(verdict([r('redis', true), r('antipattern', false)])).toBe('works_but_wrong');
  });

  test('wrong beats works_but_wrong', () => {
    expect(verdict([r('antipattern', false), r('traffic', false)])).toBe('wrong');
  });

  test('a level with only an antipattern verifier that holds is right', () => {
    expect(verdict([r('antipattern', true)])).toBe('right');
  });

  test('no results is wrong (a broken run never passes)', () => {
    expect(verdict([])).toBe('wrong');
  });
});

describe('templates', () => {
  const ctx: TemplateContext = {
    player: { id: 'u-7', name: 'Asha' },
    level: { id: 'ch1-07-hostel-scoreboard' },
    chapter: { id: 'ch1' },
    env: { REDIS_HOST: 'redis' },
  };

  test('renders every variable, with or without inner spaces', () => {
    expect(renderTemplate('user:{{player.id}} {{ player.name }} {{level.id}} {{chapter.id}} {{env.REDIS_HOST}}', ctx)).toBe(
      'user:u-7 Asha ch1-07-hostel-scoreboard ch1 redis',
    );
  });

  test('\\{{ is a literal', () => {
    expect(renderTemplate('lua: \\{{1, 2}} and {{player.id}}', ctx)).toBe('lua: {{1, 2}} and u-7');
  });

  test('unknown variables, missing env values and unterminated braces throw', () => {
    expect(() => renderTemplate('{{player.email}}', ctx)).toThrow(TemplateError);
    expect(() => renderTemplate('{{env.NOPE}}', ctx)).toThrow(/has no value/);
    expect(() => renderTemplate('{{env.lower}}', ctx)).toThrow(/unknown/);
    expect(() => renderTemplate('{{player.id', ctx)).toThrow(/unterminated/);
  });

  test('renderTemplates walks objects and arrays', () => {
    expect(renderTemplates({ cmd: ['ZSCORE', 'lb', 'user:{{player.id}}'], n: 3, ok: true, none: null }, ctx)).toEqual({
      cmd: ['ZSCORE', 'lb', 'user:u-7'],
      n: 3,
      ok: true,
      none: null,
    });
  });

  test('scanTemplate reports positions', () => {
    expect(scanTemplate('a {{x}} \\{{ {{y')).toEqual([
      { kind: 'var', name: 'x', start: 2, end: 7, raw: '{{x}}' },
      { kind: 'escape', start: 8, end: 11 },
      { kind: 'unterminated', start: 12, end: 15 },
    ]);
  });
});
