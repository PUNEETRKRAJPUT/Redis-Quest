'use client';

import { clsx } from 'clsx';
import { ArrowDownToLine, Copy, Search, X } from 'lucide-react';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { api } from '../api';
import {
  countErrors,
  filterEntries,
  linesSince,
  prettyRaw,
  SERVICE_BLURB,
  type LevelFilter,
  type LogEntry,
} from '../career/tools/logModel';
import { bottomOffset, isAtBottom, visibleRange } from '../career/tools/windowing';
import { Button, IconButton, Segmented, Switch, Tabs, toast } from '../design';
import { useQuest } from '../store';
import type { LogService } from '../types';
import { LOG_SERVICES } from '../types';
import { cssHeight, type PanelHeight } from './height';

const ROW = 28;

const LEVEL_STYLE = {
  debug: { tag: 'DBG', text: 'text-chalk-faint', rail: 'bg-transparent', row: '' },
  info: { tag: 'INFO', text: 'text-sky', rail: 'bg-transparent', row: '' },
  warn: { tag: 'WARN', text: 'text-flood-400', rail: 'bg-flood-500', row: 'bg-flood-500/[0.06]' },
  error: { tag: 'ERR', text: 'text-wicket', rail: 'bg-wicket', row: 'bg-wicket/[0.09]' },
} as const;

const LogRow = memo(function LogRow({
  entry,
  top,
  selected,
  onSelect,
}: {
  entry: LogEntry;
  top: number;
  selected: boolean;
  onSelect: (raw: string) => void;
}) {
  const s = LEVEL_STYLE[entry.level];
  return (
    <div
      role="row"
      aria-selected={selected}
      data-level={entry.level}
      onClick={() => onSelect(entry.raw)}
      className={clsx(
        'absolute inset-x-0 flex cursor-pointer items-center gap-3 pr-4 font-mono text-[12.5px] leading-none transition-colors duration-instant hover:bg-night-800/70',
        s.row,
        selected && 'bg-night-700/80 shadow-[inset_0_0_0_1px_var(--color-sky)]',
      )}
      style={{ top, height: ROW }}
    >
      <span aria-hidden className={clsx('h-full w-[3px] shrink-0', s.rail)} />
      <span className="tabular w-[92px] shrink-0 text-chalk-dim">{entry.time ?? ''}</span>
      <span className={clsx('label-caps w-9 shrink-0 text-[11px] tracking-[0.08em]', s.text)}>
        {s.tag}
      </span>
      <span
        className={clsx(
          'min-w-0 flex-1 truncate',
          entry.level === 'error' ? 'text-chalk' : 'text-chalk',
        )}
      >
        {entry.text}
        {entry.extras.map(([k, v]) => (
          <span key={k} className="ml-3 text-chalk-dim">
            <span className="text-chalk-dim">{k}=</span>
            {v}
          </span>
        ))}
      </span>
      {entry.meta ? (
        <span
          className={clsx(
            'tabular shrink-0',
            entry.level === 'error'
              ? 'text-wicket'
              : entry.level === 'warn'
                ? 'text-flood-400'
                : 'text-chalk-dim',
          )}
        >
          {entry.meta}
        </span>
      ) : null}
    </div>
  );
});

function Feed({ service, err }: { service: LogService; err: string | null }) {
  const live = useQuest((s) => s.logs[service]);
  const [follow, setFollow] = useState(true);
  const [frozen, setFrozen] = useState<readonly string[] | null>(null);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0);
  const raf = useRef(0);

  const source = follow || !frozen ? live : frozen;
  const deferredFilter = useDeferredValue(filter);
  const entries = useMemo(
    () => filterEntries(source, level, deferredFilter),
    [source, level, deferredFilter],
  );
  const total = entries.length * ROW;
  const effTop = follow ? bottomOffset(entries.length, viewport, ROW) : scrollTop;
  const range = visibleRange(effTop, viewport, ROW, entries.length);
  const missed = !follow && frozen ? linesSince(frozen, live) : 0;

  // Keep the scroller's size in state: the window needs it, and the pane can be resized.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Following: pin the scroller to the newest line after each render that changes the list.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }, [entries, follow, viewport]);

  const pause = useCallback(() => {
    setFrozen(live);
    setFollow(false);
  }, [live]);
  const resume = useCallback(() => {
    setFrozen(null);
    setFollow(true);
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop;
    const up = top < lastTop.current - 1;
    lastTop.current = top;
    if (follow) {
      // Only the reader scrolling up pauses the feed; new lines never reduce scrollTop.
      if (up && !isAtBottom(top, el.clientHeight, total)) {
        setScrollTop(top);
        pause();
      }
      return;
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      setScrollTop(top);
      if (isAtBottom(top, el.clientHeight, total, 4)) resume();
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const pick = (raw: string) => setSelected((cur) => (cur === raw ? null : raw));
  const move = (d: number) => {
    const i = entries.findIndex((e) => e.raw === selected);
    const n = Math.min(
      entries.length - 1,
      Math.max(0, (i < 0 ? (d > 0 ? -1 : entries.length) : i) + d),
    );
    const next = entries[n];
    if (!next) return;
    setSelected(next.raw);
    const el = scroller.current;
    if (el) {
      if (follow) pause();
      const topPx = n * ROW;
      if (topPx < el.scrollTop) el.scrollTop = topPx;
      else if (topPx + ROW > el.scrollTop + el.clientHeight)
        el.scrollTop = topPx + ROW - el.clientHeight;
      setScrollTop(el.scrollTop);
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Escape') setSelected(null);
    else if (e.key === 'End') {
      e.preventDefault();
      resume();
    }
  };

  const sel = selected ? entries.find((e) => e.raw === selected) : undefined;
  const empty = err
    ? `Could not read the ${service} log: ${err}`
    : live.length === 0
      ? `No ${service} log lines yet. They appear here as the service writes them.`
      : entries.length === 0
        ? 'No lines match the filter.'
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-night-600/70 px-4 py-2.5">
        <label className="relative min-w-40 flex-1 basis-56">
          <span className="sr-only">Filter {service} log lines</span>
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chalk-faint"
          />
          <input
            type="text"
            data-testid="log-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter lines"
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-full rounded-sm border border-night-600 bg-night-950/70 pl-8 pr-8 font-mono text-sm text-chalk placeholder:text-chalk-faint hover:border-chalk-faint/60"
          />
          {filter ? (
            <button
              type="button"
              aria-label="Clear the filter"
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-xs text-chalk-dim hover:bg-night-700 hover:text-chalk"
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </label>
        <Segmented<LevelFilter>
          label="Show lines"
          size="sm"
          value={level}
          onValueChange={setLevel}
          options={[
            { value: 'all', label: 'All' },
            { value: 'warn', label: 'Warnings' },
            { value: 'error', label: 'Errors' },
          ]}
        />
        <Switch
          checked={follow}
          onCheckedChange={(on) => (on ? resume() : pause())}
          label="Follow"
        />
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          role="log"
          aria-live="off"
          aria-label={`${service} log, live`}
          data-testid="logbox"
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-night-950/70"
        >
          {empty ? (
            <p
              className={clsx(
                'px-5 py-4 font-mono text-sm',
                err ? 'text-wicket' : 'text-chalk-dim',
              )}
            >
              {empty}
            </p>
          ) : (
            <div role="rowgroup" className="relative" style={{ height: total }}>
              {entries.slice(range.start, range.end).map((e, i) => (
                <LogRow
                  key={`${range.start + i}:${e.raw.length}:${e.time ?? ''}`}
                  entry={e}
                  top={(range.start + i) * ROW}
                  selected={e.raw === selected}
                  onSelect={pick}
                />
              ))}
            </div>
          )}
        </div>
        {!follow ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              size="sm"
              variant="primary"
              className="pointer-events-auto shadow-pop"
              leading={<ArrowDownToLine size={14} aria-hidden />}
              onClick={resume}
            >
              {missed > 0
                ? `${missed} new line${missed === 1 ? '' : 's'}: jump to live`
                : 'Jump to live'}
            </Button>
          </div>
        ) : null}
      </div>

      {sel ? (
        <div
          data-testid="log-inspector"
          className="max-h-40 shrink-0 overflow-auto border-t border-night-600 bg-night-900 px-4 py-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="label-caps text-[11px] text-chalk-dim">The line as written</span>
            <span className="ml-auto flex gap-1">
              <IconButton
                size="sm"
                variant="quiet"
                label="Copy the line"
                icon={<Copy size={14} aria-hidden />}
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(sel.raw)
                    .then(() => toast.success('Copied the log line'))
                }
              />
              <IconButton
                size="sm"
                variant="quiet"
                label="Close the inspector"
                icon={<X size={14} aria-hidden />}
                onClick={() => setSelected(null)}
              />
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-chalk-dim">
            {prettyRaw(sel.raw)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function LogsPanel({ height = 360 }: { height?: PanelHeight }) {
  const [tab, setTab] = useState<LogService>('app');
  const all = useQuest((s) => s.logs);
  const seed = useQuest((s) => s.seedLog);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    api
      .logs(tab)
      .then((r) => seed(tab, r.lines))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [tab, seed]);

  const errors = useMemo(
    () =>
      Object.fromEntries(LOG_SERVICES.map((s) => [s, countErrors(all[s])])) as Record<
        LogService,
        number
      >,
    [all],
  );

  return (
    <div
      data-ds=""
      data-testid="logs-panel"
      className="flex flex-col overflow-hidden rounded-lg border border-night-600 bg-night-900 shadow-raise"
      style={{ height: cssHeight(height) }}
    >
      <Tabs
        label="Service logs"
        value={tab}
        onValueChange={(id) => setTab(id as LogService)}
        className="flex min-h-0 flex-1 flex-col"
        panelClassName="min-h-0 flex-1 pt-0! focus-visible:outline-offset-[-2px]"
        items={LOG_SERVICES.map((s) => ({
          id: s,
          label: s,
          badge:
            errors[s] > 0 ? (
              <span
                aria-hidden
                title={`${errors[s]} error line${errors[s] === 1 ? '' : 's'}`}
                className="tabular rounded-full bg-wicket/15 px-1.5 font-mono text-[11px] font-semibold leading-5 text-wicket"
              >
                {errors[s]}
              </span>
            ) : undefined,
          content: s === tab ? <Feed key={s} service={s} err={err} /> : null,
        }))}
      />
      <p className="shrink-0 border-t border-night-600/70 bg-night-950/50 px-4 py-2 text-xs text-chalk-dim">
        {SERVICE_BLURB[tab]}. Click a line to see it as written; arrow keys move, End jumps to live.
      </p>
    </div>
  );
}
