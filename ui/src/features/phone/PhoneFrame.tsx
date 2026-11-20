import { clsx } from 'clsx';
import { Loader2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { PHONE_SCREENS, type PhoneScreenDef } from './screens';
import type { PhoneResult } from './request';
import { formatMs } from './waterfall';
import { errorCopy, viewFor } from './views';

/** What the app shows while it waits: a spinner and how long the player has been sitting there. */
export function Waiting({ elapsedMs }: { elapsedMs: number }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 text-chalk-dim"
      data-testid="phone-spinner"
    >
      <Loader2 aria-hidden size={28} className="ds-still animate-spin text-flood-400" />
      <span className="tabular font-mono text-sm">{formatMs(elapsedMs)}</span>
    </div>
  );
}

/** An error the way the app shows it: a plain line and the status under it. */
export function ErrorCard({ result }: { result: PhoneResult }) {
  const c = errorCopy(result.status, result.errorCode);
  return (
    <div
      role="alert"
      data-testid="phone-error"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <TriangleAlert aria-hidden size={28} className="text-wicket" />
      <p className="font-display text-xl font-semibold uppercase text-chalk">{c.title}</p>
      <p className="font-mono text-sm text-chalk-dim">{c.detail}</p>
      {result.message && result.message !== c.detail ? (
        <p className="text-xs text-chalk-dim">{result.message}</p>
      ) : null}
    </div>
  );
}

function Body({ def, result }: { def: PhoneScreenDef; result: PhoneResult }) {
  const view = viewFor(def.id, result.body);
  if (view.kind === 'raw')
    return <p className="break-all px-4 py-3 font-mono text-xs text-chalk-dim">{view.text}</p>;
  if (view.kind === 'fields')
    return (
      <div className="px-4 py-3">
        <h3 className="font-display text-2xl font-bold uppercase leading-none text-chalk">
          {view.heading}
        </h3>
        <dl className="mt-3 divide-y divide-night-700/70">
          {view.fields.map((f) => (
            <div key={f.label} className="flex justify-between gap-3 py-1.5 text-sm">
              <dt className="capitalize text-chalk-dim">{f.label}</dt>
              <dd className="tabular text-right font-medium text-chalk">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  if (view.items.length === 0)
    return <p className="px-4 py-6 text-center text-sm text-chalk-dim">{view.empty}</p>;
  return (
    <ul className="divide-y divide-night-700/70 px-2">
      {view.items.map((it, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-2 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-chalk">{it.title}</span>
            {it.sub ? (
              <span className="block truncate text-xs text-chalk-dim">{it.sub}</span>
            ) : null}
          </span>
          {it.trailing ? (
            <span className="tabular font-display text-lg font-semibold text-flood-400">
              {it.trailing}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The phone: status bar, the app's title, one screen, a tab bar. Pure markup; PhoneScreen drives it. */
export function PhoneFrame({
  screen,
  onScreen,
  loading,
  elapsedMs,
  result,
}: {
  screen: PhoneScreenDef;
  onScreen: (id: PhoneScreenDef['id']) => void;
  loading: boolean;
  elapsedMs: number;
  result: PhoneResult | null;
}): ReactNode {
  return (
    <div
      data-testid="phone-frame"
      className="relative flex h-[560px] w-[290px] shrink-0 flex-col overflow-hidden rounded-[34px] border-[6px] border-night-600 bg-night-950 shadow-pop"
    >
      <div aria-hidden className="mx-auto mt-1.5 h-4 w-20 rounded-full bg-night-800" />
      <header className="px-4 pb-2 pt-2">
        <p className="label-caps text-[10px] text-flood-400">Fantasy Cricket</p>
        <h2 className="font-display text-xl font-bold uppercase leading-none text-chalk">
          {screen.title}
        </h2>
      </header>
      <div
        role="tabpanel"
        id="phone-panel"
        aria-busy={loading}
        aria-label={screen.title}
        className="min-h-0 flex-1 overflow-y-auto border-t border-night-700/70 bg-night-900"
      >
        {loading || !result ? (
          <Waiting elapsedMs={elapsedMs} />
        ) : result.ok ? (
          <Body def={screen} result={result} />
        ) : (
          <ErrorCard result={result} />
        )}
      </div>
      <nav
        role="tablist"
        aria-label="App tabs"
        className="grid grid-cols-4 border-t border-night-700/70 bg-night-950"
      >
        {PHONE_SCREENS.map((s) => {
          const Icon = s.icon;
          const on = s.id === screen.id;
          return (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls="phone-panel"
              onClick={() => onScreen(s.id)}
              data-testid={`phone-tab-${s.id}`}
              className={clsx(
                'flex cursor-pointer flex-col items-center gap-0.5 py-2 text-[11px] transition-colors duration-fast',
                on ? 'text-flood-400' : 'text-chalk-dim hover:text-chalk',
              )}
            >
              <Icon aria-hidden size={18} />
              {s.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
