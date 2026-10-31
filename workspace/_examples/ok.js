// A complete, working learner module. It is the smallest useful shape:
//   1. a default export,  2. `deps` as the first argument,  3. no npm imports.
//
// It writes a key, reads it back, and runs one SQL query, so the runner reports
// redisCommands = 2 and dbQueries = 1.
export default async function (deps, name = 'world') {
  const { redis, db, log } = deps;

  await redis.set('runner:example:greeting', `hello ${name}`);
  const greeting = await redis.get('runner:example:greeting');
  log('read greeting:', greeting);

  const { rows } = await db.query('SELECT 1 + 1 AS two');
  return { greeting, two: rows[0].two };
}
