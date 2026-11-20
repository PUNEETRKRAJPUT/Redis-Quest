// Completion for the learner's `redis`, `db` and `log`: pure functions, no Monaco and no DOM.
//
// The member lists are not written here. They come from `client-api.generated.json`, which
// `scripts/dev/gen-client-api.mjs` reads out of the installed library's own type definitions (node-redis, with the
// version recorded in the file). This module only decides WHAT is being completed (`completionContext`) and turns
// the generated members into suggestions (`suggestionsFor`); `register.ts` hands them to Monaco.

export type MemberKind = 'method' | 'property' | 'namespace';

export interface ApiMember {
  name: string;
  kind: MemberKind;
  /** Methods: `(key: RedisArgument, value: ...)`. */
  params?: string;
  returns?: string;
  /** Methods with several accepted argument lists: every form, the first being `params`. */
  forms?: string[];
  /** Properties: the type, as text. */
  type?: string;
  doc?: string;
  /** Namespaces (`json`, `ft`, `ts`, `bf` ...): their methods. */
  members?: ApiMember[];
}

export interface ClientApi {
  source: {
    library: string;
    version: string;
    clientLibrary: string;
    clientVersion: string;
    typescript: string;
    walked: string;
  };
  redis: ApiMember[];
  multi: { shared: string[]; only: ApiMember[] };
  db: ApiMember[];
  log: { call: { params: string; returns: string } | null; members: ApiMember[] };
}

/** What a `.` follows. */
export type Target =
  | { kind: 'redis' }
  | { kind: 'multi' }
  | { kind: 'db' }
  | { kind: 'log' }
  | { kind: 'namespace'; name: string; inMulti: boolean };

export interface CompletionContext {
  target: Target;
  /** What was already typed after the dot. */
  prefix: string;
}

// ---- what is being completed ---------------------------------------------------------------------------------
/** The names a learner file gets from `deps`: `redisCached` is a second client of the same type. */
const ROOTS = /(?:\bdeps\s*\.\s*)?\b(redisCached|redis|db|log)(?![\w$])/g;
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const CHAIN_ENDS = ['exec', 'execAsPipeline', 'execTyped', 'execAsPipelineTyped'];

type State = 'client' | 'multi' | 'db' | 'log' | { ns: string; inMulti: boolean } | null;

/** Index just past the `)` that closes the `(` at `open`; -1 when it never closes. Skips strings and comments. */
function skipCall(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
      if (i >= text.length) return -1;
    } else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
    } else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function afterCall(state: State, name: string): State {
  if (state === 'client') return name === 'multi' || name === 'MULTI' ? 'multi' : null;
  if (state === 'multi') return CHAIN_ENDS.includes(name) ? null : 'multi';
  if (state !== null && typeof state === 'object') return state.inMulti ? 'multi' : null;
  return null;
}

function afterProperty(state: State, name: string, namespaces: readonly string[]): State {
  if ((state === 'client' || state === 'multi') && namespaces.includes(name))
    return { ns: name, inMulti: state === 'multi' };
  return null;
}

function walk(
  text: string,
  from: number,
  root: string,
  namespaces: readonly string[],
): CompletionContext | null {
  let state: State = root === 'db' ? 'db' : root === 'log' ? 'log' : 'client';
  let i = from;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };
  for (;;) {
    ws();
    if (text[i] === '?' && text[i + 1] === '.') i++;
    if (text[i] !== '.') return null;
    i++;
    ws();
    const start = i;
    if (i < text.length && IDENT_START.test(text[i] as string)) {
      i++;
      while (i < text.length && IDENT_PART.test(text[i] as string)) i++;
    }
    const ident = text.slice(start, i);
    if (i >= text.length) {
      // The text ends here: this is the member being typed.
      return state === null ? null : { target: targetOf(state), prefix: ident };
    }
    if (ident === '') return null;
    ws();
    if (text[i] === '(') {
      const end = skipCall(text, i);
      if (end < 0) return null;
      i = end;
      state = afterCall(state, ident);
    } else {
      state = afterProperty(state, ident, namespaces);
    }
  }
}

function targetOf(s: Exclude<State, null>): Target {
  if (s === 'client') return { kind: 'redis' };
  if (s === 'multi') return { kind: 'multi' };
  if (s === 'db') return { kind: 'db' };
  if (s === 'log') return { kind: 'log' };
  return { kind: 'namespace', name: s.ns, inMulti: s.inMulti };
}

/** True when the end of `text` is inside a string on its last line, a `//` comment, or an unclosed block comment. */
export function insideStringOrComment(text: string): boolean {
  if (text.lastIndexOf('/*') > text.lastIndexOf('*/')) return true;
  const line = text.slice(text.lastIndexOf('\n') + 1);
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && line[i + 1] === '/') return true;
  }
  return quote !== '';
}

/**
 * What the cursor is completing, from the text before it: `redis.` the client, `redis.multi().set('a', 1).` the
 * chain, `redis.json.` a module, `db.` and `log.`; `deps.redis.` works too. Variables that alias them
 * (`const m = redis.multi(); m.`) are not followed. `namespaces` are the module names from the generated list.
 */
export function completionContext(
  before: string,
  namespaces: readonly string[] = [],
): CompletionContext | null {
  const text = before.slice(-4000);
  if (!/\.\s*[\w$]*$/.test(text) || insideStringOrComment(text)) return null;
  const roots = [...text.matchAll(ROOTS)];
  // The last root first: in `redis.set('a', db.` the dot belongs to `db`.
  for (let k = roots.length - 1; k >= 0; k--) {
    const m = roots[k] as RegExpMatchArray;
    const at = m.index as number;
    const prev = at > 0 ? (text[at - 1] as string) : '';
    // `x.redis.` or `foo_redis.` is somebody else's member, not the learner's client.
    if (prev === '.' || IDENT_PART.test(prev)) continue;
    const found = walk(text, at + m[0].length, m[1] as string, namespaces);
    if (found) return found;
  }
  return null;
}

// ---- the suggestions -----------------------------------------------------------------------------------------
export interface Suggestion {
  label: string;
  kind: MemberKind;
  /** `name($0)` for a method (a snippet), the bare name otherwise. */
  insertText: string;
  snippet: boolean;
  /** `(key: RedisArgument, ...)`, shown next to the name. */
  detail: string;
  /** What it returns (methods) or its type (properties). */
  description: string;
  documentation: string;
  sortText: string;
}

export const MULTI_CHAIN = 'the multi chain';

/** Where the list came from, for the suggestion's documentation: `node-redis 5.12.1`. */
export function sourceLabel(api: ClientApi): string {
  return `node-redis ${api.source.version} type definitions`;
}

function toSuggestion(m: ApiMember, api: ClientApi, chain: boolean): Suggestion {
  const isMethod = m.kind === 'method';
  const detail = isMethod ? (m.params ?? '()') : '';
  const description = isMethod ? (chain ? MULTI_CHAIN : (m.returns ?? '')) : (m.type ?? '');
  const parts: string[] = [];
  if (m.doc) parts.push(m.doc);
  if (isMethod && m.forms && m.forms.length > 1)
    parts.push(`Accepted forms:\n${m.forms.map((f) => `${m.name}${f}`).join('\n')}`);
  if (m.kind === 'namespace') parts.push(`The ${m.name} commands (a Redis module).`);
  parts.push(`From the ${sourceLabel(api)}.`);
  return {
    label: m.name,
    kind: m.kind,
    insertText: isMethod ? `${m.name}($0)` : m.name,
    snippet: isMethod,
    detail,
    description,
    documentation: parts.join('\n\n'),
    sortText: `${m.kind === 'property' ? '1' : '0'}_${m.name}`,
  };
}

/** The members to offer after a dot, taken from the generated list. */
export function suggestionsFor(api: ClientApi, target: Target): Suggestion[] {
  switch (target.kind) {
    case 'redis':
      return api.redis.map((m) => toSuggestion(m, api, false));
    case 'multi': {
      const shared = new Set(api.multi.shared);
      return [
        ...api.redis.filter((m) => shared.has(m.name)).map((m) => toSuggestion(m, api, true)),
        ...api.multi.only.map((m) => toSuggestion(m, api, false)),
      ];
    }
    case 'namespace': {
      const ns = api.redis.find((m) => m.kind === 'namespace' && m.name === target.name);
      return (ns?.members ?? []).map((m) => toSuggestion(m, api, target.inMulti));
    }
    case 'db':
      return api.db.map((m) => toSuggestion(m, api, false));
    case 'log':
      return api.log.members.map((m) => toSuggestion(m, api, false));
  }
}

/** Module names (`json`, `ft`, ...) in the generated list: the parser needs them to follow `redis.json.`. */
export function namespaceNames(api: ClientApi): string[] {
  return api.redis.filter((m) => m.kind === 'namespace').map((m) => m.name);
}

/** Everything `completionContext` plus `suggestionsFor` do, in one call; empty when nothing is being completed. */
export function completionsAt(api: ClientApi, before: string): Suggestion[] {
  const ctx = completionContext(before, namespaceNames(api));
  return ctx ? suggestionsFor(api, ctx.target) : [];
}
