// "Be the Redis": the whole game as plain functions. No React, no clock, no storage: `reduce(state, action)` returns
// the next state, and the same seed with the same actions always gives the same round (kit/random.ts).
//
// The round: clients arrive with one command each and queue up. The player is Redis: it runs the command at the
// front of the line, one at a time, and while a command runs nothing else does. Waiting clients lose patience and
// leave. Score = clients served in time. Every number here is the game's model (docs/handoffs/D-08.md, rules R5-R12).
import { drawInt, drawWeighted, seedState } from '../../kit/random';
import {
  HEAVY_TICKS,
  PAGE_ITEMS,
  TICK_MS,
  costClassOf,
  costTicks,
  describeSize,
  type CommandInfo,
  type CostClass,
  type Deck,
  type DeckCard,
  type Unit,
} from './cards';

/** A round lasts one minute of game time. */
export const DURATION_TICKS = 600;
/** Which arrival (counting from 0) is the scripted slow command. */
export const OPENER_INDEX = 2;
/** How long a client waits before it gives up: four seconds of game time. */
export const PATIENCE_TICKS = 40;

export interface Client {
  id: number;
  /** The card it came from. */
  cardId: string;
  command: string;
  args: string;
  /** Items in the key it touches. */
  size: number;
  unit: Unit;
  info: CommandInfo;
  costClass: CostClass;
  /** Ticks one call holds Redis. */
  cost: number;
  /** Calls still to run; 1 for an ordinary command, several for an incremental walk. */
  steps: number;
  totalSteps: number;
  patience: number;
  swapped: boolean;
  /** The command it was before a swap. */
  was?: string;
  cousin?: DeckCard['cousin'];
}

export interface Running {
  client: Client;
  /** Ticks left for this call. */
  left: number;
  total: number;
}

export interface BlameEntry {
  /** Clients that gave up while this command held Redis. */
  lost: number;
  /** The longest this command held Redis, in ticks. */
  maxTicks: number;
}

export interface Stats {
  arrived: number;
  served: number;
  lost: number;
  lostBehindHeavy: number;
  heavyRuns: number;
  heavyTicks: number;
  swaps: number;
  /** Incremental calls run. */
  cursorCalls: number;
  busyPresses: number;
  /** Ticks Redis sat idle with someone waiting. */
  idleTicks: number;
  maxQueue: number;
  blame: Record<string, BlameEntry>;
}

export type GameEvent =
  | { kind: 'arrived'; clientId: number }
  | { kind: 'started'; clientId: number; command: string; ticks: number; heavy: boolean }
  | { kind: 'served'; clientId: number; command: string }
  | { kind: 'step'; clientId: number; command: string; left: number }
  | { kind: 'gaveUp'; clientId: number; command: string; blame: string | null }
  | { kind: 'busy' }
  | { kind: 'empty' }
  | { kind: 'swapped'; clientId: number; from: string; to: string; steps: number }
  | { kind: 'noswap' }
  | { kind: 'over' };

export interface GameState {
  deck: Deck;
  seed: number;
  tick: number;
  duration: number;
  /** Random state (kit/random.ts). */
  rng: number;
  nextId: number;
  nextArrival: number;
  /** Waiting clients, front of the line first. */
  queue: readonly Client[];
  running: Running | null;
  stats: Stats;
  over: boolean;
  /** What happened in the last reduce call, for sound and announcements. */
  events: readonly GameEvent[];
  /** Counts up with every reduce that produced events, so a view can tell a new batch from an old one. */
  eventSeq: number;
}

export type Action = { type: 'step'; n?: number } | { type: 'run' } | { type: 'swap' };

export function emptyStats(): Stats {
  return {
    arrived: 0,
    served: 0,
    lost: 0,
    lostBehindHeavy: 0,
    heavyRuns: 0,
    heavyTicks: 0,
    swaps: 0,
    cursorCalls: 0,
    busyPresses: 0,
    idleTicks: 0,
    maxQueue: 0,
    blame: {},
  };
}

export function createGame(seed: number, deck: Deck, duration: number = DURATION_TICKS): GameState {
  return {
    deck,
    seed: seedState(seed),
    tick: 0,
    duration,
    rng: seedState(seed),
    nextId: 1,
    nextArrival: 2,
    queue: [],
    running: null,
    stats: emptyStats(),
    over: false,
    events: [],
    eventSeq: 0,
  };
}

/** Ticks until the next client arrives: 9 early in the round down to 5 at the end, with some jitter. Pure. */
export function arrivalGap(tick: number, duration: number, r: number): number {
  const p = Math.min(1, Math.max(0, tick / Math.max(1, duration)));
  return Math.max(3, Math.round(9 - 4 * p + (r - 0.5) * 4));
}

/** Makes a client from a card and a size. */
export function makeClient(id: number, card: DeckCard, size: number): Client {
  const costClass = costClassOf(card.info.complexity);
  return {
    id,
    cardId: card.id,
    command: card.command,
    args: card.args,
    size,
    unit: card.unit,
    info: card.info,
    costClass,
    cost: costTicks(costClass, size),
    steps: 1,
    totalSteps: 1,
    patience: PATIENCE_TICKS,
    swapped: false,
    ...(card.cousin ? { cousin: card.cousin } : {}),
  };
}

/** The same client after its slow command is swapped for the incremental one. */
export function swapClient(c: Client): Client | null {
  if (!c.cousin || c.swapped) return null;
  const costClass = costClassOf(c.cousin.info.complexity);
  const steps = Math.max(1, Math.ceil(c.size / PAGE_ITEMS));
  return {
    ...c,
    command: c.cousin.command,
    args: c.cousin.args,
    info: c.cousin.info,
    costClass,
    cost: costTicks(costClass, PAGE_ITEMS),
    steps,
    totalSteps: steps,
    patience: PATIENCE_TICKS,
    swapped: true,
    was: c.command,
    cousin: undefined,
  };
}

export const isHeavy = (ticks: number): boolean => ticks >= HEAVY_TICKS;

/** The client at the front of the line, if there is one. */
export const head = (s: GameState): Client | undefined => s.queue[0];

/** True when the front client's command has an incremental form to swap to. */
export function canSwap(s: GameState): boolean {
  const h = s.queue[0];
  return !s.over && !!h && !!h.cousin && !h.swapped;
}

export const scoreOf = (s: GameState): number => s.stats.served;
export const ticksLeft = (s: GameState): number => Math.max(0, s.duration - s.tick);

/** `0:42` for ticks of game time. */
export function formatClock(ticks: number): string {
  const secs = Math.max(0, Math.ceil((ticks * TICK_MS) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** Ticks as seconds of game time: `3.2 s`. */
export const formatSeconds = (ticks: number): string =>
  `${((ticks * TICK_MS) / 1000).toFixed(1)} s`;

// ---- the reducer -----------------------------------------------------------------------------------------------

interface Draft {
  deck: Deck;
  tick: number;
  rng: number;
  nextId: number;
  nextArrival: number;
  queue: Client[];
  running: Running | null;
  stats: Stats;
  over: boolean;
  duration: number;
  events: GameEvent[];
}

function draftOf(s: GameState): Draft {
  return {
    deck: s.deck,
    tick: s.tick,
    rng: s.rng,
    nextId: s.nextId,
    nextArrival: s.nextArrival,
    queue: [...s.queue],
    running: s.running,
    stats: { ...s.stats, blame: { ...s.stats.blame } },
    over: s.over,
    duration: s.duration,
    events: [],
  };
}

function blameEntry(d: Draft, command: string): BlameEntry {
  const existing = d.stats.blame[command];
  if (existing) return existing;
  const fresh: BlameEntry = { lost: 0, maxTicks: 0 };
  d.stats.blame[command] = fresh;
  return fresh;
}

function spawn(d: Draft): void {
  const cards = d.deck.cards;
  if (cards.length === 0) return;
  const pick = drawWeighted(
    d.rng,
    cards.map((c) => c.weight),
  );
  // The third client always brings a slow command that has an incremental form, so the lesson shows up in the
  // first few seconds instead of whenever the dice allow.
  const opener = d.stats.arrived === OPENER_INDEX ? cards.find((c) => c.cousin) : undefined;
  const card = opener ?? cards[pick.value] ?? cards[0];
  if (!card) return;
  const size = drawInt(pick.state, card.min, card.max);
  d.rng = size.state;
  const client = makeClient(d.nextId++, card, size.value);
  d.queue.push(client);
  d.stats.arrived++;
  d.events.push({ kind: 'arrived', clientId: client.id });
}

function tickOnce(d: Draft): void {
  if (d.over) return;
  const before = d.running;
  const heavyNow = !!before && isHeavy(before.total);

  if (before && heavyNow) d.stats.heavyTicks++;
  else if (!before && d.queue.length > 0) d.stats.idleTicks++;

  // 1. the running call gets one tick closer to done
  let finished: Client | null = null;
  if (before) {
    const left = before.left - 1;
    if (left <= 0) {
      finished = before.client;
      d.running = null;
    } else {
      d.running = { ...before, left };
    }
  }

  // 2. everyone already waiting gets less patient; the ones out of patience leave
  const stay: Client[] = [];
  for (const c of d.queue) {
    const patience = c.patience - 1;
    if (patience > 0) {
      stay.push({ ...c, patience });
      continue;
    }
    d.stats.lost++;
    const blame = heavyNow && before ? before.client.command : null;
    if (blame) {
      d.stats.lostBehindHeavy++;
      blameEntry(d, blame).lost++;
    }
    d.events.push({ kind: 'gaveUp', clientId: c.id, command: c.command, blame });
  }
  d.queue = stay;

  // 3. a finished call: served, or the client's next cursor call goes to the back of the line
  if (finished) {
    if (finished.steps > 1) {
      const left = finished.steps - 1;
      d.queue.push({ ...finished, steps: left, patience: PATIENCE_TICKS });
      d.events.push({ kind: 'step', clientId: finished.id, command: finished.command, left });
    } else {
      d.stats.served++;
      d.events.push({ kind: 'served', clientId: finished.id, command: finished.command });
    }
  }

  // 4. new clients
  while (d.tick >= d.nextArrival) {
    spawn(d);
    const gap = drawInt(d.rng, 0, 99);
    d.rng = gap.state;
    d.nextArrival += arrivalGap(d.tick, d.duration, gap.value / 100);
  }
  d.stats.maxQueue = Math.max(d.stats.maxQueue, d.queue.length);

  // 5. the clock
  d.tick++;
  if (d.tick >= d.duration) {
    d.over = true;
    d.events.push({ kind: 'over' });
  }
}

function run(d: Draft): void {
  if (d.over) return;
  if (d.running) {
    d.stats.busyPresses++;
    d.events.push({ kind: 'busy' });
    return;
  }
  const next = d.queue.shift();
  if (!next) {
    d.events.push({ kind: 'empty' });
    return;
  }
  d.running = { client: next, left: next.cost, total: next.cost };
  const heavy = isHeavy(next.cost);
  if (next.swapped) d.stats.cursorCalls++;
  if (heavy) {
    d.stats.heavyRuns++;
    const entry = blameEntry(d, next.command);
    entry.maxTicks = Math.max(entry.maxTicks, next.cost);
  }
  d.events.push({
    kind: 'started',
    clientId: next.id,
    command: next.command,
    ticks: next.cost,
    heavy,
  });
}

function swap(d: Draft): void {
  const front = d.queue[0];
  const swapped = front ? swapClient(front) : null;
  if (!front || !swapped) {
    d.events.push({ kind: 'noswap' });
    return;
  }
  d.queue[0] = swapped;
  d.stats.swaps++;
  d.events.push({
    kind: 'swapped',
    clientId: swapped.id,
    from: front.command,
    to: swapped.command,
    steps: swapped.steps,
  });
}

export function reduce(state: GameState, action: Action): GameState {
  if (state.over && action.type !== 'step') return state;
  const d = draftOf(state);
  if (action.type === 'step') {
    const n = Math.max(1, Math.floor(action.n ?? 1));
    for (let i = 0; i < n && !d.over; i++) tickOnce(d);
  } else if (action.type === 'run') run(d);
  else swap(d);
  return {
    ...state,
    tick: d.tick,
    rng: d.rng,
    nextId: d.nextId,
    nextArrival: d.nextArrival,
    queue: d.queue,
    running: d.running,
    stats: d.stats,
    over: d.over,
    events: d.events,
    eventSeq: d.events.length > 0 ? state.eventSeq + 1 : state.eventSeq,
  };
}

// ---- after the round -------------------------------------------------------------------------------------------

export interface Debrief {
  /** What happened, in two sentences. */
  sentences: [string, string];
  /** The one idea to take away. */
  idea: string;
}

export const IDEA =
  'One slow command delays every client behind it, because commands run one after another. Done in small steps, the same work lets the others in between.';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function debrief(s: GameState): Debrief {
  const st = s.stats;
  const first =
    st.lost === 0
      ? `You served ${st.served} of ${st.arrived} clients in time and nobody gave up waiting.`
      : `You served ${st.served} of ${st.arrived} clients in time and ${st.lost} gave up waiting.`;

  let worst: [string, BlameEntry] | null = null;
  for (const entry of Object.entries(st.blame)) {
    if (entry[1].lost > 0 && (!worst || entry[1].lost > worst[1].lost)) worst = entry;
  }

  let second: string;
  if (worst) {
    const [command, e] = worst;
    second = `${e.lost} of them left while ${command} held Redis for up to ${formatSeconds(e.maxTicks)} of game time: nothing else ran until it finished.`;
  } else if (st.swaps > 0) {
    second = `You swapped ${st.swaps} slow ${plural(st.swaps, 'command', 'commands')} for a cursor walk (${st.cursorCalls} small ${plural(st.cursorCalls, 'call', 'calls')}), so the others got in between.`;
  } else if (st.heavyRuns > 0) {
    second = `${st.heavyRuns} slow ${plural(st.heavyRuns, 'command', 'commands')} came through and none of them cost you a client this time.`;
  } else {
    second = 'Only quick commands came up, so the line never had a reason to grow.';
  }
  return { sentences: [first, second], idea: IDEA };
}

/** A line for the screen-reader announcement and the toast when a client gives up. */
export function gaveUpText(e: Extract<GameEvent, { kind: 'gaveUp' }>): string {
  return e.blame ? `A client gave up behind ${e.blame}.` : 'A client gave up waiting.';
}

/** The size line of a card: "3,200 keys in the database". */
export const sizeText = (c: Client): string => describeSize(c.size, c.unit);
