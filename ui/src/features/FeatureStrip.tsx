'use client';

import { QuestLink } from '@/shell/QuestLink';
import { FEATURES } from './registry';

/** The extras a player can open from the map. Renders nothing until a feature turns itself on. */
export function FeatureStrip() {
  if (FEATURES.length === 0) return null;
  return (
    <section data-testid="feature-strip" aria-labelledby="extras-heading" className="mt-10">
      <h2
        id="extras-heading"
        className="m-0 font-display text-xl font-semibold tracking-wide text-chalk uppercase"
      >
        Beyond the season
      </h2>
      <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <li key={f.id}>
              <QuestLink
                to={f.path}
                data-testid={`feature-${f.id}`}
                className="block h-full cursor-pointer rounded-lg border border-night-600 bg-night-800 p-4 text-chalk no-underline transition-colors duration-fast hover:border-flood-500"
              >
                <span className="flex items-center gap-2 font-display text-lg font-semibold tracking-wide uppercase">
                  <Icon size={18} aria-hidden="true" className="text-flood-500" />
                  {f.label}
                </span>
                <span className="mt-1 block text-sm text-chalk-dim">{f.blurb}</span>
              </QuestLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
