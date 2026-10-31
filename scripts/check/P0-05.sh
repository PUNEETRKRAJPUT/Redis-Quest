#!/usr/bin/env bash
# P0-05 acceptance: level schema, loader, validator.
# Builds @quest/shared, runs its lint and tests, validates the example levels (each valid chapter
# passes, each invalid case fails with a file:line:col pointing at the right file and message).
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CLI="packages/shared/dist/levels/cli.js"
EX="levels/_examples"
FAILS=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

step "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile >/dev/null 2>&1 && pass "lockfile matches package.json files" || { fail "pnpm install --frozen-lockfile"; exit 1; }

step "build @quest/shared"
pnpm --filter @quest/shared build || { fail "build"; exit 1; }
[ -f "$CLI" ] && pass "validator built: $CLI" || { fail "missing $CLI"; exit 1; }

step "lint @quest/shared"
pnpm --filter @quest/shared lint && pass "lint" || fail "lint"

step "test @quest/shared (vitest)"
pnpm --filter @quest/shared test && pass "vitest" || fail "vitest"

step "exports from @quest/shared"
if node --input-type=module -e '
  const m = await import("./packages/shared/dist/index.js");
  const want = ["levelFileSchema", "chapterSchema", "verifySpecSchema", "renderTemplate", "loadChapter",
    "loadAllLevels", "validateLevels", "verdict", "formatLevelError", "READ_ONLY_COMMANDS"];
  const missing = want.filter((k) => !(k in m));
  if (missing.length) { console.log("missing: " + missing.join(", ")); process.exit(1); }
  if (m.verdict([{ type: "redis", passed: true }, { type: "antipattern", passed: false }]) !== "works_but_wrong") process.exit(1);
  console.log("exports: " + want.join(", "));
'; then pass "runtime exports present, verdict() works"; else fail "exports"; fi
for t in LevelFile Chapter VerifySpec Verdict; do
  if grep -qE "type $t[ =<]" packages/shared/dist/levels/*.d.ts; then pass "type $t in .d.ts"; else fail "type $t missing from .d.ts"; fi
done

step "valid example chapters"
for ch in example-cli example-code example-decision example-ops; do
  OUT=$(node "$CLI" "$EX/$ch" 2>&1); RC=$?
  if [ $RC -eq 0 ]; then pass "$EX/$ch: $OUT"; else fail "$EX/$ch (exit $RC)"; echo "$OUT"; fi
done

step "real levels/ tree (skips _examples)"
OUT=$(node "$CLI" levels 2>&1); RC=$?
[ $RC -eq 0 ] && pass "levels: $OUT" || { fail "levels (exit $RC)"; echo "$OUT"; }

step "pnpm script levels:validate (resolves paths from where it was run)"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$EX/example-cli" 2>&1); RC=$?
[ $RC -eq 0 ] && pass "pnpm levels:validate $EX/example-cli" || { fail "pnpm levels:validate (exit $RC)"; echo "$OUT"; }

step "invalid cases: each must exit 1 with file:line:col field.path: message"
# case|expected substring of the error line
while IFS='|' read -r CASE WANT; do
  [ -z "$CASE" ] && continue
  OUT=$(node "$CLI" "$EX/invalid/$CASE" 2>&1); RC=$?
  LINE=$(printf '%s\n' "$OUT" | grep -E "^$EX/invalid/$CASE/01-scoreboard\.yaml:[0-9]+:[0-9]+ [^ ]+: " | head -n 1)
  if [ $RC -eq 1 ] && [ -n "$LINE" ] && printf '%s' "$LINE" | grep -qF -- "$WANT"; then
    pass "$CASE -> $LINE"
  else
    fail "$CASE (exit $RC, want '$WANT')"; echo "$OUT"
  fi
done <<'CASES'
unknown-key|difficulty: unknown key 'difficulty'
two-assertions|verify[0].checks[0]: exactly one assertion required
write-command|verify[0].checks[0].cmd[0]: SET is not on the read-only allowlist
missing-solution-file|solutions.reference: file not found: solutions/does-not-exist.redis
id-mismatch|id: id must be id-mismatch-01-scoreboard
unknown-template-variable|task: unknown template variable {{player.email}}
bad-docs-url|docs[0]: docs links must be official pages starting with https://redis.io/docs/
CASES

step "the whole $EX tree fails (it contains the invalid cases)"
OUT=$(node "$CLI" "$EX" 2>&1); RC=$?
N=$(printf '%s\n' "$OUT" | grep -cE '^levels/_examples/invalid/[^ ]+:[0-9]+:[0-9]+ ')
[ $RC -eq 1 ] && [ "$N" -ge 7 ] && pass "$EX: exit 1 with $N positioned errors" || { fail "$EX (exit $RC, $N errors)"; echo "$OUT"; }

step "authoring guide"
for h in "## The seven beats" "## The verdict rule" "## Templating" "## Running the validator"; do
  grep -qF "$h" levels/README.md && pass "levels/README.md has '$h'" || fail "levels/README.md lacks '$h'"
done

echo
if [ $FAILS -eq 0 ]; then echo "P0-05 OK"; exit 0; fi
echo "P0-05 FAILED ($FAILS)"; exit 1
