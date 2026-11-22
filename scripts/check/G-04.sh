#!/usr/bin/env bash
# ci: docker-free
# G-04 check: the hosted arm64 workflow (.github/workflows/stack.yml) and its helpers are well-formed. Static: it
# starts nothing and needs no Docker. What the workflow itself proves is in its own runs (docs/handoffs/G-04.md).
# bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILS=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }

WF=.github/workflows/stack.yml

echo "== files"
if [ -f "$WF" ]; then ok "$WF exists"; else bad "$WF is missing"; fi
for f in scripts/ci/run-check.sh scripts/ci/linux-shims.sh scripts/ci/runner-setup.sh; do
  if [ -x "$f" ] && bash -n "$f"; then ok "$f is executable and parses"; else bad "$f is missing, not executable, or does not parse"; fi
done
if node --check scripts/ci/stack-probe.mjs; then ok "scripts/ci/stack-probe.mjs parses"; else bad "scripts/ci/stack-probe.mjs does not parse"; fi

echo "== the probe refuses bad usage before it touches a network"
node scripts/ci/stack-probe.mjs >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 2 ]; then ok "no arguments: exit 2"; else bad "no arguments: exit $rc, expected 2"; fi
node scripts/ci/stack-probe.mjs no-such-mode http://127.0.0.1:9 >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 2 ]; then ok "an unknown mode: exit 2"; else bad "an unknown mode: exit $rc, expected 2"; fi

echo "== the workflow's shape"
if node -e '
  const { createRequire } = require("module");
  const req = createRequire(process.cwd() + "/packages/shared/package.json");
  const YAML = req("yaml");
  const fs = require("fs");
  const text = fs.readFileSync(process.argv[1], "utf8");
  const doc = YAML.parse(text);
  const fail = (m) => { console.error(m); process.exit(1); };
  const jobs = Object.keys((doc && doc.jobs) || {});
  for (const j of ["stack", "days", "suite"]) if (!jobs.includes(j)) fail("missing job " + j);
  if (jobs.includes("grader")) fail("a grader job is back: the runner cannot judge it (see the comment in the workflow)");
  for (const j of jobs) if (doc.jobs[j]["runs-on"] !== "ubuntu-24.04-arm") fail(j + " does not run on ubuntu-24.04-arm");
  if (JSON.stringify(doc.permissions) !== JSON.stringify({ contents: "read" })) fail("permissions are not exactly contents: read");
  const branches = (doc.on && doc.on.push && doc.on.push.branches) || [];
  if (!branches.includes("main")) fail("it does not run on pushes to main");
  if (/pull_request_target/.test(text)) fail("pull_request_target is not allowed");
  if (/secrets\./.test(text)) fail("the workflow must not read secrets");
  console.log("jobs: " + jobs.join(", "));
' "$WF"; then ok "three jobs on ubuntu-24.04-arm, read-only, no secrets, no grader"; else bad "the workflow's shape"; fi
for d in D-02 D-03 D-04 D-05 D-06 D-07 D-08 D-09; do
  if grep -q "scripts/ci/run-check.sh scripts/check/$d.sh" "$WF"; then ok "the workflow runs $d.sh"; else bad "the workflow no longer runs $d.sh"; fi
done
# D-02's whole-start part runs scripts/preflight.sh, which asks for a Mac.
if grep -qE '^[[:space:]]*D02_FULL:' "$WF"; then bad "D02_FULL is set: that part of D-02 cannot pass on the runner"; else ok "D-02 runs without its whole-start part"; fi
if grep -q 'ONLY="\$c5_only"' "$WF"; then ok "C5.sh runs without level 03 (its proof measures the machine's disk)"; else bad "C5.sh is no longer limited on the runner"; fi

echo "== the stand-ins, tried with a fake sed that only prints its arguments"
T=$(mktemp -d "${TMPDIR:-/tmp}/g04.XXXXXX")
mkdir -p "$T/fake"
printf '#!/bin/sh\nfor a in "$@"; do printf "[%%s]" "$a"; done\necho\n' > "$T/fake/sed"
chmod +x "$T/fake/sed"
if PATH="$T/fake:$PATH" bash scripts/ci/linux-shims.sh "$T/shims" >/dev/null 2>&1; then ok "linux-shims.sh wrote the stand-ins"; else bad "linux-shims.sh failed"; fi
got=$("$T/shims/sed" -i '' 's/a/b/' file 2>/dev/null)
if [ "$got" = "[-i][s/a/b/][file]" ]; then ok "sed -i '' loses its empty argument"; else bad "sed -i '': got $got"; fi
got=$("$T/shims/sed" -E -i.bak 's/a/b/' f 2>/dev/null)
if [ "$got" = "[-E][-i.bak][s/a/b/][f]" ]; then ok "sed -i.bak is passed through"; else bad "sed -i.bak: got $got"; fi
got=$("$T/shims/sed" -n '1,2p' f 2>/dev/null)
if [ "$got" = "[-n][1,2p][f]" ]; then ok "every other sed call is passed through"; else bad "plain sed: got $got"; fi
m=$("$T/shims/uname" -m 2>/dev/null)
case "$m" in
  aarch64 | '') bad "uname -m answered '$m'" ;;
  *) ok "uname -m answers $m, never aarch64" ;;
esac
if [ "$("$T/shims/uname" -s 2>/dev/null)" = "$(uname -s)" ]; then ok "uname passes other questions through"; else bad "uname -s differs from the real one"; fi
if [ "$("$T/shims/sw_vers" -productVersion 2>/dev/null)" = "15.0" ]; then ok "sw_vers answers a version preflight accepts"; else bad "sw_vers"; fi
rm -rf "$T"

# On Linux run-check.sh would go on and run the script it is given, as root: only its refusal is tried, off Linux.
if [ "$(uname -s)" != "Linux" ]; then
  bash scripts/ci/run-check.sh scripts/check/G-04.sh >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 2 ]; then ok "run-check.sh refuses to run off Linux"; else bad "run-check.sh off Linux: exit $rc, expected 2"; fi
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "G-04 OK"
  exit 0
fi
echo "G-04 FAILED ($FAILS)"
exit 1
