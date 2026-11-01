export type DiffRow = { kind: 'same' | 'add' | 'del'; text: string };

/**
 * Line-level diff by longest common subsequence: `del` lines are only in `mine`, `add` lines only in `ref`.
 * Solution files are tens of lines, so the O(n*m) table is fine and keeps this dependency-free.
 */
export function lineDiff(mine: string, ref: string): DiffRow[] {
  const a = mine.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const b = ref.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const w = b.length + 1;
  const t = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i * w + j] =
        a[i] === b[j]
          ? t[(i + 1) * w + j + 1]! + 1
          : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) {
      out.push({ kind: 'del', text: a[i++]! });
    } else {
      out.push({ kind: 'add', text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

/** The workspace file a code level's task tells the learner to edit, e.g. `workspace/ch2/cache.js` -> `ch2/cache.js`. */
export function workspaceFileFromTask(task: string): string | null {
  const m = /workspace\/([A-Za-z0-9_./-]+\.m?js)/.exec(task);
  return m ? m[1]! : null;
}
