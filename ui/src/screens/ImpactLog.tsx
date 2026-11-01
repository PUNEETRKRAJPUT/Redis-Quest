import type { Impact } from '../impact';

/** F-13: before and after numbers per passed level, read from the save. Levels without numbers are not listed. */
export function ImpactLog({ impact }: { impact: Impact }) {
  return (
    <section data-testid="impact-log" aria-labelledby="impact-log-title">
      <h2 id="impact-log-title">Impact log</h2>
      <p className="muted" data-testid="impact-summary">
        {impact.summary}
      </p>
      {impact.entries.length === 0 ? (
        <p className="muted">
          No numbers yet. Levels that load-test your code or time your rebuild show up here.
        </p>
      ) : (
        <ul className="impact-list">
          {impact.entries.map((e) => (
            <li key={e.levelId} data-testid={`impact-${e.levelId}`}>
              <strong>{e.title}</strong> <span className="muted">{e.chapter}</span>
              <div>{e.phrases.join('; ')}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
