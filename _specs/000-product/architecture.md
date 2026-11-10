# Architecture

Facts about hobkin and Pi in this file were read from `~/Poetry/hobkin` at commit `a78669a` and from the Pi 1.5.0 packages in its `node_modules`. File references are relative to `~/Poetry/hobkin`.

## Processes

    Tauri shell (Rust)  ── starts, stops, re-attaches ──▶  Host (Node)
          │                                                  │ imports
          │ webview                                          ▼
          ▼                                              hobkin application
        UI (React)  ◀──── WebSocket on 127.0.0.1 ────▶   (Pi SDK, Pi Durable, ~/.hobkin)

- The shell owns the window. It starts the host, hands the webview the host's address and token, and decides what happens to the host when the window closes.
- The host is a Node process. It imports `HobkinApplication` from hobkin and exposes it over a local WebSocket. It holds hobkin's lock on the home.
- The UI is a React app. It renders the state the host sends and sends commands back. It holds no credentials.
- During development the UI also runs in a normal browser against the same host, so most work needs no Tauri build.

## Repository layout

    _specs/        specs (see _specs/README.md)
    ui/            React app (Vite root)
    host/          Node host
    shared/        code used by both: protocol types, command registry, review model, spec parser
    src-tauri/     Rust shell

One package, one lockfile. The host runs TypeScript directly with Node.

## How the client uses hobkin

- `HobkinApplication.open(root, options)` (`src/cli/application.mjs:142`) is the entry. It never imports the terminal UI. `src/cli/main.mjs:120-164` shows the full wiring the terminal app uses, and the host mirrors it.
- hobkin calls the front end through options: `onChange(snapshot)`, `askQuestion(request, signal)`, `showDone(row)`, `showRow({tab, report})`, `presence()`.
- The front end calls hobkin through methods: `send(text, report, images)`, `interrupt()`, `clear(ids)`, `reset()`, `kill(runId)`, `reportRead`, `workAction(...)`, `toggleLearning()`, `draftFeedback`, `sendFeedback`, and the quit handler.
- The snapshot is one plain object (`src/cli/application.mjs:513-553`): `messages`, `reports`, `runs`, `context`, `usage`, `busy`, `doing`, `decisions`, `waiting`, `work`, `schedules`, `main`, `error`, `connection`, `mood`, `jobActivity` and more. The UI state is a function of it.
- `open` accepts replacements for the model and the job runner (`createMain`, `runHarness`), which hobkin's own tests use. The host uses the same seam for the scripted model in development.
- Background jobs are Pi RPC child processes (`src/cli/harnesses.mjs:72`). Their activity reaches the snapshot as `jobActivity`.

### Planned changes inside hobkin

Small and additive, on a branch named `client-host` in the hobkin repo, for the user to review. Each one is listed in the spec that needs it.

- Let a front end receive the main session's raw events (text deltas, tool calls). Today the terminal app reduces them to one word (`src/cli/runtime.mjs:175`, `src/cli/doing.mjs`).
- Let a front end add tools to the main session, for the `client` and `canvas` tools.
- Accept image bytes from the front end without the native clipboard (`src/cli/paste-image.mjs` reads the clipboard through pi-tui).
- Run delegated sessions and work agents without Herdr panes where they need panes today.
- Teach the work prompts to write `_specs/` in projects (`015-specs-in-projects`).
- Add `tiers` to hobkin's config and a `--tier` flag to `hobkin session`, and map work levels to tiers (`017-model-tiers`).
- Add hobkin's own `teams.md` and `team-leader.md` prompts (`018-teams-guidance`).

## Protocol between UI and host

JSON messages over one WebSocket. Version 1. Types live in `shared/protocol`.

| Message | Direction | Purpose |
| --- | --- | --- |
| `hello` | host to UI | Protocol version, home, owner state, sign-in state, saved view state |
| `state` | host to UI | Snapshot changes, sent per top-level key. Messages arrive as append and update operations |
| `turn` | host to UI | Live events of the main turn: text delta, thinking, tool start and end |
| `ask` | host to UI | A question from hobkin with numbered choices |
| `command` / `result` | UI to host, and back | Run a named command and get its result |
| `view-command` / `view-result` | host to UI, and back | Run a command that acts on the window, on behalf of hobkin |
| `view-state` | UI to host | What the user is looking at: screen, review, step, focused node |
| `presence` | UI to host | Focus, typing and last input, for hobkin's presence rules |

### Commands

Every action in the UI is a command in one registry (`shared/commands`): a name, a description, a schema for its arguments, and where it runs (host or view). The UI calls commands for clicks and keys. hobkin calls the same commands through a tool. See `013-hobkin-access`.

## Data

The home is `~/.hobkin`, or `HOBKIN_HOME`, or `--home` (`src/cli/config.mjs:9`, `src/cli/main.mjs:26`).

The client reads and writes hobkin's data only through hobkin's code. It adds three things of its own:

| Path under the home | Content |
| --- | --- |
| `client/state.json` | Where the user left off: screen, sidebar section, divider, open review and step, drafts |
| `client/host.json` | Pid, port and token of a running host, mode 0600, so the shell can re-attach |
| `canvas/<id>.json` | Pages hobkin draws |
| `work/<slug>/reviews/<item>/` | Prepared reviews, notes and progress for a finished change |

### One owner per home

hobkin locks `<home>/runtime` with a lock that goes stale after 5 minutes (`src/cli/runtime.mjs:64`). A second owner gets "Hobkin is already running for this home." The host takes this same lock. When the terminal app holds it, the client shows the last saved snapshot (`runtime/view.json`) read-only and connects when the lock is free.

### Pi Durable

hobkin uses Pi Durable as a transactional document store in `runtime/hobkin.sqlite` (`src/cli/runtime.mjs:79`). A run is admitted before its work starts and finished before it is reported. After a crash, a run without a receipt becomes `interrupted` and is never replayed (`src/cli/runtime.mjs:86-100`).

The client keeps this contract. Long work the client starts, such as preparing a review, goes through hobkin's `runtime.dispatch`, so it gets the same receipts. The client opens no second Durable storage, because one process owns a storage at a time.

### Development home

- The host defaults to `<repo>/.dev-home` in development and refuses `~/.hobkin` unless `--home` names it.
- The model is scripted by default: a fake main session and job runner that stream canned replies. A real model needs `--live`.
- Tests use temporary homes.

## Sign-in

Pi owns credentials. The host calls `ModelRuntime.login(provider, 'oauth', interaction, { getDeviceId })` and carries the interaction over the socket: an `auth_url` to open, an optional pasted redirect URL, progress lines, cancel. Pi listens on `127.0.0.1:1455` for the callback and writes `~/.pi/agent/auth.json` with mode 0600. Tokens never reach the UI. See `004-signin`.

## Security

- The host binds `127.0.0.1` on a random port and requires a random token created at launch. It checks the WebSocket origin against an allowlist.
- The UI receives no tokens or keys. Messages are scanned in tests for credential fields.
- Model text and tool output are rendered as text or sanitized Markdown. Raw HTML is never inserted.
- Pages hobkin draws are typed blocks. They cannot carry script or load remote content.
- The webview's content security policy allows the app's own files and the local host only.
- Commands that act outside the client (merge, run a routine, send feedback) keep hobkin's existing confirmation rules, whoever calls them.

## Risks

- Pi Durable is marked experimental and its API can change between releases. hobkin pins Pi at 1.5.0, and the client follows hobkin's pin.
- Blur on many nodes can be slow in the system webview. `006-review-graph` sets a frame-time budget and measures it in the Tauri window.
- The sign-in callback needs port 1455, which the Codex CLI also uses.
- A packaged app started from Finder does not inherit the shell's `PATH`, so it may not find `node` or `pi`. See `016-packaging`.
