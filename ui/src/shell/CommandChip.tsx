'use client';

// A shell command the player can read and copy: the rain-delay strip and the offline screen both show one.

import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/design/components/controls';
import { toast } from '@/design/toast';

export function CommandChip({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    };
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip) return toast.error('Could not copy', 'Select the command and copy it by hand.');
    clip
      .writeText(command)
      .then(done, () => toast.error('Could not copy', 'Select the command and copy it by hand.'));
  };
  return (
    <span
      data-ds=""
      data-testid="rain-command"
      className={clsx(
        'inline-flex h-8 items-center gap-2 rounded-md border border-night-600 bg-night-950/80 pl-3 pr-1 font-mono text-sm text-chalk shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)]',
        className,
      )}
    >
      <span aria-hidden className="select-none text-flood-400">
        $
      </span>
      <code className="select-all whitespace-nowrap">{command}</code>
      <IconButton
        label={copied ? 'Copied' : `Copy ${command}`}
        icon={copied ? <Check size={14} className="text-turf" /> : <Copy size={14} />}
        variant="quiet"
        size="sm"
        tooltip={false}
        onClick={copy}
        className="size-6!"
      />
    </span>
  );
}
