'use client';
// Feedback and celebration hosts: Toaster, Confetti, Floodlights, and DesignRuntime which mounts them once.
import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onConfetti, onFloodlights, type ConfettiOptions } from '../fx';
import { DURATION, EASE_OUT, SPRING, isReducedMotionNow, useReducedMotion } from '../motion';
import { hydrateSettings, useSettings } from '../settings';
import { unlockAudio } from '../sound';
import { useToasts, type ToastItem, type ToastTone } from '../toast';

const TOAST_ICON: Record<ToastTone, ReactNode> = {
  info: <Info size={16} className="text-sky" aria-hidden />,
  success: <CircleCheck size={16} className="text-turf" aria-hidden />,
  error: <CircleAlert size={16} className="text-wicket" aria-hidden />,
  warn: <TriangleAlert size={16} className="text-flood-400" aria-hidden />,
};
const TOAST_EDGE: Record<ToastTone, string> = {
  info: 'before:bg-sky',
  success: 'before:bg-turf',
  error: 'before:bg-wicket',
  warn: 'before:bg-flood-500',
};

function ToastCard({ t }: { t: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!t.duration || paused) return;
    const id = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t.id, t.duration, paused, dismiss]);
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, x: 24, transition: { duration: DURATION.fast, ease: EASE_OUT } }
      }
      transition={reduced ? { duration: DURATION.fast } : SPRING.pop}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      role={t.tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'pointer-events-auto relative flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 overflow-hidden rounded-md border border-night-600 bg-night-800 py-3 pl-4 pr-2 shadow-pop',
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        TOAST_EDGE[t.tone],
      )}
    >
      <span className="mt-0.5">{TOAST_ICON[t.tone]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-md font-semibold leading-5 text-chalk">{t.title}</div>
        {t.description && (
          <div className="mt-0.5 text-sm leading-5 text-chalk-dim">{t.description}</div>
        )}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action?.onClick();
              dismiss(t.id);
            }}
            className="mt-2 cursor-pointer rounded-xs text-sm font-semibold text-flood-400 underline-offset-4 hover:underline"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(t.id)}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-sm text-chalk-faint transition-colors duration-fast hover:bg-night-700 hover:text-chalk"
      >
        <X size={14} aria-hidden />
      </button>
    </motion.li>
  );
}

/** Renders the toast queue bottom-right. Mounted by DesignRuntime; mount it yourself only without the runtime. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <section
      data-ds=""
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[70]"
    >
      <ol className="flex flex-col items-end gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} t={t} />
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

const CONFETTI_COLOURS = ['#FF9A1F', '#FFB347', '#2EE281', '#5CC8FF', '#B58CFF', '#EEF2FA'];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  r: number;
  vr: number;
  tilt: number;
  vt: number;
  colour: string;
  life: number;
};

/** The canvas host for `confetti()`. Draws nothing until fired; never intercepts input. */
export function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    let pieces: Piece[] = [];
    let raf = 0;
    let last = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      c.width = window.innerWidth * dpr;
      c.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      pieces = pieces.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
      for (const p of pieces) {
        p.vy += 1100 * dt; // gravity
        p.vx *= 1 - 1.6 * dt; // air drag
        p.vy *= 1 - 1.1 * dt;
        p.x += p.vx * dt + Math.sin(p.tilt) * 20 * dt;
        p.y += p.vy * dt;
        p.r += p.vr * dt;
        p.tilt += p.vt * dt;
        p.life -= dt;
        g.save();
        g.globalAlpha = Math.min(1, p.life * 2.5);
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.scale(1, Math.cos(p.tilt)); // the flutter: a strip turning in the air
        g.fillStyle = p.colour;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      raf = pieces.length ? requestAnimationFrame(frame) : 0;
      if (!raf) g.clearRect(0, 0, c.width, c.height);
    };

    const fire = (o: ConfettiOptions) => {
      if (isReducedMotionNow()) return;
      const ox = (o.x ?? 0.5) * window.innerWidth;
      const oy = (o.y ?? 0.3) * window.innerHeight;
      const count = o.count ?? 140;
      const spread = ((o.spread ?? 70) * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * spread * 2;
        const speed = 520 + Math.random() * 620;
        pieces.push({
          x: ox + (Math.random() - 0.5) * 30,
          y: oy,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          w: 5 + Math.random() * 5,
          h: 9 + Math.random() * 8,
          r: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          tilt: Math.random() * Math.PI,
          vt: 6 + Math.random() * 8,
          colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length] ?? '#FF9A1F',
          life: 1.6 + Math.random() * 0.9,
        });
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const off = onConfetti(fire);
    return () => {
      off();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[65] h-full w-full"
    />
  );
}

/** The host for `floodlights()`: two beams sweep across from the corner pylons. */
export function Floodlights() {
  const [run, setRun] = useState(0);
  useEffect(() => onFloodlights(() => setRun((n) => n + 1)), []);
  useEffect(() => {
    if (!run) return;
    const id = setTimeout(() => setRun(0), 1000);
    return () => clearTimeout(id);
  }, [run]);
  if (!run) return null;
  return (
    <div key={run} aria-hidden className="ds-flood">
      <div className="ds-flood__wash" />
      <div className="ds-flood__beam ds-flood__beam--left" />
      <div className="ds-flood__beam ds-flood__beam--right" />
    </div>
  );
}

/**
 * Mount once near the root (inside <body>). It reads the saved settings after hydration, writes the resolved
 * motion preference to <html data-motion>, unlocks audio on the first gesture, applies the preference to every
 * motion component under it, and hosts the toaster, confetti and floodlights.
 */
export function DesignRuntime({ children }: { children?: ReactNode }) {
  const reduced = useReducedMotion();
  const sound = useSettings((s) => s.sound);
  useEffect(() => {
    void hydrateSettings();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduce' : 'full';
  }, [reduced]);
  useEffect(() => {
    if (!sound) return;
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [sound]);
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      {children}
      <Floodlights />
      <Confetti />
      <Toaster />
    </MotionConfig>
  );
}
