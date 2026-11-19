import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { CapEmblem } from '../src/map/CapEmblem';
import { CapsShelf, SHELF_PREVIEW } from '../src/map/CapsShelf';
import { ENAMELS, SHAPES, emblemFor, hashName, initialsFor, shapePath } from '../src/map/emblem';
import { fixtureState, nextMatch, overs, seasonTotals } from '../src/map/model';
import { segmentPath } from '../src/map/SeasonPath';
import { ChapterMap } from '../src/screens/ChapterMap';
import { useQuest } from '../src/store';
import type { ChapterSummary, ChaptersResponse, LevelStatus, Progress } from '../src/types';

const lv = (id: string, status: LevelStatus, attempts = 0) => ({
  id,
  title: `Level ${id}`,
  mode: 'cli' as const,
  xp: 10,
  status,
  attempts,
});
const chapter = (id: string, levels: ChapterSummary['levels']): ChapterSummary => ({
  id,
  dirName: id,
  title: `Chapter ${id}`,
  incident: [{ from: 'roommate', time: '19:24', text: `headline of ${id}` }],
  levels,
});

const progress = (badges: string[] = []): Progress => ({
  version: 1,
  player: { id: 'p1', name: 'Asha', createdAt: '2026-01-01T00:00:00Z' },
  target: { redisUrl: 'redis://redis:6379' },
  activeSlots: [],
  levels: {},
  xp: 85,
  badges,
});

const season = (): ChaptersResponse => ({
  player: { id: 'p1', name: 'Asha' },
  xp: 85,
  chapters: [
    chapter('ch0', [lv('a', 'passed', 1), lv('b', 'passed', 2), lv('c', 'passed', 5)]),
    chapter('ch1', [lv('d', 'passed'), lv('e', 'available'), lv('f', 'locked')]),
    chapter('ch2', [lv('g', 'locked'), lv('h', 'locked')]),
  ],
});

// Static rendering reads zustand's server snapshot, which is always the initial state. The screen gets a hook that
// reads the live state instead, so it renders what each test puts in the store.
vi.mock('../src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/store')>();
  const live = <T,>(sel: (s: ReturnType<typeof real.useQuest.getState>) => T) =>
    sel(real.useQuest.getState());
  return { ...real, useQuest: Object.assign(live, real.useQuest) };
});
afterEach(() => useQuest.setState({ chapters: null, progress: null }));

test('nextMatch prefers a level in progress, then the first available one', () => {
  const s = season();
  expect(nextMatch(s.chapters)).toMatchObject({
    level: { id: 'e' },
    resume: false,
    chapterIndex: 1,
  });
  s.chapters[2]!.levels[1]!.status = 'in_progress';
  expect(nextMatch(s.chapters)).toMatchObject({ level: { id: 'h' }, resume: true, levelIndex: 1 });
  for (const c of s.chapters) for (const l of c.levels) l.status = 'passed';
  expect(nextMatch(s.chapters)).toBeNull();
});

test('fixture states: complete, current, open, upcoming', () => {
  const [a, b, c] = season().chapters;
  expect(fixtureState(a!, false)).toBe('complete');
  expect(fixtureState(b!, true)).toBe('current');
  expect(fixtureState(b!, false)).toBe('open');
  expect(fixtureState(c!, false)).toBe('upcoming');
});

test('levels fall into overs of six with a short last over', () => {
  const n = Array.from({ length: 19 }, (_, i) => i);
  expect(overs(n).map((o) => o.length)).toEqual([6, 6, 6, 1]);
  expect(overs([])).toEqual([]);
  expect(seasonTotals(season().chapters)).toEqual({ passed: 4, total: 8, chaptersComplete: 1 });
});

test('emblems are deterministic, varied and use the palette', () => {
  expect(emblemFor('Booted')).toEqual(emblemFor('Booted'));
  expect(hashName('Booted')).toBe(hashName('Booted'));
  expect(initialsFor('Fresh on write')).toBe('FW');
  expect(initialsFor('Booted')).toBe('B');
  expect(initialsFor('The architect')).toBe('TA');
  expect(initialsFor('  ')).toBe('?');
  const names = Array.from({ length: 80 }, (_, i) => `Badge number ${i}`);
  const shapes = new Set(names.map((n) => emblemFor(n).shape));
  const enamels = new Set(names.map((n) => emblemFor(n).enamel.id));
  expect(shapes.size).toBe(SHAPES.length);
  expect(enamels.size).toBe(ENAMELS.length);
  for (const n of names)
    if (emblemFor(n).enamel.id === 'flood') expect(emblemFor(n).rim).toBe('silver');
  for (const s of SHAPES) expect(shapePath(s)).toMatch(/^M.*Z$/);
  const svg = renderToStaticMarkup(<CapEmblem name="First cache" />);
  expect(svg).toContain('aria-hidden="true"');
  expect(svg).toContain('>FC<');
});

test('the road arches along a row and bends around the end of a row', () => {
  expect(segmentPath({ x: 0, y: 50 }, { x: 300, y: 50 }, 1200, 200)).toBe(
    'M0 50 C100 16 200 16 300 50',
  );
  expect(segmentPath({ x: 1000, y: 50 }, { x: 1000, y: 400 }, 1200, 200)).toBe(
    'M1000 50 C1200 50 1200 400 1000 400',
  );
});

test('the caps shelf: empty invites the first cap, full shows the newest and a count', () => {
  const empty = renderToStaticMarkup(<CapsShelf badges={[]} />);
  expect(empty).toContain('Your first cap is waiting.');
  expect(empty).toContain('0 caps');
  expect(empty).toContain('class="badges');

  const names = Array.from({ length: 30 }, (_, i) => `Cap ${i}`);
  const full = renderToStaticMarkup(<CapsShelf badges={names} />);
  expect(full).toContain('30 caps');
  expect(full).toContain(`+${30 - (SHELF_PREVIEW - 1)}`);
  // newest first: the last earned comes before the first
  expect(full.indexOf('aria-label="Cap 29"')).toBeGreaterThan(-1);
  expect(full.indexOf('aria-label="Cap 29"')).toBeLessThan(full.indexOf('Cap 0<'));
  // every name is in the shelf's text (screen readers and the end-to-end badge check)
  for (const n of names) expect(full).toContain(`${n}<`);
});

test('the map keeps its test ids, links unlocked levels and opens on the next match', () => {
  useQuest.setState({ chapters: season(), progress: progress(['Booted', 'Ranked']) });
  const html = renderToStaticMarkup(<ChapterMap />);
  expect(html).toContain('data-testid="chapter-map"');
  expect(html).toMatch(/Hello, (<!-- -->)?Asha/);
  expect(html).toMatch(/data-testid="xp"[^>]*>85</);
  for (const id of ['ch0', 'ch1', 'ch2']) expect(html).toContain(`data-testid="chapter-${id}"`);
  // unlocked levels are links, locked ones are not
  expect(html).toMatch(
    /<a[^>]*href="\/level\/e"[^>]*data-testid="level-e"|<a[^>]*data-testid="level-e"[^>]*href="\/level\/e"/,
  );
  expect(html).toMatch(/<span aria-disabled="true" data-testid="level-f"/);
  expect(html).not.toMatch(/<a[^>]*data-testid="level-f"/);
  // the hero plays the next level; the fixture holding it is the one opened
  expect(html).toContain('data-testid="next-match"');
  expect(html).toContain('headline of ch1');
  expect(html).toMatch(/data-testid="fixture-ch1"/);
  expect(html).not.toMatch(/hidden=""[^>]*data-testid="fixture-ch1"/);
  expect(html).toMatch(
    /hidden=""[^>]*data-testid="fixture-ch0"|data-testid="fixture-ch0"[^>]*hidden=""/,
  );
  // balls carry the plain label
  expect(html).toContain('Level 2, Level b: Passed on the second try');
  expect(html).toContain('Read the chapter thread');
  expect(html).toContain('Booted');
});

test('the map shows a season-complete card when nothing is left to play', () => {
  const s = season();
  for (const c of s.chapters) for (const l of c.levels) l.status = 'passed';
  useQuest.setState({ chapters: s, progress: progress() });
  const html = renderToStaticMarkup(<ChapterMap />);
  expect(html).toContain('data-testid="season-complete"');
  expect(html).not.toContain('data-testid="next-match"');
});

test('the map waits for chapters with a loading state', () => {
  useQuest.setState({ chapters: null, progress: progress() });
  const html = renderToStaticMarkup(<ChapterMap />);
  expect(html).toContain('Loading the map...');
  expect(html).not.toContain('data-testid="chapter-map"');
});
