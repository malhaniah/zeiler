# Android TV prototype: findings

Written on 2026-10-19 to decide whether a TV version is worth a milestone. Like the M14
prototype, it builds only enough to answer the questions below. The code is on the branch
`claude/android-tv-prototype` (not for merging): an Android shell for the app, a Media3
player behind Zeiler's existing player API, and the screenshots under
`prototypes/android-tv/screenshots/`. Everything here was run on an Android TV emulator
(Google TV, API 34, arm64) on an Apple Silicon Mac. No real TV was used.

Samsung (Tizen) and LG (webOS) were not prototyped. As said before, they would need a
separate web app or a "cast to TV" feature. This document is about Android TV, Google TV
and Fire TV only.

## Verdict: go, as a milestone of its own

- **The hard parts work.** The existing app builds for Android with Tauri 2.12 after four
  small changes. It runs on the TV emulator: catalogs, addons, the library, the picker and
  the player screen. The librqbit torrent engine runs on Android. A Media3 player sits
  under the transparent WebView, and the existing player screen drives it, with only
  Enter and media-key handling added. The D-pad seeks and pauses.
- **The work is mostly the 10-foot UI.** Chromium's built-in spatial navigation moves
  the focus around with no code at all, with a visible focus ring. But overlays,
  dialogs, poster rows and the player's menus trap or lose the focus (see §3). A TV
  mode needs its own focus layer, a remote-first player control mode and phone-assisted
  text entry. That is about 40% of the estimate below.
- **Media3 rather than libmpv** for the TV player. Media3 is built to pass HDR and Dolby
  Vision to the display, to pass audio through and to match frame rates (documented,
  not yet seen on a device). It's also a Gradle dependency under Apache-2.0. libmpv on
  Android can't output HDR and draw subtitles at the same time. What Media3 gives up is
  libass-quality ASS, subtitle delay, a second subtitle, and DTS or TrueHD unless the
  HDMI sink takes them as passthrough.
- **Estimate: about 9–12 focused weeks** (the table below adds up to 8.5–11.5) for a
  sideloadable APK that is pleasant to use with a remote, plus real-device testing. Add
  store work if Google Play is wanted. Play is the riskiest part (§4).

Gate the milestone on one thing first: an afternoon on a real Google TV device (a Google
TV Streamer or a Chromecast with Google TV) playing a 4K HDR10/Dolby Vision HEVC file with
E-AC-3 through the prototype. The emulator cannot decode HEVC Main10 (§2), so HDR has
not been seen working.

## 1. Does it build and run for Android TV?

Yes. Toolchain used: Android SDK command-line tools, platform `android-37.0`,
build-tools 37.0.0, NDK 29.0.14206865, emulator 37.2.12, and the Google TV system image
`system-images;android-34;google-tv;arm64-v8a` (r03). The emulator profile was `tv_1080p`
with no touchscreen and a D-pad. Tauri CLI 2.12.3's Android template uses Gradle 9.6.1,
AGP 9.3.1, Kotlin 2.2.10, `compileSdk`/`targetSdk` 37 and `minSdk` 24. Gradle runs on the
installed Temurin 25, so no other JDK was needed.

**Unmodified `main`, compiled for `aarch64-linux-android`, fails on:**

1. `openssl-sys` can't find OpenSSL, which Android doesn't offer to apps. Two things
   link it:
   - `native-tls` on reqwest 0.12, in zeiler-addon, zeiler-iptv, zeiler-skip and
     zeiler-sync (librqbit's own reqwest 0.13 already uses rustls);
   - librqbit's SHA-1 (`crypto-hash`, sha1w's default feature).

   Fixed with `openssl = { features = ["vendored"] }` for `target_os = "android"`
   (`src-tauri/Cargo.toml`). It adds `openssl-src` 300.6.1+3.6.3 (Apache-2.0) to
   `Cargo.lock` and builds OpenSSL 3.6.3 with the NDK's clang. `cargo update` was not
   run. The alternative is rustls for Zeiler's reqwest plus librqbit's `rust-tls`
   feature, which moves SHA-1 to aws-lc-rs: also C, so it also needs the NDK.
2. `updater.rs` imports `tauri-plugin-updater` unconditionally, while
   `src-tauri/Cargo.toml` depends on it only for macOS, Windows and Linux (two errors).
   The plugin doesn't update on mobile anyway. The prototype keeps it for `desktop` and adds
   `updater_mobile.rs`, the same three commands answering "can't update itself".
3. `window_state.rs` calls `maximize()`, which mobile windows don't have. It's now
   `#[cfg(desktop)]`.
4. `lib.rs` needs `#[cfg_attr(mobile, tauri::mobile_entry_point)]` on `run()`.

The rest already compiled. Single-instance, the updater and dialog plugins are behind
`cfg(desktop)` in `lib.rs`, and the subtitle file picker has a mobile stub. librqbit and
every workspace crate compile, and after the changes above `cargo clippy -p zeiler
--target aarch64-linux-android -- -D warnings` is clean. The native library is 16 KB
aligned (`LOAD … 0x4000`), which Google Play requires for apps targeting Android 15+.

**At runtime** (debug and release builds):

- The app starts in about 190 ms to the first frame (`am start -W`, release build). Rust
  logs "zeiler started", and Cinemeta's catalogs, Detail, addon install, the stream
  picker with its quality tags, library progress, Continue Watching and the resume
  prompt all work. App data goes to `/data/user/0/<id>/` through Tauri's path API, and
  the subtitle cache to its `cache/`.
- **The torrent engine runs.** A test binary linked against the pinned librqbit ran
  on the emulator (`/data/local/tmp`). It created a torrent from a 97.6 MB file, seeded
  it from one session and downloaded it into another over loopback (DHT, trackers and
  local discovery off): 0.4 s, byte-identical. Zeiler's own engine was not started in
  the app, because it always turns DHT on and that would have meant public P2P traffic
  from the owner's network. The engine's HTTP stream over `127.0.0.1` therefore wasn't
  played through Media3.
- **The keychain doesn't persist on Android.** `keyring` 3.6.3 has no Android backend,
  so it falls back to its mock store, which keeps a secret only inside the `Entry` that
  set it. `set` succeeds, so Zeiler reports both kinds of secret as stored in the OS
  (`Storage::Os`), and Settings shows no "kept until Zeiler quits" note. But:
  - an IPTV password is gone at the next read (`secrets.rs` drops its memory copy after
    a successful set);
  - a Stremio session lasts until the app quits (`account/secrets.rs` caches it), then
    it's gone. A TV build needs an Android Keystore-backed
  store, for example a small Kotlin plugin encrypting with a Keystore key into the app's
  private files. This comes from reading the code; no sign-in was tried on the emulator.
- **WebView age.** The emulator image ships Android System WebView 113 (Chrome 113).
  Tailwind 4's CSS needs Chrome 111 or newer. TV boxes often have an older WebView and
  update it rarely, so a minimum WebView version check (with a clear message) is part of
  the milestone.
- **Memory:** about 229 MB RSS for the app process plus 167 MB for the WebView renderer
  on Home (release build). That is a lot for 1–2 GB TV sticks and needs watching.
- **Release builds block plain HTTP in Java networking**, which Media3 uses. The
  template sets `usesCleartextTraffic=false` for release, and a stream from a local
  `http://` server failed with "Cleartext HTTP traffic … not permitted" while the same
  build's Rust side fetched the addon over HTTP. The engine streams over
  `http://127.0.0.1`, so without a network security config every torrent would fail. The
  prototype allows cleartext everywhere, as mpv does on desktop.
  **Owner decision:** keep that, or allow only the loopback and refuse plain-http addon
  streams on TV.
- Desktop-only UI shows up: the window controls (minimize, maximize, close), the
  drag region and the "/" search shortcut. Some copy says "on this computer".

## 2. Playback

### libmpv for Android vs Media3

| | libmpv (mpv-android's build) | Media3 ExoPlayer 1.11.1 |
|---|---|---|
| Fit with Zeiler | Same property and command model as desktop; `zeiler-player`'s embedded backend could drive it from Rust, with JNI only for the Surface | A new backend; the prototype maps mpv's names onto it (below) |
| MKV, HEVC | Yes (FFmpeg demuxer; MediaCodec decoding) | Yes (Matroska extractor; MediaCodec decoding) |
| HDR10, Dolby Vision on the TV | No HDR output: mpv's `--target-colorspace-hint` (HDR passthrough, which also requires `--vo=gpu-next`) is "supported on Wayland, D3D11 and winvk contexts" (mpv 0.41 manual), so `vo=gpu`/`gpu-next` tone-maps to SDR. `vo=mediacodec_embed` renders straight to the Surface, but then "many of mpv's features (subtitle rendering, OSD/OSC, video filters, etc) are not available" (same manual) | The platform decoder renders to the Surface: HDR10, HLG and Dolby Vision reach the display where the device supports them; frame-rate matching (seamless only by default) and tunnelled playback are built in |
| Audio | Decodes everything in software (DTS, TrueHD), S/PDIF passthrough options | Platform decoders, plus passthrough of AC-3, E-AC-3 (Atmos), DTS and TrueHD to an HDMI sink that takes them; no DTS or TrueHD decoding without the FFmpeg extension, which you build yourself |
| Subtitles | libass: full ASS styling, PGS, VobSub, any external file at any time, delay, a second subtitle | SRT, WebVTT, TTML, basic ASS, PGS and VobSub in MKV; an external file means preparing the item again; no subtitle delay (1.11.1's `TextRenderer` and `ExoPlayer` have no offset setting) and no second subtitle |
| Licence with GPL-3.0-or-later | Compatible: mpv-android builds mpv without `-Dgpl=false`, so GPL-2.0-or-later, and FFmpeg LGPL. Every library's source must be offered, as Zeiler already does for macOS | Compatible: Apache-2.0, a Maven dependency, nothing to mirror |
| Build and size | A cross-built libmpv, FFmpeg and libass stack per ABI (arm64-v8a and armeabi-v7a): tens of MB per ABI (not measured), and a pipeline like `libmpv-macos` | `implementation("androidx.media3:…")`; the whole release APK is 27.8 MB for arm64 |

A TV's job is 4K HDR remuxes over HDMI, so HDR passthrough decides it: Media3 is the
primary TV player. libmpv could come back later as an optional "compatibility" backend
for anime fansubs, at the cost of a second native pipeline.

### The prototype

- `src-tauri/gen/android/app/src/main/java/io/zeiler/desktop/TvPlayerPlugin.kt` is an
  in-app Tauri Kotlin plugin (no separate crate). ExoPlayer plays into a `SurfaceView`
  added under the WebView, a Media3 `SubtitleView` sits between them, and the WebView's
  background goes transparent. That is the desktop embedded model.
- It speaks mpv's vocabulary:
  - **Properties:** `pause`, `time-pos`, `duration`, `paused-for-cache`, `eof-reached`,
    `seeking`, `volume`, `mute`, `speed`, `track-list` (mpv's shape, with
    `external-filename`), `aid`/`sid`/`vid`, `dwidth`/`dheight` and
    `demuxer-cache-time`.
  - **Events:** `start-file`, `file-loaded`, `seek`, `playback-restart`, `end-file`
    (`error` with Media3's error code) and `shutdown`.
  - **Commands:** `seek` (all flags), `cycle pause`/`sid`, `stop` and `sub-add`.
  - **Refused:** anything else, which the screen already tolerates.
- `src-tauri/src/commands/mpv/android.rs` is the `imp` module for Android. A
  `Session::Host` variant in `zeiler-player` holds the plugin handle, and events come
  back on a plugin `Channel` as `PlayerEvent`s. The rest of the shell (progress
  tracking, the subtitle hook, the OpenSubtitles hash, `player_load`) is unchanged.
- In the UI, Android's Back key acts as Escape through `onBackButtonPress`, and leaves
  the app from Home (`view.tsx`). The player takes Enter (D-pad centre) and the remote's
  media keys (`usePlayerControls.ts`).

### What was verified on the emulator

Test media generated with ffmpeg 9.0.2 were served with HTTP Range from the Mac by a
local test addon. The addon lives in the scratchpad: it was never committed and ships
nowhere.

- **Played over HTTP:** an H.264 MKV, and an HEVC Main (8-bit) MKV with four audio
  tracks (AAC, AC-3 5.1, DTS, TrueHD) and two embedded subtitle tracks (SRT, ASS). The
  path was Detail → auto-play (or the picker) → the player. Video under the page, the
  control bar over it (screenshots 07, 12).
- **D-pad:** Left and Right seek −5/+5 s (36.4 → 41.5 → 46.8 → 42.8 with playback in
  between). Centre and the remote's Play/Pause toggle pause. Up and Down change the
  volume. Back leaves the player (the plugin gets `quit`) and goes to the picker or
  Detail.
- **HEVC Main10 HDR10** (generated with BT.2020, PQ, mastering display and MaxCLL):
  Media3 read the colour info correctly (`BT2020/Limited range/ST2084 PQ/10/10`). The
  emulator's software decoder (`c2.android.hevc.decoder`) refuses Main10
  (`NO_EXCEEDS_CAPABILITIES`), and the player showed its "Could not play" card. **HDR
  output is unverified.**
- **Audio tracks** came through in mpv's shape (title, language, codec, channels) in the
  Audio menu. On the emulator AC-3, DTS and TrueHD are `supported=false` (no decoder, no
  HDMI sink). Selecting one made Media3 fail the whole playback
  (`NO_UNSUPPORTED_SUBTYPE`), so the plugin now refuses an unsupported track and the
  current one keeps playing. A remembered per-title audio choice hits this too.
- **Subtitles:** the embedded SRT was picked automatically and drawn by Media3. An
  external SRT through Zeiler's own path also works: Rust download, `sub-add`, then the
  media item rebuilt at the same position and the new track selected (screenshot 11).
  - The embedded **ASS** track loses a lot (screenshots 09 and 10). Of two overlapping
    lines Media3 drew only the positioned sign, without its `\frz15` rotation, and with
    a box instead of the outline. The bold yellow bottom line was missing. mpv (libass)
    draws both.
  - `sub-delay` and `secondary-sid` are refused.
- **Library progress** from Media3's events reached Continue Watching ("1 min left")
  and the resume prompt. The OpenSubtitles hash was computed by Rust over HTTP on
  Android (the test addon got `videoHash`, `videoSize` and `filename`).
- The **release build** plays too (after the cleartext fix), so R8 keeps the plugin
  class that Rust looks up by name.

### Not tried

- A real TV:
  - HDR10, Dolby Vision, HLG
  - frame-rate switching
  - passthrough of E-AC-3, Atmos, DTS and TrueHD
  - 4K performance
  - tunnelled playback
- HLS and live TV (the plugin has `media3-exoplayer-hls`).
- `player_load` for the next episode, and a switch from the Streams menu.
- A torrent through the app.
- The Linux and Windows desktop builds of this branch (only the macOS gates were run on it).

## 3. The 10-foot UI

The page renders at 960×540 CSS px (devicePixelRatio 2 on a 1080p TV). Most text is
14–16 CSS px, which is 14–16 dp and inside Android TV's usual body sizes. 8–13% is 9–13
px badges and metadata, small from across a room. The WebView reports `hover: none` and
`pointer: none`, so the existing `(hover: none)` fallbacks (`NO_HOVER_SHOW`) already show
hover-only controls.

**What works with no TV code:** on the TV emulator the WebView has Chromium's spatial
navigation on. Arrows move the focus between buttons, the global `:focus-visible` outline
shows it (screenshot 02), and the D-pad centre clicks. Through the sidebar, Detail and
the picker, every action was reachable by remote once focus was in the right layer.

**What breaks** (each seen on the emulator, with the focus read through DevTools):

1. **Poster rows lose items.** Spatial navigation scrolls a row by 40 px, and
   `scroll-snap-type: x mandatory` snaps it straight back. The focus reached the 5th card
   off-screen (only a sliver of its ring showed, screenshot 03), then wrapped back to the
   1st. Every card after the 5th is unreachable: items 6–10 of a Top 10 row, and the
   rest of a catalog row, which also never loads its next page.
2. **Scroll containers are focus stops.** `main`, the sidebar and each row's track take
   the focus themselves, so each row costs about four Down presses. Down scrolls
   `main` 40 px at a time when nothing focusable is in view.
3. **Overlay frames don't take the focus.** Detail and the picker open over Home, but
   the focus stays on Home underneath (not `inert`). Down kept moving among Home's
   hidden buttons until Left went to the sidebar and Right came back into the overlay.
4. **Dialogs are unreachable.** The install confirmation doesn't move the focus into
   itself. The URL field behind it keeps the arrows (Down scrolls the page, Right moves
   the caret), so the dialog can't be reached by remote. The TV keyboard also stays up
   over it (screenshot 04).
5. **No primary action is focused** on the "Could not play" card or when the picker
   opens. The resume prompt and the Play menu do focus theirs, and that pattern works.
6. **The player's menus are out of reach.** The arrows are taken by seek and volume, so
   Streams, Audio, Subtitles, speed and fullscreen can't be focused. Enter and the
   media keys weren't handled (the prototype adds them). Subtitles sit over the seek
   bar while the controls are up.
7. **Text entry by remote is painful.** Typing a manifest URL on the TV keyboard means
   one letter per D-pad walk (the centre press that opened it also typed a "q"). Addon
   install, search, IPTV sources and sign-in need a phone-assisted way in: a QR code or
   a short code, as M12's browser sign-in already does for Stremio.
8. **The hero carousel** keeps rotating while one of its buttons has the focus, and its
   24×6 px slide dots are focus stops. Right from the last dot jumped to the window's
   Minimize button.
9. At 540 px tall the sidebar is cramped: the profile chip covers the Addons icon.

**What the milestone needs:**

- **A TV focus layer.** Chromium's spatial navigation is a start but not enough. Either
  use our own small manager or a library such as Norigin's spatial navigation. It
  needs:
  - focus groups per frame, with focus restored when a frame closes;
  - an `inert` background under overlays and dialogs;
  - rows that scroll the focused card into view (no mandatory snap on TV);
  - an autofocused primary action on every new frame and card.
- **A TV mode for the player.** When the controls are hidden, Left and Right seek and
  centre pauses. Up or Down shows the control bar and puts the focus on it. Back
  closes a menu before it leaves the player.
- **Desktop-only chrome hidden on TV:** window controls and the drag region. Also larger
  type for badges, and no auto-rotation while focused.
- **Phone-assisted input** for addon URLs, search and sign-in.

## 4. Packaging and updates

- **Manifest.** Tauri's template already declares `android.software.leanback`
  (`required=false`) and the `LEANBACK_LAUNCHER` category. The prototype adds
  `android:banner` (a 320×180 banner from the brand logo, screenshot 13) and
  `android.hardware.touchscreen required=false`, without which Google Play hides the app
  from TVs. `aapt2 dump badging` on the release APK shows `leanback-launchable-activity`,
  the banner and both features as not required. The banner wasn't seen in the launcher,
  because the Google TV launcher wants a Google account first.
- **Identifier and version.** The Android package is `tauri.conf.json`'s `identifier`,
  `io.zeiler.desktop`. A package name can never change once users install it.
  **Owner decision:** keep it or use, say, `io.zeiler.tv` through
  `tauri.android.conf.json`. The APK came out as `versionCode=1`, `versionName=1.0`. It
  needs the app's version and a versionCode that always grows, or updates are refused.
- **Size.** Release APK, arm64-v8a only: 27.8 MB (`libzeiler_lib.so` 25.5 MB stripped
  with LTO, `classes.dex` 2.6 MB). Many TV devices run a 32-bit (`armeabi-v7a`) system
  even on 64-bit chips, so a TV build should also ship armv7.
  - With both ABIs the universal APK is 45.0 MB (the armv7 library is 17.1 MB). One APK
    per ABI is the alternative.
  - The armv7 build needs `RANLIB_armv7_linux_androideabi` pointing at the NDK's
    `llvm-ranlib`. Otherwise openssl-src calls `arm-linux-androideabi-ranlib`, which NDK
    29 doesn't ship.
  - The two-ABI APK ran on the emulator, but only its arm64 half: the image is 64-bit
    only. The armv7 half hasn't run anywhere.
- **Signing.** An Android signing key is new and separate from the updater's minisign
  key, which this doesn't touch and which must never rotate. The Android key must never
  be lost or changed either: Android installs an update only when it's signed with the
  same key. Keep it as a release secret, or let Play App Signing hold it.
- **Updates without Tauri's updater** (it is desktop only):
  1. **In-app**, as on desktop. A `latest-android.json` on the GitHub release (version,
     URL, SHA-256, a minisign signature by the existing key) is checked at launch. The
     APK is downloaded to the cache and installed with `PackageInstaller`. This needs
     `REQUEST_INSTALL_PACKAGES` and the user's one-time "install unknown apps" consent
     for Zeiler, and Android itself refuses an APK signed by another key.
  2. **Outside the app:** the Downloader app (AFTVnews) or Obtainium pointed at GitHub
     releases, or an F-Droid repository. No code, but no "update ready" either.

  Recommended: (1) for sideloaded installs, plus a release page that also works with
  (2).
- **Google Play would likely raise:**
  - **Unauthorized access to copyrighted content.** Zeiler ships no content addons,
    and Stremio, also content-neutral, ships an Android TV app (several sources say it
    is on Google Play; not checked against the listing), so such a client can pass. But
    the opt-in community directory (M10's Browse tab lists stremio-addons.net) and
    `stremio://` installs make Zeiler look like a piracy front end to a reviewer.
    The Play build should leave the directory out and describe Zeiler as a client for
    the user's own addons, Stremio account, IPTV playlists and local files.
  - **The brand.** The logo, used for the icon and the prototype's banner, is a pirate
    ship flying a skull and crossbones. A reviewer will see it before any addon
    directory. **Owner decision:** keep it for a store listing, or use store-only
    artwork.
  - **The BitTorrent engine.** It's allowed (torrent clients are on Play), but a
    reviewer will look harder at it next to "streaming".
  - **TV app quality review.** It's manual: full D-pad navigation (everything in §3),
    the banner, no touch requirement, no phone-only UI, and no broken back stack.
  - **The Data safety form:** Stremio account sync, OpenSubtitles, AniSkip/TheIntroDB,
    Kitsu, addon traffic, crash data (none).
  - Target API 35+ (37 now) and 16 KB pages are already met.
- **Fire TV.** Fire OS 7 and 8 (Android 9 and 11) can sideload the same APK through
  Downloader, and the Amazon Appstore has its own review. The Fire TV Stick 4K Select
  (2025) runs Vega OS, which is Linux-based, runs no Android apps and allows no normal
  sideloading. AFTVnews reports Amazon saying all future Fire TV sticks will run it. So
  Fire TV is the existing Fire OS devices only. Not tried on any Fire TV.

## Milestone plan (M15, Android TV)

| # | Piece | What done looks like | Effort |
|---|---|---|---|
| 1 | Android shell | The prototype's cfg fixes; vendored OpenSSL or rustls; `gen/android` committed; an Android Keystore secret store behind `account/secrets.rs`; the cleartext decision; identifier and versionCode; WebView version check; desktop-only UI hidden on TV | 1–1.5 weeks |
| 2 | Media3 backend | The prototype's plugin finished: `player_load` and next episode, HLS and live, error mapping, passthrough via `AudioCapabilities`, frame-rate switching, track support shown in the menus, subtitle style through `CaptionStyleCompat`, lifecycle (pause on Home, release on stop), a `MediaSession` for the remote and Assistant | 2–3 weeks |
| 3 | TV focus layer and player TV mode | Everything under "What breaks" in §3 fixed, one screen at a time, each smoke-tested on the emulator with a focus log | 2.5–3.5 weeks |
| 4 | Phone-assisted input | QR or code pairing for addon URLs and search; M12's browser sign-in checked on TV; IPTV source add | 1 week |
| 5 | Packaging and updates | Banner and icons, signing in `release.yml` (arm64 and armv7), `latest-android.json` and the in-app updater, website download page, README and docs | 1–1.5 weeks |
| 6 | Real-device QA | A Google TV Streamer or Chromecast with Google TV, a Fire TV Stick 4K Max and an NVIDIA Shield or a TV with Google TV built in: HDR10/DV, Atmos/DTS passthrough, 4K HEVC, a torrent over Wi-Fi, memory on a 2 GB device | 1 week, plus hardware |

That's about 9–12 weeks. Pieces 1 and 2 can run in parallel with 3. Do the real-device
HDR check from the verdict before starting, and do Google Play only after piece 3.

## Risks

- **Real devices** may behave differently from the emulator. HDR, Dolby Vision,
  passthrough and decoder limits are device-specific, and the emulator could check none
  of them.
- **The TV WebView:** Chrome 111+ is needed for the current CSS, and old TV boxes rarely
  update. With about 400 MB resident on Home, the React UI and big poster grids may stutter
  or be killed on 1–2 GB devices.
- **Media3's subtitle gaps** matter for anime, a first-class room in Zeiler: ASS
  typesetting, delay, a second subtitle. Partial fixes: render ASS in the WebView with
  a libass build for the web (JASSUB, MIT; heavy on TV CPUs), or libmpv as an optional
  backend later.
- **A third player backend** to keep in step with the other two. The prototype's
  mapping onto mpv names keeps the UI shared, but every new player feature now needs a
  Media3 answer or a refusal.
- **Google Play policy** (§4). Plan for sideloading first.
- **Two keys** to keep forever: the updater's minisign key and the Android signing
  key.
- **32-bit ARM** (armv7): librqbit, OpenSSL and the app build, but haven't run on a
  32-bit device.
- **Background behaviour.** Android stops the app's network when it leaves the
  foreground, so a torrent pauses when the user presses Home. That is fine for
  streaming, but it is a difference from desktop.

## Reproduce

On the branch `claude/android-tv-prototype`, with the SDK at `~/Library/Android/sdk`:

```bash
export ANDROID_HOME=~/Library/Android/sdk NDK_HOME=~/Library/Android/sdk/ndk/29.0.14206865
npx tauri android build --debug --apk --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

The emulator was created with `avdmanager create avd -n zeiler-tv -k
"system-images;android-34;google-tv;arm64-v8a" -d tv_1080p` and run headless with
`emulator -avd zeiler-tv -no-window -gpu swiftshader_indirect`. Debug builds expose the
WebView to DevTools (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`),
which is how the focus was logged after each `adb shell input keyevent`.
`prototypes/android-tv/README.md` on the branch has the details.
