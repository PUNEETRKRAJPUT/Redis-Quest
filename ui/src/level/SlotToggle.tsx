// E-01: "Run my code in the app". Without it a learner's code only ever runs in the verifier; with it the app's
// own routes call it, on every app instance.
import { clsx } from 'clsx';
import { useState } from 'react';
import { api, ApiError } from '../api';
import type { LevelSlots } from '../types';

export const SLOT_TOGGLE_LABEL = 'Run my code in the app';
export const SLOT_ON_COPY = 'Your code answers /app requests on every app instance';
export const SLOT_OFF_COPY =
  'The app runs its built-in version; your code only runs in the verifier';
export const SLOT_LOOP_NOTE =
  'A loop that never finishes freezes an app instance; `docker compose restart app` brings it back.';
export const SLOT_BUSY_COPY = 'Wait for the verifier to finish';

type SetSlots = (levelId: string, active: boolean) => Promise<unknown>;

/** What clicking the switch does: ask the engine, then reload the level. Returns the message to show, or null. */
export async function toggleSlots(
  levelId: string,
  currentlyActive: boolean,
  reload: () => Promise<void> | void,
  setSlots: SetSlots = api.setSlots,
): Promise<string | null> {
  try {
    await setSlots(levelId, !currentlyActive);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'verify_in_progress')
      return SLOT_BUSY_COPY;
    return e instanceof Error ? e.message : String(e);
  }
  await reload();
  return null;
}

/** Pure view, so it renders the same on the server in tests. */
export function SlotToggleView({
  active,
  busy = false,
  message = null,
  onClick,
}: {
  active: boolean;
  busy?: boolean;
  message?: string | null;
  onClick?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="slot-toggle-box">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-describedby="slot-toggle-copy"
          className={clsx(
            'group inline-flex cursor-pointer items-center gap-2.5 rounded-sm text-md font-semibold text-chalk',
            'transition-colors duration-fast aria-busy:cursor-progress',
            busy && 'cursor-progress opacity-60',
          )}
          disabled={busy}
          onClick={onClick}
          data-testid="slot-toggle"
          data-active={active ? 'true' : 'false'}
        >
          <span
            aria-hidden
            className={clsx(
              'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border p-[2px]',
              'transition-[background-color,border-color,box-shadow] duration-base ease-out-expo',
              active
                ? 'border-turf/70 bg-turf/25 shadow-[0_0_12px_-2px_rgb(46_226_129/0.6)]'
                : 'border-night-600 bg-night-800 group-hover:border-chalk-faint',
            )}
          >
            <span
              className={clsx(
                'size-4 rounded-full shadow-raise transition-transform duration-base ease-out-expo',
                active ? 'translate-x-4 bg-turf' : 'translate-x-0 bg-chalk-dim',
              )}
            />
          </span>
          <span>{SLOT_TOGGLE_LABEL}</span>
        </button>
        {message ? (
          <span
            className="text-sm font-medium text-flood-400"
            role="alert"
            data-testid="slot-toggle-msg"
          >
            {message}
          </span>
        ) : null}
      </div>
      <p
        id="slot-toggle-copy"
        className={clsx('m-0 text-sm leading-snug', active ? 'text-turf' : 'text-chalk-dim')}
        data-testid="slot-toggle-copy"
      >
        {active ? SLOT_ON_COPY : SLOT_OFF_COPY}
      </p>
      <p className="m-0 text-xs leading-snug text-chalk-dim">
        <small className="text-xs">{SLOT_LOOP_NOTE}</small>
      </p>
    </div>
  );
}

export function SlotToggle({
  levelId,
  slots,
  reload,
}: {
  levelId: string;
  slots: LevelSlots | undefined;
  reload: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!slots || slots.own.length === 0) return null;
  return (
    <SlotToggleView
      active={slots.active}
      busy={busy}
      message={message}
      onClick={() => {
        setBusy(true);
        setMessage(null);
        void toggleSlots(levelId, slots.active, reload).then((m) => {
          setMessage(m);
          setBusy(false);
        });
      }}
    />
  );
}
