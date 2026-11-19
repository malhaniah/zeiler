# Contributing to Zeiler

Thanks for considering a contribution! Zeiler is a free, open-source
(GPL-3.0-or-later) client for the Stremio addon ecosystem. Small, focused changes with
tests and a clear explanation are the easiest to review.

## The one rule that is not negotiable

**Zeiler hosts no media, indexes no media, and ships no content addon.**

Pull requests that add bundled/seeded stream addons, hardcoded stream or tracker hosts,
default content sources, scrapers, or anything that turns Zeiler itself into a content
source will be declined regardless of code quality. Features that help users manage
addons *they* choose to install are always welcome.

The opt-in addon directory (Addons → Browse) lists what third-party directories list,
labelled "not reviewed by Zeiler". Curated, featured, recommended or pre-selected
addons are declined there too: the only orderings are the directory's own stars, listing
date, or name, and every install goes through the confirmation dialog.

The single exception is metadata and subtitles. Zeiler builds in Cinemeta (catalogs,
details, episode lists), Anime Kitsu (anime catalogs and details) and OpenSubtitles v3
(subtitles), and users can turn each one off in Settings → Content. Any built-in must be
**metadata or subtitles only, switchable, and never serve streams**. The tests in
`src-tauri/src/builtin.rs` fail if a built-in's manifest declares a `stream` resource or
anything other than catalogs (of titles or of addons), details and subtitles; each
built-in is also trimmed to the resources of its role, and streams embedded in a
built-in's details are dropped. Their manifests are snapshots compiled into the app;
refresh them with `node scripts/refresh-builtin-manifests.mjs`.

## Quickstart: the full app in Docker

Docker is the easiest way to run the real Zeiler app without installing the native
Rust/Tauri toolchain on your host. You need Docker with Compose v2 (Docker Engine or
Docker Desktop); Git, Node.js and Rust are not required on the host.

From the repository root:

```bash
docker compose up --build
```

The image build installs system packages and Rust. The first container start runs `npm ci`
and compiles the Tauri app, so it can take a while. When the virtual desktop is ready, open
**http://localhost:6080** in your browser. This is a noVNC view of the Linux Tauri app on a
TigerVNC virtual desktop, not the limited browser WebShell. If noVNC asks for a password,
copy the `VNC password:` value printed by Compose or shown by `docker compose logs zeiler`;
a new password is generated each time the container starts.

Leave Compose running while you work:

- Edit the mounted source checkout with your usual editor. Frontend changes reload through
  Vite; Rust changes trigger a Tauri rebuild and app restart. Recompiles can take time.
- Run `docker compose restart` after `package-lock.json` changes so the entrypoint runs
  `npm ci` again. After `Dockerfile`, `compose.yaml` or `docker/` startup changes, rebuild
  and recreate the container with `docker compose up --build`; these files are not hot-reloaded.
- Linux playback launches **external mpv inside the container**, with its window in the same
  virtual desktop. Rendering uses software OpenGL. No audio forwarding is configured:
  noVNC carries the display, not sound.
- Stop the app and remove the container with `docker compose down`. Your checkout remains
  on the host, but container settings and profiles do not survive `down`.

Named volumes preserve only dependency and build caches across `up` and `down`, making later
starts faster. To delete those named caches and install/compile again, run:

```bash
docker compose down --volumes
docker compose up --build
```

This does not delete your source checkout or Docker's image-build cache.

### Docker scope and safety

- The entrypoint starts as root only to prepare file ownership, then runs the desktop and app
  as the unprivileged `zeiler` user. It matches the checkout's UID/GID; set numeric `PUID`
  and `PGID` environment variables to override them. Root IDs (`0`) fall back to `1000`.
- The container validates the **Linux Tauri shell and external-mpv path**. It does not
  validate Windows/macOS embedded libmpv playback, native installers, host GPU/audio
  behavior, or Android. Test those changes on the relevant host or device as well.
- The development display uses a random VNC password printed to the container logs, but its
  HTTP/VNC connection is unencrypted. Compose binds it to host loopback only
  (`127.0.0.1:6080`); do not expose it to a shared or public network, share its logs, or
  enter real credentials into a shared session.
- Use the virtual desktop rather than a Vite URL for end-to-end checks: `npm run dev` alone
  serves only the limited WebShell and cannot exercise Tauri IPC, the Rust engine or mpv.

## Host-native setup

Use a host-native setup for platform-specific work, releases and embedded playback.
Prerequisites:

- **Rust 1.99.0**, as pinned in [rust-toolchain.toml](rust-toolchain.toml) (MSVC on Windows)
- **Node.js 22.12 or newer**; CI uses Node.js 24
- The [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
- **mpv** on your PATH for Linux playback, or configure its location in Settings
  (<https://mpv.io>); the app runs without it but cannot play video on Linux

On Ubuntu 24.04, the native build and test dependencies match CI:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils \
  libmpv-dev libdbus-1-dev pkg-config mpv
```

Then install the locked frontend dependencies and start Tauri:

```bash
npm ci
npm run tauri dev
```

Use `npm ci` again after `package-lock.json` changes. Do not commit `node_modules`,
`target` or generated libmpv downloads.

## Everyday development

1. Keep the app running and make a small change. Check both the UI and any affected Rust
   behavior; a frontend-only browser check is not enough for Tauri functionality.
2. Run a focused test while iterating, for example:

   ```bash
   cargo test -p zeiler-addon
   cargo test -p zeiler-player
   npm run typecheck
   ```

3. Exercise the changed flow manually, including playback when relevant. Note the platform
   and backend you tested.
4. Run the full quality gates before opening or updating a PR. Run them in your native
   development shell or inside the same container environment used for the change.

Protocol and domain crates are independent of Tauri, so most Rust logic can be tested with
plain `cargo test` without opening a window. Live public-addon tests are opt-in because
they use the network and third-party services:

```bash
cargo test -p zeiler-addon --test live -- --ignored
```

## Quality gates

CI enforces formatting, linting, tests, frontend types and a production frontend build. On
a clean checkout, build the frontend before Rust checks because `tauri::generate_context!`
expects `dist` to exist:

```bash
npm ci
npm run typecheck
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

CI also checks dependency licenses and sources, lints and tests the `embedded` player, and
builds a Windows installer with built-in playback for every pull request. See
[.github/workflows/ci.yml](.github/workflows/ci.yml) for the exact platform matrix.

## Pull requests

- **Keep the change focused.** Separate refactors from behavior changes and avoid unrelated
  cleanup.
- **Bring tests.** Protocol/engine changes need unit tests; parsing changes need a fixture
  that mirrors real addon output (see `crates/zeiler-addon/src/*` test modules). Update
  existing tests and documentation when behavior changes.
- **Describe verification.** List the commands run and manual flows checked, including the
  OS and playback backend. Add screenshots or a short recording for visible UI changes.
- **Be lenient in, strict out.** Addon responses are untrusted, messy JSON: parsing must
  degrade gracefully, never panic, and ignore unknown fields. IPC payloads, URLs and other
  values Zeiler emits must be exact.
- **Preserve the security posture.** All addon HTTP stays in Rust; URLs handed to the player
  or OS are scheme-allow-listed; addon transport URLs may embed credentials and must never
  be logged.
- **Follow the existing UI.** Use the design tokens in `src/index.css` and established
  component recipes; keep the Harbor-derived class vocabulary rather than inventing a
  parallel style system.
- **Keep secrets and local state out of Git.** This includes account/addon credentials,
  signing keys, service-account files, container data and dependency/build caches.
- **Write useful commits.** Use the imperative mood and explain *why* in the body when it is
  not obvious. Make sure required CI checks pass before requesting review.

## Where things live

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing load-bearing behavior.

| Path | What it is |
| --- | --- |
| `crates/zeiler-account` | Library items, playback-progress rules and the watched bitfield (pure, no I/O) |
| `crates/zeiler-addon` | Stremio addon-protocol client: types, URL building and fan-out |
| `crates/zeiler-engine` | Embedded librqbit torrent engine and loopback stream endpoint |
| `crates/zeiler-iptv` | M3U, Xtream Codes and XMLTV parsing/fetching |
| `crates/zeiler-player` | Playback sessions: external mpv JSON IPC and optional embedded libmpv |
| `crates/zeiler-skip` | Skip-segment rules and AniSkip/TheIntroDB integration |
| `crates/zeiler-streams` | Stream selection and quality/source logic |
| `crates/zeiler-sync` | Opt-in Stremio account API client and pure sync rules |
| `src-tauri/` | Tauri 2 shell: typed IPC commands, state, capabilities and config |
| `src-tauri/gen/android/` | Android project and Kotlin plugins, including Media3 playback |
| `src/` | React/TypeScript frontend |
| `scripts/` | Build, licensing, manifest and release utilities |
| `docs/ARCHITECTURE.md` | Architecture and load-bearing design decisions |
| `website/` | Separate static Vite download site; see `website/README.md` |

## Built-in playback (Windows, macOS)

Built-in playback (libmpv in-process, video under the webview) is the `embedded` Cargo
feature. Windows and macOS release builds enable it; plain `npm run tauri dev` builds leave
it off and play through external mpv. Linux always uses external mpv
(`src-tauri/src/commands/mpv/linux.rs`), including in Docker.

To work on embedded playback on Windows:

```powershell
node scripts/fetch-libmpv.mjs      # once: pinned libmpv-2.dll + mpv.lib into src-tauri/libmpv
npm run tauri dev -- --features embedded
npm run tauri build -- --features embedded --config src-tauri/tauri.embedded.conf.json
```

The fetch script downloads the hash-pinned LGPL libmpv build (see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)), writes `mpv.def` from the DLL's exports
and generates the `mpv.lib` import library with MSVC's `lib.exe` (found on PATH or through
vswhere). It does nothing on other systems. `src-tauri/tauri.embedded.conf.json` bundles
the DLL and its NOTICE into the installer.

`cargo check` and `clippy` with the feature never link, so `ZEILER_SKIP_LIBMPV_CHECK=1` lets
them run before the fetch. Tests of the player crate do link libmpv:

```bash
# Linux: needs libmpv-dev (mpv ≥ 0.35, client API 2.x)
cargo test -p zeiler-player --features embedded
```

```powershell
# Windows: put the vendored libmpv on the linker path (LIB) and the DLL on PATH
$env:LIB = "$PWD\src-tauri\libmpv;$env:LIB"; $env:PATH = "$PWD\src-tauri\libmpv;$env:PATH"
cargo test -p zeiler-player --features embedded
```

```bash
# macOS: Homebrew's libmpv for the player crate's tests
brew install mpv
LIBRARY_PATH="$(brew --prefix)/lib" cargo test -p zeiler-player --features embedded
```

These tests run headless: no window or audio device is needed.

On macOS, the app itself (`npm run tauri dev -- --features embedded`, or a bundle) links the
libmpv Zeiler ships, not Homebrew's. `node scripts/fetch-libmpv.mjs` puts the pinned build
for your Mac's architecture (or `--arch arm64|x86_64`) in
`src-tauri/libmpv-macos/<arch>/`, with a `tauri.conf.json` overlay that bundles it under
`Contents/Frameworks`:

```bash
node scripts/fetch-libmpv.mjs
npm run tauri build -- --features embedded --config src-tauri/libmpv-macos/arm64/tauri.conf.json
scripts/check-macos-app.sh target/release/bundle/macos/Zeiler.app
```

That build comes from pinned sources (`scripts/build-libmpv-macos.sh`, run by the
`libmpv-macos` workflow; it needs `brew install meson ninja pkgconf nasm` to run locally),
mirrored on a `libmpv-macos-<version>` pre-release with its sources.

## Android

Android is outside the Docker workflow. Install a JDK, Android SDK/NDK and the Rust targets,
then use the host-native setup:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi
npm run tauri android init --ci
node scripts/third-party-licenses.mjs --target aarch64-linux-android --features tauri/custom-protocol
npm run tauri android build --target aarch64 armv7 --apk --aab
```

Set `ANDROID_HOME` and `NDK_HOME` for your installation and test on a phone/TV emulator or
physical device. Android playback uses Media3 in `src-tauri/gen/android` and
`src-tauri/src/commands/mpv/android.rs`, not desktop libmpv/mpv.

Release signing reads `src-tauri/gen/android/keystore.properties` or the `ZEILER_ANDROID_*`
environment variables. Tagged GitHub releases build and upload both the universal APK and AAB;
they require `ZEILER_ANDROID_KEYSTORE_BASE64`, `ZEILER_ANDROID_KEYSTORE_PASSWORD`,
`ZEILER_ANDROID_KEY_ALIAS` and `ZEILER_ANDROID_KEY_PASSWORD` repository secrets. Never commit
the real properties, keystore or Play service-account JSON. See
[README.md](README.md#building-from-source) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for packaging and platform details.

## Licensing

By contributing you agree that your contribution is licensed under
**GPL-3.0-or-later**, the project license. If you adapt code from elsewhere it must be
GPL-compatible and attributed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
(for example, MIT code keeps its copyright notice in the adapted file).

## Conduct

Be kind, be constructive, assume good faith. Maintainers may edit or decline contributions
that do not fit the project's principles or scope.
