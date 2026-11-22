#!/usr/bin/env node
// Turns the grader's `--json FILE` output into the Markdown the pr-verdict workflow puts in the job summary.
//
//   node scripts/ci/verdict-summary.mjs <grade.json>        prints Markdown on stdout
//
// Exit code 0 always when the file could be read (the verdict itself is the grader's exit code); 2 when it could not.
// The rendering is a pure function (renderSummary) with a unit test (verdict-summary.test.mjs).
/* global process, console */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

/**
 * @param {{ at?: string, summary?: Record<string, {PASS:number,MISMATCH:number,SKIPPED:number}>, rows: any[] }} j
 * @returns {string}
 */
export function renderSummary(j) {
  const rows = j.rows ?? [];
  const count = (r) => rows.filter((x) => x.result === r).length;
  const pass = count('PASS');
  const bad = rows.filter((x) => x.result === 'MISMATCH');
  const skips = rows.filter((x) => x.result === 'SKIPPED');
  const out = [];
  out.push(`## Level verdict (deterministic mode)`);
  out.push('');
  out.push(
    bad.length === 0
      ? `**No mismatch.** ${pass} solutions graded and matching, ${skips.length} skipped.`
      : `**${bad.length} MISMATCH.** ${pass} solutions graded and matching, ${skips.length} skipped.`,
  );
  out.push('');
  out.push(
    'Only levels that cannot depend on the speed of the machine are graded here. A skip is not a failure: the maintainer grades those on a Mac.',
  );
  out.push('');
  out.push('| Chapter | PASS | MISMATCH | SKIPPED |');
  out.push('|---|---:|---:|---:|');
  const per = new Map();
  for (const r of rows) {
    const c = per.get(r.chapter) ?? { PASS: 0, MISMATCH: 0, SKIPPED: 0 };
    c[r.result] = (c[r.result] ?? 0) + 1;
    per.set(r.chapter, c);
  }
  for (const [ch, c] of per) out.push(`| ${cell(ch)} | ${c.PASS} | ${c.MISMATCH} | ${c.SKIPPED} |`);
  out.push(`| **all** | ${pass} | ${bad.length} | ${skips.length} |`);

  if (bad.length) {
    out.push('');
    out.push('### Mismatches');
    out.push('');
    out.push('| Level | Solution | Declared | Engine |');
    out.push('|---|---|---|---|');
    for (const r of bad)
      out.push(
        `| ${cell(r.level)} | ${cell(r.solution)} | ${cell(r.declared)} | ${cell(r.engine)} |`,
      );
    for (const r of bad) {
      out.push('');
      out.push(
        `**${cell(r.level)}** \`${cell(r.solution)}\`: declared ${r.declared}, engine ${r.engine}`,
      );
      if (r.because) out.push(`- declared because: ${cell(r.because)}`);
      for (const f of r.feedback ?? [])
        if (f.tag !== 'ok' && f.tag !== 'skip')
          out.push(`- [${cell(f.tag)}] check #${f.index} (${cell(f.type)}): ${cell(f.message)}`);
    }
  }

  if (skips.length) {
    // Group the skipped levels by reason, so the list stays short.
    const byReason = new Map();
    for (const r of skips) {
      const why = String(r.note ?? '')
        .replace(/^SKIPPED \((deterministic mode: )?/, '')
        .replace(/; graded by hand\)$/, '')
        .replace(/\)$/, '');
      const g = byReason.get(why) ?? new Set();
      g.add(r.level);
      byReason.set(why, g);
    }
    out.push('');
    out.push('### Skipped, by reason');
    out.push('');
    out.push('| Reason | Levels |');
    out.push('|---|---:|');
    for (const [why, levels] of byReason)
      out.push(`| ${cell(why || '(none given)')} | ${levels.size} |`);
    out.push('');
    out.push('<details><summary>Skipped levels</summary>');
    out.push('');
    for (const [why, levels] of byReason)
      out.push(`- ${cell(why)}: ${[...levels].map(cell).join(', ')}`);
    out.push('');
    out.push('</details>');
  }
  out.push('');
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/ci/verdict-summary.mjs <grade.json>');
    process.exit(2);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  console.log(renderSummary(json));
}
