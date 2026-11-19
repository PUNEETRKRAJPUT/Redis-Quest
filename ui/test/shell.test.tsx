// F-17: the shell's markup keeps the roles, names, test ids and wording the tests and e2e files rely on
// (static markup; the UI tests have no DOM).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BootInvalid, BootLoading, BootOffline } from '../src/shell/BootScreens';
import { CommandChip } from '../src/shell/CommandChip';
import { NavLinks, ScorePlate, StatusLight } from '../src/shell/Hud';
import { ShortcutsSheet } from '../src/shell/ShortcutsSheet';

const links = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);

describe('HUD navigation', () => {
  it('has the six links, and marks the active one with aria-current', () => {
    const html = renderToStaticMarkup(<NavLinks current={{ name: 'terminal' }} />);
    expect(html).toContain('aria-label="Main"');
    for (const [href, label] of [
      ['/', 'Map'],
      ['/terminal', 'Terminal'],
      ['/editor', 'Editor'],
      ['/logs', 'Logs'],
      ['/metrics', 'Metrics'],
      ['/built', 'What you built'],
    ] as const) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(`>${label}</span>`);
    }
    const marked = links(html).filter((a) => a.includes('aria-current="page"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('href="/terminal"');
  });
  it('marks nothing while the path is unknown (the Suspense fallback)', () => {
    expect(renderToStaticMarkup(<NavLinks current={null} />)).not.toContain('aria-current');
  });
  it('keeps the map marked on a level screen', () => {
    const marked = links(
      renderToStaticMarkup(<NavLinks current={{ name: 'level', id: 'ch0-01' }} />),
    ).filter((a) => a.includes('aria-current="page"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('href="/"');
  });
});

describe('HUD scoreboard', () => {
  it('shows the status wording the old header had, behind the conn-state test id', () => {
    const live = renderToStaticMarkup(<StatusLight ws="open" redisUp={true} />);
    expect(live).toContain('data-testid="conn-state"');
    expect(live).toContain('>live</span>');
    expect(live).toContain('aria-label="Connected to the engine and Redis"');
    const re = renderToStaticMarkup(<StatusLight ws="closed" redisUp={true} />);
    expect(re).toContain('>reconnecting</span>');
    expect(re).toContain('aria-label="Reconnecting to the engine"');
    const down = renderToStaticMarkup(<StatusLight ws="open" redisUp={false} />);
    expect(down).toContain('>redis down</span>');
    expect(down).toContain('aria-label="Redis is down"');
  });
  it('names the player, the rank, the XP and the way to the next rank', () => {
    const html = renderToStaticMarkup(<ScorePlate name="Asha" xp={325} />);
    expect(html).toContain('Asha, Club regular, 325 XP. 175 XP to District pick.');
    expect(html).toContain('XP 325');
    expect(html).toContain('href="/built"');
    expect(html).toContain('scaleX(');
  });
  it('says so at the top of the ladder', () => {
    const html = renderToStaticMarkup(<ScorePlate name="Asha" xp={9000} />);
    expect(html).toContain('Legend of the league');
    expect(html).toContain('Top of the ladder');
  });
});

describe('boot states', () => {
  it('loading says what it is doing and keeps the old text', () => {
    const html = renderToStaticMarkup(<BootLoading />);
    expect(html).toContain('Floodlights warming up');
    expect(html).toContain('Starting...');
    expect(html).toContain('role="status"');
  });
  it('offline keeps its test id, heading and instructions', () => {
    const html = renderToStaticMarkup(<BootOffline error="Cannot reach the game engine." />);
    expect(html).toContain('data-testid="offline"');
    expect(html).toContain('The game engine is not answering');
    expect(html).toContain('Cannot reach the game engine.');
    expect(html).toContain('Start the stack from the repo folder with');
    expect(html).toContain('./scripts/start');
    expect(html).toContain('This page keeps trying and will continue on its own.');
  });
  it('invalid lists the level-file errors', () => {
    const html = renderToStaticMarkup(
      <BootInvalid errors={['ch1/a.yaml: missing xp', 'ch2/b.yaml: bad verifier']} />,
    );
    expect(html).toContain('data-testid="levels-invalid"');
    expect(html).toContain('The level files have errors');
    expect(html).toContain('The engine refuses to run until they are fixed:');
    expect(html).toContain('ch1/a.yaml: missing xp');
    expect(html).toContain('ch2/b.yaml: bad verifier');
    expect((html.match(/<li /g) ?? []).length).toBe(2);
  });
});

describe('pieces', () => {
  it('shows the command the rain-delay strip tells the player to run, with a copy button', () => {
    const html = renderToStaticMarkup(<CommandChip command="docker compose start redis" />);
    expect(html).toContain('docker compose start redis');
    expect(html).toContain('aria-label="Copy docker compose start redis"');
  });
  it('lists every shortcut in the sheet', () => {
    const html = renderToStaticMarkup(
      <ShortcutsSheet open={false} onClose={() => {}} mod="Ctrl" />,
    );
    expect(html).toContain('Keyboard shortcuts');
    for (const label of ['Map', 'Terminal', 'Editor', 'Logs', 'Metrics', 'What you built'])
      expect(html).toContain(label);
    expect(html).toContain('Command palette');
    expect(html).toContain('Ctrl');
  });
});
