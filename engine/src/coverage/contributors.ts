// CONTRIBUTORS.md and the cast (D-06): small readers, pure parsers first. Both files live at the repository root, so
// a contributor adds one line to a plain list and nothing else.

export interface Contributor {
  name: string;
  github: string | null;
  note: string;
}

/**
 * The list lines of CONTRIBUTORS.md: `- Name (@github): what they did`. The github part and the note are optional;
 * anything that is not a list line (headings, prose, comments, indented examples) is ignored.
 */
export function parseContributors(markdown: string): Contributor[] {
  const out: Contributor[] = [];
  let inComment = false;
  for (const raw of markdown.split('\n')) {
    if (/^( {4}|\t)/.test(raw)) continue; // an indented code block is an example, not an entry
    let line = raw.trim();
    if (inComment) {
      if (!line.includes('-->')) continue;
      line = line.slice(line.indexOf('-->') + 3).trim();
      inComment = false;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    const m = /^[-*]\s+([^(:]+?)\s*(?:\(@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\))?\s*(?::\s*(.*))?$/.exec(
      line,
    );
    if (!m) continue;
    const name = (m[1] as string).trim();
    if (name === '') continue;
    out.push({ name, github: m[2] ?? null, note: (m[3] ?? '').trim() });
  }
  return out;
}

export interface CastMember {
  slug: string;
  name: string;
  nickname: string | null;
  role: string;
}

/** The cast of `fiction/cast.json` (slug, name, nickname, role); entries without a name are dropped. */
export function parseCast(json: unknown): CastMember[] {
  const list = (json as { cast?: unknown } | null)?.cast;
  if (!Array.isArray(list)) return [];
  const out: CastMember[] = [];
  for (const e of list as Record<string, unknown>[]) {
    if (!e || typeof e.name !== 'string' || e.name === '') continue;
    out.push({
      slug: typeof e.slug === 'string' ? e.slug : e.name,
      name: e.name,
      nickname: typeof e.nickname === 'string' ? e.nickname : null,
      role: typeof e.role === 'string' ? e.role : '',
    });
  }
  return out;
}
