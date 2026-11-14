//! The PATH a release build's host runs with. An app opened from Finder gets the Mac's bare PATH, without Homebrew,
//! version managers or the user's own folders, and the host hands its PATH to everything it starts: hobkin's agents
//! run shell commands through it, and work mode starts the `pi` on it. So the host gets the PATH the user's own
//! terminal has, asked of the user's login shell once per run. A development build is started from a terminal and
//! keeps the PATH it inherits.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

/// What the shell prints around its PATH, since rc files may print other text.
const START: &str = "<hobkin-path>";
const END: &str = "</hobkin-path>";
/// The longest the app waits for the shell, at its first host start only.
const SHELL_WAIT: Duration = Duration::from_secs(5);

/// The login shell's PATH, asked once per run, or nothing when it gave none in time.
static FROM_SHELL: OnceLock<Option<OsString>> = OnceLock::new();

pub struct HostPath {
    pub path: OsString,
    from_shell: bool,
}

impl HostPath {
    /// The line host.log gets about where the PATH came from. Never the PATH itself.
    pub fn note(&self) -> &'static str {
        if self.from_shell {
            "The host's PATH is the one the login shell gives."
        } else {
            "The login shell gave no PATH in time, so the host's PATH is the usual folders and the app's own."
        }
    }
}

/// The PATH for the host. `node_folder` is the folder of the Node this build carries: it goes last, so a Mac without
/// Node still finds one for `#!/usr/bin/env node` scripts such as pi and npm, and a Mac with its own keeps using that.
pub fn for_host(node_folder: Option<&Path>) -> HostPath {
    let (folders, from_shell) = match FROM_SHELL.get_or_init(ask_login_shell) {
        Some(path) => (std::env::split_paths(path).collect(), true),
        None => (fallback(), false),
    };
    HostPath { path: combine(&folders, node_folder), from_shell }
}

/// Runs the user's shell as an interactive login shell, as a terminal does, so PATH lines in `.zshrc` and version
/// managers count. Its output is read as it comes, so a process the rc files leave holding it does not hold the app.
fn ask_login_shell() -> Option<OsString> {
    let shell = std::env::var_os("SHELL").filter(|shell| !shell.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let script = format!("printf '%s%s%s' '{START}' \"$PATH\" '{END}'");
    let mut child =
        Command::new(shell).args(["-ilc", &script]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(read) = stdout.read(&mut chunk) {
            if read == 0 || tx.send(chunk[..read].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + SHELL_WAIT;
    let mut output = Vec::new();
    let path = loop {
        if let Some(path) = marked_path(&String::from_utf8_lossy(&output)) {
            break Some(path);
        }
        let Some(left) = deadline.checked_duration_since(Instant::now()) else { break None };
        match rx.recv_timeout(left) {
            Ok(chunk) => output.extend(chunk),
            Err(_) => break marked_path(&String::from_utf8_lossy(&output)),
        }
    };
    // A shell still busy with its rc files past the time limit is stopped. One that has finished is only collected.
    let _ = child.kill();
    let _ = child.wait();
    path.map(OsString::from)
}

/// The PATH between the markers, or nothing when they are missing or the PATH between them is empty.
fn marked_path(output: &str) -> Option<String> {
    let start = output.find(START)? + START.len();
    let length = output[start..].find(END)?;
    Some(output[start..start + length].to_string()).filter(|path| !path.is_empty())
}

/// Without the shell's answer: the usual places that exist on this Mac, then the app's own PATH. The usual places come
/// first, as a terminal has them, so the user's own git or python is found before the system's.
fn fallback() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut folders: Vec<PathBuf> = usual_folders(home.as_deref()).into_iter().filter(|folder| folder.is_dir()).collect();
    if let Some(own) = std::env::var_os("PATH") {
        folders.extend(std::env::split_paths(&own));
    }
    folders
}

fn usual_folders(home: Option<&Path>) -> Vec<PathBuf> {
    let mut folders = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
    if let Some(home) = home {
        folders.extend([".local/bin", "Library/pnpm", ".npm-global/bin"].map(|folder| home.join(folder)));
    }
    folders
}

/// The folders in their order, each once, with the carried Node's folder last. A folder whose name holds the PATH's own
/// separator cannot be on a PATH, and is left out.
fn combine(folders: &[PathBuf], node_folder: Option<&Path>) -> OsString {
    let usable = |folder: &Path| !folder.as_os_str().is_empty() && !folder.as_os_str().as_encoded_bytes().contains(&b':');
    let mut kept: Vec<&Path> = Vec::new();
    for folder in folders.iter().map(PathBuf::as_path) {
        if usable(folder) && Some(folder) != node_folder && !kept.contains(&folder) {
            kept.push(folder);
        }
    }
    kept.extend(node_folder.filter(|folder| usable(folder)));
    std::env::join_paths(kept).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_path_is_taken_from_between_the_markers_whatever_the_rc_files_print() {
        let noisy = "Welcome back\n\u{1b}[32mnvm ready\u{1b}[0m\n<hobkin-path>/opt/homebrew/bin:/usr/bin</hobkin-path>Last login: today\n";
        assert_eq!(marked_path(noisy).as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(marked_path("<hobkin-path>/usr/bin</hobkin-path>").as_deref(), Some("/usr/bin"));
    }

    #[test]
    fn no_markers_or_an_empty_path_is_no_answer() {
        for output in ["", "zsh: command not found: printf\n", "<hobkin-path>/usr/bin", "/usr/bin</hobkin-path>", "<hobkin-path></hobkin-path>"] {
            assert_eq!(marked_path(output), None, "{output:?}");
        }
    }

    #[test]
    fn the_path_keeps_its_order_once_each_with_the_carried_node_last() {
        let folders: Vec<PathBuf> =
            ["/Users/someone/.nvm/bin", "/opt/homebrew/bin", "/App/Contents/Resources/node/bin", "", "/opt/homebrew/bin", "/usr/bin", "/odd:name"]
                .map(PathBuf::from)
                .to_vec();
        let path = combine(&folders, Some(Path::new("/App/Contents/Resources/node/bin")));
        assert_eq!(path, "/Users/someone/.nvm/bin:/opt/homebrew/bin:/usr/bin:/App/Contents/Resources/node/bin");
        assert_eq!(combine(&folders[..2], None), "/Users/someone/.nvm/bin:/opt/homebrew/bin");
    }
}
