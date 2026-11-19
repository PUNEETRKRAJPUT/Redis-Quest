// Toasts: a module-level store plus `toast()`, callable from anywhere (event handlers, the WebSocket, the store).
// <Toaster /> (mounted once by DesignRuntime) renders them.
import { create } from 'zustand';
import { play, type Cue } from './sound';

export type ToastTone = 'info' | 'success' | 'error' | 'warn';

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before it leaves on its own; 0 keeps it until dismissed. Default 4500 (errors 7000). */
  duration?: number;
  /** One action button, e.g. { label: 'Undo', onClick }. */
  action?: { label: string; onClick: () => void };
  /** A sound cue to play as it appears (still silent while sound is off). */
  cue?: Cue;
};

export type ToastItem = Required<Pick<ToastInput, 'title' | 'tone' | 'duration'>> &
  Omit<ToastInput, 'title' | 'tone' | 'duration'> & { id: number; createdAt: number };

type ToastState = { toasts: ToastItem[]; dismiss: (id: number) => void; clear: () => void };

/** At most this many on screen; the oldest leaves first. */
export const TOAST_LIMIT = 4;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

let seq = 0;

function push(input: ToastInput): number {
  const id = ++seq;
  const tone = input.tone ?? 'info';
  const item: ToastItem = {
    ...input,
    id,
    tone,
    duration: input.duration ?? (tone === 'error' ? 7000 : 4500),
    createdAt: Date.now(),
  };
  useToasts.setState((s) => ({ toasts: [...s.toasts, item].slice(-TOAST_LIMIT) }));
  if (input.cue) play(input.cue);
  return id;
}

type ToastFn = ((input: ToastInput | string) => number) & {
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  warn: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
};

/** `toast('Saved')`, `toast({ title, description, tone, action })`, `toast.success(...)`, `toast.dismiss(id)`. */
export const toast: ToastFn = Object.assign(
  (input: ToastInput | string) => push(typeof input === 'string' ? { title: input } : input),
  {
    success: (title: string, description?: string) => push({ title, description, tone: 'success' }),
    error: (title: string, description?: string) => push({ title, description, tone: 'error' }),
    warn: (title: string, description?: string) => push({ title, description, tone: 'warn' }),
    dismiss: (id: number) => useToasts.getState().dismiss(id),
  },
);
