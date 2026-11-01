import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { api } from '../api';
import { C, colourReply, dangerNote, ESC } from './terminalText';

// The transcript and history outlive the panel so that moving between screens does not wipe the session.
let transcript = '';
const history: string[] = [];

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function TerminalPanel({ height = 360 }: { height?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      convertEol: false,
      scrollback: 2000,
      theme: { background: cssVar('--term-bg', '#12100d'), foreground: cssVar('--term-fg', '#eee7da'), cursor: cssVar('--accent', '#f59a3c') },
    });
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

    let prompt = 'redis> ';
    let buf = '';
    let cur = 0;
    let busy = false;
    let hIdx = history.length;
    let draft = '';

    const out = (s: string) => {
      transcript += s;
      if (transcript.length > 60000) transcript = transcript.slice(-40000);
      term.write(s);
    };
    const redraw = () => {
      // Not saved in the transcript: a prompt line is rebuilt, not replayed.
      term.write(`\r${ESC}2K${C.bold}${prompt}${C.off}${buf}`);
      if (cur < buf.length) term.write(`${ESC}${buf.length - cur}D`);
    };
    const showPrompt = () => {
      buf = '';
      cur = 0;
      hIdx = history.length;
      redraw();
    };

    void api.target().then((t) => {
      try {
        const u = new URL(t.redisUrl);
        prompt = `${u.hostname}:${u.port || '6379'}> `;
        if (!busy) redraw();
      } catch {
        /* keep the default prompt */
      }
    }).catch(() => undefined);

    if (transcript) term.write(transcript);
    else out(`${C.dim}Redis terminal. It talks to the same Redis your app uses. Type HELP, or just start.${C.off}\r\n`);
    showPrompt();

    const run = async (line: string) => {
      const text = line.trim();
      out(`\r${ESC}2K${C.bold}${prompt}${C.off}${line}\r\n`);
      if (!text) return showPrompt();
      if (history[history.length - 1] !== text) history.push(text);
      if (/^clear$/i.test(text)) {
        transcript = '';
        term.write(`${ESC}2J${ESC}H`);
        return showPrompt();
      }
      if (/^help$/i.test(text)) {
        out(`${C.dim}Type any Redis command, for example PING, SET greeting hi, GET greeting.\r\nUp and down arrows walk your history. clear wipes the screen.${C.off}\r\n`);
        return showPrompt();
      }
      const note = dangerNote(text);
      if (note) out(`${C.yellow}[warning] ${note}${C.off}\r\n`);
      busy = true;
      try {
        out(`${colourReply(await api.cli(text))}\r\n`);
      } catch (e) {
        out(`${C.red}(error) ${e instanceof Error ? e.message : String(e)}${C.off}\r\n`);
      }
      busy = false;
      showPrompt();
    };

    const sub = term.onData((data) => {
      if (busy) return;
      if (data.length > 1 && !data.startsWith(ESC) && /[\r\n]/.test(data)) {
        // A paste with line breaks: run each line in order.
        const lines = data.split(/\r\n|\r|\n/);
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
          redraw();
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
        case `${ESC}A`:
          if (hIdx > 0) {
            if (hIdx === history.length) draft = buf;
            hIdx--;
            buf = history[hIdx] ?? '';
            cur = buf.length;
            redraw();
          }
          return;
        case `${ESC}B`:
          if (hIdx < history.length) {
            hIdx++;
            buf = hIdx === history.length ? draft : (history[hIdx] ?? '');
            cur = buf.length;
            redraw();
          }
          return;
        case `${ESC}D`:
          if (cur > 0) { cur--; redraw(); }
          return;
        case `${ESC}C`:
          if (cur < buf.length) { cur++; redraw(); }
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
    });

    return () => {
      sub.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="terminal-wrap" style={{ height }}>
      <div ref={host} className="terminal" data-testid="terminal" role="group" aria-label="Redis terminal. Click, then type a command and press Enter." />
    </div>
  );
}
