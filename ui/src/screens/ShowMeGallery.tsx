'use client';

import { clsx } from 'clsx';
import { Eraser, FlaskConical, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button, Pill, toast } from '@/design';
import { api } from '../api';
import { parseReply, toCommand } from '../redisReply';
import { formatCommand } from '../showme/commands';
import { FrameContext } from '../showme/frame';
import { Hosted, Panel, SHOW_ME_IDS } from '../showme';
import type { ShowMeId } from '../showme';
import { cleanupCommands, PRACTICE_EXISTS, PRACTICE_KEYS, setupCommands } from '../showme/practice';
import { SAMPLE } from '../showme/sample';
import { refreshRedisNow, usePoll } from '../showme/useRedis';
import {
  AclUsersView,
  BfCardView,
  BitmapStreakView,
  CacheStatsView,
  FtCardView,
  GeoMapView,
  HashCardView,
  HllCounterView,
  JsonTreeView,
  KvCardView,
  LeaderboardPanelView,
  ListFeedView,
  OtpLimiterView,
  SetChipsView,
  StatsLatencyView,
  StreamGroupsView,
  StreamLogView,
  TsChartView,
  TtlTimerView,
} from '../showme/views';

const PLAYER = 'asha';

/** A panel in the nets: its component id is known, the practice key is ours. */
function sampleView(id: ShowMeId, name: string) {
  const s = SAMPLE;
  switch (id) {
    case 'kv_card':
      return <KvCardView {...s.kv} name={name} />;
    case 'hash_card':
      return <HashCardView {...s.hash} name={name} />;
    case 'list_feed':
      return <ListFeedView {...s.list} name={name} />;
    case 'set_chips':
      return <SetChipsView {...s.set} name={name} />;
    case 'leaderboard_panel':
      return <LeaderboardPanelView {...s.board} name={name} />;
    case 'ttl_timer':
      return <TtlTimerView {...s.ttl} name={name} readAt={Date.now()} />;
    case 'bitmap_streak':
      return <BitmapStreakView {...s.streak} name={name} />;
    case 'hll_counter':
      return <HllCounterView {...s.hll} name={name} />;
    case 'geo_map':
      return <GeoMapView {...s.geo} name={name} />;
    case 'stream_log':
      return <StreamLogView {...s.stream} name={name} />;
    case 'json_tree':
      return <JsonTreeView {...s.json} name={name} />;
    case 'cache_stats':
      return <CacheStatsView {...s.cache} />;
    case 'stats_latency_panel':
      return <StatsLatencyView {...s.stats} />;
    case 'otp_limiter_panel':
      return <OtpLimiterView {...s.limiter} name={name} />;
    case 'stream_groups':
      return <StreamGroupsView {...s.groups} name={name} />;
    case 'ts_chart':
      return <TsChartView {...s.ts} name={name} />;
    case 'bf_card':
      return <BfCardView {...s.bf} name={name} />;
    case 'ft_card':
      return <FtCardView {...s.ft} name={name} />;
    case 'acl_users':
      return <AclUsersView {...s.acl} />;
  }
}

/** The route panel needs real traffic on a route, which a practice key cannot make: it stays a sample. */
const ALWAYS_SAMPLE: readonly ShowMeId[] = ['stats_latency_panel'];

async function send(argv: string[]) {
  const r = await api.cli(formatCommand(argv));
  return r.type === 'error'
    ? ({ ok: false, reply: r.reply } as const)
    : ({ ok: true, reply: r.reply } as const);
}

/** The practice gallery: every show-me panel, hands-on against sample keys under practice:. */
export function ShowMeGallery() {
  const [existing, setExisting] = useState<number | null>(null);
  const [busy, setBusy] = useState<'setup' | 'clean' | null>(null);
  const [log, setLog] = useState<{ ran: number; failed: string[] } | null>(null);
  usePoll(
    async () => {
      try {
        const r = parseReply((await api.cli(toCommand(PRACTICE_EXISTS))).reply);
        setExisting(r.kind === 'int' ? r.v : null);
      } catch {
        setExisting(null);
      }
    },
    3000,
    'practice-exists',
  );
  const open = (existing ?? 0) > 0;

  const setup = async () => {
    setBusy('setup');
    try {
      if (open) for (const c of cleanupCommands()) await send(c);
      const failed: string[] = [];
      const cmds = setupCommands();
      for (const c of cmds) {
        const r = await send(c);
        if (!r.ok) failed.push(`${c[0]} ${c[1] ?? ''}: ${r.reply.replace(/^\(error\)\s*/, '')}`);
      }
      setLog({ ran: cmds.length, failed });
      setExisting(1);
      refreshRedisNow();
      if (failed.length === 0)
        toast.success('The nets are open', `${cmds.length} commands ran under practice:`);
      else
        toast.warn(
          'The nets are open, with gaps',
          `${failed.length} commands failed; see the list below.`,
        );
    } catch {
      toast.error('Could not set up the nets', 'The game engine did not answer.');
    } finally {
      setBusy(null);
    }
  };
  const clean = async () => {
    setBusy('clean');
    try {
      for (const c of cleanupCommands()) await send(c);
      setLog(null);
      setExisting(0);
      refreshRedisNow();
      toast({ title: 'The nets are swept', description: 'Every practice: key is gone.' });
    } catch {
      toast.error('Could not clean up', 'The game engine did not answer.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main
      data-ds=""
      data-testid="showme-gallery"
      className="mx-auto w-full max-w-[1360px] px-6 pt-8 pb-16"
    >
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-2xl">
          <p className="label-caps text-sm text-flood-400">Practice</p>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-[0.02em] text-chalk">
            The nets
          </h1>
          <p className="mt-2 text-md leading-6 text-chalk-dim">
            {open
              ? 'Every panel below is live and hands-on. Touch one and the exact Redis command it sent appears underneath: that command is the lesson. Everything here lives under practice:, so your game is never touched.'
              : 'Sample data only, for now. Set up the nets and every panel reads real practice: keys you can play with. In a level these read your own keys.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={open ? 'turf' : 'neutral'} variant="status" live={open}>
            {existing === null ? 'checking' : open ? 'nets open' : 'nets closed'}
          </Pill>
          <Button
            variant={open ? 'ghost' : 'primary'}
            loading={busy === 'setup'}
            loadingText="Setting up"
            disabled={busy !== null}
            onClick={() => void setup()}
            leading={open ? <RotateCcw size={16} /> : <FlaskConical size={16} />}
            data-testid="nets-setup"
          >
            {open ? 'Reset the nets' : 'Set up the nets'}
          </Button>
          <Button
            variant="quiet"
            loading={busy === 'clean'}
            loadingText="Sweeping"
            disabled={busy !== null || !open}
            onClick={() => void clean()}
            leading={<Eraser size={16} />}
            data-testid="nets-clean"
          >
            Clean up
          </Button>
        </div>
      </header>

      {log && log.failed.length > 0 && (
        <details className="mb-5 rounded-md border border-wicket/40 bg-wicket/10 px-4 py-3 text-sm text-wicket">
          <summary className="cursor-pointer">
            {log.failed.length} of {log.ran} setup commands failed
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {log.failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      <div className={clsx('columns-[27rem] gap-5')} data-testid="nets-grid">
        {SHOW_ME_IDS.map((id) => {
          const key = PRACTICE_KEYS[id];
          const live = open && !ALWAYS_SAMPLE.includes(id);
          return (
            <div key={id} className="mb-5 break-inside-avoid" data-nets={id}>
              {live ? (
                <Hosted k={key ?? ''} interactive>
                  <Panel id={id} k={key ?? ''} playerId={PLAYER} />
                </Hosted>
              ) : (
                <FrameContext.Provider
                  value={{ interactive: true, hands: null, locked: false, sample: true }}
                >
                  {sampleView(id, key ?? '')}
                </FrameContext.Provider>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
