import { ToolPage } from '@/career/ToolPage';
import { EditorPanel } from '@/panels/EditorPanel';

// The page renders inside GameShell, which shows only the boot state until the engine answers in the browser, so
// the page segment is never part of the prerender and instant-navigation validation cannot see it (dev-only check).
export const instant = false;

export default function EditorPage() {
  return (
    <ToolPage
      eyebrow="Tools"
      title="Editor"
      blurb="Your workspace files, on disk. Save with the button or Cmd+S; the game reads exactly what you save."
    >
      <div style={{ height: 'clamp(480px, calc(100dvh - 270px), 880px)' }}>
        <EditorPanel height="fill" />
      </div>
    </ToolPage>
  );
}
