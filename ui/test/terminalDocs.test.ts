import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cliSource,
  engineSource,
  DocsStore,
  DocsUnavailable,
  docFromTree,
  docsFromCliText,
  isCoreName,
  namesFromCliText,
  type CommandDoc,
  type DocsSource,
} from '../src/terminal/docs';
import { REPLIES } from './terminal.fixtures';

describe('reading the real COMMAND DOCS / COMMAND LIST replies', () => {
  test('GET: summary, group, since, complexity and its one argument come from the server text', () => {
    const doc = docsFromCliText(REPLIES.get as string).get as CommandDoc;
    expect(doc.name).toBe('get');
    expect(doc.summary).toBe('Returns the string value of a key.');
    expect(doc.group).toBe('string');
    expect(doc.since).toBe('1.0.0');
    expect(doc.complexity).toBe('O(1)');
    expect(doc.arguments).toHaveLength(1);
    expect(doc.arguments[0]).toMatchObject({
      name: 'key',
      type: 'key',
      label: 'key',
      optional: false,
    });
  });

  test('SET: tokens, optional flags and oneof alternatives survive the nesting', () => {
    const doc = docsFromCliText(REPLIES.set as string).set as CommandDoc;
    const names = doc.arguments.map((a) => a.name);
    expect(names.slice(0, 3)).toEqual(['key', 'value', 'condition']);
    const condition = doc.arguments[2];
    expect(condition).toMatchObject({ type: 'oneof', optional: true });
    expect(condition?.arguments.map((a) => a.token).slice(0, 2)).toEqual(['NX', 'XX']);
    const get = doc.arguments.find((a) => a.name === 'get');
    expect(get).toMatchObject({ type: 'pure-token', token: 'GET', optional: true });
  });

  test('CLIENT is a container: its subcommands carry their own summary and arguments', () => {
    const doc = docsFromCliText(REPLIES.client as string).client as CommandDoc;
    expect(Object.keys(doc.subcommands)).toContain('client|list');
    expect(doc.subcommands['client|list']?.summary).toMatch(/connections/i);
    const unblock = doc.subcommands['client|unblock'] as CommandDoc;
    expect(unblock.arguments.map((a) => a.name)).toEqual(['client-id', 'unblock-type']);
  });

  test('COMMAND LIST names include subcommands as parent|child', () => {
    const names = namesFromCliText(REPLIES.LIST as string);
    expect(names.length).toBeGreaterThan(200);
    expect(names).toContain('get');
    expect(names).toContain('client|list');
  });

  test('module commands are recognised by the server group and, before docs arrive, by their name', () => {
    const vadd = docsFromCliText(REPLIES.vadd as string).vadd as CommandDoc;
    expect(vadd.group).toBe('module');
    expect(isCoreName('get')).toBe(true);
    expect(isCoreName('client|list')).toBe(true);
    for (const n of ['VADD', 'FT.SEARCH', 'ts.info', 'json.forget', '_FT.CURSOR|READ'])
      expect(isCoreName(n)).toBe(false);
  });

  test('JSON from an engine endpoint gives the same model as the redis-cli text', () => {
    const viaText = docsFromCliText(REPLIES.expire as string).expire as CommandDoc;
    const json = {
      summary: viaText.summary,
      since: viaText.since,
      group: viaText.group,
      complexity: viaText.complexity,
      arguments: [
        { name: 'key', type: 'key', display_text: 'key' },
        { name: 'seconds', type: 'integer', display_text: 'seconds' },
        {
          name: 'condition',
          type: 'oneof',
          flags: ['optional'],
          arguments: [{ name: 'nx', type: 'pure-token', display_text: 'nx', token: 'NX' }],
        },
      ],
    };
    const doc = docFromTree('EXPIRE', json) as CommandDoc;
    expect(doc.name).toBe('expire');
    expect(doc.arguments.map((a) => a.name)).toEqual(['key', 'seconds', 'condition']);
    expect(doc.arguments[2]).toMatchObject({ optional: true, type: 'oneof' });
  });

  test('anything that is not a documentation map is ignored', () => {
    expect(docFromTree('x', null)).toBeNull();
    expect(docFromTree('x', 'text')).toBeNull();
    expect(docsFromCliText('(error) ERR unknown command')).toEqual({});
    expect(namesFromCliText('(empty array)')).toEqual([]);
  });
});

function fakeSource(overrides: Partial<DocsSource> = {}) {
  const calls = { names: 0, docs: [] as string[][] };
  const source: DocsSource = {
    async names() {
      calls.names++;
      return ['get', 'set', 'client', 'client|list'];
    },
    async docs(names) {
      calls.docs.push(names);
      return Object.fromEntries(
        names
          .filter((n) => n !== 'nope')
          .map((n) => [n, { name: n, summary: `doc of ${n}`, arguments: [], subcommands: {} }]),
      );
    },
    ...overrides,
  };
  return { source, calls };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('DocsStore', () => {
  test('names are asked for once however often they are needed', async () => {
    const { source, calls } = fakeSource();
    const store = new DocsStore(source);
    store.ensureNames();
    store.ensureNames();
    store.ensureNames();
    await tick(5);
    store.ensureNames();
    expect(calls.names).toBe(1);
    expect(store.names()).toEqual(['get', 'set', 'client', 'client|list']);
    expect(store.has('GET')).toBe(true);
    expect(store.has('zzz')).toBe(false);
  });

  test('docs are fetched on first need, in one batch, and cached', async () => {
    const { source, calls } = fakeSource();
    const store = new DocsStore(source, { batchMs: 1 });
    expect(store.doc('get')).toBeUndefined();
    store.want(['get', 'set']);
    store.want(['get', 'client']);
    await tick();
    expect(calls.docs).toEqual([['get', 'set', 'client']]);
    expect((store.doc('GET') as CommandDoc).summary).toBe('doc of get');
    store.want(['get']);
    await tick();
    expect(calls.docs).toHaveLength(1);
  });

  test('a name the server does not know is remembered as missing; subcommands are never asked for', async () => {
    const { source, calls } = fakeSource();
    const store = new DocsStore(source, { batchMs: 1 });
    store.want(['nope', 'client|list']);
    await tick();
    expect(calls.docs).toEqual([['nope']]);
    expect(store.doc('nope')).toBe('missing');
  });

  test('a source that fails stays quiet, is not hammered, and is retried after the pause', async () => {
    let now = 1000;
    let fail = true;
    const { source, calls } = fakeSource({
      async names() {
        calls.names++;
        if (fail) throw new DocsUnavailable('down');
        return ['get'];
      },
    });
    const store = new DocsStore(source, { retryMs: 5000 }, () => now);
    store.ensureNames();
    await tick(5);
    expect(store.names()).toBeNull();
    store.ensureNames();
    await tick(5);
    expect(calls.names).toBe(1); // inside the pause
    now += 6000;
    fail = false;
    store.ensureNames();
    await tick(5);
    expect(store.names()).toEqual(['get']);
    expect(calls.names).toBe(2);
  });

  test('subscribers hear about arriving data and the version moves', async () => {
    const { source } = fakeSource();
    const store = new DocsStore(source, { batchMs: 1 });
    let heard = 0;
    store.subscribe(() => heard++);
    const v0 = store.version();
    store.want(['get']);
    await tick();
    expect(heard).toBe(1);
    expect(store.version()).toBeGreaterThan(v0);
  });
});

function stubFetch(routes: Record<string, () => { status?: number; body: unknown } | 'throw'>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    const r = routes[url.split('?')[0] as string]?.() ?? { status: 404, body: {} };
    if (r === 'throw') throw new TypeError('network');
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  });
  return asked;
}

describe('engineSource (the default; the endpoint is proposed, not built)', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('an engine that does not advertise command docs is never asked for them (no 404 in the console)', async () => {
    const asked = stubFetch({ '/health': () => ({ body: { ok: true } }) });
    await expect(engineSource.names()).rejects.toBeInstanceOf(DocsUnavailable);
    expect(asked).toEqual(['/health']);
  });

  test('names and docs through the contract in the handoff', async () => {
    const reply = [
      'get',
      [
        'summary',
        'Returns the string value of a key.',
        'group',
        'string',
        'arguments',
        [['name', 'key', 'type', 'key']],
      ],
    ];
    const asked = stubFetch({
      '/health': () => ({ body: { ok: true, commandDocs: true } }),
      '/api/command-docs/names': () => ({ body: { names: ['get', 'set', 7] } }),
      '/api/command-docs': () => ({ body: { reply } }),
    });
    expect(await engineSource.names()).toEqual(['get', 'set']);
    const docs = await engineSource.docs(['get', 'set']);
    expect(docs.get?.summary).toBe('Returns the string value of a key.');
    expect(docs.get?.arguments[0]?.name).toBe('key');
    expect(docs.set).toBeUndefined();
    expect(asked[asked.length - 1]).toBe('/api/command-docs?names=get%2Cset');
  });

  test('Redis down (answered 200 with available:false), a failing engine and a dead network are all "unavailable"', async () => {
    stubFetch({
      '/health': () => ({ body: { commandDocs: true } }),
      '/api/command-docs/names': () => ({ body: { available: false } }),
      '/api/command-docs': () => ({ status: 503, body: {} }),
    });
    await expect(engineSource.names()).rejects.toBeInstanceOf(DocsUnavailable);
    await expect(engineSource.docs(['get'])).rejects.toBeInstanceOf(DocsUnavailable);
    stubFetch({ '/health': () => 'throw' });
    await expect(engineSource.names()).rejects.toBeInstanceOf(DocsUnavailable);
  });
});

describe('cliSource (the not-wired alternative)', () => {
  test('asks COMMAND LIST and COMMAND DOCS through the given runner and parses the text', async () => {
    const sent: string[] = [];
    const src = cliSource(async (c) => {
      sent.push(c);
      return {
        reply: c.startsWith('COMMAND LIST') ? (REPLIES.LIST as string) : (REPLIES.get as string),
        type: 'array',
      };
    });
    expect((await src.names()).length).toBeGreaterThan(200);
    expect((await src.docs(['get']))['get']?.summary).toMatch(/string value/);
    expect(sent).toEqual(['COMMAND LIST', 'COMMAND DOCS get']);
  });

  test('an error reply (Redis busy, down) is "unavailable", never a crash', async () => {
    const src = cliSource(async () => ({
      reply: '(error) BUSY Redis is busy running a script.',
      type: 'error',
    }));
    await expect(src.names()).rejects.toBeInstanceOf(DocsUnavailable);
    const down = cliSource(async () => {
      throw new Error('offline');
    });
    await expect(down.docs(['get'])).rejects.toBeInstanceOf(DocsUnavailable);
  });
});
