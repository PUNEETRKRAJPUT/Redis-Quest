// E-04: "Write my story" on the What you built page. The engine builds the page from the save and the workspace
// (POST /api/portfolio/write writes workspace/PORTFOLIO.md); this component asks for it and shows what was written.
import { Check, CircleAlert, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { Button } from '../design';
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
    <section
      data-ds=""
      data-testid="story"
      aria-labelledby="story-title"
      className="rounded-lg border border-night-600 bg-night-900 p-5 shadow-raise"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-sm bg-night-800 text-flood-400 shadow-hairline">
          <ScrollText size={18} aria-hidden />
        </span>
        <h2
          id="story-title"
          className="font-display text-xl font-semibold uppercase tracking-[0.04em] text-chalk"
        >
          Your story
        </h2>
      </div>
      <p className="mt-3 text-md leading-relaxed text-chalk-dim">
        The game writes one page from your save file and your workspace: what you passed, the
        numbers its checks measured, how you thought, and what to say about it. It never adds a
        claim your save does not back.
      </p>
      <Button
        className="mt-4"
        variant="primary"
        onClick={onWrite}
        loading={state.phase === 'busy'}
        loadingText="Writing..."
        data-testid="write-portfolio"
      >
        {state.phase === 'done' ? 'Write it again' : 'Write my story'}
      </Button>
      {state.phase === 'error' ? (
        <p
          className="mt-4 flex items-start gap-2 rounded-sm border border-wicket/40 bg-wicket/10 px-3 py-2 text-sm text-chalk"
          role="alert"
          data-testid="portfolio-error"
        >
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-wicket" aria-hidden />
          <span>{state.message}</span>
        </p>
      ) : null}
      {state.phase === 'done' ? (
        <div data-testid="portfolio-result" className="mt-5">
          <p
            data-testid="portfolio-path"
            className="flex items-center gap-2 text-sm text-chalk-dim"
          >
            <Check size={15} className="shrink-0 text-turf" aria-hidden />
            <span>
              Written to <code className="font-mono text-chalk">{state.path}</code> ({state.bytes}{' '}
              bytes).
            </span>
          </p>
          <div
            data-testid="portfolio-markdown"
            className="mt-3 max-h-[520px] overflow-auto rounded-md border border-night-600/70 bg-night-950/70 px-5 py-4 text-md leading-relaxed text-chalk [&_a]:text-sky [&_h1]:mb-3 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:uppercase [&_h1]:tracking-[0.02em] [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-[0.04em] [&_h2]:text-flood-400 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:text-chalk [&_ul]:list-disc [&_ul]:pl-5"
          >
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
