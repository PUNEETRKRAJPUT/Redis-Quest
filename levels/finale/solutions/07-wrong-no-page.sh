#!/usr/bin/env bash
# Wrong: makes workspace/ a repository and commits it, but never asks the game to write the story. The
# portfolio_written event never happens, and there is no PORTFOLIO.md in the commit.
set -eu
cd workspace
git init
git add .
git commit -m "Redis Quest: what I built"
