'use client';
// The first run: floodlights come on over the title, the incident arrives as chat, then the name form. Escape (or
// "Skip intro") jumps straight to the form; under reduced motion the whole scene is one still. Behaviour of the
// form is unchanged from the original: `createPlayer`, `player_exists` falls back to `init`, same test ids.
import { Volume2, VolumeOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import {
  Button,
  DURATION,
  EASE_OUT,
  IconButton,
  SPRING,
  floodlights,
  play,
  unlockAudio,
  useReducedMotion,
  useSettings,
} from '../design';
import { Bubble, Typing } from '../onboarding/Chat';
import { NameForm } from '../onboarding/NameForm';
import { Stage } from '../onboarding/Stage';
import { showKickoff } from '../onboarding/Kickoff';
import { hydrateProfile, useProfile } from '../onboarding/profile';
import {
  TIMELINE,
  formRevealAt,
  messageSchedule,
  pickIncident,
  speakerFor,
} from '../onboarding/scene';
import { useQuest } from '../store';
import type { ThreadMessage } from '../types';

const TITLE = 'Redis Quest';

function Title({ on, reduced }: { on: boolean; reduced: boolean }) {
  const letters = TITLE.split('');
  return (
    <div className="relative flex flex-col items-center text-center">
      <h1
        aria-label={TITLE}
        className="relative m-0 font-display text-[clamp(52px,8.4vw,120px)] font-bold uppercase leading-[0.92] tracking-[0.045em]"
      >
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 select-none text-flood-500 blur-[22px]"
          initial={false}
          animate={{ opacity: on ? 0.55 : 0 }}
          transition={{ duration: reduced ? 0.15 : 1.6, ease: EASE_OUT, delay: reduced ? 0 : 0.5 }}
        >
          {TITLE}
        </motion.span>
        <span aria-hidden className="relative inline-flex whitespace-pre">
          {letters.map((ch, i) => (
            <motion.span
              key={i}
              className="inline-block bg-linear-to-b from-chalk from-35% to-flood-400 bg-clip-text text-transparent"
              initial={false}
              animate={on ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 36 }}
              transition={
                reduced
                  ? { duration: 0.15 }
                  : { duration: DURATION.slow * 1.6, ease: EASE_OUT, delay: i * 0.05 }
              }
            >
              {ch}
            </motion.span>
          ))}
        </span>
      </h1>
      <motion.div
        initial={false}
        animate={{ opacity: on ? 1 : 0 }}
        transition={{ duration: reduced ? 0.15 : 0.9, delay: reduced ? 0 : 0.7 }}
        className="mt-4 flex flex-col items-center gap-2"
      >
        <span aria-hidden className="rule-fade block h-px w-[min(520px,70vw)]" />
        <p className="label-caps m-0 text-md tracking-[0.3em] text-flood-400">
          Season 7 · Nukkad Cricket League
        </p>
        <p className="m-0 text-base text-chalk-dim">
          Match night. Something is about to go wrong. You are the backend.
        </p>
      </motion.div>
    </div>
  );
}

export function Welcome() {
  const create = useQuest((s) => s.createPlayer);
  const init = useQuest((s) => s.init);
  const reduced = useReducedMotion();
  const sound = useSettings((s) => s.sound);
  const setSound = useSettings((s) => s.setSound);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The scene's clock. `skipped` and `reduced` short-circuit it into its final frame.
  const [skipped, setSkipped] = useState(false);
  const [lit, setLit] = useState(false);
  const [titleOn, setTitleOn] = useState(false);
  const [chatOn, setChatOn] = useState(false);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState<number | null>(null);
  const [formOn, setFormOn] = useState(false);

  const [messages, setMessages] = useState<ThreadMessage[]>(() => pickIncident(null));
  const messagesRef = useRef(messages);
  const chatStarted = useRef(false);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const instant = reduced || skipped;
  const view = {
    lit: instant || lit,
    titleOn: instant || titleOn,
    chatOn: instant || chatOn,
    shown: instant ? messages.length : shown,
    typing: instant ? null : typing,
    formOn: instant || formOn,
  };

  useEffect(() => {
    void hydrateProfile();
  }, []);

  // The real chapter 0 incident, when the engine will tell us without a player. The fallback is already on screen.
  useEffect(() => {
    let cancelled = false;
    api
      .chapters()
      .then((r) => {
        if (cancelled || chatStarted.current) return;
        const ch = r.chapters.find((c) => c.id === 'ch0') ?? r.chapters[0];
        setMessages(pickIncident(ch?.incident));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The timeline. Cleared wholesale when the player skips.
  useEffect(() => {
    if (instant) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => void timers.push(setTimeout(fn, ms));
    at(TIMELINE.lights, () => {
      setLit(true);
      floodlights();
    });
    at(TIMELINE.title, () => setTitleOn(true));
    at(TIMELINE.chat, () => {
      chatStarted.current = true;
      const msgs = messagesRef.current;
      setChatOn(true);
      messageSchedule(msgs).forEach((s, i) => {
        at(s.typingAt - TIMELINE.chat, () => setTyping(i));
        at(s.at - TIMELINE.chat, () => {
          setTyping(null);
          setShown(i + 1);
          play(msgs[i]?.from === 'senior' ? 'pager' : 'msg');
        });
      });
      at(formRevealAt(msgs) - TIMELINE.chat, () => setFormOn(true));
    });
    return () => timers.forEach(clearTimeout);
  }, [instant]);

  const skip = () => {
    chatStarted.current = true;
    setSkipped(true);
  };
  const toggleSound = () => {
    const next = !useSettings.getState().sound;
    setSound(next);
    if (next) {
      unlockAudio();
      play('tick');
    }
  };
  const skipRef = useRef(skip);
  const soundRef = useRef(toggleSound);
  useEffect(() => {
    skipRef.current = skip;
    soundRef.current = toggleSound;
  });

  const keysLive = !view.formOn;
  useEffect(() => {
    if (!keysLive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        skipRef.current();
      } else if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        soundRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysLive]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const player = name.trim();
    try {
      await create(player);
      showKickoff({ name: player, jersey: useProfile.getState().jersey });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'player_exists') await init();
      else setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const visible = useMemo(() => messages.slice(0, view.shown), [messages, view.shown]);
  const typer = view.typing !== null ? speakerFor(messages[view.typing]?.from ?? '') : null;

  return (
    <main
      data-ds=""
      data-testid="welcome"
      data-scene={view.formOn ? 'form' : 'playing'}
      className="relative isolate min-h-dvh overflow-x-hidden text-chalk"
    >
      <Stage lit={view.lit} />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1120px] flex-col items-center justify-center gap-9 px-6 py-10">
        <motion.header layout="position" transition={reduced ? { duration: 0 } : SPRING.card}>
          <Title on={view.titleOn} reduced={reduced} />
        </motion.header>

        {view.chatOn ? (
          <div className="flex w-full flex-col items-center justify-center gap-6 lg:flex-row lg:items-stretch">
            <motion.section
              layout="position"
              transition={reduced ? { duration: 0 } : SPRING.card}
              initial={instant ? false : { opacity: 0, y: 18 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { delay: 0.3, duration: DURATION.slow, ease: EASE_OUT },
              }}
              aria-label="Tonight's messages"
              className="flex h-[430px] w-full max-w-[460px] flex-col overflow-hidden rounded-xl border border-night-600/80 bg-night-900/80 shadow-pop backdrop-blur-sm"
            >
              <div className="flex items-center gap-3 border-b border-night-600/70 px-4 py-3">
                <span aria-hidden className="size-2 rounded-full bg-turf shadow-glow-turf" />
                <div className="flex flex-col leading-tight">
                  <span className="text-md font-semibold text-chalk">The group</span>
                  <span className="text-xs text-chalk-dim">Shivneri Hostel, launch night</span>
                </div>
              </div>
              <ul
                role="log"
                aria-label="Messages"
                className="m-0 flex flex-1 list-none flex-col justify-end gap-3 overflow-hidden p-4 [mask-image:linear-gradient(to_bottom,transparent,#000_56px)]"
              >
                {visible.map((m, i) => (
                  <Bubble key={i} message={m} reduced={reduced} instant={instant && i >= shown} />
                ))}
                <AnimatePresence>
                  {typer ? <Typing key="typing" speaker={typer} reduced={reduced} /> : null}
                </AnimatePresence>
              </ul>
            </motion.section>

            {view.formOn ? (
              <motion.section
                data-testid="welcome-card"
                aria-label="Join the team"
                initial={instant ? false : { opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                transition={reduced ? { duration: DURATION.fast } : SPRING.card}
                className="relative w-full max-w-[460px] rounded-xl border border-flood-500/30 bg-night-900/85 p-6 shadow-glow backdrop-blur-sm"
              >
                <NameForm
                  name={name}
                  onNameChange={setName}
                  onSubmit={() => void submit()}
                  busy={busy}
                  error={err}
                  autoFocus
                />
              </motion.section>
            ) : null}
          </div>
        ) : null}
      </div>

      {!view.formOn ? (
        <div className="fixed bottom-5 right-5 z-20 flex items-center gap-1">
          <IconButton
            label={sound ? 'Sound on (S)' : 'Sound off (S)'}
            icon={sound ? <Volume2 size={16} /> : <VolumeOff size={16} />}
            variant="quiet"
            onClick={toggleSound}
          />
          <Button
            variant="quiet"
            size="sm"
            shortcut="Esc"
            onClick={skip}
            data-testid="welcome-skip"
          >
            Skip intro
          </Button>
        </div>
      ) : null}
    </main>
  );
}
