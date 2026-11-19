'use client';
import { clsx } from 'clsx';
import { LayoutGroup, motion } from 'motion/react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Braces,
  CalendarCheck,
  Clock,
  Database,
  Filter,
  Gauge,
  Hash,
  Infinity as InfinityIcon,
  List,
  MapPin,
  Minus,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trophy,
  Type,
  Users,
  X,
  Waypoints,
  Boxes,
  Timer,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Segmented, useReducedMotion } from '@/design';
import { cmd, fmtSeconds, formatCommand, parseSeconds } from './commands';
import { Empty, Facts, Num, PanelFrame, Spark, freshClass, useFrame, useFresh } from './frame';
import styles from './showme.module.css';

// Pure views: data in, markup out. The contract for each is the exported props interface. In hands-on mode (the
// frame's context says so) the six panels with direct manipulation also render their controls.

const ICON = 18;

// ---- hands-on controls --------------------------------------------------------------------------------------------
function useControls() {
  const f = useFrame();
  const show = f.interactive && !f.locked;
  const hands = f.hands;
  const disabled = !hands || hands.busy;
  const go = async (argv: string[]): Promise<boolean> => (hands ? hands.run(argv) : false);
  return { show, disabled, go };
}

const INPUT =
  'h-8 min-w-0 flex-1 rounded-sm border border-night-600 bg-night-950 px-2.5 font-mono text-md text-chalk shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] placeholder:text-chalk-faint disabled:cursor-not-allowed disabled:text-chalk-faint';

function TextBox({
  value,
  onChange,
  onEnter,
  label,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      className={clsx(INPUT, className)}
    />
  );
}

/** Rows of field / value with a flash on every row that is new or changed. */
function KeyValueTable({
  rows,
  testId,
  edit,
}: {
  rows: [string, string][];
  testId: string;
  /** Hands-on: click a value to edit it. */
  edit?: {
    editing: { field: string; draft: string } | null;
    disabled: boolean;
    onStart: (field: string, value: string) => void;
    onChange: (draft: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
  };
}) {
  const fresh = useFresh(rows.map(([f, v]) => `${f}\u0002${v}`));
  return (
    <table data-testid={testId} className="w-full border-separate border-spacing-0 text-md">
      <tbody>
        {rows.map(([f, v]) => {
          const isEditing = edit?.editing?.field === f;
          return (
            <tr key={f} className={freshClass(fresh.has(`${f}\u0002${v}`))}>
              <th
                scope="row"
                className="w-[38%] border-b border-night-600/50 py-1.5 pr-3 pl-2 text-left align-baseline font-mono text-sm font-medium text-chalk-dim"
              >
                {f}
              </th>
              <td className="border-b border-night-600/50 py-1 pr-2 align-baseline font-mono text-chalk">
                {edit && isEditing ? (
                  <input
                    autoFocus
                    aria-label={`New value for ${f}`}
                    value={edit.editing?.draft ?? ''}
                    onChange={(e) => edit.onChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') edit.onSubmit();
                      if (e.key === 'Escape') edit.onCancel();
                    }}
                    onBlur={edit.onCancel}
                    spellCheck={false}
                    className={clsx(INPUT, 'w-full')}
                  />
                ) : edit ? (
                  <button
                    type="button"
                    disabled={edit.disabled}
                    onClick={() => edit.onStart(f, v)}
                    title="Click to edit"
                    className="group/edit -mx-1.5 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-left break-all transition-colors duration-fast hover:bg-night-700 disabled:cursor-not-allowed"
                  >
                    {v}
                    <Pencil
                      size={12}
                      aria-hidden
                      className="shrink-0 text-chalk-faint opacity-0 transition-opacity duration-fast group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100"
                    />
                  </button>
                ) : (
                  <span className="break-all">{v}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
const ttlText = (ttl: number | null) =>
  ttl === null || ttl === -1 ? 'never' : ttl === -2 ? 'gone' : `in ${ttl}s`;

export function KvCardView({ name, type, value, ttl }: KvCardProps) {
  const missing = type === 'none';
  const c = useControls();
  const [draft, setDraft] = useState<string | null>(null);
  const fresh = useFresh([value ?? '\u0000missing']);
  const send = async () => {
    if (draft === null) return;
    if (await c.go(cmd.set(name, draft))) setDraft(null);
  };
  const shown = draft ?? value ?? '';
  return (
    <PanelFrame
      kind="kv_card"
      title="String key"
      name={name}
      icon={<Type size={ICON} />}
      typeLabel={type === 'none' ? undefined : type}
      handsOn
      preview={draft !== null ? formatCommand(cmd.set(name, draft)) : null}
    >
      {missing ? (
        <Empty>This key does not exist (yet).</Empty>
      ) : (
        <>
          <div
            className={clsx(
              'rounded-md border border-night-600/70 bg-night-950/60 px-4 py-3 font-mono text-2xl leading-tight font-semibold break-all text-chalk',
              freshClass(fresh.size > 0),
            )}
            data-testid="kv-value"
          >
            {value ?? `(a ${type}, not a string)`}
          </div>
          <Facts
            items={[
              { label: 'type', value: type },
              { label: 'expires', value: ttlText(ttl) },
            ]}
          />
        </>
      )}
      {c.show && (type === 'string' || missing) && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <TextBox
            label="Value"
            value={shown}
            onChange={setDraft}
            placeholder="a new value"
            disabled={c.disabled}
          />
          <Button
            type="submit"
            size="sm"
            disabled={c.disabled || draft === null}
            leading={<Pencil size={14} />}
          >
            SET
          </Button>
        </form>
      )}
    </PanelFrame>
  );
}

// ---- hash_card -------------------------------------------------------------------------------------------
export interface HashCardProps {
  name: string;
  fields: [string, string][];
  ttl?: number | null;
}
export function HashCardView({ name, fields, ttl }: HashCardProps) {
  const c = useControls();
  const [editing, setEditing] = useState<{ field: string; draft: string } | null>(null);
  const [nf, setNf] = useState('');
  const [nv, setNv] = useState('');
  const submitEdit = async () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    await c.go(cmd.hset(name, e.field, e.draft));
  };
  const addable = nf.trim() !== '' && nv !== '';
  const previewArgs = editing
    ? cmd.hset(name, editing.field, editing.draft)
    : addable
      ? cmd.hset(name, nf.trim(), nv)
      : null;
  return (
    <PanelFrame
      kind="hash_card"
      title="Hash"
      name={name}
      icon={<Hash size={ICON} />}
      typeLabel="hash"
      handsOn
      preview={previewArgs ? formatCommand(previewArgs) : null}
    >
      {fields.length === 0 ? (
        <Empty>No fields. The key is missing or not a hash.</Empty>
      ) : (
        <KeyValueTable
          rows={fields}
          testId="hash-table"
          edit={
            c.show
              ? {
                  editing,
                  disabled: c.disabled,
                  onStart: (field, value) => setEditing({ field, draft: value }),
                  onChange: (draft) => setEditing((e) => (e ? { ...e, draft } : e)),
                  onSubmit: () => void submitEdit(),
                  onCancel: () => setEditing(null),
                }
              : undefined
          }
        />
      )}
      {ttl !== undefined && ttl !== null && ttl >= 0 ? (
        <p className="text-sm text-chalk-dim">expires in {ttl}s</p>
      ) : null}
      {c.show && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!addable) return;
            void c.go(cmd.hset(name, nf.trim(), nv)).then((ok) => {
              if (ok) {
                setNf('');
                setNv('');
              }
            });
          }}
        >
          <TextBox
            label="Field"
            value={nf}
            onChange={setNf}
            placeholder="field"
            disabled={c.disabled}
            className="max-w-[9rem]"
          />
          <TextBox
            label="Field value"
            value={nv}
            onChange={setNv}
            placeholder="value"
            disabled={c.disabled}
          />
          <Button
            type="submit"
            size="sm"
            disabled={c.disabled || !addable}
            leading={<Plus size={14} />}
          >
            HSET
          </Button>
        </form>
      )}
    </PanelFrame>
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
  const c = useControls();
  const [draft, setDraft] = useState('');
  const seen = new Map<string, number>();
  const ids = items.map((it) => {
    const n = seen.get(it) ?? 0;
    seen.set(it, n + 1);
    return `${it}\u0002${n}`;
  });
  const fresh = useFresh(ids);
  const has = draft !== '';
  const push = async (argv: string[]) => {
    if (await c.go(argv)) setDraft('');
  };
  return (
    <PanelFrame
      kind="list_feed"
      title="List feed"
      name={name}
      icon={<List size={ICON} />}
      typeLabel="list"
      handsOn
      preview={has ? formatCommand(cmd.lpush(name, draft)) : null}
    >
      {items.length === 0 ? (
        <Empty>The list is empty.</Empty>
      ) : (
        <ol className="overflow-hidden rounded-md border border-night-600/70 bg-night-950/40">
          {items.map((it, i) => (
            <li
              key={ids[i]}
              className={clsx(
                'flex items-baseline gap-3 border-b border-night-600/40 px-3 py-1.5 last:border-b-0',
                freshClass(fresh.has(ids[i] as string)),
              )}
            >
              <span className="tabular w-5 shrink-0 text-right font-mono text-xs text-chalk-faint">
                {i}
              </span>
              <span className="min-w-0 flex-1 text-md break-words text-chalk">{it}</span>
              {i === 0 && <span className="label-caps shrink-0 text-xs text-flood-400">head</span>}
              {i === items.length - 1 && items.length > 1 && total <= items.length && (
                <span className="label-caps shrink-0 text-xs text-sky">tail</span>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm text-chalk-dim">
        <Num value={total} /> item{total === 1 ? '' : 's'} in the list
      </p>
      {c.show && (
        <div className="space-y-2">
          <TextBox
            label="Item to push"
            value={draft}
            onChange={setDraft}
            onEnter={() => has && void push(cmd.lpush(name, draft))}
            placeholder="a new item"
            disabled={c.disabled}
            className="w-full"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={c.disabled || !has}
              leading={<ArrowUpToLine size={14} />}
              onClick={() => void push(cmd.lpush(name, draft))}
            >
              LPUSH
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={c.disabled || !has}
              leading={<ArrowDownToLine size={14} />}
              onClick={() => void push(cmd.rpush(name, draft))}
            >
              RPUSH
            </Button>
            <span className="grow" />
            <Button
              size="sm"
              variant="ghost"
              disabled={c.disabled}
              onClick={() => void c.go(cmd.lpop(name))}
            >
              LPOP
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={c.disabled}
              onClick={() => void c.go(cmd.rpop(name))}
            >
              RPOP
            </Button>
          </div>
        </div>
      )}
    </PanelFrame>
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
  const c = useControls();
  const [draft, setDraft] = useState('');
  const fresh = useFresh(sorted);
  const has = draft.trim() !== '';
  return (
    <PanelFrame
      kind="set_chips"
      title="Set"
      name={name}
      icon={<Boxes size={ICON} />}
      typeLabel="set"
      handsOn
      preview={has ? formatCommand(cmd.sadd(name, draft.trim())) : null}
    >
      {sorted.length === 0 ? (
        <Empty>The set is empty.</Empty>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {sorted.map((m) => (
            <li
              key={m}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border py-1 font-mono text-sm',
                c.show ? 'pr-1 pl-3' : 'px-3',
                m === highlight
                  ? 'border-flood-500/60 bg-flood-500/10 text-flood-400'
                  : 'border-night-600 bg-night-900 text-chalk',
                freshClass(fresh.has(m)),
              )}
            >
              {m}
              {c.show && (
                <button
                  type="button"
                  aria-label={`Remove ${m} (SREM)`}
                  title={`SREM ${m}`}
                  disabled={c.disabled}
                  onClick={() => void c.go(cmd.srem(name, m))}
                  className="grid size-5 cursor-pointer place-items-center rounded-full text-chalk-dim transition-colors duration-fast hover:bg-wicket/20 hover:text-wicket disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-chalk-dim">
        {sorted.length} member{sorted.length === 1 ? '' : 's'}, no duplicates, no order
      </p>
      {c.show && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!has) return;
            void c.go(cmd.sadd(name, draft.trim())).then((ok) => ok && setDraft(''));
          }}
        >
          <TextBox
            label="Member to add"
            value={draft}
            onChange={setDraft}
            placeholder="a member"
            disabled={c.disabled}
          />
          <Button
            type="submit"
            size="sm"
            disabled={c.disabled || !has}
            leading={<Plus size={14} />}
          >
            SADD
          </Button>
        </form>
      )}
    </PanelFrame>
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
  const c = useControls();
  const reduced = useReducedMotion();
  const [step, setStep] = useState('1');
  const [draft, setDraft] = useState('');
  const by = Number(step);
  const fresh = useFresh(rows.map((r) => `${r.member}\u0002${r.score}`));
  const has = draft.trim() !== '';
  return (
    <PanelFrame
      kind="leaderboard_panel"
      title="Leaderboard"
      name={name}
      icon={<Trophy size={ICON} />}
      typeLabel="sorted set"
      handsOn
      preview={has ? formatCommand(cmd.zincrby(name, by, draft.trim())) : null}
    >
      {rows.length === 0 ? (
        <Empty>Nobody on the board yet.</Empty>
      ) : (
        <LayoutGroup>
          <ol className="space-y-1">
            {rows.map((r, i) => (
              <motion.li
                key={r.member}
                layout={reduced ? false : 'position'}
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                className={clsx(
                  'flex items-center gap-2 rounded-sm py-1 pr-1.5 pl-2',
                  r.member === highlight && 'bg-flood-500/10',
                  freshClass(fresh.has(`${r.member}\u0002${r.score}`)),
                )}
              >
                <span
                  className={clsx(
                    'font-display tabular w-5 shrink-0 text-center text-lg font-semibold',
                    i === 0 ? 'text-flood-400' : 'text-chalk-dim',
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className={clsx(
                    'w-[34%] min-w-0 truncate font-mono text-sm',
                    r.member === highlight ? 'text-flood-400' : 'text-chalk',
                  )}
                  title={r.member}
                >
                  {r.member}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-night-900">
                  <i
                    className={clsx(
                      'block h-full rounded-full transition-[width] duration-slow ease-out-expo',
                      i === 0 ? 'bg-flood-500' : 'bg-sky/70',
                    )}
                    style={{ width: `${Math.max(3, (r.score / max) * 100)}%` }}
                  />
                </span>
                <span className="tabular w-12 shrink-0 text-right font-mono text-md text-chalk">
                  <Num value={r.score} />
                </span>
                {c.show && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Minus ${by} for ${r.member}`}
                      title={`ZINCRBY ${name} -${by} ${r.member}`}
                      disabled={c.disabled}
                      onClick={() => void c.go(cmd.zincrby(name, -by, r.member))}
                      className="grid size-7 cursor-pointer place-items-center rounded-sm border border-night-600 bg-night-900 text-chalk-dim transition-colors duration-fast hover:border-wicket/60 hover:text-wicket active:bg-night-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Plus ${by} for ${r.member}`}
                      title={`ZINCRBY ${name} ${by} ${r.member}`}
                      disabled={c.disabled}
                      onClick={() => void c.go(cmd.zincrby(name, by, r.member))}
                      className="grid size-7 cursor-pointer place-items-center rounded-sm border border-night-600 bg-night-900 text-chalk-dim transition-colors duration-fast hover:border-turf/60 hover:text-turf active:bg-night-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={14} />
                    </button>
                  </span>
                )}
              </motion.li>
            ))}
          </ol>
        </LayoutGroup>
      )}
      {c.show && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="label-caps text-xs text-chalk-dim">step</span>
            <Segmented
              label="Points per click"
              size="sm"
              value={step}
              onValueChange={setStep}
              options={[
                { value: '1', label: '1' },
                { value: '5', label: '5' },
                { value: '10', label: '10' },
              ]}
            />
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!has) return;
              void c.go(cmd.zincrby(name, by, draft.trim())).then((ok) => ok && setDraft(''));
            }}
          >
            <TextBox
              label="Member to score"
              value={draft}
              onChange={setDraft}
              placeholder="a new or existing member"
              disabled={c.disabled}
            />
            <Button
              type="submit"
              size="sm"
              disabled={c.disabled || !has}
              leading={<Plus size={14} />}
            >
              ZINCRBY
            </Button>
          </form>
        </div>
      )}
    </PanelFrame>
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
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
    : `${m}m ${String(sec).padStart(2, '0')}s`;
}
const PRESETS = [10, 60, 600, 3600, 86400];

export function TtlTimerView({ name, ttl, readAt, total }: TtlTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ttl < 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ttl]);
  const c = useControls();
  const [secs, setSecs] = useState(30);
  const [touched, setTouched] = useState(false);
  const left = ttl < 0 ? ttl : Math.max(0, ttl - Math.floor((now - readAt) / 1000));
  const span = total && total > 0 ? total : Math.max(ttl, 1);
  const frac = left < 0 ? 0 : Math.min(1, left / span);
  const r = 40;
  const circ = 2 * Math.PI * r;
  const tone = frac > 0.5 ? 'stroke-turf' : frac > 0.2 ? 'stroke-flood-500' : 'stroke-wicket';
  const expire = (n: number) => {
    setTouched(false);
    void c.go(cmd.expire(name, n));
  };
  return (
    <PanelFrame
      kind="ttl_timer"
      title="Time to live"
      name={name}
      icon={<Timer size={ICON} />}
      handsOn
      preview={c.show && touched && ttl !== -2 ? formatCommand(cmd.expire(name, secs)) : null}
    >
      {ttl === -2 ? (
        <Empty>The key is gone (TTL -2): it expired or never existed.</Empty>
      ) : ttl === -1 ? (
        <Empty>
          <InfinityIcon size={18} className="mr-2 inline text-chalk-faint" aria-hidden />
          The key exists and never expires (TTL -1).
        </Empty>
      ) : (
        <div className="flex items-center gap-5">
          <svg
            viewBox="0 0 100 100"
            width="112"
            height="112"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              strokeWidth="7"
              className="stroke-night-600"
            />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              className={clsx('transition-[stroke-dashoffset] duration-slow ease-linear', tone)}
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - frac)}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div className="min-w-0">
            <div
              className="font-display tabular text-3xl leading-none font-semibold text-chalk"
              data-testid="ttl-left"
            >
              {left}s
            </div>
            <div className="mt-1.5 text-sm leading-5 text-chalk-dim">
              {fmtDuration(left)} until Redis deletes it
            </div>
          </div>
        </div>
      )}
      {c.show && ttl === -2 && (
        <Button
          size="sm"
          disabled={c.disabled}
          onClick={() => void c.go(cmd.setEx(name, 60))}
          leading={<Timer size={14} />}
        >
          Bring it back for 60 s
        </Button>
      )}
      {c.show && ttl !== -2 && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Set the countdown">
            {PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant="ghost"
                disabled={c.disabled}
                onClick={() => expire(p)}
              >
                {fmtSeconds(p)}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={300}
              step={1}
              value={secs}
              disabled={c.disabled}
              onChange={(e) => {
                setSecs(Number(e.target.value));
                setTouched(true);
              }}
              aria-label="Seconds until the key expires"
              className="h-8 min-w-0 flex-1 cursor-pointer accent-flood-500 disabled:cursor-not-allowed"
            />
            <span className="tabular w-12 shrink-0 text-right font-mono text-md text-chalk">
              {secs}s
            </span>
            <Button
              size="sm"
              disabled={c.disabled || parseSeconds(String(secs)) === null}
              onClick={() => expire(secs)}
              leading={<Clock size={14} />}
            >
              EXPIRE
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={c.disabled || ttl === -1}
            onClick={() => void c.go(cmd.persist(name))}
            leading={<InfinityIcon size={14} />}
          >
            PERSIST
          </Button>
        </div>
      )}
    </PanelFrame>
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
  const fresh = useFresh(bits.map((b, i) => (b ? `d${i}` : '')).filter(Boolean));
  return (
    <PanelFrame
      kind="bitmap_streak"
      title="Login streak"
      name={name}
      icon={<CalendarCheck size={ICON} />}
      typeLabel="bitmap"
    >
      <div
        className="flex flex-wrap gap-1.5"
        role="img"
        aria-label={`${total} days set out of ${bits.length}`}
      >
        {bits.map((b, i) => (
          <i
            key={i}
            className={clsx(
              'block size-5 rounded-xs',
              b
                ? 'bg-turf shadow-[0_0_10px_rgb(46_226_129/0.45)]'
                : 'bg-night-900 ring-1 ring-night-600',
              fresh.has(`d${i}`) && styles.fresh,
            )}
            title={`day ${i + 1}: ${b ? 'logged in' : 'missed'}`}
          />
        ))}
      </div>
      <p className="text-md text-chalk-dim">
        <strong className="font-display text-xl font-semibold text-chalk">
          <Num value={currentStreak(bits)} />
        </strong>{' '}
        day streak, <strong className="text-chalk">{total}</strong> of {bits.length} days set
      </p>
    </PanelFrame>
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
    <PanelFrame
      kind="hll_counter"
      title="Unique visitors (estimate)"
      name={name}
      icon={<Users size={ICON} />}
      typeLabel="hyperloglog"
    >
      <div
        className="font-display tabular text-4xl font-semibold text-flood-400"
        data-testid="hll-count"
      >
        <Num value={count} format={(n) => n.toLocaleString('en-IN')} />
      </div>
      <p className="text-sm leading-5 text-chalk-dim">
        A HyperLogLog keeps this in about 12 KB however many visitors there are.
      </p>
    </PanelFrame>
  );
}

// ---- geo_map ---------------------------------------------------------------------------------------------
export interface GeoMapProps {
  name: string;
  points: { member: string; lon: number; lat: number }[];
}
export function GeoMapView({ name, points }: GeoMapProps) {
  const W = 360;
  const H = 220;
  const pad = 30;
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const sx = (lon: number) =>
    maxLon === minLon ? W / 2 : pad + ((lon - minLon) / (maxLon - minLon)) * (W - 2 * pad);
  const sy = (lat: number) =>
    maxLat === minLat ? H / 2 : H - pad - ((lat - minLat) / (maxLat - minLat)) * (H - 2 * pad);
  const fresh = useFresh(points.map((p) => p.member));
  return (
    <PanelFrame
      kind="geo_map"
      title="Places"
      name={name}
      icon={<MapPin size={ICON} />}
      typeLabel="geo"
    >
      {points.length === 0 ? (
        <Empty>No coordinates stored under this key.</Empty>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full rounded-md"
          role="img"
          aria-label={`${points.length} places plotted by longitude and latitude`}
        >
          <rect
            x="0.5"
            y="0.5"
            width={W - 1}
            height={H - 1}
            rx="8"
            className="fill-night-950 stroke-night-600"
          />
          {[1, 2, 3].map((i) => (
            <g key={i} className="stroke-night-700" strokeWidth="1">
              <line x1={(W / 4) * i} y1="1" x2={(W / 4) * i} y2={H - 1} />
              <line x1="1" y1={(H / 4) * i} x2={W - 1} y2={(H / 4) * i} />
            </g>
          ))}
          {points.map((p) => {
            const x = sx(p.lon);
            const y = sy(p.lat);
            const left = x > W * 0.62;
            return (
              <g key={p.member}>
                {fresh.has(p.member) && (
                  <circle
                    cx={x}
                    cy={y}
                    r="5"
                    className={clsx('fill-none stroke-flood-500', styles.dotPing)}
                    strokeWidth="2"
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r="5"
                  className="fill-flood-500 stroke-night-950"
                  strokeWidth="2"
                />
                <text
                  x={left ? x - 9 : x + 9}
                  y={y + 4}
                  textAnchor={left ? 'end' : 'start'}
                  className="fill-chalk font-sans"
                  fontSize="11"
                >
                  {p.member}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </PanelFrame>
  );
}

// ---- stream_log ------------------------------------------------------------------------------------------
export interface StreamLogProps {
  name: string;
  /** Newest first (XREVRANGE key + - COUNT n). */
  entries: { id: string; fields: [string, string][] }[];
}
export function StreamLogView({ name, entries }: StreamLogProps) {
  const fresh = useFresh(entries.map((e) => e.id));
  return (
    <PanelFrame
      kind="stream_log"
      title="Stream"
      name={name}
      icon={<Waypoints size={ICON} />}
      typeLabel="stream"
    >
      {entries.length === 0 ? (
        <Empty>No entries in the stream.</Empty>
      ) : (
        <ul className="overflow-hidden rounded-md border border-night-600/70 bg-night-950/40">
          {entries.map((e) => (
            <li
              key={e.id}
              className={clsx(
                'flex flex-col gap-0.5 border-b border-night-600/40 px-3 py-1.5 last:border-b-0',
                freshClass(fresh.has(e.id)),
              )}
            >
              <code className="font-mono text-xs text-sky">{e.id}</code>
              <span className="font-mono text-sm break-all text-chalk">
                {e.fields.map(([k, v]) => `${k}=${v}`).join('  ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

// ---- json_tree -------------------------------------------------------------------------------------------
export interface JsonTreeProps {
  name: string;
  /** Parsed JSON (JSON.GET key $ unwrapped by the wrapper). */
  value: unknown;
}
function JsonNode({ k, v, depth }: { k: string | null; v: unknown; depth: number }) {
  const label = k === null ? null : <span className="text-sky">{k}: </span>;
  if (v !== null && typeof v === 'object') {
    const entries = Array.isArray(v)
      ? v.map((x, i) => [String(i), x] as const)
      : Object.entries(v as Record<string, unknown>);
    return (
      <details open={depth < 2} className="group/json">
        <summary className="cursor-pointer list-none rounded-xs py-0.5 marker:content-none hover:bg-night-700/60">
          <span className="mr-1 inline-block text-chalk-faint transition-transform duration-fast group-open/json:rotate-90">
            ›
          </span>
          {label}
          <span className="text-chalk-dim">
            {Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}
          </span>
        </summary>
        <div className="ml-2 border-l border-night-600 pl-3">
          {entries.map(([ck, cv]) => (
            <JsonNode key={ck} k={ck} v={cv} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }
  const tone =
    typeof v === 'string'
      ? 'text-turf'
      : typeof v === 'number'
        ? 'text-flood-400'
        : typeof v === 'boolean'
          ? 'text-cap-purple'
          : 'text-chalk-faint';
  return (
    <div className="py-0.5 pl-4">
      {label}
      <span className={tone}>{typeof v === 'string' ? `"${v}"` : String(v)}</span>
    </div>
  );
}
export function JsonTreeView({ name, value }: JsonTreeProps) {
  return (
    <PanelFrame
      kind="json_tree"
      title="JSON document"
      name={name}
      icon={<Braces size={ICON} />}
      typeLabel="json"
    >
      {value === undefined ? (
        <Empty>No JSON document under this key.</Empty>
      ) : (
        <div className="rounded-md border border-night-600/70 bg-night-950/50 p-3 font-mono text-sm leading-5 text-chalk">
          <JsonNode k={null} v={value} depth={0} />
        </div>
      )}
    </PanelFrame>
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
  const fresh = useFresh([`h${hits}`, `m${misses}`, `k${keys}`]);
  return (
    <PanelFrame
      kind="cache_stats"
      title="Cache health"
      name="INFO stats"
      icon={<Gauge size={ICON} />}
    >
      <div
        className="font-display tabular text-4xl font-semibold text-chalk"
        data-testid="hit-ratio"
      >
        {ratio === null ? 'no reads yet' : `${(ratio * 100).toFixed(1)}% hit`}
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-night-900 ring-1 ring-night-600"
        role="img"
        aria-label="hit ratio"
      >
        <i
          className="block h-full rounded-full bg-turf shadow-[0_0_12px_rgb(46_226_129/0.6)] transition-[width] duration-slow ease-out-expo"
          style={{ width: `${(ratio ?? 0) * 100}%` }}
        />
      </div>
      <Facts
        cols={commands !== undefined ? 2 : 3}
        items={[
          { label: 'hits', value: <Num value={hits} />, fresh: fresh.has(`h${hits}`) },
          { label: 'misses', value: <Num value={misses} />, fresh: fresh.has(`m${misses}`) },
          { label: 'keys', value: <Num value={keys} />, fresh: fresh.has(`k${keys}`) },
          ...(commands !== undefined
            ? [{ label: 'commands', value: <Num value={commands} /> }]
            : []),
        ]}
      />
    </PanelFrame>
  );
}

// ---- stats_latency_panel ---------------------------------------------------------------------------------
export interface StatsLatencyProps {
  /** The route the numbers belong to, as the app records it. */
  route: string;
  /** Latest second with traffic on the route; null when there is none yet. */
  p50: number | null;
  p99: number | null;
  rps: number | null;
  /** Postgres queries per second on the route; null when the app does not report them. */
  dbQps: number | null;
  /** p99 per second over the recent ticks, oldest first. */
  p99Series: number[];
  /** show_me.keys: the cache keys this level is about, with whether they exist now (null while unknown). */
  keys: { name: string; exists: boolean | null }[];
}
export function StatsLatencyView({
  route,
  p50,
  p99,
  rps,
  dbQps,
  p99Series,
  keys,
}: StatsLatencyProps) {
  const num = (n: number | null, d = 0) => (n === null ? 'no data' : n.toFixed(d));
  return (
    <PanelFrame
      kind="stats_latency_panel"
      title="Stats route, live"
      name={route}
      icon={<Activity size={ICON} />}
    >
      <Spark label="p99" unit="ms" values={p99Series} />
      <Facts
        testId="stats-facts"
        items={[
          { label: 'p50', value: p50 === null ? 'no data' : `${num(p50)} ms` },
          { label: 'p99', value: p99 === null ? 'no data' : `${num(p99)} ms` },
          { label: 'requests/s', value: num(rps) },
          { label: 'postgres queries/s', value: dbQps === null ? 'not reported' : num(dbQps) },
        ]}
      />
      <p className="text-sm text-chalk-dim">the page is slow because every request asks Postgres</p>
      {keys.length > 0 ? (
        <ul
          className="overflow-hidden rounded-md border border-night-600/70 bg-night-950/40"
          data-testid="stats-keys"
        >
          {keys.map((k) => (
            <li
              key={k.name}
              className="flex items-center justify-between gap-3 border-b border-night-600/40 px-3 py-1.5 last:border-b-0"
            >
              <code className="font-mono text-sm break-all text-chalk">{k.name}</code>
              <span className={clsx('shrink-0 text-sm', k.exists ? 'text-turf' : 'text-chalk-dim')}>
                {k.exists === null ? 'checking' : k.exists ? 'cached' : 'does not exist yet'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </PanelFrame>
  );
}

// ---- otp_limiter_panel -----------------------------------------------------------------------------------
export interface OtpLimiterProps {
  name: string;
  /** Redis TYPE of the key: hash (token bucket), string (fixed window), zset (sorted-set log), none. */
  type: string;
  /** HGETALL, for a hash. */
  fields: [string, string][];
  /** GET, for a string: the window's count. */
  value: string | null;
  /** TTL in seconds; -1 no expiry, -2 key missing. */
  ttl: number | null;
  /** ZCARD, for a sorted set. */
  members: number | null;
  /** Requests the app served on GET /app/limits/ping in the metrics window; null when none seen. */
  pingRequests: number | null;
}
export function OtpLimiterView({
  name,
  type,
  fields,
  value,
  ttl,
  members,
  pingRequests,
}: OtpLimiterProps) {
  const title =
    type === 'hash'
      ? 'Rate limit: token bucket'
      : type === 'string'
        ? 'Rate limit: fixed window'
        : type === 'zset'
          ? 'Rate limit: sorted-set log'
          : 'Rate limit';
  const fresh = useFresh([`v${value}`, `m${members}`]);
  return (
    <PanelFrame
      kind="otp_limiter_panel"
      title={title}
      name={name}
      icon={<ShieldCheck size={ICON} />}
      typeLabel={type === 'none' ? undefined : type === 'zset' ? 'sorted set' : type}
    >
      {type === 'none' ? (
        <Empty>This key does not exist (yet). Nobody has been counted.</Empty>
      ) : type === 'hash' ? (
        <KeyValueTable rows={fields} testId="limiter-hash" />
      ) : type === 'string' ? (
        <Facts
          testId="limiter-window"
          items={[
            { label: 'count', value: value ?? '?', fresh: fresh.has(`v${value}`) },
            {
              label: 'window resets',
              value: ttl === null || ttl < 0 ? 'no expiry set' : `in ${ttl}s`,
            },
          ]}
        />
      ) : type === 'zset' ? (
        <Facts
          testId="limiter-log"
          cols={2}
          items={[
            {
              label: 'requests in the log',
              value: members ?? 0,
              fresh: fresh.has(`m${members}`),
            },
          ]}
        />
      ) : (
        <Empty>A {type} key. A limiter keeps a hash, a string or a sorted set.</Empty>
      )}
      <Facts
        testId="limiter-tally"
        items={[
          {
            label: '/app/limits/ping served',
            value: pingRequests === null ? 'no traffic yet' : pingRequests,
          },
          { label: 'denied (429)', value: 'not reported' },
        ]}
      />
    </PanelFrame>
  );
}

// ---- stream_groups ---------------------------------------------------------------------------------------
export interface StreamGroupsProps {
  name: string;
  /** XLEN; null when the key does not exist. */
  length: number | null;
  groups: {
    name: string;
    consumers: number;
    pending: number;
    /** null when Redis cannot tell. */
    lag: number | null;
    lastDeliveredId: string;
    /** XPENDING summary: pending entries per consumer. */
    perConsumer: { consumer: string; pending: number }[];
  }[];
}
export function StreamGroupsView({ name, length, groups }: StreamGroupsProps) {
  const fresh = useFresh(
    groups.map((g) => `${g.name}\u0002${g.pending}\u0002${g.lag}\u0002${g.lastDeliveredId}`),
  );
  return (
    <PanelFrame
      kind="stream_groups"
      title="Stream consumer groups"
      name={name}
      icon={<Database size={ICON} />}
      typeLabel="stream"
    >
      {length === null || (length === 0 && groups.length === 0) ? (
        <Empty>no stream yet</Empty>
      ) : (
        <>
          <Facts
            items={[
              {
                label: 'entries',
                value: <span data-testid="stream-length">{length}</span>,
              },
              { label: 'groups', value: groups.length },
            ]}
          />
          {groups.length === 0 ? (
            <Empty>No consumer group yet. Nothing is reading this stream.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-night-600/70">
              <table data-testid="stream-groups" className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-night-900">
                    {['group', 'consumers', 'pending', 'lag', 'last delivered'].map((h) => (
                      <th
                        key={h}
                        className="label-caps px-3 py-1.5 text-left text-xs text-chalk-dim"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr
                      key={g.name}
                      data-group={g.name}
                      className={freshClass(
                        fresh.has(
                          `${g.name}\u0002${g.pending}\u0002${g.lag}\u0002${g.lastDeliveredId}`,
                        ),
                      )}
                    >
                      <td className="border-t border-night-600/40 px-3 py-1.5 align-top">
                        <code className="font-mono text-chalk">{g.name}</code>
                        {g.perConsumer.length > 0 ? (
                          <div className="text-xs text-chalk-dim">
                            {g.perConsumer.map((c) => `${c.consumer}: ${c.pending}`).join(', ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="tabular border-t border-night-600/40 px-3 py-1.5 align-top">
                        {g.consumers}
                      </td>
                      <td className="tabular border-t border-night-600/40 px-3 py-1.5 align-top">
                        {g.pending}
                      </td>
                      <td className="tabular border-t border-night-600/40 px-3 py-1.5 align-top">
                        {g.lag === null ? 'unknown' : g.lag}
                      </td>
                      <td className="border-t border-night-600/40 px-3 py-1.5 align-top">
                        <code className="font-mono text-xs text-sky">{g.lastDeliveredId}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </PanelFrame>
  );
}

// ---- ts_chart --------------------------------------------------------------------------------------------
export interface TsChartProps {
  name: string;
  /** TS.INFO; null when the key does not exist. */
  info: { retentionMs: number; totalSamples: number; labels: [string, string][] } | null;
  /** Average per minute over the last 60 buckets, oldest first. */
  values: number[];
}
export function fmtRetention(ms: number): string {
  if (ms <= 0) return 'forever';
  if (ms % 86400000 === 0) return `${ms / 86400000} d`;
  if (ms % 3600000 === 0) return `${ms / 3600000} h`;
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  return `${ms} ms`;
}
export function TsChartView({ name, info, values }: TsChartProps) {
  return (
    <PanelFrame
      kind="ts_chart"
      title="Time series"
      name={name}
      icon={<Activity size={ICON} />}
      typeLabel="time series"
    >
      {info === null || (info.totalSamples === 0 && values.length === 0) ? (
        <Empty>no samples yet</Empty>
      ) : (
        <>
          <Spark
            label="avg per minute"
            unit=""
            period="minutes"
            values={values}
            fmt={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))}
          />
          <Facts
            cols={3}
            items={[
              { label: 'samples', value: <Num value={info.totalSamples} /> },
              { label: 'retention', value: fmtRetention(info.retentionMs) },
              { label: 'buckets shown', value: values.length },
            ]}
          />
          {info.labels.length > 0 ? (
            <p className="font-mono text-sm text-chalk-dim" data-testid="ts-labels">
              labels: {info.labels.map(([k, v]) => `${k}=${v}`).join('  ')}
            </p>
          ) : null}
        </>
      )}
    </PanelFrame>
  );
}

// ---- bf_card ---------------------------------------------------------------------------------------------
export interface BfCardProps {
  name: string;
  /** BF.INFO; null when the filter does not exist. */
  info: {
    capacity: number | null;
    sizeBytes: number | null;
    filters: number | null;
    inserted: number | null;
    expansion: number | null;
  } | null;
  /** BF.CARD. */
  card: number | null;
}
export function BfCardView({ name, info, card }: BfCardProps) {
  const show = (n: number | null) => (n === null ? 'n/a' : n.toLocaleString('en-US'));
  const fresh = useFresh([`i${info?.inserted}`, `c${card}`]);
  return (
    <PanelFrame
      kind="bf_card"
      title="Bloom filter"
      name={name}
      icon={<Filter size={ICON} />}
      typeLabel="bloom filter"
    >
      {info === null ? (
        <Empty>no filter yet</Empty>
      ) : (
        <Facts
          testId="bf-facts"
          cols={3}
          items={[
            {
              label: 'items inserted',
              value: show(info.inserted),
              fresh: fresh.has(`i${info.inserted}`),
            },
            { label: 'cardinality', value: show(card), fresh: fresh.has(`c${card}`) },
            { label: 'capacity', value: show(info.capacity) },
            {
              label: 'size',
              value: info.sizeBytes === null ? 'n/a' : `${show(info.sizeBytes)} bytes`,
            },
            { label: 'filters', value: show(info.filters) },
            { label: 'expansion', value: info.expansion === null ? 'none' : show(info.expansion) },
          ]}
        />
      )}
    </PanelFrame>
  );
}

// ---- ft_card ---------------------------------------------------------------------------------------------
export interface FtCardProps {
  name: string;
  /** FT.INFO; null when the index does not exist. */
  info: { numDocs: number; prefixes: string[]; fields: { name: string; type: string }[] } | null;
  /** FT.SEARCH <index> * LIMIT 0 3 RETURN 0: up to three document ids. */
  docIds: string[];
}
export function FtCardView({ name, info, docIds }: FtCardProps) {
  const fresh = useFresh(docIds);
  return (
    <PanelFrame
      kind="ft_card"
      title="Search index"
      name={name}
      icon={<Search size={ICON} />}
      typeLabel="search index"
    >
      {info === null ? (
        <Empty>no index yet</Empty>
      ) : (
        <>
          <Facts
            items={[
              {
                label: 'documents',
                value: (
                  <span data-testid="ft-num-docs">
                    <Num value={info.numDocs} />
                  </span>
                ),
              },
              {
                label: 'prefixes',
                value: info.prefixes.length ? info.prefixes.join(', ') : 'none',
              },
            ]}
          />
          {info.fields.length > 0 ? (
            <table data-testid="ft-fields" className="w-full border-collapse text-md">
              <tbody>
                {info.fields.map((f) => (
                  <tr key={f.name}>
                    <th className="border-b border-night-600/50 py-1.5 pr-3 text-left font-mono text-sm font-medium text-chalk-dim">
                      {f.name}
                    </th>
                    <td className="border-b border-night-600/50 py-1.5">
                      <span className="rounded-xs bg-night-900 px-1.5 py-0.5 font-mono text-xs text-sky ring-1 ring-night-600">
                        {f.type}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {docIds.length > 0 ? (
            <ul
              className="overflow-hidden rounded-md border border-night-600/70 bg-night-950/40"
              data-testid="ft-docs"
            >
              {docIds.map((id) => (
                <li
                  key={id}
                  className={clsx(
                    'border-b border-night-600/40 px-3 py-1.5 last:border-b-0',
                    freshClass(fresh.has(id)),
                  )}
                >
                  <code className="font-mono text-sm text-chalk">{id}</code>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No documents indexed yet.</Empty>
          )}
        </>
      )}
    </PanelFrame>
  );
}

// ---- acl_users -------------------------------------------------------------------------------------------
export interface AclUsersProps {
  /** ACL LIST, parsed; the default user first. */
  users: { name: string; rules: string }[];
}
export function AclUsersView({ users }: AclUsersProps) {
  const fresh = useFresh(users.map((u) => `${u.name}\u0002${u.rules}`));
  return (
    <PanelFrame
      kind="acl_users"
      title="ACL users"
      name="ACL LIST"
      icon={<ShieldCheck size={ICON} />}
    >
      {users.length === 0 ? (
        <Empty>No ACL users came back.</Empty>
      ) : (
        <table data-testid="acl-users" className="w-full border-collapse text-md">
          <tbody>
            {users.map((u) => (
              <tr
                key={u.name}
                data-user={u.name}
                className={freshClass(fresh.has(`${u.name}\u0002${u.rules}`))}
              >
                <th className="w-[28%] border-b border-night-600/50 py-2 pr-3 pl-2 text-left align-top font-mono text-sm font-medium text-flood-400">
                  {u.name}
                </th>
                <td className="border-b border-night-600/50 py-2 align-top">
                  <code className="font-mono text-xs leading-5 break-all text-chalk-dim">
                    {u.rules}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelFrame>
  );
}

export type { ReactNode };
