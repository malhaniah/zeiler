//! Automatic updates: install on the next launch, never mid-session.
//!
//! - At startup (release builds, when enabled) Zeiler checks for an update. If one is
//!   available it is installed right away, before the user has started anything: a
//!   package already downloaded during an earlier session is reused, otherwise it is
//!   downloaded first.
//! - While running, Zeiler re-checks every few hours and downloads quietly into the
//!   cache; the UI shows that the update is ready and will install on next launch.
//!
//! Packages are signature-verified by the plugin before a cached package is reused or
//! reported as ready, and again inside `install()`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tracing::{info, warn};

use crate::error::IpcError;
use crate::state::AppState;

const RECHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    /// Version downloaded and waiting to install on next launch.
    pub ready: Option<String>,
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("updates"))
}

fn cached_package(app: &AppHandle, version: &str) -> Option<PathBuf> {
    cache_dir(app).map(|d| d.join(format!("{version}.pkg")))
}

async fn read_verified_package(
    path: &Path,
    verify: impl FnOnce(&[u8]) -> tauri_plugin_updater::Result<()>,
) -> Option<Vec<u8>> {
    let bytes = tokio::fs::read(path).await.ok()?;
    match verify(&bytes) {
        Ok(()) => Some(bytes),
        Err(error) => {
            warn!(path = %path.display(), "discarding invalid cached update: {error}");
            let _ = tokio::fs::remove_file(path).await;
            None
        }
    }
}

async fn ensure_downloaded_with<V, D, F>(
    path: &Path,
    verify: V,
    download: D,
) -> anyhow::Result<Vec<u8>>
where
    V: FnOnce(&[u8]) -> tauri_plugin_updater::Result<()>,
    D: FnOnce() -> F,
    F: Future<Output = tauri_plugin_updater::Result<Vec<u8>>>,
{
    if let Some(bytes) = read_verified_package(path, verify).await {
        return Ok(bytes);
    }
    let bytes = download().await?;
    if let Some(dir) = path.parent() {
        // start clean: only the newest package is kept
        let _ = tokio::fs::remove_dir_all(dir).await;
        tokio::fs::create_dir_all(dir).await?;
    }
    let temporary = path.with_extension("pkg.tmp");
    tokio::fs::write(&temporary, &bytes).await?;
    tokio::fs::rename(temporary, path).await?;
    Ok(bytes)
}

async fn ensure_downloaded_at(path: &Path, update: &Update) -> anyhow::Result<Vec<u8>> {
    ensure_downloaded_with(
        path,
        |bytes| update.verify(bytes),
        || update.download(|_, _| {}, || {}),
    )
    .await
}

/// Download `update` into the cache unless it is already there and verified.
async fn ensure_downloaded(app: &AppHandle, update: &Update) -> anyhow::Result<Vec<u8>> {
    let path = cached_package(app, &update.version)
        .ok_or_else(|| anyhow::anyhow!("no cache directory"))?;
    ensure_downloaded_at(&path, update).await
}

/// Install a verified package and come back up on the new version. On Windows the
/// NSIS installer takes over: the process exits here and the installer relaunches it.
fn install_and_restart(app: &AppHandle, update: &Update, bytes: &[u8]) -> anyhow::Result<()> {
    let _ = app.emit("update://installing", &update.version);
    update.install(bytes)?;
    app.restart();
}

async fn check(app: &AppHandle) -> anyhow::Result<Option<Update>> {
    Ok(app.updater()?.check().await?)
}

/// Spawned once from setup.
pub fn start(app: AppHandle) {
    if cfg!(debug_assertions) {
        return; // dev builds must never replace themselves with a release
    }
    tauri::async_runtime::spawn(async move {
        let auto = match app.try_state::<AppState>() {
            Some(state) => state.settings.read().await.auto_update,
            None => true,
        };
        if !auto {
            return;
        }

        // 1. startup: install whatever is available, before the user starts anything
        match check(&app).await {
            Ok(Some(update)) => {
                info!(version = %update.version, "update available at launch, installing");
                match ensure_downloaded(&app, &update).await {
                    Ok(bytes) => {
                        if let Err(e) = install_and_restart(&app, &update, &bytes) {
                            warn!("update install failed: {e:#}");
                            let _ = app.emit("update://failed", format!("{e:#}"));
                        }
                    }
                    Err(e) => warn!("update download failed: {e:#}"),
                }
            }
            Ok(None) => {
                if let Some(dir) = cache_dir(&app) {
                    let _ = tokio::fs::remove_dir_all(dir).await;
                }
            }
            Err(e) => warn!("update check failed: {e:#}"),
        }

        // 2. while running: download quietly, install on next launch
        loop {
            tokio::time::sleep(RECHECK_EVERY).await;
            let still_on = match app.try_state::<AppState>() {
                Some(state) => state.settings.read().await.auto_update,
                None => true,
            };
            if !still_on {
                continue;
            }
            match check(&app).await {
                Ok(Some(update)) => match ensure_downloaded(&app, &update).await {
                    Ok(_) => {
                        info!(version = %update.version, "update downloaded; installs on next launch");
                        let _ = app.emit("update://ready", &update.version);
                    }
                    Err(e) => warn!("update download failed: {e:#}"),
                },
                Ok(None) => {}
                Err(e) => warn!("update check failed: {e:#}"),
            }
        }
    });
}

fn updates_disabled_in_dev() -> Result<(), IpcError> {
    if cfg!(debug_assertions) {
        Err(IpcError::InvalidInput(
            "Updates are disabled in development builds.".into(),
        ))
    } else {
        Ok(())
    }
}

/// Current version and any downloaded-but-not-installed update.
#[tauri::command]
pub async fn update_status(app: AppHandle) -> Result<UpdateStatus, IpcError> {
    let current = app.package_info().version.to_string();
    let ready = match check(&app).await {
        Ok(Some(update)) if update.version != current => {
            if let Some(path) = cached_package(&app, &update.version) {
                read_verified_package(&path, |bytes| update.verify(bytes))
                    .await
                    .map(|_| update.version.clone())
            } else {
                None
            }
        }
        _ => None,
    };
    Ok(UpdateStatus { current, ready })
}

/// Check now; downloads the update if there is one, tells the UI it is ready, and
/// returns its version.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<String>, IpcError> {
    updates_disabled_in_dev()?;
    let update = check(&app)
        .await
        .map_err(|e| IpcError::Storage(format!("couldn't check for updates: {e:#}")))?;
    let Some(update) = update else {
        return Ok(None);
    };
    ensure_downloaded(&app, &update)
        .await
        .map_err(|e| IpcError::Storage(format!("couldn't download the update: {e:#}")))?;
    let version = update.version.clone();
    let _ = app.emit("update://ready", &version);
    Ok(Some(version))
}

/// Install the available update now and restart.
#[tauri::command]
pub async fn update_install_now(app: AppHandle) -> Result<(), IpcError> {
    updates_disabled_in_dev()?;
    let update = check(&app)
        .await
        .map_err(|e| IpcError::Storage(format!("couldn't check for updates: {e:#}")))?
        .ok_or_else(|| IpcError::NotFound("Zeiler is already up to date.".into()))?;
    let bytes = ensure_downloaded(&app, &update)
        .await
        .map_err(|e| IpcError::Storage(format!("couldn't download the update: {e:#}")))?;
    install_and_restart(&app, &update, &bytes)
        .map_err(|e| IpcError::Storage(format!("couldn't install the update: {e:#}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    fn verify(bytes: &[u8]) -> tauri_plugin_updater::Result<()> {
        if bytes == b"test" {
            Ok(())
        } else {
            Err(tauri_plugin_updater::Error::Network(
                "invalid test signature".into(),
            ))
        }
    }

    #[tokio::test]
    async fn valid_cached_package_is_reused_without_download() {
        let dir = crate::persist::tests::temp_dir("updater-valid-cache");
        let path = dir.join("2.0.0.pkg");
        tokio::fs::write(&path, b"test").await.unwrap();

        let bytes = ensure_downloaded_with(&path, verify, || async {
            panic!("verified cache must not download")
        })
        .await
        .unwrap();

        assert_eq!(bytes, b"test");
    }

    #[tokio::test]
    async fn corrupt_cached_package_is_not_ready_and_is_deleted() {
        let dir = crate::persist::tests::temp_dir("updater-corrupt-status");
        let path = dir.join("2.0.0.pkg");
        tokio::fs::write(&path, b"truncated").await.unwrap();

        let bytes = read_verified_package(&path, verify).await;

        assert!(bytes.is_none());
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn corrupt_cache_is_redownloaded_and_temporary_file_is_not_ready() {
        let dir = crate::persist::tests::temp_dir("updater-corrupt-redownload");
        let path = dir.join("2.0.0.pkg");
        let temporary = path.with_extension("pkg.tmp");
        tokio::fs::write(&path, b"truncated").await.unwrap();
        tokio::fs::write(&temporary, b"test").await.unwrap();
        let downloads = Arc::new(AtomicUsize::new(0));
        let requested = downloads.clone();

        let bytes = ensure_downloaded_with(&path, verify, move || async move {
            requested.fetch_add(1, Ordering::SeqCst);
            Ok(b"test".to_vec())
        })
        .await
        .unwrap();

        assert_eq!(bytes, b"test");
        assert_eq!(downloads.load(Ordering::SeqCst), 1);
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"test");
        assert!(!temporary.exists());
    }
}
