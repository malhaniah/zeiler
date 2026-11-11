# Security and reliability audit — 2026-11-11

## Scope and result

This audit covered the Zeiler 0.3.7 Rust workspace, Tauri command boundary, React UI,
updater, persistence, addon protocol and marketplace, IPTV, account sync, torrent engine,
and playback backends. Review focused on untrusted addon/playlist/subtitle input,
credential confidentiality, profile isolation, data loss, resource exhaustion, and
asynchronous state races.

Twenty-seven confirmed findings are remediated in Zeiler 0.3.8. Each remediation has
focused regression coverage where the project's existing test infrastructure supports it.
This was a point-in-time review, not a proof that the application is free of defects.

No malicious code, webview XSS, arbitrary local-file read, torrent-engine authentication
bypass, or updater signature bypass was confirmed in the reviewed code.

## Remediated findings

### Addon protocol and installation

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| ZA-01 | Medium | Redirects could disclose configured addon paths and query keys in the automatic `Referer`. | Disabled automatic referrer generation and added a two-server regression test. |
| ZA-02 | Medium | An addon could present benign capabilities during preview and different capabilities during installation. | The install command compares the refetched manifest's identity and capabilities with the reviewed manifest and rejects material changes. |
| ZA-03 | Medium | Update and marketplace comparisons missed catalog ID, extra/filter, and addon-catalog changes. | Treat those routing changes as capability changes requiring review. |
| ZA-04 | Medium | A delayed addon refresh could overwrite the same URL in another active profile. | Hold the profile-operation lock from the initial read through fetch and commit. |
| ZA-05 | Medium | A delayed addon installation could commit into a profile selected after the fetch began. | Capture the originating profile and reject the commit if it changed. |

### IPTV

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| IPTV-01 | Medium | An HTTPS playlist could contain an HTTP channel URL and bypass the user's unencrypted-transport choice. | Reject HTTP channel playback unless that source has explicit HTTP consent. |
| IPTV-02 | Medium | A delayed source addition could write a playlist and its credentials into another profile. | Bind the synchronized commit to the originating profile, recheck limits, and clean up secrets on failure. |
| IPTV-03 | Medium | Byte caps still allowed excessive channel-count allocations in M3U and Xtream sources. | Enforce a shared 50,000-channel maximum inside both parsing loops. |

### Playback

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| PLAYER-01 | High | Optional video-hash requests could forward URL secrets and custom headers to redirect targets. | Do not follow redirects for hash requests; hashing falls back to the existing no-hash behavior. |
| PLAYER-02 | Medium | The no-IPC mpv fallback could expose a stream URL to yt-dlp's process list. | Force `--ytdl=no`, matching the other playback backends. |
| PLAYER-03 | Low | A fallback stdin failure could leave an untracked mpv process running. | Kill and reap the new child before returning the error; added a Unix lifecycle regression. |
| PLAYER-04 | Medium | Playback startup could race a profile switch and write progress or apply preferences in the wrong profile. | Serialize startup with profile selection through tracker creation and active-session publication. |

### Persistence and profiles

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| STORE-01 | Medium | A failed profile-preferences write could leave device settings partially committed. | Restore the previous device-settings bytes when the second write fails and surface rollback failures. |
| STORE-02 | Medium | A partial legacy migration could permanently skip addons after settings copied successfully. | Migrate files independently through temporary files and rename, retrying only missing destinations. |
| STORE-03 | Low | Corrupt-file recovery could use defaults even when creating the only backup failed. | Return the backup error and leave the original bytes untouched. |
| STORE-04 | Low | A failed metadata save could delete or replace the previous profile avatar. | Preserve and restore avatar bytes on failure; delete replaced files only after metadata commits. |

### Account synchronization

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| SYNC-01 | High | Unsent addon changes existed only in memory and could be removed by a destructive pull after restart or profile switching. | Persist pending operations per profile and Stremio user; pause destructive pulls if queue persistence fails. |
| SYNC-02 | High | Pending operations from account A could be uploaded using account B's session. | Partition queues by Stremio user ID and drain only the active user's queue. |
| SYNC-03 | High | Sign-in and addon application could combine one profile's credentials with another profile's state. | Serialize commits with profile switching and revalidate the initiating profile. |
| SYNC-04 | Medium | Malformed or future-schema remote addon entries were silently omitted from the next whole-collection write. | Reject unreadable collections rather than silently deleting entries. |
| SYNC-05 | Low | First-sync Merge duplicated equivalent URLs with different spelling or default ports. | Compare parsed URLs using the same normalization as other addon operations. |

### Library and watched history

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| LIB-01 | Medium | Manual episode or season marks could erase earlier watched bits when current metadata was incomplete. | Refuse destructive bitfield realignment unless every existing watched mark is representable. |
| LIB-02 | Medium | Marking a video unwatched did not reset the playback flag needed to mark it watched after a replay. | Reset the relevant current video's playback watch count while preserving aggregate historical time. |

### Updater

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| UPDATE-01 | Medium | A truncated cached package was reused forever, preventing updates. | Verify cached packages before reuse, delete invalid entries, redownload, and publish the final filename only after a complete write. |

### Frontend correctness

| ID | Severity | Finding | Remediation |
| --- | --- | --- | --- |
| UI-01 | Medium | A stale previous-episode lookup could override a newer episode selection. | Route previous-episode navigation through the shared request generation and pending state. |
| UI-02 | Low | Shortening or closing a search did not invalidate its older in-flight request. | Advance the request generation for every open/query effect, including short and closed states. |
| UI-03 | Low | Shrinking the Hero item list could leave a blank slide and an invalid click target. | Clamp and reset the active index, using the safe index for rendering and opening items. |

## Verification

The final source tree passed:

- `cargo test --workspace`: 443 passed, 0 failed; 16 optional live-network/mpv tests ignored
  by their existing configuration.
- `cargo clippy --workspace --all-targets -- -D warnings`.
- Embedded-player Clippy checks with `zeiler/embedded`.
- `cargo fmt --all -- --check`.
- `npm run build`, including TypeScript checking and the Vite production build.
- `npm audit --omit=dev`: 0 known production dependency vulnerabilities.
- `git diff --check`.

The project's CI additionally exercises its platform matrix, embedded playback tests,
dependency license/source policy, and a Windows installer build. The release workflow signs
updater packages and does not publish until every platform build and updater manifest check
succeeds.

## Remaining follow-up

The following confirmed items were not remediated in 0.3.8:

- **High — playback redirect credential scoping.** mpv's global per-stream HTTP headers and
  referrer can be forwarded to a cross-origin redirect target. A safe fix requires
  origin-scoped redirect handling or upstream mpv/FFmpeg support; globally disabling
  redirects would break legitimate streams. No exploit instructions are included here.
- **Medium — profile deletion cleanup.** A filesystem failure can leave residual profile
  data after the profile is removed from the UI. Deletion needs a retryable tombstone flow.
- **Low — guide cache generation.** An older in-flight EPG response can populate the cache
  after a channel refresh. Guide results should be tied to the channel-list generation.
- **Low — locked-screen deep links.** A second-instance `stremio://` link received while the
  profile picker is locked can have no mounted listener. Queue it until unlock.

## Dependency alerts

GitHub Dependabot separately reports three advisories for `zip 4.6.1` (critical, high and
medium) through `tauri-plugin-updater 2.14.0`, and one medium-severity advisory for
`glib 0.18.5` through Tauri's Linux GTK stack. The patched releases (`zip 9.0.5` and
`glib 0.20.0`) are outside the semver requirements of the pinned Tauri dependencies
(`zip ^4` and `glib ^0.18`), so this release does not force an untested major-version
override. Track fixed upstream Tauri/GTK releases and upgrade through the normal build
and platform test matrix. The updater verifies package signatures before extraction;
these alerts do not constitute a confirmed Zeiler signature bypass.

## Limitations

This was a source-led audit with unit and integration-style regression tests, not an
exhaustive fuzzing campaign or a full manual QA pass on every operating system. Live public
addon tests and the pre-existing ignored real-mpv tests were not enabled locally. Updater
recovery tests use injected verification/download seams; actual minisign verification and
platform packaging remain the responsibility of the release workflow.
