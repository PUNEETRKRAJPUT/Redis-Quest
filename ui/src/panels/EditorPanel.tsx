import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import type { WorkspaceEntry } from '../types';

const MonacoEditor = lazy(() => import('./MonacoEditor'));

function langOf(path: string): string {
  if (/\.(m?js)$/.test(path)) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.sh')) return 'shell';
  if (path.endsWith('.redis')) return 'redis';
  if (path.endsWith('.yaml')) return 'yaml';
  return 'plaintext';
}

export function EditorPanel({ chapter, height = 420 }: { chapter?: string; height?: number }) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const files = useMemo(() => (entries ?? []).filter((e) => e.type === 'file'), [entries]);

  useEffect(() => {
    api.tree().then((t) => setEntries(t.entries)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const open = useCallback(async (p: string) => {
    try {
      const f = await api.readFile(p);
      setPath(p);
      setSaved(f.content);
      setText(f.content);
      setNote(null);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!path && files.length) {
      const mine = chapter ? files.find((f) => f.path.startsWith(`${chapter}/`) && f.editable !== false) : undefined;
      void open((mine ?? files.find((f) => f.editable !== false && !f.path.startsWith('_')) ?? files[0])?.path ?? '');
    }
  }, [files, chapter, path, open]);

  const save = useCallback(async () => {
    if (!path) return;
    try {
      await api.writeFile(path, text);
      setSaved(text);
      setNote(`Saved ${path}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }, [path, text]);

  if (error) return <p className="callout warn">Could not read the workspace: {error}</p>;
  if (!entries) return <p className="muted pad">Loading the workspace...</p>;
  const dirty = text !== saved;
  return (
    <div className="editor-panel" style={{ height }}>
      <nav className="filelist" aria-label="Workspace files">
        {files.length === 0 ? <p className="muted pad">workspace/ is empty.</p> : null}
        {files.map((f) => (
          <button key={f.path} type="button" className={f.path === path ? 'file active' : 'file'} onClick={() => void open(f.path)} aria-current={f.path === path}>
            {f.path}
          </button>
        ))}
      </nav>
      <div className="editor-main">
        <div className="editor-bar">
          <code>{path ? `workspace/${path}` : 'no file open'}</code>
          <span className="muted">{dirty ? 'unsaved changes' : note ?? ''}</span>
          <button type="button" className="btn small" onClick={() => void save()} disabled={!path || !dirty}>Save</button>
        </div>
        <div className="editor-host">
          {path ? (
            <Suspense fallback={<p className="muted pad">Loading the editor...</p>}>
              <MonacoEditor value={text} language={langOf(path)} onChange={setText} onSave={() => void save()} />
            </Suspense>
          ) : (
            <p className="muted pad">Pick a file on the left.</p>
          )}
        </div>
        <p className="muted editor-foot">
          Prefer your own editor? Open the same file in VS Code: <code>code workspace/{path ?? '<file>'}</code>. The game reads what is on disk.
        </p>
      </div>
    </div>
  );
}
