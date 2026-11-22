import { describe, expect, it } from 'vitest';
import type { CardInfo } from '../deck.js';
import {
  buildFixture,
  dateForSeed,
  MATCH_SCENARIOS,
  OVERS,
  P99_BUDGET_INCIDENT_MS,
  P99_BUDGET_MS,
  parseSeed,
  seedForDate,
} from '../fixture.js';
import { mulberry32 } from '../rng.js';

const DECK: CardInfo[] = [
  { id: 'a-card', title: 'A' },
  { id: 'b-card', title: 'B', scenario: 'celebrity-100' },
  { id: 'c-card', title: 'C', scenario: 'bad-id-hammer' },
  { id: 'd-card', title: 'D' },
  { id: 'e-card', title: 'E' },
];

describe('seeds', () => {
  it('turns a UTC date into YYYYMMDD and back', () => {
    expect(seedForDate(new Date('2026-11-20T23:59:59Z'))).toBe(20261120);
    expect(seedForDate(new Date('2026-01-05T00:00:00Z'))).toBe(20260105);
    expect(dateForSeed(20261120)).toBe('2026-11-20');
    expect(dateForSeed(20261340)).toBeNull();
    expect(dateForSeed(42)).toBeNull();
  });

  it('parses a seed from a number or a numeric string, nothing else', () => {
    expect(parseSeed(7)).toBe(7);
    expect(parseSeed(' 20261120 ')).toBe(20261120);
    for (const bad of [0, -1, 1.5, 2 ** 31, 'abc', '', null, undefined, '12345678901', {}])
      expect(parseSeed(bad)).toBeNull();
  });

  it('the generator repeats itself', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('buildFixture', () => {
  it('is the same for the same seed and deck, whatever order the deck is in', () => {
    const one = buildFixture(20261120, DECK);
    const two = buildFixture(20261120, [...DECK].reverse());
    expect(two).toEqual(one);
  });

  it('differs between seeds', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 20; s++) seen.add(JSON.stringify(buildFixture(s, DECK).overs));
    expect(seen.size).toBeGreaterThan(10);
  });

  it('holds its rules for many seeds', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const f = buildFixture(seed, DECK);
      expect(f.overs).toHaveLength(OVERS);
      expect(f.overs[0]?.cardId).toBeNull();
      const played = f.overs.filter((o) => o.cardId).map((o) => o.cardId);
      expect(played.length).toBeGreaterThanOrEqual(2);
      expect(played.length).toBeLessThanOrEqual(3);
      expect(new Set(played).size).toBe(played.length);
      f.overs.forEach((o, i) => {
        expect(o.over).toBe(i + 1);
        expect(o.durationSec).toBe(10);
        expect(o.connections).toBeLessThanOrEqual(60);
        expect(o.p99BudgetMs).toBe(o.cardId ? P99_BUDGET_INCIDENT_MS : P99_BUDGET_MS);
        const card = DECK.find((c) => c.id === o.cardId);
        if (card?.scenario) expect(o.scenario).toBe(card.scenario);
        else expect(MATCH_SCENARIOS).toContain(o.scenario);
        const prev = f.overs[i - 1];
        if (prev && !o.cardId && !prev.cardId) expect(o.scenario).not.toBe(prev.scenario);
      });
    }
  });

  it('copes with a small deck and an empty deck', () => {
    const one = buildFixture(5, DECK.slice(0, 1));
    expect(one.overs.filter((o) => o.cardId)).toHaveLength(1);
    const none = buildFixture(5, []);
    expect(none.overs.every((o) => o.cardId === null)).toBe(true);
  });

  it('carries the date when the seed is a date', () => {
    expect(buildFixture(20261120, DECK).date).toBe('2026-11-20');
    expect(buildFixture(777, DECK).date).toBeNull();
  });
});
