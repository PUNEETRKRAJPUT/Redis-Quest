'use client';
// The name form: same field, validation and submit as before (test ids `player-name` and `player-submit`),
// plus a jersey colour and the one-time sound question. Both extras are optional and cosmetic.
import { clsx } from 'clsx';
import { Volume2, VolumeOff } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button, Switch, play, unlockAudio, useSettings } from '../design';
import { Jersey } from './Jersey';
import { DEFAULT_JERSEY, JERSEYS, jerseyColor, useProfile, type JerseyId } from './profile';

export type NameFormProps = {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  /** Focus the name field when the form appears. */
  autoFocus?: boolean;
};

function JerseyPicker() {
  const jersey = useProfile((s) => s.jersey);
  const setJersey = useProfile((s) => s.setJersey);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + JERSEYS.length) % JERSEYS.length;
    setJersey(JERSEYS[next]?.id ?? DEFAULT_JERSEY);
    refs.current[next]?.focus();
    play('tick');
  };
  return (
    <div role="radiogroup" aria-label="Jersey colour" className="flex items-center gap-2.5">
      {JERSEYS.map((j, i) => {
        const on = j.id === jersey;
        return (
          <button
            key={j.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={j.label}
            title={j.label}
            tabIndex={on ? 0 : -1}
            data-testid={`jersey-${j.id}`}
            onClick={() => {
              setJersey(j.id as JerseyId);
              play('tick');
            }}
            onKeyDown={(e) => move(e, i)}
            className={clsx(
              'grid size-9 cursor-pointer place-items-center rounded-full border transition-[border-color,box-shadow,transform] duration-fast ease-out-expo motion-ok:hover:-translate-y-0.5',
              on ? 'border-chalk shadow-glow' : 'border-night-600 hover:border-chalk-faint',
            )}
          >
            <span
              aria-hidden
              className={clsx(
                'size-6 rounded-full transition-transform duration-fast ease-out-expo',
                on && 'scale-110',
              )}
              style={{ background: j.color }}
            />
          </button>
        );
      })}
    </div>
  );
}

export function NameForm({ name, onNameChange, onSubmit, busy, error, autoFocus }: NameFormProps) {
  const jersey = useProfile((s) => s.jersey);
  const sound = useSettings((s) => s.sound);
  const setSound = useSettings((s) => s.setSound);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const trimmed = name.trim();
  return (
    <form
      data-testid="welcome-form"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !busy) onSubmit();
      }}
    >
      <div className="flex items-center gap-5">
        <Jersey
          color={jerseyColor(jersey)}
          name={name}
          className="h-[118px] w-[108px] shrink-0 drop-shadow-[0_10px_24px_rgb(0_0_0/0.5)]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="welcome-name" className="font-sans text-md font-semibold text-chalk">
            What should Teja call you?
          </label>
          <input
            id="welcome-name"
            ref={input}
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => onNameChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Your name"
            data-testid="player-name"
            className="h-11 w-full rounded-md border border-night-600 bg-night-950/80 px-3.5 font-sans text-base text-chalk shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)] transition-[border-color,box-shadow] duration-fast placeholder:text-chalk-faint hover:border-chalk-faint/60 focus:border-flood-500/70"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="label-caps text-xs tracking-[0.14em] text-chalk-dim">Jersey colour</span>
        <JerseyPicker />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-night-600/70 bg-night-950/50 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {sound ? (
            <Volume2 size={16} className="shrink-0 text-flood-400" aria-hidden />
          ) : (
            <VolumeOff size={16} className="shrink-0 text-chalk-dim" aria-hidden />
          )}
          <p className="m-0 text-sm leading-snug text-chalk-dim">
            Sound effects, quiet and synthesised. Change it any time in the header.
          </p>
        </div>
        <Switch
          label="Sound"
          hideLabel
          checked={sound}
          onCheckedChange={(v) => {
            setSound(v);
            if (v) {
              unlockAudio();
              play('tock');
            }
          }}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="m-0 rounded-md border border-wicket/40 bg-wicket/10 px-3.5 py-2.5 text-md text-chalk"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        loading={busy}
        loadingText="Starting..."
        disabled={!trimmed}
        data-testid="player-submit"
        className="w-full"
      >
        Start Chapter 0
      </Button>
      <p className="m-0 text-center text-sm text-chalk-dim">
        Everything runs on this Mac. Your progress is saved in a file next to the project.
      </p>
    </form>
  );
}
