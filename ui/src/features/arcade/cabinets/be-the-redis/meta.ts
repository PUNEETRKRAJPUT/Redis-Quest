import type { Cabinet } from '../../kit';
import { FACTS } from './facts';

export const LESSON =
  'Commands run one after another, so one slow command delays every client behind it.';

/** What the arcade page and the frame show about this cabinet; the game itself is BeTheRedis.tsx. */
export const META: Omit<Cabinet, 'Component'> = {
  id: 'be-the-redis',
  title: 'Be the Redis',
  pitch: 'Clients send you commands. Run them one at a time and keep the line moving.',
  lesson: LESSON,
  facts: FACTS,
  keys: [
    { keys: ['Space'], does: 'Run the command at the front of the line' },
    { keys: ['S'], does: 'Swap a slow command for its incremental form, when offered' },
    { keys: ['P'], does: 'Pause or resume' },
    { keys: ['R'], does: 'Restart the round' },
    { keys: ['Enter'], does: 'Play again, after a round' },
  ],
};
