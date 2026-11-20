# D-10: the launch kit

Rules for every day task: `docs/specs/_days-common.md`. Branch: `day-10-launch-kit`. Nothing here is posted
or published by you: everything is a file for the owner to use.

## Build
1. **A docs site, generated from the repo** (`scripts/site/build.mjs`, Node, using only packages the workspace
   already has; read how `packages/shared` parses level files and reuse it): a home page (what the game is, the
   story, the five screenshots in `docs/img/`, how to start), a level catalogue (all 96 levels by chapter: title,
   mode, XP, the incident's first line, the Redis commands its reference solution uses), a "commands taught"
   index (command to levels), a page on how levels are graded (from `docs/grading.md`), and a contribute page.
   Plain HTML and one stylesheet in the game's colours (`ui/src/design/tokens.css` has them), no framework, no
   tracker, no external request. Output to `site/` (ignored by git).
2. **`.github/workflows/pages.yml`**: build the site on every push to `main` as a check, and publish it to
   GitHub Pages only when the repository variable `PAGES_ENABLED` is `true` (the owner turns Pages on).
3. **Starter issues as drafts**: twenty files under `docs/launch/issues/`, each a real, small, well-scoped task
   found by reading the repo (a missing test, an unclear message, a level idea with its Redis command), with a
   title, labels and a body that says where to look. `scripts/launch/create-issues.sh` creates them with `gh`
   when the owner runs it; it prints what it would do with `--dry-run`.
4. **Launch posts as drafts** under `docs/launch/posts/`: a Show HN post, one for a Redis community, a short
   thread, and a longer write-up of how the game was built (spec, check, handoff; parallel agents; the incident
   where a check stopped a player's game and what changed). Every claim must be true of the repository today and
   checkable in it: read before you write, no numbers from memory, no superlatives.
5. **`docs/launch/CHECKLIST.md`**: what the owner does on the day, in order (repo description and topics, the
   name question in the Redis trademark policy, turning on Discussions and Pages, running the issues script,
   posting), with the commands.
6. **README**: bring every section except "Contributing" up to date with what is on `main` today, and link the
   site once it exists. Format with `pnpm exec prettier --write --ignore-path /dev/null README.md`;
   `scripts/check/C-POL.sh` asserts parts of it, read it first.

## Files you own
`scripts/site/**`, `.github/workflows/pages.yml`, `docs/launch/**`, `scripts/launch/**`, `README.md` except its
"Contributing" section, `site/` in `.gitignore`, `scripts/check/D-10.sh`, `docs/handoffs/D-10.md`.
You may run `node scripts/site/build.mjs` once to see that it produces files: it only reads the repo.

## How it will be verified later
Open `site/index.html` in a browser; `scripts/check/C-POL.sh`.
