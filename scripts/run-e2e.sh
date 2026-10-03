#!/usr/bin/env bash
# Runs the end-to-end scenarios (scripts/e2e.js) against a generated test
# library, each with a fresh profile, under a virtual display if there's no
# real one. Fails if any scenario fails or logs renderer errors.
#
#   scripts/run-e2e.sh [scenario ...]      default: tour media screens motion spotify itunes
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="${E2E_DIR:-$PWD/.e2e}"
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(tour media screens motion spotify itunes)

[ -f "$WORK/profile/state.json" ] || scripts/make-test-library.sh "$WORK" > /dev/null
# Electron downloads its binary the first time it's required, and says so on
# stdout, so fetch it first and only then read its path.
node -e "require('electron')" > /dev/null
ELECTRON="$(node -p "require('electron')")"
# Software WebGL so the 3D body is exercised on machines without a GPU.
FLAGS=(--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader)
RUN=()
if [ -z "${DISPLAY:-}" ] && command -v xvfb-run > /dev/null; then RUN=(xvfb-run -a -s "-screen 0 1280x1024x24"); fi

failed=0
for s in "${SCENARIOS[@]}"; do
  profile="$WORK/run-$s"
  rm -rf "$profile" "$WORK/shots-$s"
  mkdir -p "$profile"
  cp "$WORK/profile/state.json" "$profile/state.json"
  steps="$s"
  [ "$s" = tour ] && steps=
  echo "▶ $s"
  if IPOD_E2E=scripts/e2e.js IPOD_E2E_STEPS="$steps" IPOD_SHOTS="$WORK/shots-$s" IPOD_USER_DATA="$profile" \
    timeout 600 "${RUN[@]}" "$ELECTRON" "${FLAGS[@]}" . > "$WORK/$s.log" 2>&1; then
    grep -E "E2E done" "$WORK/$s.log" || true
  else
    failed=1
    echo "✗ $s failed:"
    grep -vE "dbus|Fontconfig|GPU stall|gl_utils" "$WORK/$s.log" | tail -25
  fi
done
exit $failed
