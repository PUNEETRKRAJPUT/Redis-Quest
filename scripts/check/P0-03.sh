#!/usr/bin/env bash
# P0-03 check: fiction bible JSON validity, counts, ids, uniqueness, denylist.
# bash 3.2 compatible; the real work is done in python3 (ships with macOS CLT).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
command -v python3 >/dev/null 2>&1 || { echo "FAIL python3 not found"; exit 1; }
[ -f "$ROOT/docs/fiction.md" ] || { echo "FAIL docs/fiction.md missing"; exit 1; }
echo "ok   docs/fiction.md exists"
python3 -I - "$ROOT" <<'PY'
import json, re, sys, os, collections
root = sys.argv[1]
fails = []
def ok(msg): print("ok   " + msg)
def bad(msg): print("FAIL " + msg); fails.append(msg)
def check(cond, good, fail):
    ok(good) if cond else bad(fail)

data = {}
for n in ["league","teams","players","colleges","hostels","cast","denylist"]:
    p = os.path.join(root, "fiction", n + ".json")
    try:
        data[n] = json.load(open(p, encoding="utf-8"))
        ok("fiction/%s.json parses" % n)
    except Exception as e:
        bad("fiction/%s.json: %s" % (n, e))
if fails: sys.exit(1)

teams = data["teams"]["teams"]; players = data["players"]["players"]
colleges = data["colleges"]["colleges"]; hostels = data["hostels"]["hostels"]
cast = data["cast"]["cast"]; league = data["league"]; deny = data["denylist"]

check(len(teams) == 8, "8 teams", "teams: %d" % len(teams))
check(len(players) == 200, "200 players", "players: %d" % len(players))
check(len(colleges) == 12, "12 colleges", "colleges: %d" % len(colleges))
check(len(hostels) == 48, "48 hostels", "hostels: %d" % len(hostels))
check(len(cast) == 5, "5 cast members", "cast: %d" % len(cast))

tid = [t["id"] for t in teams]
check(tid == ["t-%02d" % i for i in range(1, 9)], "team ids t-01..t-08", "team ids: %s" % tid)
check([p["id"] for p in players] == ["p-%03d" % i for i in range(1, 201)], "player ids p-001..p-200", "player id sequence wrong")
check([c["id"] for c in colleges] == ["c-%02d" % i for i in range(1, 13)], "college ids c-01..c-12", "college ids wrong")
hid_ok = all(re.fullmatch(r"h-c-\d\d-[1-4]", h["id"]) and h["id"] == "h-%s-%s" % (h["college_id"], h["id"][-1]) for h in hostels)
check(hid_ok, "hostel ids match h-<college>-<n>", "hostel id format wrong")
per_col = collections.Counter(h["college_id"] for h in hostels)
check(sorted(per_col) == [c["id"] for c in colleges] and set(per_col.values()) == {4}, "4 hostels per college", "hostels per college: %s" % dict(per_col))
check(len(set(h["id"] for h in hostels)) == 48, "hostel ids unique", "duplicate hostel ids")
check(len(set(h["name"] for h in hostels if True)) >= 40, "hostel names mostly distinct", "too many repeated hostel names")
check(len(set(c["city"] for c in colleges)) >= 8, "colleges span >= 8 cities (%d)" % len(set(c["city"] for c in colleges)), "fewer than 8 cities")
check(sorted(c["slug"] for c in cast) == ["rival-college","roommate","senior","sms-vendor","warden"], "cast slugs correct", "cast slugs wrong")
check(all(len(c["dialogue"]) == 3 and c["bio"] and c["name"] for c in cast), "each cast member has a paragraph and 3 dialogue lines", "cast fields incomplete")

per_team = collections.Counter(p["team_id"] for p in players)
check(sorted(per_team) == tid and set(per_team.values()) == {25}, "25 players per team", "per team: %s" % dict(per_team))
check(len(set(p["id"] for p in players)) == 200, "player ids unique", "duplicate player ids")
names = [p["name"].strip().lower() for p in players]
check(len(set(names)) == 200, "player full names unique", "duplicate player names")

hexre = re.compile(r"#[0-9A-Fa-f]{6}")
tok = all(re.fullmatch(r"[A-Z]{3}", t["code"]) and hexre.fullmatch(t["primary_colour"]) and hexre.fullmatch(t["secondary_colour"]) and t["city"] and t["home_ground"] and t["personality"] for t in teams)
check(tok, "team fields valid (3-letter code, hex colours, ground, personality)", "team fields invalid")
check(len(set(t["code"] for t in teams)) == 8 and len(set(t["name"].lower() for t in teams)) == 8, "team codes and names unique", "team codes or names duplicate")

roles = {"batter","bowler","all-rounder","keeper"}
bad_p = []
for p in players:
    r = p["role"]
    if r not in roles or p["batting_hand"] not in ("left","right") or not (19 <= p["age"] <= 38) or not (1 <= p["fame"] <= 100) or p["team_id"] not in tid: bad_p.append(p["id"])
    elif not isinstance(p["bat_avg"], (int, float)) or not isinstance(p["strike_rate"], (int, float)): bad_p.append(p["id"])
    elif r in ("bowler","all-rounder") and (p["bowling_style"] is None or p["bowl_econ"] is None or p["bowl_avg"] is None): bad_p.append(p["id"])
    elif r in ("batter","keeper") and (p["bowling_style"] is not None or p["bowl_econ"] is not None or p["bowl_avg"] is not None): bad_p.append(p["id"])
check(not bad_p, "player roles, hands, ages 19-38, fame 1-100, stats consistent", "bad players: %s" % bad_p[:5])
hi = [p["id"] for p in players if p["fame"] > 95]
check(len(hi) == 3, "exactly 3 players with fame > 95 (%s)" % ", ".join(hi), "fame > 95 count: %d" % len(hi))
nn = sum(1 for p in players if p["nickname"])
check(30 <= nn <= 50, "about one in five players has a nickname (%d)" % nn, "nickname count %d" % nn)

# denylist
cr = deny["cricketers"]; fr = deny["franchises"]
check(len(set(x.lower() for x in cr)) >= 150, "denylist has %d cricketers (>= 150)" % len(cr), "denylist cricketers: %d" % len(cr))
check(len(set(x.lower() for x in fr)) >= 40, "denylist has %d franchises (>= 40)" % len(fr), "denylist franchises: %d" % len(fr))
def key(n):
    parts = n.replace("'", "").split()
    return (re.sub(r"[^a-z]", "", parts[-1].lower()), parts[0][0].lower())
dfull = set(x.strip().lower() for x in cr)
dkeys = set(key(x) for x in cr)
hits = [p["name"] for p in players if p["name"].strip().lower() in dfull]
check(not hits, "no player full name is in the denylist", "full-name hits: %s" % hits)
hits = [p["name"] for p in players if key(p["name"]) in dkeys]
check(not hits, "no player matches a denylist surname + first initial", "surname+initial hits: %s" % hits)
fl = [x.lower() for x in fr]
hits = [t["name"] for t in teams if any(t["name"].lower() == f or f in t["name"].lower() for f in fl)]
check(not hits, "no team name matches or contains a real franchise", "team name hits: %s" % hits)
hits = [c["name"] for c in cast if c["name"].strip().lower() in dfull or key(c["name"]) in dkeys]
check(not hits, "no cast name matches the denylist", "cast hits: %s" % hits)

ln = league["name"]
check(not re.search(r"ipl|indian premier", ln, re.I), "league name '%s' free of IPL / Indian Premier" % ln, "league name contains IPL")
f = league["format"]
check(f["teams"] == 8 and "double round robin" in f["league_stage"] and f["playoffs"], "league format: 8 teams, double round robin, playoffs", "league format wrong")
check(bool(league["final"]["name"]) and bool(league["final"]["venue"]), "league final defined (%s)" % league["final"]["name"], "league final missing")
blob = json.dumps(data["league"]) + open(os.path.join(root, "docs/fiction.md"), encoding="utf-8").read()
check(not re.search(r"\bIPL\b|Indian Premier", json.dumps(data["league"]), re.I), "league.json never mentions IPL", "league.json mentions IPL")

if fails:
    print("\nP0-03 FAILED (%d)" % len(fails)); sys.exit(1)
print("\nP0-03 PASSED")
PY
