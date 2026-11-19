'use client';
// Hints in the scoreboard. On an interview level a hint costs XP, so the button asks first, in a dialog that opens
// on the safe choice ("Keep my XP"). The dialog is only mounted while it is open.
import { Lightbulb } from 'lucide-react';
import type { RefObject } from 'react';
import { Button, Dialog } from '../design';
import { hintButtonLabel, hintCostCopy } from '../level/interview';

/** The design Button takes no ref, so a `display: contents` wrapper hands its button to a ref object. */
const grab =
  (ref: RefObject<HTMLButtonElement | null>) =>
  (el: HTMLSpanElement | null): void => {
    ref.current = el?.querySelector('button') ?? null;
  };

export function Hints({
  hints,
  total,
  interview,
  cost,
  xp,
  busy,
  confirming,
  onAsk,
  onCancel,
  onReveal,
  keepXpRef,
  buttonRef,
}: {
  hints: string[];
  total: number;
  interview: boolean;
  cost: number;
  xp: number;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onReveal: () => void;
  keepXpRef: RefObject<HTMLButtonElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const shown = hints.length;
  if (total === 0 && shown === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {hints.map((h, i) => (
        <p
          key={i}
          className="m-0 flex gap-2.5 rounded-md border border-flood-500/30 bg-flood-500/[0.06] px-3 py-2.5 text-sm leading-relaxed text-chalk"
          data-testid={`hint-${i}`}
        >
          <Lightbulb size={16} aria-hidden className="mt-0.5 shrink-0 text-flood-400" />
          <span>
            <span className="font-semibold text-flood-400">Hint {i + 1}:</span> {h}
          </span>
        </p>
      ))}
      {total > 0 ? (
        <span ref={grab(buttonRef)} className="contents">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            leading={<Lightbulb size={14} aria-hidden />}
            onClick={onAsk}
            disabled={busy || shown >= total || confirming}
            data-testid="hint-button"
          >
            {interview
              ? hintButtonLabel(cost, shown, total)
              : shown >= total
                ? 'No more hints'
                : `Show a hint (${shown} of ${total})`}
          </Button>
        </span>
      ) : null}
      {interview && confirming ? (
        <Dialog
          open
          onClose={onCancel}
          size="sm"
          title={cost === 0 ? 'Take a hint?' : 'Buy a hint?'}
          description="This is the interview: hints are allowed, and they are counted."
          footer={
            <>
              <span ref={grab(keepXpRef)} className="contents">
                <Button variant="ghost" autoFocus onClick={onCancel} data-testid="hint-confirm-no">
                  Keep my XP
                </Button>
              </span>
              <Button onClick={onReveal} data-testid="hint-confirm-yes">
                {cost === 0 ? 'Show the hint' : `Spend ${Math.min(cost, xp)} XP and show it`}
              </Button>
            </>
          }
        >
          <div data-testid="hint-confirm">
            <p id="hint-confirm-text" className="m-0 text-chalk" data-testid="hint-confirm-text">
              {hintCostCopy(cost, xp)} Take it?
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
