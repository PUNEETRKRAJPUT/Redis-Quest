'use client';
// The match view's frame: the level header, then three resizable panes (the brief, the workspace, the scoreboard)
// that fill the window below the HUD and remember their sizes. Below 1280 px wide the panes stack in page flow.
import { clsx } from 'clsx';
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { IconButton } from '../design';
import { PANES_MIN_WIDTH, paneStorage, useFillHeight, useMediaQuery } from './layout';

const PANEL_IDS = ['brief', 'workspace', 'scoreboard'];
const WIDE_SCOREBOARD = 46;

type ScoreboardWidth = { panes: boolean; widened: boolean; toggle: () => void };
const ScoreboardWidthContext = createContext<ScoreboardWidth>({
  panes: false,
  widened: false,
  toggle: () => undefined,
});
/** Lets the scoreboard widen itself (the ideal way and the show-me panels like room). */
export const useScoreboardWidth = () => useContext(ScoreboardWidthContext);

/** Widens the scoreboard pane for the ideal way and the show-me panels, and puts it back. Panes mode only. */
export function WidenToggle() {
  const { panes, widened, toggle } = useScoreboardWidth();
  if (!panes) return null;
  return (
    <IconButton
      label={widened ? 'Narrow the scoreboard' : 'Widen the scoreboard'}
      icon={widened ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      variant="quiet"
      size="sm"
      onClick={toggle}
      aria-pressed={widened}
    />
  );
}

function Handle({ label }: { label: string }) {
  return (
    <Separator
      aria-label={label}
      className={clsx(
        'group relative z-10 flex w-[9px] shrink-0 cursor-col-resize items-stretch justify-center outline-none',
        'focus-visible:outline-none',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'my-3 w-px rounded-full bg-night-600/70 transition-[background-color,box-shadow,width] duration-fast',
          'group-hover:w-[3px] group-hover:bg-flood-500/70',
          'group-data-[separator=active]:w-[3px] group-data-[separator=active]:bg-flood-400 group-data-[separator=active]:shadow-[0_0_12px_rgb(255_154_31/0.6)]',
          'group-data-[separator=focus]:w-[3px] group-data-[separator=focus]:bg-sky',
        )}
      />
    </Separator>
  );
}

export function MatchView({
  header,
  brief,
  workspace,
  scoreboard,
  overlay,
  ...rest
}: {
  header: ReactNode;
  brief: ReactNode;
  workspace: ReactNode;
  scoreboard: ReactNode;
  /** The big screen, drawn over everything (it never takes pointer events). */
  overlay?: ReactNode;
  'data-testid'?: string;
  'data-level'?: string;
  'data-status'?: string;
  'data-mode'?: string;
}) {
  const panes = useMediaQuery(`(min-width: ${PANES_MIN_WIDTH}px)`);
  const [measureRef, height] = useFillHeight(panes);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'rq:match-panes',
    panelIds: PANEL_IDS,
    storage: paneStorage,
  });
  const scoreRef = usePanelRef();
  const before = useRef<number | null>(null);
  const [widened, setWidened] = useState(false);
  const width = useMemo<ScoreboardWidth>(
    () => ({
      panes,
      widened,
      toggle: () => {
        const p = scoreRef.current;
        if (!p) return;
        if (widened) {
          p.resize(`${before.current ?? 24}%`);
          setWidened(false);
        } else {
          before.current = p.getSize().asPercentage;
          p.resize(`${WIDE_SCOREBOARD}%`);
          setWidened(true);
        }
      },
    }),
    [panes, widened, scoreRef],
  );

  return (
    <ScoreboardWidthContext.Provider value={width}>
      <main
        data-ds=""
        ref={measureRef}
        className={clsx(
          'relative flex min-w-0 flex-col text-chalk',
          panes ? 'overflow-hidden' : 'pb-10',
        )}
        style={panes && height ? { height } : undefined}
        {...rest}
      >
        {header}
        {panes ? (
          <Group
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
            className="min-h-0 flex-1 px-2 pb-2"
          >
            <Panel id="brief" defaultSize="33%" minSize={320} className="h-full">
              <section
                aria-label="The brief"
                data-pane-scroll=""
                className="h-full overflow-y-auto overscroll-contain rounded-lg border border-night-600/60 bg-night-900/70 [scrollbar-gutter:stable]"
              >
                {brief}
              </section>
            </Panel>
            <Handle label="Resize the brief" />
            <Panel id="workspace" defaultSize="43%" minSize={380} className="h-full">
              <section aria-label="Your workspace" className="h-full min-w-0">
                {workspace}
              </section>
            </Panel>
            <Handle label="Resize the scoreboard" />
            <Panel
              id="scoreboard"
              panelRef={scoreRef}
              defaultSize="24%"
              minSize={300}
              className="h-full"
            >
              <section
                aria-label="Scoreboard"
                data-pane-scroll=""
                className="h-full overflow-y-auto overscroll-contain rounded-lg border border-night-600/60 bg-night-900/70 [scrollbar-gutter:stable]"
              >
                {scoreboard}
              </section>
            </Panel>
          </Group>
        ) : (
          <div className="flex flex-col gap-4 px-4">
            <section
              aria-label="The brief"
              className="rounded-lg border border-night-600/60 bg-night-900/70"
            >
              {brief}
            </section>
            <section aria-label="Your workspace" className="h-[620px] min-w-0">
              {workspace}
            </section>
            <section
              aria-label="Scoreboard"
              className="rounded-lg border border-night-600/60 bg-night-900/70"
            >
              {scoreboard}
            </section>
          </div>
        )}
        {overlay}
      </main>
    </ScoreboardWidthContext.Provider>
  );
}
