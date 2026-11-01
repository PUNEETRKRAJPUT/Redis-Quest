import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { IdealWay } from '../level/IdealWay';
import { Stage } from '../level/Stage';
import { Thread } from '../level/Thread';
import { ChecksList, VerdictBanner } from '../level/VerifyPanel';
import { Workbench } from '../level/Workbench';
import { IconBulb, IconCheck, IconSpinner } from '../icons';
import { Markdown } from '../markdown';
import { PainPanel } from '../panels/MetricsPanel';
import { hrefFor } from '../router';
import { ShowMe } from '../showme';
import { useQuest } from '../store';
import { announceUi } from '../ws';
import type { LevelData, VerifyResponse } from '../types';

const MODE_LABEL = { cli: 'Terminal', code: 'Code', ops: 'Ops', decision: 'Decision' } as const;

export function LevelScreen({ id }: { id: string }) {
  const progress = useQuest((s) => s.progress);
  const chapters = useQuest((s) => s.chapters);
  const health = useQuest((s) => s.health);
  const redisUp = useQuest((s) => s.redisUp);
  const [level, setLevel] = useState<LevelData | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true });
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [wantIdeal, setWantIdeal] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [bsOption, setBsOption] = useState<string>('');
  const [bsText, setBsText] = useState('');
  const [bsEditing, setBsEditing] = useState(false);
  const [bsError, setBsError] = useState<string | null>(null);
  const started = useRef<string | null>(null);

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

  useEffect(() => {
    if (level?.brainstormAnswer && !bsEditing) {
      setBsOption(level.brainstormAnswer.optionId);
      setBsText(level.brainstormAnswer.text);
    }
  }, [level?.brainstormAnswer, bsEditing]);

  const toggle = (n: number) => setOpen((o) => ({ ...o, [n]: !o[n] }));
  const openStage = (n: number) => setOpen((o) => ({ ...o, [n]: true }));

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
      <main className="page narrow">
        <h1>
          {error.code === 'level_locked'
            ? 'This level is still locked'
            : 'Could not open this level'}
        </h1>
        <p>
          {error.code === 'level_locked'
            ? 'Pass the level before it first. The map shows where you are.'
            : error.message}
        </p>
        <a className="btn" href="#/">
          Back to the map
        </a>
      </main>
    );
  }
  if (!level || !progress) {
    return (
      <main className="page narrow" aria-busy="true">
        <p className="muted">
          <IconSpinner /> Opening the level...
        </p>
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
  const hintsShown = level.hints.length;

  return (
    <main
      className="page level"
      data-testid="level-screen"
      data-level={id}
      data-status={level.status}
    >
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="#/">Map</a> <span aria-hidden="true">/</span> <span>{level.chapterTitle}</span>
      </nav>
      <header className="level-head">
        <div>
          <h1>{level.title}</h1>
          <p className="muted">
            <span className="pill">{MODE_LABEL[level.mode]}</span>{' '}
            <span className="pill">{level.reward.xp} XP</span>
            {level.reward.badge ? (
              <>
                {' '}
                <span className="pill badge">Badge: {level.reward.badge}</span>
              </>
            ) : null}
            {level.minRedisVersion ? (
              <>
                {' '}
                <span className="pill">Redis {level.minRedisVersion}+</span>
              </>
            ) : null}
          </p>
        </div>
        <span className={`status-chip ${level.status}`} data-testid="level-status">
          {level.status.replace('_', ' ')}
        </span>
      </header>

      <Stage n={1} title="Scenario" open={!!open[1]} onToggle={() => toggle(1)}>
        {incident.length ? (
          <details open={firstInChapter} className="incident">
            <summary>The chapter thread, the way it arrived</summary>
            <Thread messages={incident} label={`${level.chapterTitle} incident thread`} />
          </details>
        ) : null}
        <Markdown source={level.story} />
        <button type="button" className="btn" onClick={() => openStage(2)}>
          Next: what already exists
        </button>
      </Stage>

      <Stage n={2} title="What already exists" open={!!open[2]} onToggle={() => toggle(2)}>
        <ul className="exists">
          <li>
            Your Redis client is already connected:{' '}
            <strong data-testid="redis-state">
              {redisUp === null ? 'checking' : redisUp ? 'Redis is up' : 'Redis is down'}
            </strong>
            .
          </li>
          <li>
            Postgres: <strong>{health ? health.postgres : 'checking'}</strong>. Engine:{' '}
            <strong>{health ? (health.ok ? 'ok' : 'unhealthy') : 'checking'}</strong>.
          </li>
          {level.mode === 'cli' ? (
            <li>The terminal in the next steps talks to the same Redis the app uses.</li>
          ) : null}
          {level.mode === 'code' ? (
            <li>
              You only fill in one function in <code>workspace/{level.chapter}/</code>. The client (
              <code>redis</code>), the database (<code>db</code>) and <code>log</code> are handed to
              you.
            </li>
          ) : null}
          {level.mode === 'ops' ? (
            <li>
              This one happens on your Mac, in the repo folder. The game watches from the outside.
            </li>
          ) : null}
          {level.mode === 'decision' ? (
            <li>There is no code to write. You choose, and the game checks your reasoning.</li>
          ) : null}
          <li>
            {level.scenario ? (
              <>
                Load scenario <code>{level.scenario}</code> runs against the app when you verify.
              </>
            ) : (
              'No load test is attached to this level.'
            )}
          </li>
        </ul>
        <h3 className="mini">Live pain</h3>
        <PainPanel />
        <button type="button" className="btn" onClick={() => openStage(3)}>
          Next: brainstorm
        </button>
      </Stage>

      <Stage
        n={3}
        title="Brainstorm"
        chip={guessed ? 'guess locked in' : 'not yet'}
        tone={guessed ? 'done' : 'neutral'}
        open={!!open[3]}
        onToggle={() => toggle(3)}
      >
        <p>
          <strong>{level.brainstorm.prompt}</strong>
        </p>
        <p className="muted">
          Nothing is graded here. Commit to a guess first, then learn what the answer is.
        </p>
        {guessed && !bsEditing ? (
          <div className="locked-guess" data-testid="brainstorm-locked">
            <p>
              {
                level.brainstorm.options.find((o) => o.id === level.brainstormAnswer?.optionId)
                  ?.label
              }
            </p>
            <p className="quote">{level.brainstormAnswer?.text}</p>
            <button type="button" className="btn ghost" onClick={() => setBsEditing(true)}>
              Change my guess
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitBrainstorm();
            }}
          >
            <fieldset className="options">
              <legend className="sr-only">Pick one approach</legend>
              {level.brainstorm.options.map((o) => (
                <label key={o.id} className={bsOption === o.id ? 'option on' : 'option'}>
                  <input
                    type="radio"
                    name="bs"
                    value={o.id}
                    checked={bsOption === o.id}
                    onChange={() => setBsOption(o.id)}
                    data-testid={`brainstorm-option-${o.id}`}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="field">
              One line: why?
              <input
                type="text"
                value={bsText}
                maxLength={500}
                onChange={(e) => setBsText(e.target.value)}
                placeholder="Because..."
                data-testid="brainstorm-text"
              />
            </label>
            {bsError ? (
              <p className="callout warn" role="alert">
                {bsError}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn"
              disabled={!bsOption || !bsText.trim()}
              data-testid="brainstorm-submit"
            >
              Lock in my guess
            </button>
          </form>
        )}
      </Stage>

      <Stage n={4} title="Teach" open={!!open[4]} onToggle={() => toggle(4)}>
        <Markdown source={level.teach} />
        {level.docs.length ? (
          <p className="docs">
            Official docs:{' '}
            {level.docs.map((d, i) => (
              <span key={d}>
                {i ? ', ' : ''}
                <a href={d} target="_blank" rel="noopener noreferrer">
                  {d.replace('https://', '')}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </span>
            ))}
          </p>
        ) : null}
        <button type="button" className="btn" onClick={() => openStage(5)}>
          Next: build
        </button>
      </Stage>

      <Stage
        n={5}
        title={`Build (${MODE_LABEL[level.mode].toLowerCase()})`}
        open={!!open[5]}
        onToggle={() => toggle(5)}
      >
        <Markdown source={level.task} className="task" />
        <Workbench initial={benchStart} chapter={level.chapter} />
        {quizzes.map((q) => (
          <fieldset key={q.index} className="options quiz" data-testid={`quiz-${q.index}`}>
            <legend>{q.question}</legend>
            {q.options.map((o) => {
              const cur = answers[String(q.index)];
              const arr = Array.isArray(cur) ? cur : cur ? [cur] : [];
              const checked = arr.includes(o.id);
              return (
                <label key={o.id} className={checked ? 'option on' : 'option'}>
                  <input
                    type={q.multiple ? 'checkbox' : 'radio'}
                    name={`quiz-${q.index}`}
                    checked={checked}
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
                  <span>{o.label}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
        {answerBoxes.map((a) => (
          <label key={a.index} className="field">
            {a.prompt}
            <input
              type="text"
              value={(answers[String(a.index)] as string | undefined) ?? ''}
              onChange={(e) => setAnswers((x) => ({ ...x, [String(a.index)]: e.target.value }))}
              autoComplete="off"
              spellCheck={false}
              data-testid={`answer-${a.index}`}
            />
          </label>
        ))}
        <div className="hints">
          {level.hints.map((h, i) => (
            <p key={i} className="hint" data-testid={`hint-${i}`}>
              <IconBulb size={16} />{' '}
              <span>
                Hint {i + 1}: {h}
              </span>
            </p>
          ))}
          {level.hintsTotal > 0 ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void revealHint()}
              disabled={hintBusy || hintsShown >= level.hintsTotal}
              data-testid="hint-button"
            >
              {hintsShown >= level.hintsTotal
                ? 'No more hints'
                : `Show a hint (${hintsShown} of ${level.hintsTotal})`}
            </button>
          ) : null}
        </div>
        <button type="button" className="btn" onClick={() => openStage(6)}>
          Next: verify
        </button>
      </Stage>

      <Stage
        n={6}
        title="Verify"
        chip={
          passed
            ? 'passed'
            : result
              ? result.verdict.replace(/_/g, ' ')
              : level.attempts
                ? `${level.attempts} attempt${level.attempts === 1 ? '' : 's'}`
                : undefined
        }
        tone={passed ? 'done' : result && result.verdict !== 'not_implemented' ? 'warn' : 'neutral'}
        open={!!open[6]}
        onToggle={() => toggle(6)}
      >
        <button
          type="button"
          className="btn primary"
          onClick={() => void verify()}
          disabled={verifying}
          data-testid="verify-button"
        >
          {verifying ? (
            <>
              <IconSpinner /> Checking...
            </>
          ) : passed ? (
            'Verify again'
          ) : (
            'Verify'
          )}
        </button>
        {verifyError ? (
          <p className="callout warn" role="alert">
            {verifyError}
          </p>
        ) : null}
        <ChecksList level={level} result={result} verifying={verifying} />
        {result ? <VerdictBanner result={result} /> : null}
        {passed ? (
          <div className="passed" data-testid="passed-panel">
            <p className="passed-line">
              <IconCheck size={18} /> Level passed. +{level.reward.xp} XP
              {level.reward.badge ? `, badge "${level.reward.badge}"` : ''}.
            </p>
            {level.showMe ? (
              <ShowMe id={level.showMe} levelId={level.id} playerId={progress.player.id} />
            ) : null}
            {next ? (
              <a
                className="btn primary"
                href={hrefFor({ name: 'level', id: next.id })}
                data-testid="next-level"
              >
                Next level: {next.title}
              </a>
            ) : (
              <a className="btn" href="#/">
                Back to the map
              </a>
            )}
          </div>
        ) : null}
      </Stage>

      <Stage
        n={7}
        title="The ideal way"
        chip={idealUnlocked ? 'unlocked' : `locked (${Math.min(failed, 3)} of 3 fails)`}
        tone={idealUnlocked ? 'done' : 'locked'}
        open={!!open[7]}
        onToggle={() => toggle(7)}
      >
        <IdealWay
          level={level}
          allowed={idealAllowed}
          attempts={lp?.attempts ?? failed}
          fromVerify={result?.ideal}
          onRevealed={() => setWantIdeal(true)}
        />
      </Stage>
    </main>
  );
}
