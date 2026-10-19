# Android TV prototype (not for merging)

The findings are in [docs/plan/android-tv-prototype.md](../../docs/plan/android-tv-prototype.md).
This branch holds the code that answered them.

## What changed

| File | Why |
|---|---|
| `src-tauri/src/lib.rs` | `mobile_entry_point`, the updater module per platform, the TV player plugin registered on Android |
| `src-tauri/src/updater_mobile.rs` | The three updater commands on Android (tauri-plugin-updater is desktop only) |
| `src-tauri/src/window_state.rs` | `maximize()` only on desktop |
| `src-tauri/Cargo.toml`, `Cargo.lock` | `openssl` with `vendored` on Android (adds `openssl-src` 300.6.1+3.6.3; `cargo update` was not run) |
| `crates/zeiler-player/src/lib.rs` | `HostPlayer` and `Session::Host`: a platform player in mpv's names, counted as the embedded backend |
| `src-tauri/src/commands/mpv/android.rs`, `mod.rs` | The Android surface module: drives the Kotlin plugin, maps its events to `PlayerEvent` |
| `src-tauri/gen/android/` | Tauri's generated Android project, plus `TvPlayerPlugin.kt` (Media3 1.11.1), the Leanback banner, `touchscreen required=false` and the network security config |
| `src-tauri/capabilities/android-tv.json` | `core:app:allow-exit` on Android only (Back on Home leaves the app) |
| `src/lib/view.tsx` | Android's Back key acts as Escape; Home → exit |
| `src/pages/player/usePlayerControls.ts` | Enter (D-pad centre) and the remote's media keys |

## Build and run

Needs the Android SDK, platform 37, build-tools 37, NDK 29 and the Rust target
`aarch64-linux-android`; see the findings doc for the exact packages.

```bash
export ANDROID_HOME=~/Library/Android/sdk NDK_HOME=~/Library/Android/sdk/ndk/29.0.14206865
npx tauri android build --debug --apk --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n io.zeiler.desktop/.MainActivity
```

A release APK (`npx tauri android build --apk --target aarch64`) comes out unsigned. For
the emulator it was zip-aligned and signed with the local debug keystore.

For 32-bit TVs, build both ABIs with `--target aarch64 armv7`; the APK is 45.0 MB. The
armv7 OpenSSL build needs the NDK's ranlib named, because openssl-src otherwise calls
`arm-linux-androideabi-ranlib`, which NDK 29 doesn't ship:

```bash
export RANLIB_armv7_linux_androideabi=$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ranlib
```

## How playback was tested

Zeiler ships no stream addon, so a throwaway local server on the Mac stood in for one.
It isn't in this repository. It answered:
- `/manifest.json` (`resources: ["stream", "subtitles"]`, `idPrefixes: ["tt"]`);
- `/stream/{type}/{id}.json` with three `http://10.0.2.2:8765/<file>` streams;
- `/subtitles/…` with one external SRT;

and served the files with HTTP Range. The files were generated with ffmpeg (`testsrc2`,
sine tones, small SRT and ASS files):

- an H.264 MKV;
- an HEVC Main 8-bit MKV with AAC, AC-3 5.1, DTS and TrueHD tracks and embedded SRT
  and ASS;
- the same as HEVC Main10 with HDR10 metadata.

The emulator reaches the Mac's loopback at 10.0.2.2.

## Screenshots

From the Google TV emulator (1920×1080, shown at 960×540):

1. `01-home.jpg`: Home on the TV.
2. `02-focus-ring.jpg`: the D-pad focus ring.
3. `03-row-focus-off-screen.jpg`: a row's 5th card focused off-screen (only a sliver of
   the ring shows).
4. `04-install-dialog-under-keyboard.jpg`: the install confirmation under the TV keyboard.
5. `05-hevc-main10-hdr10-emulator-error.jpg`: the emulator can't decode HEVC Main10.
6. `06-stream-picker.jpg`: the picker, with the HDR stream marked unavailable.
7. `07-player-controls-over-video.jpg`: Zeiler's controls over Media3's video.
8. `08-embedded-srt.jpg`: an embedded SRT drawn by Media3.
9. `09-ass-in-media3.jpg` and `10-ass-in-libass-mpv.jpg`: the same ASS frame in Media3
   and in mpv (libass).
10. `11-external-subtitle-sub-add.jpg`: an external subtitle added through Zeiler's path.
11. `12-release-build-playing.jpg`: the release build playing.
12. `13-leanback-banner.jpg`: the launcher banner.
