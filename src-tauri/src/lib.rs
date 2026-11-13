use std::fs::{self, File};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, Wry, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

mod browser;
mod notices;

/// The port a host started with `--dev` listens on. The development UI asks it for the host's address.
const DEV_PORT: u16 = 5188;

/// The host this app started, if it started one. hobkin runs inside it, with all its background work:
/// routines, checks, agents and memory, as in the terminal app.
struct Host(Mutex<Option<Child>>);

/// The repository the app is built from. The host's code is there.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().map(PathBuf::from).unwrap_or_default()
}

/// A host already serves the UI: one started by hand, or by an earlier run of the app that did not stop it.
fn host_already_running() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], DEV_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

/// The host an earlier run of the app left behind, by its process id: the one its home's `client/host.json` names,
/// still running `host/src/main.ts`, with no parent any more. An app that is killed rather than quit never stops its
/// host, and the next start used to keep that host, with whatever code it had loaded when it began: hours of changes
/// to the host never took effect, however often the app was restarted. A host somebody runs by hand has its terminal
/// for a parent, and is not one of these.
fn leftover_host() -> Option<u32> {
    let record = fs::read_to_string(home()?.join("client").join("host.json")).ok()?;
    let digits: String = record.split("\"pid\":").nth(1)?.trim_start().chars().take_while(char::is_ascii_digit).collect();
    let pid: u32 = digits.parse().ok()?;
    let output = Command::new("ps").args(["-o", "ppid=,command=", "-p", &pid.to_string()]).output().ok()?;
    let line = String::from_utf8(output.stdout).ok()?;
    let (parent, command) = line.trim().split_once(char::is_whitespace)?;
    (parent == "1" && command.contains("host/src/main.ts")).then_some(pid)
}

/// Stops a host this run did not start, as `stop_host` stops its own: SIGTERM, so hobkin closes cleanly and frees its
/// home, and outright once it has had its time. It returns when the port is free, or after a last short wait.
fn stop_leftover(pid: u32) {
    let pid = pid.to_string();
    let gone = |within: Duration| {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if !host_already_running() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    };
    let _ = Command::new("kill").arg("-TERM").arg(&pid).status();
    if gone(Duration::from_secs(10)) {
        return;
    }
    let _ = Command::new("kill").arg("-KILL").arg(&pid).status();
    gone(Duration::from_secs(3));
}

/// The oldest Node the host runs on (the user asked for a much newer Node). A version manager may put an older one first on the PATH.
const NODE_MAJOR: u32 = 26;

/// A Node binary's major version, by asking it.
fn node_major(node: &Path) -> Option<u32> {
    let output = Command::new(node).arg("--version").output().ok()?;
    let version = String::from_utf8(output.stdout).ok()?;
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

/// Node for the host: the first one new enough, from the PATH when the app starts from a terminal, then Homebrew's
/// when it starts from Finder. With none new enough, the first one found, so the host still starts.
fn node() -> PathBuf {
    let on_path: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).map(|dir| dir.join("node")).filter(|candidate| candidate.is_file()).collect())
        .unwrap_or_default();
    let homebrew = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].iter().map(PathBuf::from).filter(|candidate| candidate.is_file());
    let candidates: Vec<PathBuf> = on_path.into_iter().chain(homebrew).collect();
    candidates
        .iter()
        .find(|candidate| node_major(candidate).is_some_and(|major| major >= NODE_MAJOR))
        .or_else(|| candidates.first())
        .cloned()
        .unwrap_or_else(|| PathBuf::from("node"))
}

/// The home the app opens: the user's own ~/.hobkin, the one the terminal app uses, so the app is hobkin with all
/// its routines, work and memory. HOBKIN_CLIENT_HOME points it elsewhere, such as the repository's .dev-home.
/// Only one hobkin holds a home at a time: while another process has it, the window says so and opens it once it is free.
fn home() -> Option<PathBuf> {
    std::env::var_os("HOBKIN_CLIENT_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".hobkin")))
}

/// Starts hobkin's host for this app: live, so hobkin answers with the user's own models through Pi.
/// What it prints goes to host.log in the app's log folder.
fn start_host(log_dir: Option<PathBuf>) -> Option<Child> {
    if host_already_running() {
        // A host an earlier run left behind is replaced, so starting the app always starts hobkin's host anew.
        // One somebody runs by hand is used as it is.
        match leftover_host() {
            Some(pid) => stop_leftover(pid),
            None => return None,
        }
        if host_already_running() {
            return None;
        }
    }
    let mut command = Command::new(node());
    command.current_dir(repo_root()).arg("host/src/main.ts").args(["--dev", "--live"]);
    if let Some(home) = home() {
        command.arg("--home").arg(home);
    }
    let log = log_dir.and_then(|dir| {
        fs::create_dir_all(&dir).ok()?;
        File::create(dir.join("host.log")).ok()
    });
    match log.and_then(|file| file.try_clone().ok().map(|copy| (file, copy))) {
        Some((out, err)) => {
            command.stdout(Stdio::from(out)).stderr(Stdio::from(err));
        }
        None => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }
    command.spawn().ok()
}

/// Starts the host again when the one this app started has ended by itself, as it does when the window asks it to
/// restart so it loads the code on disk (`host.restart`). The window stays open and connects to the new one. A host
/// the app stops when it quits has already been taken out of the state, so nothing is started then.
fn keep_host(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let state = app.state::<Host>();
        let mut host = state.0.lock().unwrap();
        let ended = match host.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(Some(_))),
            None => false,
        };
        if ended {
            *host = start_host(app.path().app_log_dir().ok());
        }
    });
}

/// Stops the host the way it expects, with SIGTERM, so hobkin closes cleanly and frees its home.
/// One that has not stopped after a few seconds is stopped outright.
fn stop_host(child: &mut Child) {
    let _ = Command::new("kill").arg("-TERM").arg(child.id().to_string()).status();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// How far the desktop behind the transparent window is blurred, like Ghostty's background-blur.
#[cfg(target_os = "macos")]
const BACKGROUND_BLUR_RADIUS: i32 = 20;

#[cfg(target_os = "macos")]
extern "C" {
    // Undocumented CoreGraphics calls, the ones Ghostty and Terminal.app use for a blurred translucent window.
    fn CGSDefaultConnectionForThread() -> *mut std::ffi::c_void;
    fn CGSSetWindowBackgroundBlurRadius(connection: *mut std::ffi::c_void, window: usize, radius: i32) -> i32;
}

/// Blurs what is behind the window. The window stays transparent, so the app's own background opacity decides how much shows.
#[cfg(target_os = "macos")]
fn blur_behind(window: &tauri::WebviewWindow) {
    let Ok(ns_window) = window.ns_window() else { return };
    // SAFETY: ns_window is the live NSWindow of this window; windowNumber takes no arguments and returns an NSInteger.
    unsafe {
        let ns_window = &*(ns_window as *const objc2::runtime::AnyObject);
        let number: isize = objc2::msg_send![ns_window, windowNumber];
        CGSSetWindowBackgroundBlurRadius(CGSDefaultConnectionForThread(), number as usize, BACKGROUND_BLUR_RADIUS);
    }
}

/// The menu bar: the standard Mac menus as Tauri's default gives them, with an About item that says what hobkin is,
/// who made it and where it lives, and carries the app's icon. The Mac's panel shows the name, version, copyright,
/// credits and icon; the other fields are for platforms that show them.
#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let description = "Your next level Harness.";
    let about = AboutMetadata {
        name: Some("hobkin".into()),
        version: Some(app.package_info().version.to_string()),
        authors: Some(vec!["Leonardo Pereira".into()]),
        comments: Some(description.into()),
        copyright: Some("© 2026 Leonardo Pereira".into()),
        website: Some("https://hobkin.dev".into()),
        website_label: Some("hobkin.dev".into()),
        credits: Some(format!("{description}\n\nhttps://hobkin.dev\nCreated by Leonardo Pereira")),
        icon: Some(tauri::include_image!("icons/icon.png")),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "hobkin",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&PredefinedMenuItem::close_window(app, None)?])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "Help", true, &[])?,
        ],
    )
}

#[cfg(not(target_os = "macos"))]
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    Menu::default(app)
}

/// Goes up with every move or resize of the window, so a drag is written once, when it rests.
static WINDOW_CHANGES: AtomicU64 = AtomicU64::new(0);
/// Whether a write of the window's place is already waiting for it to rest.
static WINDOW_SAVING: AtomicBool = AtomicBool::new(false);

/// Writes the window's size, position and maximized state once it has rested for a moment. The window-state plugin
/// writes them only when the app quits by itself, so a window that is killed (a development rebuild, Control+C in the
/// terminal, a crash) opened at its first size every time.
fn keep_window_place(app: &AppHandle) {
    WINDOW_CHANGES.fetch_add(1, Ordering::SeqCst);
    if WINDOW_SAVING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            let seen = WINDOW_CHANGES.load(Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(400));
            if WINDOW_CHANGES.load(Ordering::SeqCst) == seen {
                break;
            }
        }
        // Cleared first: a change that lands now starts a write of its own, and this one reads the window as it is.
        WINDOW_SAVING.store(false, Ordering::SeqCst);
        let _ = app.save_window_state(StateFlags::all());
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .menu(|app| app_menu(app))
        // Reopens the window at the size, position and maximized state it was last left in.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // The Mac's notifications for what needs the user (037-notifications).
        .plugin(tauri_plugin_notification::init())
        .manage(Host(Mutex::new(None)))
        .manage(browser::Browser::default())
        // The window's own commands: what this shell offers, notifications, and the canvas's browser (036-canvas-browser).
        // Each answers the main window's webview only.
        .invoke_handler(tauri::generate_handler![
            browser::shell_features,
            browser::browser_open,
            browser::browser_place,
            browser::browser_navigate,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_shown,
            browser::browser_close,
            notices::notice_permission,
            notices::notice_send,
        ])
        // A window that loads its page again no longer drives the browser it opened, so that browser goes.
        .on_page_load(|webview, payload| {
            if webview.label() == browser::MAIN && payload.event() == PageLoadEvent::Started {
                let app = webview.app_handle().clone();
                tauri::async_runtime::spawn(async move { browser::close(&app) });
            }
        })
        .setup(|app| {
            // Opening the app starts hobkin and its background work, as opening the terminal app does.
            let child = start_host(app.path().app_log_dir().ok());
            *app.state::<Host>().0.lock().unwrap() = child;
            keep_host(app.handle().clone());
            notices::open_on_click(app.handle());
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                blur_behind(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the window keeps hobkin working in the background. Quitting the app stops it.
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            // Where the window is and how big is written as it changes, not only when the app quits.
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => keep_window_place(window.app_handle()),
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("hobkin could not start");

    app.run(|app, event| match event {
        // The Dock icon brings the window back. It is a window, not a webview window, while the canvas's browser is open in it.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        RunEvent::Exit => {
            if let Some(mut child) = app.state::<Host>().0.lock().unwrap().take() {
                stop_host(&mut child);
            }
        }
        _ => {}
    });
}
