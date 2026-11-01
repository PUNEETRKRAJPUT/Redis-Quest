// F-12: the interview-mode pieces of a level screen: the countdown, the hint-cost prompt copy, "rebuilt in".
import { useEffect, useState } from 'react';
import { hrefFor } from '../router';
import type { InterviewInfo, LevelData } from '../types';

/** m:ss, rounding a countdown up (so 0:00 appears only when the time is really gone) and an elapsed time down. */
export function formatClock(ms: number, round: 'up' | 'down' = 'down'): string {
  const total = Math.max(0, round === 'up' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Where the clock stands `sinceMs` after a snapshot of the server's answer: positive is time left, negative is
 * how far past the deadline. The server clamps `remainingMs` at 0 and reports `overtimeMs` separately.
 */
export function signedRemaining(remainingMs: number, overtimeMs: number, sinceMs: number): number {
  return remainingMs - overtimeMs - sinceMs;
}

export type ClockView =
  | { state: 'waiting'; text: string }
  | { state: 'running'; text: string }
  | { state: 'overtime'; text: string }
  | { state: 'done'; text: string };

/** What the countdown shows. `since` is how long ago (ms) the level response was received. */
export function clockView(
  iv: InterviewInfo,
  remainingMs: number | null,
  passed: boolean,
  since: number,
): ClockView {
  if (passed && iv.elapsedMs !== null) {
    return {
      state: 'done',
      text: `Rebuilt in ${formatClock(iv.elapsedMs)}${iv.overtime ? ' (overtime)' : ''}`,
    };
  }
  if (remainingMs === null)
    return { state: 'waiting', text: `${iv.minutes}:00 starts when you begin` };
  const left = signedRemaining(remainingMs, iv.overtimeMs, since);
  if (left >= 0) return { state: 'running', text: `${formatClock(left, 'up')} left` };
  return { state: 'overtime', text: `Overtime +${formatClock(-left)}` };
}

/** "rebuilt in m:ss", with the overtime noted plainly. Null until the level is passed with a recorded time. */
export function rebuiltIn(iv: InterviewInfo | null | undefined): string | null {
  if (!iv || iv.elapsedMs === null) return null;
  return iv.overtime
    ? `rebuilt in ${formatClock(iv.elapsedMs)}, over the ${iv.minutes}:00 limit`
    : `rebuilt in ${formatClock(iv.elapsedMs)}`;
}

/** What the confirm prompt tells the learner. XP never goes below 0, so a poor learner pays less. */
export function hintCostCopy(cost: number, xp: number): string {
  if (cost === 0) return 'This hint is free.';
  if (xp >= cost)
    return `This hint costs ${cost} XP. You have ${xp} XP, so you would keep ${xp - cost}.`;
  return `This hint costs ${cost} XP. You have ${xp} XP, so it takes all of it and you keep 0 (XP never goes below 0).`;
}

export function hintButtonLabel(cost: number, shown: number, total: number): string {
  if (shown >= total) return 'No more hints';
  const price = cost === 0 ? 'free' : `costs ${cost} XP`;
  return `Show a hint (${price}) (${shown} of ${total})`;
}

/** The countdown in the level header. Ticks once a second from the server's snapshot; stops when passed. */
export function Countdown({ level }: { level: LevelData }) {
  const iv = level.interview;
  // A fresh answer from the engine re-anchors the local clock (the engine's clock is the one that counts).
  const [anchor, setAnchor] = useState(() => performance.now());
  useEffect(() => setAnchor(performance.now()), [level]);
  const [, tick] = useState(0);
  const passed = level.status === 'passed';
  useEffect(() => {
    if (!iv || passed) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [iv, passed]);
  if (!iv) return null;
  const v = clockView(iv, level.remainingMs, passed, performance.now() - anchor);
  return (
    <p className={`countdown ${v.state}`} data-testid="countdown" data-state={v.state} role="timer">
      <span className="sr-only">Interview clock: </span>
      {v.text}
      {v.state === 'overtime' ? (
        <span className="sr-only" role="status">
          . Time is up. You can keep going; a verify now is marked overtime.
        </span>
      ) : null}
    </p>
  );
}

/** Beat 7 on an interview level: points at the guided level whose solutions this one repeats. */
export function RebuildLink({ interview }: { interview: InterviewInfo }) {
  return (
    <p data-testid="ideal-rebuild-link">
      This level rebuilds{' '}
      <a href={hrefFor({ name: 'level', id: interview.rebuildOf.id })}>
        {interview.rebuildOf.title ?? interview.rebuildOf.id}
      </a>
      . That level&apos;s ideal-way beat holds its reference solution and the wrong ones.
    </p>
  );
}
