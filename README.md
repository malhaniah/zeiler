<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/zeiler-logo-white.png">
    <img src="assets/brand/zeiler-logo-black.png" alt="" width="160" height="160">
  </picture>
</p>

<h1 align="center">Zeiler</h1>

<p align="center">A free, open-source client for the Stremio addon ecosystem, built with Rust and Tauri 2 for desktop, Android phones and Android TV.</p>

<p align="center">
  <a href="https://github.com/malhaniah/zeiler/releases/latest"><img src="https://img.shields.io/github/v/release/malhaniah/zeiler" alt="Latest release"></a>
  <a href="https://github.com/malhaniah/zeiler/actions/workflows/ci.yml"><img src="https://github.com/malhaniah/zeiler/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/malhaniah/zeiler" alt="License: GPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-555" alt="Platforms: Windows, macOS, Linux, Android">
</p>

Zeiler combines a built-in torrent streaming engine, native playback and a React interface.
It speaks the open [Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
without requiring a browser, Node runtime or external streaming server at runtime. Desktop
playback uses libmpv or external mpv; Android uses Media3. Zeiler is in early development.

> **Zeiler hosts no media, indexes no media, and ships no content addon.**
> You bring your own addons; Zeiler is just the boat.

Paste any addon manifest URL to install it. Optional built-in metadata and subtitle addons—Cinemeta,
Anime Kitsu and OpenSubtitles v3—provide catalogs, details, episode lists and subtitles, never streams.
Each can be turned off in **Settings → Content**.

## Download

Get the latest build from the **[Releases page](https://github.com/malhaniah/zeiler/releases/latest)**.

| Platform | Download | Playback |
| --- | --- | --- |
| Windows 10/11 | `Zeiler_*_x64-setup.exe` (per-user, no admin) | Built in; optional external mpv: `winget install shinchiro.mpv` |
| macOS 12+ (Apple Silicon) | `Zeiler_*_aarch64.dmg` | Built in; optional external mpv: `brew install mpv` |
| macOS 12+ (Intel) | `Zeiler_*_x64.dmg` | Built in; optional external mpv: `brew install mpv` |
| Android phones, tablets and TV | Universal `.apk` (arm64 and armv7) | Built in with Media3 |
| Debian / Ubuntu | `Zeiler_*_amd64.deb` | External mpv, installed with the package |
| Fedora / openSUSE | `Zeiler-*.x86_64.rpm` | Install mpv from your distro (Fedora: RPM Fusion) |
| Other Linux | `Zeiler_*_amd64.AppImage` | Install mpv from your distro |

Desktop builds are not code-signed or notarized yet. On Windows, SmartScreen may warn: choose
**More info → Run anyway**. On macOS, if “Zeiler” Not Opened appears, click **Done**, then open
**System Settings → Privacy & Security → Open Anyway** next to “Zeiler was blocked” and confirm.
On macOS 14 and earlier, right-clicking Zeiler and choosing **Open** also works.

Desktop updates are signed and install automatically the next time Zeiler opens. Download first
installs only from the official Releases page.

**Upgrading from Sailor:** Zeiler was called Sailor through v0.1.2. Sailor installations update to
Zeiler with addons and settings intact. Windows also removes Sailor. On macOS, rename the remaining
`Sailor.app` to `Zeiler.app`, or replace it with the new `.dmg`.

## Build and contribute

### Docker: the easiest full-app setup

With Docker and Docker Compose installed, run this from the repository root:

```bash
docker compose up --build
```

Open **[http://localhost:6080](http://localhost:6080)**. If noVNC asks for a password, copy
the `VNC password:` value printed by Compose (or run `docker compose logs zeiler`). It is
regenerated when the container starts. When you are done, stop the container and run:

```bash
docker compose down
```

This runs the **actual Linux Tauri app**, including external mpv, in a virtual desktop accessible
through your browser. It is not the limited installable web shell: that PWA caches its interface for
offline launches, but catalogs, accounts and playback require the native app.

Your source checkout is mounted for live development, and named volumes preserve dependency and
build caches between runs. You do not need Rust, Node.js or the native Tauri toolchain on the host.
See [CONTRIBUTING.md](CONTRIBUTING.md#quickstart-the-full-app-in-docker) for Docker details,
troubleshooting and quality gates.

### Native development

Install Node.js 22.12 or newer and Rust with rustup; the repository pins Rust 1.99.0. Linux also
needs the Tauri system packages listed in [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm run tauri dev
```

Linux uses external [mpv](https://mpv.io) for playback. Plain development builds on Windows and
macOS also use external mpv; see [CONTRIBUTING.md](CONTRIBUTING.md#built-in-playback-windows-macos)
to set up embedded libmpv or build release bundles.

<details>
<summary><strong>Android build from source</strong></summary>

Android additionally requires a JDK, Android SDK/NDK and the `aarch64-linux-android` and
`armv7-linux-androideabi` Rust targets:

```bash
npm run tauri android init --ci
node scripts/third-party-licenses.mjs --target aarch64-linux-android --features tauri/custom-protocol
npm run tauri android build --target aarch64 armv7 --apk --aab
```

`src-tauri/tauri.android.conf.json` takes the version from `package.json` and derives the Play
`versionCode`. Release signing uses `src-tauri/gen/android/keystore.properties` (copy the example
and keep the real file and keystore out of Git) or the `ZEILER_ANDROID_*` environment variables.
With `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` set to an authorized service-account JSON, `fastlane internal`
uploads the signed AAB and store listing to Play internal testing.

</details>

Contributions must preserve Zeiler's non-negotiable rule: **no hosted media, media index or bundled
content addon**. See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines and CI checks.
Bug reports and feature requests have [issue forms](https://github.com/malhaniah/zeiler/issues/new/choose).

## Features

- **Addons and catalogs:** install from manifest URLs or an opt-in, unreviewed community directory;
  browse movies, shows, anime and other catalog types with filters and customizable Home rows.
- **Integrated player:** embedded libmpv on Windows and macOS, controlled external mpv on Linux,
  and Media3 on Android, with seeking, speed, chapters, fullscreen and playback statistics.
- **Subtitles and audio:** embedded, addon and local subtitles; dual subtitle tracks, delay,
  encoding and styling; audio track selection, delay, normalization and volume above 100%.
- **Library and profiles:** Continue Watching, progress bars, watched marks and history, with
  separate local profiles and optional PINs.
- **Skip and next episode:** optional intro, recap and credit skipping from AniSkip and TheIntroDB,
  plus next-episode playback from the same source.
- **Live TV and IPTV:** addon channels, M3U and Xtream Codes playlists, and XMLTV now/next guides.
  Playlist credentials use the system keychain or Android Keystore.
- **Optional Stremio sync:** sign in to sync library items and, if enabled, addons with Stremio.
- **Responsive interface and updates:** desktop, touch and TV navigation, reduced-motion support,
  an offline installable web shell, and signed desktop updates.

## Privacy

Zeiler has **no telemetry and no Zeiler account**. Depending on the features you enable, it connects to:

- addons you install and built-ins you leave enabled;
- GitHub for desktop updates;
- AniSkip, Kitsu and TheIntroDB for skip times, unless disabled in **Settings → Player & quality**;
- addon directories only after you opt in;
- IPTV providers you add; and
- Stremio only when you sign a profile in.

Stremio sign-in sends either a browser-confirmed code or your email and password, plus library items
(titles, progress and watched marks). Optional addon sync also sends configured addon addresses,
including any keys embedded in them. If you choose to stay signed in, the session key is kept in the
system keychain or Android Keystore; otherwise it remains in memory until Zeiler quits. Signing out
stops further communication with Stremio.

## Architecture

Rust crates under [`crates/`](crates/) implement addons, torrent streaming, playback, accounts,
skip lookups, IPTV and sync. [`src-tauri/`](src-tauri/) contains the Tauri 2 shell, and
[`src/`](src/) contains the React/TypeScript interface. [`website/`](website/) is the static download
site. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and security posture.

## Security

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/malhaniah/zeiler/security/advisories/new), not in a
public issue. [SECURITY.md](SECURITY.md) covers supported versions, response targets and scope.

## License and third-party notices

Zeiler is licensed under [GPL-3.0-or-later](LICENSE). It is an independent project and is not
affiliated with or endorsed by Stremio (Smart Code Ltd).

Zeiler builds on stremio-core's protocol semantics and Harbor (both MIT), mpv/libmpv and FFmpeg
(LGPL, bundled on Windows and macOS), and many Rust crates and npm packages.
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) contains attribution and source offers; release
bundles include the license texts for their contents.
