use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::Wry;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};

const PLUGIN_PACKAGE: &str = "io.zeiler.desktop";
const PLUGIN_CLASS: &str = "SecretsPlugin";

static PLUGIN: OnceLock<PluginHandle<Wry>> = OnceLock::new();

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("zeiler-android-secrets")
        .setup(|_app, api| {
            let handle = api.register_android_plugin(PLUGIN_PACKAGE, PLUGIN_CLASS)?;
            PLUGIN
                .set(handle)
                .map_err(|_| "Android secrets plugin was already registered")?;
            Ok(())
        })
        .build()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretArgs<'a> {
    account: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret: Option<&'a str>,
}

#[derive(Deserialize)]
struct SecretResult {
    secret: Option<String>,
}

fn call<T: serde::de::DeserializeOwned>(command: &str, args: SecretArgs<'_>) -> Result<T, String> {
    PLUGIN
        .get()
        .ok_or_else(|| "The Android secrets plugin is not loaded.".to_string())?
        .run_mobile_plugin::<T>(command, args)
        .map_err(|error| error.to_string())
}

pub fn get(account: &str) -> Option<String> {
    call::<SecretResult>(
        "get",
        SecretArgs {
            account,
            secret: None,
        },
    )
    .ok()?
    .secret
}

pub fn set(account: &str, secret: &str) -> Result<(), String> {
    call::<serde_json::Value>(
        "set",
        SecretArgs {
            account,
            secret: Some(secret),
        },
    )
    .map(|_| ())
}

pub fn delete(account: &str) {
    let _ = call::<serde_json::Value>(
        "delete",
        SecretArgs {
            account,
            secret: None,
        },
    );
}
