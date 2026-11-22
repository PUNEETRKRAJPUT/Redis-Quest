// The hole file: `golf/holes/<nn>-<slug>/hole.yaml`. A hole is a small task; the entries are lists of commands.

import { z } from 'zod';
import { redisCheckSchema, type RedisCheck } from '../levels/schema.js';
import { refusalFor } from './refuse.js';

export const HOLE_ID = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A GitHub login: letters, digits and single hyphens, no hyphen at either end, at most 39 characters. */
export const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const PAR_MAX = 50;
export const MAX_SETUP_COMMANDS = 50;

const text = z.string().refine((s) => s.trim().length > 0, { message: 'must not be empty' });

/** An argv list; YAML numbers are accepted and written as the strings that go on the wire (like level files). */
const command = z
  .array(z.union([z.string(), z.number()]), { error: 'must be a list like [SADD, "fans:a", "x"]' })
  .min(1, 'must not be empty')
  .transform((argv) => argv.map((a) => String(a)));

const setupStep = z.strictObject({ cmd: command }).superRefine((s, ctx) => {
  const why = refusalFor(s.cmd);
  if (why) ctx.addIssue({ code: 'custom', path: ['cmd', 0], message: why });
});

export const holeSchema = z
  .strictObject({
    title: text.refine((s) => s.length <= 60, { message: 'at most 60 characters' }),
    /** The task in plain words, markdown allowed. */
    task: text,
    /** The command count the house entry takes; beating it is the game. */
    par: z.number().int().min(1).max(PAR_MAX),
    setup: z.array(setupStep).max(MAX_SETUP_COMMANDS).optional(),
    /** The same shape as a level's redis checks: one assertion each, read-only commands only. */
    checks: z.array(redisCheckSchema).min(1, 'must list at least one check'),
  })
  .superRefine((h, ctx) => {
    h.checks.forEach((c, i) => {
      if (c.allowWrite) {
        ctx.addIssue({
          code: 'custom',
          path: ['checks', i, 'allowWrite'],
          message: 'league checks never write; remove allowWrite',
        });
      }
    });
  });

export type Hole = z.output<typeof holeSchema>;
export type HoleCheck = RedisCheck;
