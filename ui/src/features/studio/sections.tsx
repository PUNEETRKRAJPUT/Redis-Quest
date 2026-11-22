'use client';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, IconButton, Pill, Segmented } from '../../design';
import {
  CAST,
  CHECK_KIND_INFO,
  COMPARATORS,
  STRUCTURES,
  emptyCheck,
  emptyQuiz,
  switchMode,
  type CheckKind,
  type CheckField,
  type Draft,
  type DraftCheck,
  type Mode,
} from './draft';
import { Select, Tick, TextArea, TextInput, patchAt, removeAt } from './fields';

export type SetDraft = (fn: (d: Draft) => Draft) => void;
export interface ErrorLine {
  path: string;
  message: string;
}

export function Section({
  title,
  blurb,
  errors,
  defaultOpen = false,
  children,
  testId,
}: {
  title: string;
  blurb?: string;
  errors: readonly ErrorLine[];
  defaultOpen?: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <details
      className="group rounded-lg border border-night-700 bg-night-800/60 open:bg-night-800"
      open={defaultOpen || undefined}
      data-testid={testId}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <h2 className="m-0 flex-1 font-display text-lg font-semibold uppercase tracking-[0.03em] text-chalk">
          {title}
        </h2>
        {errors.length > 0 ? (
          <Pill tone="wicket" size="sm">
            {errors.length} to fix
          </Pill>
        ) : null}
      </summary>
      <div className="flex flex-col gap-4 border-t border-night-700 px-4 pb-4 pt-3">
        {blurb ? (
          <p className="m-0 max-w-[68ch] text-sm leading-relaxed text-chalk-dim">{blurb}</p>
        ) : null}
        {children}
        {errors.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={`Problems in ${title}`}>
            {errors.map((e, i) => (
              <li key={`${e.path}-${i}`} className="text-xs leading-snug text-wicket">
                <span className="font-mono">{e.path}</span>: {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'cli', label: 'Terminal level' },
  { value: 'decision', label: 'Decision level' },
];

export function BasicsFields({ draft, set }: { draft: Draft; set: SetDraft }) {
  return (
    <>
      <Segmented
        label="Kind of level"
        options={MODE_OPTIONS}
        value={draft.mode}
        onValueChange={(m) => set((d) => switchMode(d, m))}
      />
      <p className="m-0 text-xs text-chalk-dim">
        A terminal level asks the player to run Redis commands, then reads Redis. A decision level
        asks questions and grades the answers.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput
          label="Pack name"
          value={draft.pack}
          onChange={(pack) => set((d) => ({ ...d, pack }))}
          placeholder="my-pack"
          mono
          hint="Lowercase, dashes. One folder per pack."
        />
        <TextInput
          label="Level number"
          value={String(draft.number)}
          inputMode="numeric"
          onChange={(v) => set((d) => ({ ...d, number: Number(v.replace(/\D/g, '')) || 0 }))}
          hint="1 to 99."
        />
        <TextInput
          label="Level slug"
          value={draft.slug}
          onChange={(slug) => set((d) => ({ ...d, slug }))}
          placeholder="canteen-tokens"
          mono
          hint="Lowercase, dashes."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Level title"
          value={draft.title}
          onChange={(title) => set((d) => ({ ...d, title }))}
          placeholder="The canteen token counter"
        />
        <TextInput
          label="Pack title"
          value={draft.chapterTitle}
          onChange={(chapterTitle) => set((d) => ({ ...d, chapterTitle }))}
          placeholder="From the hostel"
          hint="Shown above the level list of your pack."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Your name"
          value={draft.author.name}
          onChange={(name) => set((d) => ({ ...d, author: { ...d.author, name } }))}
          hint="The byline players see."
        />
        <TextInput
          label="GitHub user name (optional)"
          value={draft.author.github}
          onChange={(github) => set((d) => ({ ...d, author: { ...d.author, github } }))}
          placeholder="octocat"
          mono
        />
      </div>
    </>
  );
}

export function StoryFields({ draft, set }: { draft: Draft; set: SetDraft }) {
  return (
    <>
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-semibold text-chalk">The incident chat</legend>
        {draft.incident.map((m, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,9rem)_5rem_minmax(0,1fr)_auto] items-end gap-2"
          >
            <Select
              label={`Message ${i + 1} from`}
              value={m.from}
              onChange={(from) =>
                set((d) => ({ ...d, incident: patchAt(d.incident, i, { from }) }))
              }
              options={CAST.map((c) => ({ value: c.slug, label: c.name }))}
            />
            <TextInput
              label="Time"
              value={m.time}
              onChange={(time) =>
                set((d) => ({ ...d, incident: patchAt(d.incident, i, { time }) }))
              }
              placeholder="12:40"
              mono
            />
            <TextInput
              label="Text"
              value={m.text}
              onChange={(text) =>
                set((d) => ({ ...d, incident: patchAt(d.incident, i, { text }) }))
              }
            />
            <IconButton
              label={`Remove message ${i + 1}`}
              icon={<Trash2 size={16} aria-hidden />}
              variant="quiet"
              onClick={() => set((d) => ({ ...d, incident: removeAt(d.incident, i) }))}
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            leading={<Plus size={14} aria-hidden />}
            onClick={() =>
              set((d) => ({ ...d, incident: [...d.incident, { from: 'you', time: '', text: '' }] }))
            }
          >
            Add a message
          </Button>
        </div>
      </fieldset>
      <TextArea
        label="Story"
        rows={5}
        value={draft.story}
        onChange={(story) => set((d) => ({ ...d, story }))}
        hint="Markdown. Two or three sentences that put the player in the scene."
      />
      <TextInput
        label="Brainstorm question"
        value={draft.brainstormPrompt}
        onChange={(brainstormPrompt) => set((d) => ({ ...d, brainstormPrompt }))}
        hint="The player commits to a guess before any teaching. Nothing is graded."
      />
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-semibold text-chalk">Brainstorm options</legend>
        {draft.brainstormOptions.map((o, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-3">
            <TextInput
              label={`Option ${i + 1}`}
              value={o.label}
              onChange={(label) =>
                set((d) => ({
                  ...d,
                  brainstormOptions: patchAt(d.brainstormOptions, i, { label }),
                }))
              }
            />
            <div className="pb-2">
              <Tick
                label="Reasonable"
                checked={o.reasonable}
                onChange={(reasonable) =>
                  set((d) => ({
                    ...d,
                    brainstormOptions: patchAt(d.brainstormOptions, i, { reasonable }),
                  }))
                }
              />
            </div>
            <IconButton
              label={`Remove option ${i + 1}`}
              icon={<Trash2 size={16} aria-hidden />}
              variant="quiet"
              onClick={() =>
                set((d) => ({ ...d, brainstormOptions: removeAt(d.brainstormOptions, i) }))
              }
            />
          </div>
        ))}
        <p className="m-0 text-xs text-chalk-dim">
          &ldquo;Not Redis at all&rdquo; is added for you. At least one option must be reasonable.
        </p>
        <div>
          <Button
            size="sm"
            variant="ghost"
            leading={<Plus size={14} aria-hidden />}
            onClick={() =>
              set((d) => ({
                ...d,
                brainstormOptions: [...d.brainstormOptions, { label: '', reasonable: false }],
              }))
            }
          >
            Add an option
          </Button>
        </div>
      </fieldset>
    </>
  );
}

export function TaskFields({ draft, set }: { draft: Draft; set: SetDraft }) {
  return (
    <>
      <TextArea
        label="Teaching text"
        rows={6}
        value={draft.teach}
        onChange={(teach) => set((d) => ({ ...d, teach }))}
        hint="Markdown. The commands the player needs and a worked example that is not the answer. Use only what the Redis docs say."
      />
      <TextArea
        label="The task"
        rows={4}
        value={draft.task}
        onChange={(task) => set((d) => ({ ...d, task }))}
        hint="Markdown. Exactly what to do, with the key names."
      />
      {draft.mode === 'cli' ? (
        <TextArea
          label="Setup commands (optional)"
          rows={3}
          mono
          value={draft.setup}
          onChange={(setup) => set((d) => ({ ...d, setup }))}
          placeholder="DEL canteen:tokens:today"
          hint="One Redis command per line, run when the level starts. Make them safe to run twice. Use a key prefix of your own, never game:."
        />
      ) : null}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-semibold text-chalk">Hints</legend>
        {draft.hints.map((h, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <TextInput
              label={`Hint ${i + 1}`}
              value={h}
              onChange={(v) =>
                set((d) => ({ ...d, hints: d.hints.map((x, n) => (n === i ? v : x)) }))
              }
            />
            <IconButton
              label={`Remove hint ${i + 1}`}
              icon={<Trash2 size={16} aria-hidden />}
              variant="quiet"
              onClick={() => set((d) => ({ ...d, hints: removeAt(d.hints, i) }))}
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            leading={<Plus size={14} aria-hidden />}
            onClick={() => set((d) => ({ ...d, hints: [...d.hints, ''] }))}
          >
            Add a hint
          </Button>
        </div>
      </fieldset>
    </>
  );
}

const FIELD_LABEL: Record<CheckField, string> = {
  key: 'Key',
  value: 'Value',
  field: 'Hash field',
  member: 'Member',
  structure: 'Structure',
  min: 'Minimum (seconds)',
  max: 'Maximum (seconds)',
  command: 'Read-only command',
  comparator: 'Compare with',
};

function CheckForm({
  check,
  onChange,
  onRemove,
  n,
}: {
  check: DraftCheck;
  onChange: (p: Partial<DraftCheck>) => void;
  onRemove: () => void;
  n: number;
}) {
  const info = CHECK_KIND_INFO.find((k) => k.kind === check.kind) ?? CHECK_KIND_INFO[0];
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-night-700 bg-night-900/60 p-3"
      data-testid={`check-${n}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Select
          label={`Check ${n + 1}`}
          value={check.kind}
          onChange={(kind) =>
            onChange({
              ...emptyCheck(kind as CheckKind),
              antipattern: check.antipattern,
              message: check.message,
            })
          }
          options={CHECK_KIND_INFO.map((k) => ({ value: k.kind, label: k.label }))}
          hint={info?.help}
        />
        <IconButton
          label={`Remove check ${n + 1}`}
          icon={<Trash2 size={16} aria-hidden />}
          variant="quiet"
          onClick={onRemove}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(info?.fields ?? []).map((f) =>
          f === 'structure' ? (
            <Select
              key={f}
              label={FIELD_LABEL[f]}
              value={check.structure}
              onChange={(structure) => onChange({ structure })}
              options={STRUCTURES.map((s) => ({ value: s, label: s }))}
            />
          ) : f === 'comparator' ? (
            <Select
              key={f}
              label={FIELD_LABEL[f]}
              value={check.comparator}
              onChange={(comparator) => onChange({ comparator })}
              options={COMPARATORS.map((s) => ({ value: s, label: s }))}
            />
          ) : (
            <TextInput
              key={f}
              label={FIELD_LABEL[f]}
              mono
              value={check[f]}
              onChange={(v) => onChange({ [f]: v } as Partial<DraftCheck>)}
              className={f === 'command' ? 'sm:col-span-2' : undefined}
            />
          ),
        )}
      </div>
      <TextInput
        label="Message shown when this check fails"
        value={check.message}
        onChange={(message) => onChange({ message })}
        hint="Say what to fix. An antipattern check needs one."
      />
      <Tick
        label="This catches a solution that works but is wrong (antipattern)"
        checked={check.antipattern}
        onChange={(antipattern) => onChange({ antipattern })}
      />
    </div>
  );
}

export function ChecksFields({ draft, set }: { draft: Draft; set: SetDraft }) {
  if (draft.mode === 'cli') {
    return (
      <>
        {draft.checks.map((c, i) => (
          <CheckForm
            key={i}
            n={i}
            check={c}
            onChange={(p) => set((d) => ({ ...d, checks: patchAt(d.checks, i, p) }))}
            onRemove={() => set((d) => ({ ...d, checks: removeAt(d.checks, i) }))}
          />
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            leading={<Plus size={14} aria-hidden />}
            onClick={() => set((d) => ({ ...d, checks: [...d.checks, emptyCheck()] }))}
          >
            Add a check
          </Button>
        </div>
        <p className="m-0 text-xs text-chalk-dim">
          Checks only read Redis. The text a player sees for each failing check is its message.
        </p>
      </>
    );
  }
  return (
    <>
      {draft.quizzes.map((q, qi) => (
        <div
          key={qi}
          className="flex flex-col gap-3 rounded-md border border-night-700 bg-night-900/60 p-3"
          data-testid={`quiz-${qi}`}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <TextInput
              label={`Question ${qi + 1}`}
              value={q.question}
              onChange={(question) =>
                set((d) => ({ ...d, quizzes: patchAt(d.quizzes, qi, { question }) }))
              }
            />
            <IconButton
              label={`Remove question ${qi + 1}`}
              icon={<Trash2 size={16} aria-hidden />}
              variant="quiet"
              onClick={() => set((d) => ({ ...d, quizzes: removeAt(d.quizzes, qi) }))}
            />
          </div>
          {q.options.map((o, oi) => (
            <div key={oi} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <TextInput
                  label={`Option ${oi + 1}`}
                  value={o.label}
                  onChange={(label) =>
                    set((d) => ({
                      ...d,
                      quizzes: patchAt(d.quizzes, qi, {
                        options: patchAt(q.options, oi, { label }),
                      }),
                    }))
                  }
                />
                {o.correct ? (
                  <div className="flex items-end pb-2 text-xs text-chalk-dim">
                    Correct answer: the explanation below is shown.
                  </div>
                ) : (
                  <TextInput
                    label="Why it is wrong"
                    value={o.because}
                    onChange={(because) =>
                      set((d) => ({
                        ...d,
                        quizzes: patchAt(d.quizzes, qi, {
                          options: patchAt(q.options, oi, { because }),
                        }),
                      }))
                    }
                  />
                )}
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Tick
                  label="Correct"
                  checked={o.correct}
                  onChange={(correct) =>
                    set((d) => ({
                      ...d,
                      quizzes: patchAt(d.quizzes, qi, {
                        options: patchAt(q.options, oi, { correct }),
                      }),
                    }))
                  }
                />
                <IconButton
                  label={`Remove option ${oi + 1} of question ${qi + 1}`}
                  icon={<Trash2 size={16} aria-hidden />}
                  variant="quiet"
                  onClick={() =>
                    set((d) => ({
                      ...d,
                      quizzes: patchAt(d.quizzes, qi, { options: removeAt(q.options, oi) }),
                    }))
                  }
                />
              </div>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              leading={<Plus size={14} aria-hidden />}
              onClick={() =>
                set((d) => ({
                  ...d,
                  quizzes: patchAt(d.quizzes, qi, {
                    options: [...q.options, { label: '', correct: false, because: '' }],
                  }),
                }))
              }
            >
              Add an option
            </Button>
          </div>
          <TextInput
            label="Explanation of the right answer"
            value={q.explanation}
            onChange={(explanation) =>
              set((d) => ({ ...d, quizzes: patchAt(d.quizzes, qi, { explanation }) }))
            }
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          leading={<Plus size={14} aria-hidden />}
          onClick={() => set((d) => ({ ...d, quizzes: [...d.quizzes, emptyQuiz()] }))}
        >
          Add a question
        </Button>
      </div>
    </>
  );
}

export function SolutionFields({ draft, set }: { draft: Draft; set: SetDraft }) {
  return (
    <>
      <TextArea
        label="Reference solution"
        rows={5}
        mono
        value={draft.reference}
        onChange={(reference) => set((d) => ({ ...d, reference }))}
        placeholder={'INCR canteen:tokens:today\nEXPIRE canteen:tokens:today 3600'}
        hint="The commands that solve the level, one per line. The play-test runs them and checks that every check passes."
      />
      {draft.wrong.map((w, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-md border border-night-700 bg-night-900/60 p-3"
          data-testid={`wrong-${i}`}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <Select
              label={`Known-wrong solution ${i + 1}`}
              value={w.expect}
              onChange={(expect) =>
                set((d) => ({
                  ...d,
                  wrong: patchAt(d.wrong, i, { expect: expect as 'wrong' | 'works_but_wrong' }),
                }))
              }
              options={[
                { value: 'wrong', label: 'Fails a check' },
                {
                  value: 'works_but_wrong',
                  label: 'Passes, but is wrong (needs an antipattern check)',
                },
              ]}
            />
            <IconButton
              label={`Remove known-wrong solution ${i + 1}`}
              icon={<Trash2 size={16} aria-hidden />}
              variant="quiet"
              onClick={() => set((d) => ({ ...d, wrong: removeAt(d.wrong, i) }))}
            />
          </div>
          <TextArea
            label="Commands"
            rows={3}
            mono
            value={w.script}
            onChange={(script) => set((d) => ({ ...d, wrong: patchAt(d.wrong, i, { script }) }))}
          />
          <TextInput
            label="Why it is wrong"
            value={w.because}
            onChange={(because) => set((d) => ({ ...d, wrong: patchAt(d.wrong, i, { because }) }))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          leading={<Plus size={14} aria-hidden />}
          onClick={() =>
            set((d) => ({
              ...d,
              wrong: [...d.wrong, { script: '', expect: 'wrong', because: '' }],
            }))
          }
        >
          Add a known-wrong solution
        </Button>
      </div>
      <p className="m-0 text-xs text-chalk-dim">
        The play-test also runs every known-wrong solution and checks that it gets the verdict you
        declare. Every level needs at least one.
      </p>
    </>
  );
}
