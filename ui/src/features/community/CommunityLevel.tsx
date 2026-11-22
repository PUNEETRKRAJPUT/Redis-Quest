'use client';
import { ArrowLeft, Lightbulb, Play, RotateCcw, Terminal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { ToolPage } from '../../career/ToolPage';
import { Button, EmptyState, Pill, Skeleton } from '../../design';
import { ChecksList, VerdictBanner } from '../../level/VerifyPanel';
import { Markdown } from '../../markdown';
import { AnswerSheet, type Answers, type AnswerBox, type Quiz } from '../../match/AnswerSheet';
import { Brainstorm } from '../../match/Brainstorm';
import { QuestLink } from '../../shell/QuestLink';
import type { VerifyResponse } from '../../types';
import { communityApi } from './client';
import { asLevelData, byline, type CommunityLevelData } from './types';

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** A small terminal for terminal levels: the same engine endpoint the game's terminal uses (POST /api/cli). */
function CliBox() {
  const [line, setLine] = useState('');
  const [log, setLog] = useState<{ command: string; reply: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [log]);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    const command = line.trim();
    if (!command || busy) return;
    setBusy(true);
    try {
      const r = await api.cli(command);
      setLog((l) => [...l, { command, reply: r.reply }]);
      setLine('');
    } catch (err) {
      setLog((l) => [...l, { command, reply: `(${messageOf(err)})` }]);
    }
    setBusy(false);
  };
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-night-700 bg-night-950 p-3"
      data-testid="community-cli"
    >
      <div className="label-caps flex items-center gap-1.5 text-xs text-chalk-dim">
        <Terminal size={12} aria-hidden /> Redis terminal
      </div>
      <div
        className="max-h-64 overflow-auto font-mono text-xs leading-relaxed text-chalk"
        role="log"
        aria-label="Terminal output"
      >
        {log.map((l, i) => (
          <div key={i}>
            <div className="text-flood-400">$ {l.command}</div>
            <div className="whitespace-pre-wrap">{l.reply}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => void run(e)} className="flex gap-2">
        <label className="sr-only" htmlFor="community-cli-input">
          Redis command
        </label>
        <input
          id="community-cli-input"
          className="h-9 min-w-0 flex-1 rounded-md border border-night-600 bg-night-900 px-3 font-mono text-sm text-chalk placeholder:text-chalk-faint"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder="INCR some:key"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" variant="ghost" disabled={busy || !line.trim()}>
          Run
        </Button>
      </form>
    </div>
  );
}

export function CommunityLevel({ id }: { id: string }) {
  const [level, setLevel] = useState<CommunityLevelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [bsOption, setBsOption] = useState('');
  const [bsText, setBsText] = useState('');
  const [bsEditing, setBsEditing] = useState(false);
  const [bsError, setBsError] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLevel(await communityApi.level(id));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [id]);

  // Entering a level: a level nobody has started is started once (its setup runs), then loaded.
  useEffect(() => {
    setLevel(null);
    setResult(null);
    setAnswers({});
    void (async () => {
      try {
        const first = await communityApi.level(id);
        if (first.status === 'new') await communityApi.start(id);
        setLevel(first.status === 'new' ? await communityApi.level(id) : first);
        setError(null);
      } catch (e) {
        setError(messageOf(e));
      }
    })();
  }, [id]);

  useEffect(() => {
    if (level?.brainstormAnswer && !bsEditing) {
      setBsOption(level.brainstormAnswer.optionId);
      setBsText(level.brainstormAnswer.text);
    }
  }, [level?.brainstormAnswer, bsEditing]);

  if (error) {
    return (
      <main data-ds="" className="grid min-h-[60vh] place-items-center px-4 text-chalk">
        <EmptyState
          title="Could not open this level"
          action={
            <QuestLink
              to="/community"
              className="inline-flex h-10 items-center rounded-md bg-flood-500 px-4 text-md font-semibold text-on-flood hover:bg-flood-400"
            >
              Back to the community levels
            </QuestLink>
          }
        >
          {error}
        </EmptyState>
      </main>
    );
  }
  if (!level) {
    return (
      <main
        data-ds=""
        className="mx-auto flex max-w-[860px] flex-col gap-4 px-6 py-8"
        aria-busy="true"
      >
        <Skeleton className="h-10 w-1/3 rounded-md" label="Opening the level" />
        <Skeleton className="h-64 rounded-lg" />
      </main>
    );
  }

  const quizzes = level.verifiers.filter((v): v is Quiz => v.type === 'quiz');
  const boxes = level.verifiers.filter((v): v is AnswerBox => v.type === 'answer');
  const passed = level.status === 'passed';

  const restart = async () => {
    try {
      await communityApi.start(id);
      setResult(null);
      await load();
    } catch (e) {
      setVerifyError(messageOf(e));
    }
  };
  const submitBrainstorm = async () => {
    setBsError(null);
    try {
      await communityApi.brainstorm(id, bsOption, bsText.trim());
      setBsEditing(false);
      await load();
    } catch (e) {
      setBsError(messageOf(e));
    }
  };
  const revealHint = async () => {
    setHintBusy(true);
    try {
      await communityApi.hint(id);
      await load();
    } catch {
      /* no_more_hints: the button is gone once all are shown */
    }
    setHintBusy(false);
  };
  const verify = async () => {
    setVerifying(true);
    setVerifyError(null);
    setResult(null);
    const payload: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(answers))
      if (Array.isArray(v) ? v.length : v.trim()) payload[k] = v;
    try {
      setResult(await communityApi.verify(id, payload));
      await load();
    } catch (e) {
      setVerifyError(messageOf(e));
    }
    setVerifying(false);
  };

  const ideal = result?.ideal;

  return (
    <ToolPage
      eyebrow={`Community level · pack ${level.community.pack}`}
      title={level.title}
      testId="community-level"
      blurb={`By ${byline(level.community.author)}. No XP, no badge: this one is for practice.`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={passed ? 'turf' : level.status === 'in_progress' ? 'flood' : 'neutral'}>
            {passed ? 'Passed' : level.status === 'in_progress' ? 'In progress' : 'New'}
          </Pill>
          <QuestLink
            to="/community"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-night-600 px-3 text-sm text-chalk-dim hover:text-chalk"
          >
            <ArrowLeft size={14} aria-hidden /> All community levels
          </QuestLink>
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-8">
        <section aria-label="Story" className="flex flex-col gap-3">
          <Markdown
            source={level.story}
            className="max-w-[68ch] text-base leading-[1.65] text-chalk"
          />
        </section>
        <section aria-label="Brainstorm">
          <Brainstorm
            level={asLevelData(level)}
            option={bsOption}
            text={bsText}
            editing={bsEditing}
            error={bsError}
            onOption={setBsOption}
            onText={setBsText}
            onEdit={() => setBsEditing(true)}
            onSubmit={() => void submitBrainstorm()}
          />
        </section>
        <section aria-label="Teaching" className="flex flex-col gap-2">
          <h2 className="label-caps m-0 text-xs text-flood-400">What to know</h2>
          <Markdown
            source={level.teach}
            className="max-w-[68ch] text-base leading-[1.65] text-chalk"
          />
        </section>
        <section
          aria-label="Task"
          className="flex flex-col gap-3 rounded-lg border border-flood-500/40 p-4"
        >
          <h2 className="label-caps m-0 text-xs text-flood-400">Your task</h2>
          <Markdown
            source={level.task}
            className="max-w-[68ch] text-base leading-[1.65] text-chalk"
          />
          {level.mode === 'cli' ? <CliBox /> : null}
          <AnswerSheet
            quizzes={quizzes}
            answerBoxes={boxes}
            answers={answers}
            setAnswers={setAnswers}
            questionsFrom={null}
            firstFollowUp={undefined}
            variant={level.mode === 'decision' ? 'sheet' : 'compact'}
          />
        </section>
        {level.hintsTotal > 0 ? (
          <section aria-label="Hints" className="flex flex-col gap-2">
            {level.hints.map((h, i) => (
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
            {level.hints.length < level.hintsTotal ? (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={hintBusy}
                  leading={<Lightbulb size={14} aria-hidden />}
                  onClick={() => void revealHint()}
                >
                  Show a hint ({level.hints.length} of {level.hintsTotal})
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        <section aria-label="Check your work" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={verifying}
              loadingText="Checking"
              leading={<Play size={16} aria-hidden />}
              onClick={() => void verify()}
              data-testid="verify-button"
            >
              Check my work
            </Button>
            <Button
              variant="quiet"
              leading={<RotateCcw size={16} aria-hidden />}
              onClick={() => void restart()}
            >
              Reset the level
            </Button>
          </div>
          {verifyError ? (
            <p className="m-0 text-sm text-wicket" role="alert">
              {verifyError}
            </p>
          ) : null}
          {result ? <VerdictBanner result={result} /> : null}
          <ChecksList level={asLevelData(level)} result={result} verifying={verifying} />
          {ideal ? (
            <div
              className="flex flex-col gap-2 rounded-md border border-night-700 p-3"
              data-testid="community-ideal"
            >
              <div className="label-caps text-xs text-chalk-dim">
                The author&rsquo;s model answer
              </div>
              {ideal.mode === 'decision' ? (
                <ul className="m-0 list-disc pl-5 text-sm text-chalk">
                  {ideal.quizzes.map((q) => (
                    <li key={q.index}>
                      {q.question}: {q.explanation}
                    </li>
                  ))}
                </ul>
              ) : (
                <pre className="m-0 overflow-x-auto rounded-sm bg-night-950 p-3 font-mono text-xs leading-relaxed text-chalk">
                  {ideal.reference.content}
                </pre>
              )}
              <p className="m-0 text-sm text-chalk-dim">{ideal.reasoning}</p>
            </div>
          ) : null}
        </section>
      </div>
    </ToolPage>
  );
}
