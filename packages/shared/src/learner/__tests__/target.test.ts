import { describe, expect, it } from 'vitest';
import {
  createTargetClient,
  describeTarget,
  isCluster,
  isSentinel,
  parseTarget,
} from '../target.js';

describe('parseTarget', () => {
  it('parses a single node', () => {
    const t = parseTarget('redis://redis:6379');
    expect(t.kind).toBe('single');
    expect(t.nodes).toEqual([{ host: 'redis', port: 6379 }]);
    expect(describeTarget(t)).toBe('single node redis:6379');
  });
  it('defaults the port and accepts rediss and a db', () => {
    expect(parseTarget('rediss://h/2').nodes).toEqual([{ host: 'h', port: 6379 }]);
  });
  it('parses sentinel', () => {
    const t = parseTarget('sentinel://mymaster@s1:26379,s2:26379,s3:26379');
    expect(t.kind).toBe('sentinel');
    expect(t.masterName).toBe('mymaster');
    expect(t.nodes).toHaveLength(3);
    expect(describeTarget(t)).toBe('sentinel mymaster via 3 sentinels');
  });
  it('parses cluster', () => {
    const t = parseTarget('cluster://a:6379,b:6379,c:6379');
    expect(t.kind).toBe('cluster');
    expect(describeTarget(t)).toBe('cluster, 3 root nodes');
    expect(describeTarget(parseTarget('cluster://a'))).toBe('cluster, 1 root node');
  });
  it.each([
    '',
    'nonsense',
    'http://x:1',
    'sentinel://s1:26379',
    'sentinel://@s1:26379',
    'sentinel://m@',
    'cluster://',
    'cluster://a:notaport',
    'cluster://a:70000',
    'redis://',
  ])('rejects %j', (bad) => {
    expect(() => parseTarget(bad)).toThrow(/./);
    try {
      parseTarget(bad);
    } catch (e) {
      expect((e as Error).name).toBe('TargetError');
    }
  });
});

describe('createTargetClient', () => {
  it('builds an unconnected client of each kind', () => {
    const single = createTargetClient(parseTarget('redis://x:1'));
    const sent = createTargetClient(parseTarget('sentinel://m@x:1'), { RESP: 2 });
    const clu = createTargetClient(parseTarget('cluster://x:1'), { disableOfflineQueue: true });
    expect(isCluster(clu)).toBe(true);
    expect(isSentinel(sent)).toBe(true);
    expect(isCluster(single) || isSentinel(single)).toBe(false);
    expect((single as { isOpen: boolean }).isOpen).toBe(false);
  });
});
