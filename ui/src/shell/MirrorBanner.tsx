'use client';

import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/design/components/controls';
import { useQuest } from '../store';

/** Shown when the save file in Redis is missing or out of step with the progress file on the Mac. */
export function MirrorBanner() {
  const mirror = useQuest((s) => s.mirror);
  const restore = useQuest((s) => s.restore);
  const [busy, setBusy] = useState(false);
  if (!mirror || mirror.redis !== 'up' || (mirror.present && mirror.inSync)) return null;
  return (
    <div
      data-ds=""
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-flood-500/35 bg-[linear-gradient(90deg,rgb(255_154_31/0.12),rgb(11_16_32/0.95)_70%)] px-4 py-2"
      role="alert"
      data-testid="mirror-banner"
    >
      <span className="flex min-w-0 flex-1 items-start gap-3 text-md leading-5 text-chalk">
        <TriangleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-flood-400" />
        <span>
          Your save file is missing from Redis (a FLUSHALL, or a fresh volume). Your progress is
          safe in the progress file on your Mac.
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void restore().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Restoring...' : 'Restore my save file'}
      </Button>
    </div>
  );
}
