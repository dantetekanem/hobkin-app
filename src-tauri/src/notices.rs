//! The Mac's notifications for what needs the user (_specs/037-notifications). The window decides what to tell and
//! when (ui/src/features/notifications); this sends what it says through tauri-plugin-notification, asks the Mac for
//! permission, and, on a click, brings the window to the front and hands the window back the notification's key.
//! Nothing in a notification is run or opened here: the window maps the key to one of its own places.

use tauri::plugin::PermissionState;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, Webview};
use tauri_plugin_notification::NotificationExt;

use crate::browser::{from_main, MAIN};

/// A click on one of hobkin's notifications, with its key, for the main window's webview.
const OPEN: &str = "notice:open";
const LONGEST_TITLE: usize = 80;
const LONGEST_BODY: usize = 240;
const LONGEST_KEY: usize = 1024;

fn clip(text: &str, most: usize) -> String {
    text.chars().filter(|c| !c.is_control()).take(most).collect()
}

/// The Mac's own permission, through UNUserNotificationCenter, which needs an app bundle: `tauri dev` runs a bare
/// binary, where it would end the app, so there it is not asked and the plugin's answer stands.
#[cfg(target_os = "macos")]
mod mac {
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSBundle, NSError};
    use objc2_user_notifications::{UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings, UNUserNotificationCenter};

    fn bundled() -> bool {
        NSBundle::mainBundle().bundlePath().to_string().ends_with(".app")
    }

    /// What the Mac allows now, or None outside an app bundle or without an answer.
    pub fn status() -> Option<UNAuthorizationStatus> {
        if !bundled() {
            return None;
        }
        let (tx, rx) = mpsc::channel();
        let answer = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: UserNotifications hands a valid settings object for the length of the call.
            let _ = tx.send(unsafe { settings.as_ref() }.authorizationStatus());
        });
        UNUserNotificationCenter::currentNotificationCenter().getNotificationSettingsWithCompletionHandler(&answer);
        rx.recv_timeout(Duration::from_secs(5)).ok()
    }

    /// Shows the Mac's prompt, when hobkin has not asked before. Some(true) when allowed.
    pub fn ask() -> Option<bool> {
        if !bundled() {
            return None;
        }
        let (tx, rx) = mpsc::channel();
        let answer = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &answer);
        // The user may take a while to answer the prompt.
        rx.recv_timeout(Duration::from_secs(120)).ok()
    }
}

/// What the Mac allows hobkin's notifications: `granted`, `denied`, `prompt` (not asked yet) or `unknown`. With `ask`,
/// a Mac that was never asked shows its own prompt now.
#[tauri::command]
pub async fn notice_permission<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, ask: bool) -> Result<&'static str, String> {
    from_main(&webview)?;
    #[cfg(target_os = "macos")]
    {
        use objc2_user_notifications::UNAuthorizationStatus;
        match mac::status() {
            Some(UNAuthorizationStatus::NotDetermined) if ask => {
                return Ok(match mac::ask() {
                    Some(true) => "granted",
                    Some(false) => "denied",
                    None => "unknown",
                })
            }
            Some(UNAuthorizationStatus::NotDetermined) => return Ok("prompt"),
            Some(UNAuthorizationStatus::Denied) => return Ok("denied"),
            Some(_) => return Ok("granted"),
            None => {}
        }
    }
    let _ = ask;
    Ok(match app.notification().permission_state() {
        Ok(PermissionState::Granted) => "granted",
        Ok(PermissionState::Denied) => "denied",
        Ok(_) => "prompt",
        Err(_) => "unknown",
    })
}

/// Shows one notification with the window's words. `key` comes back to the window when it is clicked.
#[tauri::command]
pub fn notice_send<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, key: String, title: String, body: String) -> Result<(), String> {
    from_main(&webview)?;
    if key.is_empty() || key.len() > LONGEST_KEY {
        return Err("A notification needs a short key.".into());
    }
    app.notification()
        .builder()
        .title(clip(&title, LONGEST_TITLE))
        .body(clip(&body, LONGEST_BODY))
        .extra("key", key)
        .show()
        .map_err(|error| error.to_string())
}

/// A click on a notification brings the window to the front, shown and focused, and tells the window which one it was.
pub fn open_on_click<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        if let Some(window) = handle.get_window(MAIN) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        let key = performed.notification().and_then(|shown| shown.extra().get("key")).and_then(|key| key.as_str()).map(str::to_owned);
        if let Some(key) = key.filter(|key| key.len() <= LONGEST_KEY) {
            let _ = handle.emit_to(EventTarget::webview(MAIN), OPEN, key);
        }
    });
}
