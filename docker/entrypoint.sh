#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "The development container must start as root to prepare its cache volumes." >&2
    exit 1
fi

for file in package.json package-lock.json Cargo.toml src-tauri/tauri.conf.json; do
    if [ ! -f "/workspace/$file" ]; then
        echo "Missing /workspace/$file; mount the Zeiler repository at /workspace." >&2
        exit 1
    fi
done

source_uid=$(stat -c '%u' /workspace)
source_gid=$(stat -c '%g' /workspace)
PUID=${PUID:-$source_uid}
PGID=${PGID:-$source_gid}

case "$PUID" in
    ''|*[!0-9]*) echo "PUID must be a numeric user ID." >&2; exit 1 ;;
esac
case "$PGID" in
    ''|*[!0-9]*) echo "PGID must be a numeric group ID." >&2; exit 1 ;;
esac

# Docker Desktop and Colima commonly present macOS bind mounts as root-owned.
if [ "$PUID" -eq 0 ]; then PUID=1000; fi
if [ "$PGID" -eq 0 ]; then PGID=1000; fi

if ! getent group "$PGID" >/dev/null; then
    groupmod --gid "$PGID" zeiler
fi
usermod --non-unique --uid "$PUID" --gid "$PGID" zeiler

ensure_owner() {
    local path=$1
    mkdir -p "$path"
    if [ "$(stat -c '%u:%g' "$path")" != "$PUID:$PGID" ]; then
        chown -R "$PUID:$PGID" "$path"
    fi
}

ensure_owner /home/zeiler
ensure_owner /home/zeiler/.npm
ensure_owner /usr/local/cargo
ensure_owner /usr/local/cargo/registry
ensure_owner /usr/local/cargo/git
ensure_owner /workspace/node_modules
ensure_owner /workspace/target

install -d -m 0700 -o "$PUID" -g "$PGID" /tmp/runtime-zeiler

export HOME=/home/zeiler
export USER=zeiler
export LOGNAME=zeiler
export XDG_RUNTIME_DIR=/tmp/runtime-zeiler

exec gosu zeiler /usr/local/bin/zeiler-start-dev
