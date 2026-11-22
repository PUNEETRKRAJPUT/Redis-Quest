# Launch checklist: what the owner does on the day

Nothing in `docs/launch/` has been published, posted or sent. This list is the order to do it in. Every command
runs from the repository root. Do the steps in order: step 1 can change everything after it.

## 0. Before the day: the build is the build you think it is

- [ ] The pull request for this kit is merged and `main` is green on GitHub (CI and the new `pages` workflow).
- [ ] Re-count the numbers the posts quote. If any differs, change the post, not the number:
  ```bash
  pnpm install --frozen-lockfile && pnpm --filter @quest/shared build
  node scripts/launch/facts.mjs
  pnpm --silent --filter @quest/shared levels:validate levels
  ```
  The table in `docs/launch/posts/README.md` says where every other claim comes from.
- [ ] Decide the tag you point people at. The README and `docs/TESTING.md` say `v1.0.0-rc2`; `docs/DAYS.md` records that
  a newer tag is parked until a fresh-clone start test passes. Do not announce a tag nobody has started from a clean clone.
- [ ] Decide whether a playtest should come first. As of `docs/BUILD.md` row T1 the tester invite is written and not sent,
  and the posts say that nobody except you has played the game. If that has changed, update every post.

## 1. The name (decide this before anything else)

The project is called "Redis Quest". Redis publishes a trademark policy: <https://redis.io/legal/trademark-policy/>.
Read it yourself; this list does not interpret it. When this kit was written, a read of the page showed it asking people
not to use the mark, or part of it, in a company name, a commercial product name, a domain name or a social media
handle, and not to imitate Redis's visual identity. Whether a free, open-source game's name is covered, and what
Redis would accept, is a decision for you (and, if you want certainty, for a lawyer or for Redis, whose policy page
says how to ask).

- [ ] Decide: keep the name, rename the project, or ask Redis first. Write the decision down here: ______________________
- [ ] If you keep the name: it appears in the repository name, the README, the site, the posts and the Docker/Compose
  project name (`name: redis-quest`). Do **not** register a domain or a social handle that contains "Redis" until you have
  decided; the drafts use only the GitHub repository and GitHub Pages.
- [ ] If you rename: the places to change are the repository (Settings, General, Repository name), `README.md`, the site
  (`scripts/site/build.mjs` and the title in `scripts/site/*.mjs`), every file in `docs/launch/`, `docs/TESTING.md`,
  `docs/TESTER-MESSAGE.md` and the clone URLs in them. `grep -rIl "Redis Quest" . --exclude-dir=node_modules --exclude-dir=.git`
  lists them. Keep "built to teach Redis" in the description: describing what the software works with is different from
  naming the software after it, but that is again for you to confirm against the policy.
- [ ] Every draft and the site already say the project is not affiliated with or endorsed by Redis, and use neither
  Redis's logo nor its red (`docs/design/EXPERIENCE.md` forbids both). Keep it that way when you edit.

## 2. The repository page

- [ ] Description and topics (a short, factual description; no superlatives):
  ```bash
  gh repo edit PUNEETRKRAJPUT/Redis-Quest \
    --description "A local, story-driven game that teaches Redis to backend engineers: 8 chapters, 96 levels, real Redis, real Postgres, real traffic. Apple Silicon Mac. Not affiliated with Redis." \
    --add-topic redis --add-topic learning --add-topic game --add-topic docker-compose --add-topic nodejs --add-topic typescript
  ```
  Check the description's numbers against `node scripts/launch/facts.mjs`. `gh` on this Mac may be logged in to a
  read-only account; `gh auth status` shows which, and `gh auth login` switches it.
- [ ] Turn on Discussions (Settings, General, Features). Discussions cannot be switched on from the command line with
  `gh repo edit` in every version; use the web page if the flag is missing.
- [ ] The `playtest` label (used by the issue template) and the other labels are created in step 4.
- [ ] Look at the repository page logged out: the README renders, the images load, the licence is detected.

## 3. The site (GitHub Pages)

- [ ] Settings, Pages, Source: **GitHub Actions**.
- [ ] Turn publishing on (the workflow only publishes when this variable is the text `true`):
  ```bash
  gh variable set PAGES_ENABLED --body true --repo PUNEETRKRAJPUT/Redis-Quest
  gh workflow run pages --repo PUNEETRKRAJPUT/Redis-Quest
  gh run watch --repo PUNEETRKRAJPUT/Redis-Quest
  ```
- [ ] Open the published address (GitHub shows it on the Pages settings page; for a repository named
  `Redis-Quest` it is normally `https://<owner>.github.io/Redis-Quest/`, but read it, do not guess) and look at all five
  pages, in a narrow window too. The workflow checked that no page references another origin; you check that it looks right.
- [ ] Put the address into the `[SITE URL ...]` placeholders in the posts and into the README's site link.
- [ ] To build and look at the site on your own Mac first: `pnpm --filter @quest/shared build && node scripts/site/build.mjs`,
  then open `site/index.html`.

## 4. The starter issues

- [ ] Look at the drafts in `docs/launch/issues/`. They are twenty small tasks, each naming a file. Delete or edit any you
  do not want; the script takes whatever is in the folder.
- [ ] See what would happen. This touches nothing and needs no login:
  ```bash
  scripts/launch/create-issues.sh --dry-run
  ```
- [ ] Log `gh` in as the account that owns the repository (`gh auth status`), then create them. The script creates the
  labels, skips any title that already exists, and asks once before it writes:
  ```bash
  scripts/launch/create-issues.sh
  ```
- [ ] Open the issue list logged out and click three of them. Pin the two or three you would most like taken first.
- [ ] Be ready to answer them: the first person to pick one up should hear back the same day.

## 5. The posts (in this order, on different days if you can)

Each draft says what to read first. None should go out before steps 1 to 4 are done, because every post links to the
repository and the site.

- [ ] Publish the write-up (`docs/launch/posts/04-how-it-was-built.md`) first, somewhere you control (a blog, or a
  repository Discussion). Fill the `[OWNER: ...]` brackets: say which tools and models you used.
- [ ] Re-read `docs/launch/posts/01-show-hn.md` against the current Show HN guidelines. Post it on a weekday you can spend
  watching it. Post the first comment yourself straight away. Do not ask anyone to vote.
- [ ] Choose the Redis community, read its rules on self-promotion, then post `02-redis-community.md` (cut it down if the
  place wants short posts). Answer corrections in the open and turn each into an issue.
- [ ] Post the thread (`03-thread.md`) with its images and their alt text. Run the length check at the bottom of that file.
- [ ] Fill or delete every `[...]` bracket. `grep -n "\[OWNER\|\[SITE URL\|\[LINK" docs/launch/posts/*.md` must print nothing.

## 6. After posting

- [ ] Keep a plain list of what people say they could not do, with times. That list is the first real evidence about
  whether the game teaches anything; it replaces the "nobody has played it" sentence only when it has content.
- [ ] Label incoming playtest issues `playtest`. Fix wrong Redis facts first: a lesson that states something false costs
  more than a rough screen.
- [ ] Do not edit the posts to add claims you have not checked in the repository.
