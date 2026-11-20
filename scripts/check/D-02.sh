#!/usr/bin/env bash
# D-02 acceptance: the first five minutes. Bash 3.2 compatible. Written without being run (docs/specs/_days-common.md).
#
#   A. static, no Docker: the files exist, the proxy and compose changes are there, the start script is valid and
#      keeps its old behaviour, the commentary tables and the reply choices in the eight chapters are well formed,
#      and no chapter message was added, removed or reordered since the base commit (e706f0b).
#   B. the proxy alone, in an isolated compose project (needs Docker): a page request gets the start page with the
#      error's own status code (502), the stage file is served, the engine paths and /app stay bare errors.
#   C. the whole thing (needs Docker, many minutes, D02_FULL=1): QUEST_NO_OPEN=1 scripts/start in the isolated
#      project, watching the stage file go preflight, building, starting, ready, and the game answering 200.
#
# B and C use scripts/check/lib/isolate.sh: never the default project (a learner's own game). Without Docker, B and C
# are skipped and say so.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
LIVE=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
skip() { printf 'SKIP  %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }
finish() {
  if [ "$LIVE" -eq 1 ]; then section "cleanup"; quest_isolate_down; fi
  if [ "$FAILED" -eq 0 ]; then printf '\nD-02 OK\n'; exit 0; fi
  printf '\nD-02 FAILED\n'; exit 1
}
has() { grep -qF -- "$2" "$1" 2>/dev/null; } # has <file> <fixed string>

BASE=e706f0b

# ---------------------------------------------------------------------------------------------------------------
section "A1. files"
for f in scripts/start docker/Caddyfile docker/starting/index.html docker-compose.yml \
  ui/src/commentary/hinglish.json ui/src/commentary/english.json ui/src/commentary/pick.ts ui/src/commentary/lines.ts \
  ui/src/thread/logic.ts ui/src/level/Thread.tsx packages/shared/src/levels/schema.ts \
  ui/test/commentary.test.ts ui/test/thread.choices.test.tsx packages/shared/src/levels/__tests__/choices.test.ts \
  docs/handoffs/D-02.md; do
  [ -f "$f" ] && ok "$f" || bad "missing $f"
done

section "A2. start script"
bash -n scripts/start && ok "bash -n scripts/start" || bad "scripts/start has a syntax error"
# every behaviour the script had before D-02 is still there
for s in 'scripts/preflight.sh ||' 'cp .env.example .env' 'mkdir -p logs .progress workspace postgres/init' \
  'docker compose restart proxy' "stat -f %m docker/Caddyfile" "date -j -u -f" 'wait_healthy redis' 'wait_healthy postgres' \
  '/health' 'UI_UP' 'Redis Insight:' 'Stop:           scripts/stop'; do
  has scripts/start "$s" && ok "scripts/start still has: $s" || bad "scripts/start lost: $s"
done
for s in 'write_stage preflight' 'write_stage building' 'write_stage starting' 'write_stage ready' 'write_stage failed' \
  'docker compose up -d proxy' 'docker compose build' 'QUEST_NO_OPEN' 'open "http://localhost'; do
  has scripts/start "$s" && ok "scripts/start has: $s" || bad "scripts/start is missing: $s"
done
if grep -nE 'declare -A|readarray|mapfile|\$\{[a-zA-Z_]+,,\}|\$\{[a-zA-Z_]+\^\^\}|sed -i [^'"'"']|date -d |stat -c' scripts/start >/dev/null; then
  bad "scripts/start uses a bash 4 or GNU-only construct"
else ok "scripts/start has no bash 4 or GNU-only construct"; fi

section "A3. proxy and compose"
has docker/Caddyfile 'handle_errors' && ok "Caddyfile has handle_errors" || bad "Caddyfile has no handle_errors"
has docker/Caddyfile '/srv/starting' && ok "Caddyfile serves /srv/starting" || bad "Caddyfile does not serve /srv/starting"
has docker/Caddyfile '{err.status_code}' && ok "Caddyfile keeps the error's own status code" || bad "Caddyfile drops the status code"
has docker/Caddyfile '/_starting/stage.json' && ok "Caddyfile serves the stage file" || bad "Caddyfile does not serve the stage file"
has docker/Caddyfile 'reverse_proxy ui:3100' && has docker/Caddyfile 'engine:4200' && has docker/Caddyfile 'dynamic a' \
  && ok "Caddyfile still routes ui, engine and app" || bad "Caddyfile lost a route"
has docker-compose.yml './docker/starting:/srv/starting:ro' && ok "proxy mounts docker/starting read-only" || bad "no read-only mount of docker/starting"
has docker-compose.yml './logs:/logs' && ok "proxy still mounts ./logs" || bad "proxy lost the logs mount"
# nothing else in docker-compose.yml changed
other="$(git diff "$BASE" -- docker-compose.yml | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE 'docker/Caddyfile:/etc/caddy|docker/starting:/srv/starting|\./logs:/logs|^[+-][[:space:]]+volumes:' )"
[ -z "$other" ] && ok "docker-compose.yml: only the proxy volumes changed" || { bad "docker-compose.yml changed elsewhere:"; printf '%s\n' "$other" | head -n 8; }
if grep -rnE '(^|[^a-z])(502|503)' scripts/check/P0-02.sh >/dev/null; then ok "P0-02 still accepts 502 and 503 on / (the start page keeps 502)"; fi

section "A4. start page"
P=docker/starting/index.html
has "$P" '<noscript><meta http-equiv="refresh"' && ok "meta refresh when JavaScript is off" || bad "no meta refresh"
has "$P" '/_starting/stage.json' && ok "reads the stage file" || bad "does not read the stage file"
has "$P" 'prefers-reduced-motion' && ok "honours reduced motion" || bad "ignores reduced motion"
has "$P" 'aria-live' && ok "status is a live region" || bad "no live region"
if grep -nE 'https?://|//cdn|@import|<link ' "$P" >/dev/null; then bad "the start page reaches for another origin or file"; else ok "self-contained: no other origin, import or stylesheet"; fi
for w in preflight building starting ready; do has "$P" "'$w'" && ok "knows the $w stage" || bad "does not know the $w stage"; done

section "A5. commentary, choices and the eight chapters (node)"
BASE="$BASE" node - <<'JS' && ok "commentary and chapter checks" || bad "commentary and chapter checks reported failures (above)"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const yaml = createRequire(path.resolve('packages/shared/package.json'))('yaml');
const base = process.env.BASE;
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed = 1; };

// commentary tables
const MOMENTS = ['pass', 'fail', 'works_but_wrong', 'chapter_done', 'dangerous', 'stack_down', 'stack_back'];
for (const lang of ['hinglish', 'english']) {
  const t = JSON.parse(fs.readFileSync(`ui/src/commentary/${lang}.json`, 'utf8'));
  ok(JSON.stringify(Object.keys(t).sort()) === JSON.stringify([...MOMENTS].sort()), `${lang}.json has exactly the moments`);
  ok(MOMENTS.every((m) => Array.isArray(t[m]) && t[m].length >= 3 && new Set(t[m]).size === t[m].length), `${lang}.json: three or more distinct lines per moment`);
  const all = MOMENTS.flatMap((m) => t[m]).join('\n');
  ok(!/redis|cache|ttl|expire|memory|database|postgres|server|command|\bbet\b|stake|payout|cash|\bipl\b/i.test(all), `${lang}.json: nothing about Redis, no money words`);
}

// the eight chapters
const dirs = fs.readdirSync('levels').filter((d) => !d.startsWith('_') && fs.existsSync(`levels/${d}/chapter.yaml`));
ok(dirs.length === 8, `eight chapters (${dirs.length})`);
const emoji = (s) => (s.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
for (const d of dirs) {
  const file = `levels/${d}/chapter.yaml`;
  const raw = fs.readFileSync(file, 'utf8');
  let baseRaw = '';
  try { baseRaw = execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }); } catch { baseRaw = ''; }
  ok(baseRaw !== '', `${d}: found at ${base}`);
  const now = yaml.parse(raw);
  const was = yaml.parse(baseRaw);
  const strip = (m) => ({ from: m.from, time: m.time, text: m.text });
  ok(JSON.stringify(now.incident.map(strip)) === JSON.stringify(was.incident.map(strip)), `${d}: same messages, same order, same words as at ${base}`);
  ok(now.id === was.id && now.title === was.title && JSON.stringify(now.levels) === JSON.stringify(was.levels), `${d}: id, title and level list unchanged`);
  ok(emoji(raw) === emoji(baseRaw), `${d}: emoji count unchanged (${emoji(raw)})`);
  const withChoices = now.incident.filter((m) => m.choices);
  ok(withChoices.length >= 1, `${d}: the player has at least one choice (${withChoices.length})`);
  for (const m of withChoices) {
    const c = m.choices;
    ok(m.from === 'you' && c.length >= 2 && c.length <= 3 && c[0] === m.text && new Set(c.map((x) => x.trim().toLowerCase())).size === c.length,
      `${d} ${m.time}: 2-3 distinct choices, first is the line itself, from you`);
    const joined = c.join('\n');
    ok(!/\b(bet|stake|payout|cash|ipl|indian premier)\b/i.test(joined) && !/\b(AI|LLM|embeddings?|vectors?|GPT)\b/.test(joined) && !/from:|time:/.test(joined) && emoji(joined) === 0,
      `${d} ${m.time}: no banned words, no emoji at all (a line with an emoji gets no choices), nothing a content check would trip on`);
  }
}
process.exit(failed);
JS

# ---------------------------------------------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  LIVE=1
else
  section "B and C"
  skip "Docker is not available: the proxy and full-start checks did not run"
  finish
fi

. scripts/check/lib/isolate.sh
quest_isolate d02 4370 6570 5670 5770
LOGS="$QUEST_CHECK_SCRATCH/logs"
PORT="$QUEST_CHECK_PROXY_PORT"
BASEURL="http://localhost:$PORT"
mkdir -p "$LOGS/start" postgres/init

section "B1. the proxy alone answers a page request with the start page and keeps 502"
printf '{"stage":"building","startedAt":%s,"stageStartedAt":%s,"updatedAt":%s,"detail":"check"}\n' \
  "$(date +%s)" "$(date +%s)" "$(date +%s)" > "$LOGS/start/stage.json"
docker compose up -d proxy >/dev/null 2>&1 && ok "proxy started (project $QUEST_CHECK_PROJECT)" || { bad "docker compose up -d proxy"; finish; }
i=0; code=000
while [ "$i" -lt 30 ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASEURL/_starting/stage.json" 2>/dev/null)"
  [ "$code" = "200" ] && break
  sleep 1; i=$((i + 1))
done
[ "$code" = "200" ] && ok "GET /_starting/stage.json -> 200" || { bad "stage file not served (got $code)"; finish; }
curl -s --max-time 3 "$BASEURL/_starting/stage.json" | grep -q '"stage":"building"' && ok "the stage file is the one written" || bad "wrong stage file body"
curl -sI --max-time 3 "$BASEURL/_starting/stage.json" | tr -d '\r' | grep -qi '^cache-control: no-store' && ok "the stage file is not cacheable" || bad "stage file has no no-store"

code="$(curl -s -o "$QUEST_CHECK_SCRATCH/page.html" -w '%{http_code}' --max-time 5 "$BASEURL/")"
[ "$code" = "502" ] && ok "GET / with no ui service -> 502 (the code every other check expects)" || bad "GET / -> $code, expected 502"
grep -q 'Redis Quest is starting' "$QUEST_CHECK_SCRATCH/page.html" && ok "the body is the start page" || bad "the body is not the start page"
code="$(curl -s -o "$QUEST_CHECK_SCRATCH/page2.html" -w '%{http_code}' --max-time 5 "$BASEURL/level/ch0-02-say-hello")"
[ "$code" = "502" ] && grep -q 'Redis Quest is starting' "$QUEST_CHECK_SCRATCH/page2.html" && ok "a deep link gets the start page too (502)" || bad "deep link: $code"
curl -sI --max-time 3 "$BASEURL/" | tr -d '\r' | grep -qi '^cache-control: no-store' && ok "the start page is not cacheable" || bad "start page has no no-store"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -I "$BASEURL/")"
[ "$code" = "502" ] && ok "HEAD / -> 502 (the page's own probe)" || bad "HEAD / -> $code"

section "B2. engine paths, /app and assets stay bare errors"
for path in /api/progress /health /app/ping /internal/metrics /_next/static/x.js; do
  code="$(curl -s -o "$QUEST_CHECK_SCRATCH/bare.out" -w '%{http_code}' --max-time 5 "$BASEURL$path")"
  case "$code" in
    502|503|504) if grep -q 'Redis Quest is starting' "$QUEST_CHECK_SCRATCH/bare.out"; then bad "$path got the start page"; else ok "$path -> $code, no start page"; fi ;;
    *) bad "$path -> $code, expected an error status" ;;
  esac
done

section "B3. the stage file is read fresh every time"
printf '{"stage":"failed","startedAt":1,"stageStartedAt":1,"updatedAt":1,"detail":"check","failedAt":"building"}\n' > "$LOGS/start/stage.json"
curl -s --max-time 3 "$BASEURL/_starting/stage.json" | grep -q '"stage":"failed"' && ok "a changed stage file is served at once" || bad "stale stage file served"

# ---------------------------------------------------------------------------------------------------------------
if [ "${D02_FULL:-}" != "1" ]; then
  section "C. full start"
  skip "set D02_FULL=1 to run QUEST_NO_OPEN=1 scripts/start in the isolated project (builds the image: many minutes)"
  finish
fi

section "C1. scripts/start in the isolated project, stage file watched"
rm -f "$LOGS/start/stage.json"
OUT="$QUEST_CHECK_SCRATCH/start.out"
SEEN=""
SAW_PAGE=0
QUEST_NO_OPEN=1 bash scripts/start > "$OUT" 2>&1 &
SP=$!
while kill -0 "$SP" 2>/dev/null; do
  cur="$(sed -n 's/.*"stage":"\([a-z]*\)".*/\1/p' "$LOGS/start/stage.json" 2>/dev/null | head -n 1)"
  if [ -n "$cur" ]; then
    case " $SEEN " in *" $cur "*) ;; *) SEEN="$SEEN $cur" ;; esac
  fi
  case "$cur" in
    building|starting)
      if [ "$SAW_PAGE" -eq 0 ]; then
        c="$(curl -s -o "$QUEST_CHECK_SCRATCH/mid.html" -w '%{http_code}' --max-time 2 "$BASEURL/" 2>/dev/null)"
        if [ "$c" = "502" ] && grep -q 'Redis Quest is starting' "$QUEST_CHECK_SCRATCH/mid.html"; then SAW_PAGE=1; fi
      fi ;;
  esac
  sleep 1
done
wait "$SP"; rc=$?
tail -n 12 "$OUT"
[ "$rc" -eq 0 ] && ok "scripts/start exited 0" || bad "scripts/start exited $rc"
[ "$SAW_PAGE" -eq 1 ] && ok "while it built, GET / answered 502 with the start page" || bad "never saw the start page while building"
# preflight lasts a few seconds and can fall between two polls, so it is optional here
case "$SEEN" in
  " preflight building starting ready"|" building starting ready") ok "stage file went (preflight,) building, starting, ready:$SEEN" ;;
  *) bad "stage sequence was:$SEEN" ;;
esac
grep -q '"stage":"ready"' "$LOGS/start/stage.json" && ok "final stage is ready" || bad "final stage is not ready"
[ "$(curl -s -o "$QUEST_CHECK_SCRATCH/game.html" -w '%{http_code}' --max-time 5 "$BASEURL/")" = "200" ] && ok "GET / -> 200 once the game is up" || bad "GET / is not 200 after start"
grep -q 'Redis Quest is starting' "$QUEST_CHECK_SCRATCH/game.html" && bad "the game page is still the start page" || ok "the game page is not the start page"
curl -fs --max-time 5 "$BASEURL/health" | grep -q '"ok":true' && ok "GET /health ok" || bad "GET /health is not ok"
grep -q 'restarting the proxy' "$OUT" && echo "note: the proxy was restarted by the stale-routes rule" || true

section "C2. a second start on the running stack"
QUEST_NO_OPEN=1 bash scripts/start > "$QUEST_CHECK_SCRATCH/start2.out" 2>&1 && ok "second scripts/start exited 0" || bad "second start failed"
grep -q '"stage":"ready"' "$LOGS/start/stage.json" && ok "and the stage file says ready again" || bad "stage file is not ready after the second start"

finish
