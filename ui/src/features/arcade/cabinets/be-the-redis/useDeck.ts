'use client';
import { useEffect, useMemo } from 'react';
import { useDocsVersion } from '@/terminal/useDocs';
import { docsStore } from '@/terminal/docs';
import { chooseDeck, wantedNames, type Deck, type InfoLookup } from './cards';

/**
 * The deck for the next round: the server's own words for the commands of the game, read through the terminal's
 * docs reader (one cache for the whole session, read-only, no command sent to Redis), or the built-in copy while
 * the stack is down. The reader asks nothing until the engine says it has the endpoint (`/health`), so a stack
 * without it costs no failed request.
 */
export function useDeck(): Deck {
  const store = docsStore();
  const version = useDocsVersion();

  useEffect(() => {
    store.ensureNames();
    // The store backs off by itself after a failure; this only nudges it to look again.
    const timer = setInterval(() => store.ensureNames(), 5000);
    return () => clearInterval(timer);
  }, [store]);

  useEffect(() => {
    if (store.names()) store.want(wantedNames());
  }, [store, version]);

  return useMemo(() => {
    const lookup: InfoLookup = (name) => {
      const doc = store.doc(name);
      if (doc === undefined || doc === 'missing') return doc;
      return { summary: doc.summary, complexity: doc.complexity ?? '' };
    };
    return chooseDeck(lookup);
    // `version` is the cache's change counter: the lookup reads it through `store`.
  }, [store, version]);
}
