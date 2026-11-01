import { describe, expect, it } from 'vitest';
import { lineDiff, workspaceFileFromTask } from '../src/level/diff';

describe('lineDiff (F-04)', () => {
  it('marks lines only in the learner file as del and only in the reference as add', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
  it('is all same for equal text and tolerates a trailing newline', () => {
    expect(lineDiff('x\ny\n', 'x\ny').every((r) => r.kind === 'same')).toBe(true);
  });
  it('handles an empty learner file', () => {
    expect(lineDiff('', 'a').map((r) => r.kind)).toEqual(['del', 'add']);
  });
});

describe('workspaceFileFromTask', () => {
  it('finds the file named in the task', () => {
    expect(workspaceFileFromTask('Fill in `getPlayerStats` in `workspace/ch2/cache.js`.')).toBe('ch2/cache.js');
    expect(workspaceFileFromTask('no file here')).toBeNull();
  });
});
