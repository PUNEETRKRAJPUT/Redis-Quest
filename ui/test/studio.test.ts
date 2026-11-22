// D-05: the pure parts of the level studio and the community screens. The screens themselves are exercised by
// scripts/check/D-05.sh against a running stack.
import { describe, expect, it } from 'vitest';
import { byline, asLevelData, type CommunityLevelData } from '@/features/community/types';
import {
  gitSteps,
  sanitizeDraft,
  sectionOf,
  starterDraft,
  switchMode,
} from '@/features/studio/draft';
import { crc32, zip } from '@/features/studio/zip';

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes local headers, a central directory and an end record for each file', () => {
    const bytes = zip(
      [
        { path: 'levels/community/mine/chapter.yaml', content: 'id: mine\n' },
        { path: 'levels/community/mine/solutions/01-reference.redis', content: 'INCR c\n' },
      ],
      new Date(2026, 10, 20, 12, 0, 0),
    );
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(centralStart, true)).toBe(0x02014b50);
    expect(
      new TextDecoder().decode(bytes.slice(30, 30 + 'levels/community/mine/chapter.yaml'.length)),
    ).toBe('levels/community/mine/chapter.yaml');
  });
});

describe('draft', () => {
  it('a starter draft has what its mode needs', () => {
    expect(starterDraft('cli').checks).toHaveLength(1);
    expect(starterDraft('cli').quizzes).toHaveLength(0);
    expect(starterDraft('decision').quizzes).toHaveLength(1);
    expect(starterDraft('decision').wrong).toHaveLength(0);
  });

  it('a stored draft that is garbage falls back to the starter, one that is partly good keeps its good parts', () => {
    expect(sanitizeDraft('nonsense')).toEqual(starterDraft('cli'));
    const d = sanitizeDraft({
      mode: 'decision',
      title: 'Kept',
      slug: 7,
      checks: 'no',
      hints: ['a', 3],
    });
    expect(d.mode).toBe('decision');
    expect(d.title).toBe('Kept');
    expect(d.slug).toBe('');
    expect(d.hints).toEqual(['a']);
  });

  it('an unknown check kind becomes the default one instead of breaking the form', () => {
    const d = sanitizeDraft({ mode: 'cli', checks: [{ kind: 'nope', key: 'k' }] });
    expect(d.checks[0]?.kind).toBe('string_equals');
    expect(d.checks[0]?.key).toBe('k');
  });

  it('switching mode keeps the shared fields and resets the lists of the other mode', () => {
    const cli = { ...starterDraft('cli'), title: 'T', reference: 'INCR a' };
    const dec = switchMode(cli, 'decision');
    expect(dec.title).toBe('T');
    expect(dec.reference).toBe('');
    expect(dec.quizzes).toHaveLength(1);
    expect(switchMode(dec, 'decision')).toBe(dec);
  });

  it('shows the three git commands and the folder', () => {
    const g = gitSteps('mine', 'a-counter', 'A "counter"');
    expect(g.folder).toBe('levels/community/mine');
    expect(g.commands).toEqual([
      'git checkout -b level/mine-a-counter',
      'git add levels/community/mine',
      'git commit -m "Community level: A counter"',
    ]);
  });

  it('maps an error path to the form section that holds it', () => {
    expect(sectionOf('author.name')).toBe('basics');
    expect(sectionOf('brainstorm.options')).toBe('story');
    expect(sectionOf('verify[0].checks[1]')).toBe('checks');
    expect(sectionOf('checks[0].key')).toBe('checks');
    expect(sectionOf('solutions.wrong[0].expect')).toBe('solution');
    expect(sectionOf('(root)')).toBe('other');
  });
});

describe('community types', () => {
  it('bylines credit the author, with the GitHub name when given', () => {
    expect(byline({ name: 'The house' })).toBe('The house');
    expect(byline({ name: 'Asha', github: 'asha' })).toBe('Asha (@asha)');
    expect(byline(null)).toBe('Unknown author');
  });

  it('a level nobody started is "available" to the shared level components', () => {
    const l = {
      status: 'new',
      community: { pack: 'p', author: null },
    } as unknown as CommunityLevelData;
    expect(asLevelData(l).status).toBe('available');
  });
});
