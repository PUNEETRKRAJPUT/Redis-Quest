#!/usr/bin/env bash
# Writes three small stand-ins into <dir>, for running this project's Mac-shaped scripts on the hosted Linux arm64
# runner (.github/workflows/stack.yml). scripts/ci/run-check.sh puts <dir> first on PATH for one check at a time.
# Nothing here is used on a Mac, and the scripts themselves stay as they are (scripts/check/D-02.sh insists that
# scripts/start keeps its BSD spellings).
#
#   uname -m   answers arm64. Linux calls the same CPU aarch64; scripts/preflight.sh asks for the Mac's word.
#   sw_vers    answers a macOS version scripts/preflight.sh accepts. There is no macOS on the runner: that check
#              is about Docker Desktop on a Mac and has nothing to say here.
#   sed -i ''  BSD's spelling of "edit in place, keep no backup", passed to GNU sed as plain -i.
set -eu

dir="${1:?usage: linux-shims.sh <dir>}"
mkdir -p "$dir"
real_uname="$(command -v uname)"
real_sed="$(command -v sed)"

cat > "$dir/uname" <<EOF
#!/bin/sh
if [ "\$#" -eq 1 ] && [ "\$1" = "-m" ]; then
  m="\$($real_uname -m)"
  if [ "\$m" = "aarch64" ]; then m=arm64; fi
  echo "\$m"
else
  exec $real_uname "\$@"
fi
EOF

cat > "$dir/sw_vers" <<'EOF'
#!/bin/sh
echo "15.0"
EOF

cat > "$dir/sed" <<EOF
#!/usr/bin/env bash
args=()
after_i=0
for a in "\$@"; do
  if [ "\$after_i" -eq 1 ]; then
    after_i=0
    if [ -z "\$a" ]; then continue; fi
  fi
  if [ "\$a" = "-i" ]; then after_i=1; fi
  args+=("\$a")
done
exec $real_sed "\${args[@]}"
EOF

chmod +x "$dir/uname" "$dir/sw_vers" "$dir/sed"
echo "linux-shims: uname, sw_vers and sed written to $dir"
