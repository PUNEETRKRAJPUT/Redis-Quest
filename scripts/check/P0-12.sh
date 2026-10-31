#!/usr/bin/env bash
# P0-12 acceptance: workflow is valid; optionally runs the full local CI.
# The full run takes many minutes and starts Docker stacks, so it only happens with P0_12_RUN_LOCAL=1.
# bash 3.2 compatible.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
WF=".github/workflows/ci.yml"
FAILS=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }

echo "== workflow validation"
[ -f "$WF" ] && pass "$WF exists" || { fail "$WF missing"; exit 1; }

if command -v actionlint >/dev/null 2>&1; then
  actionlint "$WF" && pass "actionlint" || fail "actionlint"
else
  echo "actionlint not installed (brew install actionlint); falling back to YAML parse"
  if node -e '
    const { createRequire } = require("module");
    const req = createRequire(process.cwd() + "/packages/shared/package.json");
    const YAML = req("yaml");
    const fs = require("fs");
    const doc = YAML.parse(fs.readFileSync(process.argv[1], "utf8"));
    const jobs = doc && doc.jobs ? Object.keys(doc.jobs) : [];
    for (const j of ["fast", "mac"]) if (!jobs.includes(j)) { console.error("missing job " + j); process.exit(1); }
    if (!doc.concurrency || doc.concurrency["cancel-in-progress"] !== true) { console.error("concurrency cancel-in-progress missing"); process.exit(1); }
    console.log("jobs: " + jobs.join(", "));
  ' "$WF"; then pass "YAML parses; jobs fast and mac; concurrency cancel-in-progress"; else fail "YAML parse"; fi
fi

echo
echo "== required content"
for pat in "pnpm install --frozen-lockfile" "pnpm -r build" "pnpm -r lint" "pnpm -r test" "levels:validate" "ubuntu-latest" "macos-latest" "docker info" "docker-free"; do
  grep -qF -- "$pat" "$WF" && pass "workflow contains '$pat'" || fail "workflow lacks '$pat'"
done

echo
echo "== scripts and log"
bash -n scripts/check/ci-local.sh && pass "ci-local.sh syntax" || fail "ci-local.sh syntax"
[ -x scripts/check/ci-local.sh ] && pass "ci-local.sh executable" || fail "ci-local.sh not executable"
grep -q 'P0-10' scripts/check/ci-local.sh && pass "P0-10 hook marked in ci-local.sh" || fail "P0-10 hook missing"
[ -f docs/ci-local.log ] && pass "docs/ci-local.log exists" || fail "docs/ci-local.log missing"

echo
echo "== full local run"
if [ "${P0_12_RUN_LOCAL:-}" = "1" ]; then
  bash scripts/check/ci-local.sh && pass "ci-local.sh" || fail "ci-local.sh"
else
  echo "SKIPPED: set P0_12_RUN_LOCAL=1 to run scripts/check/ci-local.sh (many minutes, starts Docker stacks)"
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "P0-12 OK"; exit 0; fi
echo "P0-12 FAILED ($FAILS)"; exit 1
