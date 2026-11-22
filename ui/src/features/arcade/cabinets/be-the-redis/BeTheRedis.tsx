'use client';
import { Cpu, Play, Replace, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Button,
  Card,
  Kbd,
  Panel,
  Pill,
  ProgressBar,
  celebrate,
  play,
  useReducedMotion,
} from '@/design';
import {
  CabinetFrame,
  freshSeed,
  readBest,
  recordScore,
  useFixedLoop,
  type FrameScore,
  type Recorded,
} from '../../kit';
import { Belt } from './Belt';
import { HEAVY_TICKS, TICK_MS, fallbackDeck, type Deck } from './cards';
import { intentFor, type Intent, type Phase } from './controls';
import {
  createGame,
  debrief,
  formatClock,
  formatSeconds,
  gaveUpText,
  reduce,
  scoreOf,
  sizeText,
  ticksLeft,
  type Action,
  type GameState,
} from './logic';
import { META } from './meta';
import { useDeck } from './useDeck';

export const CABINET_ID = 'be-the-redis';

type UiAction = Action | { type: 'start'; seed: number; deck: Deck };

function reducer(state: GameState, action: UiAction): GameState {
  return action.type === 'start' ? createGame(action.seed, action.deck) : reduce(state, action);
}

const noBlur = (e: { preventDefault: () => void }) => e.preventDefault();

function sourceWords(source: Deck['source']): string {
  return source === 'server'
    ? 'this server’s own command docs'
    : 'a built-in copy of the redis:8 command docs (the stack is down, or has no command docs yet)';
}

export function BeTheRedis() {
  const deck = useDeck();
  const reduced = useReducedMotion();
  const [game, dispatch] = useReducer(reducer, null, () => createGame(0, fallbackDeck()));
  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState<number | null>(null);
  const [result, setResult] = useState<Recorded | null>(null);
  const [announce, setAnnounce] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ phase, deck });
  useEffect(() => {
    latest.current = { phase, deck };
  });

  // Saved scores live in the browser, so they are read after mount (the server render has none).
  useEffect(() => {
    setBest(readBest(CABINET_ID));
  }, []);

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    setAnnounce(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1800);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const begin = useCallback(() => {
    dispatch({ type: 'start', seed: freshSeed(), deck: latest.current.deck });
    setResult(null);
    setFlash(null);
    setAnnounce('Round started.');
    setPhase('playing');
  }, []);

  const act = useCallback(
    (intent: Intent) => {
      switch (intent) {
        case 'start':
        case 'restart':
          begin();
          break;
        case 'run':
          dispatch({ type: 'run' });
          break;
        case 'swap':
          dispatch({ type: 'swap' });
          break;
        case 'pause':
          setPhase('paused');
          break;
        case 'resume':
          setPhase('playing');
          break;
      }
    },
    [begin],
  );

  useFixedLoop(phase === 'playing', TICK_MS, (n) => dispatch({ type: 'step', n }));

  // The round ends by itself: save the score, say how it went.
  useEffect(() => {
    if (!game.over || phase !== 'playing') return;
    const score = scoreOf(game);
    const recorded = recordScore(CABINET_ID, score);
    setPhase('over');
    setResult(recorded);
    setBest(recorded.best);
    setAnnounce(`Round over. You served ${score} clients in time.`);
    if (recorded.isNew) celebrate({ cue: 'roar' });
    else play('tock');
  }, [game, phase]);

  // What happened in the last step or press: sound and spoken updates.
  useEffect(() => {
    if (game.eventSeq === 0) return;
    for (const e of game.events) {
      switch (e.kind) {
        case 'started':
          play(e.heavy ? 'pager' : 'tick');
          break;
        case 'gaveUp':
          play('out');
          setAnnounce(gaveUpText(e));
          break;
        case 'swapped':
          play('msg');
          setAnnounce(`Swapped ${e.from} for ${e.to}: ${e.steps} small calls.`);
          break;
        case 'busy':
          play('out');
          showFlash('Redis is busy: it runs one command at a time.');
          break;
        case 'empty':
          showFlash('Nobody is waiting yet.');
          break;
        case 'noswap':
          showFlash('This command has no incremental form to swap to.');
          break;
        default:
          break;
      }
    }
    // Only a new batch of events (eventSeq) should replay sound.
  }, [game.eventSeq]);

  // A hidden tab pauses the round.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && latest.current.phase === 'playing') setPhase('paused');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // The keyboard. A focused button keeps Space and Enter for itself, so nothing fires twice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const intent = intentFor(e.key, latest.current.phase);
      if (!intent) return;
      const activation = e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter';
      if (activation && el?.closest('button, a, summary')) return;
      e.preventDefault();
      if (e.repeat) return;
      act(intent);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  const head = game.queue[0];
  const running = game.running;
  const source = phase === 'ready' ? deck.source : game.deck.source;
  const scores: FrameScore[] = [
    { label: 'Score', value: scoreOf(game), tone: 'turf', flip: true },
    { label: 'Gave up', value: game.stats.lost },
    { label: 'Time left', value: formatClock(ticksLeft(game)), tone: 'flood' },
    { label: 'Best', value: best ?? '-' },
  ];

  return (
    <CabinetFrame
      cabinet={META}
      status={phase}
      scores={scores}
      onPause={() => act('pause')}
      onResume={() => act('resume')}
      onRestart={() => act('restart')}
      announce={announce}
      note={
        <>
          This is a simulation, not a measurement. One tick is a tenth of a second of game time; how
          many ticks a command takes comes from the complexity the server documents and the size of
          its key. The summary and complexity on each card are {sourceWords(source)}. Rules marked
          &ldquo;Simplification&rdquo; under &ldquo;Where each rule comes from&rdquo; are the
          game&rsquo;s own.
        </>
      }
    >
      <div className="relative flex min-h-[480px] flex-col gap-4" data-testid="be-the-redis">
        <Card tone="inset" padding="sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-caps text-xs text-chalk-dim">The line</span>
            <span className="tabular text-xs text-chalk-dim" data-testid="queue-count">
              {game.queue.length} waiting
            </span>
          </div>
          <Belt queue={game.queue} reduced={reduced} />
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel
            title="Redis"
            eyebrow={running ? 'Running one command' : 'Idle'}
            icon={<Cpu size={16} aria-hidden />}
            bodyClassName="min-h-[196px]"
            data-testid="redis-panel"
          >
            {running ? (
              <>
                <div className="truncate font-mono text-lg text-chalk">
                  {running.client.command}{' '}
                  <span className="text-md text-chalk-dim">{running.client.args}</span>
                </div>
                <ProgressBar
                  className="mt-3"
                  label="Progress"
                  value={running.total - running.left}
                  max={running.total}
                  valueText={`${running.total - running.left} of ${running.total} ticks`}
                  tone={running.total >= HEAVY_TICKS ? 'wicket' : 'turf'}
                />
                <p className="mt-3 text-sm text-chalk-dim">
                  Nothing else runs until this one finishes.
                  {game.queue.length > 0 ? ` ${game.queue.length} waiting.` : ''}
                </p>
              </>
            ) : (
              <p className="text-md text-chalk-dim">
                Idle. Press <Kbd>Space</Kbd> to run the next command.
              </p>
            )}
          </Panel>

          <Card focal className="min-h-[260px]" data-testid="next-card">
            <div className="flex items-center justify-between gap-3">
              <span className="label-caps text-xs text-chalk-dim">Next command</span>
              {head && (
                <Pill
                  tone={head.cost >= HEAVY_TICKS ? 'wicket' : 'turf'}
                  variant="status"
                  size="sm"
                >
                  {head.cost >= HEAVY_TICKS ? 'Slow' : 'Quick'}
                </Pill>
              )}
            </div>
            {head ? (
              <>
                <div className="mt-1.5 truncate font-mono text-xl font-semibold text-chalk">
                  {head.command}{' '}
                  <span className="text-md font-normal text-chalk-dim">{head.args}</span>
                </div>
                <p className="mt-2 text-md text-chalk" data-testid="card-summary">
                  {head.info.summary}
                </p>
                <p className="mt-1 text-sm text-chalk-dim" data-testid="card-complexity">
                  <span className="label-caps text-[11px]">Complexity </span>
                  {head.info.complexity}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 text-sm">
                  <div>
                    <dt className="label-caps text-[11px] text-chalk-dim">Key size</dt>
                    <dd className="tabular text-chalk">{sizeText(head)}</dd>
                  </div>
                  <div>
                    <dt className="label-caps text-[11px] text-chalk-dim">
                      Holds Redis (simulated)
                    </dt>
                    <dd className="tabular text-chalk" data-testid="card-cost">
                      {head.cost} {head.cost === 1 ? 'tick' : 'ticks'} ({formatSeconds(head.cost)})
                      {head.steps > 1 ? `, ${head.steps} calls to go` : ''}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-md text-chalk-dim">
                No one is waiting. The next client is on the way.
              </p>
            )}
            <p className="mt-3 h-5 text-sm text-flood-400" data-testid="flash">
              {flash}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                shortcut="Space"
                leading={<Play size={16} aria-hidden />}
                onMouseDown={noBlur}
                onClick={() => act('run')}
                data-testid="run"
              >
                Run it
              </Button>
              {head?.cousin && !head.swapped && (
                <Button
                  variant="ghost"
                  size="lg"
                  shortcut="S"
                  leading={<Replace size={16} aria-hidden />}
                  onMouseDown={noBlur}
                  onClick={() => act('swap')}
                  data-testid="swap"
                >
                  Swap for {head.cousin.command}
                </Button>
              )}
            </div>
            {head && head.cost >= HEAVY_TICKS && !head.cousin && !head.swapped && (
              <p className="mt-3 text-xs text-chalk-dim">
                No incremental form is offered for this one: it holds Redis for its whole walk.
              </p>
            )}
          </Card>
        </div>

        {phase !== 'playing' && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-night-950/90 p-4">
            {phase === 'ready' && <ReadyCard onStart={begin} source={source} />}
            {phase === 'paused' && (
              <Card
                focal
                padding="lg"
                className="w-full max-w-[460px]"
                role="region"
                aria-label="Paused"
              >
                <h2 className="font-display text-2xl font-semibold uppercase tracking-display text-chalk">
                  Paused
                </h2>
                <p className="mt-2 text-md text-chalk-dim">The line waits too.</p>
                <div className="mt-5 flex gap-3">
                  <Button size="lg" shortcut="Space" onClick={() => act('resume')}>
                    Resume
                  </Button>
                  <Button variant="ghost" size="lg" shortcut="R" onClick={() => act('restart')}>
                    Restart
                  </Button>
                </div>
              </Card>
            )}
            {phase === 'over' && (
              <OverCard game={game} best={best} result={result} onRestart={() => act('restart')} />
            )}
          </div>
        )}
      </div>
    </CabinetFrame>
  );
}

function ReadyCard({ onStart, source }: { onStart: () => void; source: Deck['source'] }) {
  return (
    <Card
      focal
      padding="lg"
      className="w-full max-w-[560px]"
      role="region"
      aria-label="How to play"
    >
      <h2 className="font-display text-2xl font-semibold uppercase tracking-display text-chalk">
        You are Redis
      </h2>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-md text-chalk-dim">
        <li>Clients line up, each with one command.</li>
        <li>
          Press <Kbd>Space</Kbd> to run the one at the front. Only one command runs at a time.
        </li>
        <li>
          Slow commands hold everyone behind them. When a swap is offered, press <Kbd>S</Kbd>.
        </li>
      </ol>
      <p className="mt-3 text-xs text-chalk-dim">
        One minute of game time. A simulation, not a measurement. Words on the cards:{' '}
        {source === 'server' ? 'from this server’s command docs' : 'a built-in copy of the docs'}.
      </p>
      <div className="mt-5">
        <Button
          size="lg"
          shortcut="Space"
          leading={<Play size={16} aria-hidden />}
          onClick={onStart}
          data-testid="start"
        >
          Start the round
        </Button>
      </div>
    </Card>
  );
}

function OverCard({
  game,
  best,
  result,
  onRestart,
}: {
  game: GameState;
  best: number | null;
  result: Recorded | null;
  onRestart: () => void;
}) {
  const d = debrief(game);
  return (
    <Card
      focal
      padding="lg"
      className="w-full max-w-[600px]"
      role="region"
      aria-label="Round over"
      data-testid="over"
    >
      <div className="label-caps text-xs text-chalk-dim">Round over</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className="tabular font-display text-4xl font-bold leading-none text-flood-400"
          data-testid="final-score"
        >
          {scoreOf(game)}
        </span>
        <span className="label-caps text-sm text-chalk-dim">clients served in time</span>
        {result?.isNew && (
          <Pill tone="cap" variant="status">
            New best
          </Pill>
        )}
      </div>
      {best !== null && <p className="mt-1 text-sm text-chalk-dim">Best so far: {best}</p>}
      <p className="mt-3 text-base leading-relaxed text-chalk" data-testid="debrief">
        {d.sentences[0]} {d.sentences[1]}
      </p>
      <div className="mt-3 rounded-md border border-flood-500/40 bg-flood-500/5 p-3">
        <div className="label-caps text-xs text-flood-400">The idea</div>
        <p className="mt-1 text-base leading-relaxed text-chalk">{d.idea}</p>
      </div>
      <p className="mt-3 font-mono text-xs text-chalk-dim">
        Seed {game.seed}. Add ?seed={game.seed} to the address to play this exact round again.
      </p>
      <div className="mt-4">
        <Button
          size="lg"
          shortcut="Enter"
          leading={<RotateCcw size={16} aria-hidden />}
          onClick={onRestart}
          data-testid="again"
        >
          Play again
        </Button>
      </div>
    </Card>
  );
}
