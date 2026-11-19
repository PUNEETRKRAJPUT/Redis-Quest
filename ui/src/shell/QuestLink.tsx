import Link from 'next/link';
import type { ComponentProps } from 'react';
import { pathFor } from '../routes';
import type { Route } from '../routes';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & {
  /** A game route, or an internal path such as `/terminal`. */
  to: Route | string;
};

/** Every internal link in the game: a client navigation, so the shell, the socket and the store survive it. */
export function QuestLink({ to, ...rest }: Props) {
  return <Link href={typeof to === 'string' ? to : pathFor(to)} {...rest} />;
}
