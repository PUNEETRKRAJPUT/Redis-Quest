#!/usr/bin/env bash
# C-POL acceptance: the learner's README, the tester docs on the current tag, and follow-up questions on the nine chapter
# interviews. No Docker. Bash 3.2 compatible. Exit 0 only if everything passed.
#   - README: a table row per chapter directory with the level count computed from the files, the total, every script name,
#     every port, the plain "not supported" line, links that resolve;
#   - TESTING.md and TESTER-MESSAGE.md name v1.0.0-rc2 (and no older tag), the 96 levels, the target switcher;
#   - each of the nine interview levels has exactly three questions whose correct ids match the Finale's pool entry for the
#     same rebuild_of, and no question or explanation names a later chapter's level;
#   - the whole levels tree validates (8 chapters, 96 levels); prettier is clean for the files this task owns.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/cpol.XXXXXX")
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

README=README.md
TAG=v1.0.0-rc2

step "README: a row per chapter directory, level counts computed from the files"
TOTAL=0
for dir in levels/ch*/ levels/finale/; do
  dir=${dir%/}
  id=$(sed -n 's/^id: *//p' "$dir/chapter.yaml" | head -n 1)
  title=$(sed -n 's/^title: *//p' "$dir/chapter.yaml" | head -n 1 | sed -e 's/^"//' -e 's/"$//')
  files=$(ls "$dir"/[0-9][0-9]-*.yaml 2>/dev/null | wc -l | tr -d ' ')
  # the incident thread also uses "  - from:" lines; count only the level ids under "levels:"
  listed=$(awk '/^levels:/{p=1;next} p && /^  - /{n++} END{print n+0}' "$dir/chapter.yaml")
  TOTAL=$((TOTAL + files))
  case "$id" in
    finale) label="Finale" ;;
    *) label=${id#ch} ;;
  esac
  [ "$files" -eq "$listed" ] && pass "$dir: $files level files, $listed listed in chapter.yaml" || fail "$dir: $files files but chapter.yaml lists $listed"
  if grep -qE "^\\| *$label *\\| *$title *\\| *$files *\\| " "$README"; then
    pass "README row: $label | $title | $files"
  else
    fail "README has no row '| $label | $title | $files |' (computed from $dir)"
  fi
done
ROWS=$(grep -cE '^\| *(Finale|[0-9]b?) *\| ' "$README" | tr -d ' ')
CHAPTERS=$(ls -d levels/ch*/ levels/finale/ | wc -l | tr -d ' ')
[ "$ROWS" -eq "$CHAPTERS" ] && pass "README has $ROWS chapter rows for $CHAPTERS chapter directories" || fail "README has $ROWS chapter rows, $CHAPTERS directories"
grep -q "There are $TOTAL levels" "$README" && pass "README says there are $TOTAL levels (the sum of the files)" || fail "README does not say 'There are $TOTAL levels'"
grep -qi "eight chapters" "$README" && pass "README says eight chapters" || fail "README does not say eight chapters"
[ "$CHAPTERS" -eq 8 ] && pass "8 chapter directories" || fail "$CHAPTERS chapter directories, expected 8"

step "README: scripts, ports, the plain statements"
for s in scripts/start scripts/stop scripts/reset scripts/preflight.sh .env.example; do
  grep -qF "$s" "$README" && pass "mentions $s" || fail "does not mention $s"
  [ -e "$s" ] && pass "$s exists" || fail "$s does not exist"
done
for p in 3000 5540 6379 5432 6380 26379 26380 26381 7100 7105; do
  grep -qE "(^|[^0-9])$p([^0-9]|\$)" "$README" && pass "mentions port $p" || fail "does not mention port $p"
done
for p in 7100 7101 7102 7103 7104 7105; do
  grep -qE "$p" docker-compose.yml && : || fail "docker-compose.yml has no $p (the README says the cluster uses 7100 to 7105)"
done
for k in PROXY_PORT INSIGHT_PORT REDIS_PORT PG_PORT; do
  grep -q "$k" "$README" && grep -q "^$k=" .env.example && pass "$k is in .env.example and the README" || fail "$k missing from .env.example or the README"
done
grep -qi "Windows and Intel Macs are not supported" "$README" && pass "says plainly that Windows and Intel Macs are not supported" || fail "no plain 'Windows and Intel Macs are not supported'"
for t in "Apple Silicon" "16 GB" "Docker Desktop" "8 GB" "Git" "localhost:3000" "localhost:5540" "Run my code in the app" "Run traffic" "Target switcher" "Write my story" "What you built" ".progress/progress.json" "workspace/" "Works, but wrong" "The ideal way" "60 MB" "10 GB"; do
  grep -qF "$t" "$README" && pass "mentions '$t'" || fail "does not mention '$t'"
done
grep -q "^MIT for the game" "$README" && pass "the licence section is unchanged in substance" || fail "licence section missing"
for h in "What you need" "The eight chapters" "How a level works" "The tools" "Where your work lives" "Stop, reset and start over" "Troubleshooting" "Contributing" "Licence"; do
  grep -q "^## .*$h" "$README" && pass "section: $h" || fail "no section containing '$h'"
done
for l in $(grep -oE '\]\(([a-zA-Z][^):]*)\)' "$README" | sed -E 's/^\]\(//; s/\)$//'); do
  [ -e "$l" ] && pass "link target exists: $l" || fail "link target missing: $l"
done
grep -qE '(^| )T[0-9]( |$)|P0-[0-9]|C-POL|E-0[0-9]|F-1[0-9]' "$README" && fail "README names a build task id" || pass "README names no build task id"

step "TESTING.md and TESTER-MESSAGE.md on $TAG"
for f in docs/TESTING.md docs/TESTER-MESSAGE.md; do
  grep -q "$TAG" "$f" && pass "$f mentions $TAG" || fail "$f does not mention $TAG"
  if grep -qE 'v0\.1\.0|v1\.0\.0-rc1' "$f"; then fail "$f still names an older tag"; else pass "$f names no older tag"; fi
  grep -q "96" "$f" && pass "$f says 96 levels" || fail "$f does not say 96 levels"
  grep -qi "target switcher" "$f" && pass "$f mentions the target switcher" || fail "$f does not mention the target switcher"
  grep -q "Chapter 5" "$f" && pass "$f mentions Chapter 5's extra containers" || fail "$f does not mention Chapter 5"
done
grep -q "blob/$TAG/docs/TESTING.md" docs/TESTER-MESSAGE.md && pass "the message links the guide on $TAG" || fail "the message does not link the guide on $TAG"
grep -q "clone --branch $TAG" docs/TESTING.md && pass "the guide clones $TAG" || fail "the guide does not clone $TAG"
grep -qi "playtest finding" docs/TESTING.md && pass "TESTING.md keeps the issue template flow" || fail "TESTING.md lost the issue template flow"
grep -qi "do not ask me anything" docs/TESTER-MESSAGE.md && pass "the message keeps 'do not ask me anything'" || fail "the message lost 'do not ask me anything'"
tr '\n' ' ' < docs/TESTING.md | grep -qi "do not help them" && pass "TESTING.md keeps the do-not-help rule" || fail "TESTING.md lost the do-not-help rule"
grep -qi "how long a chapter takes" docs/TESTING.md && pass "TESTING.md says chapter time is unknown and asks for a note" || fail "TESTING.md does not say chapter time is unknown"

step "the nine interviews: three questions each, correct ids from the Finale's pool"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "shared build" || { fail "shared build"; exit 1; }
cat > "$TMP/q.mjs" <<'EOF'
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(join(process.cwd(), 'packages/shared/package.json'));
const YAML = require('yaml');
const root = process.cwd();
const out = [];
const ok = (m) => out.push('PASS  ' + m);
const bad = (m) => out.push('FAIL  ' + m);
const load = (f) => YAML.parse(readFileSync(f, 'utf8'));
const pool = new Map();
for (const f of ['01-mock-interview-one', '02-mock-interview-two', '03-mock-interview-three']) {
  const doc = load(join(root, 'levels/finale', f + '.yaml'));
  for (const e of doc.interview.pool) pool.set(e.rebuild_of, e.questions);
}
const dirs = [['ch2-everyone-showed-up', 3], ['ch3-compete-and-talk', 3], ['ch4-work-in-the-background', 3]];
const levelNumber = (id) => {
  const m = id.match(/^ch(\d+)b?-(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), id.startsWith(`ch${m[1]}b`) ? 1 : 0] : null;
};
let nine = 0;
for (const [dir] of dirs) {
  const full = join(root, 'levels', dir);
  for (const f of readdirSync(full).filter((n) => /^\d\d-interview-.*\.yaml$/.test(n)).sort()) {
    const doc = load(join(full, f));
    const rb = doc.interview.rebuild_of;
    nine++;
    const qs = doc.interview.questions;
    if (!Array.isArray(qs) || qs.length !== 3) { bad(`${doc.id}: ${qs ? qs.length : 'no'} questions, want exactly 3`); continue; }
    ok(`${doc.id}: exactly 3 questions`);
    const want = pool.get(rb);
    if (!want) { bad(`${doc.id}: the Finale has no pool entry for ${rb}`); continue; }
    const got = qs.map((q) => q.correct).join(',');
    const exp = want.map((q) => q.correct).join(',');
    got === exp ? ok(`${doc.id}: correct ids ${got} match the Finale's entry for ${rb}`) : bad(`${doc.id}: correct ids ${got}, the Finale has ${exp}`);
    const optsSame = qs.every((q, i) => JSON.stringify(q.options.map((o) => o.id)) === JSON.stringify(want[i].options.map((o) => o.id)));
    optsSame ? ok(`${doc.id}: option ids are the Finale's, in order`) : bad(`${doc.id}: option ids differ from the Finale's`);
    qs.every((q) => q.type === 'quiz' && q.options.some((o) => o.id === q.correct) && q.explanation) ? ok(`${doc.id}: each is a quiz with its answer among the options and an explanation`) : bad(`${doc.id}: a question lacks type quiz, a valid answer or an explanation`);
    const text = JSON.stringify(qs);
    /Mukul/.test(text) ? bad(`${doc.id}: still in Mukul's voice (that is the Finale's panel)`) : ok(`${doc.id}: not in Mukul's voice`);
    // no mention of a level in a later chapter than this one
    const here = levelNumber(doc.id);
    let later = [];
    for (const m of text.matchAll(/[Ll]evels? (\d+)(b?)\.(\d+)/g)) {
      const ch = Number(m[1]);
      const b = m[2] ? 1 : 0;
      if (ch > here[0] || (ch === here[0] && b > here[2])) later.push(m[0]);
    }
    for (const m of text.matchAll(/Chapter (\d+)/g)) if (Number(m[1]) > here[0]) later.push(m[0]);
    later.length ? bad(`${doc.id}: names a later chapter: ${later.join(', ')}`) : ok(`${doc.id}: names no later chapter`);
  }
}
nine === 9 ? ok('nine interview levels found') : bad(`found ${nine} interview levels, want 9`);
console.log(out.join('\n'));
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
EOF
OUT=$(node "$TMP/q.mjs" 2>&1); RC=$?
echo "$OUT"
FC=$(echo "$OUT" | grep -c '^FAIL' | tr -d ' ')
[ "$RC" -ne 0 ] && FAILS=$((FAILS + (FC > 0 ? FC : 1)))

step "the whole levels tree validates"
OUT=$(pnpm --silent --filter @quest/shared levels:validate levels 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "levels:validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"8 chapter(s), 96 level(s)"*) pass "8 chapters and 96 levels";; *) fail "expected 8 chapters and 96 levels";; esac

step "formatting"
# .prettierignore skips docs, markdown and levels, so `pnpm format:check` does not see these files; check them directly too.
pnpm --silent format:check >/dev/null 2>&1 && pass "pnpm format:check" || fail "pnpm format:check"
pnpm --silent exec prettier --check --ignore-path /dev/null README.md docs/TESTING.md docs/TESTER-MESSAGE.md >/dev/null 2>&1 && pass "prettier: README.md, docs/TESTING.md, docs/TESTER-MESSAGE.md" || fail "prettier on the three markdown files"

echo
if [ "$FAILS" -eq 0 ]; then echo "C-POL: ALL CHECKS PASSED"; exit 0; fi
echo "C-POL: $FAILS FAILED"
exit 1
