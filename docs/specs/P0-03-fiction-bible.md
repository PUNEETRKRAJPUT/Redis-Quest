# P0-03: Fiction bible

**Goal.** Invent the fictional cricket world every level, seed row and UI string draws from, in both a
readable bible and machine-readable JSON, so that no two agents invent conflicting names and no real
cricketer or franchise ever appears.

**Depends on.** nothing

**Files owned.**
- `docs/fiction.md`
- `fiction/league.json`, `fiction/teams.json`, `fiction/players.json`, `fiction/colleges.json`,
  `fiction/hostels.json`, `fiction/cast.json`, `fiction/denylist.json`
- `scripts/check/P0-03.sh`

**Must not touch.** anything else. In particular do not create a package under `packages/`; P0-04
reads these JSON files directly.

**Interfaces to honour.**
- Stable ids used by the Postgres seed (P0-04) and by levels: teams `t-01`..`t-08`, players
  `p-001`..`p-200`, colleges `c-01`..`c-12`, hostels `h-<college>-<n>` (e.g. `h-c-03-2`), cast members
  by slug (`roommate`, `senior`, `warden`, `sms-vendor`, `rival-college`).
- `teams.json`: id, name, city (real Indian city is fine), short code (3 letters), primary and
  secondary colour (hex), home ground name (fictional), one-line personality.
- `players.json`: id, full name, team id, role (`batter` | `bowler` | `all-rounder` | `keeper`),
  batting hand, bowling style or null, age 19 to 38, base stats (`bat_avg`, `strike_rate`,
  `bowl_econ` or null, `bowl_avg` or null), a `nickname` for about one in five players, and a `fame`
  score 1 to 100 with exactly three players above 95 (these become the hot keys in Chapters 2 and 4b).
  25 players per team.
- `colleges.json`: 12 fictional colleges across at least 8 Indian cities; each with 4 hostels in
  `hostels.json` (fictional hostel names in the style Indian campuses actually use).
- `cast.json`: the recurring cast from `docs/PLAN.md` section 5 (roommate who does frontend, the senior
  who runs the fest, the warden, the SMS vendor, the rival college). Name, role, one paragraph, three
  example lines of dialogue each, in the voice they will use in WhatsApp-style incident threads.
- `league.json`: league name (propose three in the bible, pick one; never contains "IPL" or "Indian
  Premier"), season name, format (8 teams, double round robin, playoffs), the "final" the story builds to.
- `denylist.json`: at least 150 well-known real cricketers (international and franchise, any era,
  full names) and at least 40 real franchise names from the IPL, BBL, PSL, CPL, SA20, The Hundred and
  ILT20. Used by the check and kept for future content checks.

**Tone (write it into the bible so level authors follow it).** Indian English with natural, light
Hinglish ("bhai", "yaar", "scene kya hai") where a student would actually say it; never forced,
never slurs, no gambling or real-money framing (contests are for points and bragging rights), no
real brands. Incidents open as WhatsApp threads: short lines, timestamps, one or two emoji at most.

**Work.**
1. Write `docs/fiction.md`: the world in two pages (league, the eight franchises with a sentence each,
   how the app started in a hostel room, the cast, the tone guide, the naming rules, and the id scheme).
2. Generate the JSON files. Names must be plausible Indian names drawn from many regions and
   communities, not a single region. No duplicate full names. No full name that appears in the
   denylist; no surname + first-initial combination that matches a denylist entry either.
3. `scripts/check/P0-03.sh`: validates every JSON file parses; counts (8 teams, 200 players, 25 per
   team, 12 colleges, 48 hostels, 5 cast members, exactly 3 players with fame > 95); id formats; unique
   ids and unique full names; no player or team name matching `denylist.json` (case-insensitive, and
   also surname + first initial); league name free of "IPL" / "Indian Premier"; prints each check.
   Use `python3` (ships with macOS Command Line Tools) or `node`; keep it bash 3.2 compatible.

**Acceptance check.** `scripts/check/P0-03.sh` exits 0 and prints each verification.

**Handoff complete when.** check passes; `docs/handoffs/P0-03.md` written with the check output and
the three league-name candidates with the one chosen; no files outside "Files owned" changed.

**Model.** sonnet
