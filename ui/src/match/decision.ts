// The verdict moment, as pure functions: when the big screen reveals the decision, how long it stays up, and how
// a check's `details` turn into "expected / actual" lines. Kept free of React so the timing is unit-tested.
import type { CheckResult, Verdict } from '../types';

/** "Decision pending" stays up at least this long, so it reads as a review and not as a flicker. */
export const MIN_PENDING_MS = 800;
/** When the engine is slower than the minimum, a short beat after the answer before the reveal (under 300ms). */
export const LATE_BEAT_MS = 220;
/** How long the decision stays on the big screen before it gets out of the way. */
export const HOLD_MS: Record<Verdict, number> = {
  right: 1700,
  works_but_wrong: 1500,
  wrong: 1100,
  not_implemented: 900,
};

/**
 * When to reveal the verdict, in the same clock as the inputs (performance.now()). At least MIN_PENDING_MS after
 * the click; if the answer came later than that, LATE_BEAT_MS after the answer. Reduced motion: at once.
 */
export function revealAt(clickAt: number, responseAt: number, reduced: boolean): number {
  if (reduced) return responseAt;
  const floor = clickAt + MIN_PENDING_MS;
  return responseAt >= floor ? responseAt + LATE_BEAT_MS : floor;
}

export type Phase = 'idle' | 'pending' | 'verdict' | 'done';

/** Failing checks first (the player's next step), then the rest, each group in check order. */
export function orderChecks<T extends Pick<CheckResult, 'ok' | 'index'>>(checks: T[]): T[] {
  return [...checks].sort((a, b) => Number(a.ok) - Number(b.ok) || a.index - b.index);
}

export type Evidence = { label?: string; expected: string; actual: string };

const str = (v: unknown): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? 'nothing' : JSON.stringify(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const EXPECTED_GOT = /expected (.+?), got (.+?)(?:\s+\(|$)/;

/**
 * Expected and actual values for a failed check, from whatever its `details` carry (docs: engine/src/verify):
 * redis checks give `items[]` of { cmd, ok, expected, observed }, traffic checks `assertions[]` of
 * { key, ok, value, needs }, behaviour checks `assertions[]` whose feedback reads "expected X, got Y" and whose
 * `sideEffects` are redis items. Anything else with `expected` and `actual`/`observed` works too. At most `max`.
 */
export function evidenceOf(details: unknown, max = 4): Evidence[] {
  if (!isObj(details)) return [];
  const out: Evidence[] = [];
  const push = (e: Evidence) => {
    if (out.length < max) out.push(e);
  };
  const fromItem = (it: unknown) => {
    if (!isObj(it) || it.ok === true) return;
    if ('expected' in it && ('observed' in it || 'actual' in it)) {
      push({
        label: typeof it.cmd === 'string' ? it.cmd : undefined,
        expected: str(it.expected),
        actual: str('observed' in it ? it.observed : it.actual),
      });
      return;
    }
    if ('needs' in it && 'value' in it) {
      push({
        label: typeof it.key === 'string' ? it.key : undefined,
        expected: str(it.needs),
        actual: str(it.value),
      });
      return;
    }
    const side = Array.isArray(it.sideEffects)
      ? it.sideEffects.filter((s) => isObj(s) && !s.ok)
      : [];
    if (side.length) {
      side.forEach(fromItem);
      return;
    }
    if (typeof it.feedback === 'string') {
      const m = EXPECTED_GOT.exec(it.feedback);
      if (m) push({ expected: m[1]!, actual: m[2]! });
    }
  };
  if ('expected' in details && ('actual' in details || 'observed' in details)) {
    push({
      expected: str(details.expected),
      actual: str('actual' in details ? details.actual : details.observed),
    });
  }
  for (const list of [details.items, details.assertions])
    if (Array.isArray(list)) list.forEach(fromItem);
  return out;
}

/** The short word on the big screen, and the one-line flavour under it. Plain words lead; cricket is the costume. */
export const BIG_SCREEN: Record<
  Verdict,
  { word: string; flavour: string; tone: 'turf' | 'flood' | 'wicket' | 'sky' }
> = {
  right: { word: 'Passed', flavour: 'Not out. The crowd goes up.', tone: 'turf' },
  works_but_wrong: {
    word: 'Works, but…',
    flavour: 'It survives tonight. It will not survive the final.',
    tone: 'flood',
  },
  wrong: {
    word: 'Not yet',
    flavour: 'Back to the crease. The scoreboard says where.',
    tone: 'wicket',
  },
  not_implemented: { word: 'No decision', flavour: 'The verifier is not installed.', tone: 'sky' },
};
