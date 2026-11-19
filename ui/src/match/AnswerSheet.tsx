'use client';
// The questions a level checks along with the work: quizzes (pick one, or several) and typed answers. On a
// decision level this is the whole workspace ("sheet"); elsewhere it sits in the scoreboard ("compact").
import { clsx } from 'clsx';
import type { Dispatch, SetStateAction } from 'react';
import type { VerifierInfo } from '../types';

export type Quiz = Extract<VerifierInfo, { type: 'quiz' }>;
export type AnswerBox = Extract<VerifierInfo, { type: 'answer' }>;
export type Answers = Record<string, string | string[]>;

const CONTROL =
  'mt-0.5 shrink-0 cursor-pointer appearance-none border-2 border-chalk-faint bg-night-950 ' +
  'transition-[background-color,border-color,box-shadow] duration-fast ' +
  'checked:border-flood-500 checked:bg-flood-500 checked:shadow-[inset_0_0_0_3px_var(--color-night-950)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky';

export function OptionCard({
  type,
  name,
  checked,
  onChange,
  label,
  letter,
  big = false,
  testId,
  value,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  letter?: string;
  big?: boolean;
  testId?: string;
  value?: string;
}) {
  return (
    <label
      className={clsx(
        'group flex cursor-pointer items-start gap-3 rounded-md border transition-[border-color,background-color,box-shadow] duration-fast',
        big ? 'px-4 py-3.5' : 'px-3 py-2.5',
        checked
          ? 'border-flood-500/70 bg-flood-500/[0.09] shadow-[0_0_0_1px_rgb(255_154_31/0.25)]'
          : 'border-night-600/80 bg-night-950/40 hover:border-chalk-faint/60 hover:bg-night-800/50',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        data-testid={testId}
        className={clsx(CONTROL, 'size-[18px]', type === 'radio' ? 'rounded-full' : 'rounded-xs')}
      />
      {letter ? (
        <span
          aria-hidden
          className={clsx(
            'mt-px font-display text-md font-bold tabular',
            checked ? 'text-flood-400' : 'text-chalk-dim',
          )}
        >
          {letter}
        </span>
      ) : null}
      <span
        className={clsx(
          'min-w-0 leading-snug',
          big ? 'text-base' : 'text-md',
          checked ? 'text-chalk' : 'text-chalk-dim group-hover:text-chalk',
        )}
      >
        {label}
      </span>
    </label>
  );
}

export function AnswerSheet({
  quizzes,
  answerBoxes,
  answers,
  setAnswers,
  questionsFrom,
  firstFollowUp,
  variant,
}: {
  quizzes: Quiz[];
  answerBoxes: AnswerBox[];
  answers: Answers;
  setAnswers: Dispatch<SetStateAction<Answers>>;
  /** Pool interviews: where the follow-up questions start (null on other levels). */
  questionsFrom: number | null | undefined;
  firstFollowUp: number | undefined;
  variant: 'sheet' | 'compact';
}) {
  const big = variant === 'sheet';
  if (!quizzes.length && !answerBoxes.length) return null;
  return (
    <div className={clsx('flex flex-col', big ? 'gap-8 p-6' : 'gap-4')} data-testid="answer-sheet">
      {big ? (
        <div>
          <div className="label-caps text-xs text-flood-400">Your call</div>
          <p className="mb-0 mt-1 max-w-[62ch] text-base leading-relaxed text-chalk-dim">
            There is no code to write here. Choose, then check your work: the check reads these
            answers.
          </p>
        </div>
      ) : null}
      {quizzes.map((q, qi) => (
        <div key={q.index} className="flex min-w-0 flex-col gap-3">
          {questionsFrom != null && q.index === firstFollowUp ? (
            <p
              className="m-0 rounded-sm border border-cap-purple/35 bg-cap-purple/[0.07] px-3 py-2 text-sm text-chalk"
              data-testid="followups-heading"
            >
              The interviewer has follow-up questions, asked after your code is checked:
            </p>
          ) : null}
          <fieldset
            className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
            data-testid={`quiz-${q.index}`}
          >
            <legend
              className={clsx(
                'mb-2 p-0 font-semibold leading-snug text-chalk',
                big ? 'max-w-[62ch] text-lg' : 'text-md',
              )}
            >
              {big ? (
                <span className="label-caps mb-1 block font-display text-xs font-semibold text-chalk-dim">
                  Question {qi + 1}
                  {q.multiple ? ' · pick every one that applies' : ''}
                </span>
              ) : null}
              {q.question}
            </legend>
            {q.options.map((o, oi) => {
              const cur = answers[String(q.index)];
              const arr = Array.isArray(cur) ? cur : cur ? [cur] : [];
              const checked = arr.includes(o.id);
              return (
                <OptionCard
                  key={o.id}
                  type={q.multiple ? 'checkbox' : 'radio'}
                  name={`quiz-${q.index}`}
                  checked={checked}
                  big={big}
                  letter={big ? String.fromCharCode(65 + oi) : undefined}
                  label={o.label}
                  onChange={() =>
                    setAnswers((a) => ({
                      ...a,
                      [String(q.index)]: q.multiple
                        ? checked
                          ? arr.filter((x) => x !== o.id)
                          : [...arr, o.id]
                        : o.id,
                    }))
                  }
                />
              );
            })}
          </fieldset>
        </div>
      ))}
      {answerBoxes.map((a) => (
        <label key={a.index} className="flex flex-col gap-2">
          <span
            className={clsx('font-semibold leading-snug text-chalk', big ? 'text-lg' : 'text-md')}
          >
            {a.prompt}
          </span>
          <input
            type="text"
            value={(answers[String(a.index)] as string | undefined) ?? ''}
            onChange={(e) => setAnswers((x) => ({ ...x, [String(a.index)]: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
            placeholder="Type what you found"
            data-testid={`answer-${a.index}`}
            className={clsx(
              'h-11 w-full rounded-md border border-night-600 bg-night-950 px-3 font-mono text-md text-chalk',
              'placeholder:text-chalk-faint transition-[border-color,box-shadow] duration-fast',
              'hover:border-chalk-faint/60 focus:border-flood-500',
            )}
          />
        </label>
      ))}
    </div>
  );
}
