import { Markdown } from '../markdown';
import type { LevelData, VerifyResponse } from '../types';

/**
 * Beat 7. The engine does not serve reference solutions yet (GET /api/levels/:id never sends them), so this
 * panel renders `ideal` from the verify response when P0-09 adds it, and otherwise the parts the UI does have:
 * the learner's own guess next to the reasonable options, the task, the docs and every hint.
 */
export function IdealWay({ level, result }: { level: LevelData; result: VerifyResponse | null }) {
  const ideal = result?.ideal;
  const guess = level.brainstormAnswer;
  const option = guess ? level.brainstorm.options.find((o) => o.id === guess.optionId) : undefined;
  return (
    <div className="ideal" data-testid="ideal">
      {ideal?.reference ? (
        <>
          <h3>Reference solution</h3>
          <Markdown source={'```' + (ideal.language ?? 'js') + '\n' + ideal.reference + '\n```'} />
          {ideal.annotations ? <Markdown source={ideal.annotations} /> : null}
          {ideal.tradeoffs?.length ? (
            <>
              <h3>Trade-offs</h3>
              <ul>{ideal.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          ) : null}
        </>
      ) : (
        <p className="callout">
          The reference solution for this level is not served by the engine yet, so it cannot be shown here. It lives in the repo at <code>levels/{level.chapter}*/solutions/</code>.
        </p>
      )}
      <div className="compare">
        <div>
          <h3>What you guessed (beat 3)</h3>
          {guess ? (
            <>
              <p><strong>{option?.label ?? guess.optionId}</strong></p>
              <p className="quote">{guess.text}</p>
              {option ? <p className="muted">{option.is_reasonable ? 'A reasonable first instinct for this problem.' : 'Not the usual first pick for this problem, and that is fine: the teach panel says why.'}</p> : null}
            </>
          ) : (
            <p className="muted">You skipped the brainstorm.</p>
          )}
        </div>
        <div>
          <h3>What you built</h3>
          <Markdown source={level.task} />
        </div>
      </div>
      {level.docs.length ? (
        <p>
          Read next:{' '}
          {level.docs.map((d, i) => (
            <span key={d}>{i ? ', ' : ''}<a href={d} target="_blank" rel="noopener noreferrer">{d.replace('https://redis.io/docs/latest/', 'redis.io/docs/')}<span className="sr-only"> (opens in a new tab)</span></a></span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
