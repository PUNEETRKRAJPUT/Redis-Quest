'use client';
import { ArrowLeft, Copy, Gamepad2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Pill, toast } from '@/design';
import { CABINETS, COMING } from './cabinets/registry';
import { readBest } from './kit';

export const GUIDE_PATH = 'docs/arcade.md';

/** A row of cabinets to play, with best scores; one of them open at a time. */
export function ArcadeScreen() {
  const [open, setOpen] = useState<string | null>(null);
  const [bests, setBests] = useState<Record<string, number | null>>({});

  // Best scores are in the browser's storage, so they are read after mount and again after a game.
  useEffect(() => {
    if (open !== null) return;
    setBests(Object.fromEntries(CABINETS.map((c) => [c.id, readBest(c.id)])));
  }, [open]);

  const cabinet = CABINETS.find((c) => c.id === open);
  if (cabinet) {
    const Game = cabinet.Component;
    return (
      <div data-ds="" data-testid="arcade-playing">
        <div className="mx-auto w-full max-w-[1200px] px-6 pt-5">
          <Button
            variant="quiet"
            size="sm"
            leading={<ArrowLeft size={14} aria-hidden />}
            onClick={() => setOpen(null)}
            data-testid="arcade-back"
          >
            All cabinets
          </Button>
        </div>
        <Game />
      </div>
    );
  }

  const copyGuide = () => {
    const done = () => toast.success('Path copied', GUIDE_PATH);
    const failed = () =>
      toast.warn('Could not copy', `The guide is ${GUIDE_PATH} in the repository.`);
    try {
      void navigator.clipboard.writeText(GUIDE_PATH).then(done, failed);
    } catch {
      failed();
    }
  };

  return (
    <main data-ds="" data-testid="arcade" className="mx-auto w-full max-w-[1200px] px-6 py-8">
      <div className="label-caps text-xs text-chalk-dim">Arcade</div>
      <h1 className="font-display text-2xl font-semibold uppercase tracking-display text-chalk">
        The arcade
      </h1>
      <p className="mb-6 mt-1 max-w-[62ch] text-md text-chalk-dim">
        One-minute machines that make you a part of Redis, because some things are easier to feel
        than to read. Pick one and play.
      </p>

      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Cabinets">
        {CABINETS.map((c, i) => {
          const best = bests[c.id];
          return (
            <li key={c.id}>
              <Card focal={i === 0} padding="none" className="flex h-full flex-col overflow-hidden">
                <div
                  aria-hidden
                  className="flex items-center gap-2 border-b border-night-600/70 bg-night-950/70 px-5 py-5"
                >
                  <span className="h-8 w-14 rounded-sm bg-night-700" />
                  <span className="h-8 w-10 rounded-sm bg-night-700" />
                  <span className="h-8 w-24 rounded-sm bg-wicket/70" />
                  <span className="h-8 w-10 rounded-sm bg-night-700" />
                  <span className="h-8 w-10 rounded-sm bg-night-700" />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <h2 className="font-display text-xl font-semibold uppercase tracking-display text-chalk">
                    {c.title}
                  </h2>
                  <p className="text-md text-chalk-dim">{c.pitch}</p>
                  <p className="text-sm text-chalk-dim">
                    <span className="label-caps text-[11px]">What it teaches </span>
                    {c.lesson}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-night-600/70 bg-night-950/30 px-5 py-3">
                  <div>
                    <div className="label-caps text-[11px] text-chalk-dim">Best score</div>
                    <div
                      className="tabular font-display text-xl font-bold text-chalk"
                      data-testid={`best-${c.id}`}
                    >
                      {typeof best === 'number' ? best : '-'}
                    </div>
                  </div>
                  <Button
                    leading={<Gamepad2 size={16} aria-hidden />}
                    onClick={() => setOpen(c.id)}
                    data-testid={`play-${c.id}`}
                  >
                    Play
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
        {COMING.map((c) => (
          <li key={c.id}>
            <Card
              tone="inset"
              className="flex h-full flex-col gap-2"
              data-testid={`coming-${c.id}`}
            >
              <Pill tone="neutral" variant="status" size="sm">
                Coming
              </Pill>
              <h2 className="font-display text-xl font-semibold uppercase tracking-display text-chalk-dim">
                {c.title}
              </h2>
              <p className="text-md text-chalk-dim">{c.pitch}</p>
              <p className="mt-auto pt-3 text-sm text-chalk-dim">
                Want to build it, or another? One folder per cabinet; the guide is{' '}
                <code className="font-mono text-chalk">{GUIDE_PATH}</code> in the repository.
              </p>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  leading={<Copy size={14} aria-hidden />}
                  onClick={copyGuide}
                >
                  Copy the path
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
