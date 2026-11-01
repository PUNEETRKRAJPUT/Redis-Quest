import { useState } from 'react';
import type { ReactNode } from 'react';
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
  SetChipsView,
  StreamLogView,
  TtlTimerView,
} from './views';
import { useRedis } from './useRedis';

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
] as const;
export type ShowMeId = (typeof SHOW_ME_IDS)[number];

export function isShowMeId(id: string): id is ShowMeId {
  return (SHOW_ME_IDS as readonly string[]).includes(id);
}

/**
 * The level schema carries only a component id (`show_me: hash_card`), no key. Until it does, the UI keeps a
 * small table of which key each Chapter 0 and Chapter 1 level lights up. Anything missing falls back to a
 * "which key?" box. Chapter 1 entries are read from the authored task text and are not verified.
 */
export function defaultKey(id: string, levelId: string | undefined, playerId: string): string | null {
  const t: Record<string, string> = {
    'ch0-01-bhai-it-works-on-my-laptop': 'game:engine:boots',
    'ch0-02-say-hello': 'game:engine:boots',
    'ch0-03-find-your-save-file': `game:player:${playerId}`,
    'ch0-04-the-second-window': 'game:welcome:gift',
    'ch0-05-roommate-ran-down': `game:player:${playerId}`,
    'ch1-01-a-name-and-an-otp': `otp:${playerId}`,
    'ch1-05-the-match-feed': `feed:${playerId}`,
    'ch1-06-favourite-players': `fav:${playerId}`,
    'ch1-07-hostel-scoreboard': 'lb:hostel:h-c-02-2',
    'ch1-08-lobby-closes-at-the-toss': 'lobby:m-041',
    'ch1-09-login-streak': `login:${playerId}:2026-11`,
  };
  if (levelId && t[levelId]) return t[levelId];
  if (id === 'cache_stats') return 'INFO stats';
  return null;
}

function Loading({ error }: { error: string | null }) {
  return error ? <p className="callout warn" role="alert">{error}</p> : <p className="muted">Reading Redis...</p>;
}

// ---- wrappers: one per component id, each reads its own key through /api/cli ---------------------------
function KvCard({ k }: { k: string }) {
  const type = useRedis(['TYPE', k]);
  const val = useRedis(['GET', k]);
  const ttl = useRedis(['TTL', k]);
  if (!type.reply) return <Loading error={type.error} />;
  const t = asString(type.reply) ?? 'none';
  return <KvCardView name={k} type={t} value={t === 'string' ? asString(val.reply) : null} ttl={asNumber(ttl.reply)} />;
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
  return <LeaderboardPanelView name={k} rows={asPairs(z.reply).map(([member, s]) => ({ member, score: Number(s) }))} highlight={highlight} />;
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
  return <CacheStatsView hits={infoField(text, 'keyspace_hits')} misses={infoField(text, 'keyspace_misses')} commands={infoField(text, 'total_commands_processed')} keys={asNumber(d.reply) ?? 0} />;
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
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="for example otp:p-1a2b3c4d" spellCheck={false} />
      </label>
      <button type="submit" className="btn">Show it</button>
    </form>
  );
}

/** Renders one show-me component by id. `keyName` overrides the default key from `defaultKey`. */
export function ShowMe({ id, levelId, playerId, keyName }: { id: string; levelId?: string; playerId: string; keyName?: string }): ReactNode {
  const [picked, setPicked] = useState<string | null>(null);
  if (!isShowMeId(id)) return <p className="muted">Unknown show-me component: {id}</p>;
  const k = picked ?? keyName ?? defaultKey(id, levelId, playerId);
  if (id === 'cache_stats') return <CacheStats />;
  if (!k) return <KeyPicker id={id} onPick={setPicked} />;
  switch (id) {
    case 'kv_card': return <KvCard k={k} />;
    case 'hash_card': return <HashCard k={k} />;
    case 'list_feed': return <ListFeed k={k} />;
    case 'set_chips': return <SetChips k={k} highlight={`user:${playerId}`} />;
    case 'leaderboard_panel': return <Leaderboard k={k} highlight={`user:${playerId}`} />;
    case 'ttl_timer': return <TtlTimer k={k} />;
    case 'bitmap_streak': return <BitmapStreak k={k} />;
    case 'hll_counter': return <HllCounter k={k} />;
    case 'geo_map': return <GeoMap k={k} />;
    case 'stream_log': return <StreamLog k={k} />;
    case 'json_tree': return <JsonTree k={k} />;
  }
}
