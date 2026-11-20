// The incident deck: `incidents/<id>.yaml`. A card says what the player sees, how the engine causes it (using only
// things the engine can already do) and how it ends. This file is the contract; incidents/README.md explains it to
// contributors. Parsing is pure; `loadDeck` is the only function that touches the file system.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GLOB_CHARS = /[*?[\]\\]/;

/** The engine's own keys. No card may name a prefix that is `game:` or lies inside it (or could match it). */
export const RESERVED_PREFIX = 'game:';
/** Cards may only delete keys that are caches the player's code rebuilds, so a card can never destroy real data. */
export const DELETABLE_PREFIX_ROOT = 'cache:';

/** True when deleting keys that start with `prefix` could reach a `game:*` key. */
export function touchesReserved(prefix: string): boolean {
  return prefix.startsWith(RESERVED_PREFIX) || RESERVED_PREFIX.startsWith(prefix);
}

/** Why a prefix is not allowed for `delete_keys`, or null when it is. Shared by the schema and the engine. */
export function prefixProblem(prefix: string): string | null {
  if (prefix.length > 64) return 'a prefix is at most 64 characters';
  if (GLOB_CHARS.test(prefix)) return 'a prefix is plain text: no * ? [ ] or backslash';
  if (touchesReserved(prefix)) return 'keys under game:* belong to the engine';
  if (!prefix.startsWith(DELETABLE_PREFIX_ROOT) || prefix.length < DELETABLE_PREFIX_ROOT.length + 2)
    return `a card may only delete cache keys: the prefix must start with ${DELETABLE_PREFIX_ROOT} and name something after it`;
  return null;
}

const text = z.string().refine((s) => s.trim().length > 0, { message: 'must not be empty' });

export const FACT_SOURCES = ['digest', 'measured', 'simulation'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const factSchema = z
  .strictObject({
    text,
    /** digest: it is in docs/redis-docs-digest.md (then `ref` says where); measured: observed on this stack; simulation: how the game stages it. */
    source: z.enum(FACT_SOURCES),
    ref: z.string().optional(),
  })
  .refine((f) => f.source !== 'digest' || (f.ref !== undefined && f.ref.trim() !== ''), {
    message:
      'a fact with source: digest needs ref: the page of docs/redis-docs-digest.md it comes from',
    path: ['ref'],
  });

const switchScenarioStep = z.strictObject({
  kind: z.literal('switch_scenario'),
  scenario: z.string().regex(KEBAB, 'a scenario id is kebab-case, like celebrity-100'),
});
const deleteKeysStep = z.strictObject({
  kind: z.literal('delete_keys'),
  prefixes: z
    .array(z.string())
    .min(1)
    .max(3)
    .superRefine((list, ctx) => {
      list.forEach((p, i) => {
        const problem = prefixProblem(p);
        if (problem) ctx.addIssue({ code: 'custom', message: problem, path: [i] });
      });
    }),
});
const lowerMaxmemoryStep = z.strictObject({
  kind: z.literal('lower_maxmemory'),
  /** maxmemory becomes used_memory plus this many KiB for the one over, then the old value comes back. */
  headroomKb: z.number().int().min(64).max(8192),
});
const blockScriptStep = z.strictObject({
  kind: z.literal('block_script'),
  /** A counting loop in Lua with no keys and no writes. Its length depends on the machine: it is a simulation. */
  iterations: z.number().int().min(1_000_000).max(200_000_000),
  startAfterSec: z.number().int().min(0).max(8),
});

export const stepSchema = z.discriminatedUnion('kind', [
  switchScenarioStep,
  deleteKeysStep,
  lowerMaxmemoryStep,
  blockScriptStep,
]);
export type Step = z.infer<typeof stepSchema>;
export type StepKind = Step['kind'];

export const cardSchema = z
  .strictObject({
    id: z.string().regex(KEBAB, 'id must be kebab-case'),
    title: text.refine((s) => s.length <= 80, { message: 'at most 80 characters' }),
    /** What the player sees when the card is played: the commentary line and the symptom. */
    sees: text,
    /** How the engine causes it, in words, and then as steps. */
    cause: z.strictObject({ summary: text, steps: z.array(stepSchema).min(1).max(4) }),
    /** How it ends. Every change is undone when the match ends, however it ends. */
    ends: text,
    facts: z.array(factSchema).default([]),
  })
  .superRefine((card, ctx) => {
    const seen = new Set<string>();
    card.cause.steps.forEach((s, i) => {
      if (seen.has(s.kind))
        ctx.addIssue({
          code: 'custom',
          message: `a card uses each kind of step at most once (${s.kind} twice)`,
          path: ['cause', 'steps', i],
        });
      seen.add(s.kind);
    });
  });

export type IncidentCard = z.infer<typeof cardSchema>;

export interface DeckError {
  file: string;
  message: string;
}

export type CardResult = { ok: true; card: IncidentCard } | { ok: false; errors: string[] };

/** Parses one card file's text. `expectedId` is the file name without .yaml. */
export function parseCard(source: string, expectedId?: string): CardResult {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (err) {
    return { ok: false, errors: [`not valid YAML: ${(err as Error).message}`] };
  }
  const r = cardSchema.safeParse(value);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map(
        (i) => `${i.path.length ? i.path.join('.') : 'card'}: ${i.message}`,
      ),
    };
  }
  if (expectedId !== undefined && r.data.id !== expectedId)
    return { ok: false, errors: [`id must be ${expectedId} (the file name), found ${r.data.id}`] };
  return { ok: true, card: r.data };
}

export interface Deck {
  cards: IncidentCard[];
  errors: DeckError[];
}

/** Every `*.yaml` in `dir`, sorted by id. A bad file is reported in `errors` and left out; it never throws. */
export async function loadDeck(dir: string): Promise<Deck> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.yaml')).sort();
  } catch {
    return { cards: [], errors: [{ file: dir, message: 'the incidents folder cannot be read' }] };
  }
  const cards: IncidentCard[] = [];
  const errors: DeckError[] = [];
  for (const name of names) {
    let src: string;
    try {
      src = await readFile(join(dir, name), 'utf8');
    } catch (err) {
      errors.push({ file: name, message: `cannot read: ${(err as Error).message}` });
      continue;
    }
    const r = parseCard(src, name.replace(/\.yaml$/, ''));
    if (r.ok) cards.push(r.card);
    else for (const m of r.errors) errors.push({ file: name, message: m });
  }
  return { cards, errors };
}

/** What the fixture generator needs from a card. */
export interface CardInfo {
  id: string;
  title: string;
  /** Set when the card switches the scenario for its over. */
  scenario?: string;
}

export function cardInfo(card: IncidentCard): CardInfo {
  const sw = card.cause.steps.find((s) => s.kind === 'switch_scenario');
  return {
    id: card.id,
    title: card.title,
    ...(sw && sw.kind === 'switch_scenario' ? { scenario: sw.scenario } : {}),
  };
}
