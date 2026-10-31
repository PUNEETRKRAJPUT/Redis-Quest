// Templating for level strings: `{{player.id}}`, `{{player.name}}`, `{{level.id}}`,
// `{{chapter.id}}`, `{{env.NAME}}`. Deliberately not a template language: no logic, no
// filters, no HTML escaping. Values are substituted verbatim, so the same rules work in
// markdown, Redis command arguments and regexes. `\{{` produces a literal `{{`.

/** What the engine knows when it renders a level for one learner. */
export interface TemplateContext {
  player: { id: string; name: string };
  level: { id: string };
  chapter: { id: string };
  /**
   * Values for `{{env.NAME}}`. The renderer never reads `process.env` itself, so the engine
   * decides exactly which variables a level may see.
   */
  env?: Readonly<Record<string, string | undefined>>;
}

export const TEMPLATE_VARIABLES = ['player.id', 'player.name', 'level.id', 'chapter.id', 'env.NAME'] as const;

const ENV_NAME = /^env\.([A-Z][A-Z0-9_]*)$/;
const FIXED = new Set(['player.id', 'player.name', 'level.id', 'chapter.id']);

export type TemplateToken =
  | { kind: 'var'; name: string; start: number; end: number; raw: string }
  | { kind: 'escape'; start: number; end: number }
  | { kind: 'unterminated'; start: number; end: number };

/** Finds every `{{...}}`, escaped `\{{` and unterminated `{{` in a string, in order. */
export function scanTemplate(s: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let i = 0;
  for (;;) {
    const j = s.indexOf('{{', i);
    if (j === -1) break;
    if (j > 0 && s[j - 1] === '\\') {
      tokens.push({ kind: 'escape', start: j - 1, end: j + 2 });
      i = j + 2;
      continue;
    }
    const k = s.indexOf('}}', j + 2);
    if (k === -1) {
      tokens.push({ kind: 'unterminated', start: j, end: s.length });
      break;
    }
    tokens.push({ kind: 'var', name: s.slice(j + 2, k).trim(), start: j, end: k + 2, raw: s.slice(j, k + 2) });
    i = k + 2;
  }
  return tokens;
}

export function isKnownTemplateVariable(name: string): boolean {
  return FIXED.has(name) || ENV_NAME.test(name);
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

function resolve(name: string, ctx: TemplateContext): string {
  switch (name) {
    case 'player.id':
      return ctx.player.id;
    case 'player.name':
      return ctx.player.name;
    case 'level.id':
      return ctx.level.id;
    case 'chapter.id':
      return ctx.chapter.id;
  }
  const env = ENV_NAME.exec(name);
  if (env) {
    const value = ctx.env?.[env[1] as string];
    // A missing env value is an error, not an empty string: an empty key name in a
    // verifier would silently check the wrong key.
    if (value === undefined) throw new TemplateError(`template variable {{${name}}} has no value`);
    return value;
  }
  throw new TemplateError(`unknown template variable {{${name}}}`);
}

/** Renders one string. Throws `TemplateError` on an unknown variable, a missing env value or an unterminated `{{`. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  let out = '';
  let last = 0;
  for (const t of scanTemplate(template)) {
    out += template.slice(last, t.start);
    if (t.kind === 'escape') out += '{{';
    else if (t.kind === 'var') out += resolve(t.name, ctx);
    else throw new TemplateError(`unterminated {{ at offset ${t.start}`);
    last = t.end;
  }
  return out + template.slice(last);
}

/** Renders every string inside a JSON-like value (objects, arrays), leaving other values untouched. */
export function renderTemplates<T>(value: T, ctx: TemplateContext): T {
  if (typeof value === 'string') return renderTemplate(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => renderTemplates(v, ctx)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderTemplates(v, ctx);
    return out as T;
  }
  return value;
}
