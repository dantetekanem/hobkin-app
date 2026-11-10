use std::fs::{self, File};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WindowEvent};

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

/// Node: the one on the PATH when the app starts from a terminal, else Homebrew's when it starts from Finder.
fn node() -> PathBuf {
    let on_path = std::env::var_os("PATH").and_then(|path| std::env::split_paths(&path).map(|dir| dir.join("node")).find(|candidate| candidate.is_file()));
    on_path
        .or_else(|| ["/opt/homebrew/bin/node", "/usr/local/bin/node"].iter().map(PathBuf::from).find(|candidate| candidate.is_file()))
        .unwrap_or_else(|| PathBuf::from("node"))
}

/// The home the app opens: the user's own ~/.hobkin, the one the terminal app uses, so the app is hobkin with all
/// its routines, work and memory. HOBKIN_CLIENT_HOME points it elsewhere, such as the repository's .dev-home.
/// Only one hobkin holds a home at a time: while the terminal app has it, the window is read-only until it closes there.
fn home() -> Option<PathBuf> {
    std::env::var_os("HOBKIN_CLIENT_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".hobkin")))
}

/// Starts hobkin's host for this app: live, so hobkin answers with the user's own models through Pi.
/// What it prints goes to host.log in the app's log folder.
fn start_host(log_dir: Option<PathBuf>) -> Option<Child> {
    if host_already_running() {
        return None;
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

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Host(Mutex::new(None)))
        .setup(|app| {
            // Opening the app starts hobkin and its background work, as opening the terminal app does.
            let child = start_host(app.path().app_log_dir().ok());
            *app.state::<Host>().0.lock().unwrap() = child;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps hobkin working in the background. Quitting the app stops it.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("hobkin could not start");

    app.run(|app, event| match event {
        // The Dock icon brings the window back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_webview_window("main") {
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
