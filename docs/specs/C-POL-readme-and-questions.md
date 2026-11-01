# C-POL: the learner's README, the tester docs on the current tag, follow-up questions on the nine interviews

**Goal.** A person who finds the repository should know in two minutes what it is, what it needs, how to start,
what the eight chapters cover and what to do when something is in the way. The testers' guide should point at
the current build. And the nine chapter interview levels should end with interviewer questions, as the Finale's
pools do.

**Depends on.** E-05's `interview.questions` schema (being written first thing in parallel; until it exists,
write the README and the tester docs, then add the questions and validate).

**Files owned.** `README.md`, `docs/TESTING.md`, `docs/TESTER-MESSAGE.md`, the nine interview levels'
`interview:` blocks only (`levels/ch2-everyone-showed-up/11-*.yaml`, `12-*.yaml`, `13-*.yaml`,
`levels/ch3-compete-and-talk/13-*.yaml`, `14-*.yaml`, `15-*.yaml`,
`levels/ch4-work-in-the-background/17-*.yaml`, `18-*.yaml`, `19-*.yaml`), `scripts/check/C-POL.sh`,
`docs/handoffs/C-POL.md`.

**Must not touch.** anything else (F-13 edits `show_me:` blocks in other ch4 and ch5 files; E-05 edits the
engine and the first lines of ops `.sh` files).

**Source of truth.** `docs/PLAN.md` (sections on the chapters and the mechanics), `docs/BUILD.md`, `CLAUDE.md`
(the hard constraints: macOS Apple Silicon, 16 GB, ports), `scripts/preflight.sh`, `scripts/start`, `scripts/stop`,
`scripts/reset`, `.env.example`, `levels/*/chapter.yaml` (titles and level lists), `docs/handoffs/E-01.md`
(switch), `E-02.md` (traffic button), `E-03.md` (target switcher), `E-04.md` (portfolio), `levels/finale/01-*.yaml`
(the pool questions for the nine use cases, which the chapter interviews reuse, adapted to each chapter's
interviewer), the fiction bible for voice. Never state a Redis fact outside the digest; the README is about the
game, not Redis.

**Work.**

1. **`README.md`** (replace the Milestone 1 text): what it is in three sentences; who it is for; what you need
   (Mac with Apple Silicon, 16 GB, Docker Desktop with 8 GB assigned, Git); the three commands to start and the
   URL; the eight chapters as a table (chapter, title, levels, what you build, from `chapter.yaml` and the level
   files: count them); how a level works (the seven beats, verify verdicts right / works but wrong / wrong, the
   ideal way, hints and XP, interview levels with the clock); the tools (terminal, editor, "Run my code in the app",
   "Run traffic", the target switcher, Redis Insight on 5540, logs, metrics, "What you built" and "Write my story");
   where your work lives (`workspace/`, `.progress/progress.json`, the backups interview levels make); how to stop,
   reset and start over (`scripts/stop`, `scripts/reset`, and what each keeps); troubleshooting (ports 6379, 5432,
   3000, 5540 already in use → copy `.env.example` to `.env` and change the number; Docker memory; disk under 10 GB;
   the first start loads a 60 MB seed, give it a minute; `scripts/preflight.sh`); contributing and the build process
   in one paragraph with links to `docs/BUILD.md` and `docs/PLAN.md`; licence as it is. Say plainly that Windows and
   Intel Macs are not supported in this version.
2. **`docs/TESTING.md` and `docs/TESTER-MESSAGE.md`**: point at tag `v1.0.0-rc2` (the orchestrator creates it when
   this lands), say the whole game is playable (eight chapters, 96 levels) and how long a chapter takes is unknown
   (ask them to note it), keep the issue template flow and the "do not help them" rule; add two lines on the
   target switcher and the profile chapters (Chapter 5 needs the extra containers; the levels say how).
3. **Follow-up questions** on the nine interview levels: `interview.questions` with the three questions the
   Finale's pool entry for that use case asks, in the chapter's own interviewer's voice (the alumni senior in
   Chapter 2's levels; the same voice in 3 and 4), same correct ids and explanations (they were written for these
   exact levels). Validate the whole tree after: `pnpm --filter @quest/shared levels:validate levels` clean, 96
   levels.

**Acceptance check.** `scripts/check/C-POL.sh`: the README has a row per chapter directory with the right level
count (computed from the files), mentions every script name and every port; TESTING.md and TESTER-MESSAGE.md
mention `v1.0.0-rc2`; each of the nine interview levels has exactly three `questions` whose correct ids match
the Finale's pool entry for the same `rebuild_of`; `levels:validate levels` clean; `pnpm format:check` clean
(prettier covers the markdown). Exit 0, print each thing verified.

**Handoff.** `docs/handoffs/C-POL.md`: what the README covers, the questions table, and the check output.

**Model.** sonnet
