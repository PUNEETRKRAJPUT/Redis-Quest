'use client';
import { Check, Copy, Download, FlaskConical, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api';
import { ToolPage } from '../../career/ToolPage';
import { Button, Dialog, Pill, Tabs, toast } from '../../design';
import { Markdown } from '../../markdown';
import { Thread } from '../../level/Thread';
import { studioApi, type Playtest, type Validation } from './client';
import { gitSteps, loadDraft, saveDraft, sectionOf, starterDraft, type Draft } from './draft';
import { Select } from './fields';
import { PlaytestView } from './PlaytestView';
import {
  BasicsFields,
  ChecksFields,
  Section,
  SolutionFields,
  StoryFields,
  TaskFields,
  type ErrorLine,
  type SetDraft,
} from './sections';
import { zip } from './zip';

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

function download(name: string, files: { path: string; content: string }[]): void {
  const url = URL.createObjectURL(new Blob([zip(files)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function LevelPreview({ draft }: { draft: Draft }) {
  const messages = draft.incident.filter((m) => m.text.trim() !== '');
  return (
    <div className="flex flex-col gap-4" data-testid="studio-preview">
      <div>
        <div className="label-caps text-xs text-flood-400">
          {draft.chapterTitle.trim() || 'Your pack'}
        </div>
        <h3 className="m-0 mt-1 font-display text-2xl font-bold uppercase leading-none tracking-[0.02em] text-chalk">
          {draft.title.trim() || 'Untitled level'}
        </h3>
        <p className="m-0 mt-1 text-xs text-chalk-dim">
          By {draft.author.name.trim() || 'you'}
          {draft.author.github.trim() ? ` (@${draft.author.github.trim().replace(/^@/, '')})` : ''}.
          Community levels award no XP.
        </p>
      </div>
      {messages.length > 0 ? (
        <Thread
          messages={messages}
          label="Incident chat preview"
          animate="never"
          rememberSeen={false}
          maxHeight={260}
          title={draft.chapterTitle.trim() || 'Incident'}
        />
      ) : null}
      {draft.story.trim() ? (
        <Markdown source={draft.story} />
      ) : (
        <p className="m-0 text-sm text-chalk-dim">The story appears here as you write it.</p>
      )}
      {draft.brainstormPrompt.trim() ? (
        <div className="rounded-md border border-night-700 p-3">
          <div className="label-caps text-xs text-chalk-dim">Brainstorm</div>
          <p className="m-0 mt-1 text-md font-semibold text-chalk">{draft.brainstormPrompt}</p>
          <ul className="m-0 mt-2 list-disc pl-5 text-sm text-chalk-dim">
            {draft.brainstormOptions
              .filter((o) => o.label.trim())
              .map((o, i) => (
                <li key={i}>{o.label}</li>
              ))}
            <li>Not Redis at all</li>
          </ul>
        </div>
      ) : null}
      {draft.teach.trim() ? <Markdown source={draft.teach} /> : null}
      {draft.task.trim() ? (
        <div className="rounded-md border border-flood-500/40 p-3">
          <div className="label-caps text-xs text-flood-400">Your task</div>
          <Markdown source={draft.task} />
        </div>
      ) : null}
      {draft.mode === 'decision'
        ? draft.quizzes.map((q, i) => (
            <fieldset key={i} className="m-0 rounded-md border border-night-700 p-3">
              <legend className="px-1 text-sm font-semibold text-chalk">
                {q.question.trim() || `Question ${i + 1}`}
              </legend>
              <ul className="m-0 list-none p-0 text-sm text-chalk-dim">
                {q.options
                  .filter((o) => o.label.trim())
                  .map((o, n) => (
                    <li key={n}>{o.label}</li>
                  ))}
              </ul>
            </fieldset>
          ))
        : null}
    </div>
  );
}

export function Studio() {
  const [draft, setDraftState] = useState<Draft>(() => starterDraft());
  const [hydrated, setHydrated] = useState(false);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [checking, setChecking] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playtest, setPlaytest] = useState<Playtest | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [tab, setTab] = useState('preview');
  const [fileIndex, setFileIndex] = useState(0);
  const [filesOpen, setFilesOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);

  // The draft lives in localStorage, read after mount so the server and first client render agree.
  useEffect(() => {
    setDraftState(loadDraft());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveDraft(draft);
  }, [draft, hydrated]);

  const setDraft: SetDraft = useCallback((fn) => setDraftState((d) => fn(d)), []);

  // Live validation: the engine's own validator, a moment after the last keystroke.
  useEffect(() => {
    if (!hydrated) return;
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      studioApi.validate(draft).then(
        (v) => {
          if (mine !== seq.current) return;
          setValidation(v);
          setApiError(null);
          setChecking(false);
        },
        (e: unknown) => {
          if (mine !== seq.current) return;
          setApiError(messageOf(e));
          setChecking(false);
        },
      );
    }, 500);
    return () => clearTimeout(t);
  }, [draft, hydrated]);

  const lines: ErrorLine[] = useMemo(
    () => [
      ...(validation?.problems ?? []).map((p) => ({ path: p.path, message: p.message })),
      ...(validation?.errors ?? []).map((e) => ({ path: e.path, message: e.message })),
    ],
    [validation],
  );
  const by = (s: ReturnType<typeof sectionOf>) => lines.filter((l) => sectionOf(l.path) === s);

  const runPlaytest = async () => {
    setPlaying(true);
    setPlayError(null);
    setTab('playtest');
    try {
      const r = await studioApi.playtest(draft);
      setPlaytest(r);
      if (r.passed)
        toast.success(
          'Play-test passed',
          'The reference is right and the known-wrong solutions behave as declared.',
        );
    } catch (e) {
      setPlayError(messageOf(e));
    }
    setPlaying(false);
  };

  const files = validation?.files ?? [];
  const canGet = validation?.ok === true && files.length > 0;
  const steps = gitSteps(draft.pack.trim(), draft.slug.trim(), draft.title);
  const gitText = `${steps.commands.join('\n')}\n`;

  const copyGit = async () => {
    try {
      await navigator.clipboard.writeText(gitText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy', 'Select the commands and copy them by hand.');
    }
  };

  const file = files[Math.min(fileIndex, Math.max(0, files.length - 1))];

  return (
    <ToolPage
      eyebrow="Level studio"
      title="Write a level"
      testId="studio"
      blurb="Write a terminal or decision level without touching YAML. The engine checks it as you type, play-tests it against real Redis, and hands you the files for a pull request."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={playing}
            loadingText="Play-testing"
            leading={<FlaskConical size={16} aria-hidden />}
            onClick={() => void runPlaytest()}
            data-testid="playtest-button"
          >
            Play-test
          </Button>
          <Button
            variant="ghost"
            disabled={!canGet}
            leading={<Download size={16} aria-hidden />}
            onClick={() => setFilesOpen(true)}
            data-testid="get-files-button"
          >
            Get the files
          </Button>
          <Button
            variant="quiet"
            leading={<RotateCcw size={16} aria-hidden />}
            onClick={() => setResetOpen(true)}
          >
            Start over
          </Button>
        </div>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Section
            testId="section-basics"
            title="1. The basics"
            errors={by('basics')}
            defaultOpen
            blurb="Where the level lives and who gets the credit."
          >
            <BasicsFields draft={draft} set={setDraft} />
          </Section>
          <Section testId="section-story" title="2. The story" errors={by('story')} defaultOpen>
            <StoryFields draft={draft} set={setDraft} />
          </Section>
          <Section testId="section-task" title="3. Teaching and task" errors={by('task')}>
            <TaskFields draft={draft} set={setDraft} />
          </Section>
          <Section
            testId="section-checks"
            title={draft.mode === 'cli' ? '4. The checks' : '4. The questions'}
            errors={by('checks')}
            blurb={
              draft.mode === 'cli'
                ? 'What the engine reads in Redis to decide whether the player got it right.'
                : 'Each question has one or more correct options.'
            }
          >
            <ChecksFields draft={draft} set={setDraft} />
          </Section>
          {draft.mode === 'cli' ? (
            <Section
              testId="section-solution"
              title="5. The reference solution"
              errors={by('solution')}
            >
              <SolutionFields draft={draft} set={setDraft} />
            </Section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {checking ? (
              <Pill tone="neutral" live>
                Checking
              </Pill>
            ) : validation?.ok ? (
              <Pill tone="turf" icon={<Check size={12} aria-hidden />}>
                Valid
              </Pill>
            ) : validation ? (
              <Pill tone="wicket">{lines.length} to fix</Pill>
            ) : null}
            {apiError ? (
              <span className="text-xs text-wicket" role="alert">
                {apiError}
              </span>
            ) : null}
          </div>
          <Tabs
            label="Preview and results"
            value={tab}
            onValueChange={setTab}
            items={[
              { id: 'preview', label: 'Preview', content: <LevelPreview draft={draft} /> },
              {
                id: 'file',
                label: 'Level file',
                content:
                  files.length === 0 ? (
                    <p className="m-0 text-sm text-chalk-dim">
                      The files appear here once the basics (pack, number, slug) are filled in.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Select
                        label="File"
                        value={String(fileIndex)}
                        onChange={(v) => setFileIndex(Number(v))}
                        options={files.map((f, i) => ({ value: String(i), label: f.path }))}
                      />
                      <pre
                        className="m-0 max-h-[60vh] overflow-auto rounded-sm bg-night-950 p-3 font-mono text-xs leading-relaxed text-chalk"
                        data-testid="file-preview"
                      >
                        {file?.content}
                      </pre>
                    </div>
                  ),
              },
              {
                id: 'problems',
                label: 'Problems',
                badge: lines.length > 0 ? String(lines.length) : undefined,
                content:
                  lines.length === 0 ? (
                    <p className="m-0 text-sm text-chalk-dim">
                      {validation
                        ? 'Nothing to fix. The engine accepts this level.'
                        : 'Checking...'}
                    </p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="problems">
                      {(validation?.problems ?? []).map((p, i) => (
                        <li key={`p${i}`} className="text-sm text-chalk">
                          <span className="font-mono text-xs text-wicket">{p.path}</span>:{' '}
                          {p.message}
                        </li>
                      ))}
                      {(validation?.errors ?? []).map((e, i) => (
                        <li key={`e${i}`} className="text-sm text-chalk">
                          <span className="font-mono text-xs text-chalk-dim">
                            {e.file.split('/').pop()}:{e.line}:{e.col}
                          </span>{' '}
                          <span className="font-mono text-xs text-wicket">{e.path}</span>:{' '}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  ),
              },
              {
                id: 'playtest',
                label: 'Play-test',
                content: playError ? (
                  <p className="m-0 text-sm text-wicket" role="alert">
                    {playError}
                  </p>
                ) : playtest ? (
                  <PlaytestView result={playtest} />
                ) : (
                  <p className="m-0 text-sm text-chalk-dim">
                    Press Play-test. The engine runs your setup, your reference solution and each
                    known-wrong solution against your Redis, with the checks a player would face,
                    then removes the keys it wrote.
                  </p>
                ),
              },
            ]}
          />
        </div>
      </div>

      <Dialog
        open={filesOpen}
        onClose={() => setFilesOpen(false)}
        title="Get the files"
        size="lg"
        description={`These ${files.length} files make one level of the pack ${draft.pack}. They go in ${steps.folder}/ of your clone of the Redis Quest repository.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFilesOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              leading={<Download size={16} aria-hidden />}
              onClick={() => download(`${draft.pack}-${draft.slug}.zip`, files)}
              data-testid="download-zip"
            >
              Download .zip
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ul className="m-0 list-none p-0 font-mono text-xs leading-relaxed text-chalk-dim">
            {files.map((f) => (
              <li key={f.path}>{f.path}</li>
            ))}
          </ul>
          <p className="m-0 text-sm text-chalk">
            Unzip it in the root of your clone so the paths line up (if the pack already exists, add
            the new level id to the levels list of its chapter.yaml instead of replacing that file).
            Then:
          </p>
          <pre
            className="m-0 overflow-x-auto rounded-sm bg-night-950 p-3 font-mono text-xs leading-relaxed text-chalk"
            data-testid="git-commands"
          >
            {gitText}
          </pre>
          <div>
            <Button
              size="sm"
              variant="ghost"
              leading={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              onClick={() => void copyGit()}
            >
              {copied ? 'Copied' : 'Copy the commands'}
            </Button>
          </div>
          <p className="m-0 text-sm text-chalk-dim">
            Then push the branch and open a pull request. Before that, run the play-test once more:
            a level that passes it is what the reviewer will try first.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Start over?"
        size="sm"
        tone="danger"
        description="This clears the draft in this browser. Files you already downloaded are not touched."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Keep my draft
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDraftState(starterDraft());
                setPlaytest(null);
                setResetOpen(false);
              }}
            >
              Clear the draft
            </Button>
          </>
        }
      />
    </ToolPage>
  );
}
