#!/usr/bin/env bash
# Creates the starter issues in docs/launch/issues/ on GitHub with the gh CLI. Bash 3.2 compatible.
#
#   scripts/launch/create-issues.sh --dry-run          print what would be done; touches nothing, needs no login
#   scripts/launch/create-issues.sh                    create the labels, then the issues, after asking once
#   scripts/launch/create-issues.sh --yes              the same without the question
#   scripts/launch/create-issues.sh --repo OWNER/NAME  another repository (default PUNEETRKRAJPUT/Redis-Quest)
#
# Each file under docs/launch/issues/ starts with a front matter block:
#   ---
#   title: "The issue title"
#   labels: good first issue, tests, engine
#   ---
# and the rest of the file is the issue body. Run it from anywhere inside the repository.
#
# Safe to run twice: an issue whose title already exists in the repository (open or closed) is skipped.
# gh must be logged in to an account that can write to the repository (gh auth status shows which one).
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
DIR=docs/launch/issues

REPO=PUNEETRKRAJPUT/Redis-Quest
DRY=0
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
    --repo)
      shift
      [ $# -gt 0 ] || { echo "--repo needs OWNER/NAME" >&2; exit 2; }
      REPO=$1
      ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

FILES=$(ls "$DIR"/[0-9][0-9]-*.md 2>/dev/null)
[ -n "$FILES" ] || { echo "no issue drafts found in $DIR" >&2; exit 1; }
COUNT=$(printf '%s\n' "$FILES" | wc -l | tr -d ' ')

TMP=$(mktemp -d "${TMPDIR:-/tmp}/quest-issues.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT TERM

# --- reading a draft ---------------------------------------------------------------------------

title_of() { # file -> the title, quotes removed
  sed -n 's/^title: *//p' "$1" | head -n 1 | sed -e 's/^"//' -e 's/"[[:space:]]*$//' -e 's/\\"/"/g'
}
labels_of() { # file -> one label per line
  sed -n 's/^labels: *//p' "$1" | head -n 1 | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$'
}
body_of() { # file -> the body, after the closing --- of the front matter
  awk 'c >= 2 { print } /^---[ \t]*$/ { c++ }' "$1"
}

label_color() { # label -> a colour without #. None of these is red.
  case "$1" in
    "good first issue") echo 7057ff ;;
    "help wanted") echo 008672 ;;
    tests) echo 0e8a16 ;;
    docs) echo 0075ca ;;
    levels) echo fbca04 ;;
    ui) echo 1d76db ;;
    engine) echo 5319e7 ;;
    scripts) echo c5def5 ;;
    playtest) echo f9d0c4 ;;
    cleanup) echo bfdadc ;;
    *) echo ededed ;;
  esac
}
label_description() {
  case "$1" in
    "good first issue") echo "Small, with the file to look at" ;;
    "help wanted") echo "Bigger than a first issue; ask in the thread before starting" ;;
    tests) echo "Adds or fixes a test" ;;
    docs) echo "Documentation" ;;
    levels) echo "Level content: a YAML level, its solutions or its text" ;;
    ui) echo "The game's screens" ;;
    engine) echo "The engine service" ;;
    scripts) echo "Shell scripts" ;;
    playtest) echo "Something to try by playing" ;;
    cleanup) echo "Removes or simplifies code" ;;
    *) echo "" ;;
  esac
}

# --- checks on the drafts (also done in a dry run) ------------------------------------------------

BAD=0
for f in $FILES; do
  t=$(title_of "$f")
  l=$(labels_of "$f" | head -n 1)
  b=$(body_of "$f" | wc -c | tr -d ' ')
  if [ -z "$t" ] || [ -z "$l" ] || [ "$b" -lt 50 ]; then
    echo "bad draft: $f (title '${t}', first label '${l}', body ${b} bytes)" >&2
    BAD=$((BAD + 1))
  fi
done
[ "$BAD" -eq 0 ] || exit 1

ALL_LABELS=$(for f in $FILES; do labels_of "$f"; done | sort -u)

# --- dry run -----------------------------------------------------------------------------------------

if [ "$DRY" -eq 1 ]; then
  echo "DRY RUN: nothing is sent to GitHub. Repository: $REPO"
  echo
  echo "Would create or update $(printf '%s\n' "$ALL_LABELS" | wc -l | tr -d ' ') labels:"
  printf '%s\n' "$ALL_LABELS" | while IFS= read -r l; do
    echo "  gh label create \"$l\" --color $(label_color "$l") --force --repo $REPO"
  done
  echo
  echo "Would create these $COUNT issues (skipping any whose title already exists):"
  n=0
  for f in $FILES; do
    n=$((n + 1))
    labels=$(labels_of "$f" | tr '\n' ',' | sed 's/,$//')
    printf '  %02d  [%s]  %s\n        from %s\n' "$n" "$labels" "$(title_of "$f")" "$f"
  done
  echo
  echo "dry run complete: $COUNT drafts are well-formed"
  exit 0
fi

# --- for real ----------------------------------------------------------------------------------------

command -v gh >/dev/null 2>&1 || { echo "gh is not installed (brew install gh)" >&2; exit 1; }
if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not logged in: run gh auth login with the account that owns $REPO" >&2
  exit 1
fi
echo "gh account:"
gh auth status 2>&1 | sed 's/^/  /'
echo

if [ "$YES" -ne 1 ]; then
  printf 'Create %s issues in %s? [y/N] ' "$COUNT" "$REPO"
  read -r ans
  case "$ans" in y|Y) ;; *) echo "Cancelled."; exit 1 ;; esac
fi

echo "== labels"
printf '%s\n' "$ALL_LABELS" | while IFS= read -r l; do
  if gh label create "$l" --color "$(label_color "$l")" --description "$(label_description "$l")" --force --repo "$REPO" >/dev/null 2>&1; then
    echo "  ok   $l"
  else
    echo "  FAIL $l (does this account have write access to $REPO?)" >&2
  fi
done

echo "== existing issues"
if ! gh issue list --repo "$REPO" --state all --limit 500 --json title --jq '.[].title' > "$TMP/existing.txt" 2> "$TMP/err.txt"; then
  echo "could not list issues in $REPO:" >&2
  cat "$TMP/err.txt" >&2
  exit 1
fi
echo "  $(wc -l < "$TMP/existing.txt" | tr -d ' ') found"

echo "== issues"
CREATED=0
SKIPPED=0
FAILED=0
for f in $FILES; do
  title=$(title_of "$f")
  if grep -qxF "$title" "$TMP/existing.txt"; then
    echo "  skip   $title (already exists)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  body_of "$f" > "$TMP/body.md"
  set --
  for l in $(labels_of "$f" | sed 's/ /@@/g'); do
    set -- "$@" --label "$(printf '%s' "$l" | sed 's/@@/ /g')"
  done
  if url=$(gh issue create --repo "$REPO" --title "$title" --body-file "$TMP/body.md" "$@" 2> "$TMP/err.txt"); then
    echo "  created $url"
    CREATED=$((CREATED + 1))
  else
    echo "  FAILED $title" >&2
    sed 's/^/         /' "$TMP/err.txt" >&2
    FAILED=$((FAILED + 1))
  fi
done

echo
echo "done: $CREATED created, $SKIPPED skipped, $FAILED failed"
[ "$FAILED" -eq 0 ]
