'use client';

import Editor, { loader } from '@monaco-editor/react';
import { useEffect, useMemo, useRef } from 'react';
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/redis/register';
import 'monaco-editor/languages/definitions/shell/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/indentation/browser/indentation';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
// The suggest widget (no language service behind it): the completion provider below is the only source.
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import { isReducedMotionNow } from '../design/motion';
import { registerClientCompletion } from '../editor/register';
import { monoFontStack, nightTheme, THEME_NAME } from '../career/tools/monacoTheme';

// Bundle Monaco instead of letting the loader fetch it from a CDN: the game must work offline. The bundler turns
// `new Worker(new URL(..., import.meta.url))` into a worker chunk of its own (Turbopack and Vite both understand
// this form; Vite's `?worker` suffix does not exist under Next). This module only ever loads in the browser: the
// panels import it lazily and render only after the shell has booted on the client.
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () =>
    new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
      type: 'module',
      name: 'monaco-editor',
    }),
};
loader.config({ monaco });

// The night theme (literal hex values from the design tokens; Monaco cannot read CSS variables). Defined once at
// module load, which only ever happens in the browser.
monaco.editor.defineTheme(THEME_NAME, nightTheme);

// Completion for `redis.`, `redis.multi().`, `db.` and `log.` from the generated client members. Registered once
// per page, even when hot reload runs this module again.
const registered = self as unknown as { __questClientCompletion?: boolean };
if (!registered.__questClientCompletion) {
  registered.__questClientCompletion = true;
  registerClientCompletion(monaco);
}

export default function MonacoEditor({
  value,
  language,
  onChange,
  onSave,
  readOnly = false,
  height = '100%',
  path,
  onCursor,
}: {
  value: string;
  language: string;
  onChange: (v: string) => void;
  onSave: () => void;
  readOnly?: boolean;
  height?: string;
  /** A model per path keeps each file's undo history and scroll position when the tabs switch. */
  path?: string;
  onCursor?: (line: number, column: number) => void;
}) {
  // The editor binds Cmd+S once, at mount: go through a ref so it always saves what is on screen now.
  const saveRef = useRef(onSave);
  const cursorRef = useRef(onCursor);
  useEffect(() => {
    saveRef.current = onSave;
    cursorRef.current = onCursor;
  }, [onSave, onCursor]);

  // The `value` prop is controlled, and a render that lags behind fast typing would hand the editor an older text
  // than it holds, which the wrapper applies as an edit (dropped and doubled characters). So the editor is only
  // given a new `value` when the text changed from outside (a file opened, reloaded); an echo of its own last
  // edit keeps the previous prop, which the wrapper ignores.
  const sync = useRef<{ path: string | undefined; shown: string; emitted: string | null }>({
    path,
    shown: value,
    emitted: null,
  });
  if (sync.current.path !== path) sync.current = { path, shown: value, emitted: null };
  else if (value !== sync.current.emitted) sync.current.shown = value;
  const shown = sync.current.shown;

  // `options` identity triggers updateOptions on every render: build it once per readOnly change.
  const options = useMemo(() => {
    const mono = getComputedStyle(document.documentElement).getPropertyValue(
      '--font-jetbrains-mono',
    );
    return {
      minimap: { enabled: false },
      fontFamily: monoFontStack(mono),
      fontSize: 13,
      lineHeight: 21,
      fontLigatures: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      readOnly,
      padding: { top: 14, bottom: 14 },
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 10,
      glyphMargin: false,
      folding: false,
      renderLineHighlight: 'line' as const,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      cursorBlinking: isReducedMotionNow() ? ('solid' as const) : ('smooth' as const),
      cursorSmoothCaretAnimation: isReducedMotionNow() ? ('off' as const) : ('on' as const),
      smoothScrolling: !isReducedMotionNow(),
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      guides: { indentation: true, bracketPairs: false },
      // Only the Redis client's members are offered (no words from the file next to them).
      suggest: { showWords: false },
      ariaLabel: readOnly ? 'Reference solution (read only)' : 'Code editor',
    };
  }, [readOnly]);

  return (
    <Editor
      height={height}
      language={language}
      path={path}
      value={shown}
      theme={THEME_NAME}
      onChange={(v) => {
        sync.current.emitted = v ?? '';
        onChange(v ?? '');
      }}
      onMount={(ed) => {
        ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
        ed.onDidChangeCursorPosition((e) =>
          cursorRef.current?.(e.position.lineNumber, e.position.column),
        );
        // Monaco measures glyphs once: if the self-hosted mono font finishes loading after that, re-measure so
        // the cursor and selections line up with the text.
        void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
      }}
      options={options}
      loading={
        <p className="px-4 py-3 font-mono text-sm text-chalk-dim" role="status">
          Loading the editor...
        </p>
      }
    />
  );
}
