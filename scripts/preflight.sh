#!/usr/bin/env bash
# Redis Quest preflight: tells a beginner what is missing before anything is pulled.
# macOS + Docker CLI only. Bash 3.2 compatible. Usage: scripts/preflight.sh [--quiet]
# Port values: process environment beats .env beats the defaults in .env.example (same as compose).

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
FAILS=0

pass() { [ "$QUIET" -eq 1 ] || printf 'PASS  %s\n' "$1"; }
fail() {
  FAILS=$((FAILS + 1))
  printf 'FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '      fix: %s\n' "$2"
}

# Reads KEY from the environment, then .env, then the default.
cfg() {
  local key="$1" def="$2" val
  eval "val=\${$key:-}"
  if [ -z "$val" ] && [ -f "$ENV_FILE" ]; then
    val="$(grep -E "^[[:space:]]*$key=" "$ENV_FILE" | tail -n 1 | sed -e 's/^[^=]*=//' -e 's/[[:space:]]*#.*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")"
  fi
  printf '%s' "${val:-$def}"
}

# 1. Apple Silicon
arch="$(uname -m)"
if [ "$arch" = "arm64" ]; then pass "Apple Silicon (uname -m = arm64)"
else fail "CPU is $arch, Redis Quest needs Apple Silicon (arm64)" "run it on an M-series Mac; Intel Macs are not supported"; fi

# 2. macOS 14+
osv="$(sw_vers -productVersion 2>/dev/null)"
osmajor="${osv%%.*}"
if [ -n "$osmajor" ] && [ "$osmajor" -ge 14 ] 2>/dev/null; then pass "macOS $osv (14 or newer)"
else fail "macOS ${osv:-unknown} is older than 14" "update macOS: System Settings > General > Software Update"; fi

# 3. docker CLI
if command -v docker >/dev/null 2>&1; then
  pass "docker CLI found ($(command -v docker))"
  HAVE_DOCKER=1
else
  fail "docker CLI not found" "install Docker Desktop for Mac (Apple silicon) from docker.com, open it once, then re-run"
  HAVE_DOCKER=0
fi

# 4. daemon reachable
DAEMON=0
if [ "$HAVE_DOCKER" -eq 1 ]; then
  if docker info >/dev/null 2>&1; then
    DAEMON=1
  elif [ -t 0 ] && [ -t 1 ]; then
    printf 'Docker is not running. Start Docker Desktop now? [y/N] '
    read -r ans
    case "$ans" in
      y|Y)
        open -a Docker
        printf 'Waiting up to 90 s for Docker'
        i=0
        while [ "$i" -lt 45 ]; do
          if docker info >/dev/null 2>&1; then DAEMON=1; break; fi
          printf '.'; sleep 2; i=$((i + 1))
        done
        printf '\n'
        ;;
    esac
  fi
  if [ "$DAEMON" -eq 1 ]; then pass "Docker daemon reachable"
  else fail "Docker daemon is not reachable" "run: open -a Docker   (wait for the whale icon to stop animating, then re-run)"; fi
fi

# 5. Compose v2 >= 2.20
if [ "$DAEMON" -eq 1 ]; then
  cv="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  cmaj="${cv%%.*}"; crest="${cv#*.}"; cmin="${crest%%.*}"
  if [ -n "$cv" ] && { [ "$cmaj" -gt 2 ] 2>/dev/null || { [ "$cmaj" -eq 2 ] && [ "$cmin" -ge 20 ]; } 2>/dev/null; }; then
    pass "Docker Compose $cv (2.20 or newer)"
  else
    fail "Docker Compose is '${cv:-missing}', need v2.20 or newer" "update Docker Desktop (menu bar whale > Check for updates)"
  fi

  # 6. Docker memory >= 6 GiB
  mem="$(docker info --format '{{.MemTotal}}' 2>/dev/null)"
  need=6442450944
  if [ -n "$mem" ] && [ "$mem" -ge "$need" ] 2>/dev/null; then
    pass "Docker memory $(awk -v b="$mem" 'BEGIN{printf "%.1f", b/1073741824}') GiB (6 GiB or more)"
  else
    fail "Docker has $(awk -v b="${mem:-0}" 'BEGIN{printf "%.1f", b/1073741824}') GiB of memory, need at least 6 GiB (8 recommended)" \
      "Docker Desktop > Settings > Resources > Memory limit: set 8 GB, click Apply & restart"
  fi
fi

# 7. free disk >= 10 GB (df -k avail, decimal GB)
avail="$(df -k "$ROOT" | awk 'NR==2 {print $4}')"
if [ -n "$avail" ] && [ "$avail" -ge 10000000 ] 2>/dev/null; then
  pass "Free disk $(awk -v k="$avail" 'BEGIN{printf "%.1f", k/1000000}') GB (10 GB or more)"
else
  fail "Free disk is $(awk -v k="${avail:-0}" 'BEGIN{printf "%.1f", k/1000000}') GB, need at least 10 GB" \
    "free space (empty Trash; docker system prune -a removes unused images); images take about 2 GB"
fi

# 8. git
if command -v git >/dev/null 2>&1; then pass "git found"
else fail "git not found" "run: xcode-select --install"; fi

# 9. host ports
OURS=""
if [ "$DAEMON" -eq 1 ]; then
  OURS="$(docker ps --filter label=com.docker.compose.project=redis-quest --format '{{.Ports}}' 2>/dev/null)"
fi

check_port() { # name port envname
  local label="$1" port="$2" envname="$3" owner dname fixmsg
  case "$port" in ''|*[!0-9]*) fail "$label: '$port' is not a port number" "fix $envname in .env"; return;; esac
  if printf '%s' "$OURS" | grep -q "127.0.0.1:$port->"; then
    pass "port $port ($label) is held by this Redis Quest stack"
    return
  fi
  owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1 " (pid " $2 ")"}' | sort -u | tr '\n' ' ')"
  if [ -z "$owner" ]; then pass "port $port free ($label)"; return; fi
  dname=""
  [ "$DAEMON" -eq 1 ] && dname="$(docker ps --filter publish="$port" --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')"
  [ -n "$dname" ] && owner="$owner, docker container: $dname"
  if [ -n "$envname" ]; then
    fixmsg="set $envname=<free port> in .env (copy .env.example first), or stop what holds it"
    [ "$port" = "6379" ] && fixmsg="brew services stop redis  (or set REDIS_PORT=6390 in .env; copy .env.example to .env first)"
  else
    fixmsg="stop what holds it (this port is fixed for the chapter that uses it)"
  fi
  fail "port $port ($label) is in use by: $owner" "$fixmsg"
}

check_port proxy    "$(cfg PROXY_PORT 3000)"     PROXY_PORT
check_port insight  "$(cfg INSIGHT_PORT 5540)"   INSIGHT_PORT
check_port redis    "$(cfg REDIS_PORT 6379)"     REDIS_PORT
check_port postgres "$(cfg PG_PORT 5432)"        PG_PORT
check_port "replica profile"  6380 ""
for p in 26379 26380 26381; do check_port "sentinel profile" "$p" ""; done
for p in 7100 7101 7102 7103 7104 7105; do check_port "cluster profile" "$p" ""; done

if [ "$FAILS" -gt 0 ]; then
  printf '\nPreflight: %s problem(s). Fix them and re-run scripts/preflight.sh\n' "$FAILS"
  exit 1
fi
[ "$QUIET" -eq 1 ] || printf '\nPreflight OK\n'
exit 0
