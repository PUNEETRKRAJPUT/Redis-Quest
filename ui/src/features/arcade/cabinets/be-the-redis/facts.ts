import type { CabinetFact } from '../../kit/types';

/**
 * Every rule of "Be the Redis" and where it comes from (docs/handoffs/D-08.md has the same table). A digest source
 * names the lines of docs/redis-docs-digest.md and a word each must contain; ui/test/arcadeFacts.test.ts reads the
 * digest and checks them. A rule that goes beyond the digest says so, or is labelled a simplification.
 */
export const FACTS: readonly CabinetFact[] = [
  {
    id: 'one-at-a-time',
    rule: 'Redis runs one command at a time. While one runs, the other clients wait.',
    source: {
      kind: 'digest',
      refs: [
        { line: 300, contains: 'blocks all server activities' },
        { line: 260, contains: 'KEYS blocks server' },
        { line: 270, contains: 'no other client' },
        { line: 42, contains: 'threaded actions' },
      ],
      note: 'No digest line says this for every command. It is an inference from these four, each of which says it for one case (a script, KEYS, a transaction, the thread note).',
    },
  },
  {
    id: 'slow-delays-all',
    rule: 'A slow command delays every client behind it.',
    source: {
      kind: 'digest',
      refs: [
        { line: 300, contains: 'slow scripts block all clients' },
        { line: 260, contains: 'KEYS blocks server' },
      ],
    },
  },
  {
    id: 'server-words',
    rule: 'The summary and the complexity on a card are the server’s own words.',
    source: {
      kind: 'server',
      note: 'COMMAND DOCS, served by the engine at /api/command-docs. With the stack down, a verbatim copy of nine replies captured from redis:8 is used and the cabinet says so.',
    },
  },
  {
    id: 'which-walk',
    rule: 'HGETALL, SMEMBERS, LRANGE and KEYS walk the whole key; GET, SET and the like do not.',
    source: {
      kind: 'digest',
      refs: [
        { line: 108, contains: 'HGETALL' },
        { line: 98, contains: 'SMEMBERS' },
        { line: 87, contains: 'LRANGE (O(S+N)' },
        { line: 260, contains: 'KEYS blocks server' },
      ],
      note: 'LPOS and the exact wording of every card come from the server’s docs, not the digest.',
    },
  },
  {
    id: 'ticks',
    rule: 'One tick is a tenth of a second of game time. An O(1) command takes 1 tick, O(log N) takes up to 4, O(N) takes one tick per 100 items, at most 60.',
    source: {
      kind: 'simplification',
      what: 'The shape (a bigger key means a longer walk) is the docs’. The numbers are the game’s model: a simulation, not a measurement. The digest gives no real durations.',
    },
  },
  {
    id: 'first-bound',
    rule: 'Only the first bound in a complexity text counts.',
    source: {
      kind: 'simplification',
      what: '"O(1) for each field/value pair added, so O(N) for N pairs" is played as O(1): the card shows one pair.',
    },
  },
  {
    id: 'cousins',
    rule: 'KEYS can be swapped for SCAN, SMEMBERS for SSCAN, HGETALL for HSCAN.',
    source: {
      kind: 'digest',
      refs: [
        { line: 260, contains: 'SCAN: incremental' },
        { line: 98, contains: 'use `SSCAN`' },
        { line: 103, contains: 'HSCAN' },
      ],
      note: 'The digest lists HSCAN among the hash commands but does not say it replaces HGETALL: that pairing is the game’s.',
    },
  },
  {
    id: 'cursor-call',
    rule: 'One cursor call takes 1 tick and covers 500 items, so a key of 3,000 items needs 6 calls.',
    source: {
      kind: 'digest',
      refs: [
        { line: 22, contains: 'cursor value 0' },
        { line: 22, contains: 'COUNT 100' },
      ],
      note: '1 tick is the server’s "O(1) for every call". The 500 items per call is the game’s number: the digest shows COUNT 100 only as an example and does not state the default (not verified).',
    },
  },
  {
    id: 'back-of-line',
    rule: 'After each cursor call the client’s next call joins the back of the line, and the client is patient again.',
    source: {
      kind: 'simplification',
      what: 'The game’s rule. Real clients and real orders of arrival vary; the fresh patience keeps a walk from timing out halfway.',
    },
  },
  {
    id: 'fifo',
    rule: 'Commands run in the order the clients arrived, and you run the one at the front.',
    source: {
      kind: 'simplification',
      what: 'A game rule: here the player plays the part of Redis choosing when to start the next command.',
    },
  },
  {
    id: 'patience',
    rule: 'A client gives up after 4 seconds of game time in the line.',
    source: {
      kind: 'simplification',
      what: 'The game’s rule, not a Redis fact. Real timeouts are set by each application.',
    },
  },
  {
    id: 'score',
    rule: 'Score is the number of clients served in time. A round lasts one minute of game time.',
    source: { kind: 'simplification', what: 'The game’s scoring.' },
  },
];
