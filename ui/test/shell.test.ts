import { describe, expect, it } from 'vitest';
import { useSettings } from '../src/design/settings';
import { createCollapser, describeDanger, describeEvent, humanize } from '../src/shell/eventToasts';
import { NAV, isActive } from '../src/shell/nav';
import { paletteScore } from '../src/shell/paletteScore';
import { rainReason, stackLight } from '../src/shell/rain';
import { CHORD_MS, createChord, isPaletteKey, isTypingTarget } from '../src/shell/shortcuts';

describe('rain delay and the stack light', () => {
  const ok = { boot: 'ready', ws: 'open', redisUp: true, offline: false } as const;
  it('is quiet while all is well, and before the game is ready', () => {
    expect(rainReason(ok)).toBeNull();
    expect(rainReason({ ...ok, redisUp: null })).toBeNull();
    expect(rainReason({ ...ok, boot: 'offline', ws: 'closed' })).toBeNull();
    expect(rainReason({ ...ok, boot: 'loading', ws: 'connecting' })).toBeNull();
  });
  it('names the stack when the socket is not open or the browser is offline', () => {
    expect(rainReason({ ...ok, ws: 'closed' })).toBe('stack');
    expect(rainReason({ ...ok, ws: 'connecting' })).toBe('stack');
    expect(rainReason({ ...ok, offline: true })).toBe('stack');
  });
  it('names Redis when only Redis is down', () => {
    expect(rainReason({ ...ok, redisUp: false })).toBe('redis');
    expect(rainReason({ ...ok, ws: 'closed', redisUp: false })).toBe('stack');
  });
  it('keeps the status wording of the old header', () => {
    expect(stackLight('open', true)).toEqual({
      live: true,
      text: 'live',
      label: 'Connected to the engine and Redis',
    });
    expect(stackLight('open', null).text).toBe('live');
    expect(stackLight('closed', true)).toMatchObject({ live: false, text: 'reconnecting' });
    expect(stackLight('connecting', true).label).toBe('Reconnecting to the engine');
    expect(stackLight('open', false)).toMatchObject({
      live: false,
      text: 'redis down',
      label: 'Redis is down',
    });
  });
});

describe('event toasts', () => {
  it('says what happened in one line', () => {
    expect(describeEvent({ kind: 'custom', name: 'portfolio_written' })).toMatchObject({
      title: 'Portfolio written',
      tone: 'success',
    });
    expect(describeEvent({ kind: 'service_scaled', data: { instances: 3 } })?.title).toBe(
      'The app now runs 3 copies',
    );
    expect(describeEvent({ kind: 'service_scaled', data: { instances: 1 } })?.title).toBe(
      'The app now runs 1 copy',
    );
    expect(describeEvent({ kind: 'custom', name: 'redis_busy' })?.tone).toBe('warn');
    expect(describeEvent({ kind: 'custom', name: 'cache_warmed' })?.title).toBe('Cache warmed');
    expect(
      describeEvent({ kind: 'custom', name: 'redis_target_changed', data: { kind: 'cluster' } })
        ?.title,
    ).toBe('Redis target switched to cluster');
  });
  it('stays quiet about plumbing and about what the rain-delay strip already says', () => {
    for (const name of ['ui_connected', 'cli_ping', 'level_started'])
      expect(describeEvent({ kind: 'custom', name })).toBeNull();
    // Verification progress belongs to the level screen's review, not to toasts.
    for (const name of [
      'verify_started',
      'verify_check_started',
      'verify_check_finished',
      'verify_traffic_phase',
      'verify_finished',
    ])
      expect(describeEvent({ kind: 'custom', name })).toBeNull();
    useSettings.setState({ commentary: 'off' }); // D-02: with commentary on, these two carry a line
    expect(describeEvent({ kind: 'redis_disconnect' })).toBeNull();
    expect(describeEvent({ kind: 'redis_reconnect' })).toBeNull();
    expect(describeEvent({ kind: 'custom' })).toBeNull();
    expect(describeEvent({ kind: 'something_new' })).toBeNull();
  });
  it('turns a dangerous command into a warning with the pager cue', () => {
    const t = describeDanger('flushall');
    expect(t).toMatchObject({ tone: 'warn', cue: 'pager', key: 'danger:FLUSHALL' });
    expect(t.title).toBe('FLUSHALL just ran');
    expect(describeDanger('KEYS').description).toMatch(/blocks Redis/);
    expect(describeDanger('SOMETHING').description).toBeTruthy();
  });
  it('collapses repeats within two seconds, per key', () => {
    const allow = createCollapser(2000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('a', 500)).toBe(false);
    expect(allow('a', 1999)).toBe(false);
    expect(allow('b', 1000)).toBe(true);
    expect(allow('a', 2000)).toBe(true);
  });
  it('humanizes event names', () => {
    expect(humanize('cache_warmed')).toBe('Cache warmed');
    expect(humanize('load-finished')).toBe('Load finished');
    expect(humanize('')).toBe('');
  });
});

describe('keyboard rules', () => {
  const key = (k: string, extra: object = {}) => ({ key: k, ...extra });
  it('goes to a screen with g then its letter, within the window', () => {
    let t = 1000;
    const chord = createChord(() => t);
    expect(chord.press(key('g'))).toEqual({ type: 'arm' });
    expect(chord.armed()).toBe(true);
    expect(chord.press(key('t'))).toEqual({ type: 'go', route: { name: 'terminal' } });
    expect(chord.armed()).toBe(false);
    chord.press(key('g'));
    expect(chord.press(key('m'))).toEqual({ type: 'go', route: { name: 'home' } });
    chord.press(key('g'));
    t += CHORD_MS + 1;
    expect(chord.armed()).toBe(false);
    expect(chord.press(key('t'))).toEqual({ type: 'none' });
  });
  it('covers every screen with its own letter', () => {
    const letters = NAV.map((n) => n.key);
    expect(new Set(letters).size).toBe(NAV.length);
    expect(letters.join('')).toBe('mtelxb');
    for (const n of NAV) {
      const chord = createChord(() => 0);
      chord.press(key('g'));
      expect(chord.press(key(n.key))).toEqual({ type: 'go', route: n.route });
    }
  });
  it('drops the chord on any other key, ignores modifiers and key repeat', () => {
    const chord = createChord(() => 0);
    chord.press(key('g'));
    expect(chord.press(key('q'))).toEqual({ type: 'none' });
    expect(chord.armed()).toBe(false);
    expect(chord.press(key('t'))).toEqual({ type: 'none' });
    expect(chord.press(key('g', { metaKey: true }))).toEqual({ type: 'none' });
    expect(chord.press(key('g', { ctrlKey: true }))).toEqual({ type: 'none' });
    expect(chord.press(key('g', { repeat: true }))).toEqual({ type: 'none' });
    expect(chord.armed()).toBe(false);
  });
  it('opens the sheet on ?', () => {
    expect(createChord(() => 0).press(key('?'))).toEqual({ type: 'help' });
  });
  it('opens the palette on Cmd+K and Ctrl+K, but leaves Ctrl+K to the terminal', () => {
    expect(isPaletteKey(key('k', { metaKey: true }), false)).toBe(true);
    expect(isPaletteKey(key('K', { metaKey: true }), true)).toBe(true);
    expect(isPaletteKey(key('k', { ctrlKey: true }), false)).toBe(true);
    expect(isPaletteKey(key('k', { ctrlKey: true }), true)).toBe(false);
    expect(isPaletteKey(key('k'), false)).toBe(false);
    expect(isPaletteKey(key('k', { metaKey: true, shiftKey: true }), false)).toBe(false);
    expect(isPaletteKey(key('j', { metaKey: true }), false)).toBe(false);
  });
  it('knows when the player is typing', () => {
    const el = (tagName: string, extra: object = {}) =>
      ({ tagName, ...extra }) as unknown as EventTarget;
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(el('BODY'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(
      isTypingTarget(el('DIV', { closest: (s: string) => (s.includes('.xterm') ? {} : null) })),
    ).toBe(true);
    expect(isTypingTarget(el('SPAN', { closest: () => null }))).toBe(false);
  });
});

describe('navigation model', () => {
  it('lists the six screens in order, with Terminal by exact name', () => {
    expect(NAV.map((n) => n.label)).toEqual([
      'Map',
      'Terminal',
      'Editor',
      'Logs',
      'Metrics',
      'What you built',
    ]);
  });
  it('marks the map for a level and a screen for itself', () => {
    const map = NAV[0]!;
    const terminal = NAV[1]!;
    expect(isActive(map, { name: 'level', id: 'x' })).toBe(true);
    expect(isActive(terminal, { name: 'level', id: 'x' })).toBe(false);
    expect(isActive(terminal, { name: 'terminal' })).toBe(true);
    expect(isActive(map, { name: 'terminal' })).toBe(false);
    expect(isActive(map, null)).toBe(false);
  });
});

describe('palette matching', () => {
  it('shows everything for an empty query', () => {
    expect(paletteScore('go Terminal', '')).toBe(1);
    expect(paletteScore('go Terminal', '   ')).toBe(1);
  });
  it('ranks a prefix over a word start over the middle of a word', () => {
    const prefix = paletteScore('say hello · ch0-02', 'say');
    const word = paletteScore('go terminal', 'term');
    const wordStart = paletteScore('say hello · ch0-02', 'hello');
    const inside = paletteScore('say hello · ch0-02', 'ell');
    expect(prefix).toBe(1);
    expect(wordStart).toBeGreaterThan(inside);
    expect(word).toBeGreaterThan(inside);
  });
  it('does not match scattered letters', () => {
    expect(paletteScore('keyboard shortcuts', 'hello', ['help', 'keys', 'hotkeys'])).toBe(0);
  });
  it('matches words spread across the title and keywords', () => {
    expect(paletteScore('toggle sound', 'mute sound', ['audio', 'mute'])).toBeGreaterThan(0);
    expect(paletteScore('toggle sound', 'mute video', ['audio', 'mute'])).toBe(0);
  });
});
