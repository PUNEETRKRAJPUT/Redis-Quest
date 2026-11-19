'use client';
// A level as a match view: the brief (beats 1 to 5 on a timeline), the workspace (the tools the mode needs) and the
// scoreboard (check my work, the checks and the decision, hints, beat 7). The state machine below is the one the
// e2e tests cover; the presentation around it lives in src/match.
import { clsx } from 'clsx';
import { ArrowRight, ExternalLink, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { Button, celebrate, EmptyState, play, Skeleton, useReducedMotion } from '../design';
import { IdealWay } from '../level/IdealWay';
import { DrawnNotice, rebuiltIn } from '../level/interview';
import { RunTraffic } from '../level/RunTraffic';
import { SlotToggle } from '../level/SlotToggle';
import { Stage } from '../level/Stage';
import { Thread } from '../level/Thread';
import { ChecksList, VerdictBanner } from '../level/VerifyPanel';
import { Workbench } from '../level/Workbench';
import { AnswerSheet, type Answers } from '../match/AnswerSheet';
import { BigScreen } from '../match/BigScreen';
import { Brainstorm } from '../match/Brainstorm';
import { Hints } from '../match/Hints';
import { LevelHeader, MODE_LABEL } from '../match/LevelHeader';
import { MatchView, WidenToggle } from '../match/MatchView';
import { IdleTools, OpsWatch } from '../match/OpsWatch';
import { PassedPanel } from '../match/PassedPanel';
import { useDecision } from '../match/useDecision';
import { Markdown } from '../markdown';
import { PainPanel } from '../panels/MetricsPanel';
import { QuestLink } from '../shell/QuestLink';
import { ShowMe } from '../showme';
import { useQuest } from '../store';
import { announceUi } from '../ws';
import type { LevelData, Verdict, VerifyResponse } from '../types';

function NextStep({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-5"
      trailing={<ArrowRight size={14} aria-hidden />}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Light({ state }: { state: 'up' | 'down' | 'unknown' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'mt-[7px] size-2 shrink-0 rounded-full',
        state === 'up' && 'bg-turf shadow-[0_0_8px_rgb(46_226_129/0.9)]',
        state === 'down' && 'bg-wicket shadow-[0_0_8px_rgb(255_84_104/0.9)]',
        state === 'unknown' && 'bg-chalk-faint',
      )}
    />
  );
}

// Lesson text: a comfortable measure and size. The markdown component spaces its own blocks.
const LESSON = 'max-w-[68ch] text-base leading-[1.65] text-chalk';

export function LevelScreen({ id }: { id: string }) {
  const progress = useQuest((s) => s.progress);
  const chapters = useQuest((s) => s.chapters);
  const health = useQuest((s) => s.health);
  const redisUp = useQuest((s) => s.redisUp);
  const [level, setLevel] = useState<LevelData | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true });
  const [answers, setAnswers] = useState<Answers>({});
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [wantIdeal, setWantIdeal] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [confirmingHint, setConfirmingHint] = useState(false);
  const keepXpRef = useRef<HTMLButtonElement>(null);
  const [bsOption, setBsOption] = useState<string>('');
  const [bsText, setBsText] = useState('');
  const [bsEditing, setBsEditing] = useState(false);
  const [bsError, setBsError] = useState<string | null>(null);
  const started = useRef<string | null>(null);
  // Presentation only: the review on the big screen, and where focus goes after it.
  const reduced = useReducedMotion();
  const [justPassed, setJustPassed] = useState(false);
  const verifyRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLAnchorElement>(null);
  const firstFailRef = useRef<HTMLLIElement>(null);

  const lp = progress?.levels[id];
  const status = lp?.status;
  const failed = (lp?.verdicts ?? []).filter(
    (v) => v.verdict === 'wrong' || v.verdict === 'works_but_wrong',
  ).length;
  const passed = status === 'passed';
  const idealAllowed = passed || (lp?.attempts ?? 0) >= 3 || failed >= 3;
  const idealUnlocked = idealAllowed || wantIdeal;

  const load = useCallback(async () => {
    try {
      setLevel(await api.level(id));
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? { code: e.code, message: e.message }
          : { code: 'error', message: String(e) },
      );
    }
  }, [id]);

  // Entering a level: reset the screen, start it once if it is only "available", then load it.
  useEffect(() => {
    setLevel(null);
    setResult(null);
    setVerifyError(null);
    setAnswers({});
    setWantIdeal(false);
    setConfirmingHint(false);
    setBsEditing(false);
    setOpen({ 1: true });
    started.current = null;
    void (async () => {
      const st = useQuest.getState().progress?.levels[id]?.status;
      if (st === 'available') {
        try {
          await api.start(id);
        } catch (e) {
          setError(
            e instanceof ApiError
              ? { code: e.code, message: e.message }
              : { code: 'error', message: String(e) },
          );
          return;
        }
        started.current = id;
        // Event verifiers look back to startedAt, so tell the engine this page is connected after the start.
        announceUi();
      }
      await load();
    })();
    void api
      .health()
      .then((h) => useQuest.setState({ health: h }))
      .catch(() => undefined);
  }, [id, load]);

  // Reload when the engine says this level's progress changed (hint, brainstorm, verify, completed).
  const stamp = JSON.stringify(lp ?? null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (level) void load();
    // `stamp` is the dependency on purpose: it changes exactly when this level's progress entry changes.
  }, [stamp]);

  // The traffic verifier switches slots on and puts them back, so the "run my code in the app" switch is
  // re-read whenever a verification ends.
  const lastEvent = useQuest((s) => s.events[s.events.length - 1]);
  const seenEvent = useRef<number>(lastEvent?.seq ?? 0);
  useEffect(() => {
    if (!lastEvent || lastEvent.seq === seenEvent.current) return;
    seenEvent.current = lastEvent.seq;
    if (lastEvent.kind === 'custom' && lastEvent.name === 'verify_finished' && level) void load();
  }, [lastEvent, level, load]);

  // The prompt opens on the safe choice, so Enter or Space keeps the XP. When it closes, focus goes back to the
  // hint button (the dialog leaves the page when it closes, so the browser cannot return focus itself).
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirmingHint) keepXpRef.current?.focus();
    else if (wasConfirming.current) hintRef.current?.focus();
    wasConfirming.current = confirmingHint;
  }, [confirmingHint]);

  useEffect(() => {
    if (level?.brainstormAnswer && !bsEditing) {
      setBsOption(level.brainstormAnswer.optionId);
      setBsText(level.brainstormAnswer.text);
    }
  }, [level?.brainstormAnswer, bsEditing]);

  const toggle = (n: number) => setOpen((o) => ({ ...o, [n]: !o[n] }));
  const openStage = (n: number) => setOpen((o) => ({ ...o, [n]: true }));
  // Brings a stage to the top of its pane, under the pane's sticky header (only the pane scrolls, never the page).
  const scrollToStage = useCallback(
    (n: number) => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-testid="stage-${n}"]`)].find(
        (x) => x.offsetParent !== null,
      );
      const pane = el?.closest<HTMLElement>('[data-pane-scroll]');
      if (!el || !pane) return;
      const sticky = pane.querySelector<HTMLElement>('[data-sticky]')?.offsetHeight ?? 0;
      const top =
        el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
      pane.scrollTo({ top: Math.max(0, top - sticky - 8), behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );
  // The "Next" buttons: open the stage and bring it into view.
  const goStage = (n: number) => {
    openStage(n);
    requestAnimationFrame(() => scrollToStage(n));
  };

  const decision = useDecision({
    verifying,
    result,
    reduced,
    onReveal: (v: Verdict) => {
      if (v === 'right') {
        setJustPassed(true);
        celebrate({ confetti: { y: 0.18 } });
      } else if (v === 'wrong') play('out');
      else if (v === 'works_but_wrong') play('pager');
    },
    onSettle: (v: Verdict) => {
      requestAnimationFrame(() => {
        if (v === 'right') nextRef.current?.focus({ preventScroll: false });
        else if (v === 'wrong' || v === 'works_but_wrong') {
          firstFailRef.current?.focus({ preventScroll: true });
          scrollToStage(6);
        }
      });
    },
  });

  const chapter = chapters?.chapters.find((c) => c.id === level?.chapter);
  const next = useMemo(() => {
    if (!chapters) return null;
    const flat = chapters.chapters.flatMap((c) => c.levels);
    const i = flat.findIndex((l) => l.id === id);
    const n = i >= 0 ? flat[i + 1] : undefined;
    return n && n.status !== 'locked' ? n : null;
  }, [chapters, id]);

  if (error) {
    return (
      <main data-ds="" className="grid min-h-[60vh] place-items-center px-4 text-chalk">
        <EmptyState
          title={
            error.code === 'level_locked'
              ? 'This level is still locked'
              : 'Could not open this level'
          }
          action={
            <QuestLink
              to="/"
              className="inline-flex h-10 items-center rounded-md bg-flood-500 px-4 text-md font-semibold text-on-flood hover:bg-flood-400"
            >
              Back to the map
            </QuestLink>
          }
        >
          {error.code === 'level_locked'
            ? 'Pass the level before it first. The map shows where you are.'
            : error.message}
        </EmptyState>
      </main>
    );
  }
  if (!level || !progress) {
    return (
      <main data-ds="" className="flex flex-col gap-4 px-6 py-5" aria-busy="true">
        <p className="sr-only">Opening the level...</p>
        <Skeleton className="h-10 w-1/3 rounded-md" label="Opening the level" />
        <div className="grid grid-cols-[34fr_40fr_26fr] gap-3">
          <Skeleton className="h-[60vh] rounded-lg" />
          <Skeleton className="h-[60vh] rounded-lg" />
          <Skeleton className="h-[60vh] rounded-lg" />
        </div>
      </main>
    );
  }

  const submitBrainstorm = async () => {
    setBsError(null);
    try {
      await api.brainstorm(id, bsOption, bsText.trim());
      setBsEditing(false);
      openStage(4);
      await load();
    } catch (e) {
      setBsError(e instanceof Error ? e.message : String(e));
    }
  };

  const revealHint = async () => {
    setConfirmingHint(false);
    setHintBusy(true);
    try {
      await api.hint(id);
      await load();
    } catch {
      /* no_more_hints: the button is disabled once all are shown */
    }
    setHintBusy(false);
  };

  const verify = async () => {
    decision.start();
    setVerifying(true);
    setVerifyError(null);
    setResult(null);
    openStage(6);
    const payload: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(answers))
      if (Array.isArray(v) ? v.length : v.trim()) payload[k] = v;
    try {
      const r = await api.verify(id, payload);
      setResult(r);
      if (r.verdict === 'right' || r.verdict === 'works_but_wrong') openStage(7);
      await load();
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : String(e));
    }
    setVerifying(false);
  };

  const goCheck = () => {
    openStage(6);
    verifyRef.current?.querySelector<HTMLButtonElement>('[data-testid="verify-button"]')?.focus();
  };

  const guessed = level.brainstormAnswer !== null;
  const quizzes = level.verifiers.filter(
    (v): v is Extract<typeof v, { type: 'quiz' }> => v.type === 'quiz',
  );
  const answerBoxes = level.verifiers.filter(
    (v): v is Extract<typeof v, { type: 'answer' }> => v.type === 'answer',
  );
  const incident = chapter?.incident ?? [];
  const firstInChapter = chapter?.levels[0]?.id === id;
  const benchStart = level.mode === 'cli' ? 'terminal' : level.mode === 'code' ? 'editor' : null;
  const interview = level.interview;
  // E-04: the first quiz that is a follow-up question from the interviewer (pool levels, once drawn).
  const firstFollowUp = quizzes.find(
    (q) => q.index >= (interview?.questionsFrom ?? Infinity),
  )?.index;
  const hintCost = interview?.hintXpCost ?? 0;
  const rebuilt = rebuiltIn(interview);
  const position = chapter
    ? { n: chapter.levels.findIndex((l) => l.id === id) + 1, of: chapter.levels.length }
    : null;
  const decisionMode = level.mode === 'decision';
  const pending = decision.phase === 'pending';
  // The scoreboard keeps the result to itself until the big screen has revealed it.
  const shownResult = decision.revealed ? result : null;
  const sheet = (
    <AnswerSheet
      quizzes={quizzes}
      answerBoxes={answerBoxes}
      answers={answers}
      setAnswers={setAnswers}
      questionsFrom={interview?.questionsFrom}
      firstFollowUp={firstFollowUp}
      variant={decisionMode ? 'sheet' : 'compact'}
    />
  );
  const hasSheet = quizzes.length + answerBoxes.length > 0;

  const brief = (
    <div className="pb-6 pt-2">
      <Stage n={1} title="Scenario" open={!!open[1]} onToggle={() => toggle(1)}>
        {incident.length ? (
          <details
            open={firstInChapter}
            className="group/thread mb-4 rounded-md border border-night-600/60 bg-night-950/40"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-chalk-dim hover:text-chalk [&::-webkit-details-marker]:hidden">
              <ArrowRight
                size={13}
                aria-hidden
                className="transition-transform duration-fast group-open/thread:rotate-90"
              />
              The chapter thread, the way it arrived
            </summary>
            <div className="px-3 pb-3">
              <Thread messages={incident} label={`${level.chapterTitle} incident thread`} />
            </div>
          </details>
        ) : null}
        <div className={LESSON}>
          <Markdown source={level.story} />
        </div>
        <NextStep onClick={() => goStage(2)}>Next: what already exists</NextStep>
      </Stage>

      <Stage n={2} title="What already exists" open={!!open[2]} onToggle={() => toggle(2)}>
        <ul className="m-0 flex max-w-[68ch] list-none flex-col gap-2.5 p-0 text-md leading-relaxed text-chalk-dim">
          <li className="flex gap-2.5">
            <Light state={redisUp === null ? 'unknown' : redisUp ? 'up' : 'down'} />
            <span>
              Your Redis client is already connected:{' '}
              <strong className="text-chalk" data-testid="redis-state">
                {redisUp === null ? 'checking' : redisUp ? 'Redis is up' : 'Redis is down'}
              </strong>
              .
            </span>
          </li>
          <li className="flex gap-2.5">
            <Light
              state={!health ? 'unknown' : health.postgres === 'up' && health.ok ? 'up' : 'down'}
            />
            <span>
              Postgres:{' '}
              <strong className="text-chalk">{health ? health.postgres : 'checking'}</strong>.
              Engine:{' '}
              <strong className="text-chalk">
                {health ? (health.ok ? 'ok' : 'unhealthy') : 'checking'}
              </strong>
              .
            </span>
          </li>
          {level.mode === 'cli' ? (
            <li className="pl-[18px]">
              The terminal in the workspace talks to the same Redis the app uses.
            </li>
          ) : null}
          {level.mode === 'code' ? (
            <li className="pl-[18px]">
              You only fill in one function in{' '}
              <code className="font-mono text-sm text-chalk">workspace/{level.chapter}/</code>. The
              client (<code className="font-mono text-sm text-chalk">redis</code>), the database (
              <code className="font-mono text-sm text-chalk">db</code>) and{' '}
              <code className="font-mono text-sm text-chalk">log</code> are handed to you.
            </li>
          ) : null}
          {level.mode === 'ops' ? (
            <li className="pl-[18px]">
              This one happens on your Mac, in the repo folder. The game watches from the outside.
            </li>
          ) : null}
          {level.mode === 'decision' ? (
            <li className="pl-[18px]">
              There is no code to write. You choose, and the game checks your reasoning.
            </li>
          ) : null}
          <li className="pl-[18px]">
            {level.scenario ? (
              <>
                Load scenario <code className="font-mono text-sm text-chalk">{level.scenario}</code>{' '}
                runs against the app when you verify.
              </>
            ) : (
              'No load test is attached to this level.'
            )}
          </li>
        </ul>
        <h3 className="label-caps mb-2 mt-5 text-xs text-chalk-dim">Live pain</h3>
        <PainPanel />
        <NextStep onClick={() => goStage(3)}>Next: brainstorm</NextStep>
      </Stage>

      <Stage
        n={3}
        title="Brainstorm"
        chip={guessed ? 'guess locked in' : 'not yet'}
        tone={guessed ? 'done' : 'neutral'}
        open={!!open[3]}
        onToggle={() => toggle(3)}
      >
        <Brainstorm
          level={level}
          option={bsOption}
          text={bsText}
          editing={bsEditing}
          error={bsError}
          onOption={setBsOption}
          onText={setBsText}
          onEdit={() => setBsEditing(true)}
          onSubmit={() => void submitBrainstorm()}
        />
      </Stage>

      {interview ? (
        <Stage
          n={4}
          title="Teach"
          chip="skipped"
          tone="locked"
          open={!!open[4]}
          onToggle={() => toggle(4)}
        >
          <p className="m-0 text-base text-chalk-dim" data-testid="no-teaching">
            No teaching here: this is the interview.
          </p>
          <NextStep onClick={() => goStage(5)}>Next: build</NextStep>
        </Stage>
      ) : (
        <Stage n={4} title="Teach" open={!!open[4]} onToggle={() => toggle(4)}>
          <div className={LESSON}>
            <Markdown source={level.teach} />
          </div>
          {level.docs.length ? (
            <div className="mt-4 flex max-w-[68ch] flex-wrap items-center gap-2">
              <span className="label-caps text-xs text-chalk-dim">Official docs</span>
              {level.docs.map((d) => (
                <a
                  key={d}
                  href={d}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 truncate rounded-sm border border-sky/30 bg-sky/5 px-2 py-1 text-sm text-sky transition-colors duration-fast hover:border-sky/60 hover:bg-sky/10"
                >
                  <span className="truncate">{d.replace('https://', '')}</span>
                  <ExternalLink size={12} aria-hidden className="shrink-0" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ))}
            </div>
          ) : null}
          <NextStep onClick={() => goStage(5)}>Next: build</NextStep>
        </Stage>
      )}

      <Stage
        n={5}
        title={`Build (${MODE_LABEL[level.mode].toLowerCase()})`}
        open={!!open[5]}
        onToggle={() => toggle(5)}
        last
      >
        {interview ? <DrawnNotice interview={interview} /> : null}
        <div className={LESSON}>
          <Markdown source={level.task} className="task" />
        </div>
        <p className="mb-0 mt-4 max-w-[68ch] rounded-md border border-night-600/60 bg-night-950/50 px-3 py-2 text-sm text-chalk-dim">
          {level.mode === 'code'
            ? 'Write it in the editor next door; the terminal is docked under it. Save, then check your work.'
            : level.mode === 'cli'
              ? 'Type in the terminal next door. When the data looks right, check your work.'
              : level.mode === 'ops'
                ? 'Run it on your Mac. The workspace next door shows what the game has seen.'
                : 'Answer in the workspace next door, then check your work.'}
        </p>
        <NextStep onClick={goCheck}>Next: check my work</NextStep>
      </Stage>
    </div>
  );

  const footer =
    level.slots?.own.length || level.scenario ? (
      <>
        <SlotToggle levelId={id} slots={level.slots} reload={load} />
        {level.scenario ? <RunTraffic scenario={level.scenario} /> : null}
      </>
    ) : null;

  const workspace = (
    <Workbench
      initial={benchStart}
      // A finale mock interview rebuilds a level from another chapter: open that chapter's file, not the finale's.
      chapter={level.interview?.drawn?.chapter ?? level.chapter}
      dock={level.mode === 'code'}
      answers={decisionMode && hasSheet ? sheet : undefined}
      idle={level.mode === 'ops' ? <OpsWatch onOpenTask={() => goStage(5)} /> : <IdleTools />}
      footer={footer}
    />
  );

  const checkBlock = (
    <div ref={verifyRef} className="flex flex-col gap-2">
      <Button
        size="lg"
        variant={passed ? 'ghost' : 'primary'}
        className="w-full"
        onClick={() => void verify()}
        loading={verifying || pending}
        loadingText="Decision pending"
        leading={passed ? <RotateCcw size={17} aria-hidden /> : <Play size={17} aria-hidden />}
        data-testid="verify-button"
      >
        {passed ? 'Verify again' : 'Verify my work'}
      </Button>
      <p className="m-0 flex items-center justify-between px-0.5 text-xs text-chalk-dim">
        <span className="tabular">
          {level.attempts
            ? `${level.attempts} attempt${level.attempts === 1 ? '' : 's'} so far`
            : 'No attempts yet'}
        </span>
        <span className="tabular">
          {level.verifiers.length} check{level.verifiers.length === 1 ? '' : 's'}
        </span>
      </p>
      {verifyError ? (
        <p
          className="m-0 rounded-sm border border-wicket/40 bg-wicket/10 px-3 py-2 text-sm text-chalk"
          role="alert"
        >
          {verifyError}
        </p>
      ) : null}
    </div>
  );

  const showPassed = passed && !pending;
  const scoreboard = (
    <div className="flex flex-col pb-6">
      <div
        data-sticky=""
        className={clsx(
          'sticky top-0 z-10 flex flex-col gap-2 bg-night-900 px-4 pb-3 pt-3',
          !showPassed && 'border-b border-night-600/50 shadow-[0_8px_16px_-12px_rgb(0_0_0/0.8)]',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="label-caps flex-1 text-xs text-chalk-dim">Scoreboard</span>
          <WidenToggle />
        </div>
        {showPassed ? null : checkBlock}
      </div>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-3">
        {showPassed ? (
          <PassedPanel
            xp={level.reward.xp}
            badge={level.reward.badge}
            rebuilt={rebuilt ? `${rebuilt[0]?.toUpperCase()}${rebuilt.slice(1)}.` : null}
            justPassed={justPassed}
            next={next}
            nextRef={nextRef}
            showMe={
              level.showMe ? (
                <ShowMe
                  spec={level.showMe}
                  playerId={progress.player.id}
                  interactive={level.status === 'passed'}
                />
              ) : null
            }
          />
        ) : null}
        {!decisionMode && hasSheet ? (
          <div className="rounded-lg border border-night-600/60 bg-night-950/40 p-3">
            <div className="label-caps mb-2.5 text-xs text-chalk-dim">Your answers</div>
            {sheet}
          </div>
        ) : null}
        {showPassed ? checkBlock : null}
        <Hints
          hints={level.hints}
          total={level.hintsTotal}
          interview={!!interview}
          cost={hintCost}
          xp={progress.xp}
          busy={hintBusy}
          confirming={confirmingHint}
          onAsk={() => (interview ? setConfirmingHint(true) : void revealHint())}
          onCancel={() => setConfirmingHint(false)}
          onReveal={() => void revealHint()}
          keepXpRef={keepXpRef}
          buttonRef={hintRef}
        />
      </div>
      <div className="border-t border-night-600/50 pt-2">
        <Stage
          n={6}
          title="The decision"
          chip={
            passed && !pending
              ? 'passed'
              : shownResult
                ? shownResult.verdict.replace(/_/g, ' ')
                : level.attempts
                  ? `${level.attempts} attempt${level.attempts === 1 ? '' : 's'}`
                  : undefined
          }
          tone={
            passed
              ? 'done'
              : shownResult && shownResult.verdict !== 'not_implemented'
                ? 'warn'
                : 'neutral'
          }
          open={!!open[6]}
          onToggle={() => toggle(6)}
        >
          <div className="flex flex-col gap-3">
            {shownResult ? <VerdictBanner result={shownResult} /> : null}
            {result?.overtime && shownResult ? (
              <p
                className="m-0 rounded-sm border border-wicket/40 bg-wicket/10 px-3 py-2 text-sm text-chalk"
                role="status"
                data-testid="overtime-note"
              >
                Overtime: this verify came after the {interview?.minutes}-minute limit. It was
                graded like any other, and the result is marked overtime.
              </p>
            ) : null}
            <ChecksList
              level={level}
              result={shownResult}
              verifying={verifying || pending}
              firstFailRef={firstFailRef}
            />
            {!shownResult && !verifying && !pending ? (
              <p className="m-0 text-sm leading-relaxed text-chalk-dim">
                {level.verifiers.length} check{level.verifiers.length === 1 ? '' : 's'} run when you
                press Verify my work. Each one says what it saw.
              </p>
            ) : null}
          </div>
        </Stage>
        <Stage
          n={7}
          title="The ideal way"
          chip={idealUnlocked ? 'unlocked' : `locked (${Math.min(failed, 3)} of 3 fails)`}
          tone={idealUnlocked ? 'done' : 'locked'}
          open={!!open[7]}
          onToggle={() => toggle(7)}
          last
        >
          <IdealWay
            level={level}
            allowed={idealAllowed}
            attempts={lp?.attempts ?? failed}
            fromVerify={result?.ideal}
            onRevealed={() => setWantIdeal(true)}
          />
        </Stage>
      </div>
    </div>
  );

  return (
    <MatchView
      data-testid="level-screen"
      data-level={id}
      data-status={level.status}
      data-mode={level.mode}
      header={<LevelHeader level={level} position={position} />}
      brief={brief}
      workspace={workspace}
      scoreboard={scoreboard}
      overlay={
        reduced ? null : (
          <BigScreen
            phase={decision.phase}
            verdict={result?.verdict ?? null}
            checks={level.verifiers.length}
            xp={level.reward.xp}
            onDismiss={decision.dismiss}
          />
        )
      }
    />
  );
}
