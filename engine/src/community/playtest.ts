// D-05: the play-test. Loads nothing from disk (the caller hands over the loaded level and the solution scripts as
// text), runs the level's setup, its reference solution and each known-wrong solution against the real Redis, grades
// every run with the same verifier a player's attempt goes through, and removes the keys the draft created.
//
// The play-test is allowed to write only where it cannot hurt: it refuses a draft that names a `game:*` key or a
// command that changes the server, and it refuses to start when one of the keys the draft would write already exists
// (that data is the player's; the message says which key to rename).

import {
  COMMUNITY_FORBIDDEN_COMMANDS,
  renderTemplate,
  renderTemplates,
  scriptLines,
  type LoadedLevel,
  type TemplateContext,
} from '@quest/shared';
import { splitArgs } from '../cli.js';
import type { Answers, VerifyOutcome } from '../verify/index.js';

export interface PlaytestDeps {
  /** One command on the engine's own connection (setup steps, COMMAND GETKEYS, EXISTS, UNLINK). */
  send(argv: string[]): Promise<unknown>;
  /** One line the way the terminal runs it, so a script behaves here as it does for a player. */
  cli(line: string): Promise<{ reply: string; type: string; ms: number }>;
  /** The verifier a player's attempt goes through. */
  verify(level: LoadedLevel, ctx: TemplateContext, answers: Answers): Promise<VerifyOutcome>;
}

export type Expected = 'right' | 'wrong' | 'works_but_wrong';

export interface PlaytestRun {
  /** `reference`, or the path / option id of a known-wrong solution. */
  name: string;
  expect: Expected;
  because?: string;
  verdict: VerifyOutcome['verdict'];
  /** The run behaved as the level declares. */
  ok: boolean;
  /** What each command of the script answered (cli levels). */
  transcript: { line: string; reply: string; type: string; ms: number }[];
  outcome: VerifyOutcome;
}

export interface PlaytestResult {
  passed: boolean;
  /** Set when the play-test did not run anything; the draft needs a change first. */
  refused: string | null;
  runs: PlaytestRun[];
  /** The keys the draft writes, all removed again. */
  keys: string[];
}

export interface PlaytestInput {
  level: LoadedLevel;
  ctx: TemplateContext;
  /** Solution scripts by the path written in the level file (`solutions/01-reference.redis`). */
  scripts: ReadonlyMap<string, string>;
}

function refuse(message: string): PlaytestResult {
  return { passed: false, refused: message, runs: [], keys: [] };
}

function render(line: string, ctx: TemplateContext): string[] | null {
  return splitArgs(renderTemplate(line, ctx));
}

/** The reasons a list of commands may not be run by a play-test, or null. */
export function refusalFor(argvs: readonly (readonly string[])[]): string | null {
  for (const argv of argvs) {
    const name = (argv[0] ?? '').toUpperCase();
    if (COMMUNITY_FORBIDDEN_COMMANDS.has(name))
      return `${name} is not allowed in a community level (it changes the server, not the level's own keys).`;
    if (argv.some((a) => a.startsWith('game:')))
      return 'The game:* key prefix belongs to the engine; use a prefix of your own.';
  }
  return null;
}

export async function playtest(deps: PlaytestDeps, input: PlaytestInput): Promise<PlaytestResult> {
  const { level, ctx } = input;
  const lv = level.level;
  const runs: PlaytestRun[] = [];
  const keys = new Set<string>();

  type Plan = {
    name: string;
    expect: Expected;
    because?: string;
    lines: string[];
    answers: Answers;
  };
  const plans: Plan[] = [];
  let setupArgvs: string[][] = [];

  if (lv.mode === 'decision') {
    const quizIndexes = lv.verify.flatMap((v, i) => (v.type === 'quiz' ? [i] : []));
    const reference = new Set(lv.solutions.reference);
    const answersFor = (swap?: string): Answers => {
      const a: Answers = {};
      for (const i of quizIndexes) {
        const q = lv.verify[i];
        if (!q || q.type !== 'quiz') continue;
        const ids = q.options.map((o) => o.id);
        a[String(i)] = swap && ids.includes(swap) ? [swap] : ids.filter((id) => reference.has(id));
      }
      return a;
    };
    plans.push({ name: 'reference', expect: 'right', lines: [], answers: answersFor() });
    for (const w of lv.solutions.wrong)
      plans.push({
        name: w.option,
        expect: 'wrong',
        because: w.because,
        lines: [],
        answers: answersFor(w.option),
      });
  } else if (lv.mode === 'cli') {
    const read = (rel: string) => input.scripts.get(rel);
    const refText = read(lv.solutions.reference);
    if (refText === undefined || scriptLines(refText).length === 0)
      return refuse('The reference solution is empty: write the commands that solve the level.');
    plans.push({ name: 'reference', expect: 'right', lines: scriptLines(refText), answers: {} });
    for (const w of lv.solutions.wrong) {
      const text = read(w.path);
      if (text === undefined) return refuse(`The known-wrong solution ${w.path} has no text.`);
      plans.push({
        name: w.path,
        expect: w.expect,
        because: w.because,
        lines: scriptLines(text),
        answers: {},
      });
    }
    const setup = renderTemplates(lv.setup ?? [], ctx);
    setupArgvs = setup.flatMap((s) => ('cmd' in s ? [s.cmd] : []));
  } else {
    return refuse(`The play-test runs cli and decision levels; this one is ${lv.mode}.`);
  }

  // Everything that will be run, parsed once.
  const parsed: Map<string, string[] | null> = new Map();
  const planArgv = (p: Plan) =>
    p.lines.map((l) => {
      if (!parsed.has(l)) parsed.set(l, render(l, ctx));
      return parsed.get(l) ?? null;
    });
  const all: string[][] = [...setupArgvs];
  for (const p of plans) {
    for (const [i, argv] of planArgv(p).entries()) {
      if (argv === null)
        return refuse(`${p.name}, line ${i + 1}: the quotes in "${p.lines[i]}" do not close.`);
      all.push(argv);
    }
  }
  const refused = refusalFor(all);
  if (refused) return refuse(refused);

  // Which keys would these commands write, and is any of them somebody's data already?
  for (const argv of all) {
    try {
      const got = (await deps.send(['COMMAND', 'GETKEYS', ...argv])) as unknown;
      if (Array.isArray(got)) for (const k of got) keys.add(String(k));
    } catch {
      // a command without keys (PING, TIME): nothing to protect
    }
  }
  const taken: string[] = [];
  for (const k of keys) if (Number(await deps.send(['EXISTS', k])) > 0) taken.push(k);
  if (taken.length > 0) {
    return refuse(
      `${taken.length === 1 ? 'The key' : 'These keys'} ${taken.map((k) => `"${k}"`).join(', ')} already ${taken.length === 1 ? 'exists' : 'exist'} in your Redis, and the play-test would overwrite ${taken.length === 1 ? 'it' : 'them'}. Rename the key in your level (a prefix of your own, like "${ctx.chapter.id}:") or delete the key yourself first.`,
    );
  }

  const clean = async () => {
    const list = [...keys];
    for (let i = 0; i < list.length; i += 100)
      await deps.send(['UNLINK', ...list.slice(i, i + 100)]);
  };

  try {
    for (const p of plans) {
      await clean();
      for (const argv of setupArgvs) await deps.send(argv);
      const transcript: PlaytestRun['transcript'] = [];
      for (const line of p.lines) {
        const r = await deps.cli(renderTemplate(line, ctx));
        transcript.push({
          line: renderTemplate(line, ctx),
          reply: r.reply,
          type: r.type,
          ms: r.ms,
        });
      }
      const outcome = await deps.verify(level, ctx, p.answers);
      runs.push({
        name: p.name,
        expect: p.expect,
        ...(p.because !== undefined ? { because: p.because } : {}),
        verdict: outcome.verdict,
        ok: outcome.verdict === p.expect,
        transcript,
        outcome,
      });
    }
  } finally {
    await clean().catch(() => undefined);
  }
  return {
    passed: runs.length > 0 && runs.every((r) => r.ok),
    refused: null,
    runs,
    keys: [...keys],
  };
}
