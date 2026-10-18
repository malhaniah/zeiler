---
name: zeiler-feature
description: How to build a feature in the Zeiler repo end to end — read the plan, split the work into tracks, implement to house conventions (settings, IPC, both player backends), smoke-test the UI in a browser with mocked IPC, run adversarial reviews with refuters, pass every gate CI runs, update the docs, and open a PR from the repo's template that says what was and wasn't verified. Use this whenever the user asks for new behaviour in Zeiler — a player control, a setting, a screen, a command, "let me do X", "add Y", several features at once, the optional M14, or anything after the plan — even if they don't say "feature". Not for a bug with a known symptom (use zeiler-fix) or for merging and publishing (use zeiler-release).
---

# Building a feature in Zeiler

Zeiler is a Tauri 2 + React/TypeScript desktop client for Stremio addons. The Rust
workspace lives in `crates/` (`zeiler-player`, `-engine`, `-addon`, `-streams`, `-skip`,
`-sync`, `-iptv`, `-account`) and `src-tauri/`, and the UI in `src/`. Quality here comes
from a loop. Each step catches something the one before it misses, so don't skip any of
them because the change looks small: a skipped smoke test or review is usually where
the regression comes from.

## 1. Know the ground before writing code

- Read `docs/plan/HANDOFF.md`. It has the gates, the owner's standing decisions, what
  is shipped, "Not yet verified on a real machine" and the open findings.
  `docs/ARCHITECTURE.md` describes the IPC commands, events, settings schema, the
  Reserved key map and the privacy surface. `docs/plan/critique.md` and
  `docs/plan/specs/*.json` were the original plan, now fully built apart from M14.
  Their paths read `/home/user/sailor`, which means the repo root.
- See what's in flight: `git fetch origin && git log --oneline -10 origin/main`, and
  `gh pr list`. Another session may be editing the same files. If so, plan to rebase
  rather than race.
- Turn vague requests into concrete behaviour. When the user's wording contradicts
  itself, follow the most specific sentence, say which reading you took, and make it
  cheap to flip.
- Owner rules that are also review criteria:
  - Zeiler never ships or seeds a stream addon (a CI test enforces this).
  - Never run `cargo update` in a feature commit.
  - Never rotate the updater signing key.
  - Never create a repo named `sailor`.

## 2. Split the work when there's more than one piece

If the request is several independent features, run them as parallel tracks, each in
its own session and worktree, one PR per feature.

- Order by dependency. A feature that needs another one's types or IPC branches from
  that feature's branch, but **opens its PR against main** with the body starting
  "Stacked on #N". Its own change is the last commit.
- Each track's brief says: the files and area, what done looks like, the owner rules,
  "keep edits to shared files (Settings, `lib.rs` command registration, settings structs,
  Sidebar, HANDOFF.md) in small separate hunks", and "rebase onto origin/main before
  opening the PR; never merge".
- Merging is `zeiler-release`'s job, in dependency order.

## 3. Implement to the house conventions

- **Settings** (ARCHITECTURE "Settings schema"):
  - `settings.json` is additive only. A new key always has a default, and an existing
    key never changes name or type, so add a new key rather than reusing one.
  - Reads are per-field lenient, and `settings_groups.rs` merge-patches strictly at any
    depth.
  - Keep the Rust struct and `src/lib/types.ts` in step.
  - Settings are mirrored to the webview, so never put a secret in one. Secrets go in the
    keychain (`account/secrets.rs`).
  - Add the key to ARCHITECTURE's **Reserved key map**, in the "Per device" or "Per
    profile" row. A per-profile key also goes into `PROFILE_KEYS` in
    `src-tauri/src/profiles.rs` (bump the array length), or it's stored per device.
- **IPC:** a new `#[tauri::command]` goes in `generate_handler!` (`src-tauri/src/lib.rs`)
  and in ARCHITECTURE's command list. Events are emitted and subscribed under one name.
  Window APIs called from the UI need their permission in
  `src-tauri/capabilities/default.json`.
- **Player work** has two backends: built-in (`PlayerChrome.tsx`, libmpv on Windows and
  macOS) and external mpv (`ExternalRemote.tsx`). Both share `ControlsBar.tsx` and
  `usePlayerControls.ts`. Make a change for both, or say why it's for one.
- **Full-window screens** (the player, stream picker and profile picker) cover the Topbar,
  so they must draw `WindowControls` themselves.
- **New dependencies:** name them in the PR. They change `Cargo.lock`, so also run
  `cargo deny` (§6).
- **Comments** explain why, at the density of the surrounding code. Match the idioms of
  the file you're in.

## 4. Smoke-test the UI in a real browser

Unit tests don't catch a hover overlay that never appears or a click that lands on the
wrong button. For any UI change:

1. Make a page in a git-ignored `smoke.local/` folder (`*.local` is ignored). It renders
   the real components with `../src/index.css`. For screens that call Tauri, load a mock
   module first. It calls `mockWindows("main")` (from `@tauri-apps/api/mocks`) before any
   window API runs, and `mockIPC(handler, { shouldMockEvents: true })`, where the handler
   answers the app's commands and the `plugin:window|…` ones the screen uses (for
   example `is_fullscreen` and `is_maximized` returning false). It also `emit`s the
   events the screen listens to.
2. Serve it with Vite on a free port. Port 1420 is often taken by `tauri dev`, so use
   `npx vite --port 1440 --strictPort` through the browser pane's launch config.
3. Exercise it: hover, click each target, read the result. A small on-page click log
   makes routing checkable. Screenshot the states that matter.
4. Stop the preview server, then remove the launch entry you added (delete
   `.claude/launch.json` only if you created it). Leave nothing outside `smoke.local/`.

## 5. Review adversarially, then fix only what survives

Run independent reviewers with distinct lenses, ideally in parallel. For example:
correctness and behaviour preservation; spec, security and cross-platform; for UI,
accessibility and layout overlap. Give each finding to one or more refuters told to
default to "refuted" unless they can confirm it from the code. Fix the confirmed
findings, and list the dropped ones in the PR.

For anything touching Tauri, tao, wry or the Windows shell, have a reviewer read the
dependency's real source at the pinned version (`~/.cargo/registry/src/*/<crate>-<ver>/`,
with versions from `Cargo.lock`). Guessing at framework behaviour is how fixes break
fullscreen, drag regions or focus.

## 6. Pass every gate CI runs, after the last edit

Stop any dev or preview server before `npm ci`. On this Mac, Homebrew's rustup is
keg-only: put `/opt/homebrew/opt/rustup/bin` on `PATH` (Rust 1.99.0 comes from
`rust-toolchain.toml`).

```bash
npm ci && npm run build          # tauri::generate_context! needs ../dist
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
npm run typecheck
# embedded player (macOS: brew install mpv)
cargo clippy -p zeiler-player --features embedded --all-targets --locked -- -D warnings
LIBRARY_PATH="$(brew --prefix)/lib" cargo test -p zeiler-player --features embedded --locked
# macOS shell's render-API code, as CI's rust (macos-latest) runs it
ZEILER_SKIP_LIBMPV_CHECK=1 cargo clippy -p zeiler -p zeiler-player --all-targets --locked --features zeiler/embedded -- -D warnings
ZEILER_SKIP_LIBMPV_CHECK=1 LIBRARY_PATH="$(brew --prefix)/lib" cargo test -p zeiler --features embedded --locked
# real mpv + ffmpeg on PATH (ignored in CI)
cargo test -p zeiler-player --test external_mpv --locked -- --ignored
# only if Cargo.lock changed (cargo install cargo-deny), as CI's deny job runs it
cargo deny check --all-features --locked licenses sources
```

- **Windows-only Rust** can't be fully cross-checked here, because `ring` needs the
  Windows SDK headers. CI's required `rust (windows-latest)` check compiles it, in its
  "Clippy, embedded player and shell (Windows)" step. `windows-installer` builds it too.
  For a quick local compile, copy the module into a scratch crate **in the scratchpad,
  outside the repo, with its own `[workspace]`**. Pin
  `windows = { version = "=0.62.2", features = [the Win32_* features in the root Cargo.toml] }`
  and `tauri = "=2.12.4"` (versions from `Cargo.lock`), then run
  `cargo +1.99.0 clippy --target x86_64-pc-windows-msvc -- -D warnings`.
- **`website/`** has its own lockfile. If it changed, run
  `npm ci && npm test && npm run build` there, as `website.yml` does.

## 7. Update the docs in the same PR

- **`docs/plan/HANDOFF.md`:**
  - "Where things stand": an "In review" line for the PR, which the release turns into
    "Released as".
  - Add to "Not yet verified on a real machine" anything only exercised with mocks:
    real addons, a real Stremio account, another OS, runtime playback.
- **`docs/ARCHITECTURE.md`:** commands, events, settings keys and the Reserved key map,
  crates, privacy.
- **`README.md`:** only for user-visible capabilities, and never claim more than main has.

## 8. Commit and open the PR

- One commit per feature. The body says why: the user-visible problem, then what
  changed and how.
- End commits and PR descriptions with the attribution lines the session's
  system-reminder gives.
- Fill in the repo's `.github/PULL_REQUEST_TEMPLATE.md`. A body passed with
  `gh pr create --body-file` replaces the template, so copy its sections:
  - `## Why`.
  - `## What`: name any new dependency and say `cargo update` wasn't run; name any new
    settings key, IPC command or file format.
  - `## How it was verified`: tests, the smoke test, the reviews with their confirmed and
    dropped findings, and a "Not verified" list (for example, "not run on Windows: to
    check, do X and expect Y").
  - `## Gates run`: tick each one, including the embedded and macOS-shell gates.
  - `## For the owner to decide`, when a reading of the request needs the owner.
  - `## Checklist`: the no-content, lenient-parsing and no-URL-logging checks.
- Never merge, tag or run `release.yml` yourself. The owner says when, and then
  `zeiler-release` does it.
