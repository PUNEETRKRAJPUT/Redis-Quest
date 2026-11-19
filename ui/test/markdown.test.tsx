import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { commandToSend, highlight, Markdown } from '../src/markdown';
import { setDocsSource, type DocsStore } from '../src/terminal/docs';

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
    const html = renderToStaticMarkup(
      <Markdown source={'[docs](https://redis.io/docs/latest/) <img src=x onerror=alert(1)>'} />,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('onerror');
  });
  test('javascript: links are not links', () => {
    const html = renderToStaticMarkup(<Markdown source={'[x](javascript:alert(1))'} />);
    expect(html).not.toContain('href');
  });
  test('inline code, fenced blocks and indented blocks', () => {
    const html = renderToStaticMarkup(
      <Markdown source={'Run `PING`.\n\n```redis\nGET a\n```\n\n    DBSIZE\n    (integer) 0\n'} />,
    );
    expect(html).toContain('inline-code');
    expect(html.match(/class="codeblock"/g)).toHaveLength(2);
    expect(html).toContain('language-redis');
  });
});

describe('send to terminal on Redis commands', () => {
  const seeded = (names: string[]) => {
    const store = setDocsSource({
      names: async () => names,
      docs: async () => ({}),
    }) as DocsStore;
    store.seed(names);
    return store;
  };
  afterEach(() => setDocsSource(null));

  test('without a command list from the server nothing is clickable, and the markup is the plain one', () => {
    setDocsSource({ names: async () => [], docs: async () => ({}) });
    const html = renderToStaticMarkup(
      <Markdown source={'Run `GET greeting`.\n\n```redis\nSET a 1\n```'} />,
    );
    expect(html).not.toContain('Send ');
    expect(html.match(/<button/g)).toHaveLength(1); // only the block's Copy button
    expect(html).toContain('inline-code');
  });

  test('an inline code span whose first word is a listed command gets an action; others do not', () => {
    seeded(['get', 'set', 'ping']);
    const html = renderToStaticMarkup(
      <Markdown source={'Run `GET greeting` or `redis-cli` or `EX 60` or `PING`.'} />,
    );
    expect(html).toContain('aria-label="Send GET greeting to the terminal"');
    expect(html).toContain('aria-label="Send PING to the terminal"');
    expect(html).not.toContain('Send redis-cli');
    expect(html).not.toContain('Send EX 60');
  });

  test('the action adds no text to the lesson: the visible words are the same with and without it', () => {
    const source = 'Then `GET greeting` returns it.';
    const strip = (h: string) =>
      h.replace(/<button[\s\S]*?<\/button>/g, '').replace(/<[^>]+>/g, '');
    setDocsSource(null);
    seeded([]);
    const plain = strip(renderToStaticMarkup(<Markdown source={source} />));
    seeded(['get']);
    const withAction = renderToStaticMarkup(<Markdown source={source} />);
    expect(withAction).toContain('Send GET greeting');
    expect(strip(withAction)).toBe(plain);
  });

  test('lines of a redis block are actions when their first word is a command; replies and comments are not', () => {
    seeded(['set', 'get']);
    const html = renderToStaticMarkup(
      <Markdown
        source={'```redis\n# store it\nSET a 1\nOK\nredis> GET a\n"1"\n(integer) 3\n```'}
      />,
    );
    expect(html).toContain('aria-label="Send SET a 1 to the terminal"');
    expect(html).toContain('aria-label="Send GET a to the terminal"'); // the prompt is dropped
    expect(html.match(/aria-label="Send /g)).toHaveLength(2);
  });

  test('blocks in other languages are never actions, even if a line starts with a command name', () => {
    seeded(['get', 'set']);
    const html = renderToStaticMarkup(<Markdown source={'```js\nget(key)\nset(key, 1)\n```'} />);
    expect(html).not.toContain('Send ');
  });

  test('commandToSend', () => {
    const has = (n: string) => ['get', 'set'].includes(n);
    expect(commandToSend('GET a', has)).toBe('GET a');
    expect(commandToSend('  set a 1  ', has)).toBe('set a 1');
    expect(commandToSend('127.0.0.1:6379> GET a', has)).toBe('GET a');
    expect(commandToSend('# GET a', has)).toBeNull();
    expect(commandToSend('OK', has)).toBeNull();
    expect(commandToSend('GETX a', has)).toBeNull();
    expect(commandToSend('', has)).toBeNull();
  });
});
