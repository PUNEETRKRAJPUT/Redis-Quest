import Link from 'next/link';
import type { ComponentProps } from 'react';
import { pathFor } from '../routes';
import type { Route } from '../routes';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & {
  /** A game route, or an internal path such as `/terminal`. */
  to: Route | string;
};

/**
 * Every internal link in the game: a client navigation, so the shell, the socket and the store survive it. The
 * `rq-nav` transition type makes the shell cross-fade the page area (see GameShell); a caller may pass its own.
 */
export function QuestLink({ to, transitionTypes = ['rq-nav'], ...rest }: Props) {
  return (
    <Link
      href={typeof to === 'string' ? to : pathFor(to)}
      transitionTypes={transitionTypes}
      {...rest}
    />
  );
}
