import { create } from 'zustand';
import { api, ApiError } from './api';
import type {
  ChaptersResponse,
  Health,
  LevelEventMsg,
  LogService,
  MetricsTick,
  MirrorStatus,
  Progress,
} from './types';
import { LOG_SERVICES } from './types';

export type Boot = 'loading' | 'welcome' | 'ready' | 'invalid' | 'offline';
export type WsState = 'connecting' | 'open' | 'closed';

const MAX_LOG = 1000;
const MAX_TICKS = 180;
const MAX_EVENTS = 100;
let eventSeq = 0;

interface QuestState {
  boot: Boot;
  bootError: string | null;
  invalidErrors: string[];
  progress: Progress | null;
  chapters: ChaptersResponse | null;
  health: Health | null;
  mirror: MirrorStatus | null;
  wsState: WsState;
  redisUp: boolean | null;
  ticks: MetricsTick[];
  logs: Record<LogService, string[]>;
  events: LevelEventMsg[];
  dangerous: { command: string; at: number } | null;

  init: () => Promise<void>;
  createPlayer: (name: string) => Promise<void>;
  refreshChapters: () => Promise<void>;
  refreshMirror: () => Promise<void>;
  restore: () => Promise<void>;
  applyProgress: (p: Progress) => void;
  setWs: (s: WsState) => void;
  setRedis: (up: boolean) => void;
  pushTick: (t: MetricsTick) => void;
  seedTicks: (t: MetricsTick[]) => void;
  pushLog: (service: LogService, line: string) => void;
  seedLog: (service: LogService, lines: string[]) => void;
  pushEvent: (e: Omit<LevelEventMsg, 'seq'>) => void;
  setDangerous: (command: string) => void;
}

const emptyLogs = () =>
  Object.fromEntries(LOG_SERVICES.map((s) => [s, [] as string[]])) as Record<LogService, string[]>;

export const useQuest = create<QuestState>((set, get) => ({
  boot: 'loading',
  bootError: null,
  invalidErrors: [],
  progress: null,
  chapters: null,
  health: null,
  mirror: null,
  wsState: 'connecting',
  redisUp: null,
  ticks: [],
  logs: emptyLogs(),
  events: [],
  dangerous: null,

  async init() {
    try {
      const p = await api.progress();
      set({ progress: p, boot: 'ready', bootError: null });
      void get().refreshChapters();
      void get().refreshMirror();
      void api
        .health()
        .then((h) => set({ health: h }))
        .catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.code === 'no_player')
        set({ boot: 'welcome', bootError: null });
      else if (e instanceof ApiError && e.code === 'levels_invalid') {
        const errs = Array.isArray(e.body.errors)
          ? (e.body.errors as unknown[]).map(String)
          : [e.message];
        set({ boot: 'invalid', invalidErrors: errs });
      } else set({ boot: 'offline', bootError: e instanceof Error ? e.message : String(e) });
    }
  },

  async createPlayer(name) {
    const p = await api.createPlayer(name);
    set({ progress: p, boot: 'ready' });
    void get().refreshChapters();
    void get().refreshMirror();
  },

  async refreshChapters() {
    try {
      set({ chapters: await api.chapters() });
    } catch {
      /* the map shows its own error state when chapters stay null */
    }
  },

  async refreshMirror() {
    try {
      set({ mirror: await api.mirror() });
    } catch {
      set({ mirror: null });
    }
  },

  async restore() {
    await api.restore();
    await get().refreshMirror();
  },

  applyProgress(p) {
    set({ progress: p });
    void get().refreshChapters();
  },
  setWs: (wsState) => set({ wsState }),
  setRedis: (up) => {
    set({ redisUp: up });
    if (up) void get().refreshMirror();
  },
  pushTick: (t) => set((s) => ({ ticks: [...s.ticks, t].slice(-MAX_TICKS) })),
  seedTicks: (t) => set((s) => ({ ticks: s.ticks.length ? s.ticks : t.slice(-MAX_TICKS) })),
  pushLog: (service, line) =>
    set((s) => {
      if (!(service in s.logs)) return s;
      const next = [...s.logs[service], line];
      return {
        logs: { ...s.logs, [service]: next.length > MAX_LOG ? next.slice(-MAX_LOG) : next },
      };
    }),
  seedLog: (service, lines) =>
    set((s) => ({ logs: { ...s.logs, [service]: lines.slice(-MAX_LOG) } })),
  pushEvent: (e) =>
    set((s) => ({ events: [...s.events, { ...e, seq: ++eventSeq }].slice(-MAX_EVENTS) })),
  setDangerous: (command) => set({ dangerous: { command, at: Date.now() } }),
}));
