import { api } from './api';
import { useQuest } from './store';
import type { LogService, MetricsTick, Progress, WsMessage } from './types';
import { LOG_SERVICES } from './types';

let started = false;

/** Reports that this page reached the engine; Chapter 0 level 1 checks for this event. */
export function announceUi(): void {
  void api.event('ui_connected').catch(() => undefined);
}

function handle(msg: WsMessage): void {
  const q = useQuest.getState();
  const d = msg.data ?? {};
  switch (msg.type) {
    case 'progress.changed':
      if (d.progress) q.applyProgress(d.progress as Progress);
      break;
    case 'redis.state':
      q.setRedis(Boolean(d.up));
      break;
    case 'metrics.tick':
      q.pushTick(d as unknown as MetricsTick);
      break;
    case 'log.line':
      if (LOG_SERVICES.includes(d.service as LogService)) q.pushLog(d.service as LogService, String(d.line ?? ''));
      break;
    case 'level.event':
      q.pushEvent({ at: msg.at, kind: String(d.kind ?? ''), name: typeof d.name === 'string' ? d.name : undefined, data: d.data });
      break;
    case 'cli.dangerous': {
      const command = String(d.command ?? '');
      q.setDangerous(command);
      // A flush wipes the game:* mirror; ask the engine whether it is still in sync.
      if (command === 'FLUSHALL' || command === 'FLUSHDB') setTimeout(() => void useQuest.getState().refreshMirror(), 400);
      break;
    }
    default:
      break;
  }
}

/** One shared socket for the whole app, reconnecting with capped backoff. */
export function startWs(): void {
  if (started) return;
  started = true;
  let attempt = 0;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    useQuest.getState().setWs('connecting');
    ws.onopen = () => {
      attempt = 0;
      useQuest.getState().setWs('open');
      announceUi();
      // After an outage events may have been missed: re-read the state we cannot rebuild from deltas.
      void useQuest.getState().refreshChapters();
      void useQuest.getState().refreshMirror();
    };
    ws.onmessage = (ev) => {
      try {
        handle(JSON.parse(String(ev.data)) as WsMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      useQuest.getState().setWs('closed');
      const delay = Math.min(5000, 400 * 2 ** attempt++);
      setTimeout(open, delay);
    };
    ws.onerror = () => ws.close();
  };
  open();
}
