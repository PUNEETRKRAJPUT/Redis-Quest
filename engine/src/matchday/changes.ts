// What a card does to the player's Redis, and how each change is undone. Every function takes a small `RedisPort`
// so it can be tested with a fake; the engine passes its main Redis link. Nothing here ever names a `game:*` key.

import { prefixProblem, RESERVED_PREFIX } from '@quest/shared';

export interface RedisPort {
  send(argv: string[]): Promise<unknown>;
}

/** The old value of maxmemory, written to disk before it is lowered so a crash cannot lose it. */
export interface UndoEntry {
  maxmemory: string;
  setAt: string;
}

export interface UndoJournal {
  read(): Promise<UndoEntry | null>;
  write(e: UndoEntry): Promise<void>;
  clear(): Promise<void>;
}

/** The lua loop of block_script: counts, touches no key, writes nothing. */
export const BLOCK_SCRIPT = 'local x = 0 for i = 1, tonumber(ARGV[1]) do x = x + i end return x';

const MAX_SCAN_PAGES = 100_000;

/** Reads one value out of a CONFIG GET reply, whether it came back as a flat array, a Map or an object. */
export function configValue(reply: unknown, name: string): string | null {
  if (Array.isArray(reply)) {
    for (let i = 0; i + 1 < reply.length; i += 2)
      if (String(reply[i]) === name) return String(reply[i + 1]);
    return null;
  }
  if (reply instanceof Map) {
    const v = reply.get(name);
    return v === undefined ? null : String(v);
  }
  if (reply && typeof reply === 'object') {
    const v = (reply as Record<string, unknown>)[name];
    return v === undefined ? null : String(v);
  }
  return null;
}

/** `used_memory` in bytes out of the text of INFO memory, or null. */
export function usedMemory(info: unknown): number | null {
  const m = /^used_memory:(\d+)\s*$/m.exec(String(info));
  return m ? Number(m[1]) : null;
}

/** Deletes every key that starts with one of `prefixes` (SCAN, then DEL), returns how many it deleted. */
export async function deleteKeys(redis: RedisPort, prefixes: readonly string[]): Promise<number> {
  for (const p of prefixes) {
    const problem = prefixProblem(p);
    if (problem) throw new Error(`refused to delete keys under "${p}": ${problem}`);
  }
  let total = 0;
  for (const prefix of prefixes) {
    let cursor = '0';
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const reply = (await redis.send(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', '200'])) as [
        unknown,
        unknown,
      ];
      cursor = String(reply[0]);
      const found = Array.isArray(reply[1]) ? (reply[1] as unknown[]).map(String) : [];
      // SCAN may return a key twice or a key outside the pattern's meaning; only ours, never the engine's.
      const keys = found.filter((k) => k.startsWith(prefix) && !k.startsWith(RESERVED_PREFIX));
      if (keys.length > 0) total += Number(await redis.send(['DEL', ...keys])) || 0;
      if (cursor === '0') break;
    }
  }
  return total;
}

export interface LowerResult {
  applied: boolean;
  /** One line for the war room: what was set, or why nothing was. */
  note: string;
}

/**
 * Sets maxmemory to used_memory plus `headroomKb`. Only when the policy is noeviction (eviction could remove keys
 * that are not caches, the engine's own `game:*` keys among them) and only when that makes the limit tighter than
 * the one in force. The old value is journaled before CONFIG SET.
 */
export async function lowerMaxmemory(
  redis: RedisPort,
  journal: UndoJournal,
  headroomKb: number,
  now: () => string,
): Promise<LowerResult> {
  const policy = configValue(
    await redis.send(['CONFIG', 'GET', 'maxmemory-policy']),
    'maxmemory-policy',
  );
  if (policy !== 'noeviction')
    return {
      applied: false,
      note: `maxmemory was left alone: your maxmemory-policy is ${policy ?? 'unknown'}, and this card is only played with noeviction (eviction could remove keys that are not caches)`,
    };
  const old = configValue(await redis.send(['CONFIG', 'GET', 'maxmemory']), 'maxmemory');
  if (old === null || !/^\d+$/.test(old))
    return {
      applied: false,
      note: 'maxmemory was left alone: its current value could not be read',
    };
  const used = usedMemory(await redis.send(['INFO', 'memory']));
  if (used === null)
    return { applied: false, note: 'maxmemory was left alone: used_memory could not be read' };
  const target = used + headroomKb * 1024;
  if (old !== '0' && Number(old) <= target)
    return {
      applied: false,
      note: `maxmemory was left alone: it is already ${old} bytes, at or below the limit this card would set`,
    };
  await journal.write({ maxmemory: old, setAt: now() });
  try {
    await redis.send(['CONFIG', 'SET', 'maxmemory', String(target)]);
  } catch (err) {
    await restoreMaxmemory(redis, journal).catch(() => undefined);
    throw err;
  }
  return {
    applied: true,
    note: `maxmemory set to ${target} bytes (in use ${used} plus ${headroomKb} KiB); it was ${old}`,
  };
}

/** Puts maxmemory back to the journaled value and clears the journal. Does nothing when there is no journal. */
export async function restoreMaxmemory(redis: RedisPort, journal: UndoJournal): Promise<boolean> {
  const entry = await journal.read();
  if (!entry) return false;
  await redis.send(['CONFIG', 'SET', 'maxmemory', entry.maxmemory]);
  await journal.clear();
  return true;
}

/** Runs the bounded blocking script once; resolves when Redis has answered. */
export async function runBlockScript(redis: RedisPort, iterations: number): Promise<void> {
  await redis.send(['EVAL', BLOCK_SCRIPT, '0', String(iterations)]);
}
