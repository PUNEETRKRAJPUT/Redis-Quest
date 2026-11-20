// A tiny in-memory stand-in for the few commands the scorer tests use. It records every command it is given.
import type { RunCommand } from '../score.js';

export interface FakeRedis {
  run: RunCommand;
  log: string[][];
  /** Which logical database the fake claims to be on (what CLIENT INFO reports). */
  db: number;
}

export function fakeRedis(db = 7): FakeRedis {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const fake: FakeRedis = {
    db,
    log: [],
    run: async (argv) => {
      fake.log.push(argv);
      const [name, ...a] = argv;
      switch ((name ?? '').toUpperCase()) {
        case 'CLIENT':
          return `id=3 addr=127.0.0.1:50000 db=${fake.db} name=`;
        case 'FLUSHDB':
          strings.clear();
          hashes.clear();
          return 'OK';
        case 'SET':
          strings.set(a[0] as string, a[1] as string);
          return 'OK';
        case 'MSET':
          for (let i = 0; i + 1 < a.length; i += 2) strings.set(a[i] as string, a[i + 1] as string);
          return 'OK';
        case 'GET':
          return strings.get(a[0] as string) ?? null;
        case 'HSET': {
          const h = hashes.get(a[0] as string) ?? new Map<string, string>();
          let added = 0;
          for (let i = 1; i + 1 < a.length; i += 2) {
            if (!h.has(a[i] as string)) added++;
            h.set(a[i] as string, a[i + 1] as string);
          }
          hashes.set(a[0] as string, h);
          return added;
        }
        case 'HLEN':
          return hashes.get(a[0] as string)?.size ?? 0;
        case 'HMGET':
          return a.slice(1).map((f) => hashes.get(a[0] as string)?.get(f) ?? null);
        case 'MEMORY': {
          const key = a[1] as string;
          if (strings.has(key)) return 50 + (strings.get(key) as string).length;
          if (hashes.has(key)) return 100 + (hashes.get(key) as Map<string, string>).size * 10;
          return null;
        }
        default:
          throw new Error(`ERR unknown command '${name}'`);
      }
    },
  };
  return fake;
}
