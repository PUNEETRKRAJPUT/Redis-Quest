# The ten-day plan: status and how to resume

Puneet asked on 2026-11-20 for the whole ten-day plan at once, as ten pull requests, built by Sonnet subagents.
Shortly after he asked for it to be **resumable** and, for now, **code and parked pull requests only, with no
local runs**: his Mac was short on memory and disk. So every branch below is written without being run. Nothing
here is verified beyond a type check and a lint.

**Where it stands (2026-11-22):** all ten branches are written and pushed. No pull request is open yet: only the
owner's account may open them here, and the `gh` login on this Mac is not that account (see "Opening the pull
requests").

## The git identity: decided on 2026-11-22
The decisions log in `BUILD.md` (2026-11-01) says this repository's own git identity is the GitHub no-reply
address. That setting lives in `.git/config`, and the fresh clone made on 2026-11-02 did not carry it. So the
commits made on 2026-11-19 and 2026-11-20 took the Mac's global git identity instead: 32 on `main` (`48d2cc3` to
`e706f0b`) and 58 on the ten day branches. Found on 2026-11-20, and the setting was put back the same day.

Asked whether to rewrite those 90 commits (a forced push of `main` and of the ten branches), Puneet chose on
2026-11-22 to **leave them as they are**. Do not rewrite them.

Before the first commit of any session, `git config user.email` must print the no-reply address (the worktrees
share the setting). A fresh clone loses it; put it back from history, never by typing it:
`git config user.name "$(git log -1 --format=%an v1.0.0-rc2)"` and
`git config user.email "$(git log -1 --format=%ae v1.0.0-rc2)"`.

## The days
| Day | Branch | Spec | What it is |
|---|---|---|---|
| D-01 | `day-01-front-door` | specs/D-01 | Contributor guide and policies; a machine verdict on every pull request |
| D-02 | `day-02-first-five-minutes` | specs/D-02 | Start page while the stack builds; reply choices in threads; commentary |
| D-03 | `day-03-hands-on-and-editor` | specs/D-03 | Seven more hands-on panels; code completion for the Redis client |
| D-04 | `day-04-the-phone` | specs/D-04 | The cricket app in a phone frame, with a request waterfall |
| D-05 | `day-05-level-studio` | specs/D-05 | Level studio and community levels |
| D-06 | `day-06-your-turn` | specs/D-06 | "Your turn", the wanted-commands board, credits. **Stacked on D-05** |
| D-07 | `day-07-economy-league` | specs/D-07 | Code golf by pull request |
| D-08 | `day-08-arcade` | specs/D-08 | Arcade: Be the Redis, and a kit for more cabinets |
| D-09 | `day-09-match-day` | specs/D-09 | The incident deck and the seeded survival run |
| D-10 | `day-10-launch-kit` | specs/D-10 | Docs site, starter issues and launch posts as drafts |

All branches start from the commit that added this file. Shared rules: `specs/_days-common.md`.
Extension points that keep the branches apart: `engine/src/features/` and `ui/src/features/` (each feature has
its own file and turns itself on there).

## Status (the orchestrating session edits this table, nobody else)
| Day | Code | Pushed | Pull request | CI | Run on a Mac |
|---|---|---|---|---|---|
| D-01 | complete | yes | not opened | none yet | no |
| D-02 | complete | yes | not opened | none yet | no |
| D-03 | complete | yes | not opened | none yet | no |
| D-04 | complete | yes | not opened | none yet | no |
| D-05 | complete | yes | not opened | none yet | no |
| D-06 | complete | yes | not opened | none yet | no |
| D-07 | complete | yes | not opened | none yet | no |
| D-08 | complete | yes | not opened | none yet | no |
| D-09 | complete | yes | not opened | none yet | no |
| D-10 | complete | yes | not opened | none yet | no |

"Complete" means the handoff on the branch says "code complete and unverified". `ci.yml` runs on pull requests
and on `main` only, so no day branch has had a CI run: opening its pull request starts the first one.

The truth for a day is its branch on GitHub and `docs/handoffs/D-0n.md` on that branch (sections Status, Done,
Remaining). If this table and a branch disagree, the branch is right.

Changes the orchestrating session made on the branches after the agents finished (2026-11-20, none built):
the engine image copies what D-06, D-07 and D-09 read at run time (`docker/node.Dockerfile`); D-09's export in
`packages/shared/src/index.ts` moved up so it no longer collides with D-07's; a note in D-08's handoff.

## Do the ten fit together
Tested on 2026-11-20 with `git merge-tree`, which merges content in memory and builds nothing:
- all 45 pairs of branches merge without a conflict, and all ten merge onto `main` in day order;
- the names D-07 and D-09 add to the shared package collide neither with each other nor with what is there.

Not tested: whether the merged tree type-checks, builds or runs. A pull request's CI covers its own branch only.

A sensible order, least risky first: D-10 and D-01 (documents and workflows), D-03, D-04 and D-08 (screens),
D-05 then D-06 (the level loader changes), D-07 and D-09 (they send commands to Redis), D-02 last (it changes how
the game starts).

## Opening the pull requests
None is open yet. The `gh` login on this Mac is a second account of his that is not a collaborator on this
repository, and GitHub lets only the owner or a collaborator open a pull request here: tried on 2026-11-22 with
his go-ahead, refused on both endpoints ("must be a collaborator"). Neither browser a session can drive was
signed in to GitHub as the owner. So the owner's account opens them, one of two ways:

- **In a browser signed in as the owner.** Each link below opens the pull request form with the title and the
  text already filled in (GitHub's documented `title` and `body` parameters; not tried signed in). Choose
  "Create draft pull request" from the button's menu. All ten forms at once, from the repository folder:
  `grep -o 'https://github.com/[^)]*quick_pull=1&title=[^)]*' docs/DAYS.md | xargs -n 1 open`
- **Or with `gh` as the owner.** He runs `gh auth login` for the owner's account; a session can then open all
  ten from the day blocks below (title: the heading; text: the block plus a "Not run" note) and look after them
  later (point D-06 at `main` once D-05 is merged, mark them ready).

| Day | Into | Link |
|---|---|---|
| D-01 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-01-front-door?quick_pull=1&title=D-01%3A%20the%20front%20door%2C%20and%20a%20machine%20verdict%20on%20every%20pull%20request&body=%23%23%20Adds%0A-%20%60CONTRIBUTING.md%60%2C%20%60CODE_OF_CONDUCT.md%60%2C%20%60SECURITY.md%60%2C%20a%20pull%20request%20template%20and%20two%20issue%20templates.%0A-%20%60.github%2Fworkflows%2Fpr-verdict.yml%60%3A%20on%20every%20pull%20request%20it%20builds%20the%20engine%2C%20app%20and%20runner%2C%20starts%20them%20as%20plain%20processes%20%28%60scripts%2Fci%2Fstack.mjs%60%29%2C%20grades%20the%20cli%2C%20code%20and%20decision%20levels%20and%20writes%20the%20table%20into%20the%20job%20summary.%20Read-only%20token%2C%20no%20secrets%2C%20no%20%60pull_request_target%60.%0A-%20%60scripts%2Freview-pr%20%3Cn%3E%60%3A%20the%20maintainer%27s%20own%20review%20of%20a%20pull%20request%20in%20a%20temporary%20worktree.%20It%20refuses%20a%20pull%20request%20that%20changes%20scripts%2C%20workflows%2C%20Docker%20files%20or%20package%20manifests%20unless%20told%20the%20diff%20was%20read.%0A%0A%23%23%20Before%20it%20merges%0A-%20The%20workflow%20has%20never%20run%3A%20its%20first%20run%20is%20this%20pull%20request.%20Rows%20that%20fail%20there%20may%20be%20the%20runner%20%28amd64%2C%20a%20bare%20%60redis%3A8%60%29%20and%20not%20the%20content.%0A-%20It%20skips%20ops%20levels%2C%20outage%20and%20profile%20events%2C%20random%20interview%20pools%2C%20and%20every%20level%20with%20a%20traffic%20check.%0A-%20%60scripts%2Fcheck%2FD-01.sh%60%20is%20marked%20docker-free%2C%20so%20the%20%60fast%60%20job%20in%20%60ci.yml%60%20runs%20it%20on%20this%20pull%20request.%0A-%20%60.github%2Fworkflows%2FREADME.md%60%20should%20gain%20a%20%60pr-verdict%60%20section.%0A-%20Owner%2C%20after%20the%20first%20green%20run%3A%20the%20maintainer%20checklist%20at%20the%20end%20of%20the%20handoff.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-01.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-02 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-02-first-five-minutes?quick_pull=1&title=D-02%3A%20the%20first%20five%20minutes&body=%23%23%20Adds%0A-%20A%20start%20page%20while%20the%20stack%20builds%20%28%60docker%2Fstarting%2Findex.html%60%29%2C%20served%20by%20the%20proxy%20until%20the%20UI%20answers%2C%20fed%20by%20a%20stage%20file%20that%20%60scripts%2Fstart%60%20writes.%0A-%20Reply%20choices%20in%20the%20chapter%20threads%3A%2016%20of%20the%20player%27s%20own%20lines%20offer%20two%20or%20three%20ways%20to%20say%20it.%20The%20first%20choice%20is%20the%20line%20as%20it%20was%2C%20so%20nothing%20changes%20for%20a%20player%20who%20skips.%0A-%20Commentary%20lines%20%28Hinglish%2C%20English%20or%20off%29%20on%20the%20verdict%20screen%2C%20the%20dangerous-command%20toast%2C%20and%20Redis%20going%20down%20and%20coming%20back.%0A%0A%23%23%20Before%20it%20merges%0A-%20%2A%2AThe%20riskiest%20of%20the%20ten%3A%20it%20changes%20how%20the%20game%20starts.%2A%2A%20%60scripts%2Fstart%60%20brings%20the%20proxy%20up%20first%2C%20then%20builds%2C%20then%20starts%20the%20rest%3B%20%60docker%2FCaddyfile%60%20gains%20a%20%60handle_errors%60%20block%3B%20%60docker-compose.yml%60%20gains%20a%20proxy%20volume.%20It%20needs%20%60caddy%20validate%60%20and%20the%20isolated%20start%20test%20in%20%60scripts%2Fcheck%2FD-02.sh%60%20%28parts%20B%20and%20C%29.%0A-%20Unchecked%3A%20that%20the%20start%20page%20keeps%20the%20502%20status.%20If%20it%20answers%20200%2C%20the%20page%20reloads%20forever%20and%20every%20%60curl%60%20check%20sees%20a%20game%20that%20is%20up.%0A-%20%60GET%20%2Fapi%2Fchapters%60%20now%20carries%20%60choices%60%20on%20player%20messages.%0A-%20Not%20wired%2C%20because%20the%20files%20belong%20to%20other%20tasks%3A%20a%20line%20when%20a%20chapter%27s%20last%20level%20passes%2C%20a%20line%20when%20the%20whole%20stack%20goes%20down%2C%20and%20%60scripts%2Fstop%60%20removing%20the%20stage%20file.%0A-%20The%20Hinglish%20lines%20were%20read%20by%20nobody%20but%20the%20agent%20that%20wrote%20them.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-02.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-03 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-03-hands-on-and-editor?quick_pull=1&title=D-03%3A%20seven%20more%20hands-on%20panels%2C%20and%20completion%20for%20the%20Redis%20client&body=%23%23%20Adds%0A-%20Hands-on%20versions%20of%20seven%20show-me%20panels%20%28stream%2C%20JSON%2C%20bitmap%2C%20HyperLogLog%2C%20geo%2C%20Bloom%20filter%2C%20time%20series%29.%20Each%20shows%20the%20command%20it%20will%20run%2C%20then%20the%20command%20it%20ran.%2013%20of%20the%2019%20panels%20are%20now%20hands-on%2C%20and%20the%20six%20that%20stay%20read-only%20say%20why.%0A-%20Completion%20in%20the%20editor%20for%20the%20learner%27s%20Redis%20client%2C%20from%20a%20member%20list%20generated%20out%20of%20the%20installed%20%60redis%60%20package%20%28%60scripts%2Fdev%2Fgen-client-api.mjs%60%29.%0A%0A%23%23%20Before%20it%20merges%0A-%20%2A%2ARedis%20facts%20not%20verified%2A%2A%20%28the%20digest%20only%20names%20these%20commands%29%3A%20the%20reply%20of%20%60SETBIT%60%3B%20%60BF.ADD%60%20and%20%60BF.EXISTS%60%20and%20their%20replies%3B%20the%20replies%20of%20%60TS.ADD%60%20and%20%60PFADD%60%3B%20%60GEOADD%60%27s%20coordinate%20limits%3B%20%60BF.ADD%60%20creating%20a%20missing%20filter.%20Check%20them%20against%20the%20server%20or%20the%20official%20docs%2C%20then%20fix%20or%20label.%0A-%20Nobody%20has%20opened%20a%20panel%20or%20the%20completion%20in%20a%20browser%2C%20and%20the%20growth%20of%20the%20bundle%20from%20the%20editor%27s%20suggest%20widget%20was%20not%20measured.%0A-%20%60scripts%2Fcheck%2FD-03.sh%60%20is%20not%20marked%20docker-free%20yet%3A%20mark%20it%20once%20it%20has%20run.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-03.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-04 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-04-the-phone?quick_pull=1&title=D-04%3A%20the%20phone&body=%23%23%20Adds%0A-%20%60%2Fphone%60%2C%20and%20a%20Phone%20tab%20in%20the%20level%20workbench%3A%20the%20cricket%20app%20in%20a%20phone%20frame%2C%20four%20read-only%20screens%20%28player%20stats%2C%20fixtures%2C%20leaderboard%2C%20ticker%29%2C%20Refresh%20and%20Refresh%2020%20times.%0A-%20A%20request%20trace%3A%20when%20the%20UI%20asks%20with%20the%20header%20%60x-quest-trace%3A%201%60%2C%20the%20app%20answers%20with%20what%20that%20request%20did%20%28each%20Redis%20and%20Postgres%20call%2C%20whose%20code%20made%20it%2C%20how%20long%20it%20took%29.%20The%20UI%20draws%20it%20as%20a%20waterfall%20and%20a%20spread%20of%20timings.%20Without%20the%20header%20nothing%20is%20built%20and%20nothing%20is%20slower.%0A%0A%23%23%20Before%20it%20merges%0A-%20Unchecked%3A%20that%20the%20proxy%20passes%20the%20%60x-quest-trace%60%20header%20both%20ways%2C%20and%20that%20the%20ticker%27s%20match%20%28%60m-041%60%29%20exists%20in%20the%20seed.%0A-%20%60deps.redisCached%60%20is%20not%20traced%2C%20so%20a%20cache%20hit%20shows%20no%20Redis%20bar.%0A-%20The%20trace%20wraps%20the%20counted%20client%20inside%20%60app%2F%60%20and%20not%20in%20the%20shared%20package%20%28not%20this%20task%27s%20file%29.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-04.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-05 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-05-level-studio?quick_pull=1&title=D-05%3A%20the%20level%20studio%20and%20community%20levels&body=%23%23%20Adds%0A-%20%60%2Fstudio%60%3A%20write%20a%20level%20in%20a%20form%2C%20see%20it%20validated%20by%20the%20engine%27s%20own%20validator%20as%20you%20type%2C%20preview%20it%20with%20the%20real%20components%2C%20play-test%20it%20against%20your%20Redis%2C%20and%20get%20the%20files%20as%20a%20zip%20with%20the%20git%20commands%20to%20send.%0A-%20Community%20levels%3A%20%60levels%2Fcommunity%2F%3Cpack%3E%2F%60%2C%20their%20own%20loader%20and%20rules%2C%20%60%2Fcommunity%60%20and%20a%20level%20screen%2C%20one%20sample%20level%20by%20the%20house%2C%20%60scripts%2Flevel-new%60%2C%20and%20an%20optional%20%60author%60%20on%20a%20level.%0A%0A%23%23%20Before%20it%20merges%0A-%20It%20changes%20the%20campaign%20loader%2C%20which%20now%20skips%20a%20directory%20named%20%60community%60.%20Confirm%20the%20grader%27s%20totals%20did%20not%20move%20%28316%20rows%20at%20the%20last%20full%20run%29.%0A-%20A%20community%20level%20is%20%60cli%60%20or%20%60decision%60%20only%2C%20and%20its%20screen%20has%20no%20interview%2C%20slots%2C%20traffic%20or%20show-me%20panel.%0A-%20Nobody%20has%20opened%20the%20screens%3A%20expect%20layout%20fixes.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-05.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-06 | `day-05-level-studio` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/day-05-level-studio...day-06-your-turn?quick_pull=1&title=D-06%3A%20your%20turn%2C%20the%20wanted-commands%20board%2C%20the%20credits&body=Built%20on%20D-05%3A%20this%20pull%20request%20goes%20into%20%60day-05-level-studio%60%2C%20not%20%60main%60.%0A%0A%23%23%20Adds%0A-%20%60%2Fyour-turn%60%3A%20three%20steps%20that%20tick%20themselves.%20Pick%20a%20command%20no%20level%20teaches%2C%20play-test%20a%20level%20about%20it%20in%20the%20studio%2C%20open%20the%20pull%20request.%0A-%20The%20wanted-commands%20board%20%28%60GET%20%2Fapi%2Fcoverage%60%29%3A%20every%20command%20the%20server%20lists%2C%20set%20against%20what%20the%20levels%20teach.%0A-%20%60%2Fcredits%60%3A%20the%20cast%2C%20the%20authors%20of%20community%20levels%2C%20%60CONTRIBUTORS.md%60%20%28new%29%2C%20and%20the%20player%27s%20own%20line.%0A%0A%23%23%20Before%20it%20merges%0A-%20Merge%20D-05%20first%2C%20then%20point%20this%20pull%20request%20at%20%60main%60.%0A-%20The%20engine%20image%20now%20copies%20%60fiction%2Fcast.json%60%20and%20%60CONTRIBUTORS.md%60%20%28added%20on%20the%20branch%2C%20never%20built%29.%0A-%20The%20handoff%27s%20count%20of%20taught%20commands%20%28about%2068%29%20was%20made%20without%20a%20Redis%3A%20compare%20it%20with%20a%20real%20server.%0A-%20Two%20wishes%20outside%20its%20own%20files%3A%20the%20map%20card%20should%20read%20as%20the%20next%20thing%20after%20the%20Finale%20%28the%20logic%20is%20ready%20in%20%60ui%2Fsrc%2Ffeatures%2Fyourturn%2Flogic.ts%60%29%2C%20and%20the%20studio%20should%20read%20%60%3Fcommand%3D%3Cname%3E%60.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-06.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-07 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-07-economy-league?quick_pull=1&title=D-07%3A%20the%20Economy%20League&body=%23%23%20Adds%0A-%20Code%20golf%20by%20pull%20request%3A%20%60golf%2F%60%20holds%20six%20holes%2C%20each%20with%20a%20par%20and%20a%20house%20entry.%20An%20entry%20is%20a%20%60.redis%60%20file.%20Lowest%20score%20wins%3A%20fewest%20commands%2C%20then%20fewest%20bytes%20in%20the%20checked%20keys%2C%20then%20fewest%20characters.%0A-%20%60.github%2Fworkflows%2Fleague.yml%60%20scores%20entries%20on%20pull%20requests%20that%20touch%20%60golf%2F%2A%2A%60%3B%20%60scripts%2Fleague%2Fscore.mjs%60%20does%20the%20same%20by%20hand.%0A-%20%60%2Fleague%60%20in%20the%20game%3A%20read%20a%20hole%2C%20write%20an%20entry%2C%20score%20it%20against%20your%20own%20Redis%2C%20see%20the%20scorecard.%0A%0A%23%23%20Before%20it%20merges%0A-%20%2A%2AEvery%20par%2C%20every%20house%20entry%20and%20every%20%22this%20can%20be%20beaten%22%20note%20is%20unproven%2A%2A%3A%20nothing%20ran%20against%20a%20Redis.%0A-%20Scoring%20empties%20and%20uses%20logical%20database%207%20on%20a%20connection%20of%20its%20own%2C%20and%20refuses%20to%20run%20unless%20the%20server%20says%20it%20is%20on%20database%207.%20A%20cluster%20is%20refused.%20The%20Redis%20behaviour%20this%20relies%20on%20%28%60CLIENT%20INFO%60%20reporting%20the%20database%2C%20the%20replies%20of%20%60MEMORY%20USAGE%60%29%20is%20not%20in%20the%20digest%3A%20not%20verified.%0A-%20The%20engine%20image%20now%20copies%20%60golf%2F%60%20%28added%20on%20the%20branch%2C%20never%20built%29.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-07.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-08 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-08-arcade?quick_pull=1&title=D-08%3A%20the%20arcade%20and%20its%20first%20cabinet%2C%20%22Be%20the%20Redis%22&body=%23%23%20Adds%0A-%20%60%2Farcade%60%2C%20and%20a%20kit%20for%20building%20cabinets%20%28seeded%20random%2C%20a%20fixed-step%20clock%2C%20best%20scores%2C%20a%20frame%2C%20a%20list%20where%20every%20rule%20names%20its%20source%29%2C%20with%20%60docs%2Farcade.md%60%20on%20adding%20one%20in%20a%20single%20folder.%0A-%20The%20first%20cabinet%2C%20%22Be%20the%20Redis%22%3A%20commands%20arrive%20on%20a%20belt%20and%20you%20serve%20them%20one%20at%20a%20time.%20The%20words%20on%20a%20card%20are%20the%20server%27s%20own%3B%20how%20long%20a%20command%20takes%20is%20the%20game%27s%20model%2C%20and%20the%20cabinet%20says%20so.%0A%0A%23%23%20Before%20it%20merges%0A-%20It%20has%20never%20been%20drawn%20on%20a%20screen%20or%20played%3A%20layout%2C%20keys%2C%20sound%20and%20difficulty%20are%20guesses.%0A-%20Seven%20commands%20whose%20live%20text%20nobody%20had%20seen%20%28%60hget%60%2C%20%60incr%60%2C%20%60hgetall%60%2C%20%60smembers%60%2C%20%60lrange%60%2C%20%60hscan%60%2C%20%60sscan%60%29%20were%20checked%20on%202026-11-20%20against%20the%20official%20command%20files%20in%20redis%2Fredis%3A%20the%20cost%20class%20the%20game%20assumes%20for%20each%20holds.%20This%20stack%27s%20own%20replies%20are%20still%20unseen.%0A-%20The%20rule%20%22one%20command%20at%20a%20time%22%20is%20drawn%20from%20four%20digest%20lines%3B%20%22500%20items%20per%20call%22%20for%20%60SCAN%60%20is%20the%20game%27s%20number%20and%20is%20labelled%20so.%0A-%20The%20tests%20in%20%60ui%2Ftest%60%20are%20not%20covered%20by%20the%20type%20check.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-08.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-09 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-09-match-day?quick_pull=1&title=D-09%3A%20Match%20Day&body=%23%23%20Adds%0A-%20A%20survival%20run%20with%20a%20seed%3A%20a%20fixture%20for%20that%20seed%2C%20a%20deck%20of%20five%20incidents%20%28%60incidents%2F%2A.yaml%60%29%20that%20change%20Redis%20in%20the%20middle%20of%20the%20match%20and%20are%20undone%20afterwards%2C%20a%20war%20room%20with%20live%20numbers%2C%20a%20scorecard%20and%20a%20results%20file.%0A-%20%60%2Fmatchday%60%20in%20the%20game%2C%20and%20routes%20under%20%60%2Fapi%2Fmatchday%60%2C%20with%20%60POST%20%2Fapi%2Fmatchday%2Fstop%60%20as%20the%20way%20out.%0A%0A%23%23%20Before%20it%20merges%0A-%20%2A%2AIt%20changes%20a%20running%20Redis%20on%20purpose%20and%20relies%20on%20an%20undo%20journal%20that%20has%20never%20run.%2A%2A%20Prove%20the%20undo%20on%20an%20isolated%20stack%20before%20it%20goes%20near%20a%20real%20save.%0A-%20The%20budgets%20are%20chosen%2C%20not%20measured%3A%201%25%20errors%2C%20400%20ms%20p99%2C%20800%20ms%20in%20an%20over%20with%20an%20incident.%0A-%20It%20refuses%20Sentinel%20and%20cluster%20targets.%20The%20routes%20are%20not%20behind%20a%20player%20check.%0A-%20The%20engine%20image%20now%20copies%20%60incidents%2F%60%20%28added%20on%20the%20branch%2C%20never%20built%29.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-09.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |
| D-10 | `main` | [open the form, filled in](https://github.com/PUNEETRKRAJPUT/Redis-Quest/compare/main...day-10-launch-kit?quick_pull=1&title=D-10%3A%20the%20launch%20kit&body=%23%23%20Adds%0A-%20A%20docs%20site%20generator%20%28%60scripts%2Fsite%2Fbuild.mjs%60%29%3A%20home%2C%20a%20catalogue%20of%20the%2096%20levels%2C%20a%20commands%20index%2C%20a%20page%20on%20grading%20and%20a%20page%20on%20contributing.%20%60.github%2Fworkflows%2Fpages.yml%60%20builds%20it%20and%20deploys%20only%20when%20the%20repository%20variable%20%60PAGES_ENABLED%60%20is%20%60true%60.%0A-%20Twenty%20starter%20issues%20as%20drafts%20%28%60docs%2Flaunch%2Fissues%2F%60%29%20and%20a%20script%20that%20files%20them%20%28%60scripts%2Flaunch%2Fcreate-issues.sh%60%2C%20with%20%60--dry-run%60%29.%0A-%20Launch%20posts%20as%20drafts%20%28%60docs%2Flaunch%2Fposts%2F%60%29%2C%20each%20claim%20mapped%20to%20the%20file%20or%20command%20that%20proves%20it%2C%20and%20%60docs%2Flaunch%2FCHECKLIST.md%60.%0A-%20README%20corrections%20outside%20the%20contributing%20section.%0A%0A%23%23%20Before%20it%20merges%0A-%20Owner%20first%3A%20the%20name%20question%20%28the%20checklist%20links%20Redis%27s%20trademark%20policy%20and%20does%20not%20interpret%20it%29%2C%20and%20the%20%60%5BOWNER%20...%5D%60%2C%20%60%5BSITE%20URL%20...%5D%60%20and%20%60%5BLINK%20...%5D%60%20brackets%20in%20the%20posts.%0A-%20Never%20run%3A%20the%20issues%20script%20%28not%20even%20its%20dry%20run%29%2C%20%60scripts%2Flaunch%2Ffacts.mjs%60%2C%20the%20Pages%20workflow.%20The%20site%20generator%20ran%20once%20and%20its%20output%20was%20read%20as%20text%20only.%0A-%20%60scripts%2Fcheck%2FD-10.sh%60%20is%20marked%20docker-free%2C%20so%20CI%20runs%20it%20on%20this%20pull%20request.%0A%0A%23%23%20Not%20run%0ANothing%20in%20this%20pull%20request%20has%20been%20run%3A%20it%20was%20written%20in%20code-only%20mode%2C%20with%20a%20type%20check%20and%20a%20lint%20at%20most.%20This%20pull%20request%27s%20own%20CI%20is%20its%20first%20real%20test.%20The%20full%20notes%20are%20in%20%60docs%2Fhandoffs%2FD-10.md%60%20on%20this%20branch%2C%20the%20task%20in%20%60docs%2Fspecs%2F%60%2C%20and%20the%20other%20nine%20days%20in%20%60docs%2FDAYS.md%60%20on%20%60main%60.%0A%0A%F0%9F%A4%96%20Generated%20with%20%5BClaude%20Code%5D%28https%3A%2F%2Fclaude.com%2Fclaude-code%29%0A) |

## Per day: what it adds, and what must happen before it merges
Written from the handoffs on the branches. Every block ends the same way: nothing in it has been run.

### D-01: the front door, and a machine verdict on every pull request
Adds:
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, a pull request template and two issue templates.
- `.github/workflows/pr-verdict.yml`: on every pull request it builds the engine, app and runner, starts them as
  plain processes (`scripts/ci/stack.mjs`), grades the cli, code and decision levels and writes the table into the
  job summary. Read-only token, no secrets, no `pull_request_target`.
- `scripts/review-pr <n>`: the maintainer's own review of a pull request in a temporary worktree. It refuses a
  pull request that changes scripts, workflows, Docker files or package manifests unless told the diff was read.

Before it merges:
- The workflow has never run: its first run is this pull request. Rows that fail there may be the runner (amd64,
  a bare `redis:8`) and not the content.
- It skips ops levels, outage and profile events, random interview pools, and every level with a traffic check.
- `scripts/check/D-01.sh` is marked docker-free, so the `fast` job in `ci.yml` runs it on this pull request.
- `.github/workflows/README.md` should gain a `pr-verdict` section.
- Owner, after the first green run: the maintainer checklist at the end of the handoff.

### D-02: the first five minutes
Adds:
- A start page while the stack builds (`docker/starting/index.html`), served by the proxy until the UI answers,
  fed by a stage file that `scripts/start` writes.
- Reply choices in the chapter threads: 16 of the player's own lines offer two or three ways to say it. The first
  choice is the line as it was, so nothing changes for a player who skips.
- Commentary lines (Hinglish, English or off) on the verdict screen, the dangerous-command toast, and Redis going
  down and coming back.

Before it merges:
- **The riskiest of the ten: it changes how the game starts.** `scripts/start` brings the proxy up first, then
  builds, then starts the rest; `docker/Caddyfile` gains a `handle_errors` block; `docker-compose.yml` gains a
  proxy volume. It needs `caddy validate` and the isolated start test in `scripts/check/D-02.sh` (parts B and C).
- Unchecked: that the start page keeps the 502 status. If it answers 200, the page reloads forever and every
  `curl` check sees a game that is up.
- `GET /api/chapters` now carries `choices` on player messages.
- Not wired, because the files belong to other tasks: a line when a chapter's last level passes, a line when the
  whole stack goes down, and `scripts/stop` removing the stage file.
- The Hinglish lines were read by nobody but the agent that wrote them.

### D-03: seven more hands-on panels, and completion for the Redis client
Adds:
- Hands-on versions of seven show-me panels (stream, JSON, bitmap, HyperLogLog, geo, Bloom filter, time series).
  Each shows the command it will run, then the command it ran. 13 of the 19 panels are now hands-on, and the six
  that stay read-only say why.
- Completion in the editor for the learner's Redis client, from a member list generated out of the installed
  `redis` package (`scripts/dev/gen-client-api.mjs`).

Before it merges:
- **Redis facts not verified** (the digest only names these commands): the reply of `SETBIT`; `BF.ADD` and
  `BF.EXISTS` and their replies; the replies of `TS.ADD` and `PFADD`; `GEOADD`'s coordinate limits; `BF.ADD`
  creating a missing filter. Check them against the server or the official docs, then fix or label.
- Nobody has opened a panel or the completion in a browser, and the growth of the bundle from the editor's
  suggest widget was not measured.
- `scripts/check/D-03.sh` is not marked docker-free yet: mark it once it has run.

### D-04: the phone
Adds:
- `/phone`, and a Phone tab in the level workbench: the cricket app in a phone frame, four read-only screens
  (player stats, fixtures, leaderboard, ticker), Refresh and Refresh 20 times.
- A request trace: when the UI asks with the header `x-quest-trace: 1`, the app answers with what that request
  did (each Redis and Postgres call, whose code made it, how long it took). The UI draws it as a waterfall and a
  spread of timings. Without the header nothing is built and nothing is slower.

Before it merges:
- Unchecked: that the proxy passes the `x-quest-trace` header both ways, and that the ticker's match (`m-041`)
  exists in the seed.
- `deps.redisCached` is not traced, so a cache hit shows no Redis bar.
- The trace wraps the counted client inside `app/` and not in the shared package (not this task's file).

### D-05: the level studio and community levels
Adds:
- `/studio`: write a level in a form, see it validated by the engine's own validator as you type, preview it with
  the real components, play-test it against your Redis, and get the files as a zip with the git commands to send.
- Community levels: `levels/community/<pack>/`, their own loader and rules, `/community` and a level screen, one
  sample level by the house, `scripts/level-new`, and an optional `author` on a level.

Before it merges:
- It changes the campaign loader, which now skips a directory named `community`. Confirm the grader's totals did
  not move (316 rows at the last full run).
- A community level is `cli` or `decision` only, and its screen has no interview, slots, traffic or show-me panel.
- Nobody has opened the screens: expect layout fixes.

### D-06: your turn, the wanted-commands board, the credits
Built on D-05: this pull request goes into `day-05-level-studio`, not `main`.

Adds:
- `/your-turn`: three steps that tick themselves. Pick a command no level teaches, play-test a level about it in
  the studio, open the pull request.
- The wanted-commands board (`GET /api/coverage`): every command the server lists, set against what the levels
  teach.
- `/credits`: the cast, the authors of community levels, `CONTRIBUTORS.md` (new), and the player's own line.

Before it merges:
- Merge D-05 first, then point this pull request at `main`.
- The engine image now copies `fiction/cast.json` and `CONTRIBUTORS.md` (added on the branch, never built).
- The handoff's count of taught commands (about 68) was made without a Redis: compare it with a real server.
- Two wishes outside its own files: the map card should read as the next thing after the Finale (the logic is
  ready in `ui/src/features/yourturn/logic.ts`), and the studio should read `?command=<name>`.

### D-07: the Economy League
Adds:
- Code golf by pull request: `golf/` holds six holes, each with a par and a house entry. An entry is a `.redis`
  file. Lowest score wins: fewest commands, then fewest bytes in the checked keys, then fewest characters.
- `.github/workflows/league.yml` scores entries on pull requests that touch `golf/**`; `scripts/league/score.mjs`
  does the same by hand.
- `/league` in the game: read a hole, write an entry, score it against your own Redis, see the scorecard.

Before it merges:
- **Every par, every house entry and every "this can be beaten" note is unproven**: nothing ran against a Redis.
- Scoring empties and uses logical database 7 on a connection of its own, and refuses to run unless the server
  says it is on database 7. A cluster is refused. The Redis behaviour this relies on (`CLIENT INFO` reporting the
  database, the replies of `MEMORY USAGE`) is not in the digest: not verified.
- The engine image now copies `golf/` (added on the branch, never built).

### D-08: the arcade and its first cabinet, "Be the Redis"
Adds:
- `/arcade`, and a kit for building cabinets (seeded random, a fixed-step clock, best scores, a frame, a list
  where every rule names its source), with `docs/arcade.md` on adding one in a single folder.
- The first cabinet, "Be the Redis": commands arrive on a belt and you serve them one at a time. The words on a
  card are the server's own; how long a command takes is the game's model, and the cabinet says so.

Before it merges:
- It has never been drawn on a screen or played: layout, keys, sound and difficulty are guesses.
- Seven commands whose live text nobody had seen (`hget`, `incr`, `hgetall`, `smembers`, `lrange`, `hscan`,
  `sscan`) were checked on 2026-11-20 against the official command files in redis/redis: the cost class the game
  assumes for each holds. This stack's own replies are still unseen.
- The rule "one command at a time" is drawn from four digest lines; "500 items per call" for `SCAN` is the game's
  number and is labelled so.
- The tests in `ui/test` are not covered by the type check.

### D-09: Match Day
Adds:
- A survival run with a seed: a fixture for that seed, a deck of five incidents (`incidents/*.yaml`) that change
  Redis in the middle of the match and are undone afterwards, a war room with live numbers, a scorecard and a
  results file.
- `/matchday` in the game, and routes under `/api/matchday`, with `POST /api/matchday/stop` as the way out.

Before it merges:
- **It changes a running Redis on purpose and relies on an undo journal that has never run.** Prove the undo on
  an isolated stack before it goes near a real save.
- The budgets are chosen, not measured: 1% errors, 400 ms p99, 800 ms in an over with an incident.
- It refuses Sentinel and cluster targets. The routes are not behind a player check.
- The engine image now copies `incidents/` (added on the branch, never built).

### D-10: the launch kit
Adds:
- A docs site generator (`scripts/site/build.mjs`): home, a catalogue of the 96 levels, a commands index, a page
  on grading and a page on contributing. `.github/workflows/pages.yml` builds it and deploys only when the
  repository variable `PAGES_ENABLED` is `true`.
- Twenty starter issues as drafts (`docs/launch/issues/`) and a script that files them
  (`scripts/launch/create-issues.sh`, with `--dry-run`).
- Launch posts as drafts (`docs/launch/posts/`), each claim mapped to the file or command that proves it, and
  `docs/launch/CHECKLIST.md`.
- README corrections outside the contributing section.

Before it merges:
- Owner first: the name question (the checklist links Redis's trademark policy and does not interpret it), and
  the `[OWNER ...]`, `[SITE URL ...]` and `[LINK ...]` brackets in the posts.
- Never run: the issues script (not even its dry run), `scripts/launch/facts.mjs`, the Pages workflow. The site
  generator ran once and its output was read as text only.
- `scripts/check/D-10.sh` is marked docker-free, so CI runs it on this pull request.

## How to resume
1. The git identity is decided (above): rewrite nothing. Check `git config user.email` before the first commit.
2. `git fetch origin` and list the day branches: `git branch -r | grep day-`.
3. For each day, read `docs/handoffs/D-0n.md` on its branch
   (`git show origin/<branch>:docs/handoffs/D-0n.md`). "code complete and unverified" means the code is there
   and has never run; "in progress" lists what remains.
4. Worktrees live in `~/personal-repo/Redis-Quest.worktrees/<branch>` (durable; the scratch folder is cleared on
   reboot). Recreate a missing one with `git worktree add ~/personal-repo/Redis-Quest.worktrees/<branch> <branch>`
   and run `pnpm install --frozen-lockfile --offline` in it.
5. Unfinished day: give a subagent `specs/_days-common.md`, the day's spec and its handoff, and tell it to
   continue on the same branch, with the no-reply git identity.
6. Pull requests: see "Opening the pull requests". CI runs on every pull request: that is the first real test of
   each branch, and it costs this Mac nothing. Once they are open, put their numbers in the status table.
7. Verification, when the Mac has room (one branch at a time): `pnpm install --frozen-lockfile`,
   `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` against an isolated Redis and Postgres, the day's
   `scripts/check/D-0n.sh`, then the "How to verify" section of its handoff. Never a bare `docker compose`:
   the default project is the owner's game (`scripts/check/lib/isolate.sh`).

## Also parked
- The tag `v1.1.0-rc1`: the tester guide and invite still name `v1.0.0-rc2`. It needs a fresh-clone start test
  first (clone, own ports in `.env`, `COMPOSE_PROJECT_NAME=quest-fresh`, `./scripts/start`, the first-run flow in
  a browser, `down -v`). One attempt stalled in preflight on 2026-11-19 and was never explained.
