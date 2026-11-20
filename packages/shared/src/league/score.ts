// The scorer: pure apart from the one function it is given to run a command. Empty the scratch database, run the hole's
// setup, run the entry, run the hole's checks. A failed check means no score. The score is the number of commands;
// ties break on the bytes the checked keys use, then on the entry's length in characters.

import type { RedisCheck } from '../levels/schema.js';
import { evaluateAssertion, formatArgv, normalizeReply, type Reply } from './evaluate.js';
import type { ParsedEntry } from './entry.js';
import { refusalFor } from './refuse.js';
import type { Hole } from './schema.js';

/** Runs one command on the scratch database. A Redis error reply must reject; the resolved value is the raw reply. */
export type RunCommand = (argv: string[]) => Promise<unknown>;

/**
 * The logical database the league uses. The game's own keys (`game:*`) live in database 0 and no level selects another
 * database, so database 7 is free; scoring empties it every time, so nothing the player keeps there survives.
 */
export const LEAGUE_DB = 7;

export interface HoleRef {
  id: string;
  hole: Hole;
}

export interface CheckOutcome {
  cmd: string;
  ok: boolean;
  expected: string;
  observed: string;
  /** What to show when `ok` is false. */
  feedback: string;
}

export type ScoreFailure =
  'refused' | 'not_scratch' | 'runner_failed' | 'setup_failed' | 'command_failed' | 'checks_failed';

export type ScoreResult =
  | {
      ok: true;
      holeId: string;
      handle: string;
      commands: number;
      bytes: number;
      chars: number;
      par: number;
      /** Positive: that many commands under par. Negative: over par. */
      underPar: number;
      checks: CheckOutcome[];
    }
  | {
      ok: false;
      holeId: string;
      handle: string;
      reason: ScoreFailure;
      message: string;
      /** The entry line that failed, for `refused` and `command_failed`. */
      line?: number;
      checks: CheckOutcome[];
    };

class ScratchError extends Error {}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Refuses to go on unless the connection is on the expected scratch database. `CLIENT INFO` names it as `db=<n>`.
 * (Not in docs/redis-docs-digest.md: not verified, scripts/check/D-07.sh and CI exercise it against redis:8.)
 */
export async function assertScratch(run: RunCommand, scratchDb: number): Promise<void> {
  if (!Number.isInteger(scratchDb) || scratchDb <= 0) {
    throw new ScratchError('database 0 holds the game; scoring never touches it');
  }
  const reply = String(normalizeReply(await run(['CLIENT', 'INFO'])));
  const m = /(?:^|\s)db=(\d+)(?:\s|$)/.exec(reply);
  if (!m) throw new ScratchError('could not confirm which database the scoring connection is on');
  if (Number(m[1]) !== scratchDb) {
    throw new ScratchError(
      `the scoring connection is on database ${m[1]}, not the scratch database ${scratchDb}; nothing was run`,
    );
  }
}

/** The arguments of every check, in order, once each: the candidates for "keys the checks name". */
export function keysNamedBy(checks: readonly Pick<RedisCheck, 'cmd'>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of checks) {
    for (const a of c.cmd.slice(1)) {
      if (!seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}

async function runChecks(run: RunCommand, checks: readonly RedisCheck[]): Promise<CheckOutcome[]> {
  const out: CheckOutcome[] = [];
  for (const check of checks) {
    const cmd = formatArgv(check.cmd);
    let reply: Reply;
    try {
      reply = normalizeReply(await run(check.cmd));
    } catch (e) {
      const observed = `an error: ${errorText(e)}`;
      const expected = evaluateAssertion(check, null).expected;
      out.push({
        cmd,
        ok: false,
        expected,
        observed,
        feedback: feedback(check, cmd, expected, observed),
      });
      continue;
    }
    const o = evaluateAssertion(check, reply);
    out.push({
      cmd,
      ok: o.ok,
      expected: o.expected,
      observed: o.observed,
      feedback: o.ok ? '' : feedback(check, cmd, o.expected, o.observed),
    });
  }
  return out;
}

/** Same wording as the engine's checkFeedback: `<message> (expected X, got Y)`, or the command leads the line. */
function feedback(check: RedisCheck, cmd: string, expected: string, observed: string): string {
  const tail = `expected ${expected}, got ${observed}`;
  return check.message ? `${check.message} (${tail})` : `${cmd}: ${tail}`;
}

/** Bytes the checked keys use: MEMORY USAGE summed over the check arguments that are keys (nil and errors count 0). */
async function bytesUsed(run: RunCommand, checks: readonly RedisCheck[]): Promise<number> {
  let total = 0;
  for (const key of keysNamedBy(checks)) {
    try {
      const reply = normalizeReply(await run(['MEMORY', 'USAGE', key]));
      if (typeof reply === 'number') total += reply;
    } catch {
      // not a key, or the command is unavailable: it adds nothing
    }
  }
  return total;
}

export interface ScoreOptions {
  scratchDb?: number;
}

export async function scoreEntry(
  ref: HoleRef,
  entry: ParsedEntry,
  run: RunCommand,
  opts: ScoreOptions = {},
): Promise<ScoreResult> {
  const scratchDb = opts.scratchDb ?? LEAGUE_DB;
  const base = { holeId: ref.id, handle: entry.handle };
  const fail = (
    reason: ScoreFailure,
    message: string,
    extra: { line?: number; checks?: CheckOutcome[] } = {},
  ): ScoreResult => ({
    ok: false,
    ...base,
    reason,
    message,
    checks: extra.checks ?? [],
    ...(extra.line !== undefined ? { line: extra.line } : {}),
  });

  // Defence in depth: parseEntry already refuses these, but a caller may build an entry by hand.
  for (const c of entry.commands) {
    const why = refusalFor(c.argv);
    if (why) return fail('refused', `line ${c.line}: ${why}`, { line: c.line });
  }

  try {
    await assertScratch(run, scratchDb);
  } catch (e) {
    return fail(e instanceof ScratchError ? 'not_scratch' : 'runner_failed', errorText(e));
  }

  try {
    try {
      await run(['FLUSHDB']);
    } catch (e) {
      return fail('runner_failed', `could not empty the scratch database: ${errorText(e)}`);
    }
    for (const step of ref.hole.setup ?? []) {
      try {
        await run(step.cmd);
      } catch (e) {
        return fail(
          'setup_failed',
          `the hole's own setup failed on ${formatArgv(step.cmd)}: ${errorText(e)}`,
        );
      }
    }
    for (const c of entry.commands) {
      try {
        await run(c.argv);
      } catch (e) {
        return fail('command_failed', `line ${c.line} (${c.text}): ${errorText(e)}`, {
          line: c.line,
        });
      }
    }
    const checks = await runChecks(run, ref.hole.checks);
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      return fail('checks_failed', failed.map((c) => c.feedback).join('\n'), { checks });
    }
    const bytes = await bytesUsed(run, ref.hole.checks);
    const commands = entry.commands.length;
    return {
      ok: true,
      ...base,
      commands,
      bytes,
      chars: entry.chars,
      par: ref.hole.par,
      underPar: ref.hole.par - commands,
      checks,
    };
  } finally {
    // Leave the scratch database empty. Best effort: the next score empties it again anyway.
    try {
      await run(['FLUSHDB']);
    } catch {
      // nothing to do
    }
  }
}
