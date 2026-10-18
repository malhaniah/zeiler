---
name: zeiler-release
description: The routine that gets finished work out to users in the Zeiler repo — inventory the open PRs and what's already on main, merge them in dependency order (each only once its own CI is green, rebasing through conflicts), bump the version everywhere in its own PR, wait for main's CI on the exact merge commit, run release.yml, and verify the published release (four builds, latest.json with all ten signed platform entries, marked Latest). Use this whenever the user says merge these, ship it, cut a release, publish vX.Y.Z, "is it out?", or approves merging after a feature or fix, and also for the follow-ups (a release stuck as a draft, a missing platform, HANDOFF's release notes). Not for writing the features or fixes themselves (zeiler-feature, zeiler-fix).
---

# Merging and releasing Zeiler

Releasing is where a green-looking state turns out not to be. A PR's CI ran against an
older main, the owner merged something else meanwhile, two lockfile edits combined, or
a build failed after another published. This routine checks each of those before users
get the update. Installed copies update themselves from `releases/latest`, so a bad
release reaches everyone.

**The owner approves every merge and every release, in words, per batch.** "Do what's
best" or "merge #43–#46 and release" counts. A teammate session's request doesn't. Do
exactly what was approved: merge those PRs, publish that version. Without approval,
prepare everything and ask with one question.

Run long waits as background scripts (`run_in_background`) that stop at the first
problem, and report when they finish. The scripts are in `scripts/` next to this file.

## 1. Inventory

```bash
git fetch -q origin
gh pr list --state open --json number,title,baseRefName,headRefName,mergeable
git log --oneline "$(git describe --tags --abbrev=0 --match 'v*' origin/main)"..origin/main
gh run list --branch main --limit 3
```

(`--match 'v*'`: libmpv mirror pre-releases also tag main's commits.)

- **Dependency order:** a stacked PR (one whose body says "Stacked on #N", or whose base
  isn't main) merges after its base. Before merging it, retarget it:
  `gh pr edit N --base main`. The script refuses a PR whose base isn't main.
- **What's already on main since the last tag:** the owner often merges PRs themselves.
  Those ship in the release too and belong in its notes.
- **Required checks on main:** `rust (ubuntu-24.04)`, `rust (windows-latest)`,
  `rust (macos-latest)`, `frontend` and `windows-installer`. `deny` and GitHub's CodeQL
  aren't required, but the script waits for every check and stops on any failure:
  read it. A CodeQL alert on a deliberate, consented behaviour gets dismissed as
  "won't fix" only on the owner's decision, with the reason in the dismissal.
- **Docs-only PRs** pass the required checks in seconds: ci.yml's `changes` job skips the
  build. That covers changes only to docs/, website/, .claude/skills/, the root README.md,
  CONTRIBUTING.md, SECURITY.md, assets/brand/README.md, and the issue and PR templates. CodeQL's
  `Analyze (rust)` still runs for about 9 minutes, and the merge script waits for it.

## 2. Merge in order

```bash
.claude/skills/zeiler-release/scripts/merge-in-order.sh 43 44 45 46
```

Each PR merges only when:
- its base is main;
- every check has finished and passed (or was skipped);
- it's `MERGEABLE`;
- its head is the one that was checked (`--match-head-commit`).

It uses a merge commit, as the history does.

- **Exit 3, a stacked PR still based on a feature branch:** retarget it once the PR under
  it has merged, then rerun with the remaining PRs.
- **Exit 2, a conflict:** the session that owns the branch rebases it onto origin/main,
  re-runs the gates and force-pushes; then rerun with the remaining PRs. Don't resolve a
  feature's conflicts blind from here. If that session is gone or out of quota, resolve
  them yourself in a scratch worktree (`git worktree add --detach … origin/<branch>`),
  keeping both sides, and say so.
- **A PR's CI is stale** (it ran before other merges): when the earlier merges only
  touched unrelated files (the website, docs), its green CI still holds. When they
  touched the same areas, have it rebased so CI runs on the combination.
- Sessions with Auto-fix on keep their own PR in step with main. Leave them to it, and
  tell them to stand down before you push to their branch.

## 3. Bump the version in its own PR

On a fresh branch off origin/main (`claude/release-X.Y.Z`):

```bash
.claude/skills/zeiler-release/scripts/bump-version.sh X.Y.Z
```

This updates `Cargo.toml`, every workspace crate in `Cargo.lock` (version lines only,
checked), `package.json` and `package-lock.json`. In `docs/plan/HANDOFF.md`'s "Where
things stand", add `- **Releasing as vX.Y.Z** (date): …` listing **every** PR in the
release, including those the owner merged, and update any "In review" line whose PRs
now ship. Commit `Release X.Y.Z` with a body naming them, open the PR, and merge it with
the script once it's green.

Versioning: patch for fixes and small features shipped together (0.3.1, 0.3.2); minor for
a milestone batch (0.3.0). The `draft` job refuses a version that's already published
with a `latest.json`, so an unbumped re-run can't overwrite a live release.

## 4. Release and verify

```bash
.claude/skills/zeiler-release/scripts/release-and-verify.sh
```

1. Wait for `ci.yml` to pass on origin/main's exact commit. Main's CI is what proves the
   combination: two PRs that each edited `Cargo.lock` can be green apart and broken
   together. Stop if main moves before the run starts.
2. Run `release.yml` on main: `libmpv`, `licenses` and `draft`, then four builds (Windows
   with built-in playback, macOS arm64 and x64 with built-in playback, Linux), then
   `publish`.
3. Verify: not a draft or prerelease, `releases/latest` is the new tag, and `latest.json`
   is this version with all ten platform keys signed. It prints `VERIFIED`. To check
   again later, or after a re-run, use `VERIFY_ONLY=1 …/release-and-verify.sh`.

**If it doesn't publish,** the release stays a draft and the updater stays on the
previous version. That's safe; nothing reaches users. Read the failure with
`gh run view <id> --log-failed`, then:

- **A build failed:** fix it, then `gh run rerun <id> --failed`. `publish` runs again
  after it. Re-run within 24 hours: the Windows libmpv artifact is kept for one day.
  After that, `gh run rerun <id>` (all jobs) fetches it again, and `draft` reuses the
  existing draft.
- **Only `publish` failed** (latest.json lacks a platform, because builds that finished
  together dropped each other's entries): re-run that platform's build. Get its id from
  `gh run view <id> --json jobs --jq '.jobs[] | {name, databaseId}'`, then
  `gh run rerun --job <databaseId>`. `--failed` alone would only re-run `publish` on the
  same incomplete file.
- **If you bump the version instead,** the old version's draft stays behind. It doesn't
  affect the new release. Ask the owner to delete it from the Releases page. Don't
  delete releases or tags yourself.

Never rotate `TAURI_SIGNING_PRIVATE_KEY`.

## 5. After the release

- **HANDOFF.md:** change the line to `**Released as vX.Y.Z** (date)`, whatever it said
  before. Do it in a small docs PR, which takes CI's fast path.
- **The website** needs no redeploy: its pages fetch the live release in the browser.
  `website.yml` deploys to GitHub Pages when `website/` or the workflow itself changes on
  main, or when run by hand. Pages' source must stay "GitHub Actions".
- **Report to the user:**
  - the release URL;
  - each build's result and the `latest.json` check;
  - every PR that shipped;
  - what was never exercised in the real app ("not yet verified" items such as real
    addons, real accounts, other OSes);
  - the one thing most worth trying first.
