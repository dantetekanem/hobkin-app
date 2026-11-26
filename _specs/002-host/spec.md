---
{
  "id": "002-host",
  "title": "Host: hobkin behind a local socket",
  "kind": "work",
  "status": "doing",
  "depends": ["001-foundation"],
  "updated": "2026-11-26"
}
---
# Host: hobkin behind a local socket

## Outcome

A Node process opens hobkin's application for a home and serves it to the UI over a local WebSocket. The frame from `001-foundation` then shows live hobkin state instead of sample data. In development the host uses a separate home and a scripted model, so nothing touches the user's real data or spends tokens.

## Decisions

- The host imports `HobkinApplication` from hobkin's runtime in this repository, `packages/hobkin`, linked as a dependency (`link:packages/hobkin`). It mirrors the wiring in hobkin's `src/cli/main.mjs:120-164`.
- It binds `127.0.0.1` on a random port. A random token is created at launch. A connection must present the token and come from an allowed origin.
- It writes `client/host.json` in the home (pid, port, token, mode 0600) and removes it on exit.
- Protocol version 1, as listed in `000-product/architecture.md`. Snapshot changes are sent per top-level key. Messages are sent as append and update operations, so a long history is not resent on every token.
- Every action is a command from the registry in `shared/commands`. The host validates arguments against the command's schema before running it.
- One owner per home. If hobkin's lock is held, the host serves the last saved snapshot (`runtime/view.json`) as read-only and retries until the lock is free.
- In development the home defaults to `<repo>/.dev-home`, the model is scripted, and `~/.hobkin` is refused unless `--home` names it. `--live` switches to the real model. `pnpm host:live` starts the real model on `.dev-home`.
- A home that is not the real one, live or scripted, is kept to itself. At every open its usage upload is turned off if it is on, and the `fetch` hobkin gets refuses, so the home never enrolls with hobkin's server or sends it anything. hobkin, and every process it starts, sees no `HERDR_` variable, so nothing acts on the user's Herdr panes. `HOBKIN_HOME` names the served home, so a `hobkin` command an agent runs without `--home` lands there and never in `~/.hobkin`. Only the real home, live, keeps all three.
- A conversation the scripted model answered last goes on, live, with the model Pi picks for a new conversation: Pi's saved default when Pi can use it, then Pi's own pick. Any other model Pi cannot restore stays hobkin's to refuse, as in the terminal, because the conversation would go to a provider it never went to.
- The Tauri shell starts the host, waits for it to be ready and gives the webview its address and token.
- hobkin changes on branch `client-host`: an option on `HobkinApplication.open` that delivers the main session's events to the front end.

## Out of scope

- Sign-in (`004-signin`) and the conversation UI itself (`003-chat`).
- Keeping the host alive after the window closes (`014-continuity`).
- Two front ends on one home at the same time.

## Acceptance

- A1. Starting the host on an empty home creates the home, and the UI shows hobkin's first-run state within 2 seconds, using the scripted model.
- A2. A command sent from the UI runs in hobkin, and the resulting state change reaches the UI without a reload. A command with arguments that fail its schema is rejected with the reason, and hobkin is not called.
- A3. Stopping the host while a run is active, then starting it again, shows that run as interrupted. The run is not started a second time.
- A4. While another process holds the home's lock, the UI shows the last saved state as read-only with a notice that names the terminal app. Within 5 seconds of the lock being released the UI is live, with no action from the user.
- A5. A connection without the token is refused. A connection from an origin outside the allowlist is refused.
- A6. After the host restarts, the UI reconnects by itself and shows current state.
- A7. In development, starting the host without `--home` never opens `~/.hobkin`, and starting it with `--home ~/.hobkin` prints that it is using the real home.
- A8. Main-session events reach the UI as `turn` messages in the order Pi emitted them.
- A9. Live on a development home, hobkin never reaches hobkin's server: upload is off after every open, even in a home that had it on, and the `fetch` it gets refuses an enrollment.
- A10. Live on a development home started inside Herdr, hobkin runs no `herdr` command, nothing reaches Herdr's socket, and a `hobkin` command its agent runs without `--home` lands in the served home, never in `~/.hobkin`.
- A11. Live on a development home whose conversation the scripted model answered, the conversation goes on with Pi's saved default model, which the `models` slice lists. A new conversation starts on it too.

## Proof

- A1. `host/test/host.test.ts` › "opens an empty home and sends the first state"
- A2. `host/test/commands.test.ts` › "runs a valid command and rejects invalid arguments"
- A3. `host/test/recovery.test.ts` › "marks an unfinished run interrupted and does not replay it"
- A4. `host/test/lock.test.ts` › "serves the saved view while locked and goes live when released"
- A5. `host/test/auth.test.ts` › "refuses a missing token and a foreign origin"
- A6. `ui/test/connection.test.ts` › "reconnects and replaces stale state"
- A7. `host/test/home.test.ts` › "refuses the real home without --home"
- A8. `host/test/turn.test.ts` › "forwards main-session events in order"
- A9. `host/test/live.test.ts` › "a live host on a development home goes on with the model Pi picks, and never reaches hobkin's server"
- A10. `host/test/live.test.ts` › "a live host started inside Herdr touches no pane, and what its agent runs stays in its home"
- A11. `host/test/live.test.ts`, both tests: the first for the scripted conversation, the second for a new one.

## Steps

- [ ] S1 (A5, A7). Host entry: arguments, home resolution with the development guard, token, origin check, `client/host.json`.
- [ ] S2 (A1, A2). Open hobkin's application with the scripted model and wire `onChange`, the command registry and results.
- [ ] S3 (A2, A6). UI connection: socket client, state store fed by `state` messages, reconnect.
- [ ] S4 (A3, A4). Lock handling, the read-only saved view, and recovery after a stop.
- [ ] S5 (A8). hobkin branch `client-host`: deliver main-session events. Forward them as `turn` messages.
- [ ] S6 (A1). Tauri shell starts and stops the host and passes the address and token to the webview. Started 2026-11-10 (src-tauri/src/lib.rs): opening the app starts the host live, on the user's own ~/.hobkin (the user's call, 2026-11-10) unless HOBKIN_CLIENT_HOME names another such as .dev-home; while the terminal app holds that home the window is read-only until it closes there; and uses a host that is already serving instead of starting a second; closing the window hides it and hobkin keeps working; the Dock icon brings it back; quitting stops the host with SIGTERM, outright after five seconds. Its output goes to ~/Library/Logs/dev.hobkin.client/host.log. Seen: the app's process is the host's parent. Left: the address handed to a built app (`window.__HOBKIN_HOST__`, no dev handshake), Node and the host in the app bundle (016), and quitting seen by hand.
- [x] S7 (A9, A10, A11). Live on a development home: upload off and `fetch` refused, no Herdr variables, `HOBKIN_HOME` pinned, and Pi's pick for a scripted conversation. Tested through real Pi against a model server on this machine.

## Open questions

- hobkin is not published to a registry. The client links to the local checkout for now. A packaged app needs a pinned copy (see `016-packaging`).
