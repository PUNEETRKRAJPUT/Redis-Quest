'use client';
import { clsx } from 'clsx';
import { ArrowDown, ChevronsDown, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../design';
import {
  Avatar,
  LIST_RESET,
  MessageRow,
  SCROLL_AREA,
  TypingBubble,
  WALLPAPER,
} from '../thread/parts';
import { MAX_REVEAL_MS, participants, startsGroup, type AnimateMode } from '../thread/logic';
import { useReveal } from '../thread/useReveal';
import type { ThreadMessage } from '../types';

// Display names mirror fiction/cast.json (slug -> nickname). The UI does not bundle the JSON.
const NAMES: Record<string, string> = {
  roommate: 'Teja',
  senior: 'Harry Bhaiya',
  warden: 'Warden Sir',
  'sms-vendor': 'TextTara Sir',
  'rival-college': 'Gomti Gang',
  you: 'You',
};

export function nameOf(slug: string): string {
  return NAMES[slug] ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export type ThreadProps = {
  messages: ThreadMessage[];
  /** Accessible name of the message list. */
  label: string;
  /** Header title of the chat. Default "Chapter thread". */
  title?: string;
  /**
   * `auto` (default): messages arrive one by one the first time this thread is viewed, and it opens fully
   * revealed afterwards. `always`: arrive every time. `never`: fully revealed, no arrival.
   */
  animate?: AnimateMode;
  /** Upper bound for the whole arrival, however long the thread. Default 8000 ms. */
  maxRevealMs?: number;
  /** Height limit of the message area (CSS length or px). `fill` makes the thread fill its parent's height. */
  maxHeight?: number | string | 'fill';
  /** Called once when every message is on screen (after the arrival, a skip, or immediately when revealed). */
  onRevealed?: () => void;
  /** Remember in localStorage that this thread was seen (default true). */
  rememberSeen?: boolean;
  className?: string;
};

const NEAR_BOTTOM_PX = 56;

/** The group-chat incident thread. Text is plain, never markdown or HTML. */
export function Thread({
  messages,
  label,
  title = 'Chapter thread',
  animate = 'auto',
  maxRevealMs = MAX_REVEAL_MS,
  maxHeight = 'min(58vh, 32rem)',
  onRevealed,
  rememberSeen = true,
  className,
}: ThreadProps) {
  const r = useReveal({
    messages,
    mode: animate,
    maxMs: maxRevealMs,
    persist: rememberSeen,
    onRevealed,
  });
  const scroller = useRef<HTMLDivElement>(null);
  // A thread that opens already revealed starts at its first message; a live arrival follows the newest.
  const stick = useRef(false);
  const [unread, setUnread] = useState(0);

  const members = participants(messages);
  const visibleMessages = messages.slice(0, r.shown);
  const typingMsg = r.typingIndex === null ? undefined : messages[r.typingIndex];

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Follow the newest message only while the player is at the bottom. Scrolls the thread's own area, never the
  // page (no scrollIntoView), so a player reading elsewhere is never dragged around.
  const lastShown = useRef(r.shown);
  useLayoutEffect(() => {
    const grew = r.shown - lastShown.current;
    lastShown.current = r.shown;
    if (r.shown === 0) {
      stick.current = true;
      setUnread(0);
    }
    if (stick.current) toBottom();
    else if (grew > 0) setUnread((n) => n + grew);
  }, [r.shown, r.typingIndex, toBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    if (near) setUnread(0);
  };

  if (messages.length === 0) return null;

  const fill = maxHeight === 'fill';
  const areaStyle: CSSProperties | undefined = fill ? undefined : { maxHeight };
  const typingName = typingMsg ? nameOf(typingMsg.from) : '';
  const actionLabel = r.playing ? 'Show all' : 'Replay';

  return (
    <div
      ref={r.watch}
      data-ds=""
      data-testid="thread"
      data-state={r.playing ? 'playing' : 'revealed'}
      className={clsx(
        '@container my-3 flex w-full max-w-[34rem] flex-col overflow-hidden rounded-xl border border-night-600 shadow-raise',
        WALLPAPER,
        fill && 'h-full min-h-0',
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-night-600 bg-night-800/90 px-3 py-2.5">
        <div className="flex shrink-0 -space-x-2" aria-hidden="true">
          {members.slice(0, 4).map((slug, i) => (
            // In a narrow pane (the level brief) two faces are enough; the title keeps the room.
            <span
              key={slug}
              className={clsx(
                'rounded-full bg-night-800 ring-2 ring-night-800',
                i >= 2 && '@max-[26rem]:hidden',
              )}
            >
              <Avatar slug={slug} name={nameOf(slug)} />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-md font-semibold leading-5 text-chalk">{title}</h3>
          <p
            className={clsx(
              'truncate text-xs leading-4',
              typingMsg ? 'text-turf' : 'text-chalk-dim',
            )}
            aria-hidden="true"
          >
            {typingMsg
              ? `${typingName} ${typingName === 'You' ? 'are' : 'is'} typing\u2026`
              : members.map((s) => nameOf(s)).join(', ')}
          </p>
        </div>
        {/* One button for both jobs, so keyboard focus survives the swap from "Show all" to "Replay". */}
        {(r.playing || !r.reduced) && (
          <Button
            variant="quiet"
            size="sm"
            data-testid="thread-action"
            leading={
              r.playing ? <ChevronsDown className="size-4" /> : <RotateCcw className="size-3.5" />
            }
            shortcut={r.playing ? 'Esc' : undefined}
            onClick={r.playing ? r.skip : r.replay}
          >
            {actionLabel}
          </Button>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        data-testid="thread-scroll"
        className={clsx(SCROLL_AREA, 'relative px-3 py-3', fill && 'min-h-0 flex-1')}
        style={areaStyle}
      >
        <ol aria-label={label} aria-live="polite" aria-relevant="additions" className={LIST_RESET}>
          {visibleMessages.map((m, i) => (
            <MessageRow
              key={`${i}-${m.time}`}
              message={m}
              name={nameOf(m.from)}
              mine={m.from === 'you'}
              first={startsGroup(messages, i)}
              enter={r.live}
              reduced={r.reduced}
            />
          ))}
        </ol>
        {typingMsg && (
          <TypingBubble
            key={r.typingIndex}
            slug={typingMsg.from}
            name={typingName}
            mine={typingMsg.from === 'you'}
            tight={r.shown > 0 && messages[r.shown - 1]?.from === typingMsg.from}
            reduced={r.reduced}
          />
        )}
      </div>

      <AnimatePresence>
        {unread > 0 && (
          <motion.div
            className="pointer-events-none relative h-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <button
              type="button"
              data-testid="thread-jump"
              onClick={() => {
                stick.current = true;
                setUnread(0);
                toBottom();
              }}
              className="pointer-events-auto absolute -top-11 left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-flood-500/50 bg-night-800 px-3 py-1.5 text-xs font-semibold text-flood-400 shadow-pop transition-colors duration-fast hover:bg-night-700"
            >
              <ArrowDown className="size-3.5" />
              {unread === 1 ? '1 new message' : `${unread} new messages`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
