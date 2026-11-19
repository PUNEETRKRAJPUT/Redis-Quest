// F-18: the opening scene's pure parts, the cosmetic profile store, and the markup the e2e files rely on.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Bubble } from '../src/onboarding/Chat';
import { Jersey } from '../src/onboarding/Jersey';
import { NameForm } from '../src/onboarding/NameForm';
import {
  DEFAULT_JERSEY,
  JERSEYS,
  PROFILE_KEY,
  createProfileStore,
  isJerseyId,
} from '../src/onboarding/profile';
import {
  FALLBACK_INCIDENT,
  SCENE_LINES,
  TIMELINE,
  formRevealAt,
  messageSchedule,
  pickIncident,
  shirtName,
  speakerFor,
} from '../src/onboarding/scene';
import { Welcome } from '../src/screens/Welcome';
import type { ThreadMessage } from '../src/types';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const long: ThreadMessage[] = Array.from({ length: 9 }, (_, i) => ({
  from: i === 7 ? 'senior' : i % 2 ? 'you' : 'roommate',
  time: `19:${10 + i}`,
  text: `line ${i}`,
}));

test('pickIncident falls back on empty or tiny input and trims long threads, keeping the escalation', () => {
  expect(pickIncident(null)).toEqual(FALLBACK_INCIDENT);
  expect(pickIncident([])).toEqual(FALLBACK_INCIDENT);
  expect(pickIncident([{ from: 'you', time: '1', text: 'x' }])).toEqual(FALLBACK_INCIDENT);
  const picked = pickIncident(long);
  expect(picked).toHaveLength(SCENE_LINES);
  expect(picked.at(-1)?.from).toBe('senior');
  expect(picked.slice(0, SCENE_LINES - 1)).toEqual(long.slice(0, SCENE_LINES - 1));
});

test('the schedule is increasing, typing precedes each message, and the form follows the last one', () => {
  const msgs = pickIncident(null);
  const s = messageSchedule(msgs);
  expect(s).toHaveLength(msgs.length);
  expect(s[0]?.typingAt).toBe(TIMELINE.chat);
  s.forEach((x, i) => {
    expect(x.at).toBeGreaterThan(x.typingAt);
    if (i) expect(x.typingAt).toBeGreaterThan(s[i - 1]?.at ?? 0);
  });
  expect(formRevealAt(msgs)).toBeGreaterThan(s.at(-1)?.at ?? 0);
  // The brief: goosebumps in ten seconds, then out of the way.
  expect(formRevealAt(pickIncident(long))).toBeLessThan(11_000);
});

test('speakers and shirt names', () => {
  expect(speakerFor('roommate').name).toBe('Teja');
  expect(speakerFor('senior').name).toBe('Harry Bhaiya');
  expect(speakerFor('you').name).toBe('You');
  expect(speakerFor('warden').initials).toBe('W');
  expect(shirtName('  rhea ')).toBe('RHEA');
  expect(shirtName('a very very long player name', 12)).toHaveLength(12);
});

test('profile store: six palette jerseys, persisted, garbage ignored', async () => {
  expect(JERSEYS).toHaveLength(6);
  expect(isJerseyId('turf')).toBe(true);
  expect(isJerseyId('redis')).toBe(false);
  const storage = memory();
  const a = createProfileStore(() => storage);
  expect(a.getState().jersey).toBe(DEFAULT_JERSEY);
  a.getState().setJersey('sky');
  expect(JSON.parse(storage.getItem(PROFILE_KEY) ?? '{}').state.jersey).toBe('sky');
  const b = createProfileStore(() => storage);
  await b.persist.rehydrate();
  expect(b.getState().jersey).toBe('sky');
  storage.setItem(PROFILE_KEY, JSON.stringify({ state: { jersey: 'nope' }, version: 1 }));
  const c = createProfileStore(() => storage);
  await c.persist.rehydrate();
  expect(c.getState().jersey).toBe(DEFAULT_JERSEY);
});

test('the name form keeps its test ids, label and a disabled submit while the name is empty', () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    <NameForm name="" onNameChange={noop} onSubmit={noop} busy={false} error={null} />,
  );
  expect(html).toContain('data-testid="player-name"');
  expect(html).toContain('data-testid="player-submit"');
  expect(html).toContain('What should Teja call you?');
  expect(html).toContain('Start Chapter 0');
  expect(html).toMatch(
    /data-testid="player-submit"[^>]*disabled|disabled[^>]*data-testid="player-submit"/,
  );
  expect(html).toContain('role="radiogroup"');
  expect((html.match(/role="radio"/g) ?? []).length).toBe(6);
  expect(html).toContain('role="switch"');

  const filled = renderToStaticMarkup(
    <NameForm name="Rhea" onNameChange={noop} onSubmit={noop} busy={false} error="Nope" />,
  );
  expect(filled).toContain('role="alert"');
  expect(filled).toContain('RHEA');
  expect(filled).not.toMatch(/data-testid="player-submit"[^>]*disabled/);
});

test('bubbles carry who said it, the time and the text; the jersey is labelled', () => {
  const html = renderToStaticMarkup(
    <Bubble message={{ from: 'roommate', time: '19:24', text: 'bhai it is down' }} reduced />,
  );
  expect(html).toContain('Teja');
  expect(html).toContain('19:24');
  expect(html).toContain('bhai it is down');
  expect(renderToStaticMarkup(<Jersey color="red" name="Rhea" />)).toContain(
    'Jersey number 07, RHEA',
  );
});

test('Welcome renders the welcome test id and the skip control', () => {
  const html = renderToStaticMarkup(<Welcome />);
  expect(html).toContain('data-testid="welcome"');
  expect(html).toContain('data-ds=""');
  expect(html).toContain('Skip intro');
  expect(html).toContain('aria-label="Redis Quest"');
});
