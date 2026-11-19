import type { Metadata } from 'next';
import { Gallery } from './Gallery';

export const metadata: Metadata = {
  title: 'Night match · Redis Quest design system',
  description: 'Every token and primitive of the Redis Quest design system, live.',
};

// The root layout wraps every page in GameShell, which renders the page only once the engine answers in the
// browser, so instant-navigation validation (dev-only) cannot see this segment; opt out like F-14's pages do.
export const instant = false;

// A static shell around one client component: the gallery needs no data and renders with the stack down.
export default function DesignPage() {
  return <Gallery />;
}
