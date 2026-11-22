import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArcadeScreen } from '@/features/arcade/ArcadeScreen';
import { BeTheRedis } from '@/features/arcade/cabinets/be-the-redis/BeTheRedis';
import { intentFor, type Phase } from '@/features/arcade/cabinets/be-the-redis/controls';
import { CABINETS, COMING } from '@/features/arcade/cabinets/registry';
import { entry } from '@/features/arcade/entry';
import { ALL_FEATURES, FEATURES } from '@/features/registry';

describe('the arcade is on', () => {
  it('is an enabled feature that the map and the palette pick up', () => {
    expect(entry.enabled).toBe(true);
    expect(entry.path).toBe('/arcade');
    expect(FEATURES.map((f) => f.id)).toContain('arcade');
    expect(ALL_FEATURES.map((f) => f.id)).toContain('arcade');
  });

  it('has one playable cabinet and one announced', () => {
    expect(CABINETS.map((c) => c.id)).toEqual(['be-the-redis']);
    expect(COMING.map((c) => c.id)).toEqual(['be-the-eviction-policy']);
    for (const c of CABINETS) {
      expect(c.lesson.length).toBeGreaterThan(20);
      expect(c.facts.length).toBeGreaterThan(5);
    }
  });
});

describe('the arcade page', () => {
  it('shows the machine, its lesson, a Play button and the machine that is coming', () => {
    const html = renderToStaticMarkup(<ArcadeScreen />);
    expect(html).toContain('The arcade');
    expect(html).toContain('Be the Redis');
    expect(html).toContain('data-testid="play-be-the-redis"');
    expect(html).toContain('Best score');
    expect(html).toContain('Be the eviction policy');
    expect(html).toContain('Coming');
    expect(html).toContain('docs/arcade.md');
    expect(html).toContain('data-ds=""');
  });
});

describe('the cabinet before the first round', () => {
  const html = renderToStaticMarkup(<BeTheRedis />);

  it('has the frame: title, scores, pause, restart, the lesson and the keys', () => {
    expect(html).toContain('Be the Redis');
    expect(html).toContain('data-testid="cabinet"');
    expect(html).toContain('Time left');
    expect(html).toContain('data-testid="cabinet-pause"');
    expect(html).toContain('data-testid="cabinet-restart"');
    expect(html).toContain('What this teaches');
    expect(html).toContain('Commands run one after another');
    expect(html).toContain('Where each rule comes from');
  });

  it('says it is a simulation, and offers to start', () => {
    expect(html).toMatch(/simulation, not a measurement/);
    expect(html).toContain('data-testid="start"');
    expect(html).toContain('You are Redis');
  });

  it('lists every rule with its source', () => {
    expect(html).toContain('data-testid="arcade-facts"');
    expect(html).toContain('Simplification');
    expect(html).toContain('docs/redis-docs-digest.md L300');
  });
});

describe('the keyboard', () => {
  const table: [string, Phase, string | null][] = [
    [' ', 'ready', 'start'],
    [' ', 'playing', 'run'],
    [' ', 'paused', 'resume'],
    [' ', 'over', null],
    ['Enter', 'over', 'restart'],
    ['Enter', 'playing', 'run'],
    ['s', 'playing', 'swap'],
    ['S', 'playing', 'swap'],
    ['s', 'ready', null],
    ['p', 'playing', 'pause'],
    ['Escape', 'playing', 'pause'],
    ['p', 'paused', 'resume'],
    ['r', 'playing', 'restart'],
    ['r', 'over', 'restart'],
    ['r', 'ready', null],
    ['x', 'playing', null],
  ];
  it.each(table)('%j in %s does %s', (key, phase, intent) => {
    expect(intentFor(key, phase)).toBe(intent);
  });
});
