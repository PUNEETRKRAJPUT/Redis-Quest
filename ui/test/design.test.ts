// F-16: the design system's pure logic: the sound cue table, the settings store, FlipNumber digit maths,
// reduced-motion resolution, the motion helpers, contrast maths and the toast queue.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { contrastRatio, diffDigits, toDigits } from '../src/design/digits';
import { listItem, reduceVariants, rise, staggerDelay, STAGGER_CAP } from '../src/design/motion';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  resolveReducedMotion,
  SETTINGS_KEY,
  useSettings,
} from '../src/design/settings';
import { CUE_NAMES, CUES, cueGain, MASTER_LEVEL, play } from '../src/design/sound';
import { toast, TOAST_LIMIT, useToasts } from '../src/design/toast';

test('the cue table holds exactly the brief cues, each under 1.5s and quiet', () => {
  expect([...CUE_NAMES].sort()).toEqual(['flip', 'msg', 'out', 'pager', 'roar', 'tick', 'tock']);
  for (const c of CUE_NAMES) {
    expect(CUES[c].duration).toBeGreaterThan(0);
    expect(CUES[c].duration).toBeLessThan(1.5);
    expect(CUES[c].level).toBeGreaterThan(0);
    expect(CUES[c].level).toBeLessThanOrEqual(1);
    expect(cueGain(c, 1)).toBeLessThanOrEqual(MASTER_LEVEL);
  }
  expect(cueGain('tock', 0)).toBe(0);
  expect(cueGain('tock', 5)).toBe(cueGain('tock', 1));
});

test('play() is a no-op while sound is off (the default)', () => {
  expect(useSettings.getState().sound).toBe(false);
  expect(play('tock')).toBe(false);
  // On, but no WebAudio under node: still a quiet false, never a throw.
  useSettings.getState().setSound(true);
  expect(play('tock')).toBe(false);
  useSettings.getState().setSound(false);
});

function memoryStorage(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test('settings: defaults, persistence, clamping and rehydration from storage', async () => {
  const mem = memoryStorage();
  const store = createSettingsStore(() => mem);
  expect(store.getState()).toMatchObject(DEFAULT_SETTINGS);
  store.getState().toggleSound();
  store.getState().setVolume(3);
  store.getState().setReducedMotion('on');
  expect(store.getState()).toMatchObject({ sound: true, volume: 1, reducedMotion: 'on' });
  const saved = JSON.parse(mem.data.get(SETTINGS_KEY) ?? '{}');
  expect(saved.state).toEqual({ sound: true, volume: 1, reducedMotion: 'on' });

  const again = createSettingsStore(() => mem);
  expect(again.getState().sound).toBe(false); // skipHydration: server and first client render agree
  await again.persist.rehydrate();
  expect(again.getState()).toMatchObject({ sound: true, volume: 1, reducedMotion: 'on' });
});

test('settings: garbage in storage falls back to defaults', async () => {
  const mem = memoryStorage();
  mem.data.set(
    SETTINGS_KEY,
    JSON.stringify({ state: { sound: 'yes', volume: -4, reducedMotion: 'sometimes' }, version: 1 }),
  );
  const store = createSettingsStore(() => mem);
  await store.persist.rehydrate();
  expect(store.getState()).toMatchObject({ sound: false, volume: 0, reducedMotion: 'system' });
});

test('reduced motion: the in-game setting wins, system defers to the OS', () => {
  expect(resolveReducedMotion('on', false)).toBe(true);
  expect(resolveReducedMotion('off', true)).toBe(false);
  expect(resolveReducedMotion('system', true)).toBe(true);
  expect(resolveReducedMotion('system', false)).toBe(false);
});

test('FlipNumber digits: padding, negatives, rounding, non-finite', () => {
  expect(toDigits(7, 3)).toEqual(['0', '0', '7']);
  expect(toDigits(1240, 4)).toEqual(['1', '2', '4', '0']);
  expect(toDigits(12345, 2)).toEqual(['1', '2', '3', '4', '5']);
  expect(toDigits(-42, 3)).toEqual(['-', '0', '4', '2']);
  expect(toDigits(9.6)).toEqual(['1', '0']);
  expect(toDigits(Number.NaN, 2)).toEqual(['0', '0']);
});

test('FlipNumber diff: right-aligned keys, only changed places flip', () => {
  const d = diffDigits(toDigits(1240), toDigits(1280));
  expect(d.map((c) => c.key)).toEqual(['p3', 'p2', 'p1', 'p0']);
  expect(d.map((c) => c.changed)).toEqual([false, false, true, false]);
  // 99 -> 100: units and tens keep their keys, the new hundreds digit is new.
  const g = diffDigits(toDigits(99), toDigits(100));
  expect(g).toEqual([
    { key: 'p2', digit: '1', changed: true },
    { key: 'p1', digit: '0', changed: true },
    { key: 'p0', digit: '0', changed: true },
  ]);
  expect(diffDigits(toDigits(5), toDigits(5)).some((c) => c.changed)).toBe(false);
});

test('motion: 30ms stagger capped at 10 items; reduced variants keep only the fade', () => {
  expect(staggerDelay(0)).toBe(0);
  expect(staggerDelay(3)).toBeCloseTo(0.09);
  expect(staggerDelay(STAGGER_CAP - 1)).toBeCloseTo(0.27);
  expect(staggerDelay(50)).toBe(staggerDelay(STAGGER_CAP - 1));
  const r = reduceVariants(rise);
  expect(r.hidden).toEqual({ opacity: 0, transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] } });
  expect(JSON.stringify(r)).not.toMatch(/"y"|"scale"/);
  const item = reduceVariants(listItem).show as (i: number) => Record<string, unknown>;
  const shown = item(4);
  expect(shown.y).toBeUndefined();
  expect(shown.opacity).toBe(1);
  expect((shown.transition as { duration: number }).duration).toBeLessThanOrEqual(0.15);
});

test('contrast: body text colours clear 4.5:1 on the base surface', () => {
  const tokens = readFileSync(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
  const hex = (name: string) => {
    const m = tokens.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m?.[1]) throw new Error(`no token ${name}`);
    return m[1];
  };
  for (const ink of ['chalk', 'chalk-dim', 'flood-500', 'turf', 'wicket', 'sky', 'cap-purple']) {
    expect(contrastRatio(hex(ink), hex('night-900'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex(ink), hex('night-800'))).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(hex('on-flood'), hex('flood-500'))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
});

test('toast(): queue, tones, limit and dismiss', () => {
  useToasts.getState().clear();
  const id = toast('Saved');
  expect(useToasts.getState().toasts[0]).toMatchObject({
    id,
    title: 'Saved',
    tone: 'info',
    duration: 4500,
  });
  toast.error('Check failed', 'The app still reads from Postgres');
  expect(useToasts.getState().toasts[1]).toMatchObject({ tone: 'error', duration: 7000 });
  for (let i = 0; i < 10; i++) toast({ title: `n${i}`, tone: 'success' });
  expect(useToasts.getState().toasts).toHaveLength(TOAST_LIMIT);
  expect(useToasts.getState().toasts.at(-1)?.title).toBe('n9');
  toast.dismiss(useToasts.getState().toasts[0]!.id);
  expect(useToasts.getState().toasts).toHaveLength(TOAST_LIMIT - 1);
  useToasts.getState().clear();
});
