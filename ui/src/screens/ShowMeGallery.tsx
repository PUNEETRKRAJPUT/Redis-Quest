import { SAMPLE } from '../showme/sample';
import {
  BitmapStreakView,
  CacheStatsView,
  GeoMapView,
  HashCardView,
  HllCounterView,
  JsonTreeView,
  KvCardView,
  LeaderboardPanelView,
  ListFeedView,
  SetChipsView,
  StreamLogView,
  TtlTimerView,
} from '../showme/views';

/** Every show-me view with fixed sample data. A reference page for content authors; not linked from the nav. */
export function ShowMeGallery() {
  const s = SAMPLE;
  return (
    <main className="page" data-testid="showme-gallery">
      <h1>Show-me components</h1>
      <p className="muted">Sample data only. In a level these read the learner&apos;s own keys.</p>
      <div className="built-grid">
        <KvCardView {...s.kv} />
        <HashCardView {...s.hash} />
        <ListFeedView {...s.list} />
        <SetChipsView {...s.set} />
        <LeaderboardPanelView {...s.board} />
        <TtlTimerView {...s.ttl} readAt={Date.now()} />
        <BitmapStreakView {...s.streak} />
        <HllCounterView {...s.hll} />
        <GeoMapView {...s.geo} />
        <StreamLogView {...s.stream} />
        <JsonTreeView {...s.json} />
        <CacheStatsView {...s.cache} />
      </div>
    </main>
  );
}
