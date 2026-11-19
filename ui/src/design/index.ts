'use client';
// One import surface for the "Night match" design system: `import { Button, toast, play } from '@/design'`.
// Fonts are not re-exported: next/font only runs inside the Next compiler, and the root layout imports
// `@/design/fonts` itself. The CSS (tokens.css) arrives through src/app/globals.css.

export { Button, IconButton, Kbd, Segmented, Switch, Tabs, Tooltip } from './components/controls';
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  IconButtonProps,
  KbdProps,
  SegmentedOption,
  SegmentedProps,
  SwitchProps,
  TabItem,
  TabsProps,
  TooltipProps,
} from './components/controls';

export { Card, Dialog, EmptyState, Panel, Pill, Skeleton } from './components/surfaces';
export type {
  CardProps,
  DialogProps,
  EmptyStateProps,
  PanelProps,
  PillProps,
  PillTone,
  SkeletonProps,
} from './components/surfaces';

export { FlipNumber, Meter, ProgressBar, Scoreline } from './components/data';
export type {
  FlipNumberProps,
  FlipSize,
  MeterProps,
  ProgressBarProps,
  ScorelineProps,
} from './components/data';

export { Confetti, DesignRuntime, Floodlights, Toaster } from './components/feedback';

export { toast, useToasts, TOAST_LIMIT } from './toast';
export type { ToastInput, ToastItem, ToastTone } from './toast';

export { celebrate, confetti, floodlights } from './fx';
export type { ConfettiOptions } from './fx';

export { CUES, CUE_NAMES, cueGain, play, renderCue, unlockAudio } from './sound';
export type { Cue, CueSpec } from './sound';

export {
  DURATION,
  DURATION_MS,
  EASE_IN_OUT,
  EASE_OUT,
  SPRING,
  STAGGER_CAP,
  STAGGER_MS,
  fade,
  isReducedMotionNow,
  list,
  listItem,
  pop,
  reduceVariants,
  rise,
  staggerDelay,
  useOsReducedMotion,
  useReducedMotion,
  variantsFor,
} from './motion';

export {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createSettingsStore,
  hydrateSettings,
  resolveReducedMotion,
  useSettings,
} from './settings';
export type { ReducedMotionSetting, SettingsState } from './settings';

export { contrastRatio, diffDigits, groupThousands, toDigits } from './digits';
