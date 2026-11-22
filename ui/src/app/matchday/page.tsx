import { ToolPage } from '@/career/ToolPage';
import { MatchDayScreen } from '@/features/matchday/MatchDayScreen';

// Rendered inside GameShell, which shows only the boot state until the engine answers in the browser, so the page
// segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

export default function MatchDayPage() {
  return (
    <ToolPage
      eyebrow="Beyond the season"
      title="Match Day"
      blurb="Six overs of crowd traffic against your own build, with incidents thrown in. The date is the seed: everyone plays the same match today."
      testId="matchday-page"
    >
      <MatchDayScreen />
    </ToolPage>
  );
}
