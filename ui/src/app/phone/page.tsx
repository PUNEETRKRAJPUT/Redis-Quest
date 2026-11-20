import { ToolPage } from '@/career/ToolPage';
import { PhoneScreen } from '@/features/phone/PhoneScreen';

// Same as every page under GameShell: a static shell that renders a client screen (docs/handoffs/F-14.md).
export const instant = false;

export default function PhonePage() {
  return (
    <ToolPage
      eyebrow="Your app"
      title="The phone"
      blurb="The cricket app itself, answered by your code. Sit through a slow screen, then fix it and feel it."
      testId="phone-page"
    >
      <PhoneScreen />
    </ToolPage>
  );
}
