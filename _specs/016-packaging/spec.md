---
{
  "id": "016-packaging",
  "title": "A packaged Mac app",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host", "004-signin", "014-continuity"],
  "updated": "2026-11-09"
}
---
# A packaged Mac app

## Outcome

`pnpm tauri build` produces an app the user opens from the Dock. It finds what it needs, starts its host and opens on the real home.

## Decisions

- The first packaged build is for this Mac only: Apple silicon, unsigned, not notarized, no updater.
- The app starts the host with the Node it finds on the machine, as the terminal app requires Node and Pi today. An app started from Finder does not inherit the shell's `PATH`, so the shell asks the user's login shell once for the paths of `node` and `pi` and remembers them.
- The host's JavaScript and hobkin's source ship inside the app as resources, pinned to the hobkin commit the build used.
- The packaged app opens `~/.hobkin`. Only development builds default to the separate home.
- If Node or Pi is missing or too old, the app says which one, the version it needs and the install command, and does nothing else.

## Out of scope

- Signing, notarization, an updater and a download page.
- Intel Macs.
- A single binary with Node inside. The open question covers it.

## Acceptance

- A1. `pnpm tauri build` produces an `.app` that opens from Finder and shows the frame within 3 seconds on this Mac.
- A2. Started from Finder, the app finds `node` and `pi` although Finder's `PATH` lacks them.
- A3. With Node missing or older than 22.19, the app shows a screen naming Node, the needed version and how to install it.
- A4. With Pi missing or at a different version than hobkin pins, the app shows the same kind of screen for Pi.
- A5. The packaged app opens `~/.hobkin` and shows the user's real conversation.
- A6. Quitting the app with nothing running leaves no host process behind.

## Proof

- A1. check: build, open from Finder, time the first frame.
- A2. check: open from Finder and read the host's startup line in the app's log.
- A3. `src-tauri` test › "reports a missing or old node"
- A4. `src-tauri` test › "reports a missing or mismatched pi"
- A5. check: open the packaged app with the terminal app closed.
- A6. check: quit, then `pgrep -f hobkin-client-host` prints nothing.

## Steps

- [ ] S1 (A2, A3, A4). Shell: find and verify `node` and `pi`, with the missing-tool screens.
- [ ] S2 (A1, A5). Bundle the host and the pinned hobkin source as resources. The packaged default home.
- [ ] S3 (A6). Process cleanup on quit.

## Open questions

- Bundle Node inside the app (a larger download, nothing to install) or keep requiring it (small, matches the terminal app)? This spec keeps requiring it.
- hobkin is not published to a registry. The build copies it from the local checkout at a recorded commit. A published package would be cleaner once hobkin has releases.
