import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

// Pure views: data in, markup out. The contract for each is the exported props interface.

function Card({ title, name, children, kind }: { title: string; name: string; children: ReactNode; kind: string }) {
  return (
    <figure className="showme" data-showme={kind}>
      <figcaption>
        <span className="showme-title">{title}</span>
        <code className="showme-key">{name}</code>
      </figcaption>
      <div className="showme-body">{children}</div>
    </figure>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="muted showme-empty">{children}</p>;
}

// ---- kv_card ---------------------------------------------------------------------------------------------
export interface KvCardProps {
  name: string;
  /** Redis TYPE of the key: string, hash, none, ... */
  type: string;
  /** GET result, null when the key is missing or not a string. */
  value: string | null;
  /** TTL in seconds; -1 no expiry, -2 key missing. */
  ttl: number | null;
}
export function KvCardView({ name, type, value, ttl }: KvCardProps) {
  const missing = type === 'none';
  return (
    <Card title="String key" name={name} kind="kv_card">
      {missing ? (
        <Empty>This key does not exist (yet).</Empty>
      ) : (
        <>
          <div className="kv-value" data-testid="kv-value">{value ?? `(a ${type}, not a string)`}</div>
          <dl className="facts">
            <div><dt>type</dt><dd>{type}</dd></div>
            <div><dt>expires</dt><dd>{ttl === null || ttl === -1 ? 'never' : ttl === -2 ? 'gone' : `in ${ttl}s`}</dd></div>
          </dl>
        </>
      )}
    </Card>
  );
}

// ---- hash_card -------------------------------------------------------------------------------------------
export interface HashCardProps {
  name: string;
  fields: [string, string][];
  ttl?: number | null;
}
export function HashCardView({ name, fields, ttl }: HashCardProps) {
  return (
    <Card title="Hash" name={name} kind="hash_card">
      {fields.length === 0 ? (
        <Empty>No fields. The key is missing or not a hash.</Empty>
      ) : (
        <table className="kv-table" data-testid="hash-table">
          <tbody>
            {fields.map(([f, v]) => (
              <tr key={f}>
                <th scope="row">{f}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ttl !== undefined && ttl !== null && ttl >= 0 ? <p className="muted">expires in {ttl}s</p> : null}
    </Card>
  );
}

// ---- list_feed -------------------------------------------------------------------------------------------
export interface ListFeedProps {
  name: string;
  /** Newest first, as LRANGE key 0 n returns after LPUSH. */
  items: string[];
  /** LLEN, may exceed items.length. */
  total: number;
}
export function ListFeedView({ name, items, total }: ListFeedProps) {
  return (
    <Card title="List feed" name={name} kind="list_feed">
      {items.length === 0 ? (
        <Empty>The list is empty.</Empty>
      ) : (
        <ol className="feed">
          {items.map((it, i) => (
            <li key={`${i}-${it}`}>{it}</li>
          ))}
        </ol>
      )}
      <p className="muted">{total} item{total === 1 ? '' : 's'} in the list</p>
    </Card>
  );
}

// ---- set_chips -------------------------------------------------------------------------------------------
export interface SetChipsProps {
  name: string;
  members: string[];
  highlight?: string;
}
export function SetChipsView({ name, members, highlight }: SetChipsProps) {
  const sorted = [...members].sort();
  return (
    <Card title="Set" name={name} kind="set_chips">
      {sorted.length === 0 ? (
        <Empty>The set is empty.</Empty>
      ) : (
        <ul className="chips">
          {sorted.map((m) => (
            <li key={m} className={m === highlight ? 'chip hl' : 'chip'}>{m}</li>
          ))}
        </ul>
      )}
      <p className="muted">{sorted.length} member{sorted.length === 1 ? '' : 's'}, no duplicates, no order</p>
    </Card>
  );
}

// ---- leaderboard_panel -----------------------------------------------------------------------------------
export interface LeaderboardProps {
  name: string;
  /** Highest score first (ZRANGE key 0 n REV WITHSCORES). */
  rows: { member: string; score: number }[];
  highlight?: string;
}
export function LeaderboardPanelView({ name, rows, highlight }: LeaderboardProps) {
  const max = Math.max(1, ...rows.map((r) => r.score));
  return (
    <Card title="Leaderboard" name={name} kind="leaderboard_panel">
      {rows.length === 0 ? (
        <Empty>Nobody on the board yet.</Empty>
      ) : (
        <ol className="board">
          {rows.map((r, i) => (
            <li key={r.member} className={r.member === highlight ? 'hl' : undefined}>
              <span className="rank">{i + 1}</span>
              <span className="who">{r.member}</span>
              <span className="bar"><i style={{ width: `${Math.max(3, (r.score / max) * 100)}%` }} /></span>
              <span className="score">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ---- ttl_timer -------------------------------------------------------------------------------------------
export interface TtlTimerProps {
  name: string;
  /** Seconds left when read; -1 no expiry; -2 key missing. */
  ttl: number;
  /** Epoch ms of the read, so the view can count down between polls. */
  readAt: number;
  /** Optional original TTL, only to scale the ring. */
  total?: number;
}
export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s` : `${m}m ${String(sec).padStart(2, '0')}s`;
}
export function TtlTimerView({ name, ttl, readAt, total }: TtlTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ttl < 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ttl]);
  const left = ttl < 0 ? ttl : Math.max(0, ttl - Math.floor((now - readAt) / 1000));
  const span = total && total > 0 ? total : Math.max(ttl, 1);
  const frac = left < 0 ? 0 : Math.min(1, left / span);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <Card title="Time to live" name={name} kind="ttl_timer">
      {ttl === -2 ? (
        <Empty>The key is gone (TTL -2): it expired or never existed.</Empty>
      ) : ttl === -1 ? (
        <Empty>The key exists and never expires (TTL -1).</Empty>
      ) : (
        <div className="ttl">
          <svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true">
            <circle cx="40" cy="40" r={r} className="ring-bg" />
            <circle cx="40" cy="40" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 40 40)" />
          </svg>
          <div>
            <div className="ttl-num" data-testid="ttl-left">{left}s</div>
            <div className="muted">{fmtDuration(left)} until Redis deletes it</div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---- bitmap_streak ---------------------------------------------------------------------------------------
export interface BitmapStreakProps {
  name: string;
  /** One 0/1 per day, oldest first, the last entry is the most recent day. */
  bits: number[];
}
export function currentStreak(bits: number[]): number {
  let n = 0;
  for (let i = bits.length - 1; i >= 0 && bits[i] === 1; i--) n++;
  return n;
}
export function BitmapStreakView({ name, bits }: BitmapStreakProps) {
  const total = bits.reduce((a, b) => a + b, 0);
  return (
    <Card title="Login streak" name={name} kind="bitmap_streak">
      <div className="streak" role="img" aria-label={`${total} days set out of ${bits.length}`}>
        {bits.map((b, i) => (
          <i key={i} className={b ? 'on' : 'off'} title={`day ${i + 1}: ${b ? 'logged in' : 'missed'}`} />
        ))}
      </div>
      <p><strong>{currentStreak(bits)}</strong> day streak, <strong>{total}</strong> of {bits.length} days set</p>
    </Card>
  );
}

// ---- hll_counter -----------------------------------------------------------------------------------------
export interface HllCounterProps {
  name: string;
  /** PFCOUNT result: an estimate with about 0.81% standard error. */
  count: number;
}
export function HllCounterView({ name, count }: HllCounterProps) {
  return (
    <Card title="Unique visitors (estimate)" name={name} kind="hll_counter">
      <div className="big-num" data-testid="hll-count">{count.toLocaleString('en-IN')}</div>
      <p className="muted">A HyperLogLog keeps this in about 12 KB however many visitors there are.</p>
    </Card>
  );
}

// ---- geo_map ---------------------------------------------------------------------------------------------
export interface GeoMapProps {
  name: string;
  points: { member: string; lon: number; lat: number }[];
}
export function GeoMapView({ name, points }: GeoMapProps) {
  const W = 320;
  const H = 200;
  const pad = 22;
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const sx = (lon: number) => (maxLon === minLon ? W / 2 : pad + ((lon - minLon) / (maxLon - minLon)) * (W - 2 * pad));
  const sy = (lat: number) => (maxLat === minLat ? H / 2 : H - pad - ((lat - minLat) / (maxLat - minLat)) * (H - 2 * pad));
  return (
    <Card title="Places" name={name} kind="geo_map">
      {points.length === 0 ? (
        <Empty>No coordinates stored under this key.</Empty>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="geo" role="img" aria-label={`${points.length} places plotted by longitude and latitude`}>
          <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="8" className="geo-bg" />
          {points.map((p) => (
            <g key={p.member}>
              <circle cx={sx(p.lon)} cy={sy(p.lat)} r="5" className="geo-dot" />
              <text x={sx(p.lon) + 8} y={sy(p.lat) + 4} className="geo-label">{p.member}</text>
            </g>
          ))}
        </svg>
      )}
    </Card>
  );
}

// ---- stream_log ------------------------------------------------------------------------------------------
export interface StreamLogProps {
  name: string;
  /** Newest first (XREVRANGE key + - COUNT n). */
  entries: { id: string; fields: [string, string][] }[];
}
export function StreamLogView({ name, entries }: StreamLogProps) {
  return (
    <Card title="Stream" name={name} kind="stream_log">
      {entries.length === 0 ? (
        <Empty>No entries in the stream.</Empty>
      ) : (
        <ul className="stream">
          {entries.map((e) => (
            <li key={e.id}>
              <code className="sid">{e.id}</code>
              <span>{e.fields.map(([k, v]) => `${k}=${v}`).join('  ')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- json_tree -------------------------------------------------------------------------------------------
export interface JsonTreeProps {
  name: string;
  /** Parsed JSON (JSON.GET key $ unwrapped by the wrapper). */
  value: unknown;
}
function Node({ k, v, depth }: { k: string | null; v: unknown; depth: number }) {
  const label = k === null ? null : <span className="jk">{k}: </span>;
  if (v !== null && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
    return (
      <details open={depth < 2}>
        <summary>
          {label}
          <span className="muted">{Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}</span>
        </summary>
        <div className="jchildren">
          {entries.map(([ck, cv]) => (
            <Node key={ck} k={ck} v={cv} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }
  return (
    <div className="jleaf">
      {label}
      <span className={typeof v === 'string' ? 'js' : 'jn'}>{typeof v === 'string' ? `"${v}"` : String(v)}</span>
    </div>
  );
}
export function JsonTreeView({ name, value }: JsonTreeProps) {
  return (
    <Card title="JSON document" name={name} kind="json_tree">
      {value === undefined ? <Empty>No JSON document under this key.</Empty> : <div className="jtree"><Node k={null} v={value} depth={0} /></div>}
    </Card>
  );
}

// ---- cache_stats -----------------------------------------------------------------------------------------
export interface CacheStatsProps {
  /** INFO stats keyspace_hits / keyspace_misses (server lifetime, not per level). */
  hits: number;
  misses: number;
  /** DBSIZE. */
  keys: number;
  /** INFO stats total_commands_processed. */
  commands?: number;
}
export function CacheStatsView({ hits, misses, keys, commands }: CacheStatsProps) {
  const total = hits + misses;
  const ratio = total === 0 ? null : hits / total;
  return (
    <figure className="showme" data-showme="cache_stats">
      <figcaption><span className="showme-title">Cache health</span><code className="showme-key">INFO stats</code></figcaption>
      <div className="showme-body">
        <div className="big-num" data-testid="hit-ratio">{ratio === null ? 'no reads yet' : `${(ratio * 100).toFixed(1)}% hit`}</div>
        <div className="meter" role="img" aria-label="hit ratio"><i style={{ width: `${(ratio ?? 0) * 100}%` }} /></div>
        <dl className="facts">
          <div><dt>hits</dt><dd>{hits}</dd></div>
          <div><dt>misses</dt><dd>{misses}</dd></div>
          <div><dt>keys</dt><dd>{keys}</dd></div>
          {commands !== undefined ? <div><dt>commands</dt><dd>{commands}</dd></div> : null}
        </dl>
      </div>
    </figure>
  );
}
