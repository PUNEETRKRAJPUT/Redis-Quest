// Never resolves: the app must cut it off at SLOT_TIMEOUT_MS.
export default function getPlayerStats() {
  return new Promise(() => {});
}
