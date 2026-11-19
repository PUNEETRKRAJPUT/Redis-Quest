'use client';

import Editor, { loader } from '@monaco-editor/react';
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

export default function MonacoEditor({
  value,
  language,
  onChange,
  onSave,
  readOnly = false,
  height = '100%',
}: {
  value: string;
  language: string;
  onChange: (v: string) => void;
  onSave: () => void;
  readOnly?: boolean;
  height?: string;
}) {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return (
    <Editor
      height={height}
      language={language}
      value={value}
      theme={dark ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange(v ?? '')}
      onMount={(ed) => {
        ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        readOnly,
        ariaLabel: readOnly ? 'Reference solution (read only)' : 'Code editor',
      }}
      loading={<p className="muted pad">Loading the editor...</p>}
    />
  );
}
