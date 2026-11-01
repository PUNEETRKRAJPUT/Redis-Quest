// Wrong: the legacy path. Postgres is asked for every name, whatever the filter knows, so the filter saves nothing.
export default async function usernameTaken({ db }, name) {
  const { rows } = await db.query('SELECT 1 FROM users WHERE handle = $1', [name]);
  return { taken: rows.length > 0, checkedDb: true };
}
