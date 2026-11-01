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

export function useRedis(argv: string[] | null, refreshMs = 2000): RedisRead {
  const [state, setState] = useState<RedisRead>({ reply: null, error: null, loading: argv !== null, at: null });
  const key = argv ? JSON.stringify(argv) : '';
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!argv) {
      setState({ reply: null, error: null, loading: false, at: null });
      return () => {
        alive.current = false;
      };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const reply = await readRedis(argv);
        if (!alive.current) return;
        setState(reply.kind === 'error' ? { reply: null, error: reply.v, loading: false, at: Date.now() } : { reply, error: null, loading: false, at: Date.now() });
      } catch (e) {
        if (alive.current) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
      if (alive.current && refreshMs > 0) timer = setTimeout(() => void tick(), refreshMs);
    };
    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
    // `key` stands in for the argv array identity.
  }, [key, refreshMs]);
  return state;
}
