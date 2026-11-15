#!/usr/bin/env bash
set -euo pipefail

app_pid=
desktop_pids=

cleanup() {
    status=$?
    trap - EXIT INT TERM
    set +e

    if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
        kill -TERM -- "-$app_pid" 2>/dev/null
    fi
    for pid in $desktop_pids; do
        kill -TERM "$pid" 2>/dev/null
    done
    wait
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

Xtigervnc "$DISPLAY" -geometry "${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}" -depth 24 \
    -nolisten tcp -ac -SecurityTypes None -localhost yes -rfbport 5900 \
    -AlwaysShared -noreset &
desktop_pids="$!"

for _ in $(seq 1 50); do
    if [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; then break; fi
    if ! kill -0 "$desktop_pids" 2>/dev/null; then
        echo "Xtigervnc stopped before creating its display socket." >&2
        exit 1
    fi
    sleep 0.1
done
if [ ! -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; then
    echo "Xtigervnc did not create its display socket in time." >&2
    exit 1
fi

openbox --sm-disable &
desktop_pids="$desktop_pids $!"

websockify --web /usr/share/novnc --heartbeat 30 0.0.0.0:6080 localhost:5900 &
desktop_pids="$desktop_pids $!"

lock_hash=$(sha256sum package-lock.json | cut -d ' ' -f 1)
lock_marker=node_modules/.package-lock.sha256
if [ ! -x node_modules/.bin/tauri ] || [ ! -f "$lock_marker" ] \
    || [ "$(cat "$lock_marker")" != "$lock_hash" ]; then
    npm ci --no-audit --no-fund
    printf '%s\n' "$lock_hash" > "$lock_marker"
fi

printf '\nZeiler desktop: http://localhost:6080\n'
printf 'Vite is available to Tauri inside the container at http://localhost:1420.\n\n'

setsid dbus-run-session -- npm run tauri -- dev &
app_pid=$!
wait "$app_pid"
