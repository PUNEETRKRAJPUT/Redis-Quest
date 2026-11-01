// E-04: "Write my story". No DOM environment, so the view renders to static markup and the click is the same
// function the button calls, run against fake routes.
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ApiError } from '../src/api';
import { StoryView, writeStory, type StoryState } from '../src/screens/Story';

const html = (state: StoryState) =>
  renderToStaticMarkup(<StoryView state={state} onWrite={() => undefined} />);

test('idle: the button is there and nothing is shown yet', () => {
  const h = html({ phase: 'idle' });
  expect(h).toContain('data-testid="write-portfolio"');
  expect(h).toContain('Write my story');
  expect(h).not.toContain('portfolio-result');
  expect(h).not.toContain('disabled');
});

test('busy: the button is disabled', () => {
  const h = html({ phase: 'busy' });
  expect(h).toContain('disabled');
  expect(h).toContain('Writing...');
});

test('done: the path and the page, rendered as markdown', () => {
  const h = html({
    phase: 'done',
    path: 'workspace/PORTFOLIO.md',
    bytes: 1234,
    markdown:
      "# Asha's Redis Quest portfolio\n\n- **Cache-aside** (ch2-02): p99 4,100 ms to 11 ms\n",
  });
  expect(h).toContain('data-testid="portfolio-path"');
  expect(h).toContain('workspace/PORTFOLIO.md');
  expect(h).toContain('1234 bytes');
  expect(h).toContain('data-testid="portfolio-markdown"');
  expect(h).toContain('<h1>Asha&#x27;s Redis Quest portfolio</h1>');
  expect(h).toContain('<strong>Cache-aside</strong>');
  expect(h).toContain('p99 4,100 ms to 11 ms');
  expect(h).toContain('Write it again');
});

test('the markdown cannot inject html', () => {
  const h = html({
    phase: 'done',
    path: 'p',
    bytes: 1,
    markdown: '<img src=x onerror=alert(1)> hi',
  });
  expect(h).not.toContain('<img');
});

test('error: the message is shown', () => {
  const h = html({ phase: 'error', message: 'Cannot reach the game engine.' });
  expect(h).toContain('role="alert"');
  expect(h).toContain('Cannot reach the game engine.');
});

test('writeStory writes, then reads the file back', async () => {
  const calls: string[] = [];
  const s = await writeStory({
    write: async () => {
      calls.push('write');
      return { path: 'workspace/PORTFOLIO.md', bytes: 42, levels: 9, passed: 3 };
    },
    read: async () => {
      calls.push('read');
      return '# page';
    },
  });
  expect(calls).toEqual(['write', 'read']);
  expect(s).toEqual({
    phase: 'done',
    path: 'workspace/PORTFOLIO.md',
    bytes: 42,
    markdown: '# page',
  });
});

test('writeStory turns a failed write into an error state and never reads', async () => {
  let read = 0;
  const s = await writeStory({
    write: async () => {
      throw new ApiError(500, 'internal', 'the engine could not write the file');
    },
    read: async () => {
      read++;
      return '';
    },
  });
  expect(read).toBe(0);
  expect(s).toEqual({ phase: 'error', message: 'the engine could not write the file' });
});
