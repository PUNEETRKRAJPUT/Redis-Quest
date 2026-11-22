#!/usr/bin/env bash
# One-time preparation of the hosted Linux arm64 runner for .github/workflows/stack.yml: the state a developer's Mac
# is already in when a check script starts (dependencies installed, every package built, redis-cli at hand).
# Run from the repository root, before anything starts a container. Not for a Mac.
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  echo "runner-setup.sh is for the hosted Linux runner"
  exit 2
fi

# redis-cli is what several checks talk to Redis with; lsof is how scripts/preflight.sh looks for a taken port.
# redis-tools only: the redis-server package would start a Redis on 6379, which is the game's own port.
sudo apt-get update -qq
sudo apt-get install -y -qq redis-tools lsof > /dev/null
echo "redis-cli $(redis-cli --version | awk '{print $2}')"

# The checks run as root (scripts/ci/run-check.sh) in a checkout that belongs to the runner's user.
sudo git config --system --add safe.directory '*'

# What a check copies into its scratch folders (workspace/, levels/) must stay writable there by the containers'
# own users. Git does not record these bits, so the tree stays clean.
chmod -R a+rwX .

corepack enable
pnpm install --frozen-lockfile
pnpm -r build
echo "runner-setup: done"
