#!/usr/bin/env bash
# D-05 acceptance: the level studio and community levels. Written, not yet run (docs/specs/_days-common.md).
# Starts ONE throwaway redis:8 container (quest-d05-redis, 127.0.0.1:6397) and the built engine as a plain Node process
# on a free port with scratch directories. Never touches a compose project, never the owner's game. Bash 3.2.
#
# Docker-free part: unit tests, type checks, the campaign totals, the community loader, the scaffolder.
# Stack part: GET /api/community (also with a broken pack next to a good one), POST /api/studio/validate and
# /api/studio/playtest, the studio_playtest_passed event, and playing the sample community level to a pass.
# The screens are checked by hand (see docs/handoffs/D-05.md, "How to verify").
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

NAME=quest-d05-redis
RPORT=6397
FAILED=0
ENGINE_PID=""
SCRATCH=""
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

cleanup() {
  [ -n "$ENGINE_PID" ] && kill "$ENGINE_PID" 2>/dev/null
  docker rm -f "$NAME" >/dev/null 2>&1
  [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rcli() { docker exec "$NAME" redis-cli "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

section "unit tests, types, lint, prettier"
for pkg in @quest/shared @quest/engine @quest/ui; do
  if T=$(pnpm --filter "$pkg" test 2>&1); then ok "$pkg tests: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"; else printf '%s\n' "$T" | tail -25; bad "$pkg tests"; fi
  if pnpm --filter "$pkg" lint >/dev/null 2>&1; then ok "$pkg lint"; else bad "$pkg lint"; fi
done
pnpm --silent --filter @quest/shared build || { bad "shared build"; exit 1; }
(cd engine && pnpm exec tsc --noEmit >/dev/null 2>&1) && ok "engine tsc --noEmit" || bad "engine tsc --noEmit"
(cd ui && pnpm exec tsc --noEmit >/dev/null 2>&1) && ok "ui tsc --noEmit" || bad "ui tsc --noEmit"
if pnpm exec prettier --check ui/src/features/studio ui/src/features/community ui/src/app/studio ui/src/app/community ui/test/studio.test.ts engine/src/features/studio.ts engine/src/community engine/test/studio.test.ts packages/shared/src/levels/community.ts packages/shared/src/levels/draft.ts packages/shared/src/levels/redis-script.ts >/dev/null 2>&1; then ok "prettier --check on the D-05 files"; else bad "prettier --check on the D-05 files"; fi

section "the campaign did not change"
V=$(node packages/shared/dist/levels/cli.js levels 2>&1); echo "$V" | tail -1
case "$V" in *"OK (8 chapter(s), 96 level(s))"*) ok "levels:validate: 8 chapters, 96 levels" ;; *) bad "campaign totals changed: $(echo "$V" | tail -1)" ;; esac
[ -f levels/community/house/chapter.yaml ] && ok "levels/community/house exists and is not counted above" || bad "no sample pack"
if node -e '
import("./packages/shared/dist/index.js").then(async (s) => {
  const all = await s.loadAllLevels("levels");
  if (all.chapters.some((c) => c.id === "house")) { console.log("campaign loader found the community pack"); process.exit(1); }
  const packs = await s.loadCommunity("levels/community");
  const house = packs.find((p) => p.id === "house");
  if (!house || house.errors.length) { console.log("house pack errors", JSON.stringify(house?.errors)); process.exit(1); }
  const lv = house.chapter.levels[0].level;
  if (!lv.author || lv.author.name !== "The house") { console.log("no author"); process.exit(1); }
  console.log("ok");
});' | grep -q '^ok$'; then ok "community loader: the house pack loads clean with its author, the campaign loader never sees it"; else bad "community loader check"; fi

section "scripts/level-new"
T=$(mktemp -d "${TMPDIR:-/tmp}/quest-d05-new.XXXXXX")
mkdir -p "$T/scripts" "$T/levels/community"
cp scripts/level-new "$T/scripts/level-new"
SCRATCH="$T"
for mode in cli decision; do
  if "$T/scripts/level-new" --pack scaffold-test --id 0$([ "$mode" = cli ] && echo 1 || echo 2)-sample-$mode --mode "$mode" --author "Check Script" --github check-script >/dev/null 2>&1; then ok "level-new --mode $mode wrote files"; else bad "level-new --mode $mode failed"; fi
done
if "$T/scripts/level-new" --pack ch1 --id 01-x >/dev/null 2>&1; then bad "level-new accepted a campaign chapter id"; else ok "level-new refuses a campaign chapter id"; fi
if "$T/scripts/level-new" --pack scaffold-test --id 01-sample-cli >/dev/null 2>&1; then bad "level-new overwrote an existing level"; else ok "level-new refuses to overwrite"; fi
if node -e '
import("./packages/shared/dist/index.js").then(async (s) => {
  const p = await s.loadCommunityPack(process.argv[1]);
  if (p.errors.length) { console.log(p.errors.map((e) => s.formatLevelError(e)).join("\n")); process.exit(1); }
  console.log("levels:" + p.chapter.levels.length);
});' "$T/levels/community/scaffold-test" | grep -q '^levels:2$'; then ok "both scaffolded levels (cli and decision) pass the community loader, and the second joined chapter.yaml"; else bad "scaffolded pack does not load"; fi
rm -rf "$T"; SCRATCH=""

section "stack: redis and the engine"
docker rm -f "$NAME" >/dev/null 2>&1
if ! docker run -d --name "$NAME" --platform linux/arm64 -p 127.0.0.1:$RPORT:6379 redis:8 >/dev/null; then bad "could not start $NAME"; exit 1; fi
i=0; until rcli ping 2>/dev/null | grep -q PONG; do i=$((i+1)); [ $i -gt 40 ] && { bad "redis did not start"; exit 1; }; sleep 0.5; done
pnpm --silent --filter @quest/engine build || { bad "engine build failed"; exit 1; }
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/quest-d05.XXXXXX")
mkdir -p "$SCRATCH/levels/community" "$SCRATCH/progress" "$SCRATCH/workspace" "$SCRATCH/logs"
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
cp -R levels/community/house "$SCRATCH/levels/community/house"
mkdir -p "$SCRATCH/levels/community/zz-broken" && printf 'id: [unclosed\n' > "$SCRATCH/levels/community/zz-broken/chapter.yaml"
PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
case "$PORT" in 3000|3100|3400|6394|5436) bad "picked a forbidden port $PORT"; exit 1;; esac
BASE="http://127.0.0.1:$PORT"
PORT=$PORT REDIS_URL="redis://127.0.0.1:$RPORT" DATABASE_URL="postgres://nobody@127.0.0.1:1/x" \
  LOG_DIR="$SCRATCH/logs" PROGRESS_DIR="$SCRATCH/progress" WORKSPACE_DIR="$SCRATCH/workspace" \
  LEVELS_DIR="$SCRATCH/levels" UI_DIST_DIR="$SCRATCH/ui" \
  node engine/dist/main.js >"$SCRATCH/engine.log" 2>&1 &
ENGINE_PID=$!
i=0; until curl -fsS "$BASE/health" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && { bad "engine did not listen"; tail -20 "$SCRATCH/engine.log"; exit 1; }; sleep 0.5; done
i=0; until [ "$(curl -fsS "$BASE/health" | json 'j.redis')" = up ]; do i=$((i+1)); [ $i -gt 60 ] && { bad "engine never saw redis"; exit 1; }; sleep 0.5; done
ok "engine up on $PORT with a broken pack next to the house pack (it did not stop the engine)"

section "GET /api/community"
curl -fsS "$BASE/api/community" >"$SCRATCH/c.json"
[ "$(json 'j.packs.find(p=>p.id==="house").levels[0].id' <"$SCRATCH/c.json")" = house-01-canteen-tokens ] && ok "the house level is listed" || bad "house level missing: $(cat "$SCRATCH/c.json")"
[ "$(json 'j.packs.find(p=>p.id==="house").levels[0].author.name' <"$SCRATCH/c.json")" = "The house" ] && ok "with its author byline" || bad "author missing"
[ "$(json 'j.packs.find(p=>p.id==="zz-broken").errors.length>0' <"$SCRATCH/c.json")" = true ] && ok "the broken pack is listed with its errors" || bad "broken pack not listed with errors"
[ "$(json 'j.packs.find(p=>p.id==="house").errors.length' <"$SCRATCH/c.json")" = 0 ] && ok "and does not take the good pack down with it" || bad "house has errors"
curl -fsS "$BASE/api/chapters" >"$SCRATCH/ch.json"
case "$(cat "$SCRATCH/ch.json")" in *house*|*canteen*) bad "a community level leaked into GET /api/chapters" ;; *) ok "GET /api/chapters shows no community level" ;; esac

section "POST /api/studio/validate"
cat >"$SCRATCH/draft.json" <<'JSON'
{"draft":{"mode":"cli","pack":"mine","number":1,"slug":"a-counter","title":"A counter","chapterTitle":"Mine",
"incident":[{"from":"roommate","time":"10:00","text":"need a counter"}],"story":"A story.","brainstormPrompt":"What would you reach for?",
"brainstormOptions":[{"label":"A string key","reasonable":true}],"teach":"INCR adds one.","task":"Increment `d05:n` twice and expire it.",
"setup":"DEL d05:n d05:copy","hints":["INCR takes the key."],
"checks":[{"kind":"string_equals","key":"d05:n","value":"2","message":"Should be 2."},{"kind":"ttl_between","key":"d05:n","min":1,"max":60,"message":"Needs an expiry."},{"kind":"not_exists","key":"d05:copy","antipattern":true,"message":"No copy of the count."}],
"reference":"INCR d05:n\nINCR d05:n\nEXPIRE d05:n 60\n",
"wrong":[{"script":"INCR d05:n\nINCR d05:n\n","expect":"wrong","because":"No expiry."},{"script":"INCR d05:n\nINCR d05:n\nEXPIRE d05:n 60\nSET d05:copy 2\n","expect":"works_but_wrong","because":"A copy."}],
"author":{"name":"Check Script","github":"check-script"}}}
JSON
post() { curl -sS -X POST -H 'content-type: application/json' --data @"$1" "$BASE$2"; }
post "$SCRATCH/draft.json" /api/studio/validate >"$SCRATCH/v.json"
[ "$(json 'j.ok' <"$SCRATCH/v.json")" = true ] && ok "a good draft validates, with $(json 'j.files.length' <"$SCRATCH/v.json") files for directory $(json 'j.directory' <"$SCRATCH/v.json")" || bad "good draft rejected: $(cat "$SCRATCH/v.json")"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));d.draft.author.name="";console.log(JSON.stringify(d))' "$SCRATCH/draft.json" >"$SCRATCH/noauthor.json"
post "$SCRATCH/noauthor.json" /api/studio/validate >"$SCRATCH/v2.json"
[ "$(json 'j.ok===false && j.errors.some(e=>e.path==="author.name" && e.line>1)' <"$SCRATCH/v2.json")" = true ] && ok "a missing author name comes back as a positioned error (author.name, with a line)" || bad "missing author not reported: $(cat "$SCRATCH/v2.json")"

section "POST /api/studio/playtest"
post "$SCRATCH/draft.json" /api/studio/playtest >"$SCRATCH/p.json"
[ "$(json 'j.passed' <"$SCRATCH/p.json")" = true ] && ok "the good draft passes: $(json 'j.runs.map(r=>r.name+"="+r.verdict).join(", ")' <"$SCRATCH/p.json")" || bad "play-test did not pass: $(cat "$SCRATCH/p.json" | head -c 1500)"
[ "$(rcli exists d05:n d05:copy | tr -d '\r')" = 0 ] && ok "the keys the play-test wrote are gone" || bad "play-test left keys behind"
if curl -fsS "$BASE/api/events" | grep -q studio_playtest_passed; then ok "the level event studio_playtest_passed is on GET /api/events"; else bad "no studio_playtest_passed event"; fi
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));d.draft.reference="INCR d05:n\nINCR d05:n\n";console.log(JSON.stringify(d))' "$SCRATCH/draft.json" >"$SCRATCH/failing.json"
post "$SCRATCH/failing.json" /api/studio/playtest >"$SCRATCH/p2.json"
[ "$(json 'j.passed===false && j.runs[0].verdict==="wrong"' <"$SCRATCH/p2.json")" = true ] && ok "a reference without the expiry fails the play-test" || bad "failing draft did not fail: $(head -c 800 "$SCRATCH/p2.json")"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));d.draft.setup="DEL game:progress";console.log(JSON.stringify(d))' "$SCRATCH/draft.json" >"$SCRATCH/gamekey.json"
post "$SCRATCH/gamekey.json" /api/studio/playtest >"$SCRATCH/p3.json"
[ "$(json 'j.passed===false && j.runs.length===0' <"$SCRATCH/p3.json")" = true ] && ok "a draft that touches game:* is refused before anything runs" || bad "game:* draft not refused: $(head -c 600 "$SCRATCH/p3.json")"
rcli set d05:n 41 >/dev/null
post "$SCRATCH/draft.json" /api/studio/playtest >"$SCRATCH/p4.json"
[ "$(json 'j.passed===false && /already exists/.test(j.refused||"")' <"$SCRATCH/p4.json")" = true ] && [ "$(rcli get d05:n | tr -d '\r')" = 41 ] && ok "a key that already exists is refused and left alone" || bad "existing key not protected: $(head -c 600 "$SCRATCH/p4.json")"
rcli del d05:n >/dev/null

section "playing the community level"
[ "$(curl -fsS "$BASE/api/community/levels/house-01-canteen-tokens" | json 'j.community.pack+":"+j.status')" = "house:new" ] && ok "GET /api/community/levels/:id: the level, status new, never locked" || bad "community level payload"
curl -fsS -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/community/levels/house-01-canteen-tokens/start" >/dev/null && ok "start ran its setup" || bad "start failed"
for c in "INCR canteen:tokens:today" "INCR canteen:tokens:today" "INCR canteen:tokens:today" "EXPIRE canteen:tokens:today 3600"; do
  curl -fsS -X POST -H 'content-type: application/json' -d "{\"command\":\"$c\"}" "$BASE/api/cli" >/dev/null
done
curl -fsS -X POST -H 'content-type: application/json' -d '{"answers":{}}' "$BASE/api/community/levels/house-01-canteen-tokens/verify" >"$SCRATCH/play.json"
[ "$(json 'j.verdict+":"+j.status' <"$SCRATCH/play.json")" = "right:passed" ] && ok "the reference commands pass the community level" || bad "community verify: $(head -c 800 "$SCRATCH/play.json")"
[ "$(curl -fsS "$BASE/api/chapters" | json 'j.xp')" = 0 ] && ok "no XP was awarded" || bad "XP changed"
rcli del canteen:tokens:today >/dev/null

section "the screens exist and are on"
for f in ui/src/app/studio/page.tsx ui/src/app/community/page.tsx "ui/src/app/community/[id]/page.tsx" ui/src/features/studio/Studio.tsx ui/src/features/community/Community.tsx ui/src/features/community/CommunityLevel.tsx; do
  [ -f "$f" ] && ok "$f" || bad "missing $f"
done
grep -q 'enabled: true' ui/src/features/studio/entry.ts && grep -q 'enabled: true' ui/src/features/community/entry.ts && ok "both feature entries are enabled" || bad "a feature entry is still off"

echo
if [ "$FAILED" -eq 0 ]; then echo "D-05 OK"; else echo "D-05 FAILED"; fi
exit "$FAILED"
