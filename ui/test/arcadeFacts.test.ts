import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FACTS } from '@/features/arcade/cabinets/be-the-redis/facts';

const here = path.dirname(fileURLToPath(import.meta.url));
const digest = readFileSync(path.join(here, '../../docs/redis-docs-digest.md'), 'utf8').split('\n');

describe('Be the Redis: every rule has a source', () => {
  it('has unique ids and at least the core rules', () => {
    const ids = FACTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('one-at-a-time');
    expect(ids).toContain('ticks');
  });

  it('every digest line it cites exists and has the quoted words on it', () => {
    for (const fact of FACTS) {
      if (fact.source.kind !== 'digest') continue;
      expect(fact.source.refs.length).toBeGreaterThan(0);
      for (const ref of fact.source.refs) {
        const line = digest[ref.line - 1] ?? '';
        expect(line.toLowerCase(), `${fact.id}: digest line ${ref.line}`).toContain(
          ref.contains.toLowerCase(),
        );
      }
    }
  });

  it('every simplification and server source says what it is', () => {
    for (const fact of FACTS) {
      if (fact.source.kind === 'simplification')
        expect(fact.source.what.length).toBeGreaterThan(20);
      if (fact.source.kind === 'server') expect(fact.source.note.length).toBeGreaterThan(20);
    }
  });

  it('calls the tick model a simulation', () => {
    const ticks = FACTS.find((f) => f.id === 'ticks');
    expect(ticks?.source.kind).toBe('simplification');
    expect(JSON.stringify(ticks)).toMatch(/simulation/i);
  });
});
