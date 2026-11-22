'use client';
// The cricket app in a phone frame, answered by the player's own code (or the built-in version), with the last
// request's trace under it. Every screen is a real GET through the proxy; nothing here is faked.
import { RefreshCw, Repeat } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Panel, Pill } from '../../design';
import { PhoneFrame } from './PhoneFrame';
import { callRoute, runMany, type PhoneResult, type Served } from './request';
import { PHONE_SCREENS, type PhoneScreenDef } from './screens';
import { SpreadStrip } from './SpreadView';
import { Waterfall } from './WaterfallView';
import { formatMs } from './waterfall';

const MANY = 20;

interface SpreadState {
  path: string;
  samples: number[];
  failures: number;
}

function ServedBadge({ served, hasSlot }: { served: Served; hasSlot: boolean }) {
  if (!hasSlot)
    return (
      <Pill tone="neutral" data-testid="phone-badge">
        Built-in route (no slot to fill)
      </Pill>
    );
  if (served === 'learner')
    return (
      <Pill tone="flood" data-testid="phone-badge">
        Your code answered
      </Pill>
    );
  if (served === 'fallback')
    return (
      <Pill tone="wicket" data-testid="phone-badge">
        Built-in version answered: your file did not load
      </Pill>
    );
  return (
    <Pill tone="neutral" data-testid="phone-badge">
      Built-in version answered
    </Pill>
  );
}

export function PhoneScreen({ compact = false }: { compact?: boolean }) {
  const [screenId, setScreenId] = useState<PhoneScreenDef['id']>('player');
  const screen =
    PHONE_SCREENS.find((s) => s.id === screenId) ?? (PHONE_SCREENS[0] as PhoneScreenDef);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PhoneResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bulk, setBulk] = useState<{ done: number } | null>(null);
  const [spread, setSpread] = useState<SpreadState | null>(null);
  // A newer request, a screen change or an unmount bumps this; an older answer then drops itself.
  const run = useRef(0);

  useEffect(() => {
    if (!loading) return;
    const t0 = performance.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(performance.now() - t0), 100);
    return () => clearInterval(id);
  }, [loading, bulk?.done]);

  const refreshOnce = useCallback(async (path: string) => {
    const mine = ++run.current;
    setBulk(null);
    setLoading(true);
    const r = await callRoute(path);
    if (mine !== run.current) return;
    setResult(r);
    setLoading(false);
  }, []);

  const refreshMany = useCallback(async (path: string) => {
    const mine = ++run.current;
    setBulk({ done: 0 });
    setSpread(null);
    setLoading(true);
    const cancelled = new Error('cancelled');
    try {
      const all = await runMany(
        path,
        MANY,
        (p) => (mine === run.current ? callRoute(p) : Promise.reject(cancelled)),
        (r, i) => {
          if (mine !== run.current) return;
          setResult(r);
          setBulk({ done: i + 1 });
        },
      );
      if (mine !== run.current) return;
      setSpread({
        path,
        samples: all.map((r) => r.ms),
        failures: all.filter((r) => !r.ok).length,
      });
      setBulk(null);
      setLoading(false);
    } catch {
      // cancelled by a newer request: that request owns the state now
    }
  }, []);

  useEffect(() => {
    void refreshOnce(screen.path);
    return () => {
      run.current += 1;
    };
  }, [screen.path, refreshOnce]);

  const shownSpread = spread && spread.path === screen.path ? spread : null;

  return (
    <div data-ds="" data-testid="phone-screen" className={compact ? 'p-3' : ''}>
      <div className="flex flex-wrap items-start gap-6">
        <PhoneFrame
          screen={screen}
          onScreen={setScreenId}
          loading={loading}
          elapsedMs={elapsedMs}
          result={result}
        />
        <div className="flex min-w-[280px] flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              leading={<RefreshCw aria-hidden size={14} />}
              loading={loading && bulk === null}
              loadingText="Loading"
              disabled={loading}
              onClick={() => void refreshOnce(screen.path)}
              data-testid="phone-refresh"
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leading={<Repeat aria-hidden size={14} />}
              loading={bulk !== null}
              loadingText={`Request ${Math.min(MANY, (bulk?.done ?? 0) + 1)} of ${MANY}`}
              disabled={loading}
              onClick={() => void refreshMany(screen.path)}
              data-testid="phone-refresh-many"
            >
              Refresh {MANY} times
            </Button>
          </div>
          <Panel
            as="h3"
            title="Last request"
            eyebrow={screen.path}
            actions={
              result ? <ServedBadge served={result.served} hasSlot={screen.slot !== null} /> : null
            }
          >
            <div className="flex flex-col gap-4" aria-live="polite">
              {result ? (
                <>
                  <dl className="flex flex-wrap gap-x-6 gap-y-2">
                    <div>
                      <dt className="label-caps text-[10px] text-chalk-dim">Status</dt>
                      <dd data-testid="phone-status">
                        <Pill tone={result.ok ? 'turf' : 'wicket'}>
                          {result.status === 0 ? 'No answer' : result.status}
                        </Pill>
                      </dd>
                    </div>
                    <div>
                      <dt className="label-caps text-[10px] text-chalk-dim">You waited</dt>
                      <dd
                        className="tabular font-display text-2xl font-bold text-chalk"
                        data-testid="phone-total"
                      >
                        {formatMs(result.ms)}
                      </dd>
                    </div>
                    {result.trace ? (
                      <div>
                        <dt className="label-caps text-[10px] text-chalk-dim">Inside the app</dt>
                        <dd className="tabular font-mono text-sm text-chalk">
                          {formatMs(result.trace.totalMs)}, {result.trace.calls}{' '}
                          {result.trace.calls === 1 ? 'call' : 'calls'}
                        </dd>
                      </div>
                    ) : null}
                    {result.instance ? (
                      <div>
                        <dt className="label-caps text-[10px] text-chalk-dim">Instance</dt>
                        <dd className="font-mono text-sm text-chalk">{result.instance}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <Waterfall trace={result.trace} />
                </>
              ) : (
                <p className="text-sm text-chalk-dim">Waiting for the first answer.</p>
              )}
              {shownSpread ? (
                <SpreadStrip samples={shownSpread.samples} failures={shownSpread.failures} />
              ) : null}
            </div>
          </Panel>
          <p className="text-xs text-chalk-dim">
            {screen.slot ? (
              <>
                This screen runs the slot <code className="font-mono">{screen.slot}</code>, built in{' '}
                {screen.level}. Switch your code on or off in the level and refresh to feel the
                difference.
              </>
            ) : (
              <>
                This screen has no slot of yours. It is the app&apos;s own, built in {screen.level}.
              </>
            )}{' '}
            Times are measured on this stack, in your browser.
          </p>
        </div>
      </div>
    </div>
  );
}
