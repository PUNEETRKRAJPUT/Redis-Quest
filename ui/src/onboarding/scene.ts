// Pure helpers for the opening scene: who speaks, which incident lines to show, and the timeline. No React here so
// the tests can run it in Node.
import type { ThreadMessage } from '../types';

export type Speaker = { name: string; initials: string; tone: 'sky' | 'cap' | 'flood' | 'dim' };

const SPEAKERS: Record<string, Speaker> = {
  roommate: { name: 'Teja', initials: 'T', tone: 'sky' },
  senior: { name: 'Harry Bhaiya', initials: 'HB', tone: 'cap' },
  you: { name: 'You', initials: 'Y', tone: 'flood' },
};

export const speakerFor = (from: string): Speaker =>
  SPEAKERS[from] ?? {
    name: from || 'Someone',
    initials: (from || '?').slice(0, 1).toUpperCase(),
    tone: 'dim',
  };

/** Written in the voice of docs/fiction.md; used when `GET /api/chapters` does not answer in time. */
export const FALLBACK_INCIDENT: ThreadMessage[] = [
  {
    from: 'roommate',
    time: '19:24',
    text: 'bhai the app is not opening on my laptop. it works on yours?',
  },
  { from: 'you', time: '19:25', text: 'works on mine. what does it say' },
  {
    from: 'roommate',
    time: '19:27',
    text: 'ERR_CONNECTION_REFUSED. screenshot attached. 12 screenshots actually',
  },
  { from: 'roommate', time: '19:36', text: 'closed the terminal. was that the server' },
  {
    from: 'senior',
    time: '20:06',
    text: 'I told the whole mess hall it launches tonight. Do not make me a liar',
  },
];

export const SCENE_LINES = 6;

/** The opening lines of chapter 0's incident, trimmed to what fits the scene. Empty input falls back. */
export function pickIncident(incident: ThreadMessage[] | null | undefined): ThreadMessage[] {
  const valid = (incident ?? []).filter(
    (m) => m && typeof m.text === 'string' && m.text.trim() && typeof m.from === 'string',
  );
  const source = valid.length >= 3 ? valid : FALLBACK_INCIDENT;
  if (source.length <= SCENE_LINES) return source;
  // The opening lines, then the first message from the senior: the escalation that makes it a real problem.
  const head = source.slice(0, SCENE_LINES - 1);
  const escalation = source.slice(SCENE_LINES - 1).find((m) => m.from === 'senior');
  return [...head, escalation ?? source[SCENE_LINES - 1]].filter((m): m is ThreadMessage => !!m);
}

/** Milliseconds from the start of the scene. */
export const TIMELINE = {
  lights: 450,
  title: 1000,
  chat: 3300,
  typing: 650,
  typingYou: 380,
  gap: 260,
  formAfterLast: 700,
} as const;

/** When each message lands, derived from the timeline (typing dots precede every message). */
export function messageSchedule(messages: ThreadMessage[]): { typingAt: number; at: number }[] {
  let t: number = TIMELINE.chat;
  return messages.map((m) => {
    const typingAt = t;
    t += m.from === 'you' ? TIMELINE.typingYou : TIMELINE.typing;
    const at = t;
    t += TIMELINE.gap;
    return { typingAt, at };
  });
}

export function formRevealAt(messages: ThreadMessage[]): number {
  const s = messageSchedule(messages);
  return (s[s.length - 1]?.at ?? TIMELINE.chat) + TIMELINE.formAfterLast;
}

/** The back of the shirt: upper-cased, trimmed, and kept short enough to print. */
export const shirtName = (name: string, max = 12): string =>
  name.trim().toUpperCase().slice(0, max);
