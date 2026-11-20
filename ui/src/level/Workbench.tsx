'use client';
// The workspace pane: the tools next to a level. Only the one the level's mode needs is open at first; clicking the
// open tab closes it again (the pane then shows the mode's idle card). A code level opens the editor with the
// terminal docked under it. A decision level's answer sheet is the first tab.
import { clsx } from 'clsx';
import { Activity, Code, ListChecks, ScrollText, Smartphone, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { paneStorage } from '../match/layout';
import { EditorPanel } from '../panels/EditorPanel';
import { PhoneScreen } from '../features/phone/PhoneScreen';
import { LogsPanel } from '../panels/LogsPanel';
import { MetricsPanel } from '../panels/MetricsPanel';
import { TerminalPanel } from '../panels/TerminalPanel';
import { onTerminalWanted } from '../terminal/bus';

type Tool = 'terminal' | 'editor' | 'logs' | 'metrics' | 'phone';
type Tab = Tool | 'answers';

const TOOLS: { id: Tool; label: string; icon: typeof SquareTerminal }[] = [
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'metrics', label: 'Metrics', icon: Activity },
  { id: 'phone', label: 'Phone', icon: Smartphone },
];

function EditorWithDock({ chapter }: { chapter: string }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'rq:match-code-split',
    panelIds: ['editor', 'dock'],
    storage: paneStorage,
  });
  return (
    <Group
      orientation="vertical"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="h-full"
    >
      <Panel id="editor" defaultSize="64%" minSize={180} className="h-full">
        <EditorPanel chapter={chapter} height="fill" />
      </Panel>
      <Separator
        aria-label="Resize the terminal"
        className="group flex h-[9px] shrink-0 cursor-row-resize items-center justify-center outline-none"
      >
        <span
          aria-hidden
          className={clsx(
            'h-px w-full bg-night-600/80 transition-[background-color,height] duration-fast',
            'group-hover:h-[3px] group-hover:bg-flood-500/70',
            'group-data-[separator=active]:h-[3px] group-data-[separator=active]:bg-flood-400',
            'group-data-[separator=focus]:h-[3px] group-data-[separator=focus]:bg-sky',
          )}
        />
      </Separator>
      <Panel id="dock" defaultSize="36%" minSize={120} className="h-full">
        <TerminalPanel height="fill" />
      </Panel>
    </Group>
  );
}

export function Workbench({
  initial,
  chapter,
  dock = false,
  answers,
  idle,
  footer,
}: {
  initial: Tool | null;
  chapter: string;
  /** Code levels: the terminal sits under the editor. */
  dock?: boolean;
  /** Decision levels: the answer sheet, shown as the first tab and open at first. */
  answers?: ReactNode;
  /** What the pane shows while no tool is open. */
  idle?: ReactNode;
  /** A strip under the tools: run my code in the app, run traffic. */
  footer?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab | null>(answers ? 'answers' : initial);
  const tabs = answers
    ? [{ id: 'answers' as const, label: 'Your answers', icon: ListChecks }, ...TOOLS]
    : TOOLS;
  // A lesson's "send to terminal" with no terminal on screen: open the one this pane holds (a code level docks it
  // under the editor). The bus hands the text over when the terminal mounts. Hidden routes run no effects, so
  // only the level on screen answers.
  useEffect(() => {
    const off = onTerminalWanted(() => setTab(dock ? 'editor' : 'terminal'));
    return () => {
      off();
    };
  }, [dock]);
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-night-600/60 bg-night-900/70"
      data-testid="workbench"
    >
      <div
        role="tablist"
        aria-label="Tools"
        className="flex h-11 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-night-600/70 bg-night-950/50 px-2"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={on}
              className={clsx(
                'relative -mb-px inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-t-sm border-x border-t px-3 text-md font-medium',
                'transition-colors duration-fast',
                on
                  ? 'border-night-600/70 bg-night-900 text-chalk'
                  : 'border-transparent text-chalk-dim hover:bg-night-800/60 hover:text-chalk',
              )}
              onClick={() => setTab(on ? null : t.id)}
              data-testid={`tab-${t.id}`}
            >
              {on ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 top-0 h-0.5 rounded-b-full bg-flood-500 shadow-[0_0_10px_rgb(255_154_31/0.8)]"
                />
              ) : null}
              <Icon size={15} aria-hidden className={on ? 'text-flood-400' : undefined} />
              {t.label}
              {t.id === 'editor' && dock && on ? (
                <span className="font-mono text-[11px] text-chalk-dim">+ terminal</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-hidden">
          {tab === 'answers' ? <div className="h-full overflow-y-auto">{answers}</div> : null}
          {tab === 'terminal' ? <TerminalPanel height="fill" /> : null}
          {tab === 'editor' ? (
            dock ? (
              <EditorWithDock chapter={chapter} />
            ) : (
              <EditorPanel chapter={chapter} height="fill" />
            )
          ) : null}
          {tab === 'logs' ? <LogsPanel height="fill" /> : null}
          {tab === 'metrics' ? (
            <div className="h-full overflow-y-auto p-3">
              <MetricsPanel compact />
            </div>
          ) : null}
          {tab === 'phone' ? (
            <div className="h-full overflow-y-auto">
              <PhoneScreen compact />
            </div>
          ) : null}
          {tab === null ? (
            <div className="h-full overflow-y-auto">
              {idle ?? (
                <p className="p-6 text-md text-chalk-dim">Open a tool above when you need it.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {footer ? (
        <div className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3 border-t border-night-600/70 bg-night-950/40 px-4 py-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
