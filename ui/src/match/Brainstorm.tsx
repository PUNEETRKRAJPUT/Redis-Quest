'use client';
// Beat 3: commit to a guess before learning the answer. Nothing is graded; the guess comes back in beat 7.
import { Lock, Pencil } from 'lucide-react';
import { Button } from '../design';
import type { LevelData } from '../types';
import { OptionCard } from './AnswerSheet';

export function Brainstorm({
  level,
  option,
  text,
  editing,
  error,
  onOption,
  onText,
  onEdit,
  onSubmit,
}: {
  level: LevelData;
  option: string;
  text: string;
  editing: boolean;
  error: string | null;
  onOption: (id: string) => void;
  onText: (t: string) => void;
  onEdit: () => void;
  onSubmit: () => void;
}) {
  const guessed = level.brainstormAnswer !== null;
  return (
    <div className="flex max-w-[68ch] flex-col gap-3">
      <p className="m-0 text-lg font-semibold leading-snug text-chalk">{level.brainstorm.prompt}</p>
      <p className="m-0 text-sm text-chalk-dim">
        Nothing is graded here. Commit to a guess first, then learn what the answer is.
      </p>
      {guessed && !editing ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-turf/35 bg-turf/[0.06] p-4"
          data-testid="brainstorm-locked"
        >
          <span className="label-caps flex items-center gap-1.5 text-xs text-turf">
            <Lock size={12} aria-hidden /> Your guess, locked in
          </span>
          <p className="m-0 text-base font-semibold text-chalk">
            {level.brainstorm.options.find((o) => o.id === level.brainstormAnswer?.optionId)?.label}
          </p>
          <p className="m-0 border-l-2 border-turf/40 pl-3 text-md italic leading-relaxed text-chalk-dim">
            {level.brainstormAnswer?.text}
          </p>
          <Button
            variant="quiet"
            size="sm"
            className="self-start"
            leading={<Pencil size={13} aria-hidden />}
            onClick={onEdit}
          >
            Change my guess
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">Pick one approach</legend>
            {level.brainstorm.options.map((o) => (
              <OptionCard
                key={o.id}
                type="radio"
                name="bs"
                value={o.id}
                checked={option === o.id}
                onChange={() => onOption(o.id)}
                label={o.label}
                testId={`brainstorm-option-${o.id}`}
              />
            ))}
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-md font-semibold text-chalk">One line: why?</span>
            <input
              type="text"
              value={text}
              maxLength={500}
              onChange={(e) => onText(e.target.value)}
              placeholder="Because..."
              data-testid="brainstorm-text"
              className="h-11 w-full rounded-md border border-night-600 bg-night-950 px-3 text-md text-chalk placeholder:text-chalk-faint transition-[border-color] duration-fast hover:border-chalk-faint/60 focus:border-flood-500"
            />
          </label>
          {error ? (
            <p
              className="m-0 rounded-sm border border-wicket/40 bg-wicket/10 px-3 py-2 text-sm text-chalk"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="self-start"
            disabled={!option || !text.trim()}
            leading={<Lock size={15} aria-hidden />}
            data-testid="brainstorm-submit"
          >
            Lock in my guess
          </Button>
        </form>
      )}
    </div>
  );
}
