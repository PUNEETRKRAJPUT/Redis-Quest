# workspace/

This folder is where you write code. Each file is a small JavaScript module that the game loads,
runs against a real Redis and a real Postgres, and then checks. You do not install anything and you
do not start any server: you write one function.

Files live at `workspace/<chapter>/<file>.js`. The game gives you a starting file (a scaffold) for each
level; your edits are yours and are not committed to git. If a file is empty or missing, the game uses a
slow baseline so the level still runs.

## The three rules

1. **Default export.** The file exports one function with `export default async function`.
2. **Deps first.** The function's first argument is `deps`, an object with three things: `redis`, `db`, `log`.
   Everything the level passes you (a user id, a number) comes after `deps`.
3. **No npm imports.** `import ... from 'some-package'` is not supported in v1. You never need it: `deps` has
   what you need. (Importing another file from this folder with a relative path works, but the game only
   reloads the file you edit, so keep each level in one file.)

## What is in `deps`

| Name | What it is |
| --- | --- |
| `redis` | A connected [node-redis](https://redis.io/docs/latest/develop/clients/nodejs/) v5 client. Commands are camelCase: `redis.get`, `redis.hSet`, `redis.incrBy`, `redis.zAdd`. For a command with no helper, use `redis.sendCommand(['COMMAND', 'arg'])`. `redis.multi()...exec()` runs a transaction. |
| `db` | One method: `await db.query(text, params)`, which returns `{ rows }`. Use `$1`, `$2` placeholders for params. |
| `log` | `log('anything', 123, { a: 1 })` prints to the level's log panel. Use it instead of `console.log`. |

You do not connect or close anything yourself. Calls to `redis.connect()`, `redis.quit()` and `redis.close()` are
ignored on purpose.

## One complete example

`workspace/_examples/ok.js`:

```js
export default async function (deps, name = 'world') {
  const { redis, db, log } = deps;

  await redis.set('runner:example:greeting', `hello ${name}`);
  const greeting = await redis.get('runner:example:greeting');
  log('read greeting:', greeting);

  const { rows } = await db.query('SELECT 1 + 1 AS two');
  return { greeting, two: rows[0].two };
}
```

What the game measures for this file: 1 SQL query and 2 Redis commands. The return value must be JSON-friendly
(strings, numbers, booleans, arrays, plain objects); anything else is turned into text.

## What happens when something goes wrong

- A function that throws is reported with its error message, and the game carries on.
- A function that never finishes is stopped at the level's time limit (a few seconds).
- `process.exit()`, an infinite loop, or a crash only ends your own run, never the game.

## Examples to read

`workspace/_examples/` holds small modules used by the game's own tests: `ok.js`, `throws.js`, `hangs.js`,
`exits.js`, `concurrent-counter.js` (uses `INCR`, so you can see concurrency), `multi.js` (a transaction), and a few
more. Each starts with a comment saying what it shows.

Architecture: see `docs/PLAN.md` section 2.
