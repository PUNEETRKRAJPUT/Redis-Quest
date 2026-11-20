'use client';

import { Check, Clipboard, ExternalLink, GitPullRequest, PenLine, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Panel, Pill, toast } from '@/design';
import { QuestLink } from '@/shell/QuestLink';
import { Board } from './Board';
import {
  CONTRIBUTING_URL,
  gitCommands,
  stepsOf,
  studioLink,
  type Step,
  type StepStatus,
} from './logic';
import { useCoverage, useYourTurn } from './useYourTurn';

const STATUS_PILL: Record<StepStatus, { tone: 'turf' | 'flood' | 'neutral'; text: string }> = {
  done: { tone: 'turf', text: 'Done' },
  current: { tone: 'flood', text: 'Now' },
  waiting: { tone: 'neutral', text: 'Next' },
};

function StatusPill({ step }: { step: Step }) {
  const p = STATUS_PILL[step.status];
  return (
    <Pill tone={p.tone} variant="status" size="sm" data-testid={`step-status-${step.id}`}>
      {p.text}
    </Pill>
  );
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied', tone: 'success', duration: 1800 });
  } catch {
    toast({
      title: 'Could not copy',
      description: 'Select the text and copy it by hand.',
      tone: 'warn',
    });
  }
}

/** The last thing the game asks for: a pull request. Not a level, and not part of the campaign's count. */
export function YourTurn() {
  const { state, ready, pick, openedPullRequest, startOver } = useYourTurn();
  const { coverage, reload } = useCoverage();
  const [showBoard, setShowBoard] = useState(false);
  const steps = stepsOf(state);
  const [pickStep, testStep, prStep] = steps as [Step, Step, Step];
  const commands = gitCommands(state.playtest);
  const boardOpen = showBoard || state.command === null;

  return (
    <main data-ds="" data-testid="your-turn" className="mx-auto w-full max-w-[960px] px-6 py-8">
      <h1 className="m-0 font-display text-2xl font-semibold uppercase tracking-display text-chalk">
        Your turn
      </h1>
      <p className="mb-6 mt-1 max-w-[62ch] text-md text-chalk-dim">
        You have played the whole league. The last thing it asks of you is a level of your own: pick
        a Redis command that no level teaches yet, write a level about it, and send it upstream as a
        pull request. This is not a level and it does not change your score.
      </p>

      <ol aria-label="Your three steps" className="m-0 mb-6 flex list-none flex-col gap-2 p-0">
        {steps.map((s, i) => (
          <li
            key={s.id}
            data-testid={`step-${s.id}`}
            aria-current={s.status === 'current' ? 'step' : undefined}
            className="flex items-center gap-3 text-md text-chalk"
          >
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full border border-night-600 bg-night-800 text-sm"
            >
              {s.status === 'done' ? <Check size={14} className="text-turf" /> : i + 1}
            </span>
            <span className={s.status === 'waiting' ? 'text-chalk-dim' : undefined}>{s.title}</span>
            <StatusPill step={s} />
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-5">
        <Panel
          as="h2"
          title="1. Pick a command"
          eyebrow="The wanted-commands board"
          icon={<PenLine size={16} aria-hidden="true" />}
          actions={<StatusPill step={pickStep} />}
          data-testid="panel-pick"
        >
          {state.command && (
            <p className="m-0 mb-3 text-md text-chalk" data-testid="picked-command">
              You picked{' '}
              <code className="font-mono text-flood-400">{state.command.toUpperCase()}</code>.{' '}
              <button
                type="button"
                onClick={() => setShowBoard((v) => !v)}
                className="cursor-pointer border-0 bg-transparent p-0 text-md text-sky underline"
              >
                {boardOpen ? 'Hide the board' : 'Pick another'}
              </button>
            </p>
          )}
          {boardOpen && ready && (
            <Board coverage={coverage} picked={state.command} onPick={pick} onRetry={reload} />
          )}
        </Panel>

        <Panel
          as="h2"
          title="2. Write it and play-test it"
          eyebrow="In the level studio"
          icon={<PenLine size={16} aria-hidden="true" />}
          actions={<StatusPill step={testStep} />}
          data-testid="panel-playtest"
        >
          {state.playtest ? (
            <p className="m-0 text-md text-chalk" data-testid="playtest-passed">
              Your play-test passed: <code className="font-mono">{state.playtest.levelId}</code> in
              pack <code className="font-mono">{state.playtest.pack}</code>. The reference solution
              is right and every known-wrong one gave the verdict you declared.
            </p>
          ) : (
            <>
              <p className="m-0 text-md text-chalk-dim">
                The studio checks your level with the real loader and runs your reference and
                known-wrong solutions against your own Redis. This step ticks by itself when a
                play-test passes.
              </p>
              <QuestLink
                to={state.command ? studioLink(state.command) : '/studio'}
                data-testid="open-studio"
                className="mt-3 inline-flex h-9 items-center rounded-md border border-flood-500/50 px-4 text-md font-medium text-flood-400 no-underline hover:bg-flood-500/10"
              >
                Open the studio
              </QuestLink>
            </>
          )}
        </Panel>

        <Panel
          as="h2"
          title="3. Open the pull request"
          eyebrow="On GitHub"
          icon={<GitPullRequest size={16} aria-hidden="true" />}
          actions={<StatusPill step={prStep} />}
          data-testid="panel-pr"
        >
          <p className="m-0 text-md text-chalk-dim">
            Put the files the studio gave you under{' '}
            <code className="font-mono">levels/community/</code> in your clone of the repository,
            add your own line to <code className="font-mono">CONTRIBUTORS.md</code>, then:
          </p>
          <pre
            data-testid="git-commands"
            tabIndex={0}
            className="m-0 mt-3 overflow-x-auto rounded-md border border-night-600/60 bg-night-950 p-3 font-mono text-sm text-chalk"
          >
            {commands.join('\n')}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              leading={<Clipboard size={14} aria-hidden="true" />}
              onClick={() => void copy(commands.join('\n'))}
            >
              Copy the commands
            </Button>
            <a
              href={CONTRIBUTING_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="contributing-link"
              className="inline-flex items-center gap-1.5 text-md text-sky"
            >
              Read CONTRIBUTING.md
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
          <p className="m-0 mt-3 text-sm text-chalk-dim">
            The game cannot see GitHub, so this step is yours to tick.
          </p>
          <div className="mt-3">
            <Button
              variant="primary"
              size="sm"
              disabled={!state.playtest || state.prOpenedAt !== null}
              onClick={openedPullRequest}
              data-testid="pr-opened"
            >
              {state.prOpenedAt ? 'Pull request opened' : 'I opened the pull request'}
            </Button>
          </div>
        </Panel>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {state.command && (
          <Button
            variant="quiet"
            size="sm"
            leading={<Undo2 size={14} aria-hidden="true" />}
            onClick={startOver}
            data-testid="start-over"
          >
            Start over
          </Button>
        )}
        <QuestLink to="/credits" className="text-md text-sky">
          Roll the credits
        </QuestLink>
      </div>
    </main>
  );
}
