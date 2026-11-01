import type { ThreadMessage } from '../types';

// Display names mirror fiction/cast.json (slug -> nickname). The UI does not bundle the JSON.
const NAMES: Record<string, string> = {
  roommate: 'Teja',
  senior: 'Harry Bhaiya',
  warden: 'Warden Sir',
  'sms-vendor': 'TextTara Sir',
  'rival-college': 'Gomti Gang',
  you: 'You',
};

export function nameOf(slug: string): string {
  return NAMES[slug] ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The WhatsApp-style incident thread. Text is plain, never markdown or HTML. */
export function Thread({ messages, label }: { messages: ThreadMessage[]; label: string }) {
  return (
    <ol className="thread" aria-label={label}>
      {messages.map((m, i) => (
        <li key={i} className={m.from === 'you' ? 'msg me' : 'msg'}>
          {m.from === 'you' ? null : <span className="msg-from">{nameOf(m.from)}</span>}
          <span className="msg-text">{m.text}</span>
          <time className="msg-time">{m.time}</time>
        </li>
      ))}
    </ol>
  );
}
