import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cardInfo, loadDeck, parseCard, prefixProblem, touchesReserved } from '../deck.js';
import { MATCH_SCENARIOS } from '../fixture.js';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const GOOD = `
id: sample-card
title: "A sample"
sees: "You see it."
cause:
  summary: "The engine does it."
  steps:
    - kind: delete_keys
      prefixes: ["cache:player:"]
ends: "It ends."
facts:
  - text: "Something."
    source: simulation
`;

describe('parseCard', () => {
  it('accepts a good card', () => {
    const r = parseCard(GOOD, 'sample-card');
    expect(r.ok).toBe(true);
  });

  it('rejects an id that differs from the file name', () => {
    const r = parseCard(GOOD, 'other');
    expect(r.ok).toBe(false);
  });

  it('rejects unknown keys and unknown step kinds', () => {
    expect(parseCard(GOOD.replace('ends:', 'bonus: 1\nends:')).ok).toBe(false);
    expect(parseCard(GOOD.replace('delete_keys', 'flush_everything')).ok).toBe(false);
  });

  it('rejects a digest fact without a ref', () => {
    const r = parseCard(GOOD.replace('source: simulation', 'source: digest'));
    expect(r.ok).toBe(false);
  });

  it('rejects the same kind of step twice', () => {
    const twice = GOOD.replace(
      '      prefixes: ["cache:player:"]',
      '      prefixes: ["cache:player:"]\n    - kind: delete_keys\n      prefixes: ["cache:match:"]',
    );
    expect(parseCard(twice).ok).toBe(false);
  });

  it('rejects invalid YAML without throwing', () => {
    expect(parseCard('id: [unclosed').ok).toBe(false);
  });
});

describe('prefixes', () => {
  it('never allows the engine prefix, or one that could reach it', () => {
    for (const p of ['game:', 'game:engine:', 'g', 'ga', 'gam', 'game']) {
      expect(touchesReserved(p)).toBe(true);
      expect(prefixProblem(p)).not.toBeNull();
    }
  });

  it('allows only cache keys with no glob characters', () => {
    expect(prefixProblem('cache:player:')).toBeNull();
    expect(prefixProblem('cache:')).not.toBeNull();
    expect(prefixProblem('lb:match:')).not.toBeNull();
    expect(prefixProblem('cache:*')).not.toBeNull();
    expect(prefixProblem('cache:a[b]')).not.toBeNull();
    expect(prefixProblem(`cache:${'x'.repeat(80)}`)).not.toBeNull();
  });

  it('is enforced by the schema', () => {
    const bad = GOOD.replace('"cache:player:"', '"game:engine:"');
    expect(parseCard(bad).ok).toBe(false);
  });
});

describe('the shipped deck (incidents/)', () => {
  it('loads with no errors and has five cards', async () => {
    const deck = await loadDeck(join(ROOT, 'incidents'));
    expect(deck.errors).toEqual([]);
    expect(deck.cards).toHaveLength(5);
  });

  it('only names scenarios that exist', async () => {
    const deck = await loadDeck(join(ROOT, 'incidents'));
    const names = [
      ...MATCH_SCENARIOS,
      ...deck.cards.map((c) => cardInfo(c).scenario).filter((s): s is string => !!s),
    ];
    for (const s of names) expect(existsSync(join(ROOT, 'scenarios', `${s}.yaml`))).toBe(true);
  });

  it('labels every fact with its source', async () => {
    const deck = await loadDeck(join(ROOT, 'incidents'));
    for (const c of deck.cards) for (const f of c.facts) expect(f.source).toBeTruthy();
  });
});

describe('loadDeck', () => {
  it('reports an unreadable folder as an error, not a throw', async () => {
    const deck = await loadDeck(join(ROOT, 'no-such-folder'));
    expect(deck.cards).toEqual([]);
    expect(deck.errors).toHaveLength(1);
  });
});
