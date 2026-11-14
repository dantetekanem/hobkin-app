//! Updates for a release build, through tauri-plugin-updater. hobkin looks for a newer version shortly after it opens
//! and every six hours, downloads and installs one it finds, and tells the window, which offers to restart into it. A
//! development build never looks: the updater's settings are only in the release configuration
//! (scripts/package/tauri.release.conf.json). The updater is driven from here only, so no capability grants the window
//! any of its commands.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

use crate::browser::{from_main, MAIN};

/// Sent to the main window's webview once an update is installed, with its version.
const READY: &str = "update-ready";
/// The first look waits a little, so it never competes with the host starting.
const FIRST_LOOK: Duration = Duration::from_secs(15);
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// The version installed and waiting for a restart, once there is one.
#[derive(Default)]
pub struct Ready(Mutex<Option<String>>);

impl Ready {
    fn version(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Starts looking for updates, in a release build that has the updater's settings. Nothing the updater does can stop
/// the app: a failure is written to updates.log, and the next look tries again.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    // A release built without the release configuration has no updater settings, and the plugin would refuse them.
    if !app.config().plugins.0.contains_key("updater") {
        note(app, "No updater settings in this build, so it never looks for updates.");
        return;
    }
    if let Err(error) = app.plugin(tauri_plugin_updater::Builder::new().build()) {
        note(app, &format!("The updater could not start: {error}"));
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_LOOK);
        loop {
            match tauri::async_runtime::block_on(look(&app)) {
                // Once one is installed, there is nothing newer to look for until the app restarts into it.
                Ok(Some(version)) => return ready(&app, version),
                Ok(None) => {}
                Err(error) => note(&app, &format!("Looking for an update failed: {error}")),
            }
            // The clock on the wall, not the time awake: a Mac that slept through the six hours looks soon after it wakes.
            let next = SystemTime::now() + EVERY;
            while SystemTime::now() < next {
                std::thread::sleep(Duration::from_secs(60));
            }
        }
    });
}

/// Looks once, and installs what it finds. The version installed, or nothing when this one is the newest.
async fn look(app: &AppHandle) -> tauri_plugin_updater::Result<Option<String>> {
    let Some(update) = app.updater()?.check().await? else { return Ok(None) };
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(Some(update.version))
}

fn ready(app: &AppHandle, version: String) {
    note(app, &format!("Version {version} is installed and opens with the next restart."));
    *app.state::<Ready>().version() = Some(version.clone());
    let _ = app.emit_to(EventTarget::webview(MAIN), READY, serde_json::json!({ "version": version }));
}

/// Writes one line to updates.log in the app's log folder, where the updater's failures go.
fn note(app: &AppHandle, line: &str) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = fs::create_dir_all(&dir);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(dir.join("updates.log")) {
        let _ = writeln!(file, "{line}");
    }
}

/// The version installed and waiting for a restart, or nothing: for a window that loads after `update-ready` was sent.
#[tauri::command]
pub fn update_status<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<Option<String>, String> {
    from_main(&webview)?;
    Ok(app.state::<Ready>().version().clone())
}

/// Restarts the app into the version installed. It quits the way any quit does first, so the host is stopped.
#[tauri::command]
pub fn update_restart<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<(), String> {
    from_main(&webview)?;
    app.request_restart();
    Ok(())
}
