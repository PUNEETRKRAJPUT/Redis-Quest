'use client';
import { clsx } from 'clsx';
import { Check, ChevronRight, Eye, FileCode } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Pill } from '../design';
import { api, ApiError } from '../api';
import { highlight, Markdown } from '../markdown';
import type { Ideal, IdealFile, LevelData, VerifierInfo } from '../types';
import { lineDiff, workspaceFileFromTask } from './diff';
import { RebuildLink } from './interview';

const MonacoEditor = lazy(() => import('../panels/MonacoEditor'));

const WRONG =
  'group/wrong rounded-md border border-night-600/70 bg-night-950/50 open:border-night-600';
const SUMMARY =
  'flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-chalk hover:bg-night-800/50 [&::-webkit-details-marker]:hidden';
const CHEV =
  'shrink-0 text-chalk-dim transition-transform duration-fast group-open/wrong:rotate-90';

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

const H3 = 'label-caps mb-2 mt-5 text-xs text-chalk-dim first:mt-0';

function FileBar({ path, tone }: { path: string; tone?: 'turf' }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2 border-b border-night-600/70 bg-night-900 px-3 py-1.5 font-mono text-xs',
        tone === 'turf' ? 'text-turf' : 'text-chalk-dim',
      )}
    >
      <FileCode size={13} aria-hidden />
      <span className="truncate">{path}</span>
    </div>
  );
}

function Code({ file, tone }: { file: IdealFile; tone?: 'turf' }) {
  const h = highlight(file.content, hljsLang(file.path));
  return (
    <div className="overflow-hidden rounded-md border border-night-600/70 bg-night-950">
      <FileBar path={file.path} tone={tone} />
      <pre className="m-0 max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed text-chalk">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: h.html }} />
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
    <div className="mt-4" data-testid="ideal-diff">
      <p className="mb-2 mt-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-chalk-dim">
        <span className="label-caps">Line by line</span>
        <span className="font-mono text-wicket">
          - only in your <code>{minePath}</code>
        </span>
        <span className="font-mono text-turf">+ only in the reference</span>
        {same ? <span className="text-turf">Identical.</span> : null}
      </p>
      <pre
        className="m-0 max-h-80 overflow-auto rounded-md border border-night-600/70 bg-night-950 py-2 font-mono text-xs leading-relaxed"
        tabIndex={0}
        aria-label="Difference between your file and the reference"
      >
        {rows.map((r, i) => (
          <div
            key={i}
            className={clsx(
              'whitespace-pre px-3',
              r.kind === 'add' && 'bg-turf/10 text-turf',
              r.kind === 'del' && 'bg-wicket/10 text-wicket',
              r.kind === 'same' && 'text-chalk-dim',
            )}
          >
            <span aria-hidden="true" className="mr-2 inline-block w-2 select-none">
              {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}
            </span>
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
      <p className="mt-3 text-sm text-chalk-dim">
        The task does not name a workspace file, so there is nothing to compare line by line.
      </p>
    );
  if (text === undefined)
    return <p className="mt-3 text-sm text-chalk-dim">Reading your file...</p>;
  if (text === null)
    return (
      <p className="mt-3 text-sm text-chalk-dim">
        Could not read <code className="font-mono">workspace/{path}</code>.
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
      <h3 className={H3}>The right call</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {ideal.reference.options.map((o) => (
          <li
            key={o}
            className="flex gap-2 rounded-md border border-turf/35 bg-turf/[0.07] px-3 py-2 text-md text-chalk"
          >
            <Check size={15} strokeWidth={3} aria-hidden className="mt-0.5 shrink-0 text-turf" />
            <strong className="font-semibold">{name(o)}</strong>
          </li>
        ))}
      </ul>
      {ideal.quizzes.map((q) => (
        <div key={q.index} className="mt-4 text-md leading-relaxed text-chalk-dim">
          <p className="m-0 font-semibold text-chalk">{q.question}</p>
          <p className="mb-1 mt-1">
            <span className="text-turf">Correct:</span> {q.correct.map(name).join('; ')}
          </p>
          <Markdown source={q.explanation} />
        </div>
      ))}
      {ideal.wrong.length ? <h3 className={H3}>The tempting wrong answers</h3> : null}
      <div className="flex flex-col gap-1.5">
        {ideal.wrong.map((w) => (
          <details key={w.option} className={WRONG} data-testid="ideal-wrong">
            <summary className={SUMMARY}>
              <ChevronRight size={14} aria-hidden className={CHEV} />
              Not: {name(w.option)}
            </summary>
            <p className="mb-0 mt-2 px-3 pb-3 text-sm leading-relaxed text-chalk-dim">
              {w.because}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}

function Files({ level, ideal }: { level: LevelData; ideal: FileIdeal }) {
  return (
    <div data-testid="ideal-files">
      <h3 className={H3}>Reference solution</h3>
      {ideal.mode === 'code' ? (
        <Suspense fallback={<p className="text-sm text-chalk-dim">Loading the editor...</p>}>
          <div
            className="overflow-hidden rounded-md border border-turf/40 bg-night-950"
            data-testid="ideal-reference"
          >
            <FileBar path={ideal.reference.path} tone="turf" />
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
          <Code file={ideal.reference} tone="turf" />
        </div>
      )}
      {ideal.mode === 'code' ? <LearnerFile level={level} ideal={ideal} /> : null}
      {ideal.wrong.length ? <h3 className={H3}>What goes wrong with the others</h3> : null}
      <div className="flex flex-col gap-1.5">
        {ideal.wrong.map((w) => (
          <details key={w.path} className={WRONG} data-testid="ideal-wrong">
            <summary className={SUMMARY}>
              <ChevronRight size={14} aria-hidden className={CHEV} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{w.path}</span>
              <Pill size="sm" tone={w.expect === 'wrong' ? 'wicket' : 'flood'}>
                {w.expect.replace(/_/g, ' ')}
              </Pill>
            </summary>
            <div className="px-3 pb-3">
              <p className="mb-2 mt-2 text-sm leading-relaxed text-chalk-dim">{w.because}</p>
              <Code file={w} />
            </div>
          </details>
        ))}
      </div>
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
      <div className="flex flex-col gap-3" data-testid="ideal-locked">
        {level.interview ? <RebuildLink interview={level.interview} /> : null}
        {allowed ? (
          <p className="m-0 text-sm text-chalk-dim">Loading the ideal way...</p>
        ) : (
          <>
            <p className="m-0 text-md leading-relaxed text-chalk" data-testid="ideal-reason">
              {lockedReason(attempts)}
            </p>
            <p className="m-0 text-sm text-chalk-dim">
              Try first: the guess you made in beat 3 is waiting for you.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              leading={<Eye size={14} aria-hidden />}
              onClick={() => void fetchIdeal()}
              disabled={busy}
              data-testid="ideal-request"
            >
              Reveal anyway
            </Button>
          </>
        )}
        {error ? (
          <p
            className="m-0 rounded-sm border border-wicket/40 bg-wicket/10 px-3 py-2 text-sm text-chalk"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="ideal" data-mode={ideal.mode}>
      {level.interview ? <RebuildLink interview={level.interview} /> : null}
      {reason && !allowed ? (
        <p
          className="mb-3 mt-0 rounded-sm border border-flood-500/30 bg-flood-500/[0.06] px-3 py-2 text-xs text-chalk-dim"
          data-testid="ideal-revealed-note"
        >
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
          <h3 className={H3}>Why</h3>
          <pre
            className="m-0 whitespace-pre-wrap rounded-md border border-night-600/60 bg-night-950/50 p-3 font-sans text-sm leading-relaxed text-chalk"
            data-testid="ideal-reasoning"
          >
            {ideal.reasoning}
          </pre>
        </>
      ) : null}
      <div className="mt-5 grid gap-3">
        <div className="rounded-md border border-night-600/60 bg-night-950/40 p-3">
          <h3 className="label-caps m-0 mb-2 text-xs text-chalk-dim">What you guessed (beat 3)</h3>
          {guess ? (
            <>
              <p className="m-0 text-md font-semibold text-chalk">
                {option?.label ?? guess.optionId}
              </p>
              <p className="mb-0 mt-1.5 border-l-2 border-night-600 pl-3 text-sm italic text-chalk-dim">
                {guess.text}
              </p>
              {option ? (
                <p
                  className={clsx(
                    'mb-0 mt-2 text-sm',
                    option.is_reasonable ? 'text-turf' : 'text-chalk-dim',
                  )}
                >
                  {option.is_reasonable
                    ? 'A reasonable first instinct for this problem.'
                    : 'Not the usual first pick for this problem, and that is fine: the teach panel says why.'}
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-sm text-chalk-dim">You skipped the brainstorm.</p>
          )}
        </div>
        <div className="rounded-md border border-night-600/60 bg-night-950/40 p-3 text-sm leading-relaxed text-chalk-dim">
          <h3 className="label-caps m-0 mb-2 text-xs text-chalk-dim">
            What you were asked to build
          </h3>
          <Markdown source={level.task} />
        </div>
      </div>
      {level.docs.length ? (
        <p className="mb-0 mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="label-caps text-xs text-chalk-dim">Read next</span>
          {level.docs.map((d) => (
            <a
              key={d}
              href={d}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky underline decoration-sky/40 underline-offset-2 hover:decoration-sky"
            >
              {d.replace('https://redis.io/docs/latest/', 'redis.io/docs/')}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}
