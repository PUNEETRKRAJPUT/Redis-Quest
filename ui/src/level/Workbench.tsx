import { useState } from 'react';
import { IconCode, IconLog, IconPulse, IconTerminal } from '../icons';
import { EditorPanel } from '../panels/EditorPanel';
import { LogsPanel } from '../panels/LogsPanel';
import { MetricsPanel } from '../panels/MetricsPanel';
import { TerminalPanel } from '../panels/TerminalPanel';

type Tab = 'terminal' | 'editor' | 'logs' | 'metrics';

const TABS: { id: Tab; label: string; icon: typeof IconTerminal }[] = [
  { id: 'terminal', label: 'Terminal', icon: IconTerminal },
  { id: 'editor', label: 'Editor', icon: IconCode },
  { id: 'logs', label: 'Logs', icon: IconLog },
  { id: 'metrics', label: 'Metrics', icon: IconPulse },
];

/** The tools next to a level: only the one the level's mode needs is open at first. */
export function Workbench({ initial, chapter }: { initial: Tab | null; chapter: string }) {
  const [tab, setTab] = useState<Tab | null>(initial);
  return (
    <div className="workbench" data-testid="workbench">
      <div role="tablist" aria-label="Tools" className="tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button key={t.id} role="tab" type="button" aria-selected={on} className={on ? 'tab active' : 'tab'} onClick={() => setTab(on ? null : t.id)} data-testid={`tab-${t.id}`}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'terminal' ? <TerminalPanel height={300} /> : null}
      {tab === 'editor' ? <EditorPanel chapter={chapter} height={380} /> : null}
      {tab === 'logs' ? <LogsPanel height={300} /> : null}
      {tab === 'metrics' ? <MetricsPanel compact /> : null}
      {tab === null ? <p className="muted pad">Open a tool above when you need it.</p> : null}
    </div>
  );
}
