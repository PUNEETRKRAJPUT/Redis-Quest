// E-02: "Run traffic: <scenario> (10 s)". Puts the app under the level's scenario so a planted fault shows up in
// INFO, SLOWLOG and CLIENT LIST. Nothing is graded; it shares the verifier's guard, so a 409 means wait.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { LoadStartResponse, LoadStatus } from '../types';

export const TRAFFIC_SECONDS = 10;
export const TRAFFIC_BLOCKED_COPY = 'wait for the verifier';
/** How long the button stays disabled after a 409 before it can be tried again. */
export const TRAFFIC_BLOCKED_MS = 4000;

export type StartTraffic = (scenario: string, durationSec: number) => Promise<LoadStartResponse>;

export type ClickOutcome =
  | { kind: 'started'; endsAtMs: number }
  | { kind: 'blocked'; message: string }
  | { kind: 'failed'; message: string };

/** What clicking the button does: ask the engine to start the run. Never throws. */
export async function clickRunTraffic(
  scenario: string,
  start: StartTraffic = api.loadStart,
): Promise<ClickOutcome> {
  try {
    const r = await start(scenario, TRAFFIC_SECONDS);
    return { kind: 'started', endsAtMs: Date.parse(r.endsAt) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'verify_in_progress')
      return { kind: 'blocked', message: TRAFFIC_BLOCKED_COPY };
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Whole seconds left, rounded up, from the engine's clock when it sent one. */
export function remainingSeconds(
  endsAtMs: number,
  nowMs: number = Date.now(),
  engineNowMs?: number,
): number {
  const skew = engineNowMs === undefined ? 0 : engineNowMs - nowMs;
  return Math.max(0, Math.ceil((endsAtMs - (nowMs + skew)) / 1000));
}

export function describeLast(last: NonNullable<LoadStatus['last']>): string {
  const p99 = Math.round(last.p99Ms * 10) / 10;
  return `${Math.round(last.rps)} req/s, p99 ${p99} ms, ${last.errors} errors`;
}

/** Pure view, so it renders the same on the server in tests. */
export function RunTrafficView({
  scenario,
  running = false,
  remainingSec = 0,
  blocked = false,
  message = null,
  last = null,
  onClick,
}: {
  scenario: string;
  running?: boolean;
  remainingSec?: number;
  blocked?: boolean;
  message?: string | null;
  last?: LoadStatus['last'];
  onClick?: () => void;
}) {
  const label = running
    ? `running… ${remainingSec} s`
    : blocked
      ? TRAFFIC_BLOCKED_COPY
      : `Run traffic: ${scenario} (${TRAFFIC_SECONDS} s)`;
  return (
    <div className="run-traffic" data-testid="run-traffic-box">
      <button
        type="button"
        className="btn"
        disabled={running || blocked}
        onClick={onClick}
        data-testid="run-traffic"
        data-running={running ? 'true' : 'false'}
      >
        {label}
      </button>
      {message ? (
        <span className="run-traffic-msg" role="alert" data-testid="run-traffic-msg">
          {message}
        </span>
      ) : null}
      {last ? (
        <p className="run-traffic-last" data-testid="run-traffic-last">
          Last run{last.scenario ? ` of ${last.scenario}` : ''}: {describeLast(last)}
        </p>
      ) : null}
    </div>
  );
}

export function RunTraffic({ scenario }: { scenario: string }) {
  const [status, setStatus] = useState<LoadStatus | null>(null);
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [, tick] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);

  const poll = useCallback(async () => {
    try {
      const s = await api.loadStatus();
      if (!alive.current) return;
      setStatus(s);
      setEndsAtMs(s.running && s.endsAt ? Date.parse(s.endsAt) : null);
    } catch {
      // The engine may be restarting; the next poll tries again.
    }
  }, []);

  // Once on mount (a run may be in flight, and `last` may be there), then every second while one runs.
  useEffect(() => {
    alive.current = true;
    void poll();
    return () => {
      alive.current = false;
    };
  }, [poll]);
  const running = status?.running === true || endsAtMs !== null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      void poll();
    }, 1000);
    return () => clearInterval(id);
  }, [running, poll]);

  const engineNow = status?.now ? Date.parse(status.now) : undefined;
  const remaining = endsAtMs === null ? 0 : remainingSeconds(endsAtMs, Date.now(), engineNow);

  return (
    <RunTrafficView
      scenario={scenario}
      running={running}
      remainingSec={remaining}
      blocked={blocked}
      message={message}
      last={status?.last ?? null}
      onClick={() => {
        setMessage(null);
        void clickRunTraffic(scenario).then((o) => {
          if (o.kind === 'started') {
            setEndsAtMs(o.endsAtMs);
            void poll();
          } else if (o.kind === 'blocked') {
            setBlocked(true);
            setTimeout(() => alive.current && setBlocked(false), TRAFFIC_BLOCKED_MS);
          } else setMessage(o.message);
        });
      }}
    />
  );
}
