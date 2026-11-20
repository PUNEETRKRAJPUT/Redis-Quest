import type { ComponentType } from 'react';

/** Where a rule of a cabinet comes from. Every rule has exactly one. */
export type FactSource =
  | {
      kind: 'digest';
      /** Lines of docs/redis-docs-digest.md, each with a word that must be on that line (a test checks it). */
      refs: readonly { line: number; contains: string }[];
      /** What the digest does not say, when the rule goes beyond it. */
      note?: string;
    }
  | {
      /** The server's own COMMAND DOCS (docs/handoffs/E-06.md), or the built-in copy of them. */
      kind: 'server';
      note: string;
    }
  | {
      kind: 'simplification';
      /** What is simplified, in words a player can read. */
      what: string;
    };

export interface CabinetFact {
  id: string;
  /** The rule as the game applies it. */
  rule: string;
  source: FactSource;
}

export interface KeyHelp {
  /** One key per entry: `['Space']`, `['P']`. */
  keys: readonly string[];
  does: string;
}

/** What a cabinet is. Add one in its own folder and list it in cabinets/registry.ts (docs/arcade.md). */
export interface Cabinet {
  id: string;
  title: string;
  /** One line for the machine on the arcade page. */
  pitch: string;
  /** The one true thing it teaches, in one sentence. */
  lesson: string;
  /** Every rule of the game and where it comes from. */
  facts: readonly CabinetFact[];
  keys: readonly KeyHelp[];
  /** Renders the whole game, frame included. */
  Component: ComponentType;
}

/** A cabinet that is announced but not built. */
export interface ComingCabinet {
  id: string;
  title: string;
  pitch: string;
}
