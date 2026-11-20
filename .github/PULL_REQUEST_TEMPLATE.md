<!-- Thanks. Read CONTRIBUTING.md first. Delete the lines that do not apply. -->

## What this changes and why

<!-- One thing per pull request. Link the issue if there is one: "Closes #123". -->

## How you know it works

<!-- The exact command you ran and what it printed. For a level: the grading harness table row(s). -->

## What you did not check

<!-- "I could not run the Sentinel levels", "I am not on Apple Silicon", "I did not run the UI". Honest is fine. -->

## Checklist

- [ ] I read `CONTRIBUTING.md`.
- [ ] If I touched a level: `pnpm --filter @quest/shared levels:validate levels` is clean, and every solution I
      added declares the verdict it must get.
- [ ] Any Redis fact I wrote traces to `docs/redis-docs-digest.md` or the official docs, or is labelled
      "measured on this stack" or as a simulation.
- [ ] I did not run a check or `docker compose` against the default compose project.
- [ ] I did not add a dependency, change a lockfile or a `package.json`, or touch `docker-compose.yml` or
      `.github/` (or the issue said I would).
- [ ] I ran prettier on the files I changed.

<!-- The `pr-verdict` workflow grades the levels it can on GitHub and writes a table in the job summary.
Levels that need a Compose profile, a real outage, or latency on a measured baseline show as SKIPPED: the
maintainer grades those by hand. A skip is not a failure. -->
