import { lazy, Suspense, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { highlight, Markdown } from '../markdown';
import type { Ideal, IdealFile, LevelData, VerifierInfo } from '../types';
import { lineDiff, workspaceFileFromTask } from './diff';
import { RebuildLink } from './interview';

const MonacoEditor = lazy(() => import('../panels/MonacoEditor'));

type FileIdeal = Exclude<Ideal, { mode: 'decision' }>;
type DecisionIdeal = Extract<Ideal, { mode: 'decision' }>;

export const IDEAL_AFTER_ATTEMPTS = 3;

/** Same wording the engine uses (docs/handoffs/P0-09.md), so the locked panel can explain itself without fetching. */
export function lockedReason(attempts: number): string {
  return `Not passed yet, and ${Math.min(attempts, IDEAL_AFTER_ATTEMPTS)} of ${IDEAL_AFTER_ATTEMPTS} attempts used. You can still reveal it.`;
}

const langOf = (path: string) =>
  /\.(m?js)$/.test(path)
    ? 'javascript'
    : path.endsWith('.sh')
      ? 'shell'
      : path.endsWith('.redis')
        ? 'redis'
        : 'plaintext';
const hljsLang = (path: string) =>
  /\.(m?js)$/.test(path) ? 'js' : path.endsWith('.sh') ? 'sh' : 'redis';

function Code({ file }: { file: IdealFile }) {
  const h = highlight(file.content, hljsLang(file.path));
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{file.path}</span>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: h.html }} />
      </pre>
    </div>
  );
}

function Diff({
  mine,
  reference,
  minePath,
}: {
  mine: string;
  reference: string;
  minePath: string;
}) {
  const rows = lineDiff(mine, reference);
  const same = rows.every((r) => r.kind === 'same');
  return (
    <div className="diff" data-testid="ideal-diff">
      <p className="muted small-print">
        Line by line:{' '}
        <span className="diff-key del">
          - only in your <code>{minePath}</code>
        </span>{' '}
        <span className="diff-key add">+ only in the reference</span>
        {same ? ' Identical.' : ''}
      </p>
      <pre
        className="diff-body"
        tabIndex={0}
        aria-label="Difference between your file and the reference"
      >
        {rows.map((r, i) => (
          <div key={i} className={`diff-row ${r.kind}`}>
            <span aria-hidden="true">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}</span>
            {r.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

function LearnerFile({ level, ideal }: { level: LevelData; ideal: FileIdeal }) {
  const path = workspaceFileFromTask(level.task);
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!path) return;
    api.readFile(path).then(
      (f) => setText(f.content),
      () => setText(null),
    );
  }, [path]);
  if (!path)
    return (
      <p className="muted">
        The task does not name a workspace file, so there is nothing to compare line by line.
      </p>
    );
  if (text === undefined) return <p className="muted">Reading your file...</p>;
  if (text === null)
    return (
      <p className="muted">
        Could not read <code>workspace/{path}</code>.
      </p>
    );
  return <Diff mine={text} reference={ideal.reference.content} minePath={`workspace/${path}`} />;
}

function Decision({ level, ideal }: { level: LevelData; ideal: DecisionIdeal }) {
  const labels = new Map<string, string>();
  for (const v of level.verifiers as VerifierInfo[])
    if (v.type === 'quiz' && 'options' in v)
      for (const o of (v as { options: { id: string; label: string }[] }).options)
        labels.set(o.id, o.label);
  for (const o of level.brainstorm.options) if (!labels.has(o.id)) labels.set(o.id, o.label);
  const name = (id: string) => labels.get(id) ?? id;
  return (
    <div data-testid="ideal-decision">
      <h3>The right call</h3>
      <ul>
        {ideal.reference.options.map((o) => (
          <li key={o}>
            <strong>{name(o)}</strong>
          </li>
        ))}
      </ul>
      {ideal.quizzes.map((q) => (
        <div key={q.index} className="ideal-quiz">
          <p>
            <strong>{q.question}</strong>
          </p>
          <p>Correct: {q.correct.map(name).join('; ')}</p>
          <Markdown source={q.explanation} />
        </div>
      ))}
      {ideal.wrong.length ? <h3>The tempting wrong answers</h3> : null}
      {ideal.wrong.map((w) => (
        <details key={w.option} className="ideal-wrong" data-testid="ideal-wrong">
          <summary>Not: {name(w.option)}</summary>
          <p>{w.because}</p>
        </details>
      ))}
    </div>
  );
}

function Files({ level, ideal }: { level: LevelData; ideal: FileIdeal }) {
  return (
    <div data-testid="ideal-files">
      <h3>Reference solution</h3>
      {ideal.mode === 'code' ? (
        <Suspense fallback={<p className="muted">Loading the editor...</p>}>
          <div className="ideal-monaco" data-testid="ideal-reference">
            <div className="codeblock-bar">
              <span>{ideal.reference.path}</span>
            </div>
            <MonacoEditor
              value={ideal.reference.content}
              language={langOf(ideal.reference.path)}
              onChange={() => undefined}
              onSave={() => undefined}
              readOnly
              height="260px"
            />
          </div>
        </Suspense>
      ) : (
        <div data-testid="ideal-reference">
          <Code file={ideal.reference} />
        </div>
      )}
      {ideal.mode === 'code' ? <LearnerFile level={level} ideal={ideal} /> : null}
      {ideal.wrong.length ? <h3>What goes wrong with the others</h3> : null}
      {ideal.wrong.map((w) => (
        <details key={w.path} className="ideal-wrong" data-testid="ideal-wrong">
          <summary>
            {w.path} <span className="status-chip">{w.expect.replace(/_/g, ' ')}</span>
          </summary>
          <p>{w.because}</p>
          <Code file={w} />
        </details>
      ))}
    </div>
  );
}

/**
 * Beat 7. Unlocked (passed, or 3 attempts): shows the `ideal` from the last verify response, or fetches
 * GET /api/levels/:id/ideal when the page was reloaded. Locked: the reason and "Reveal anyway", which fetches it.
 */
export function IdealWay({
  level,
  allowed,
  attempts,
  fromVerify,
  onRevealed,
}: {
  level: LevelData;
  allowed: boolean;
  attempts: number;
  fromVerify: Ideal | undefined;
  onRevealed?: () => void;
}) {
  const [fetched, setFetched] = useState<Ideal | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ideal = fromVerify ?? fetched;

  const fetchIdeal = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.ideal(level.id);
      setReason(r.reason);
      setFetched(r);
      onRevealed?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (allowed && !fromVerify && !fetched) void fetchIdeal();
  }, [allowed, fromVerify, level.id]);

  const guess = level.brainstormAnswer;
  const option = guess ? level.brainstorm.options.find((o) => o.id === guess.optionId) : undefined;

  if (!ideal) {
    return (
      <div className="ideal" data-testid="ideal-locked">
        {level.interview ? <RebuildLink interview={level.interview} /> : null}
        {allowed ? (
          <p className="muted">Loading the ideal way...</p>
        ) : (
          <>
            <p data-testid="ideal-reason">{lockedReason(attempts)}</p>
            <p className="muted">Try first: the guess you made in beat 3 is waiting for you.</p>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void fetchIdeal()}
              disabled={busy}
              data-testid="ideal-request"
            >
              Reveal anyway
            </button>
          </>
        )}
        {error ? (
          <p className="callout warn" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ideal" data-testid="ideal" data-mode={ideal.mode}>
      {level.interview ? <RebuildLink interview={level.interview} /> : null}
      {reason && !allowed ? (
        <p className="muted small-print" data-testid="ideal-revealed-note">
          Revealed early. {reason}
        </p>
      ) : null}
      {ideal.mode === 'decision' ? (
        <Decision level={level} ideal={ideal} />
      ) : (
        <Files level={level} ideal={ideal} />
      )}
      {ideal.reasoning ? (
        <>
          <h3>Why</h3>
          <pre className="ideal-reasoning" data-testid="ideal-reasoning">
            {ideal.reasoning}
          </pre>
        </>
      ) : null}
      <div className="compare">
        <div>
          <h3>What you guessed (beat 3)</h3>
          {guess ? (
            <>
              <p>
                <strong>{option?.label ?? guess.optionId}</strong>
              </p>
              <p className="quote">{guess.text}</p>
              {option ? (
                <p className="muted">
                  {option.is_reasonable
                    ? 'A reasonable first instinct for this problem.'
                    : 'Not the usual first pick for this problem, and that is fine: the teach panel says why.'}
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted">You skipped the brainstorm.</p>
          )}
        </div>
        <div>
          <h3>What you were asked to build</h3>
          <Markdown source={level.task} />
        </div>
      </div>
      {level.docs.length ? (
        <p>
          Read next:{' '}
          {level.docs.map((d, i) => (
            <span key={d}>
              {i ? ', ' : ''}
              <a href={d} target="_blank" rel="noopener noreferrer">
                {d.replace('https://redis.io/docs/latest/', 'redis.io/docs/')}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
