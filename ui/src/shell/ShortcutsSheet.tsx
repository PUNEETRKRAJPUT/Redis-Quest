'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@/design/components/surfaces';
import { Kbd } from '@/design/components/controls';
import { NAV } from './nav';

function Row({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-md text-chalk">{children}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-chalk-faint">{keys}</span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="label-caps mb-1 text-md text-flood-400">{title}</h3>
      <ul className="m-0 list-none divide-y divide-night-600/50 p-0">{children}</ul>
    </section>
  );
}

export function ShortcutsSheet({
  open,
  onClose,
  mod,
}: {
  open: boolean;
  onClose: () => void;
  /** Cmd on a Mac, Ctrl elsewhere. */
  mod: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Keyboard shortcuts"
      description="They pause while you type in the terminal, the editor or any text box."
    >
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <Group title="Go to">
          {NAV.map((n) => (
            <Row
              key={n.id}
              keys={
                <>
                  <Kbd>G</Kbd>
                  <span aria-hidden>then</span>
                  <Kbd>{n.key.toUpperCase()}</Kbd>
                </>
              }
            >
              {n.label}
            </Row>
          ))}
        </Group>
        <Group title="Anywhere">
          <Row
            keys={
              <>
                <Kbd>{mod}</Kbd>
                <Kbd>K</Kbd>
              </>
            }
          >
            Command palette: any screen, any level
          </Row>
          <Row keys={<Kbd>?</Kbd>}>This sheet</Row>
          <Row keys={<Kbd>Esc</Kbd>}>Close a sheet or the palette</Row>
          <Row
            keys={
              <>
                <Kbd>Tab</Kbd>
              </>
            }
          >
            Move focus, starting with Skip to content
          </Row>
        </Group>
      </div>
    </Dialog>
  );
}
