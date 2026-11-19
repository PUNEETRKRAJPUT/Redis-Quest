'use client';

import { clsx } from 'clsx';
import {
  Check,
  CircleAlert,
  File as FileIcon,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  SquareTerminal,
  X,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api';
import { Button, Dialog, IconButton, Kbd, Skeleton, toast, Tooltip } from '../design';
import type { WorkspaceEntry } from '../types';
import { cssHeight, type PanelHeight } from './height';

const MonacoEditor = lazy(() => import('./MonacoEditor'));

export function langOf(path: string): string {
  if (/\.(m?js)$/.test(path)) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.sh')) return 'shell';
  if (path.endsWith('.redis')) return 'redis';
  if (path.endsWith('.yaml')) return 'yaml';
  return 'plaintext';
}

const LANG_LABEL: Record<string, string> = {
  javascript: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  shell: 'Shell',
  redis: 'Redis',
  yaml: 'YAML',
  plaintext: 'Plain text',
};

function iconFor(path: string, size = 15): ReactNode {
  const lang = langOf(path);
  if (lang === 'javascript') return <FileCode2 size={size} aria-hidden />;
  if (lang === 'json' || lang === 'yaml') return <FileJson size={size} aria-hidden />;
  if (lang === 'markdown') return <FileText size={size} aria-hidden />;
  if (lang === 'shell' || lang === 'redis') return <SquareTerminal size={size} aria-hidden />;
  return <FileIcon size={size} aria-hidden />;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Files grouped by their folder, the workspace root first, in the order the engine listed them. */
export function groupFiles(files: WorkspaceEntry[]): { dir: string; files: WorkspaceEntry[] }[] {
  const groups = new Map<string, WorkspaceEntry[]>();
  for (const f of files) {
    const d = dirName(f.path);
    groups.set(d, [...(groups.get(d) ?? []), f]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : 0))
    .map(([dir, list]) => ({ dir, files: list }));
}

interface Buffer {
  saved: string;
  text: string;
}

export function EditorPanel({ chapter, height = 420 }: { chapter?: string; height?: PanelHeight }) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  // null = automatic: inside a level (a chapter is given) the file list folds away once the level's own file is
  // open, so the code gets the width; on the /editor page it stays open. A click makes it the player's choice.
  const [filesShown, setFilesShown] = useState<boolean | null>(null);

  const files = useMemo(() => (entries ?? []).filter((e) => e.type === 'file'), [entries]);
  const groups = useMemo(() => groupFiles(files), [files]);
  const filesId = useId();

  useEffect(() => {
    api
      .tree()
      .then((t) => setEntries(t.entries))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /** Opens a file in its tab. A file with unsaved edits keeps them; a clean one is re-read from disk. */
  const open = useCallback(async (p: string) => {
    try {
      const f = await api.readFile(p);
      setBuffers((b) => {
        const have = b[p];
        if (have && have.text !== have.saved) return b;
        return { ...b, [p]: { saved: f.content, text: f.content } };
      });
      setTabs((t) => (t.includes(p) ? t : [...t, p]));
      setPath(p);
      setNote(null);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!path && tabs.length === 0 && files.length) {
      const mine = chapter
        ? files.find((f) => f.path.startsWith(`${chapter}/`) && f.editable !== false)
        : undefined;
      void open(
        (mine ?? files.find((f) => f.editable !== false && !f.path.startsWith('_')) ?? files[0])
          ?.path ?? '',
      );
    }
  }, [files, chapter, path, tabs.length, open]);

  const buf = path ? buffers[path] : undefined;
  const text = buf?.text ?? '';
  const dirty = buf ? buf.text !== buf.saved : false;
  const isDirty = useCallback(
    (p: string) => {
      const b = buffers[p];
      return b ? b.text !== b.saved : false;
    },
    [buffers],
  );

  const save = useCallback(async () => {
    if (!path || !buf) return;
    const body = buf.text;
    setSaving(true);
    try {
      await api.writeFile(path, body);
      setBuffers((b) => (b[path] ? { ...b, [path]: { ...b[path], saved: body } } : b));
      setNote(`Saved ${path}`);
      setPulse((n) => n + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNote(message);
      toast.error(`Could not save ${path}`, message);
    } finally {
      setSaving(false);
    }
  }, [path, buf]);

  const closeTab = useCallback(
    (p: string) => {
      setTabs((t) => {
        const i = t.indexOf(p);
        const next = t.filter((x) => x !== p);
        if (p === path) setPath(next[Math.min(i, next.length - 1)] ?? null);
        return next;
      });
      setBuffers((b) => {
        const { [p]: _gone, ...rest } = b;
        void _gone;
        return rest;
      });
    },
    [path],
  );
  const requestClose = (p: string) => (isDirty(p) ? setClosing(p) : closeTab(p));

  // Cmd+S / Ctrl+S anywhere in the panel (the editor binds its own): never the browser's "Save page".
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) void save();
    }
  };

  if (error)
    return (
      <div
        data-ds=""
        role="alert"
        className="flex items-center gap-3 rounded-lg border border-wicket/40 bg-wicket/10 px-4 py-3 text-md text-chalk"
      >
        <CircleAlert size={18} className="shrink-0 text-wicket" aria-hidden />
        <p>Could not read the workspace: {error}</p>
      </div>
    );
  if (!entries)
    return (
      <div
        data-ds=""
        className="rounded-lg border border-night-600 bg-night-900 p-5"
        style={{ height: cssHeight(height) }}
      >
        <p className="mb-4 font-mono text-sm text-chalk-dim">Loading the workspace...</p>
        <Skeleton lines={6} label="Loading the workspace" />
      </div>
    );

  // Inside a level it starts folded (no shift while the level's file loads) and opens only if what got opened
  // is not the level's own file.
  const showFiles =
    filesShown ?? (chapter ? path !== null && !path.startsWith(`${chapter}/`) : true);
  const editable = path ? (files.find((f) => f.path === path)?.editable ?? true) : true;
  const lang = path ? langOf(path) : 'plaintext';
  const status = dirty ? (
    <span className="inline-flex items-center gap-1.5 text-flood-400">
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-flood-500 shadow-[0_0_8px_rgb(255_154_31/0.9)]"
      />
      unsaved changes
    </span>
  ) : note ? (
    <span
      key={pulse}
      className={clsx(
        'inline-flex items-center gap-1.5',
        note.startsWith('Saved ') ? 'text-turf' : 'text-wicket',
        note.startsWith('Saved ') &&
          'motion-safe:animate-[live_0.9s_var(--ease-in-out)_1] ds-still',
      )}
    >
      {note.startsWith('Saved ') ? (
        <Check size={14} aria-hidden />
      ) : (
        <CircleAlert size={14} aria-hidden />
      )}
      {note}
    </span>
  ) : null;

  return (
    <div
      data-ds=""
      data-testid="editor-panel"
      onKeyDown={onKeyDown}
      className="flex overflow-hidden rounded-lg border border-night-600 bg-night-900 shadow-raise"
      style={{ height: cssHeight(height) }}
    >
      <nav
        id={filesId}
        aria-label="Workspace files"
        data-testid="editor-files"
        hidden={!showFiles}
        className={clsx(
          'w-60 shrink-0 flex-col overflow-y-auto border-r border-night-600/70 bg-night-950/60 py-3',
          showFiles ? 'hidden md:flex' : 'hidden',
        )}
      >
        {files.length === 0 ? (
          <p className="px-4 text-sm text-chalk-dim">workspace/ is empty.</p>
        ) : null}
        {groups.map((g) => (
          <div key={g.dir || '.'} className="mb-3 last:mb-0">
            <div className="label-caps flex items-center gap-1.5 px-4 pb-1.5 text-[11px] text-chalk-dim">
              <Folder size={12} aria-hidden />
              <span className="truncate">{g.dir || 'workspace'}</span>
            </div>
            <ul>
              {g.files.map((f) => {
                const on = f.path === path;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      data-testid="editor-file"
                      onClick={() => void open(f.path)}
                      aria-current={on}
                      title={f.path}
                      className={clsx(
                        'group relative flex h-8 w-full cursor-pointer items-center gap-2 px-4 text-left font-mono text-sm transition-colors duration-fast',
                        on
                          ? 'bg-night-800 text-chalk'
                          : 'text-chalk-dim hover:bg-night-800/60 hover:text-chalk',
                      )}
                    >
                      {on && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-flood-500 shadow-[0_0_10px_rgb(255_154_31/0.8)]"
                        />
                      )}
                      <span className={on ? 'text-flood-400' : 'text-chalk-faint'}>
                        {iconFor(f.path)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{baseName(f.path)}</span>
                      {isDirty(f.path) && (
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-flood-500" />
                      )}
                      {f.editable === false && (
                        <Lock
                          size={12}
                          className="shrink-0 text-chalk-faint"
                          aria-label="read only"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          role="tablist"
          aria-label="Open files"
          className="flex h-10 shrink-0 items-end gap-px overflow-x-auto border-b border-night-600/70 bg-night-950/40 px-2"
        >
          {tabs.map((p) => {
            const on = p === path;
            return (
              <div
                key={p}
                className={clsx(
                  'group relative flex h-9 shrink-0 items-center rounded-t-sm border border-b-0 transition-colors duration-fast',
                  on
                    ? 'border-night-600/80 bg-night-900 text-chalk'
                    : 'border-transparent text-chalk-dim hover:bg-night-800/50 hover:text-chalk',
                )}
              >
                {on && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -top-px h-[2px] rounded-full bg-flood-500 shadow-[0_0_10px_rgb(255_154_31/0.7)]"
                  />
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => void open(p)}
                  title={p}
                  className="flex h-full cursor-pointer items-center gap-2 pl-3 pr-1 font-mono text-sm"
                >
                  <span className={on ? 'text-flood-400' : 'text-chalk-faint'}>
                    {iconFor(p, 14)}
                  </span>
                  <span className="max-w-40 truncate">{baseName(p)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${p}`}
                  onClick={() => requestClose(p)}
                  className="mr-1.5 grid size-5 cursor-pointer place-items-center rounded-xs text-chalk-faint transition-colors duration-fast hover:bg-night-700 hover:text-chalk"
                >
                  {isDirty(p) ? (
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-flood-500 group-hover:hidden"
                    />
                  ) : null}
                  <X
                    size={12}
                    aria-hidden
                    className={isDirty(p) ? 'hidden group-hover:block' : ''}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <div
          data-testid="editor-bar"
          className="flex min-h-12 shrink-0 items-center gap-3 border-b border-night-600/70 py-2 pl-2 pr-4"
        >
          <IconButton
            size="sm"
            label={showFiles ? 'Hide the file list' : 'Show the file list'}
            icon={
              showFiles ? (
                <PanelLeftClose size={15} aria-hidden />
              ) : (
                <PanelLeftOpen size={15} aria-hidden />
              )
            }
            aria-expanded={showFiles}
            aria-controls={filesId}
            data-testid="editor-files-toggle"
            onClick={() => setFilesShown(!showFiles)}
          />
          <code className="min-w-0 truncate font-mono text-sm text-chalk">
            {path ? `workspace/${path}` : 'no file open'}
          </code>
          {!editable && (
            <span className="label-caps inline-flex items-center gap-1 text-[11px] text-chalk-dim">
              <Lock size={11} aria-hidden /> read only
            </span>
          )}
          <span
            role="status"
            aria-live="polite"
            data-testid="editor-status"
            className="ml-auto min-w-0 truncate text-sm text-chalk-dim"
          >
            {status}
          </span>
          <Tooltip content="Save" shortcut="⌘S" side="bottom" describe={false}>
            <Button
              size="sm"
              variant={dirty ? 'primary' : 'ghost'}
              onClick={() => void save()}
              disabled={!path || !dirty}
              loading={saving}
            >
              Save
            </Button>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 bg-night-900" data-testid="editor-host">
          {path && buf ? (
            <Suspense
              fallback={
                <p className="px-4 py-3 font-mono text-sm text-chalk-dim" role="status">
                  Loading the editor...
                </p>
              }
            >
              <MonacoEditor
                value={text}
                path={`workspace/${path}`}
                language={lang}
                readOnly={!editable}
                onChange={(v) =>
                  setBuffers((b) => (b[path] ? { ...b, [path]: { ...b[path], text: v } } : b))
                }
                onSave={() => void save()}
                onCursor={(line, col) => setCursor({ line, col })}
              />
            </Suspense>
          ) : (
            <p className="px-5 py-4 text-md text-chalk-dim">Pick a file on the left.</p>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-night-600/70 bg-night-950/50 px-4 py-2 text-xs text-chalk-dim">
          <p className="min-w-0 flex-1 truncate">
            Prefer your own editor? Open the same file in VS Code:{' '}
            <code className="font-mono text-chalk">code workspace/{path ?? '<file>'}</code>. The
            game reads what is on disk.
          </p>
          {path ? (
            <span className="tabular flex shrink-0 items-center gap-3 font-mono">
              {cursor ? (
                <span>
                  Ln {cursor.line}, Col {cursor.col}
                </span>
              ) : null}
              <span>{LANG_LABEL[lang] ?? lang}</span>
              <span className="hidden items-center gap-1 lg:inline-flex">
                <Kbd size="sm">⌘</Kbd>
                <Kbd size="sm">S</Kbd> saves
              </span>
            </span>
          ) : null}
        </footer>
      </div>

      <Dialog
        open={closing !== null}
        onClose={() => setClosing(null)}
        title="Close with unsaved changes?"
        description={closing ? `${closing} has edits that are not saved yet.` : undefined}
        size="sm"
        tone="danger"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setClosing(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (closing) closeTab(closing);
                setClosing(null);
              }}
            >
              Discard changes
            </Button>
          </>
        }
      />
    </div>
  );
}
