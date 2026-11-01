# F-05: show_me carries its keys

**Goal.** A level declares not only which show-me component lights up on a pass but which Redis keys
it displays, so the UI stops hard-coding keys per level and new chapters light up without UI changes.

**Files owned.** `packages/shared/src/levels/` (schema + loader, additive), `levels/README.md` (the
`show_me` section), the `show_me` field in every level under `levels/ch0-boot`, `levels/ch1-keyspace`,
`levels/ch2-everyone-showed-up` and `levels/_examples` (field value only, nothing else in those files),
`ui/src/` (the show-me rendering and the removal of the per-level key table), `scripts/check/F-05.sh`.

**Must not touch.** engine/, app/, runner/, scenarios/, docs/ other than the handoff.

**Design (binding).** `show_me` accepts either the existing string (component id, kept for
compatibility) or an object `{ component: <id>, keys: [<templated key>...], title?: string }`.
Templating rules apply to keys (`{{player.id}}`). The loader normalises both forms to the object
(`keys: []` for the string form) in `LoadedLevel`; `GET /api/levels/:id` therefore already returns the
object with rendered keys (the engine passes the loaded level through `renderTemplates`; verify that no
engine change is needed, and if one is, stop and say so in the handoff instead of editing the engine).
The UI's show-me components take `keys` from the level and read them through the existing engine CLI
proxy or the mirror endpoint the components already use; delete the hard-coded `defaultKey()` table.
Update every level's `show_me` to the object form with the real keys it should display (for example
1.7 `lb:hostel:h-c-02-1`, 2.2 `cache:player:p-151`).

**Isolation.** Compose project `quest-p10` with `.env.p10` for the e2e; `down -v` at the end.

**Check.** `scripts/check/F-05.sh`: shared build + tests; `levels:validate` over every chapter and the
examples (examples must still fail only with their positioned errors); grep that no level still uses
the bare string form; ui build, lint, vitest; the Chapter 0 Playwright run with a new assertion that
the passed level's show-me panel renders the declared key (level 0.3's `game:player:<id>`).

**Handoff.** `docs/handoffs/F-05.md` with the schema change, the full list of levels and their keys,
and the check output.

**Model.** sonnet
