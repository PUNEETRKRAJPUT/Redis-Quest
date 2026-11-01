#!/usr/bin/env bash
# P0-06 acceptance: engine skeleton. Build, lint, unit tests, then the real engine container against the
# real redis and postgres containers, driven over HTTP (from inside the engine container: the engine
# publishes no host port) and WebSocket. Bash 3.2 compatible.
#
# Set P0_06_USE_EXAMPLES=1 to force the temporary example chapter even when levels/ch0-boot exists.
# Scratch directories (levels, progress, workspace) live under logs/.p0-06-check so the check never touches
# the real .progress/ or workspace/. Containers this script did not start are never stopped.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

[ -f .env ] || cp .env.example .env
mkdir -p logs .progress workspace postgres/init
SCRATCH="$ROOT/logs/.p0-06-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" "$SCRATCH/workspace"

STARTED_BY_ME=""
for s in redis postgres; do
  if [ -z "$(docker compose ps --status running -q "$s" 2>/dev/null)" ]; then STARTED_BY_ME="$STARTED_BY_ME $s"; fi
done

finish() {
  section "cleanup"
  docker compose stop engine >/dev/null 2>&1 && echo "engine stopped"
  for s in $STARTED_BY_ME; do docker compose stop "$s" >/dev/null 2>&1 && echo "$s stopped (this check started it)"; done
  [ -z "$STARTED_BY_ME" ] && echo "redis and postgres were already running before this check; left running"
  rm -rf "$SCRATCH"
  if [ "$FAILED" -eq 0 ]; then printf '\nP0-06 OK\n'; exit 0; fi
  printf '\nP0-06 FAILED\n'; exit 1
}
die() { bad "$1"; finish; }

section "pnpm install --frozen-lockfile, build, lint, test"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "lockfile matches" || die "pnpm install --frozen-lockfile"
pnpm -r build >/dev/null 2>&1 && ok "pnpm -r build" || { pnpm -r build 2>&1 | tail -20; die "pnpm -r build"; }
pnpm --filter @quest/engine lint >/dev/null 2>&1 && ok "engine lint" || { pnpm --filter @quest/engine lint 2>&1 | tail -20; bad "engine lint"; }
if TEST_OUT=$(pnpm --filter @quest/engine test 2>&1); then
  ok "engine vitest: $(printf '%s\n' "$TEST_OUT" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$TEST_OUT" | tail -30; bad "engine vitest"; fi

section "levels for this check"
if [ -d levels/ch0-boot ] && [ -z "${P0_06_USE_EXAMPLES:-}" ]; then
  unset QUEST_LEVELS_DIR
  echo "using the real levels/ (ch0-boot exists)"
else
  cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
  export QUEST_LEVELS_DIR="$SCRATCH/levels"
  echo "levels/ch0-boot not written yet: temporary chapter example-cli copied from levels/_examples"
fi
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
export QUEST_WORKSPACE_DIR="$SCRATCH/workspace"
export ENGINE_DEV=1

section "docker compose up -d --build redis postgres engine"
if docker compose up -d --build redis postgres engine 2>&1 | tail -n 12; then ok "services started"; else die "compose up"; fi

# ---- HTTP helper: runs inside the engine container, prints status, etag, body ------------------------
JS='const [m,u,b,inm]=process.argv.slice(1);const h={};if(b)h["content-type"]="application/json";if(inm)h["if-none-match"]=inm;fetch("http://127.0.0.1:4200"+u,{method:m,body:b||undefined,headers:h}).then(async r=>{console.log(r.status);console.log(r.headers.get("etag")||"-");console.log(await r.text())}).catch(e=>{console.log(0);console.log("-");console.log(String(e))})'
STATUS=""; ETAG=""; BODY=""
call() { # method url [body] [if-none-match]
  local out
  out=$(docker compose exec -T engine node -e "$JS" "$1" "$2" "${3:-}" "${4:-}" 2>&1)
  STATUS=$(printf '%s\n' "$out" | sed -n 1p)
  ETAG=$(printf '%s\n' "$out" | sed -n 2p)
  BODY=$(printf '%s\n' "$out" | sed -n '3,$p')
}
js() { node -e 'let v;try{const j=JSON.parse(process.argv[1]);v=eval(process.argv[2])}catch(e){v="ERR "+e.message}console.log(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }
expect_status() { # label want
  if [ "$STATUS" = "$2" ]; then ok "$1 -> $2"; else bad "$1: want HTTP $2, got $STATUS: $(printf '%s' "$BODY" | head -c 300)"; fi
}
expect_js() { # label expr (must print true)
  local r; r=$(js "$BODY" "$2")
  if [ "$r" = "true" ]; then ok "$1"; else bad "$1 (got $r) body: $(printf '%s' "$BODY" | head -c 400)"; fi
}
cli() { call POST /api/cli "{\"command\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$1")}"; }

section "engine is up"
i=0
while [ $i -lt 60 ]; do
  call GET /health
  [ "$STATUS" = "200" ] && break
  i=$((i + 1)); sleep 1
done
expect_status "GET /health" 200
echo "$BODY"
expect_js "health: ok, service engine, redis up, postgres up" 'j.ok===true&&j.service==="engine"&&j.redis==="up"&&j.postgres==="up"'
expect_js "health: boots counted (game:engine:boots)" 'typeof j.boots==="number"&&j.boots>=1'
BOOTS1=$(js "$BODY" 'j.boots')
[ -f "$ROOT/logs/engine/engine.log" ] && ok "logs/engine/engine.log exists" || bad "logs/engine/engine.log missing"

section "first run: player, chapters"
call GET /api/progress; expect_status "GET /api/progress before a player" 404
call POST /api/player '{"name":"  "}'; expect_status "POST /api/player blank name" 400
call POST /api/player '{"name":"Asha"}'; expect_status "POST /api/player" 201
expect_js "progress shape (version 1, target, levels, xp, badges)" 'j.version===1&&j.player.name==="Asha"&&/^p-/.test(j.player.id)&&typeof j.target.redisUrl==="string"&&Array.isArray(j.activeSlots)&&j.xp===0&&Array.isArray(j.badges)&&Object.keys(j.levels).length>0'
call POST /api/player '{"name":"Again"}'; expect_status "second POST /api/player" 409
PROGRESS_FILE="$SCRATCH/progress/progress.json"
[ -f "$PROGRESS_FILE" ] && ok "progress.json written on the host" || die "progress.json missing"
if [ "$(ls "$SCRATCH/progress" | grep -c '\.tmp$')" = "0" ]; then ok "no temp files left next to progress.json"; else bad "temp files left"; fi

call GET /api/chapters; expect_status "GET /api/chapters" 200
expect_js "chapters: ordered, with levels and statuses" 'j.chapters.length>0&&j.chapters[0].levels.length>0&&j.chapters[0].levels[0].status==="available"'
if [ -d levels/ch0-boot ] && [ -z "${P0_06_USE_EXAMPLES:-}" ]; then
  expect_js "chapters list contains ch0-boot (id ch0)" 'j.chapters[0].id==="ch0"&&j.chapters[0].dirName==="ch0-boot"'
fi
LEVEL=$(js "$BODY" 'j.chapters[0].levels[0].id')
SECOND=$(js "$BODY" 'j.chapters[0].levels.length>1?j.chapters[0].levels[1].id:""')
echo "first level: $LEVEL"

section "level flow: view, start, brainstorm, hint, verify, complete"
call GET "/api/levels/$LEVEL"; expect_status "GET /api/levels/:id" 200
expect_js "level rendered, no templates left, hints hidden, answers not leaked" '!/\{\{/.test(JSON.stringify(j))&&j.hints.length===0&&typeof j.story==="string"&&j.brainstorm.options.some(o=>o.id==="not-redis")&&!JSON.stringify(j).includes("is_reasonable\":undefined")&&Array.isArray(j.verifiers)'
HINTS_TOTAL=$(js "$BODY" 'j.hintsTotal')
OPTION=$(js "$BODY" 'j.brainstorm.options[0].id')
call GET /api/levels/nope-00-nothing; expect_status "unknown level" 404
if [ -n "$SECOND" ]; then call POST "/api/levels/$SECOND/start"; expect_status "start a locked level" 409; fi
call POST "/api/levels/$LEVEL/verify" '{}'; expect_status "verify before start" 409
call POST "/api/levels/$LEVEL/start"; expect_status "POST start" 200
expect_js "start: in_progress, startedAt set, setup ran" 'j.status==="in_progress"&&!!j.startedAt&&j.setup.ran>=0'
call POST "/api/levels/$LEVEL/brainstorm" '{"optionId":"zzz","text":"x"}'; expect_status "brainstorm with unknown option" 400
call POST "/api/levels/$LEVEL/brainstorm" "{\"optionId\":\"$OPTION\",\"text\":\"I would try that because it keeps order\"}"; expect_status "POST brainstorm" 200
if [ "$HINTS_TOTAL" -gt 0 ]; then
  call POST "/api/levels/$LEVEL/hint"; expect_status "POST hint" 200
  expect_js "hint revealed and recorded" 'j.index===0&&typeof j.hint==="string"&&j.revealed===1'
  call GET "/api/levels/$LEVEL"; expect_js "GET level now shows 1 hint" 'j.hints.length===1&&j.brainstormAnswer.optionId!==undefined&&j.status==="in_progress"'
fi
call POST "/api/levels/$LEVEL/verify" '{"answers":{"0":"x"}}'; expect_status "POST verify" 200
expect_js "verify returns a real verdict on attempt 1 (verifier wired in P0-09)" '["wrong","works_but_wrong","right"].includes(j.verdict)&&j.attempt===1'
call POST "/api/levels/$LEVEL/verify" '{"answers":{"x":1}}'; expect_status "verify with bad answers" 400
call POST "/api/levels/$LEVEL/complete"; expect_status "POST complete (ENGINE_DEV=1)" 200
expect_js "complete: passed" 'j.status==="passed"&&j.xp>0'

FILE_STATUS=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const l=p.levels[process.argv[2]];console.log([l.status,l.attempts,l.verdicts.length,!!l.brainstorm,!!l.startedAt,!!l.completedAt,p.xp>0].join(","))' "$PROGRESS_FILE" "$LEVEL")
[ "$FILE_STATUS" = "passed,1,1,true,true,true,true" ] && ok "progress.json updated (status, attempts, verdicts, brainstorm, startedAt, completedAt, xp)" || bad "progress.json level entry: $FILE_STATUS"
if [ -n "$SECOND" ]; then
  [ "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).levels[process.argv[2]].status)' "$PROGRESS_FILE" "$SECOND")" = "available" ] && ok "passing a level unlocks the next" || bad "next level not unlocked"
fi

section "Redis mirror (game:*)"
mirror_matches() { # compares game:progress in Redis (read with redis-cli, not through the engine) with the file
  local redis_dump
  redis_dump=$(docker compose exec -T redis redis-cli HGETALL game:progress | tr '\n' ' ')
  node -e '
    const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const t=process.argv[2].trim().split(/\s+/).filter(Boolean);const m={};
    for(let i=0;i+1<t.length;i+=2)m[t[i]]=t[i+1];
    const want=Object.fromEntries(Object.entries(p.levels).map(([k,v])=>[k,v.status]));
    const same=JSON.stringify(Object.keys(want).sort().map(k=>[k,want[k]]))===JSON.stringify(Object.keys(m).sort().map(k=>[k,m[k]]));
    console.log(same?"same":"different");' "$PROGRESS_FILE" "$redis_dump"
}
[ "$(mirror_matches)" = "same" ] && ok "game:progress hash in Redis matches progress.json (read with redis-cli)" || bad "game:progress differs from progress.json"
PID=$(js "$(cat "$PROGRESS_FILE")" 'j.player.id')
[ "$(docker compose exec -T redis redis-cli HGET "game:player:$PID" name | tr -d '\r\n')" = "Asha" ] && ok "game:player:<id> hash has the player name" || bad "game:player hash"
GTTL=$(docker compose exec -T redis redis-cli TTL game:welcome:gift | tr -d '\r\n')
[ "$GTTL" -gt 80000 ] 2>/dev/null && ok "game:welcome:gift exists with a ~24 h TTL ($GTTL s)" || bad "game:welcome:gift TTL: $GTTL"
call GET /api/progress/mirror; expect_js "GET /api/progress/mirror: present and in sync" 'j.present===true&&j.inSync===true'

section "FLUSHALL through /api/cli, then restore"
cli 'KEYS game:*'; expect_status "KEYS game:* through /api/cli" 200
expect_js "KEYS reply is a numbered array" 'j.type==="array"&&/^ ?1\) "game:/.test(j.reply)'
cli 'FLUSHALL'; expect_status "FLUSHALL" 200
expect_js "FLUSHALL reply is OK (status)" 'j.reply==="OK"&&j.type==="status"'
cli 'EXISTS game:progress'
expect_js "mirror gone after FLUSHALL" 'j.reply==="(integer) 0"&&j.type==="integer"'
call GET /api/progress/mirror; expect_js "mirror status: not present" 'j.present===false'
call GET /api/progress; expect_js "progress.json untouched by FLUSHALL" 'j.player.name==="Asha"&&Object.values(j.levels).some(l=>l.status==="passed")'
call POST /api/progress/restore; expect_status "POST /api/progress/restore" 200
[ "$(mirror_matches)" = "same" ] && ok "game:progress is back and matches the file" || bad "mirror not restored"
cli 'TTL game:welcome:gift'
expect_js "restore re-created game:welcome:gift with a fresh 24 h TTL" '/^\(integer\) (\d+)$/.test(j.reply)&&Number(j.reply.split(" ")[1])>80000'

section "CLI formatting"
cli 'SET greeting "hello world"'; expect_js "SET -> OK (status)" 'j.reply==="OK"&&j.type==="status"'
cli 'GET greeting'; expect_js "GET -> quoted bulk" 'j.reply==="\"hello world\""&&j.type==="bulk"'
cli 'GET nothing:here'; expect_js "missing key -> (nil)" 'j.reply==="(nil)"&&j.type==="nil"'
cli 'RPUSH l a b c'; cli 'LRANGE l 0 -1'; expect_js "LRANGE -> indexed array" 'j.reply==="1) \"a\"\n2) \"b\"\n3) \"c\""'
cli 'INCR greeting'; expect_js "wrong type -> (error)" '/^\(error\) (WRONGTYPE|ERR) /.test(j.reply)&&j.type==="error"'
cli 'NOPE'; expect_js "unknown command -> (error)" '/^\(error\) ERR unknown command/.test(j.reply)&&j.type==="error"'
cli 'SET k "unterminated'; expect_js "bad quoting -> Invalid argument(s)" 'j.reply==="Invalid argument(s)"'
cli 'TYPE greeting'; expect_js "TYPE -> status string" 'j.reply==="string"&&j.type==="status"'
cli 'DEL greeting l'; cli 'PING'; expect_js "PING -> PONG" 'j.reply==="PONG"'
cli 'MULTI'; cli 'SET m 1'; expect_js "MULTI state is kept between calls (QUEUED)" 'j.reply==="QUEUED"'
cli 'DISCARD'
call POST /api/cli '{}'; expect_status "empty command" 400

section "target, slots, app-config"
call GET /api/target; expect_status "GET /api/target" 200
TARGET_URL=$(js "$BODY" 'j.redisUrl')
call PUT /api/target "{\"redisUrl\":\"$TARGET_URL\"}"; expect_status "PUT /api/target (same URL reconnects)" 200
expect_js "target reconnected: up" 'j.state==="up"'
cli 'PING'; expect_js "CLI works after the reconnect" 'j.reply==="PONG"'
call POST /api/progress/restore >/dev/null 2>&1
call PUT /api/target '{"redisUrl":"http://nope"}'; expect_status "PUT /api/target with a bad URL" 400
call GET /api/slots; expect_js "GET /api/slots empty" 'j.active.length===0'
call PUT /api/slots '{"active":["cache.getPlayerStats"]}'; expect_status "PUT /api/slots" 200
call PUT /api/slots '{"active":["not a slot"]}'; expect_status "PUT /api/slots invalid" 400
call GET /internal/app-config; expect_status "GET /internal/app-config" 200
CFG_ETAG="$ETAG"
expect_js "app-config body (target, activeSlots, dbExtraLatencyMs, etag)" 'j.target.redisUrl.startsWith("redis://")&&j.activeSlots[0]==="cache.getPlayerStats"&&j.dbExtraLatencyMs===0&&typeof j.etag==="string"'
[ "$CFG_ETAG" != "-" ] && ok "ETag header present ($CFG_ETAG)" || bad "no ETag header"
call GET /internal/app-config "" "$CFG_ETAG"; expect_status "GET /internal/app-config with matching If-None-Match" 304
call PUT /api/slots '{"active":[]}' >/dev/null 2>&1
call GET /internal/app-config "" "$CFG_ETAG"; expect_status "ETag changes after slots change (no 304)" 200

section "events, metrics, workspace, logs"
call POST /api/events '{"kind":"custom","name":"ui_connected"}'; expect_status "POST /api/events custom" 200
call POST /api/events '{"kind":"other","name":"x"}'; expect_status "POST /api/events wrong kind" 400
call GET /api/events; expect_status "GET /api/events" 200
expect_js "event ring has ui_connected and cli_ping" 'j.events.some(e=>e.type==="level.event"&&e.data.name==="ui_connected")&&j.events.some(e=>e.data&&e.data.name==="cli_ping")&&j.events.some(e=>e.type==="redis.state")'
call GET "/api/events?since=2999-01-01T00:00:00Z"; expect_js "events since a future time: none" 'j.events.length===0'
NOW_MS=$(node -e 'console.log(Date.now()-2000)')
call POST /internal/metrics "{\"instanceId\":\"app-1\",\"at\":$NOW_MS,\"routes\":{\"GET /app/leaderboard\":{\"count\":40,\"errors\":2,\"p50Ms\":12,\"p99Ms\":80}}}"; expect_status "POST /internal/metrics" 200
call POST /internal/metrics '{"instanceId":"app-1","routes":{"x":{"count":"many"}}}'; expect_status "POST /internal/metrics invalid" 400
call GET /api/metrics; expect_status "GET /api/metrics" 200
expect_js "metrics aggregate has the pushed instance and route" 'j.instances.includes("app-1")&&j.totals.count>=40&&j.routes["GET /app/leaderboard"].count>=40'
call PUT "/api/workspace/file?path=ch1/cache/getPlayerStats.js" '{"content":"export default () => 1;\n"}'; expect_status "PUT workspace file" 200
call GET "/api/workspace/file?path=ch1/cache/getPlayerStats.js"; expect_js "GET workspace file round-trips" 'j.content==="export default () => 1;\n"'
call GET "/api/workspace/file?path=../progress/progress.json"; expect_status "workspace path with .." 400
call GET "/api/workspace/file?path=/etc/hostname.json"; expect_status "workspace absolute path" 400
call PUT "/api/workspace/file?path=evil.exe" '{"content":"x"}'; expect_status "workspace extension not allowed" 400
call GET /api/workspace/tree; expect_js "workspace tree lists the file" 'j.entries.some(e=>e.path==="ch1/cache/getPlayerStats.js"&&e.type==="file")'
[ -f "$SCRATCH/workspace/ch1/cache/getPlayerStats.js" ] && ok "workspace file exists on the host" || bad "workspace file not on the host"
call GET /api/logs/proxy; expect_status "GET /api/logs/proxy" 200
call GET /api/logs/nothing; expect_status "GET /api/logs/unknown" 404

section "WebSocket"
WSJS='
const evs=[];
const ws=new WebSocket("ws://127.0.0.1:4200/ws");
const post=(u,b)=>fetch("http://127.0.0.1:4200"+u,{method:u.startsWith("/api/slots")?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
ws.onmessage=(m)=>{evs.push(JSON.parse(m.data))};
ws.onopen=async()=>{
  await new Promise(r=>setTimeout(r,200));
  await post("/api/slots",{active:["cache.getPlayerStats"]});
  await post("/api/cli",{command:"KEYS game:*"});
  await post("/api/events",{kind:"custom",name:"ws_check"});
  await new Promise(r=>setTimeout(r,500));
  console.log(JSON.stringify(evs.map(e=>({type:e.type,at:typeof e.at,name:e.data&&e.data.name,reason:e.data&&e.data.reason}))));
  await post("/api/slots",{active:[]});
  process.exit(0);
};
ws.onerror=()=>{console.log("WSERROR");process.exit(1)};
setTimeout(()=>{console.log("WSTIMEOUT");process.exit(1)},8000);
'
WS_OUT=$(docker compose exec -T engine node -e "$WSJS" 2>&1)
echo "$WS_OUT"
ws_has() { node -e 'const e=JSON.parse(process.argv[1]);console.log(e.some(x=>'"$2"')?"yes":"no")' "$WS_OUT" 2>/dev/null; }
[ "$(ws_has x 'x.type==="progress.changed"&&x.reason==="slots"')" = "yes" ] && ok "WebSocket client received progress.changed" || bad "no progress.changed over /ws"
[ "$(ws_has x 'x.type==="cli.dangerous"')" = "yes" ] && ok "WebSocket client received cli.dangerous (KEYS)" || bad "no cli.dangerous over /ws"
[ "$(ws_has x 'x.type==="level.event"&&x.name==="ws_check"')" = "yes" ] && ok "WebSocket client received level.event" || bad "no level.event over /ws"
[ "$(ws_has x 'x.type==="redis.state"')" = "yes" ] && ok "WebSocket client received the initial redis.state" || bad "no redis.state over /ws"

section "engine restart keeps the save and counts the boot"
docker compose restart engine >/dev/null 2>&1
i=0
while [ $i -lt 60 ]; do call GET /health; [ "$STATUS" = "200" ] && break; i=$((i + 1)); sleep 1; done
expect_status "health after restart" 200
BOOTS2=$(js "$BODY" 'j.boots')
[ "$BOOTS2" -gt "$BOOTS1" ] 2>/dev/null && ok "game:engine:boots went from $BOOTS1 to $BOOTS2" || bad "boots did not increase ($BOOTS1 -> $BOOTS2)"
call GET /api/progress; expect_js "progress survived the restart" 'j.player.name==="Asha"&&Object.values(j.levels).some(l=>l.status==="passed")'
call GET /api/chapters; expect_js "chapters still served" 'j.chapters.length>0&&j.player.name==="Asha"'

finish
