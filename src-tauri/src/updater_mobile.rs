use serde::Serialize;
use tauri::AppHandle;

use crate::error::IpcError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub ready: Option<String>,
}

pub fn start(_app: AppHandle) {}

#[tauri::command]
pub async fn update_status(app: AppHandle) -> Result<UpdateStatus, IpcError> {
    Ok(UpdateStatus {
        current: app.package_info().version.to_string(),
        ready: None,
    })
}

#[tauri::command]
pub async fn update_check() -> Result<Option<String>, IpcError> {
    Err(IpcError::Unsupported(
        "Android updates are installed from the app store or with a newer APK.".into(),
    ))
}

#[tauri::command]
pub async fn update_install_now() -> Result<(), IpcError> {
    Err(IpcError::Unsupported(
        "Android updates are installed from the app store or with a newer APK.".into(),
    ))
}
