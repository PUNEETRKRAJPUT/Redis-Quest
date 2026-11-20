import { describe, expect, it } from 'vitest';
import {
  FALLBACK_INFO,
  HEAVY_TICKS,
  MAX_TICKS,
  PAGE_ITEMS,
  TEMPLATES,
  chooseDeck,
  costClassOf,
  costTicks,
  describeSize,
  fallbackDeck,
  wantedNames,
  type DeckCard,
} from '@/features/arcade/cabinets/be-the-redis/cards';
import {
  DURATION_TICKS,
  PATIENCE_TICKS,
  arrivalGap,
  canSwap,
  createGame,
  debrief,
  emptyStats,
  formatClock,
  makeClient,
  reduce,
  swapClient,
  type Client,
  type GameState,
} from '@/features/arcade/cabinets/be-the-redis/logic';
import { docsFromCliText } from '@/terminal/docs';
import { REPLIES } from './terminal.fixtures';

const deck = fallbackDeck();
const card = (id: string): DeckCard => {
  const c = deck.cards.find((x) => x.id === id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
};

/** A game with no random arrivals, holding exactly these clients. */
function stage(clients: Client[]): GameState {
  return { ...createGame(1, deck), nextArrival: 1_000_000, queue: clients };
}
const steps = (s: GameState, n: number) => reduce(s, { type: 'step', n });

describe('the cost model', () => {
  it('reads the first bound of the server’s complexity text', () => {
    expect(costClassOf('O(1)')).toBe('constant');
    expect(costClassOf('O(log(N)) for each item added, where N is the number of elements')).toBe(
      'log',
    );
    expect(costClassOf('O(N) where N is the size of the hash.')).toBe('linear');
    expect(costClassOf('O(S+N) where S is the distance of start offset from HEAD')).toBe('linear');
    expect(costClassOf('O(1) for each field/value pair added, so O(N) to add N pairs')).toBe(
      'constant',
    );
    expect(costClassOf('O(1) for every call. O(N) for a complete iteration')).toBe('constant');
    expect(costClassOf('Depends on the script that is executed.')).toBe('unknown');
    expect(costClassOf('')).toBe('unknown');
  });

  it('turns class and key size into ticks', () => {
    expect(costTicks('constant', 1_000_000)).toBe(1);
    expect(costTicks('unknown', 50)).toBe(1);
    expect(costTicks('log', 1)).toBe(1);
    expect(costTicks('log', 20000)).toBe(3);
    expect(costTicks('linear', 50)).toBe(1);
    expect(costTicks('linear', 3000)).toBe(30);
    expect(costTicks('linear', 3001)).toBe(31);
    expect(costTicks('linear', 10_000_000)).toBe(MAX_TICKS);
  });

  it('classifies every fallback card as the docs say', () => {
    const cls = Object.fromEntries(
      deck.cards.map((c) => [c.id, costClassOf(c.info.complexity)] as const),
    );
    expect(cls).toMatchObject({
      get: 'constant',
      set: 'constant',
      expire: 'constant',
      hset: 'constant',
      xadd: 'constant',
      zadd: 'log',
      keys: 'linear',
      lpos: 'linear',
    });
  });

  it('every slow template can really hold Redis for HEAVY_TICKS or more, and no fast one can', () => {
    for (const c of deck.cards) {
      const cls = costClassOf(c.info.complexity);
      const lowest = costTicks(cls, c.min);
      const highest = costTicks(cls, c.max);
      if (cls === 'linear') expect(lowest, c.id).toBeGreaterThanOrEqual(HEAVY_TICKS);
      else expect(highest, c.id).toBeLessThan(HEAVY_TICKS);
    }
  });

  it('describes a size with its unit', () => {
    expect(describeSize(3200, { one: 'key', many: 'keys' })).toBe('3,200 keys');
    expect(describeSize(1, { one: 'key', many: 'keys' })).toBe('1 key');
  });
});

describe('the deck', () => {
  it('the fallback copy is the server’s text, word for word (F-22 fixtures)', () => {
    for (const [name, info] of Object.entries(FALLBACK_INFO)) {
      const doc = docsFromCliText(REPLIES[name] as string)[name];
      expect(doc?.summary, name).toBe(info.summary);
      expect(doc?.complexity, name).toBe(info.complexity);
    }
  });

  it('the fallback deck has only commands it has words for, and KEYS can be swapped for SCAN', () => {
    expect(deck.source).toBe('fallback');
    for (const c of deck.cards) expect(FALLBACK_INFO[c.id], c.id).toBeDefined();
    expect(card('keys').cousin?.command).toBe('SCAN');
    expect(card('hset').cousin).toBeUndefined();
  });

  it('asks the server for every template and every cousin once', () => {
    const names = wantedNames();
    expect(new Set(names).size).toBe(names.length);
    for (const t of TEMPLATES) {
      expect(names).toContain(t.command);
      if (t.cousin) expect(names).toContain(t.cousin.command);
    }
  });

  it('uses the server only when it has answered for everything', () => {
    expect(chooseDeck(() => undefined).source).toBe('fallback');
    expect(chooseDeck((n) => (n === 'get' ? FALLBACK_INFO.get : undefined)).source).toBe(
      'fallback',
    );
    const live = chooseDeck((n) => FALLBACK_INFO[n] ?? 'missing');
    expect(live.source).toBe('server');
    expect(live.cards.map((c) => c.id)).not.toContain('hgetall');
    expect(live.cards.find((c) => c.id === 'keys')?.cousin?.command).toBe('SCAN');
  });

  it('falls back when the server’s answer would leave a deck with nothing slow', () => {
    const fast = chooseDeck((n) =>
      FALLBACK_INFO[n] && !['keys', 'lpos'].includes(n) ? FALLBACK_INFO[n] : 'missing',
    );
    expect(fast.source).toBe('fallback');
  });
});

describe('serving and the one-at-a-time rule', () => {
  it('a quick command is served one tick after it starts', () => {
    let s = stage([makeClient(1, card('get'), 100)]);
    s = reduce(s, { type: 'run' });
    expect(s.running?.client.command).toBe('GET');
    expect(s.queue).toHaveLength(0);
    s = steps(s, 1);
    expect(s.running).toBeNull();
    expect(s.stats.served).toBe(1);
    expect(s.events.map((e) => e.kind)).toContain('served');
  });

  it('a second press while a command runs is refused and counted', () => {
    let s = stage([makeClient(1, card('keys'), 3000), makeClient(2, card('get'), 100)]);
    s = reduce(s, { type: 'run' });
    const before = s;
    s = reduce(s, { type: 'run' });
    expect(s.events).toEqual([{ kind: 'busy' }]);
    expect(s.running).toEqual(before.running);
    expect(s.queue).toHaveLength(1);
    expect(s.stats.busyPresses).toBe(1);
  });

  it('a press with nobody waiting does nothing', () => {
    const s = reduce(stage([]), { type: 'run' });
    expect(s.events).toEqual([{ kind: 'empty' }]);
    expect(s.running).toBeNull();
  });

  it('a slow command holds everyone behind it until its last tick', () => {
    let s = stage([makeClient(1, card('keys'), 3000), makeClient(2, card('get'), 100)]);
    expect(s.queue[0]?.cost).toBe(30);
    s = reduce(s, { type: 'run' });
    s = steps(s, 29);
    expect(s.running?.left).toBe(1);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]?.patience).toBe(PATIENCE_TICKS - 29);
    expect(s.stats.served).toBe(0);
    s = steps(s, 1);
    expect(s.stats.served).toBe(1);
    expect(s.running).toBeNull();
  });

  it('clients run in the order they arrived', () => {
    let s = stage([makeClient(1, card('get'), 100), makeClient(2, card('set'), 100)]);
    s = reduce(s, { type: 'run' });
    expect(s.running?.client.id).toBe(1);
    s = steps(s, 1);
    s = reduce(s, { type: 'run' });
    expect(s.running?.client.id).toBe(2);
  });

  it('idle time with someone waiting is counted', () => {
    const s = steps(stage([makeClient(1, card('get'), 100)]), 3);
    expect(s.stats.idleTicks).toBe(3);
  });
});

describe('impatience', () => {
  it('a client that waits too long leaves, and a slow command is blamed', () => {
    const slow = makeClient(1, card('keys'), 3000);
    const waiting = { ...makeClient(2, card('get'), 100), patience: 2 };
    let s: GameState = {
      ...stage([waiting]),
      running: { client: slow, left: 30, total: 30 },
    };
    s = steps(s, 1);
    expect(s.queue).toHaveLength(1);
    s = steps(s, 1);
    expect(s.queue).toHaveLength(0);
    expect(s.stats.lost).toBe(1);
    expect(s.stats.lostBehindHeavy).toBe(1);
    expect(s.stats.blame.KEYS?.lost).toBe(1);
    expect(s.events).toContainEqual({ kind: 'gaveUp', clientId: 2, command: 'GET', blame: 'KEYS' });
  });

  it('is not blamed on a quick command', () => {
    const waiting = { ...makeClient(2, card('get'), 100), patience: 1 };
    let s: GameState = {
      ...stage([waiting]),
      running: { client: makeClient(1, card('set'), 100), left: 5, total: 5 },
    };
    s = steps(s, 1);
    expect(s.stats.lost).toBe(1);
    expect(s.stats.lostBehindHeavy).toBe(0);
  });

  it('the client being served never gives up', () => {
    let s = stage([{ ...makeClient(1, card('keys'), 6000), patience: 1 }]);
    s = reduce(s, { type: 'run' });
    s = steps(s, 60);
    expect(s.stats.lost).toBe(0);
    expect(s.stats.served).toBe(1);
  });
});

describe('swapping for the incremental command', () => {
  it('is offered for KEYS and for nothing that has no cousin', () => {
    expect(canSwap(stage([makeClient(1, card('keys'), 3000)]))).toBe(true);
    expect(canSwap(stage([makeClient(1, card('get'), 100)]))).toBe(false);
    expect(canSwap(stage([makeClient(1, card('lpos'), 2000)]))).toBe(false);
    expect(canSwap(stage([]))).toBe(false);
  });

  it('turns a slow walk into several one-tick calls', () => {
    const swapped = swapClient(makeClient(1, card('keys'), 3000));
    expect(swapped?.command).toBe('SCAN');
    expect(swapped?.cost).toBe(1);
    expect(swapped?.steps).toBe(Math.ceil(3000 / PAGE_ITEMS));
    expect(swapped?.was).toBe('KEYS');
    expect(swapped?.info.summary).toBe(FALLBACK_INFO.scan?.summary);
    expect(swapClient(swapped as Client)).toBeNull();
  });

  it('serves the client after its last call, and each call goes to the back of the line', () => {
    let s = stage([makeClient(1, card('keys'), 3000), makeClient(2, card('get'), 100)]);
    s = reduce(s, { type: 'swap' });
    expect(s.stats.swaps).toBe(1);
    expect(canSwap(s)).toBe(false);
    s = reduce(s, { type: 'run' });
    s = steps(s, 1);
    expect(s.stats.served).toBe(0);
    expect(s.queue.map((c) => c.id)).toEqual([2, 1]);
    expect(s.queue[1]?.steps).toBe(5);
    expect(s.queue[1]?.patience).toBe(PATIENCE_TICKS);
    // the other client got in between
    s = reduce(s, { type: 'run' });
    s = steps(s, 1);
    expect(s.stats.served).toBe(1);
    // five more calls for the walker
    for (let i = 0; i < 5; i++) {
      s = reduce(s, { type: 'run' });
      s = steps(s, 1);
    }
    expect(s.stats.served).toBe(2);
    expect(s.stats.cursorCalls).toBe(6);
    expect(s.queue).toHaveLength(0);
  });

  it('a press on a card with no cousin does nothing', () => {
    const s = reduce(stage([makeClient(1, card('get'), 100)]), { type: 'swap' });
    expect(s.events).toEqual([{ kind: 'noswap' }]);
    expect(s.stats.swaps).toBe(0);
  });
});

describe('the round', () => {
  it('arrival gaps shrink from 9 to 5 ticks and never go below 3', () => {
    expect(arrivalGap(0, 600, 0.5)).toBe(9);
    expect(arrivalGap(600, 600, 0.5)).toBe(5);
    for (let r = 0; r <= 1; r += 0.1) expect(arrivalGap(300, 600, r)).toBeGreaterThanOrEqual(3);
  });

  it('lasts one minute of game time and then stops', () => {
    let s = createGame(7, deck);
    expect(s.duration).toBe(DURATION_TICKS);
    s = steps(s, DURATION_TICKS - 1);
    expect(s.over).toBe(false);
    s = steps(s, 1);
    expect(s.over).toBe(true);
    expect(s.tick).toBe(DURATION_TICKS);
    expect(s.events.map((e) => e.kind)).toContain('over');
    expect(reduce(s, { type: 'run' })).toBe(s);
    expect(steps(s, 5).tick).toBe(DURATION_TICKS);
  });

  it('clients keep arriving, the third one brings a slow command that can be swapped', () => {
    let s = createGame(3, deck);
    for (let i = 0; i < 200 && s.stats.arrived < 3; i++) s = steps(s, 1);
    expect(s.stats.arrived).toBe(3);
    expect(s.queue.find((c) => c.id === 3)?.cousin).toBeDefined();
  });

  it('is the same round for the same seed and the same presses, and a different one otherwise', () => {
    const play = (seed: number) => {
      let s = createGame(seed, deck);
      for (let t = 0; t < 400; t++) {
        s = steps(s, 1);
        if (t % 4 === 0) s = reduce(s, { type: 'run' });
        if (t % 9 === 0) s = reduce(s, { type: 'swap' });
      }
      return s;
    };
    const a = play(11);
    const b = play(11);
    expect(b.stats).toEqual(a.stats);
    expect(b.queue).toEqual(a.queue);
    expect(b.rng).toBe(a.rng);
    expect(play(12).rng).not.toBe(a.rng);
  });

  it('does not change the state it was given', () => {
    const s = stage([makeClient(1, card('get'), 100)]);
    const frozen = JSON.stringify(s);
    reduce(s, { type: 'run' });
    reduce(s, { type: 'step', n: 5 });
    reduce(s, { type: 'swap' });
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('a player who always swaps and serves does better than one who never swaps', () => {
    const play = (swap: boolean) => {
      let total = 0;
      for (let seed = 1; seed <= 8; seed++) {
        let s = createGame(seed, deck);
        while (!s.over) {
          s = steps(s, 1);
          if (!s.running && s.queue.length > 0) {
            if (swap && canSwap(s)) s = reduce(s, { type: 'swap' });
            s = reduce(s, { type: 'run' });
          }
        }
        total += s.stats.served;
      }
      return total;
    };
    expect(play(true)).toBeGreaterThan(play(false));
  });

  it('formats the clock', () => {
    expect(formatClock(600)).toBe('1:00');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(10)).toBe('0:01');
    expect(formatClock(15)).toBe('0:02');
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('what happened', () => {
  const over = (patch: Partial<ReturnType<typeof emptyStats>>): GameState => ({
    ...createGame(1, deck),
    over: true,
    stats: { ...emptyStats(), ...patch },
  });

  it('names the command that held Redis when clients left behind it', () => {
    const d = debrief(
      over({ arrived: 80, served: 60, lost: 20, blame: { KEYS: { lost: 9, maxTicks: 42 } } }),
    );
    expect(d.sentences[0]).toBe('You served 60 of 80 clients in time and 20 gave up waiting.');
    expect(d.sentences[1]).toContain('9 of them left while KEYS held Redis for up to 4.2 s');
    expect(d.idea).toMatch(/one after another/);
  });

  it('credits a swap when nobody was lost behind a slow command', () => {
    const d = debrief(over({ arrived: 80, served: 79, lost: 1, swaps: 2, cursorCalls: 11 }));
    expect(d.sentences[1]).toContain('swapped 2 slow commands');
    expect(d.sentences[1]).toContain('11 small calls');
  });

  it('has a line for a round with only quick commands, and for slow ones that cost nothing', () => {
    expect(debrief(over({ arrived: 40, served: 40 })).sentences[0]).toContain('nobody gave up');
    expect(debrief(over({ arrived: 40, served: 40 })).sentences[1]).toContain('quick commands');
    expect(debrief(over({ arrived: 40, served: 40, heavyRuns: 1 })).sentences[1]).toContain(
      '1 slow command came through',
    );
  });
});
