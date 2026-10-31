#!/usr/bin/env bash
# Runs every P*.sh and C*.sh check in sorted order; stops at the first failure.
cd "$(dirname "$0")"

results=""
status=0
for f in $(ls P*.sh C*.sh 2>/dev/null | sort); do
  printf '\n######## %s\n' "$f"
  if bash "./$f"; then
    results="${results}PASS  ${f}
"
  else
    results="${results}FAIL  ${f}
"
    status=1
    break
  fi
done

printf '\n==== summary ====\n'
printf '%s' "$results"
if [ "$status" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "STOPPED AT FIRST FAILURE"; fi
exit "$status"
