---
title: "Play the first chapter in Safari and in Firefox and report what differs"
labels: good first issue, playtest
---

**What.** The game's pages were built and checked in a Chromium-based browser. The project log says it plainly: "Safari and Firefox untested" (`docs/BUILD.md`, decisions log, 2026-11-19), and the screen handoffs repeat it (`docs/handoffs/F-18.md`, `F-19.md`). Safari ships with every Mac, so it is the browser a Mac user is most likely to open.

**What to do.** Start the game as the README says, then play Chapter 0 and the first levels of Chapter 1 in Safari, and again in Firefox. Look at: the opening scene and name form, the season map, the live thread, the terminal (typing, Tab completion), the editor, the Verify button and its result, and the keyboard shortcuts (`?` lists them).

**Done when** you have opened one issue per real problem using the playtest template (`.github/ISSUE_TEMPLATE/playtest-finding.md`), with the browser and its version, or one comment here saying that nothing differed. Include how long you were stuck, even a few seconds.

**Notes.** Sound is off until the player turns it on; browsers also need a click before audio can start.
