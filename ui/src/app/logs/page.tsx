import { ToolPage } from '@/career/ToolPage';
import { LogsPanel } from '@/panels/LogsPanel';

// The page renders inside GameShell, which shows only the boot state until the engine answers in the browser, so
// the page segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

export default function LogsPage() {
  return (
    <ToolPage
      eyebrow="Tools"
      title="Logs"
      blurb="What every service is saying, live. Pause the feed to read, filter to find the one line that matters."
    >
      <div style={{ height: 'clamp(440px, calc(100dvh - 270px), 820px)' }}>
        <LogsPanel height="fill" />
      </div>
    </ToolPage>
  );
}
