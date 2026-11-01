import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { highlight, Markdown } from '../src/markdown';

describe('highlight', () => {
  test('redis and js fences get their own grammar', () => {
    expect(highlight('SET greeting "hi" EX 60', 'redis').html).toContain('hljs-keyword');
    expect(highlight('const a = 1;', 'js').html).toContain('hljs-keyword');
  });
  test('an unlabelled block that looks like a Redis session is highlighted as redis', () => {
    expect(highlight('DBSIZE\n(integer) 0', undefined).lang).toBe('redis');
    expect(highlight('plain words', undefined).lang).toBe('text');
  });
  test('output is escaped', () => {
    expect(highlight('<script>alert(1)</script>', 'text').html).not.toContain('<script>');
  });
});

describe('Markdown', () => {
  test('external links open in a new tab, raw html is dropped', () => {
    const html = renderToStaticMarkup(<Markdown source={'[docs](https://redis.io/docs/latest/) <img src=x onerror=alert(1)>'} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('onerror');
  });
  test('javascript: links are not links', () => {
    const html = renderToStaticMarkup(<Markdown source={'[x](javascript:alert(1))'} />);
    expect(html).not.toContain('href');
  });
  test('inline code, fenced blocks and indented blocks', () => {
    const html = renderToStaticMarkup(<Markdown source={'Run `PING`.\n\n```redis\nGET a\n```\n\n    DBSIZE\n    (integer) 0\n'} />);
    expect(html).toContain('inline-code');
    expect(html.match(/class="codeblock"/g)).toHaveLength(2);
    expect(html).toContain('language-redis');
  });
});
