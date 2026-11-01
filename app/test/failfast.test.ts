import { describe, expect, test } from 'vitest';
import { failFast, RedisCommandTimeoutError } from '@quest/shared';

// A stand-in client: `hGetAll` hangs forever (a Redis that accepted the socket and went quiet), `get`
// answers, and `withAbortSignal` returns a handle like node-redis does.
function fakeClient() {
  const aborted: boolean[] = [];
  const handle = (signal?: AbortSignal) => ({
    hGetAll: () =>
      new Promise<never>(() => {
        signal?.addEventListener('abort', () => aborted.push(true));
      }),
    get: async () => 'v',
  });
  return {
    aborted,
    client: { ...handle(), withAbortSignal: (s: AbortSignal) => handle(s), isOpen: true },
  };
}

describe('failFast', () => {
  test('a command with no reply rejects with RedisCommandTimeoutError and aborts the queued command', async () => {
    const { client, aborted } = fakeClient();
    const wrapped = failFast(client, 100);
    const t0 = Date.now();
    const err = await wrapped.hGetAll().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RedisCommandTimeoutError);
    expect((err as Error).name).toBe('RedisCommandTimeoutError');
    expect((err as Error).message).toContain('hGetAll got no reply within 100 ms');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(aborted).toEqual([true]);
  });

  test('a fast command passes through untouched, properties stay readable', async () => {
    const { client } = fakeClient();
    const wrapped = failFast(client, 100);
    await expect(wrapped.get()).resolves.toBe('v');
    expect(wrapped.isOpen).toBe(true);
  });

  test('0 disables the timeout (the client is returned as is)', () => {
    const { client } = fakeClient();
    expect(failFast(client, 0)).toBe(client);
  });
});
