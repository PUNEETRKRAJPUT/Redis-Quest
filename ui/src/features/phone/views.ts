// What each screen shows, worked out from the app's JSON. Tolerant on purpose: the player's own code decides
// some of these shapes, and a shape that is not recognised falls back to a short raw view instead of a crash.
import type { PhoneScreenDef } from './screens';

export interface Field {
  label: string;
  value: string;
}
export interface ListItem {
  title: string;
  sub: string;
  trailing?: string;
}
export type ScreenView =
  | { kind: 'fields'; heading: string; fields: Field[] }
  | { kind: 'list'; items: ListItem[]; empty: string }
  | { kind: 'raw'; text: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const scalar = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;

const pretty = (key: string): string => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

export function rawView(body: unknown): ScreenView {
  let text: string;
  try {
    text = JSON.stringify(body) ?? 'no body';
  } catch {
    text = 'unreadable';
  }
  return { kind: 'raw', text: text.length > 200 ? `${text.slice(0, 199)}~` : text };
}

function fieldsOf(o: Record<string, unknown>, max: number): Field[] {
  const out: Field[] = [];
  for (const [k, v] of Object.entries(o)) {
    const s = scalar(v);
    if (s !== null && out.length < max) out.push({ label: pretty(k), value: s });
  }
  return out;
}

export function viewFor(id: PhoneScreenDef['id'], body: unknown): ScreenView {
  if (id === 'player') {
    if (!isObj(body)) return rawView(body);
    const fields = fieldsOf(body, 8);
    if (fields.length === 0) return rawView(body);
    const name = scalar(body.name) ?? scalar(body.player_name) ?? scalar(body.id) ?? 'Player';
    return { kind: 'fields', heading: name, fields: fields.filter((f) => f.label !== 'name') };
  }
  if (id === 'fixtures') {
    const list = isObj(body) ? body.fixtures : null;
    if (!Array.isArray(list)) return rawView(body);
    const items = list.filter(isObj).map((f) => {
      const home = scalar(f.home_team_name) ?? scalar(f.home_team_id) ?? '?';
      const away = scalar(f.away_team_name) ?? scalar(f.away_team_id) ?? '?';
      const venue = scalar(f.venue) ?? '';
      const status = scalar(f.status) ?? '';
      return { title: `${home} v ${away}`, sub: [venue, status].filter(Boolean).join(' / ') };
    });
    return { kind: 'list', items, empty: 'No fixtures right now.' };
  }
  if (id === 'board') {
    const list = isObj(body) ? body.entries : null;
    if (!Array.isArray(list)) return rawView(body);
    const items = list.filter(isObj).map((e, i) => ({
      title: `${scalar(e.rank) ?? String(i + 1)}. ${scalar(e.teamId) ?? scalar(e.value) ?? '?'}`,
      sub: scalar(e.userId) ?? '',
      trailing: scalar(e.points) ?? scalar(e.score) ?? '',
    }));
    return { kind: 'list', items, empty: 'Nobody is on the board yet.' };
  }
  if (!isObj(body)) return rawView(body);
  const fields = fieldsOf(body, 8);
  return fields.length === 0
    ? rawView(body)
    : { kind: 'fields', heading: scalar(body.matchId) ?? 'Live match', fields };
}

/** An error the way the app would show it: a line a user could read, then the status and the app's code. */
export function errorCopy(
  status: number,
  code: string | undefined,
): { title: string; detail: string } {
  if (status === 0) return { title: 'No connection', detail: 'The app did not answer.' };
  if (status === 404) return { title: 'Not found', detail: `${status} ${code ?? 'not_found'}` };
  if (status >= 500)
    return { title: 'Something went wrong', detail: `${status} ${code ?? 'error'}` };
  return { title: 'Could not load', detail: `${status} ${code ?? 'error'}` };
}
