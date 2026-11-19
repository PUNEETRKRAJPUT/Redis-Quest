// The two things the terminal shows while you type, as plain views over data computed in complete.ts:
// the completion popup above the prompt and the syntax bar under the terminal.
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { Kbd } from '@/design';
import type { Candidate, Hint, Seg } from './complete';
import styles from './terminal.module.css';

export const POPUP_ID = 'terminal-suggestions';
export const optionId = (i: number) => `${POPUP_ID}-${i}`;

export interface PopupView {
  kind: 'commands' | 'subcommands';
  items: Candidate[];
  selected: number;
  /** Pixels inside the terminal viewport. */
  left: number;
  width: number;
  /** Distance from the top (placement below) or from the bottom (placement above). */
  edge: number;
  placement: 'above' | 'below';
}

export const ROW_HEIGHT = 30;
export const POPUP_CHROME = 34; // header line + padding

export function CompletionPopup({
  view,
  onPick,
}: {
  view: PopupView;
  onPick: (index: number) => void;
}) {
  const { items, selected, placement } = view;
  return (
    <div
      className={clsx(styles.popup, placement === 'above' ? styles.above : styles.below)}
      data-testid="terminal-popup"
      data-placement={placement}
      style={{
        left: view.left,
        width: view.width,
        ...(placement === 'above' ? { bottom: view.edge } : { top: view.edge }),
      }}
      // The terminal's own textarea keeps focus; the list is only ever clicked with the mouse, never focused.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={styles.popupHead}>
        <span>{view.kind === 'subcommands' ? 'Subcommands' : 'Commands'}</span>
        <span className={styles.popupKeys}>
          <Kbd size="sm">Tab</Kbd> accept <Kbd size="sm">Esc</Kbd> close
        </span>
      </div>
      <ul role="listbox" id={POPUP_ID} aria-label="Command suggestions" className={styles.rows}>
        {items.map((c, i) => (
          <li
            key={c.name}
            id={optionId(i)}
            role="option"
            aria-selected={i === selected}
            data-selected={i === selected ? '' : undefined}
            data-testid="terminal-option"
            className={styles.row}
            onClick={() => onPick(i)}
          >
            <span className={styles.rowName}>
              <b>{c.word.slice(0, c.matchLen)}</b>
              {c.word.slice(c.matchLen)}
              {c.container ? <i aria-hidden> &rsaquo;</i> : null}
            </span>
            <span className={styles.rowSummary}>{c.summary}</span>
            {c.group ? <span className={styles.rowGroup}>{c.group}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SegText({ seg }: { seg: Seg }) {
  return (
    <span
      className={clsx(styles.seg, styles[`seg_${seg.kind}`], styles[`state_${seg.state}`])}
      data-active={seg.state === 'active' ? 'true' : undefined}
    >
      {seg.text}
    </span>
  );
}

/** What the bar says when nothing is being typed (or nothing is known about the command typed). */
export function KeyHints({ docsReady }: { docsReady: boolean }) {
  return (
    <div className={styles.keyhints}>
      {docsReady ? (
        <span>
          <Kbd size="sm">Tab</Kbd> complete
        </span>
      ) : null}
      <span>
        <Kbd size="sm">&uarr;</Kbd> <Kbd size="sm">&darr;</Kbd> history
      </span>
      <span>
        <Kbd size="sm">Ctrl</Kbd> <Kbd size="sm">L</Kbd> clear
      </span>
      {docsReady ? (
        <span>
          <Kbd size="sm">Esc</Kbd> close list
        </span>
      ) : null}
    </div>
  );
}

export function SyntaxBar({ hint, docsReady }: { hint: Hint | null; docsReady: boolean }) {
  const line = useRef<HTMLElement>(null);
  // A long syntax does not wrap (the bar would grow and move the terminal): it scrolls the argument at the
  // cursor into view instead.
  useEffect(() => {
    const el = line.current;
    if (!el) return;
    const marked = el.querySelectorAll<HTMLElement>('[data-active="true"]');
    const active = marked[marked.length - 1];
    if (!active) {
      el.scrollLeft = 0;
      return;
    }
    const right = active.offsetLeft + active.offsetWidth + 48;
    if (right > el.clientWidth) el.scrollLeft = right - el.clientWidth;
    else el.scrollLeft = 0;
  }, [hint]);
  return (
    <div
      className={styles.assist}
      data-testid="terminal-assist"
      data-state={hint ? 'hint' : 'idle'}
    >
      {hint ? (
        <>
          <div className={styles.syntaxLine} data-testid="terminal-syntax">
            {/* The command stays put at the left; only the arguments scroll under it. */}
            <code className={styles.syntaxCmd}>
              {hint.syntax.segs[0] ? <SegText seg={hint.syntax.segs[0]} /> : null}
            </code>
            <code className={styles.syntax} ref={line}>
              {hint.syntax.segs.slice(1).map((s, i) => (
                <SegText key={i} seg={s} />
              ))}
            </code>
            {hint.syntax.extra ? (
              <span className={styles.extra}>more words than the syntax lists</span>
            ) : null}
          </div>
          <div className={styles.metaLine}>
            <span className={styles.summary}>{hint.summary}</span>
            {hint.complexity ? (
              <span
                className={styles.meta}
                title={`Time complexity, from the server's docs: ${hint.complexity}`}
              >
                {hint.complexity}
              </span>
            ) : null}
            {hint.since ? <span className={styles.meta}>since {hint.since}</span> : null}
          </div>
        </>
      ) : (
        <KeyHints docsReady={docsReady} />
      )}
    </div>
  );
}
