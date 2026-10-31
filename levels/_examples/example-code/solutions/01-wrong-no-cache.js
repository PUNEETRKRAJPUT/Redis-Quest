// Wrong: every call goes to Postgres. Correct data, no cache at all.
export default async function getPlayerStats({ db }, playerId) {
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  return rows[0] ?? null;
}
