//! The canvas's browser (_specs/036-canvas-browser): one native webview, a child of the main window, laid exactly over
//! the canvas panel's page area, so a site that refuses to be framed still loads. The window drives it with the
//! commands below and hears back what it shows (`canvas-browser:state`).
//!
//! A page in it is a stranger. No capability names its label, so it reaches none of Tauri's or the plugins' commands,
//! and every command here answers the main window's own webview only. It keeps its own cookies and storage, apart from
//! the app's. Only http and https pages load, with the canvas's rule, and never the app's own address.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PermissionResponse, WebviewBuilder};
use tauri::{AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Runtime, Url, Webview, WebviewUrl};

/// What the browser's webviews are called, each with a number of its own. No capability names them.
const LABEL: &str = "canvas-browser";
/// The main window's webview: the only caller these commands answer.
pub const MAIN: &str = "main";
/// What the browser shows, sent to the main window's webview when it changes.
const SHOWN: &str = "canvas-browser:state";
/// The browser's own website data, apart from the app's (macOS 14 and later). Exactly 16 bytes.
const DATA_STORE: [u8; 16] = *b"hobkin.canvas.v1";

/// Where the page area is, in the window's points from its top left.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// What the browser shows now.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Shown {
    url: String,
    title: String,
    loading: bool,
    back: bool,
    forward: bool,
}

/// Which webview is the browser now. A closed one leaves at once, so the next open makes a new one, even while WebKit
/// is still taking the old one down.
#[derive(Default)]
pub struct Browser {
    current: Mutex<Option<String>>,
    made: AtomicU32,
}

impl Browser {
    fn current(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        self.current.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Only the main window's own webview may drive the browser: never the page inside it.
pub fn from_main<R: Runtime>(caller: &Webview<R>) -> Result<(), String> {
    if caller.label() == MAIN {
        Ok(())
    } else {
        Err("Only hobkin's window can do that.".into())
    }
}

/// A page address, by the canvas's rule (`canvasUrl` in shared/protocol/canvas.ts): http or https, with a host, and no
/// sign-in in it.
fn page(address: &str) -> Result<Url, String> {
    let url = Url::parse(address).map_err(|_| "That is not a web address.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("The canvas shows only http and https pages.".into());
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("That address has no host.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("The canvas does not take an address with a sign-in in it.".into());
    }
    Ok(url)
}

/// Whether the browser may go somewhere: a page by the canvas's rule that is not the app's own address, or what a page
/// uses inside itself (a blank frame, data and blob addresses). Anything else is refused: files, the app's schemes.
fn may_visit(url: &Url, own: Option<&Url>) -> bool {
    match url.scheme() {
        "about" | "data" | "blob" => true,
        "http" | "https" => page(url.as_str()).is_ok() && own.is_none_or(|own| own.origin() != url.origin()),
        _ => false,
    }
}

fn bounds(area: Area) -> Rect {
    Rect {
        position: LogicalPosition::new(area.x.max(0.0), area.y.max(0.0)).into(),
        size: LogicalSize::new(area.width.max(1.0), area.height.max(1.0)).into(),
    }
}

fn browser<R: Runtime>(app: &AppHandle<R>) -> Option<Webview<R>> {
    let label = app.state::<Browser>().current().clone()?;
    app.get_webview(&label)
}

/// What the browser shows, read from WebKit on the main thread.
fn read<R: Runtime>(webview: &Webview<R>) -> Option<Shown> {
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let _ = tx.send(shown_of(&platform));
        })
        .ok()?;
    rx.recv_timeout(Duration::from_secs(2)).ok()
}

#[cfg(target_os = "macos")]
fn shown_of(platform: &tauri::webview::PlatformWebview) -> Shown {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use std::ffi::{c_char, CStr};

    unsafe fn string(object: *mut AnyObject) -> String {
        if object.is_null() {
            return String::new();
        }
        let utf8: *const c_char = msg_send![object, UTF8String];
        if utf8.is_null() {
            String::new()
        } else {
            CStr::from_ptr(utf8).to_string_lossy().into_owned()
        }
    }

    // SAFETY: `inner` is the live WKWebView of this webview, and this runs on the main thread, as WebKit wants. URL,
    // absoluteString and title return autoreleased objects or nil; the BOOL properties take no arguments.
    unsafe {
        let wk = &*(platform.inner() as *mut AnyObject);
        let url: *mut AnyObject = msg_send![wk, URL];
        let address: *mut AnyObject = if url.is_null() { std::ptr::null_mut() } else { msg_send![url, absoluteString] };
        let title: *mut AnyObject = msg_send![wk, title];
        let loading: bool = msg_send![wk, isLoading];
        let back: bool = msg_send![wk, canGoBack];
        let forward: bool = msg_send![wk, canGoForward];
        Shown { url: string(address), title: string(title), loading, back, forward }
    }
}

#[cfg(not(target_os = "macos"))]
fn shown_of(_platform: &tauri::webview::PlatformWebview) -> Shown {
    Shown::default()
}

/// Tells the main window what the browser shows. From a thread of its own, since WebKit's callbacks come on the main
/// thread, where waiting for an answer from it would never end.
fn report<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        if let Some(shown) = browser(&app).and_then(|webview| read(&webview)) {
            let _ = app.emit_to(EventTarget::webview(MAIN), SHOWN, shown);
        }
    });
}

/// Back or forward, the way WebKit itself goes, so the page cannot stand in the way.
fn step<R: Runtime>(webview: &Webview<R>, forward: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        webview
            .with_webview(move |platform| {
                // SAFETY: the live WKWebView, on the main thread. goBack and goForward return a navigation or nil.
                unsafe {
                    let wk = &*(platform.inner() as *mut AnyObject);
                    let _: *mut AnyObject = if forward { msg_send![wk, goForward] } else { msg_send![wk, goBack] };
                }
            })
            .map_err(text)
    }
    #[cfg(not(target_os = "macos"))]
    {
        webview.eval(if forward { "history.forward()" } else { "history.back()" }).map_err(text)
    }
}

/// Which of the shell's own commands this build has. The window asks once, and without an answer it frames pages and
/// tells nothing, as before.
#[tauri::command]
pub fn shell_features<R: Runtime>(webview: Webview<R>) -> Result<serde_json::Value, String> {
    from_main(&webview)?;
    Ok(serde_json::json!({ "notices": true, "browser": true }))
}

/// Opens the page over the area, or takes the browser that is open there and to the page.
#[tauri::command]
pub async fn browser_open<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, url: String, area: Area) -> Result<(), String> {
    from_main(&webview)?;
    let url = page(&url)?;
    if let Some(open) = browser(&app) {
        open.navigate(url).map_err(text)?;
        open.set_bounds(bounds(area)).map_err(text)?;
        return open.show().map_err(text);
    }
    let own = app.config().build.dev_url.clone();
    let (on_load, on_title, on_new) = (app.clone(), app.clone(), app.clone());
    let label = format!("{LABEL}-{}", app.state::<Browser>().made.fetch_add(1, Ordering::Relaxed) + 1);
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .focused(false)
        .data_store_identifier(DATA_STORE)
        .on_navigation(move |next| may_visit(next, own.as_ref()))
        // A link that would open a window opens here instead, when it is a page the browser may show.
        .on_new_window(move |next, _features| {
            if page(next.as_str()).is_ok() {
                let app = on_new.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(open) = browser(&app) {
                        let _ = open.navigate(next);
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, _| report(on_load.clone()))
        .on_document_title_changed(move |_, _| report(on_title.clone()))
        // No camera, microphone, location or other device for a page in here, and no downloads.
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_download(|_, _| false);
    let (x, y) = (area.x.max(0.0), area.y.max(0.0));
    webview
        .window()
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(area.width.max(1.0), area.height.max(1.0)))
        .map_err(text)?;
    *app.state::<Browser>().current() = Some(label);
    Ok(())
}

/// Lays the browser over the area, or hides it with none: a native view draws over everything in the window.
#[tauri::command]
pub async fn browser_place<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, area: Option<Area>) -> Result<(), String> {
    from_main(&webview)?;
    let Some(open) = browser(&app) else { return Ok(()) };
    match area {
        Some(area) => {
            open.set_bounds(bounds(area)).map_err(text)?;
            open.show().map_err(text)
        }
        None => open.hide().map_err(text),
    }
}

#[tauri::command]
pub async fn browser_navigate<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, url: String) -> Result<(), String> {
    from_main(&webview)?;
    let url = page(&url)?;
    match browser(&app) {
        Some(open) => open.navigate(url).map_err(text),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn browser_back<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<(), String> {
    from_main(&webview)?;
    if let Some(open) = browser(&app) {
        step(&open, false)?;
        report(app);
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_forward<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<(), String> {
    from_main(&webview)?;
    if let Some(open) = browser(&app) {
        step(&open, true)?;
        report(app);
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reload<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<(), String> {
    from_main(&webview)?;
    match browser(&app) {
        Some(open) => open.reload().map_err(text),
        None => Ok(()),
    }
}

/// What the browser shows now, or nothing when it is not open.
#[tauri::command]
pub async fn browser_shown<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<Option<Shown>, String> {
    from_main(&webview)?;
    Ok(browser(&app).and_then(|open| read(&open)))
}

#[tauri::command]
pub async fn browser_close<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Result<(), String> {
    from_main(&webview)?;
    close(&app);
    Ok(())
}

/// Closes the browser, if it is open. Also when the window's own page loads again, since a reloaded window no longer
/// drives the browser it had.
pub fn close<R: Runtime>(app: &AppHandle<R>) {
    let label = app.state::<Browser>().current().take();
    if let Some(open) = label.and_then(|label| app.get_webview(&label)) {
        let _ = open.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_pages_by_the_canvas_rule_open() {
        assert!(page("https://example.com/a").is_ok());
        assert!(page("http://localhost:5173/").is_ok());
        for refused in ["file:///etc/passwd", "javascript:alert(1)", "tauri://localhost", "https://user:pw@example.com/", "not an address"] {
            assert!(page(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn the_browser_goes_to_pages_and_what_they_use_but_never_the_app_itself() {
        let own = Url::parse("http://127.0.0.1:5187").unwrap();
        let visit = |address: &str| may_visit(&Url::parse(address).unwrap(), Some(&own));
        assert!(visit("https://example.com/"));
        assert!(visit("http://127.0.0.1:3000/"));
        assert!(visit("about:blank"));
        assert!(visit("data:text/html,hi"));
        assert!(!visit("http://127.0.0.1:5187/"));
        assert!(!visit("file:///etc/passwd"));
        assert!(!visit("tauri://localhost/"));
    }
}
