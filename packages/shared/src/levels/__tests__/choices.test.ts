import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { chapterSchema, loadChapter, type LevelError } from '../index.js';

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** The thread problems `loadChapter` reports for this incident YAML (other chapter problems are not the point). */
async function threadErrors(incidentYaml: string): Promise<LevelError[]> {
  const root = await mkdtemp(join(tmpdir(), 'quest-choices-'));
  tempDirs.push(root);
  const dir = join(root, 'example-choices');
  await mkdir(dir);
  await writeFile(
    join(dir, 'chapter.yaml'),
    `id: example-choices\ntitle: t\nincident:\n${incidentYaml}levels: [example-choices-01-a]\n`,
  );
  const r = await loadChapter(dir);
  return r.errors.filter((e) => e.path.startsWith('incident'));
}

const base = {
  id: 'example-choices',
  title: 't',
  levels: ['example-choices-01-a'],
};

describe('reply choices on incident threads', () => {
  test('a thread without choices is unchanged', () => {
    const r = chapterSchema.safeParse({
      ...base,
      incident: [{ from: 'you', time: '09:00', text: 'hi' }],
    });
    expect(r.success).toBe(true);
  });

  test('two or three choices on the player are accepted, the first being the text', () => {
    for (const choices of [
      ['hi', 'hello'],
      ['hi', 'hello', 'hey'],
    ]) {
      const r = chapterSchema.safeParse({
        ...base,
        incident: [{ from: 'you', time: '09:00', text: 'hi', choices }],
      });
      expect(r.success).toBe(true);
    }
  });

  test('choices on someone else are an error positioned on the choices key', async () => {
    const errors = await threadErrors(
      [
        '  - from: roommate',
        '    time: "09:00"',
        '    text: "hi"',
        '    choices:',
        '      - "hi"',
        '      - "hello"',
        '',
      ].join('\n'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'incident[0].choices' });
    // chapter.yaml: `choices:` is on line 7 and its first item on line 8; the error sits on one of them
    expect(errors[0]?.line).toBeGreaterThanOrEqual(7);
    expect(errors[0]?.line).toBeLessThanOrEqual(8);
    expect(errors[0]?.message).toContain("only the player's own messages");
    expect(errors[0]?.message).toContain('roommate');
  });

  test('the first choice must be the message text, and the error points at it', async () => {
    const errors = await threadErrors(
      [
        '  - from: you',
        '    time: "09:00"',
        '    text: "hi"',
        '    choices:',
        '      - "hello"',
        '      - "hi"',
        '',
      ].join('\n'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'incident[0].choices[0]', line: 8 });
    expect(errors[0]?.message).toContain('first choice');
  });

  test('one choice, four choices and repeated choices are errors', async () => {
    const one = await threadErrors(
      ['  - from: you', '    time: "09:00"', '    text: "hi"', '    choices: ["hi"]', ''].join(
        '\n',
      ),
    );
    expect(one[0]?.message).toContain('two or three');
    const four = await threadErrors(
      [
        '  - from: you',
        '    time: "09:00"',
        '    text: "hi"',
        '    choices: [hi, a, b, c]',
        '',
      ].join('\n'),
    );
    expect(four[0]?.message).toContain('at most three');
    const twice = await threadErrors(
      ['  - from: you', '    time: "09:00"', '    text: "hi"', '    choices: [hi, "Hi "]', ''].join(
        '\n',
      ),
    );
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ path: 'incident[0].choices[1]' });
    expect(twice[0]?.message).toContain('different');
  });

  test('a blank choice is rejected like any other empty text', () => {
    const r = chapterSchema.safeParse({
      ...base,
      incident: [{ from: 'you', time: '09:00', text: 'hi', choices: ['hi', '  '] }],
    });
    expect(r.success).toBe(false);
  });
});

describe('the campaign threads', () => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  const levels = join(dir, 'levels');
  const chapters = readdirSync(levels).filter(
    (d) => !d.startsWith('_') && existsSync(join(levels, d, 'chapter.yaml')),
  );

  test('there are eight chapters', () => {
    expect(chapters).toHaveLength(8);
  });

  for (const ch of chapters) {
    test(`${ch}: every chapter.yaml is valid and the player has at least one choice`, () => {
      const data = parse(readFileSync(join(levels, ch, 'chapter.yaml'), 'utf8'));
      const r = chapterSchema.safeParse(data);
      expect(r.success).toBe(true);
      const withChoices = (data.incident as { from: string; choices?: string[] }[]).filter(
        (m) => m.choices,
      );
      expect(withChoices.length).toBeGreaterThan(0);
      for (const m of withChoices) expect(m.from).toBe('you');
    });
  }
});
