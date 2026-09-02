#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.codex/run"
PID_FILE="$RUN_DIR/niuma-desktop.pid"
LOG_FILE="$RUN_DIR/desktop.log"
PACKAGED_APP="$ROOT_DIR/apps/desktop/dist/mac-arm64/牛马办公.app"
PACKAGED_BIN="$PACKAGED_APP/Contents/MacOS/牛马办公"

mkdir -p "$RUN_DIR"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(tr -cd '0-9' < "$PID_FILE")"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.2
    done
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT_DIR"
npm run build:desktop
npm --workspace @niuma/desktop run package:mac-dir

launch_app() {
  : > "$LOG_FILE"
  /usr/bin/open -n "$PACKAGED_APP"
  sleep 1
  APP_PID="$(pgrep -n -f "$PACKAGED_BIN" || true)"
  if [[ -z "$APP_PID" ]]; then
    echo "牛马办公启动失败。" >&2
    exit 1
  fi
  printf '%s\n' "$APP_PID" > "$PID_FILE"
}

case "$MODE" in
  run)
    launch_app
    ;;
  --debug|debug)
    exec lldb -- "$PACKAGED_BIN"
    ;;
  --logs|logs)
    launch_app
    exec /usr/bin/log stream --info --style compact --predicate 'process == "牛马办公"'
    ;;
  --telemetry|telemetry)
    launch_app
    exec /usr/bin/log stream --info --style compact --predicate 'process == "牛马办公"'
    ;;
  --verify|verify)
    launch_app
    sleep 2
    APP_PID="$(tr -cd '0-9' < "$PID_FILE")"
    kill -0 "$APP_PID"
    echo "牛马办公已启动，进程 $APP_PID 正常运行。"
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
