---
{
  "id": "073-windows-linux",
  "title": "hobkin on Windows and Linux",
  "kind": "work",
  "status": "draft",
  "depends": [],
  "updated": "2026-11-26"
}
---
# hobkin on Windows and Linux

## Outcome

The app installs and runs on Windows x64 and Linux x64 the way it does on a Mac: the window starts its host, the host opens hobkin, agents run Pi with its bash tool, the first-run setup gets the dependencies, and updates arrive through the same feed. Mac builds stay as they are.

The user, 2026-11-25: "can i have tauri compiling for windows/linux? for hobkin. and also the dependencies", then "i just want to know if can, write a plan, that is enough" and "not now for windows/linux". So this is a plan only: it can be done, and nothing here is built yet. Paths below are from a read-only survey of hobkin-client (C) and hobkin (H) on 2026-11-25.

## Decisions

### It can be done

Most of the Rust is already behind macOS-only switches (`src-tauri/src/backdrop.rs`, `notices.rs:24` and `:136`, `browser.rs:122`, `:154` and `:474`, `lib.rs:242` and `:307`), so the app should compile for Windows and Linux with warnings only; `cargo check` for those targets has not been run. The staged `app/` tree has no symlinks, its longest path is 159 characters, and pi-tui ships Linux and Windows binaries. Pi is plain JavaScript and WebAssembly, so only the bundled Node differs per system. The setup uses no Homebrew.

### What breaks the build

- `scripts/package/tauri.release.conf.json` builds only `app` and `dmg`, has a `macOS` block and points its resources at `dist/package/node/`. Windows needs a `tauri.windows.conf.json` (NSIS) and Linux a `tauri.linux.conf.json` (AppImage and deb).
- `stage.ts:46` and `:252-281` and `rules.ts:249-262` expect an arm64 Mac Node, run codesign and otool, and use `node/bin/node`. Each target downloads its own Node from nodejs.org and checks it against SHASUMS256, as `host/src/pi/node.ts` already does.
- `release.ts:26-55` (Info.plist, .dmg, .app.tar.gz) and `feed.ts:13` and `:49` (`darwin-${Chip}`) need Windows and Linux entries; the updater's platform keys are `windows-x86_64` and `linux-x86_64`.
- The repository has no workflows. hobkin's runtime is inside it, in `packages/hobkin` (`link:packages/hobkin` in `package.json`), so a build clones one repository.

### What breaks running on Windows

- `lib.rs:155` reads `HOME`, which Windows does not set, so the window never finds the host's address.
- `host_file.rs:55` runs `ps`; the `sysinfo` crate replaces it.
- `login_path.rs:114` drops every folder with a `:` in its name, which empties PATH; Windows skips the login shell.
- `lib.rs:95` and `:109` look for `node` and `node/bin/node`; on Windows it is `node.exe` at the top.
- The host is stopped and restarted with signals (`lib.rs:73`, `:77`, `:227` run `kill -TERM`; `main.ts:125` listens for signals; `host.ts:727` and `:962` signal themselves). Windows needs a quit message or a closed stdin, and a Job Object so the whole process tree ends with the app.
- `updates.rs:69` calls `download_and_install`, which on Windows ends in `std::process::exit(0)`: the app would quit mid-session and leave `node.exe` locked. Download in the background, install on Restart, stop the host before exit.
- No `CREATE_NO_WINDOW` (`lib.rs:173`) and no `windowsHide` on about 100 spawns, so console windows flash.
- 22 `mode & 0o077` checks in 14 runtime files (for example `H/src/cli/migration/admission.mjs:30`, `reports.mjs:149`) and the `getuid` checks (`reminders.ts:16`, `appearance-file.ts:86`) always fail on Windows.
- Bare `pi` (`launcher.mjs:32`), `qmd` (`memory-index.mjs:236`) and `npm` (`pi/install.ts:58`) are `.cmd` shims there and do not start without a shell.
- `shell.mjs:18` runs `bash -lc`, which may reach WSL's bash or nothing.
- `rpc-process.mjs:9` leaves Pi's bash children running; Windows needs `taskkill /T /F`.
- `open.ts:28` and `signin.ts:18` use `xdg-open`, so sign-in opens no browser.
- `files.ts:23` and `:88` list programs that must never open, without `.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk` or `.msi`. This is a safety gap to close before any Windows build.
- `assessment.ts:377` `symlinkSync` fails with EPERM; junctions work.
- `lib.rs:307` `Menu::default` draws a menu bar inside the window.

### What breaks running on Linux

- `lib.rs:55` expects a leftover host's parent to be 1, but orphans go to `systemd --user`, so a leftover host is never replaced.
- Child webviews are packed into a GTK box, so the canvas browser lands in the wrong place; `shell_features` returns `browser: false` there.
- The app needs webkit2gtk-4.1 and GTK 3.

### Dependencies

- Both systems bundle the whole Node (26.3.1, with npm), replacing the Mac-only step that installs hobkin's own Node (`pi/node.ts:37`). Pi runs from the bundle (`node …/pi-coding-agent/dist/bundle/cli.js`), not a global `npm -g` install. qmd and pi-coder install with npm under `~/.hobkin`, since the bundle is read-only.
- Pi needs Node 22.19 or newer. On native Windows its bash tool runs through Git Bash (`shellPath`, then `%ProgramFiles%\Git\bin\bash.exe`, then `bash.exe` on PATH); PowerShell is optional and WSL is an alternative. Linux needs nothing more.
- Windows setup offers to install Git for Windows (git and Pi's bash) and gh with `winget`, only once the user agrees. WebView2 comes with the NSIS installer.
- Linux: the deb declares webkit2gtk; setup shows the apt or dnf commands for git, gh and zip and never runs sudo.

### How to build

Recommended: GitHub Actions with tauri-action, `windows-latest` for NSIS and `ubuntu-22.04` for AppImage and deb, while Mac builds stay local. About 15 Linux and 25 Windows minutes (billed at twice the rate), roughly 65 billed minutes a release, inside the free 2,000. Cross-compiling from the Mac is possible but poor: cargo-xwin is experimental and makes NSIS only, and Linux in Docker runs emulated and slowly. No route tests the app, so a Windows and a Linux machine (or VMs) are needed either way.

### Worth doing, not required

- `⌘` appears 57 times and `metaKey` throughout; one place (`ui/src/app/keys.ts:237`) can map it to the system's key.
- About 190 strings say "this Mac" or "the Mac" (for example the first-run story, `story.ts:190-200`).
- The 88 px gap for the Mac's window buttons (`ui/index.html:17`) and a transparent window with no blur.
- The folder picker (`folder-pick.ts:17`, tauri-plugin-dialog instead), `caffeinate` and `taskpolicy` (`stay-awake.mjs`, `priority.mjs`), zip and unzip in `backup.ts:292`, and the Java/TLC download tables, which cover the Mac only (`proof/tools.mjs:32-57`).

## Out of scope

- Signing for Windows (SmartScreen warns about an unsigned app, as the Mac alpha is unsigned too) until the user decides to pay for it.
- arm64 builds for Windows and Linux.
- WSL as the place hobkin runs.

## Acceptance

- A1. A Windows x64 NSIS installer and a Linux x64 AppImage and deb are built from exported commits of hobkin-client and hobkin.
- A2. On Windows and on Linux the window starts its host, connects, and restarts the host on the user's word; quitting leaves no host or Pi process behind.
- A3. A work agent and a durable hobkin run Pi with its bash tool on both systems.
- A4. The first-run setup reports each dependency on both systems and installs only with the user's agreement.
- A5. An installed Windows or Linux app updates from `latest.json` without quitting mid-session.
- A6. On Windows a click on a link to a program file (`.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk`, `.msi`) never opens it.

## Proof

- A1. check: the workflow's run builds each package from the two exported commits.
- A2. check: start, restart and quit on a Windows and a Linux machine, then list the processes left.
- A3. check: one agent and one durable hobkin run a bash command on each system.
- A4. check: first run on a clean Windows and a clean Linux machine.
- A5. check: install one version, publish the next, and see the app offer the restart.
- A6. A test of the file-open rule with each of those names.

## Steps

- [ ] S1 (A6). Close the safety gap first: program file names that must never open on Windows.
- [ ] S2 (A2). Start, stop and restart the host without signals, with a Job Object, `HOME`, PATH, `ps` and `node.exe` handled in the Rust shell.
- [ ] S3 (A3). The runtime on Windows: shims through their `.cmd`, Git Bash for Pi, `taskkill` for process trees, the mode and uid checks, junctions, `windowsHide`.
- [ ] S4 (A2, A3). Linux: the leftover host, the canvas browser, the WebKitGTK dependency.
- [ ] S5 (A1, A5). Packaging: Node per target, Tauri config per system, release and feed entries, the GitHub Actions workflow.
- [ ] S6 (A5). The updater installs on Restart, not mid-session.
- [ ] S7 (A4). Setup's dependency rows and installs on both systems.

## Open questions

- Build in GitHub Actions with the updater key as a secret, or let CI build and sign the update files on the Mac?
- AppImage and deb both, or one Linux format?
- What should the `⌘` keys become: Ctrl, with clashes moved, or another key?
- A native title bar, or a frameless window with hobkin's own controls?
- Keep a global `pi` as an option, or the bundled Pi only?
