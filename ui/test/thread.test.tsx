import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Thread, nameOf } from '../src/level/Thread';
import type { ThreadMessage } from '../src/types';

const msgs: ThreadMessage[] = [
  { from: 'roommate', time: '19:24', text: 'bhai the app is not opening' },
  { from: 'roommate', time: '19:25', text: 'it works on yours?' },
  { from: 'you', time: '19:26', text: 'works on mine' },
  { from: 'senior', time: '20:06', text: 'Do not make me a liar <b>x</b>' },
];

describe('nameOf (unchanged)', () => {
  it('maps the cast and falls back to a readable name', () => {
    expect(nameOf('roommate')).toBe('Teja');
    expect(nameOf('senior')).toBe('Harry Bhaiya');
    expect(nameOf('you')).toBe('You');
    expect(nameOf('hostel-cat')).toBe('Hostel cat');
  });
});

describe('Thread markup (server render shows everything, readable without JS)', () => {
  const html = renderToStaticMarkup(<Thread messages={msgs} label="Boot incident thread" />);

  it('is a labelled polite list with one item per message', () => {
    expect(html).toMatch(/<ol[^>]*aria-label="Boot incident thread"/);
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/data-testid="thread-msg"/g)).toHaveLength(4);
  });
  it('keeps the legacy hooks the e2e suite uses', () => {
    expect(html).toMatch(/<ol[^>]*class="[^"]*\bthread\b/);
    expect(html).toMatch(/<li[^>]*class="[^"]*\bmsg\b/);
  });
  it('gives screen readers sender and time for every message', () => {
    expect(html).toContain('Teja at 19:24:');
    expect(html).toContain('You at 19:26:');
    expect(html).toContain('Harry Bhaiya at 20:06:');
  });
  it('shows a name and avatar once per run of the same sender, and none for the player', () => {
    expect(html.match(/data-testid="thread-avatar"/g)).toHaveLength(3 + 2); // 3 in the header stack, 2 beside runs (none for the player)
  });
  it('marks the player side and escapes message text', () => {
    expect(html).toMatch(/<li[^>]*data-from="you"[^>]*class="[^"]*\bme\b/);
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('offers Show all while playing or Replay when revealed', () => {
    expect(html).toContain('data-testid="thread-action"');
    expect(html).toContain('Replay');
  });
  it('renders nothing for an empty thread', () => {
    expect(renderToStaticMarkup(<Thread messages={[]} label="x" />)).toBe('');
  });
});
