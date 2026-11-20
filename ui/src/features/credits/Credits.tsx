'use client';

import { ChevronLeft, ChevronRight, ListTree, Pause, Play } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, rise, useReducedMotion, variantsFor } from '@/design';
import { QuestLink } from '@/shell/QuestLink';
import { useQuest } from '@/store';
import { fetchCommunityLevels, type CommunityLevelLine } from '../yourturn/client';
import { fetchCredits } from './client';
import {
  SECTION_MS,
  buildSections,
  playerNumbers,
  rollKey,
  stepIndex,
  type CreditSection,
  type CreditsData,
} from './logic';

function Lines({ section }: { section: CreditSection }) {
  if (section.lines.length === 0)
    return <p className="m-0 text-md text-chalk-dim">{section.note}</p>;
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {section.lines.map((l) => (
          <li key={l.id} className="flex flex-col gap-0.5 border-b border-night-600/50 pb-3">
            <span className="font-display text-xl font-semibold uppercase tracking-wide text-chalk">
              {l.primary}
            </span>
            {l.secondary && <span className="text-md text-chalk-dim">{l.secondary}</span>}
          </li>
        ))}
      </ul>
      {section.note && <p className="m-0 mt-3 text-sm text-chalk-dim">{section.note}</p>}
    </>
  );
}

function Board({
  section,
  index,
  count,
}: {
  section: CreditSection;
  index: number;
  count: number;
}) {
  return (
    <section
      aria-labelledby={`credits-${section.id}`}
      data-testid={`credits-${section.id}`}
      className="rounded-lg border border-night-600 bg-night-900 p-6"
    >
      <p className="label-caps m-0 text-xs text-flood-400">
        {index + 1} / {count}
      </p>
      <h2
        id={`credits-${section.id}`}
        className="m-0 mb-4 font-display text-3xl font-semibold uppercase tracking-display text-chalk"
      >
        {section.title}
      </h2>
      <Lines section={section} />
    </section>
  );
}

/**
 * A scoreboard roll: the cast, the authors of community levels, the people in CONTRIBUTORS.md, and your own line.
 * It plays itself one section at a time and never has to: under reduced motion it starts paused and has no fade,
 * every key and button works the same, and "Show everything" lays all sections out at once.
 */
export function Credits() {
  const reduced = useReducedMotion();
  const progress = useQuest((s) => s.progress);
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [community, setCommunity] = useState<CommunityLevelLine[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [all, setAll] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCredits(), fetchCommunityLevels()]).then(([c, l]) => {
      if (cancelled) return;
      setCredits(c);
      setCommunity(l);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo(
    () => buildSections({ credits, community, player: playerNumbers(progress) }),
    [credits, community, progress],
  );
  const last = sections.length - 1;
  const running = playing && !reduced && !all && loaded && index < last;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setIndex((i) => stepIndex(i, 1, sections.length)), SECTION_MS);
    return () => clearTimeout(t);
  }, [running, index, sections.length]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // A focused button keeps Space and Enter for itself; the roll only claims keys when nothing else wants them.
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    const k = rollKey(e.key);
    if (k === null) return;
    e.preventDefault();
    setPlaying(false);
    if (k === 'next') setIndex((i) => stepIndex(i, 1, sections.length));
    else if (k === 'prev') setIndex((i) => stepIndex(i, -1, sections.length));
    else if (k === 'first') setIndex(0);
    else if (k === 'last') setIndex(last);
    else if (k === 'skip') setAll(true);
    else setPlaying((p) => !p);
  }

  return (
    <main data-ds="" data-testid="credits" className="mx-auto w-full max-w-[860px] px-6 py-8">
      <h1 className="m-0 font-display text-2xl font-semibold uppercase tracking-display text-chalk">
        Credits
      </h1>
      <p className="mb-5 mt-1 text-md text-chalk-dim">
        Everyone who built the league. Arrow keys move, Space pauses, Escape shows everything.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!all && (
          <>
            <Button
              variant="ghost"
              size="sm"
              leading={<ChevronLeft size={14} aria-hidden="true" />}
              disabled={index === 0}
              onClick={() => {
                setPlaying(false);
                setIndex((i) => stepIndex(i, -1, sections.length));
              }}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              trailing={<ChevronRight size={14} aria-hidden="true" />}
              disabled={index >= last}
              onClick={() => {
                setPlaying(false);
                setIndex((i) => stepIndex(i, 1, sections.length));
              }}
            >
              Next
            </Button>
            <Button
              variant="quiet"
              size="sm"
              leading={
                playing ? (
                  <Pause size={14} aria-hidden="true" />
                ) : (
                  <Play size={14} aria-hidden="true" />
                )
              }
              onClick={() => setPlaying((p) => !p)}
              data-testid="credits-play"
            >
              {playing && !reduced ? 'Pause' : 'Play'}
            </Button>
          </>
        )}
        <Button
          variant="quiet"
          size="sm"
          leading={<ListTree size={14} aria-hidden="true" />}
          onClick={() => setAll((v) => !v)}
          data-testid="credits-all"
        >
          {all ? 'Back to the roll' : 'Show everything'}
        </Button>
        <QuestLink to="/" className="ml-auto text-md text-sky" data-testid="credits-skip">
          Skip to the map
        </QuestLink>
      </div>

      {!loaded ? (
        <p className="text-md text-chalk-dim" role="status">
          Reading the credits.
        </p>
      ) : all ? (
        <div className="flex flex-col gap-4" data-testid="credits-list">
          {sections.map((s, i) => (
            <Board key={s.id} section={s} index={i} count={sections.length} />
          ))}
        </div>
      ) : (
        <div
          ref={root}
          role="group"
          aria-roledescription="roll"
          aria-label="Credits roll"
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="credits-roll"
          className="rounded-lg outline-offset-4"
        >
          <motion.div
            key={sections[index]?.id}
            variants={variantsFor(rise, reduced)}
            initial="hidden"
            animate="show"
          >
            {sections[index] && (
              <Board section={sections[index]} index={index} count={sections.length} />
            )}
          </motion.div>
        </div>
      )}
    </main>
  );
}
