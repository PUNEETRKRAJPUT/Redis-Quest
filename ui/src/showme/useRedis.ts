import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { parseReply, toCommand } from '../redisReply';
import type { Reply } from '../redisReply';

export interface RedisRead {
  reply: Reply | null;
  error: string | null;
  loading: boolean;
  at: number | null;
}

/** Read-only polling of one Redis command through POST /api/cli (the same connection the terminal uses). */
export async function readRedis(argv: string[]): Promise<Reply> {
  const r = await api.cli(toCommand(argv));
  return parseReply(r.reply);
}

// ---- polling: polite by construction -------------------------------------------------------------------------
// One shared rule for every panel: the cadence the panel asked for, no requests while the tab is hidden, an
// immediate refresh when it becomes visible again, and an immediate refresh after a hands-on command so the
// player sees the change land without waiting for the next tick.
const pokes = new Set<() => void>();

/** Ask every mounted panel to read again now (after a command ran). */
export function refreshRedisNow(): void {
  pokes.forEach((p) => p());
}

const hidden = () => typeof document !== 'undefined' && document.hidden;

/** Runs `task` now and then every `ms` while the tab is visible. `key` restarts the loop when it changes. */
export function usePoll(task: () => Promise<void>, ms: number, key: string): void {
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  });
  useEffect(() => {
    let alive = true;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (alive && ms > 0) timer = setTimeout(() => void tick(), ms);
    };
    const tick = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      if (running) {
        again = true;
        return;
      }
      if (hidden()) {
        schedule();
        return;
      }
      running = true;
      try {
        await latest.current();
      } catch {
        // each task keeps its own error state
      }
      running = false;
      if (!alive) return;
      if (again) {
        again = false;
        void tick();
      } else schedule();
    };
    const poke = () => void tick();
    const onVisible = () => {
      if (!hidden()) poke();
    };
    pokes.add(poke);
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      pokes.delete(poke);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, ms]);
}

export function useRedis(argv: string[] | null, refreshMs = 2000): RedisRead {
  const [state, setState] = useState<RedisRead>({
    reply: null,
    error: null,
    loading: argv !== null,
    at: null,
  });
  const key = argv ? JSON.stringify(argv) : '';
  const argvRef = useRef(argv);
  useEffect(() => {
    argvRef.current = argv;
  });
  useEffect(() => {
    if (!argv) setState({ reply: null, error: null, loading: false, at: null });
    // `key` stands in for the argv array identity.
  }, [key]);
  usePoll(
    async () => {
      const a = argvRef.current;
      if (!a) return;
      try {
        const reply = await readRedis(a);
        setState(
          reply.kind === 'error'
            ? { reply: null, error: reply.v, loading: false, at: Date.now() }
            : { reply, error: null, loading: false, at: Date.now() },
        );
      } catch (e) {
        setState((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        }));
      }
    },
    argv ? refreshMs : 0,
    key,
  );
  return state;
}
