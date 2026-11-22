import type { Cabinet } from '../../kit';
import { BeTheRedis } from './BeTheRedis';
import { META } from './meta';

/** Cabinet 1: the player is Redis, and learns that one slow command holds the whole line. */
export const beTheRedis: Cabinet = { ...META, Component: BeTheRedis };
