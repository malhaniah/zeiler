#!/usr/bin/env bash
# Publish the version that is on origin/main and check the result:
#   1. wait for ci.yml to pass on origin/main's exact commit (and stop if main moves);
#   2. run release.yml on main (draft -> 4 builds -> publish gate);
#   3. verify: the release is public and Latest, and latest.json is for this version
#      with all ten platform entries, each signed.
# Only with the owner's go-ahead. Polling tolerates network blips (`gh run watch` doesn't).
#
#   release-and-verify.sh                  # release what's on main, then verify
#   VERIFY_ONLY=1 release-and-verify.sh    # only verify (e.g. after a re-run finished)
#   VERIFY_ONLY=1 VERSION=0.3.2 ...        # verify a given version
set -uo pipefail
REPO=${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
# keep in step with release.yml's publish job
PLATFORMS='darwin-aarch64 darwin-aarch64-app darwin-x86_64 darwin-x86_64-app linux-x86_64 linux-x86_64-appimage linux-x86_64-deb linux-x86_64-rpm windows-x86_64 windows-x86_64-nsis'

git fetch -q origin || exit 1
SHA=$(git rev-parse origin/main)
VERSION=${VERSION:-$(git show origin/main:Cargo.toml | awk '/^\[workspace\.package\]/{w=1;next} /^\[/{w=0} w&&/^version = "/{gsub(/version = |"/,"");print;exit}')}
TAG="v$VERSION"
echo "main $SHA, version $VERSION"

if [ -z "${VERIFY_ONLY:-}" ]; then
  if gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null | grep -q false; then
    echo "$TAG is already published: VERIFY_ONLY=1 $0 checks it; bump the version only to release again"
    exit 1
  fi

  echo "== waiting for ci.yml on $SHA"
  C=""
  for _ in $(seq 1 60); do
    C=$(gh run list --workflow ci.yml --branch main --limit 20 --json headSha,status,conclusion \
          --jq ".[] | select(.headSha==\"$SHA\") | .status + \" \" + (.conclusion // \"\")" 2>/dev/null | head -1)
    case "$C" in
      "completed success") break ;;
      completed*) echo "main's ci: $C; not releasing"; exit 1 ;;
    esac
    sleep 60
  done
  [ "$C" = "completed success" ] || { echo "main's ci did not finish ($C)"; exit 1; }

  # the newest release run before ours, so ours is told apart from earlier attempts
  BEFORE=$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0' 2>/dev/null || echo 0)
  git fetch -q origin
  [ "$(git rev-parse origin/main)" = "$SHA" ] || { echo "main moved past the checked $SHA; rerun"; exit 1; }
  echo "== running release.yml on main"
  gh workflow run release.yml --ref main || exit 1
  RUN=""
  for _ in $(seq 1 30); do
    sleep 10
    RUN=$(gh run list --workflow release.yml --limit 5 --json databaseId,event \
            --jq "[.[] | select(.event==\"workflow_dispatch\" and .databaseId > $BEFORE)] | last | .databaseId // empty" 2>/dev/null)
    [ -n "$RUN" ] && break
  done
  [ -n "$RUN" ] || { echo "the release run did not appear"; exit 1; }
  RSHA=$(gh run view "$RUN" --json headSha --jq .headSha)
  echo "https://github.com/$REPO/actions/runs/$RUN"
  if [ "$RSHA" != "$SHA" ]; then
    echo "the run builds $RSHA, not the CI-checked $SHA (main moved): ask the owner whether to cancel it (gh run cancel $RUN)"
    exit 1
  fi
  for _ in $(seq 1 120); do   # builds take ~25 min
    [ "$(gh run view "$RUN" --json status --jq .status 2>/dev/null)" = completed ] && break
    sleep 60
  done
  gh run view "$RUN" --json conclusion,jobs --jq '"conclusion: " + .conclusion, (.jobs[] | "  \(.name)\t\(.conclusion)")'
fi

echo "== verifying $TAG"
gh release view "$TAG" --json isDraft,isPrerelease,url,assets \
  --jq '"draft=\(.isDraft) prerelease=\(.isPrerelease) assets=\(.assets|length) \(.url)"' || exit 1
latest=$(gh api "repos/$REPO/releases/latest" --jq .tag_name)
echo "releases/latest: $latest"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
gh release download "$TAG" -p latest.json -D "$TMP" >/dev/null 2>&1 || { echo "no latest.json on $TAG"; exit 1; }
python3 -I - "$TMP/latest.json" "$VERSION" "$PLATFORMS" "$latest" "$TAG" <<'EOF'
import json, sys
path, version, platforms, latest, tag = sys.argv[1:]
d = json.load(open(path)); p = d.get("platforms", {})
missing = [k for k in platforms.split() if k not in p]
unsigned = [k for k in platforms.split() if k in p and not p[k].get("signature")]
ok = d.get("version") == version and not missing and not unsigned and latest == tag
print(f"latest.json version={d.get('version')} platforms={len(p)} missing={missing or 'none'} unsigned={unsigned or 'none'}")
print("VERIFIED" if ok else "NOT VERIFIED")
sys.exit(0 if ok else 1)
EOF
