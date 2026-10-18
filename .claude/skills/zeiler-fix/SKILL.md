---
name: zeiler-fix
description: How to fix an issue in the Zeiler repo — turn the report (a screenshot, "X doesn't work on Windows", a white page, a failing check, a security alert) into a measured symptom, trace it through the UI, IPC, Rust shell, workspace crates and the pinned Tauri/tao/wry sources (or the repo's hosting settings), check whether upstream already fixed it, fix it at the right layer with the smallest change, try to break the fix with adversarial reviewers, and open a PR that names the root cause and what wasn't tried. Use this whenever the user reports a bug, glitch, regression, broken page, failing CI or alert in Zeiler or its website, even if they only send a screenshot or say "this is weird". Not for new behaviour (use zeiler-feature) or for releasing (use zeiler-release).
---

# Fixing an issue in Zeiler

A fix is only as good as its diagnosis. The cheap fix, such as patching the symptom or
reverting something plausible, often moves the bug or adds two new ones. Work from
evidence to cause to the right layer, and prove each step.

## 1. Turn the report into a measured symptom

- **Screenshots:** measure, on a copy. `sips -s format png <shot> --out
  <scratchpad>/shot.png`. Without `--out`, sips overwrites the user's file. Compute extents
  with a short script: where the content starts and ends, what's black, what's clickable.
  The image may be downscaled, so convert to the screen's physical pixels before doing the
  arithmetic.

  Example from this repo: 33 px side bars and a 37 px bottom strip, at about 0.77× of a
  2560×1440 screen, are 43 and 48 px. That's exactly a 2560×1392 client area, the screen
  minus a 48 px taskbar, with 16:9 video letterboxed into it. The numbers named the cause
  before any code was read.
- **"It doesn't work":** find what exactly happens. Can it not be clicked, is it not
  drawn, or is it covered by another layer? Which screen, which OS, which backend
  (built-in or external mpv)?
- **Web or hosting:** check the live configuration, not just the code. With
  `gh api repos/<owner>/<repo>/pages`, read `build_type` first: `legacy` serves a branch
  and path (`source`); `workflow` means GitHub Actions (`website.yml`), and `source` is
  then ignored. `curl -sSL` the URL and look at what's actually served.
- **CI or security alerts:**
  - `gh pr checks <N>` or `gh run list --branch <branch>`, then
    `gh run view <run-id> --log-failed`. The run id is required: Claude's shell isn't
    interactive.
  - Alerts: `gh api 'repos/<owner>/<repo>/code-scanning/alerts?ref=refs/pull/N/head'`
    (quote any URL with `?`, or zsh treats it as a glob) and
    `gh api repos/<owner>/<repo>/dependabot/alerts`.

## 2. Trace the cause through every layer

Go from where the symptom shows to where it's produced:

1. the React component;
2. its IPC call. The calls live in `src/lib/ipc.ts`, `src/lib/*-ipc.ts` and
   `src/lib/iptv.ts`; `grep -rn 'invoke[<(]' src` finds them. Window actions go straight
   to `@tauri-apps/api/window` and need a permission in
   `src-tauri/capabilities/default.json`;
3. the `#[tauri::command]` and the shell (`src-tauri/src/...`);
4. the workspace crate (`crates/zeiler-*`);
5. the dependency, read at its pinned version: `grep -A1 '^name = "tao"$' Cargo.lock`,
   then `~/.cargo/registry/src/*/tao-<ver>/`.

Quote the exact lines that cause the bug (file:line). If you can't point at them, the
diagnosis isn't done.

For "can't click X" or "X is hidden", find every layer that can cover it:
`grep -rn 'inset-0' src` (both `fixed` and `absolute`, such as the stream picker's
`absolute inset-0 z-50`). Compare z-indexes (the Topbar is `z-[55]`), and check what
`App.tsx` renders conditionally.

## 3. Check upstream before writing a fix

If the cause is in a dependency, look for an upstream fix:
`gh api 'repos/<org>/<repo>/commits?path=<file>'` and
`gh api repos/<org>/<repo>/compare/<released-tag>...<default-branch>`. If it's fixed but
not released, reimplement the upstream behaviour locally and link to it, rather than
pinning the dependency to a git commit. A git pin changes `Cargo.lock`, adds a git source
to the deny and licence checks, and is the owner's call, not a bug fix's. If you copy
upstream code rather than reimplementing it, credit it in `THIRD-PARTY-NOTICES.md`. Write
down when the local copy can go: "remove with a tao release that has #1353".

## 4. Pick the layer and the smallest fix

List the options with their side effects before choosing. A workaround that changes
state elsewhere usually costs more than it fixes. For example, "un-maximize before
fullscreen" flickered and raced on fast toggles, while a narrow `WM_NCCALCSIZE` subclass,
mirroring upstream, changed nothing else. Prefer:

- the layer where the bug is, not where it shows;
- no new persistent state and no new permissions unless needed;
- a fail-safe default. For example, a CI gate that skips work only on an explicit
  "docs only" answer, and runs everything on any doubt.

Fix the issue you were given. Real problems found on the way go in the PR's "Found along
the way" section, or into their own session, not into this diff.

## 5. Try to break the fix

Run two or three reviewers with distinct lenses, for example: platform mechanics
(message order, threads, what the dependency really does), edge cases (fast toggles,
minimized or fullscreen, unmount mid-call, other screens), and permissions, build and
docs. They should try to refute that the fix works, reading the pinned sources. Fix what
they confirm. If a better design comes out of the review, switch to it.

## 6. Prove it as far as this machine can

- The relevant gates from `zeiler-feature` §6, after the last edit.
- **Windows-only code:** CI's required `rust (windows-latest)` check compiles it, in its
  "Clippy, embedded player and shell (Windows)" step. For a local compile, use a scratch
  crate in the scratchpad (outside the repo, with its own `[workspace]`), pinning
  `windows = "=0.62.2"` (with the root Cargo.toml's Win32 features) and
  `tauri = "=2.12.4"`. Put `/opt/homebrew/opt/rustup/bin` on `PATH`, then run
  `cargo +1.99.0 clippy --target x86_64-pc-windows-msvc -- -D warnings`.
- **UI:** the browser smoke test from `zeiler-feature` §4.
- **Website:** `cd website && npm ci && npm test && npm run build`, then inspect
  `website/dist/`. (The root `dist/` is the desktop app's build.) `website.yml` deploys on
  the owner's merge to main. Afterwards, `curl -sSL` the live site.
- Say plainly what couldn't be run. For example: "not tried on Windows: to check,
  maximize, play, press f; the video should fill the screen."

## 7. Record it and open the PR

- **`docs/plan/HANDOFF.md`:** add the item to "Not yet verified on a real machine" if it
  couldn't be run, and note any workaround with its removal condition.
- **`docs/ARCHITECTURE.md`:** describe the behaviour if it changed.
- **Commit body:** the symptom, the root cause (file:line in our code or the dependency),
  the fix, and why not the alternatives.
- **PR body:** start from `.github/PULL_REQUEST_TEMPLATE.md` (Why, What, How it was
  verified, Gates run, Checklist). A `--body-file` replaces the template, so copy those
  sections. Add **Alternatives considered**, **Not tried** and **Found along the way**.
- **Repository settings:** if the fix needs one changed (Pages source, Enforce HTTPS, an
  alert dismissal), say exactly which, and change it only with the owner's go-ahead.
- Never merge or release without the owner. Hand off to `zeiler-release` when they say so.
