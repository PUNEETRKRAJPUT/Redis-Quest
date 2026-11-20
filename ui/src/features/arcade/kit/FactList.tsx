'use client';
import { Pill } from '@/design';
import type { CabinetFact, FactSource } from './types';

function SourceTag({ source }: { source: FactSource }) {
  if (source.kind === 'digest')
    return (
      <Pill tone="turf" size="sm">
        Redis docs
      </Pill>
    );
  if (source.kind === 'server')
    return (
      <Pill tone="sky" size="sm">
        Server docs
      </Pill>
    );
  return (
    <Pill tone="flood" size="sm">
      Simplification
    </Pill>
  );
}

function sourceText(source: FactSource): string {
  if (source.kind === 'digest') {
    const lines = source.refs.map((r) => `L${r.line}`);
    const unique = [...new Set(lines)].join(', ');
    return `docs/redis-docs-digest.md ${unique}.${source.note ? ` ${source.note}` : ''}`;
  }
  if (source.kind === 'server') return source.note;
  return source.what;
}

/** Every rule of a cabinet with the place it comes from, or the words "Simplification" and what is simplified. */
export function FactList({ facts }: { facts: readonly CabinetFact[] }) {
  return (
    <ul className="flex flex-col gap-3" data-testid="arcade-facts">
      {facts.map((f) => (
        <li key={f.id} className="text-sm leading-relaxed">
          <div className="flex items-start gap-2">
            <span className="mt-0.5">
              <SourceTag source={f.source} />
            </span>
            <span className="text-chalk">{f.rule}</span>
          </div>
          <p className="mt-1 pl-0.5 text-xs leading-relaxed text-chalk-dim">
            {sourceText(f.source)}
          </p>
        </li>
      ))}
    </ul>
  );
}
