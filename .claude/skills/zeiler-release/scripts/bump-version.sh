#!/usr/bin/env bash
# Bump Zeiler to a new version in every place that carries it: the workspace version in
# Cargo.toml, every workspace crate in Cargo.lock (the packages with no `source` line;
# no dependency moves, so no `cargo update`), and package.json + package-lock.json.
# Run from the repo root on a fresh branch off origin/main. Commits nothing.
#
#   bump-version.sh 0.3.3
set -euo pipefail
new=${1:?usage: $0 X.Y.Z}
[[ $new =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a version: $new"; exit 1; }
[ -f Cargo.toml ] && [ -f Cargo.lock ] && [ -f package.json ] || { echo "run from the repo root"; exit 1; }

old=$(awk '/^\[workspace\.package\]/{w=1;next} /^\[/{w=0} w&&/^version = "/{gsub(/version = |"/,"");print;exit}' Cargo.toml)
[ -n "$old" ] || { echo "no [workspace.package] version in Cargo.toml"; exit 1; }
[ "$old" != "$new" ] || { echo "already $new"; exit 1; }
echo "bumping $old -> $new"

python3 -I - "$old" "$new" <<'EOF'
import re, sys
old, new = sys.argv[1], sys.argv[2]

# Cargo.toml: the version under [workspace.package] only
p = "Cargo.toml"; s = open(p).read()
s2, n = re.subn(r'(\[workspace\.package\][^\[]*?^version = )"' + re.escape(old) + '"',
                r'\g<1>"' + new + '"', s, count=1, flags=re.M | re.S)
assert n == 1, "Cargo.toml: workspace version not found"
open(p, "w").write(s2)

# Cargo.lock: workspace members are the packages without a `source` line
p = "Cargo.lock"; s = open(p).read()
blocks = s.split("\n[[package]]\n")
bumped = []
for i, b in enumerate(blocks):
    m = re.match(r'name = "([^"]+)"\nversion = "' + re.escape(old) + '"\n', b)
    if m and "\nsource = " not in b:
        blocks[i] = b.replace(f'version = "{old}"', f'version = "{new}"', 1)
        bumped.append(m.group(1))
assert bumped, "Cargo.lock: no workspace crate at the old version"
open(p, "w").write("\n[[package]]\n".join(blocks))
print("Cargo.lock workspace crates:", ", ".join(bumped))
EOF

npm version "$new" --no-git-tag-version >/dev/null

# the lockfile diff must be version lines of workspace crates only
bad=$(git diff -U0 Cargo.lock | grep -E '^[-+][^-+]' | grep -vE '^[-+]version = "' || true)
[ -z "$bad" ] || { echo "unexpected Cargo.lock changes:"; echo "$bad"; exit 1; }
git diff --stat
echo "next: add a HANDOFF.md 'Where things stand' line listing every PR in $new, commit, open the PR"
