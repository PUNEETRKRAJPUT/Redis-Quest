// A connection of its own on the league's logical database. The engine's shared connection must never be used for
// scoring: a SELECT on it would move every other caller into the scratch database.

import { createClient } from 'redis';
import { LEAGUE_DB, type RunCommand } from './score.js';

export interface Scratch {
  run: RunCommand;
  close(): Promise<void>;
}

/**
 * Opens a plain single-node client on `db` (never 0). `url` must name one server: `redis://host:port`. A cluster has
 * one database and cannot be used; the caller refuses it before getting here.
 */
export async function openScratch(url: string, db: number = LEAGUE_DB): Promise<Scratch> {
  if (!Number.isInteger(db) || db <= 0) throw new Error('the scratch database is never database 0');
  const client = createClient({
    url,
    database: db,
    // `database` makes node-redis SELECT on connect; assertScratch then confirms it. No retries: a score either runs
    // or says why not.
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  // Connection errors surface as rejected commands; the event must still have a listener.
  client.on('error', () => undefined);
  await client.connect();
  return {
    run: (argv) => client.sendCommand(argv),
    close: async () => {
      try {
        await client.close();
      } catch {
        client.destroy();
      }
    },
  };
}
