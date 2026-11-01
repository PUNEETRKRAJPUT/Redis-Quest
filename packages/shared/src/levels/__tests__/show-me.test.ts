import { describe, expect, it } from 'vitest';
import { renderTemplates } from '../template.js';
import { levelFileSchema } from '../schema.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const file = fileURLToPath(
  new URL('../../../../../levels/ch0-boot/03-find-your-save-file.yaml', import.meta.url),
);
const raw = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('show_me', () => {
  it('normalises the string form to { component, keys: [] }', () => {
    const r = levelFileSchema.safeParse({ ...raw, show_me: 'hash_card' });
    expect(r.success && r.data.show_me).toEqual({ component: 'hash_card', keys: [] });
  });
  it('keeps the object form and defaults keys', () => {
    const r = levelFileSchema.safeParse({ ...raw, show_me: { component: 'kv_card', title: 'T' } });
    expect(r.success && r.data.show_me).toEqual({ component: 'kv_card', keys: [], title: 'T' });
  });
  it('rejects unknown fields and bad component ids', () => {
    expect(levelFileSchema.safeParse({ ...raw, show_me: { component: 'kv_card', key: 'x' } }).success).toBe(false);
    expect(levelFileSchema.safeParse({ ...raw, show_me: 'Not-An-Id' }).success).toBe(false);
  });
  it('templates render inside keys', () => {
    const r = levelFileSchema.safeParse(raw);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const out = renderTemplates(r.data.show_me, { player: { id: 'p-1', name: 'A' } } as never);
    expect(out?.keys).toEqual(['game:player:p-1']);
  });
});
