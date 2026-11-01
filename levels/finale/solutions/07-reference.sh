#!/usr/bin/env bash
# Reference: the whole level as commands. Run it from the repo folder with the stack up. The level waits for the
# portfolio_written event that the first command makes; the game cannot see the push at the end and does not grade it.
set -eu
API="${API:-http://localhost:3000}"

# 1. "Write my story": the button on the What you built page does exactly this
curl -s -X POST "$API/api/portfolio/write"
echo

# 2. read it, all of it: every number was measured by the game and every line names its level
head -n 40 workspace/PORTFOLIO.md

# 3. make workspace/ a repository of your own, separate from the game's
cd workspace
git init
git add .
git status --short
git commit -m "Redis Quest: what I built"

# 4. push it wherever you keep your code (not run here):
#    git remote add origin git@github.com:<you>/redis-quest-workspace.git
#    git branch -M main && git push -u origin main
