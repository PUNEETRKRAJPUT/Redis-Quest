import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { useQuest } from '../store';
import type { MetricsSeries, MetricsTick } from '../types';
import { asList, asNumber, asPairs, asString, asStrings } from '../redisReply';
import {
  BitmapStreakView,
  CacheStatsView,
  GeoMapView,
  HashCardView,
  HllCounterView,
  JsonTreeView,
  KvCardView,
  LeaderboardPanelView,
  ListFeedView,
  OtpLimiterView,
  SetChipsView,
  StatsLatencyView,
  StreamLogView,
  TtlTimerView,
} from './views';
import type { ShowMeSpec } from '../types';
import { readRedis, useRedis } from './useRedis';

export const SHOW_ME_IDS = [
  'kv_card',
  'hash_card',
  'list_feed',
  'set_chips',
  'leaderboard_panel',
  'ttl_timer',
  'bitmap_streak',
  'hll_counter',
  'geo_map',
  'stream_log',
  'json_tree',
  'cache_stats',
  'stats_latency_panel',
  'otp_limiter_panel',
] as const;
export type ShowMeId = (typeof SHOW_ME_IDS)[number];

export function isShowMeId(id: string): id is ShowMeId {
  return (SHOW_ME_IDS as readonly string[]).includes(id);
}

/**
 * `show_me.keys` come from the level (F-05). GET /api/levels/:id does not render templates in `show_me`
 * yet (engine/src/levels.ts renderLevel only renders title, story, teach, task, brainstorm, hints and verify),
 * so the UI fills in `{{player.id}}` itself. Already rendered keys pass through unchanged.
 */
export function renderKey(key: string, playerId: string): string {
  return key.replace(/\{\{\s*player\.id\s*\}\}/g, playerId);
}

function Loading({ error }: { error: string | null }) {
  return error ? (
    <p className="callout warn" role="alert">
      {error}
    </p>
  ) : (
    <p className="muted">Reading Redis...</p>
  );
}

// ---- wrappers: one per component id, each reads its own key through /api/cli ---------------------------
function KvCard({ k }: { k: string }) {
  const type = useRedis(['TYPE', k]);
  const val = useRedis(['GET', k]);
  const ttl = useRedis(['TTL', k]);
  if (!type.reply) return <Loading error={type.error} />;
  const t = asString(type.reply) ?? 'none';
  return (
    <KvCardView
      name={k}
      type={t}
      value={t === 'string' ? asString(val.reply) : null}
      ttl={asNumber(ttl.reply)}
    />
  );
}
function HashCard({ k }: { k: string }) {
  const h = useRedis(['HGETALL', k]);
  const ttl = useRedis(['TTL', k]);
  if (!h.reply) return <Loading error={h.error} />;
  return <HashCardView name={k} fields={asPairs(h.reply)} ttl={asNumber(ttl.reply)} />;
}
function ListFeed({ k }: { k: string }) {
  const l = useRedis(['LRANGE', k, '0', '19']);
  const n = useRedis(['LLEN', k]);
  if (!l.reply) return <Loading error={l.error} />;
  return <ListFeedView name={k} items={asStrings(l.reply)} total={asNumber(n.reply) ?? 0} />;
}
function SetChips({ k, highlight }: { k: string; highlight?: string }) {
  const s = useRedis(['SMEMBERS', k]);
  if (!s.reply) return <Loading error={s.error} />;
  return <SetChipsView name={k} members={asStrings(s.reply)} highlight={highlight} />;
}
function Leaderboard({ k, highlight }: { k: string; highlight?: string }) {
  const z = useRedis(['ZRANGE', k, '0', '9', 'REV', 'WITHSCORES']);
  if (!z.reply) return <Loading error={z.error} />;
  return (
    <LeaderboardPanelView
      name={k}
      rows={asPairs(z.reply).map(([member, s]) => ({ member, score: Number(s) }))}
      highlight={highlight}
    />
  );
}
function TtlTimer({ k }: { k: string }) {
  const t = useRedis(['TTL', k], 4000);
  const n = asNumber(t.reply);
  if (n === null || t.at === null) return <Loading error={t.error} />;
  return <TtlTimerView name={k} ttl={n} readAt={t.at} />;
}
export function bitfieldArgs(k: string, days: number): string[] {
  const a = ['BITFIELD', k];
  for (let i = 0; i < days; i++) a.push('GET', 'u1', `#${i}`);
  return a;
}
function BitmapStreak({ k, days = 30 }: { k: string; days?: number }) {
  const b = useRedis(bitfieldArgs(k, days));
  if (!b.reply) return <Loading error={b.error} />;
  const all = asList(b.reply).map((x) => (asNumber(x) === 1 ? 1 : 0));
  const last = all.lastIndexOf(1);
  return <BitmapStreakView name={k} bits={last < 0 ? all : all.slice(0, last + 1)} />;
}
function HllCounter({ k }: { k: string }) {
  const c = useRedis(['PFCOUNT', k]);
  if (c.reply === null) return <Loading error={c.error} />;
  return <HllCounterView name={k} count={asNumber(c.reply) ?? 0} />;
}
function GeoMap({ k }: { k: string }) {
  const m = useRedis(['ZRANGE', k, '0', '49']);
  const members = asStrings(m.reply);
  const g = useRedis(members.length ? ['GEOPOS', k, ...members] : null);
  if (!m.reply) return <Loading error={m.error} />;
  const pos = asList(g.reply);
  const points = members.flatMap((member, i) => {
    const p = asList(pos[i]);
    const lon = asNumber(p[0]);
    const lat = asNumber(p[1]);
    return lon === null || lat === null ? [] : [{ member, lon, lat }];
  });
  return <GeoMapView name={k} points={points} />;
}
function StreamLog({ k }: { k: string }) {
  const x = useRedis(['XREVRANGE', k, '+', '-', 'COUNT', '10']);
  if (!x.reply) return <Loading error={x.error} />;
  const entries = asList(x.reply).map((e) => {
    const [id, f] = asList(e);
    return { id: asString(id) ?? '?', fields: asPairs(f) };
  });
  return <StreamLogView name={k} entries={entries} />;
}
function JsonTree({ k }: { k: string }) {
  const j = useRedis(['JSON.GET', k, '$']);
  if (!j.reply) return <Loading error={j.error} />;
  let value: unknown;
  const raw = asString(j.reply);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      value = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
    } catch {
      value = undefined;
    }
  }
  return <JsonTreeView name={k} value={value} />;
}
export function infoField(info: string, field: string): number {
  const m = new RegExp(`^${field}:(\\d+)`, 'm').exec(info);
  return m ? Number(m[1]) : 0;
}
function CacheStats() {
  const i = useRedis(['INFO', 'stats']);
  const d = useRedis(['DBSIZE']);
  if (!i.reply) return <Loading error={i.error} />;
  const text = asString(i.reply) ?? '';
  return (
    <CacheStatsView
      hits={infoField(text, 'keyspace_hits')}
      misses={infoField(text, 'keyspace_misses')}
      commands={infoField(text, 'total_commands_processed')}
      keys={asNumber(d.reply) ?? 0}
    />
  );
}

export const STATS_ROUTE = 'GET /app/players/:id/stats';
export const PING_ROUTE = 'GET /app/limits/ping';

/** One route's recent seconds out of the metrics.tick history: only ticks where the route had traffic. */
export function routeTickSeries(ticks: MetricsTick[], route: string) {
  const rows = ticks.flatMap((t) => {
    const r = t.routes?.[route];
    return r ? [r] : [];
  });
  return {
    p50: rows.map((r) => r.p50Ms ?? 0),
    p99: rows.map((r) => r.p99Ms ?? 0),
    rps: rows.map((r) => r.count ?? 0),
    db: rows.flatMap((r) => (typeof r.dbQueries === 'number' ? [r.dbQueries] : [])),
  };
}

const last = (a: number[]): number | null => (a.length ? (a[a.length - 1] as number) : null);

/** GET /api/metrics every 2 s for the window aggregates; the live seconds come from the store's metrics.tick. */
function useMetricsWindow(): MetricsSeries | null {
  const [win, setWin] = useState<MetricsSeries | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .metrics(60)
        .then((m) => alive && setWin(m))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return win;
}

/** EXISTS per key, polled; null until the first answer. One effect because the key count varies. */
function useKeysExist(names: string[]): Record<string, boolean | null> {
  const [found, setFound] = useState<Record<string, boolean>>({});
  const joined = JSON.stringify(names);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const list = JSON.parse(joined) as string[];
      const next: Record<string, boolean> = {};
      await Promise.all(
        list.map(async (k) => {
          try {
            next[k] = asNumber(await readRedis(['EXISTS', k])) === 1;
          } catch {
            // leave unknown
          }
        }),
      );
      if (!alive) return;
      setFound(next);
      timer = setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [joined]);
  return Object.fromEntries(names.map((n) => [n, found[n] ?? null]));
}

function StatsLatency({ keys }: { keys: string[] }) {
  const ticks = useQuest((s) => s.ticks);
  const win = useMetricsWindow();
  const exists = useKeysExist(keys);
  const s = routeTickSeries(ticks, STATS_ROUTE);
  const agg = win?.routes[STATS_ROUTE];
  return (
    <StatsLatencyView
      route={STATS_ROUTE}
      p50={last(s.p50) ?? agg?.p50Ms ?? null}
      p99={last(s.p99) ?? agg?.p99Ms ?? null}
      rps={last(s.rps)}
      dbQps={last(s.db)}
      p99Series={s.p99}
      keys={keys.map((name) => ({ name, exists: exists[name] ?? null }))}
    />
  );
}
function OtpLimiter({ k }: { k: string }) {
  const type = useRedis(['TYPE', k], 1000);
  const t = asString(type.reply) ?? 'none';
  const hash = useRedis(t === 'hash' ? ['HGETALL', k] : null, 1000);
  const str = useRedis(t === 'string' ? ['GET', k] : null, 1000);
  const ttl = useRedis(t === 'string' ? ['TTL', k] : null, 1000);
  const card = useRedis(t === 'zset' ? ['ZCARD', k] : null, 1000);
  const win = useMetricsWindow();
  if (!type.reply) return <Loading error={type.error} />;
  return (
    <OtpLimiterView
      name={k}
      type={t}
      fields={hash.reply ? asPairs(hash.reply) : []}
      value={asString(str.reply)}
      ttl={asNumber(ttl.reply)}
      members={asNumber(card.reply)}
      pingRequests={win?.routes[PING_ROUTE]?.count ?? null}
    />
  );
}

function KeyPicker({ id, onPick }: { id: string; onPick: (k: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      className="keypicker"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onPick(v.trim());
      }}
    >
      <label>
        Which key should the {id} panel read?
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="for example otp:p-1a2b3c4d"
          spellCheck={false}
        />
      </label>
      <button type="submit" className="btn">
        Show it
      </button>
    </form>
  );
}

function Panel({ id, k, playerId }: { id: ShowMeId; k: string; playerId: string }): ReactNode {
  switch (id) {
    case 'kv_card':
      return <KvCard k={k} />;
    case 'hash_card':
      return <HashCard k={k} />;
    case 'list_feed':
      return <ListFeed k={k} />;
    case 'set_chips':
      return <SetChips k={k} highlight={`user:${playerId}`} />;
    case 'leaderboard_panel':
      return <Leaderboard k={k} highlight={`user:${playerId}`} />;
    case 'ttl_timer':
      return <TtlTimer k={k} />;
    case 'bitmap_streak':
      return <BitmapStreak k={k} />;
    case 'hll_counter':
      return <HllCounter k={k} />;
    case 'geo_map':
      return <GeoMap k={k} />;
    case 'stream_log':
      return <StreamLog k={k} />;
    case 'json_tree':
      return <JsonTree k={k} />;
    case 'cache_stats':
      return <CacheStats />;
    case 'stats_latency_panel':
      return <StatsLatency keys={[k]} />;
    case 'otp_limiter_panel':
      return <OtpLimiter k={k} />;
  }
}

/** Renders the level's show-me: its component once per declared key. */
export function ShowMe({ spec, playerId }: { spec: ShowMeSpec; playerId: string }): ReactNode {
  const [picked, setPicked] = useState<string | null>(null);
  const id = spec.component;
  if (!isShowMeId(id)) return <p className="muted">Unknown show-me component: {id}</p>;
  const keys = (picked ? [picked] : spec.keys.map((k) => renderKey(k, playerId))).filter(Boolean);
  const title = spec.title ? <h3 data-testid="showme-title">{spec.title}</h3> : null;
  if (id === 'cache_stats') {
    return (
      <>
        {title}
        <CacheStats />
      </>
    );
  }
  if (id === 'stats_latency_panel') {
    // One panel for the route; the keys are listed inside it, so keys: [] is fine (level 2.1).
    return (
      <>
        {title}
        <StatsLatency keys={keys} />
      </>
    );
  }
  if (keys.length === 0) return <KeyPicker id={id} onPick={setPicked} />;
  return (
    <>
      {title}
      {keys.map((k) => (
        <div key={k} data-testid="showme-panel" data-key={k}>
          <Panel id={id} k={k} playerId={playerId} />
        </div>
      ))}
    </>
  );
}
