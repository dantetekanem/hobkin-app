//! The host's address file, `client/host.json` in hobkin's home. A host writes it once it listens, with its process id,
//! its port and the token a window must present, and removes it when it stops (host/src/host-file.ts). A release build's
//! host listens on a port of its own choosing, so this file is the only place that says where it is: the app reads it to
//! tell whether a host already serves the home, and hands the window the address from it.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Runtime, Webview};

use crate::browser::from_main;

/// How long the window's question waits for a host that has just started and not yet written its file.
const HOST_WAIT: Duration = Duration::from_secs(10);

/// What a host writes about itself.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct HostFile {
    pub pid: u32,
    pub port: u16,
    pub token: String,
}

/// What the window needs to reach the host: its socket's address and the token to present.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Address {
    url: String,
    token: String,
}

impl HostFile {
    fn address(&self) -> Address {
        Address { url: format!("ws://127.0.0.1:{}", self.port), token: self.token.clone() }
    }
}

fn file_in(home: &Path) -> PathBuf {
    home.join("client").join("host.json")
}

fn parse(text: &str) -> Option<HostFile> {
    serde_json::from_str(text).ok()
}

/// The host this home's file names, whether or not that process still runs.
pub fn read(home: &Path) -> Option<HostFile> {
    parse(&fs::read_to_string(file_in(home)).ok()?)
}

/// A process's parent and command, or nothing once it has gone.
pub fn process(pid: u32) -> Option<(u32, String)> {
    let output = Command::new("ps").args(["-o", "ppid=,command=", "-p", &pid.to_string()]).output().ok()?;
    parse_process(&String::from_utf8(output.stdout).ok()?)
}

fn parse_process(line: &str) -> Option<(u32, String)> {
    let (parent, command) = line.trim().split_once(char::is_whitespace)?;
    Some((parent.parse().ok()?, command.trim().to_string()))
}

/// The host serving this home: the one its file names, while that process runs. A file left by a host that died is
/// ignored, as the host itself ignores it when it starts (`runningHost`).
pub fn running(home: &Path) -> Option<HostFile> {
    read(home).filter(|host| process(host.pid).is_some())
}

fn wait_for(home: &Path, within: Duration) -> Option<HostFile> {
    let deadline = Instant::now() + within;
    loop {
        if let Some(host) = running(home) {
            return Some(host);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Where the window reaches the host, or nothing when no host serves the home. A host the app has only just started
/// writes its file a moment later, so this waits a while for it. The wait runs off the main thread, which draws the
/// window.
#[tauri::command]
pub async fn host_address<R: Runtime>(webview: Webview<R>) -> Result<Option<Address>, String> {
    from_main(&webview)?;
    let Some(home) = crate::home() else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || wait_for(&home, HOST_WAIT).map(|host| host.address()))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_file_gives_the_window_its_socket_and_token() {
        let host = parse("{\"pid\":4242,\"port\":51234,\"token\":\"abc_-1\"}\n").unwrap();
        assert_eq!(host, HostFile { pid: 4242, port: 51234, token: "abc_-1".into() });
        assert_eq!(
            serde_json::to_value(host.address()).unwrap(),
            serde_json::json!({ "url": "ws://127.0.0.1:51234", "token": "abc_-1" })
        );
    }

    #[test]
    fn a_file_cut_short_or_missing_a_field_names_no_host() {
        for broken in ["", "{\"pid\":4242,\"port\":51", "{\"pid\":4242,\"port\":51234}", "{\"pid\":-1,\"port\":1,\"token\":\"t\"}"] {
            assert_eq!(parse(broken), None, "{broken}");
        }
    }

    #[test]
    fn a_process_line_gives_its_parent_and_command() {
        assert_eq!(parse_process("    1 node host/src/main.ts --live\n"), Some((1, "node host/src/main.ts --live".into())));
        assert_eq!(parse_process(""), None);
    }

    #[test]
    fn a_home_has_a_host_only_while_its_file_names_a_running_process() {
        let home = std::env::temp_dir().join(format!("hobkin-shell-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        assert_eq!(running(&home), None);
        assert_eq!(wait_for(&home, Duration::ZERO), None);

        // This test's own process stands in for a running host.
        fs::create_dir_all(home.join("client")).unwrap();
        let file = format!("{{\"pid\":{},\"port\":51234,\"token\":\"t\"}}", std::process::id());
        fs::write(file_in(&home), file).unwrap();
        assert_eq!(running(&home).map(|host| host.port), Some(51234));
        let _ = fs::remove_dir_all(&home);
    }
}
