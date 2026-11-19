// F-16: the primitives render with the right roles and states (static markup; the UI tests have no DOM).
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import * as ds from '../src/design';

const {
  Button,
  Card,
  Dialog,
  EmptyState,
  FlipNumber,
  IconButton,
  Kbd,
  Meter,
  Panel,
  Pill,
  ProgressBar,
  Scoreline,
  Segmented,
  Skeleton,
  Switch,
  Tabs,
  Tooltip,
} = ds;

test('index.ts exports every primitive and helper the spec names', () => {
  for (const name of [
    'Button',
    'IconButton',
    'Card',
    'Panel',
    'Pill',
    'Kbd',
    'Tooltip',
    'Dialog',
    'Tabs',
    'ProgressBar',
    'Meter',
    'Skeleton',
    'EmptyState',
    'Toaster',
    'toast',
    'FlipNumber',
    'Confetti',
    'Floodlights',
    'Scoreline',
    'play',
    'useReducedMotion',
    'useSettings',
    'fade',
    'rise',
    'pop',
    'list',
    'listItem',
  ]) {
    expect(ds, name).toHaveProperty(name);
  }
});

test('Button: variants, loading keeps the label and sets aria-busy, disabled is flat', () => {
  const html = renderToStaticMarkup(<Button>Check my work</Button>);
  expect(html).toContain('type="button"');
  expect(html).toContain('bg-flood-500');
  expect(html).toContain('data-ds');
  const busy = renderToStaticMarkup(
    <Button loading loadingText="Decision pending">
      Check my work
    </Button>,
  );
  expect(busy).toContain('aria-busy="true"');
  expect(busy).toContain('disabled=""');
  expect(busy).toContain('Decision pending');
  const off = renderToStaticMarkup(
    <Button variant="ghost" disabled>
      Hint
    </Button>,
  );
  expect(off).toContain('cursor-not-allowed');
  expect(renderToStaticMarkup(<Button variant="danger">x</Button>)).toContain('text-wicket');
});

test('IconButton has an accessible name; Tooltip stays closed until hover or focus', () => {
  const html = renderToStaticMarkup(<IconButton label="Copy command" icon={<svg />} />);
  expect(html).toContain('aria-label="Copy command"');
  expect(html).not.toContain('role="tooltip"');
  const t = renderToStaticMarkup(
    <Tooltip content="Palette">
      <button type="button">p</button>
    </Tooltip>,
  );
  expect(t).toContain('<button type="button">p</button>');
});

test('Tabs: tablist, selected tab, linked panel, roving tabindex', () => {
  const html = renderToStaticMarkup(
    <Tabs
      label="Level"
      items={[
        { id: 'a', label: 'Brief', content: 'brief text' },
        { id: 'b', label: 'Hints', content: 'hint text' },
      ]}
    />,
  );
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Level"');
  expect(html.match(/role="tab"/g)).toHaveLength(2);
  expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
  expect(html).toMatch(/aria-selected="false"[^>]*tabindex="-1"/);
  expect(html).toContain('role="tabpanel"');
  expect(html).toContain('brief text');
  expect(html).not.toContain('hint text');
});

test('Switch and Segmented use switch and radio semantics', () => {
  const sw = renderToStaticMarkup(<Switch checked label="Sound" onCheckedChange={() => {}} />);
  expect(sw).toContain('role="switch"');
  expect(sw).toContain('aria-checked="true"');
  const seg = renderToStaticMarkup(
    <Segmented
      label="Reduce motion"
      value="on"
      onValueChange={() => {}}
      options={[
        { value: 'system', label: 'System' },
        { value: 'on', label: 'Reduce' },
      ]}
    />,
  );
  expect(seg).toContain('role="radiogroup"');
  expect(seg).toMatch(/role="radio" aria-checked="true" tabindex="0"/);
});

test('ProgressBar and Meter expose their values', () => {
  const p = renderToStaticMarkup(
    <ProgressBar label="Chapter" value={7} max={12} valueText="7 / 12" />,
  );
  expect(p).toContain('role="progressbar"');
  expect(p).toContain('aria-valuenow="7"');
  expect(p).toContain('aria-valuemax="12"');
  expect(p).toContain('scaleX(0.58');
  const ind = renderToStaticMarkup(<ProgressBar label="Waiting" />);
  expect(ind).not.toContain('aria-valuenow');
  const m = renderToStaticMarkup(<Meter label="Memory" value={95} />);
  expect(m).toContain('role="meter"');
  expect(m).toContain('text-wicket');
  expect(renderToStaticMarkup(<Meter label="Memory" value={10} />)).toContain('text-turf');
});

test('FlipNumber announces the number once and hides the cells', () => {
  const html = renderToStaticMarkup(<FlipNumber value={42} minDigits={4} label="XP" />);
  expect(html).toContain('XP 42');
  expect(html.match(/ds-flap /g)).toHaveLength(4);
  expect(html).toContain('aria-hidden="true"');
  const s = renderToStaticMarkup(<Scoreline label="XP" value={1240} delta={40} unit="pts" />);
  expect(s).toContain('1240');
  expect(s).toContain('+40');
  expect(s).toContain('text-turf');
});

test('surfaces: Card, Panel, Pill, Kbd, Skeleton, EmptyState, closed Dialog', () => {
  expect(renderToStaticMarkup(<Card focal>x</Card>)).toContain('border-flood-500/45');
  const panel = renderToStaticMarkup(
    <Panel title="Checks" eyebrow="Match" actions={<span>act</span>}>
      body
    </Panel>,
  );
  expect(panel).toContain('<h3');
  expect(panel).toContain('Checks');
  expect(panel).toContain('act');
  const pill = renderToStaticMarkup(
    <Pill variant="status" tone="turf" live>
      Live
    </Pill>,
  );
  expect(pill).toContain('animate-live');
  expect(renderToStaticMarkup(<Kbd>K</Kbd>)).toContain('<kbd');
  expect(renderToStaticMarkup(<Skeleton lines={3} />).match(/animate-shimmer/g)).toHaveLength(3);
  expect(renderToStaticMarkup(<EmptyState title="No caps yet">Pass a level</EmptyState>)).toContain(
    'No caps yet',
  );
  const dlg = renderToStaticMarkup(
    <Dialog open={false} onClose={() => {}} title="Flush?">
      body
    </Dialog>,
  );
  expect(dlg).toContain('<dialog');
  expect(dlg).not.toContain(' open=""');
  expect(dlg).toContain('aria-labelledby');
});
