// E-01: the "Run my code in the app" switch. The UI has no DOM test environment, so the view renders to static
// markup and the click is the same function the button calls, run against a fake route.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ApiError } from '../src/api';
import {
  SLOT_BUSY_COPY,
  SLOT_LOOP_NOTE,
  SLOT_OFF_COPY,
  SLOT_ON_COPY,
  SlotToggle,
  SlotToggleView,
  toggleSlots,
} from '../src/level/SlotToggle';

test('renders on: switch checked, the on line, the loop note', () => {
  const html = renderToStaticMarkup(<SlotToggleView active />);
  expect(html).toContain('data-testid="slot-toggle"');
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('Run my code in the app');
  expect(html).toContain(SLOT_ON_COPY);
  expect(html).not.toContain(SLOT_OFF_COPY);
  expect(html).toContain('docker compose restart app');
  expect(SLOT_LOOP_NOTE).toContain('freezes an app instance');
});

test('clicking asks the engine for the opposite state, then reloads the level', async () => {
  const calls: Array<[string, boolean]> = [];
  let reloaded = 0;
  const set = async (id: string, active: boolean) => void calls.push([id, active]);
  expect(await toggleSlots('lvl', true, () => void reloaded++, set)).toBeNull();
  expect(calls).toEqual([['lvl', false]]);
  expect(reloaded).toBe(1);
  await toggleSlots('lvl', false, () => void reloaded++, set);
  expect(calls[1]).toEqual(['lvl', true]);
});

test('renders off after the reload', () => {
  const html = renderToStaticMarkup(<SlotToggleView active={false} />);
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain(SLOT_OFF_COPY);
  expect(html).not.toContain(SLOT_ON_COPY);
});

test('a 409 verify_in_progress says to wait and does not reload', async () => {
  let reloaded = 0;
  const msg = await toggleSlots(
    'lvl',
    false,
    () => void reloaded++,
    async () => {
      throw new ApiError(409, 'verify_in_progress', 'a verification is already running');
    },
  );
  expect(msg).toBe(SLOT_BUSY_COPY);
  expect(reloaded).toBe(0);
  expect(renderToStaticMarkup(<SlotToggleView active={false} message={msg} />)).toContain(
    'Wait for the verifier to finish',
  );
});

test('any other failure shows its message', async () => {
  const msg = await toggleSlots(
    'lvl',
    false,
    () => undefined,
    async () => {
      throw new ApiError(0, 'offline', 'Cannot reach the game engine.');
    },
  );
  expect(msg).toBe('Cannot reach the game engine.');
});

test('levels without slots show no switch', () => {
  const reload = () => undefined;
  expect(renderToStaticMarkup(<SlotToggle levelId="x" slots={undefined} reload={reload} />)).toBe(
    '',
  );
  expect(
    renderToStaticMarkup(
      <SlotToggle levelId="x" slots={{ own: [], active: false }} reload={reload} />,
    ),
  ).toBe('');
  expect(
    renderToStaticMarkup(
      <SlotToggle
        levelId="x"
        slots={{ own: ['cache.getPlayerStats'], active: true }}
        reload={reload}
      />,
    ),
  ).toContain('data-active="true"');
});
