# F-13: show-me panels for streams, time series, Bloom, Search and ACL; the impact log

**Goal.** Six later levels show a `kv_card` or a plain `stream_log` because no panel existed for what they built.
Give them real panels, and give "What you built" the impact log the save has carried since E-04 (before and
after numbers per level).

**Depends on.** nothing (E-05 edits engine and harness; C-POL edits README and the interview levels; none of
them touch the files below).

**Files owned.** `ui/src/`, `ui/test/`; the `show_me:` block only (nothing else in the file) of
`levels/ch4-work-in-the-background/02-*.yaml`, `03-*.yaml`, `04-*.yaml`, `05-*.yaml`, `06-*.yaml`,
`14-*.yaml`, `15-*.yaml`, `16-*.yaml`, `19-*.yaml` and `levels/ch5-survive/10-*.yaml`; `levels/README.md` (the
show-me component table only); `scripts/check/F-13.sh`; `docs/handoffs/F-13.md`.

**Must not touch.** engine, app, runner, packages, scripts/grade, other level files, other checks, `docs/BUILD.md`.
No Docker is needed: the UI reads Redis through `POST /api/cli` and the tests render views on sample data.

**Interfaces to honour.** `ui/src/showme/index.tsx` (`SHOW_ME_IDS`, the wrapper that reads a key through
`/api/cli` every 2 s, `renderKey`), `ui/src/showme/views.tsx` (pure views), `docs/handoffs/F-05.md` (show_me
carries keys), the read-only allowlist in `packages/shared/src/levels/commands.ts` (`XINFO GROUPS`, `XPENDING`,
`XLEN`, `TS.RANGE`, `TS.INFO`, `BF.INFO`, `BF.CARD`, `FT.INFO`, `FT.SEARCH`, `ACL LIST` are all allowed), the
`redisReply.ts` parser, `GET /api/progress` (level entries with `verdicts[].metrics` and `interviewElapsedMs`,
E-04), `ui/src/screens/Built.tsx`.

**Work.**

1. **New components** (each a pure view in `views.tsx` plus a wrapper that polls the commands named):
   - `stream_groups` (keys: stream names): `XLEN`, `XINFO GROUPS <key>` → one row per group with `consumers`,
     `pending`, `lag`, `last-delivered-id`; `XPENDING <key> <group>` summary for the pending count per consumer.
     Empty or missing key renders "no stream yet".
   - `ts_chart` (keys: time series keys): `TS.INFO` (`retentionTime`, `totalSamples`, labels) and
     `TS.RANGE <key> - + AGGREGATION avg 60000` over the last 60 buckets as a small SVG sparkline with the last
     value printed; missing key renders "no samples yet".
   - `bf_card` (keys: Bloom filters): `BF.INFO <key>` (capacity, size in bytes, number of filters, items inserted,
     expansion rate) and `BF.CARD`; "no filter yet" when missing.
   - `ft_card` (keys: index names): `FT.INFO <index>` (`num_docs`, `index_definition` prefixes, the schema's
     field names and types) and `FT.SEARCH <index> * LIMIT 0 3 RETURN 0` for three document ids; "no index yet"
     on the `Unknown index name` error.
   - `acl_users` (keys ignored): `ACL LIST` rendered one user per row with the rules string; the default user
     first.
   Register them in `SHOW_ME_IDS`, add sample data to the `#/showme` gallery, unit tests for each view on sample
   replies (including the empty states) like `ui/test/showme.test.tsx`.
2. **Wire the levels**: ch4-02, 03, 04, 05, 06 → `stream_groups` `["match:m-041:balls"]`; ch4-14 → `bf_card`
   `["bf:usernames"]`; ch4-15 → `ft_card` `["idx:contest"]`; ch4-16 and ch4-19 → `ts_chart`
   `["ts:requests:GET_app_players_:id_stats"]`; ch5-10 → `acl_users` `[]`. Change nothing else in those files;
   `levels:validate levels` must stay clean (8 chapters, 96 levels).
3. **Impact log** on "What you built": a section "Impact log" (`data-testid="impact-log"`) listing every passed
   level that has numbers in its first passing verdict's `metrics` or an `interviewElapsedMs`: title, chapter,
   and the numbers as the portfolio prints them (p99 before → after, Postgres calls per request before → after,
   Redis commands per request, hit ratio, requests per second, "rebuilt in m:ss"); a one-line chapter summary
   above it (levels passed, XP). Levels without numbers are not listed. Unit test on a sample progress payload.
4. **README table**: one row per new component with the commands it reads.

**Acceptance check.** `scripts/check/F-13.sh`: `pnpm --filter @quest/ui build`, ui vitest (the new tests run), ui
lint, `pnpm format:check` (your files), `levels:validate levels` clean with 96 levels, and a grep that each of the
ten level files names the intended component and keys. Exit 0, print each thing verified.

**Handoff.** `docs/handoffs/F-13.md`: the component table with commands and empty states, what the impact log
shows, and the check output.

**Model.** sonnet
