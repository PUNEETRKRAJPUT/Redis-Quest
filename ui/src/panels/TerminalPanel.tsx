'use client';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import clsx from 'clsx';
import { ChevronDown, Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { play } from '@/design';
import { useQuest } from '../store';
import {
  CompletionPopup,
  optionId,
  POPUP_CHROME,
  POPUP_ID,
  ROW_HEIGHT,
  SyntaxBar,
  type PopupView,
} from '../terminal/Assist';
import { registerTerminal } from '../terminal/bus';
import {
  accept,
  assistFor,
  cursorInfo,
  hintFor,
  moveSelection,
  splitWords,
  type Assist,
  type Hint,
} from '../terminal/complete';
import { docsStore } from '../terminal/docs';
import {
  loadHistory,
  newer,
  older,
  pushHistory,
  saveHistory,
  startWalk,
} from '../terminal/history';
import styles from '../terminal/terminal.module.css';
import { useDocsVersion } from '../terminal/useDocs';
import { promptFor, TargetSwitch, useTarget } from './TargetSwitch';
import { C, colourReply, dangerCard, dangerNote, ESC } from './terminalText';
import type { PanelHeight } from './height';

// The transcript and history outlive the panel so that moving between screens does not wipe the session.
// History also survives a reload (sessionStorage), the transcript does not.
let transcript = '';
let history: string[] = [];
let historyLoaded = false;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const NO_ASSIST: Assist = { kind: 'none' };

interface Ui {
  popup: PopupView | null;
  hint: Hint | null;
  announce: string;
}
const EMPTY_UI: Ui = { popup: null, hint: null, announce: '' };

export function TerminalPanel({ height = 360 }: { height?: PanelHeight }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const clearRef = useRef<() => void>(() => {});
  const pickRef = useRef<(i: number) => void>(() => {});
  const [ui, setUi] = useState<Ui>(EMPTY_UI);
  const [targetOpen, setTargetOpen] = useState(false);
  const info = useTarget((s) => s.info);
  useDocsVersion(); // names and docs arriving re-render the key hints
  const docsReady = docsStore().names() !== null;

  useEffect(() => {
    const el = host.current;
    const vp = viewport.current;
    if (!el || !vp) return;
    if (!historyLoaded) {
      history = loadHistory();
      historyLoaded = true;
    }
    const store = docsStore();
    const tok = (name: string, fallback: string) => cssVar(name, fallback);
    const mono = cssVar('--font-mono', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    const term = new Terminal({
      fontFamily: mono,
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      convertEol: false,
      scrollback: 2000,
      theme: {
        background: tok('--color-night-950', '#070a12'),
        foreground: tok('--color-chalk', '#eef2fa'),
        cursor: tok('--color-flood-500', '#ff9a1f'),
        cursorAccent: tok('--color-night-950', '#070a12'),
        selectionBackground: 'rgba(92, 200, 255, 0.28)',
        black: tok('--color-night-700', '#1a2344'),
        red: tok('--color-wicket', '#ff5468'),
        green: tok('--color-turf', '#2ee281'),
        yellow: tok('--color-flood-400', '#ffb347'),
        blue: tok('--color-sky', '#5cc8ff'),
        magenta: tok('--color-cap-purple', '#b58cff'),
        cyan: tok('--color-sky', '#5cc8ff'),
        white: tok('--color-chalk-dim', '#a9b4cc'),
        brightBlack: tok('--color-chalk-faint', '#6f7b97'),
        brightRed: tok('--color-wicket', '#ff5468'),
        brightGreen: tok('--color-turf', '#2ee281'),
        brightYellow: tok('--color-flood-400', '#ffb347'),
        brightBlue: tok('--color-sky', '#5cc8ff'),
        brightMagenta: tok('--color-cap-purple', '#b58cff'),
        brightCyan: tok('--color-sky', '#5cc8ff'),
        brightWhite: tok('--color-chalk', '#eef2fa'),
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const doFit = () => {
      try {
        fit.fit();
      } catch {
        /* the host is hidden (zero size); the next resize fits it */
      }
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    // The mono face is a lazily loaded web font: measure again once it is there, or the cells are the fallback's.
    let disposed = false;
    void document.fonts
      ?.load(`13px ${mono}`)
      .then(() => {
        if (disposed) return;
        term.options.fontFamily = `${mono}, monospace`;
        doFit();
      })
      .catch(() => {});

    // F-06: with the terminal focused, a press somewhere else makes Chrome scroll the page back to xterm's helper
    // textarea (a pending "reveal the focused editable" that fires on the next pointer press, for example after the
    // window or viewport was resized). The scroll lands before mouseup, so the click hits the wrong element and the
    // stage header or button never fires. Not the scroll anchor and not xterm itself (checked: overflow-anchor and
    // textarea positioning make no difference), so the page scroll is pinned for the length of the press.
    const pinScrollOnOutsidePress = (e: PointerEvent) => {
      const ta = el.querySelector('textarea');
      if (
        !ta ||
        document.activeElement !== ta ||
        (e.target instanceof Node && el.contains(e.target))
      )
        return;
      const x = window.scrollX;
      const y = window.scrollY;
      const pin = () => {
        if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
      };
      const events = ['scroll', 'focusout', 'focusin', 'mouseup', 'pointerup', 'click'] as const;
      const stop = () => {
        for (const n of events) window.removeEventListener(n, pin, true);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      for (const n of events) window.addEventListener(n, pin, true);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      window.setTimeout(stop, 1500);
    };
    window.addEventListener('pointerdown', pinScrollOnOutsidePress, true);

    let prompt = promptFor(useTarget.getState().info);
    let buf = '';
    let cur = 0;
    let busy = false;
    let started = false;
    // Keys typed while a command is in flight (or a pasted block is still running) wait here, like a real
    // terminal's type-ahead, instead of being dropped in the few milliseconds the reply takes.
    let pasting = false;
    const queued: string[] = [];
    const locked = () => busy || pasting;
    let walk = startWalk(history);
    let pendingInsert: string | null = null;

    // ---- what the player is shown while typing -------------------------------------------------------------
    let focused = false;
    let selected = 0;
    let dismissed: string | null = null;
    let itemsKey = '';
    let assist: Assist = NO_ASSIST;
    let visibleCount = 0;

    const geometry = (a: Exclude<Assist, { kind: 'none' }>): PopupView | null => {
      const screen = el.querySelector('.xterm-screen');
      if (!(screen instanceof HTMLElement) || term.cols < 1 || term.rows < 1) return null;
      const sr = screen.getBoundingClientRect();
      const vr = vp.getBoundingClientRect();
      const cellW = sr.width / term.cols;
      const cellH = sr.height / term.rows;
      const col = prompt.length + (a.wordStart - 0);
      const rowTop = sr.top - vr.top + term.buffer.active.cursorY * cellH;
      const above = rowTop - 6;
      const below = vr.height - rowTop - cellH - 6;
      const want = a.items.length * ROW_HEIGHT + POPUP_CHROME;
      const placement: PopupView['placement'] = above >= want || above >= below ? 'above' : 'below';
      const room = placement === 'above' ? above : below;
      const rows = Math.max(
        3,
        Math.min(a.items.length, Math.floor((room - POPUP_CHROME) / ROW_HEIGHT)),
      );
      const width = Math.min(560, Math.max(280, vr.width - 16));
      const left = Math.max(
        8,
        Math.min(sr.left - vr.left + col * cellW - 12, vr.width - width - 8),
      );
      visibleCount = rows;
      return {
        kind: a.kind,
        items: a.items.slice(0, rows),
        selected: Math.min(selected, rows - 1),
        left,
        width,
        edge: placement === 'above' ? vr.height - rowTop + 4 : rowTop + cellH + 4,
        placement,
      };
    };

    const commit = () => {
      store.ensureNames();
      const first = splitWords(buf)[0]?.text.toLowerCase();
      if (first && store.has(first)) store.want([first]);
      const doc = (n: string) => store.doc(n);
      assist =
        busy || !focused
          ? NO_ASSIST
          : assistFor({ line: buf, cursor: cur, names: store.names(), doc, dismissed });
      if (assist.kind === 'commands') store.want(assist.items.map((i) => i.name));
      const key =
        assist.kind === 'none' ? '' : `${assist.kind}:${assist.items.map((i) => i.name).join()}`;
      if (key !== itemsKey) {
        itemsKey = key;
        selected = 0;
      }
      const popup = assist.kind === 'none' ? null : geometry(assist);
      const hint = busy ? null : hintFor(buf, cur, doc);
      const sel = popup?.items[popup.selected];
      setUi({
        popup,
        hint,
        announce: popup
          ? `${popup.items.length} suggestions. ${sel ? `${sel.word}${sel.summary ? `: ${sel.summary}` : ''}` : ''}`
          : '',
      });
    };

    const unsubscribeDocs = store.subscribe(commit);

    const out = (s: string) => {
      transcript += s;
      if (transcript.length > 60000) transcript = transcript.slice(-40000);
      term.write(s);
    };
    const redraw = () => {
      // Not saved in the transcript: a prompt line is rebuilt, not replayed.
      term.write(
        `\r${ESC}2K${C.bold}${prompt}${C.off}${buf}${cur < buf.length ? `${ESC}${buf.length - cur}D` : ''}`,
        commit,
      );
    };
    const showPrompt = () => {
      buf = '';
      cur = 0;
      walk = startWalk(history);
      dismissed = null;
      if (pendingInsert !== null) {
        const t = pendingInsert;
        pendingInsert = null;
        buf = t;
        cur = t.length;
      }
      redraw();
    };

    // The prompt says where the terminal is connected, and follows a switch made in the header above.
    const applyPrompt = () => {
      prompt = promptFor(useTarget.getState().info);
      if (started && !busy) redraw();
    };
    void useTarget.getState().refresh();
    const offTarget = useTarget.subscribe((s, prev) => {
      if (s.info && promptFor(s.info) !== promptFor(prev.info)) applyPrompt();
    });
    // The stack came back: ask again for the names and docs that could not be had while Redis was down.
    const offQuest = useQuest.subscribe((s, prev) => {
      if (s.redisUp && !prev.redisUp) {
        store.retryNow();
        commit();
      }
    });

    if (transcript) term.write(transcript);
    else
      out(
        `${C.dim}Redis terminal. It talks to the same Redis your app uses. Type HELP, or just start.${C.off}\r\n`,
      );
    started = true;
    showPrompt();

    const clearScreen = () => {
      transcript = '';
      term.write(`${ESC}2J${ESC}H`);
    };

    const run = async (line: string) => {
      const text = line.trim();
      out(`\r${ESC}2K${C.bold}${prompt}${C.off}${line}\r\n`);
      if (!text) return showPrompt();
      if (history[history.length - 1] !== text) {
        history = pushHistory(history, text);
        saveHistory(history);
      }
      if (/^clear$/i.test(text)) {
        clearScreen();
        return showPrompt();
      }
      if (/^help$/i.test(text)) {
        out(
          `${C.dim}Type any Redis command, for example PING, SET greeting hi, GET greeting.\r\nUp and down arrows walk your history. clear wipes the screen.${
            store.names() ? '\r\nTab accepts a suggestion, Esc closes the list.' : ''
          }${C.off}\r\n`,
        );
        return showPrompt();
      }
      const note = dangerNote(text);
      if (note) {
        out(`${dangerCard(text.split(/\s+/)[0] ?? '', note, term.cols)}\r\n`);
        play('pager');
      }
      busy = true;
      commit();
      try {
        out(`${colourReply(await api.cli(text))}\r\n`);
      } catch (e) {
        out(`${C.red}(error) ${e instanceof Error ? e.message : String(e)}${C.off}\r\n`);
      }
      busy = false;
      showPrompt();
      drain();
    };

    // ---- the popup's keys ----------------------------------------------------------------------------------
    const popupOpen = () => assist.kind !== 'none' && visibleCount > 0;
    const move = (delta: number) => {
      selected = moveSelection(
        Math.min(visibleCount, assist.kind === 'none' ? 0 : assist.items.length),
        selected,
        delta,
      );
      play('tick');
      commit();
    };
    const acceptAt = (index: number) => {
      if (assist.kind === 'none') return;
      const item = assist.items[index];
      if (!item) return;
      const r = accept(buf, cur, item);
      buf = r.line;
      cur = r.cursor;
      dismissed = null;
      play('tick');
      redraw();
    };
    pickRef.current = (i) => {
      acceptAt(i);
      term.focus();
    };

    // The popup must never take a key meant for the line: only these four are claimed, and only while it is open.
    // Enter is not one of them (it always sends what is typed), nor is any printable key (typing keeps filtering).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || e.isComposing) return true;
      if (e.ctrlKey || e.metaKey || e.altKey) return true;
      if (popupOpen()) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            move(1);
            return false;
          case 'ArrowUp':
            e.preventDefault();
            move(-1);
            return false;
          case 'Tab':
            e.preventDefault();
            if (e.shiftKey) move(-1);
            else acceptAt(selected);
            return false;
          case 'Escape': {
            e.preventDefault();
            dismissed = cursorInfo(buf, cur).prefix;
            commit();
            return false;
          }
        }
      } else if (e.key === 'Tab') {
        // No popup: Tab is not a command key here, so it keeps its page job and moves focus on (no keyboard trap).
        return false;
      }
      return true;
    });

    const insert = (text: string) => {
      const t = text.replace(/[\r\n]+/g, ' ').trim();
      if (!t) return;
      if (busy) {
        pendingInsert = t;
        return;
      }
      buf = t;
      cur = t.length;
      walk = startWalk(history);
      dismissed = cursorInfo(buf, cur).prefix;
      term.focus();
      redraw();
    };
    const offBus = registerTerminal(insert);

    const onFocus = () => {
      focused = true;
      commit();
    };
    const onBlur = () => {
      focused = false;
      commit();
    };
    const ta = term.textarea;
    ta?.addEventListener('focus', onFocus);
    ta?.addEventListener('blur', onBlur);
    if (ta && document.activeElement === ta) focused = true;

    clearRef.current = () => {
      clearScreen();
      showPrompt();
      term.focus();
    };

    const handle = (data: string) => {
      if (data.length > 1 && !data.startsWith(ESC) && /[\r\n]/.test(data)) {
        // A paste with line breaks: run each line in order.
        const lines = data.split(/\r\n|\r|\n/);
        pasting = true;
        void (async () => {
          for (let i = 0; i < lines.length; i++) {
            buf = buf.slice(0, cur) + (lines[i] as string) + buf.slice(cur);
            cur = buf.length;
            if (i < lines.length - 1) {
              const l = buf;
              buf = '';
              cur = 0;
              await run(l);
            }
          }
          pasting = false;
          redraw();
          drain();
        })();
        return;
      }
      switch (data) {
        case '\r': {
          const l = buf;
          buf = '';
          cur = 0;
          void run(l);
          return;
        }
        case '\x7f':
          if (cur > 0) {
            buf = buf.slice(0, cur - 1) + buf.slice(cur);
            cur--;
            redraw();
          }
          return;
        case `${ESC}3~`:
          buf = buf.slice(0, cur) + buf.slice(cur + 1);
          redraw();
          return;
        case `${ESC}A`: {
          const r = older(history, walk, buf);
          if (r) {
            walk = r.walk;
            buf = r.text;
            cur = buf.length;
            dismissed = cursorInfo(buf, cur).prefix;
            redraw();
          }
          return;
        }
        case `${ESC}B`: {
          const r = newer(history, walk);
          if (r) {
            walk = r.walk;
            buf = r.text;
            cur = buf.length;
            dismissed = cursorInfo(buf, cur).prefix;
            redraw();
          }
          return;
        }
        case `${ESC}D`:
          if (cur > 0) {
            cur--;
            redraw();
          }
          return;
        case `${ESC}C`:
          if (cur < buf.length) {
            cur++;
            redraw();
          }
          return;
        case '\x01':
        case `${ESC}H`:
          cur = 0;
          redraw();
          return;
        case '\x05':
        case `${ESC}F`:
          cur = buf.length;
          redraw();
          return;
        case '\x15':
          buf = buf.slice(cur);
          cur = 0;
          redraw();
          return;
        case '\x03':
          out(`${buf}^C\r\n`);
          showPrompt();
          return;
        case '\x0c':
          term.write(`${ESC}2J${ESC}H`);
          redraw();
          return;
        default:
          if (data >= ' ' && !data.startsWith(ESC)) {
            buf = buf.slice(0, cur) + data + buf.slice(cur);
            cur += data.length;
            redraw();
          }
      }
    };
    function drain() {
      while (queued.length > 0 && !locked()) handle(queued.shift() as string);
    }
    const sub = term.onData((data) => {
      if (locked()) queued.push(data);
      else handle(data);
    });

    return () => {
      disposed = true;
      window.removeEventListener('pointerdown', pinScrollOnOutsidePress, true);
      offTarget();
      offQuest();
      offBus();
      unsubscribeDocs();
      ta?.removeEventListener('focus', onFocus);
      ta?.removeEventListener('blur', onBlur);
      sub.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // The terminal's own textarea keeps focus; tell assistive technology about the list next to it.
  const open = ui.popup !== null;
  const activeIndex = ui.popup?.selected ?? -1;
  useEffect(() => {
    const ta = host.current?.querySelector('textarea');
    if (!ta) return;
    ta.setAttribute('aria-autocomplete', 'list');
    ta.setAttribute('aria-expanded', String(open));
    if (open) {
      ta.setAttribute('aria-controls', POPUP_ID);
      ta.setAttribute('aria-activedescendant', optionId(activeIndex));
    } else {
      ta.removeAttribute('aria-controls');
      ta.removeAttribute('aria-activedescendant');
    }
  }, [open, activeIndex]);

  const up = info?.state === 'up';
  const where = info ? promptFor(info).replace(/>\s*$/, '') : 'connecting';
  const fill = height === 'fill';

  return (
    <div data-ds="" className={clsx(styles.root, fill && styles.rootFill)}>
      <div className={styles.frame} data-testid="terminal-frame">
        <div className={styles.bar}>
          <span
            className={styles.light}
            data-testid="terminal-light"
            data-state={info ? (up ? 'up' : 'down') : 'unknown'}
            role="img"
            aria-label={info ? (up ? 'connected' : 'not connected') : 'connecting'}
          />
          <span className={styles.title}>Terminal</span>
          <button
            type="button"
            className={styles.targetBtn}
            data-testid="terminal-target-toggle"
            aria-expanded={targetOpen}
            aria-controls="terminal-target"
            title={
              info ? `${info.description}. Change the Redis target.` : 'Change the Redis target'
            }
            onClick={() => setTargetOpen((o) => !o)}
          >
            <span>{where}</span>
            <ChevronDown size={14} aria-hidden />
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.barBtn}
            aria-label="Clear terminal"
            title="Clear (Ctrl+L)"
            onClick={() => clearRef.current()}
          >
            <Eraser size={15} aria-hidden />
          </button>
        </div>
        {/* Mounted while closed: it also keeps the target fresh for the prompt (failovers change the master). */}
        <div id="terminal-target" className={styles.targetRegion} hidden={!targetOpen}>
          <TargetSwitch />
        </div>
        <div
          ref={viewport}
          className={styles.viewport}
          style={fill ? undefined : { flex: '0 0 auto', height }}
          onClick={() => termRef.current?.focus()}
        >
          <div
            ref={host}
            className={styles.term}
            data-testid="terminal"
            role="group"
            aria-label="Redis terminal. Click, then type a command and press Enter."
          />
          {ui.popup ? <CompletionPopup view={ui.popup} onPick={(i) => pickRef.current(i)} /> : null}
        </div>
        <SyntaxBar hint={ui.hint} docsReady={docsReady} />
        <div className={styles.live} aria-live="polite" role="status">
          {ui.announce}
        </div>
      </div>
    </div>
  );
}
