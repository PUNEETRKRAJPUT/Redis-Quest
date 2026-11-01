import type { ReactNode } from 'react';
import { IconChevron } from '../icons';

export function Stage({
  n,
  title,
  chip,
  tone = 'neutral',
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  chip?: string;
  tone?: 'neutral' | 'done' | 'warn' | 'locked';
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `stage-body-${n}`;
  return (
    <section className={`stage ${open ? 'open' : ''}`} data-testid={`stage-${n}`}>
      <h2 className="stage-head">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}>
          <span className="stage-n">{n}</span>
          <span className="stage-title">{title}</span>
          {chip ? <span className={`chip-state ${tone}`}>{chip}</span> : null}
          <span className={`chev ${open ? 'down' : ''}`}><IconChevron size={18} /></span>
        </button>
      </h2>
      {open ? <div id={bodyId} className="stage-body">{children}</div> : null}
    </section>
  );
}
