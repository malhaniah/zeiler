//! Android TV prototype: Media3 ExoPlayer instead of libmpv. The app's own Kotlin plugin
//! (`TvPlayerPlugin.kt` in `gen/android`) runs the player in a SurfaceView under the
//! transparent WebView and takes mpv's names: the observed properties, the property
//! writes and the `seek`/`cycle`/`stop` commands the player screen sends. So the
//! screen drives it as it drives libmpv, and its events come back as mpv-shaped
//! [`PlayerEvent`]s on a plugin channel. What Media3 can't do (subtitle delay, a
//! second subtitle, mpv's subtitle style) the plugin refuses.
//!
//! Prototype only (not for merging): see docs/plan/android-tv-prototype.md.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Wry};
use tracing::warn;
use zeiler_player::{HostFuture, HostPlayer, PlaybackRequest, PlayerEvent, Session, SessionError};

use super::{EmbeddedStatus, Geometry};
use crate::error::IpcError;

/// The Kotlin class, in the app's own package (`identifier` in tauri.conf.json).
const PLUGIN_PACKAGE: &str = "io.zeiler.desktop";
const PLUGIN_CLASS: &str = "TvPlayerPlugin";

/// The registered Kotlin plugin.
struct TvPlayer(PluginHandle<Wry>);

/// Registers the Kotlin player plugin; added to the builder on Android only.
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("zeiler-tv-player")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_PACKAGE, PLUGIN_CLASS)?;
            app.manage(TvPlayer(handle));
            Ok(())
        })
        .build()
}

#[derive(Default)]
pub struct Surface;

pub(super) fn embedded_status() -> EmbeddedStatus {
    EmbeddedStatus {
        available: true,
        reason: None,
        libmpv_version: None,
    }
}

#[derive(Serialize)]
struct OpenArgs {
    events: Channel<Value>,
}

/// The player's events as the plugin sends them (`PlayerEvent`'s own JSON shape).
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum HostEvent {
    Property {
        name: String,
        #[serde(default)]
        value: Value,
    },
    StartFile,
    FileLoaded,
    Seek,
    PlaybackRestart,
    EndFile {
        reason: String,
        #[serde(rename = "fileError")]
        file_error: Option<String>,
    },
    Error {
        message: String,
    },
    Shutdown,
}

impl From<HostEvent> for PlayerEvent {
    fn from(event: HostEvent) -> Self {
        match event {
            HostEvent::Property { name, value } => PlayerEvent::Property { name, value },
            HostEvent::StartFile => PlayerEvent::StartFile,
            HostEvent::FileLoaded => PlayerEvent::FileLoaded,
            HostEvent::Seek => PlayerEvent::Seek,
            HostEvent::PlaybackRestart => PlayerEvent::PlaybackRestart,
            HostEvent::EndFile { reason, file_error } => PlayerEvent::EndFile {
                reason: match reason.as_str() {
                    "eof" => "eof",
                    "stop" => "stop",
                    "quit" => "quit",
                    "error" => "error",
                    _ => "unknown",
                },
                file_error,
            },
            HostEvent::Error { message } => PlayerEvent::Error { message },
            HostEvent::Shutdown => PlayerEvent::Shutdown,
        }
    }
}

pub(super) fn spawn_embedded(
    app: &AppHandle,
    _surface: &Surface,
    events: impl Fn(PlayerEvent) + Send + Sync + 'static,
) -> Result<Session, String> {
    let plugin = app
        .try_state::<TvPlayer>()
        .ok_or_else(|| "The TV player plugin is not loaded.".to_string())?
        .0
        .clone();
    let events = Arc::new(events);
    let channel = Channel::new(move |body| {
        let parsed = match &body {
            InvokeResponseBody::Json(json) => serde_json::from_str::<HostEvent>(json),
            InvokeResponseBody::Raw(bytes) => serde_json::from_slice::<HostEvent>(bytes),
        };
        match parsed {
            Ok(event) => events(event.into()),
            Err(e) => warn!(%e, "unreadable TV player event"),
        }
        Ok(())
    });
    // a blocking call, answered from Android's main thread (never this one)
    plugin
        .run_mobile_plugin::<Value>("open", OpenArgs { events: channel })
        .map_err(|e| format!("The TV player did not start: {e}"))?;
    Ok(Session::Host(Box::new(AndroidSession { plugin })))
}

struct AndroidSession {
    plugin: PluginHandle<Wry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadArgs<'a> {
    url: &'a str,
    title: Option<&'a str>,
    headers: &'a [(String, String)],
    user_agent: Option<&'a str>,
    referrer: Option<&'a str>,
    start_at_sec: Option<f64>,
    /// the shell's pre-load options (`alang`, `slang`, `sid`…), for the track pick
    options: &'a [(String, String)],
}

#[derive(Serialize)]
struct PropertyArgs<'a> {
    name: &'a str,
    value: Value,
}

#[derive(Serialize)]
struct CommandArgs {
    args: Vec<String>,
}

#[derive(Deserialize)]
struct GetResult {
    #[serde(default)]
    value: Value,
}

impl AndroidSession {
    async fn call<T: serde::de::DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> Result<T, SessionError> {
        self.plugin
            .run_mobile_plugin_async::<T>(command, payload)
            .await
            .map_err(|e| SessionError::Mpv(e.to_string()))
    }
}

impl HostPlayer for AndroidSession {
    fn load(&self, request: PlaybackRequest) -> HostFuture<'_, ()> {
        Box::pin(async move {
            let args = LoadArgs {
                url: &request.url,
                title: request.title.as_deref(),
                headers: &request.headers,
                user_agent: request.user_agent.as_deref(),
                referrer: request.referrer.as_deref(),
                start_at_sec: request.start_at_sec,
                options: &request.options,
            };
            self.call::<Value>("load", args).await.map(|_| ())
        })
    }

    fn set_property<'a>(&'a self, name: &'a str, value: Value) -> HostFuture<'a, ()> {
        Box::pin(async move {
            self.call::<Value>("setProperty", PropertyArgs { name, value })
                .await
                .map(|_| ())
        })
    }

    fn command(&self, args: Vec<String>) -> HostFuture<'_, ()> {
        Box::pin(async move {
            self.call::<Value>("command", CommandArgs { args })
                .await
                .map(|_| ())
        })
    }

    fn get_property<'a>(&'a self, name: &'a str) -> HostFuture<'a, Value> {
        Box::pin(async move {
            self.call::<GetResult>(
                "getProperty",
                PropertyArgs {
                    name,
                    value: Value::Null,
                },
            )
            .await
            .map(|r| r.value)
        })
    }

    fn quit(&self) {
        let plugin = self.plugin.clone();
        // the Shutdown event comes on the channel once the player is released
        tauri::async_runtime::spawn(async move {
            if let Err(e) = plugin.run_mobile_plugin_async::<Value>("quit", ()).await {
                warn!(%e, "the TV player did not quit");
            }
        });
    }
}

pub(super) fn after_start(_app: &AppHandle, _surface: &Surface) {}

pub(super) fn on_stop(_app: &AppHandle, _surface: &Surface) {}

pub(super) fn refresh_surface(
    _app: &AppHandle,
    _surface: &Surface,
    _active: bool,
) -> Result<(), IpcError> {
    Ok(())
}

#[derive(Serialize)]
struct GeometryArgs {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// The video follows the page's video box, in the WebView's physical px (the page
/// sends `getBoundingClientRect() × devicePixelRatio`, as on desktop).
pub(super) fn set_geometry(
    app: &AppHandle,
    _surface: &Surface,
    geometry: Geometry,
    active: bool,
) -> Result<(), IpcError> {
    if !active {
        return Ok(());
    }
    let Some(plugin) = app.try_state::<TvPlayer>() else {
        return Ok(());
    };
    let args = GeometryArgs {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
    };
    plugin
        .0
        .run_mobile_plugin::<Value>("setGeometry", args)
        .map(|_| ())
        .map_err(|e| IpcError::Player(e.to_string()))
}
