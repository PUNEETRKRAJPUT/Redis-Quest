// E-04: "Write my story" on the What you built page. The engine builds the page from the save and the workspace
// (POST /api/portfolio/write writes workspace/PORTFOLIO.md); this component asks for it and shows what was written.
import { useState } from 'react';
import { api, ApiError } from '../api';
import { Markdown } from '../markdown';
import type { PortfolioWriteResponse } from '../types';

export type StoryState =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'done'; path: string; bytes: number; markdown: string }
  | { phase: 'error'; message: string };

export interface StoryDeps {
  write: () => Promise<PortfolioWriteResponse>;
  /** The file that was just written, read back so the page shows exactly what is on disk. */
  read: () => Promise<string>;
}

/** What the button does: write the file, then read it back. Never throws; a failure is a state to show. */
export async function writeStory(deps: StoryDeps): Promise<StoryState> {
  try {
    const w = await deps.write();
    const markdown = await deps.read();
    return { phase: 'done', path: w.path, bytes: w.bytes, markdown };
  } catch (e) {
    return {
      phase: 'error',
      message: e instanceof ApiError || e instanceof Error ? e.message : String(e),
    };
  }
}

export function StoryView({ state, onWrite }: { state: StoryState; onWrite: () => void }) {
  return (
    <section className="story" data-testid="story" aria-labelledby="story-title">
      <h2 id="story-title">Your story</h2>
      <p className="muted">
        The game writes one page from your save file and your workspace: what you passed, the
        numbers its checks measured, how you thought, and what to say about it. It never adds a
        claim your save does not back.
      </p>
      <button
        type="button"
        className="btn"
        onClick={onWrite}
        disabled={state.phase === 'busy'}
        data-testid="write-portfolio"
      >
        {state.phase === 'busy'
          ? 'Writing...'
          : state.phase === 'done'
            ? 'Write it again'
            : 'Write my story'}
      </button>
      {state.phase === 'error' ? (
        <p className="callout warn" role="alert" data-testid="portfolio-error">
          {state.message}
        </p>
      ) : null}
      {state.phase === 'done' ? (
        <div data-testid="portfolio-result">
          <p data-testid="portfolio-path">
            Written to <code>{state.path}</code> ({state.bytes} bytes).
          </p>
          <div className="portfolio-page" data-testid="portfolio-markdown">
            <Markdown source={state.markdown} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function Story() {
  const [state, setState] = useState<StoryState>({ phase: 'idle' });
  const onWrite = () => {
    setState({ phase: 'busy' });
    void writeStory({
      write: () => api.writePortfolio(),
      read: async () => (await api.readFile('PORTFOLIO.md')).content,
    }).then(setState);
  };
  return <StoryView state={state} onWrite={onWrite} />;
}
