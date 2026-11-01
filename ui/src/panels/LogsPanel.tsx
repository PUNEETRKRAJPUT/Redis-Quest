import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useQuest } from '../store';
import type { LogService } from '../types';
import { LOG_SERVICES } from '../types';

export function LogsPanel({ height = 360 }: { height?: number }) {
  const [tab, setTab] = useState<LogService>('app');
  const lines = useQuest((s) => s.logs[tab]);
  const seed = useQuest((s) => s.seedLog);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    setErr(null);
    api
      .logs(tab)
      .then((r) => seed(tab, r.lines))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [tab, seed]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="logs-panel">
      <div role="tablist" aria-label="Service logs" className="tabs small">
        {LOG_SERVICES.map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={tab === s}
            className={tab === s ? 'tab active' : 'tab'}
            onClick={() => setTab(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <pre
        ref={box}
        className="logbox"
        style={{ height }}
        tabIndex={0}
        aria-label={`${tab} log, live`}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {err
          ? `Could not read the ${tab} log: ${err}`
          : lines.length
            ? lines.join('\n')
            : `No ${tab} log lines yet. They appear here as the service writes them.`}
      </pre>
    </div>
  );
}
