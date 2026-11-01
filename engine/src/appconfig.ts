import { createHash } from 'node:crypto';

export interface AppConfig {
  target: { redisUrl: string };
  activeSlots: string[];
  dbExtraLatencyMs: number;
}

export function etagOf(cfg: AppConfig): string {
  // Key order is fixed here so the same config always hashes the same.
  const canonical = JSON.stringify([
    cfg.target.redisUrl,
    [...cfg.activeSlots],
    cfg.dbExtraLatencyMs,
  ]);
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

/** True if an If-None-Match header (possibly a list, possibly weak validators or `*`) matches `etag`. */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((raw) => {
    const t = raw.trim().replace(/^W\//, '');
    return t === '*' || t === `"${etag}"`;
  });
}
