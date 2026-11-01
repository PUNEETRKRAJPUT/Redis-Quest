import { describe, expect, it } from 'vitest';
import { insightLink } from '../src/screens/Built';

describe('insightLink (F-07)', () => {
  it('defaults to port 5540 on the page hostname', () => {
    expect(insightLink(null, '127.0.0.1', null)).toBe('http://127.0.0.1:5540/');
    expect(insightLink(undefined, 'localhost', null)).toBe('http://localhost:5540/');
  });
  it('uses a stored port override when valid', () => {
    expect(insightLink(null, 'localhost', '5543')).toBe('http://localhost:5543/');
    expect(insightLink(null, 'localhost', 'abc')).toBe('http://localhost:5540/');
  });
  it('prefers insightUrl from the engine when it is an http(s) URL', () => {
    expect(insightLink({ insightUrl: 'http://localhost:5543/' }, 'localhost', '9999')).toBe(
      'http://localhost:5543/',
    );
    expect(insightLink({ insightUrl: 'javascript:alert(1)' }, 'localhost', null)).toBe(
      'http://localhost:5540/',
    );
  });
  it('brackets an IPv6 hostname', () => {
    expect(insightLink(null, '::1', null)).toBe('http://[::1]:5540/');
  });
});
