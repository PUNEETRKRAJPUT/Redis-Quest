// D-09: the match runner against fakes: a fake Redis, a fake traffic route, a fake clock. No stack needed.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { emptyResults, loadDeck, type Deck, type MatchResult } from '@quest/shared';
import type { UndoEntry, UndoJournal } from '../src/matchday/changes.js';
import {
  MatchRefusedError,
  MatchRunner,
  type LoadPort,
  type LoadStatusView,
} from '../src/matchday/runner.js';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '../..');

class FakeRedis {
  isUp = true;
  kind: string | null = 'single';
  keys = new Set<string>();
  config: Record<string, string> = { maxmemory: '0', 'maxmemory-policy': 'noeviction' };
  used = 1_000_000;
  calls: string[][] = [];

  async send(argv: string[]): Promise<unknown> {
    this.calls.push(argv);
    const cmd = argv[0];
    if (cmd === 'SCAN') {
      const pattern = String(argv[3]);
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...this.keys].filter((k) => k.startsWith(prefix))];
    }
    if (cmd === 'DEL') {
      let n = 0;
      for (const k of argv.slice(1)) if (this.keys.delete(k)) n++;
      return n;
    }
    if (cmd === 'CONFIG' && argv[1] === 'GET') {
      const name = String(argv[2]);
      return [name, this.config[name] ?? ''];
    }
    if (cmd === 'CONFIG' && argv[1] === 'SET') {
      this.config[String(argv[2])] = String(argv[3]);
      return 'OK';
    }
    if (cmd === 'INFO') return `# Memory\r\nused_memory:${this.used}\r\n`;
    if (cmd === 'EVAL') return 0;
    throw new Error(`unexpected command ${argv.join(' ')}`);
  }

  count(cmd: string): number {
    return this.calls.filter((c) => c[0] === cmd).length;
  }
}

class MemoryJournal implements UndoJournal {
  entry: UndoEntry | null = null;
  async read() {
    return this.entry;
  }
  async write(e: UndoEntry) {
    this.entry = e;
  }
  async clear() {
    this.entry = null;
  }
}

interface Measure {
  requests: number;
  errors: number;
  status5xx: number;
  p99Ms: number;
}
const GOOD: Measure = { requests: 1000, errors: 0, status5xx: 0, p99Ms: 100 };
const BAD: Measure = { requests: 1000, errors: 600, status5xx: 600, p99Ms: 900 };

/** A traffic route that is "running" for two status polls, then reports the measurement for the over. */
class FakeLoad implements LoadPort {
  running = false;
  last: LoadStatusView['last'] = null;
  polls = 0;
  runs = 0;
  starts: Array<{ scenario: string; connections: number; durationSec: number }> = [];
  seenAtStart: Array<{ maxmemory: string }> = [];
  refuse: { status: number; code: string } | null = null;
  measure: (n: number) => Measure = () => GOOD;
  failStatusAt: number | null = null;
  failWhenLowered = false;
  refuseAfterRuns: number | null = null;
  stops = 0;
  private scenario = '';

  constructor(private readonly redis: FakeRedis) {}

  async start(o: { scenario: string; durationSec: number; connections: number }) {
    const refusing =
      this.refuse ??
      (this.refuseAfterRuns !== null && this.runs >= this.refuseAfterRuns
        ? { status: 409, code: 'verify_in_progress' }
        : null);
    if (refusing)
      return { ok: false, status: refusing.status, code: refusing.code, message: 'refused' };
    this.starts.push(o);
    this.seenAtStart.push({ maxmemory: this.redis.config.maxmemory ?? '' });
    this.running = true;
    this.polls = 0;
    this.scenario = o.scenario;
    this.runs++;
    return { ok: true, status: 202, code: '', message: '' };
  }

  async status(): Promise<LoadStatusView> {
    if (this.failStatusAt !== null && this.runs >= this.failStatusAt && this.running)
      throw new Error('the traffic route fell over');
    if (this.failWhenLowered && this.running && this.redis.config.maxmemory !== '0')
      throw new Error('the traffic route fell over while maxmemory was lowered');
    if (this.running) {
      this.polls++;
      if (this.polls >= 2) {
        this.running = false;
        const m = this.measure(this.runs);
        this.last = {
          scenario: this.scenario,
          requests: m.requests,
          rps: 100,
          p99Ms: m.p99Ms,
          errors: m.errors,
          status5xx: m.status5xx,
          finishedAt: `run-${this.runs}`,
        };
      }
    }
    return { running: this.running, last: this.last };
  }

  async stop() {
    this.stops++;
    this.running = false;
  }
}

let fullDeck: Deck;
beforeAll(async () => {
  fullDeck = await loadDeck(join(REPO, 'incidents'));
  expect(fullDeck.errors).toEqual([]);
});

function deckOf(...ids: string[]): Deck {
  return { cards: fullDeck.cards.filter((c) => ids.includes(c.id)), errors: [] };
}

function setup(deck: () => Deck = () => fullDeck) {
  const redis = new FakeRedis();
  const load = new FakeLoad(redis);
  const journal = new MemoryJournal();
  const events: Array<{ type: string; data: unknown }> = [];
  const saved: MatchResult[] = [];
  let t = 1_700_000_000_000;
  const runner = new MatchRunner({
    redis,
    load,
    journal,
    bus: { emit: (type: string, data: unknown) => void events.push({ type, data }) },
    results: {
      add: async (r: MatchResult) => {
        saved.push(r);
        return emptyResults();
      },
    },
    loadDeck: async () => deck(),
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    pollMs: 500,
    retriesBetweenOvers: 2,
  });
  const names = () =>
    events.filter((e) => e.type === 'level.event').map((e) => (e.data as { name: string }).name);
  return { redis, load, journal, runner, events, saved, names };
}

describe('a whole match', () => {
  test('plays six overs, scores them, saves the result and leaves Redis as it was', async () => {
    const s = setup();
    const started = await s.runner.start(20261120);
    expect(started.state).toBe('running');
    expect(s.runner.busy).toBe(true);
    await s.runner.settled();

    expect(s.runner.busy).toBe(false);
    const st = s.runner.status();
    expect(st.state).toBe('finished');
    expect(st.scores).toHaveLength(6);
    expect(st.runs).toBe(6 * 36);
    expect(st.wickets).toBe(0);
    expect(st.result?.endedBy).toBe('complete');
    expect(st.result?.text).toContain('seed 20261120');
    expect(s.saved).toHaveLength(1);
    expect(s.load.starts).toHaveLength(6);
    expect(s.journal.entry).toBeNull();
    expect(s.redis.config.maxmemory).toBe('0');
    expect(s.names()[0]).toBe('matchday_started');
    expect(s.names()).toContain('matchday_finished');
    expect(s.names().filter((n) => n === 'matchday_over')).toHaveLength(6);
  });

  test('the fixture is the same on every run of the same seed', async () => {
    const a = setup();
    const b = setup();
    await a.runner.start(777);
    await b.runner.start(777);
    await a.runner.settled();
    await b.runner.settled();
    expect(a.load.starts).toEqual(b.load.starts);
  });

  test('is all out after three wickets and does not bowl the rest', async () => {
    const s = setup();
    s.load.measure = () => BAD;
    await s.runner.start(5);
    await s.runner.settled();
    const st = s.runner.status();
    expect(st.result?.endedBy).toBe('all_out');
    expect(st.scores).toHaveLength(3);
    expect(st.wickets).toBe(3);
    expect(s.load.starts).toHaveLength(3);
  });

  test('a second start while one is running is refused', async () => {
    const s = setup();
    await s.runner.start(5);
    await expect(s.runner.start(6)).rejects.toMatchObject({
      status: 409,
      code: 'match_in_progress',
    });
    await s.runner.settled();
  });
});

describe('refusals change nothing', () => {
  test('refuses while a level check or a traffic run holds the guard', async () => {
    const s = setup();
    s.load.refuse = { status: 409, code: 'verify_in_progress' };
    await expect(s.runner.start(5)).rejects.toBeInstanceOf(MatchRefusedError);
    await expect(s.runner.start(5)).rejects.toMatchObject({
      status: 409,
      code: 'verify_in_progress',
    });
    expect(s.runner.busy).toBe(false);
    expect(s.runner.status().state).toBe('idle');
    expect(s.redis.calls).toEqual([]);
    expect(s.saved).toEqual([]);
  });

  test('refuses when Redis is down or is not a single node', async () => {
    const s = setup();
    s.redis.isUp = false;
    await expect(s.runner.start(5)).rejects.toMatchObject({ code: 'redis_down' });
    s.redis.isUp = true;
    s.redis.kind = 'cluster';
    await expect(s.runner.start(5)).rejects.toMatchObject({ code: 'single_node_only' });
    expect(s.runner.busy).toBe(false);
  });

  test('refuses when the deck cannot be loaded', async () => {
    const s = setup(() => ({ cards: [], errors: [{ file: 'x.yaml', message: 'broken' }] }));
    await expect(s.runner.start(5)).rejects.toMatchObject({
      status: 503,
      code: 'deck_unavailable',
    });
  });
});

describe('cards and their undo', () => {
  test('cache-wiped deletes only cache keys under its prefixes, never game:*', async () => {
    const s = setup(() => deckOf('cache-wiped'));
    for (const k of [
      'cache:player:p-001',
      'cache:player:p-002',
      'cache:match:m-1',
      'cache:other:x',
      'lb:match:m-1',
      'game:engine:boots',
    ])
      s.redis.keys.add(k);
    await s.runner.start(11);
    await s.runner.settled();
    expect([...s.redis.keys].sort()).toEqual([
      'cache:other:x',
      'game:engine:boots',
      'lb:match:m-1',
    ]);
    const dels = s.redis.calls.filter((c) => c[0] === 'DEL').flat();
    expect(dels.some((k) => k.startsWith('game:'))).toBe(false);
    expect(s.runner.status().scores.some((o) => o.cardId === 'cache-wiped')).toBe(true);
  });

  test('the-box-is-full lowers maxmemory for its over and puts the old value back', async () => {
    const s = setup(() => deckOf('the-box-is-full'));
    s.redis.config.maxmemory = '0';
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.load.seenAtStart.some((x) => x.maxmemory !== '0')).toBe(true);
    expect(s.load.seenAtStart.filter((x) => x.maxmemory !== '0')).toHaveLength(1);
    expect(s.redis.config.maxmemory).toBe('0');
    expect(s.journal.entry).toBeNull();
  });

  test('the-box-is-full puts a player-set maxmemory back exactly', async () => {
    const s = setup(() => deckOf('the-box-is-full'));
    s.redis.config.maxmemory = '268435456';
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.redis.config.maxmemory).toBe('268435456');
  });

  test('the-box-is-full is skipped, and says so, unless the policy is noeviction', async () => {
    const s = setup(() => deckOf('the-box-is-full'));
    s.redis.config['maxmemory-policy'] = 'allkeys-lru';
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.redis.calls.some((c) => c[0] === 'CONFIG' && c[1] === 'SET')).toBe(false);
    expect(s.load.seenAtStart.every((x) => x.maxmemory === '0')).toBe(true);
  });

  test('maxmemory is put back when the match ends by an error mid-over', async () => {
    const s = setup(() => deckOf('the-box-is-full'));
    s.load.failWhenLowered = true;
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.runner.status().result?.endedBy).toBe('error');
    expect(s.redis.config.maxmemory).toBe('0');
    expect(s.journal.entry).toBeNull();
  });

  test('a leftover journal from an interrupted match is restored before the next one starts', async () => {
    const s = setup(() => deckOf('the-box-is-full'));
    s.redis.config.maxmemory = '1500000';
    s.journal.entry = { maxmemory: '0', setAt: 'earlier' };
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.redis.config.maxmemory).toBe('0');
    expect(s.journal.entry).toBeNull();
  });

  test('badge-job-at-the-wrong-time sends its script once and waits for it', async () => {
    const s = setup(() => deckOf('badge-job-at-the-wrong-time'));
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.redis.count('EVAL')).toBe(1);
    const eval1 = s.redis.calls.find((c) => c[0] === 'EVAL') as string[];
    expect(eval1[2]).toBe('0'); // no keys
    expect(s.runner.status().result?.endedBy).toBe('complete');
  });

  test('switching scenarios needs no change in Redis', async () => {
    const s = setup(() => deckOf('celebrity-walks-in'));
    await s.runner.start(11);
    await s.runner.settled();
    expect(s.load.starts.some((o) => o.scenario === 'celebrity-100')).toBe(true);
    expect(s.redis.calls).toEqual([]);
  });
});

describe('stopping and failing', () => {
  test('stop ends the match early, scores nothing for the over in play and says it was stopped', async () => {
    const s = setup();
    await s.runner.start(5);
    const r = await s.runner.stop();
    expect(r.stopped).toBe(true);
    const st = s.runner.status();
    expect(st.state).toBe('finished');
    expect(st.result?.endedBy).toBe('stopped');
    expect(st.scores).toHaveLength(0);
    expect(s.load.stops).toBeGreaterThan(0);
    // a stopped match is saved (in "recent") but the store decides it does not count as a best
    expect(s.saved[0]?.endedBy).toBe('stopped');
  });

  test('stop with no match running is not an error', async () => {
    expect(await setup().runner.stop()).toEqual({ stopped: false });
  });

  test('a traffic route that fails ends the match with an error, not a hang', async () => {
    const s = setup();
    s.load.failStatusAt = 2;
    await s.runner.start(5);
    await s.runner.settled();
    const st = s.runner.status();
    expect(st.result?.endedBy).toBe('error');
    expect(st.result?.note).toContain('fell over');
    expect(s.runner.busy).toBe(false);
  });

  test('when another check takes the guard between overs the runner retries, then gives up with an error', async () => {
    const s = setup();
    // Over 1 may start; every later traffic start is refused.
    s.load.refuseAfterRuns = 1;
    await s.runner.start(5);
    await s.runner.settled();
    const st = s.runner.status();
    expect(st.result?.endedBy).toBe('error');
    expect(st.scores).toHaveLength(1);
    expect(s.redis.config.maxmemory).toBe('0');
  });
});
