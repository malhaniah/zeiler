//! Updates on Android (the TV prototype): tauri-plugin-updater is desktop only, so
//! there is nothing to check or install from inside the app. A sideloaded APK is
//! updated by installing a newer APK signed with the same key (see
//! docs/plan/android-tv-prototype.md, "Packaging and updates"). Same commands as
//! `updater.rs`, so the UI and `generate_handler!` stay as they are.

use serde::Serialize;
use tauri::AppHandle;

use crate::error::IpcError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub ready: Option<String>,
}

const UNSUPPORTED: &str = "Zeiler can't update itself on this device. Install the newer APK.";

pub fn start(_app: AppHandle) {}

#[tauri::command]
pub async fn update_status(app: AppHandle) -> Result<UpdateStatus, IpcError> {
    Ok(UpdateStatus {
        current: app.package_info().version.to_string(),
        ready: None,
    })
}

#[tauri::command]
pub async fn update_check(_app: AppHandle) -> Result<Option<String>, IpcError> {
    Err(IpcError::Unsupported(UNSUPPORTED.into()))
}

#[tauri::command]
pub async fn update_install_now(_app: AppHandle) -> Result<(), IpcError> {
    Err(IpcError::Unsupported(UNSUPPORTED.into()))
}
