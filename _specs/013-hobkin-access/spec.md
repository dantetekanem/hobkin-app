---
{
  "id": "013-hobkin-access",
  "title": "hobkin drives the app and draws on the canvas",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host", "003-chat"],
  "updated": "2026-11-09"
}
---
# hobkin drives the app and draws on the canvas

## Outcome

hobkin has the whole client in reach. It can do anything the user can do in the window: open a screen, walk a review, add a note, change a routine. It can also put its own pages on the canvas, drawn with the client's components. The user sees every move as it happens and can take the wheel back with one click.

## Decisions

### Driving the app

- One registry in `shared/commands` holds every command: a name, a one-line description, a schema for its arguments, where it runs (host or view), and whether it acts outside the client.
- The UI's own clicks and keys call these commands. A UI action without a registered command does not exist, so hobkin can never be behind the user.
- hobkin gets one tool, `client`, with four actions: `list`, `describe {name}`, `run {name, args}` and `state`. `state` returns what the user is looking at: screen, sidebar section, open review, step, focused node, open page.
- A view command runs in the open window and returns the new view state. With no window open it fails and says so.
- The user's next message carries a one-line summary of the view, so "explain this" has a subject.
- Every command hobkin runs shows in the window as it happens, as a short line near the avatar ("hobkin opened Routines"). Any click or key from the user stops a sequence hobkin is running.
- Commands that act outside the client (merge, run a routine, send feedback) keep the confirmation rules hobkin's own tools have today.

### Drawing on the canvas

- A page is a file, `canvas/<id>.json` under the home: `{ version: 1, id, title, updatedAt, by, blocks: [] }`.
- Block types in the first version: `text` (Markdown), `table`, `list` (with optional checkboxes), `stat` (a number with a label), `timeline`, `board` (columns of cards), `graph` (nodes and wires, drawn by the Change Review renderer), `code`, `diff`, and `image` (a file under the home).
- hobkin gets one tool, `canvas`, with `write {id, title, blocks}`, `patch {id, ops}`, `open {id}` and `remove {id}`.
- A page is data. It cannot contain HTML, script or remote addresses. The host validates a page before saving and refuses one over 256 KiB.
- The Pages tab lists pages, newest first. A page hobkin just wrote opens when hobkin asks, with the same transition as any screen.
- When an open page changes, the changed blocks animate in place.

## Out of scope

- hobkin changing the client's source code.
- Mods loaded at runtime.
- Interactive pages that run their own logic.

## Acceptance

- A1. `client list` returns every command with its description and argument schema. A check fails the build when a UI action calls something that is not in the registry.
- A2. hobkin running `screen.open` with `{ "screen": "routines" }` switches the canvas with the same transition as a click, and the result holds the new view state.
- A3. hobkin can open a review, move through its steps, focus a node, open its code and add a note, each through a command.
- A4. `client state` returns the screen, the open review with its step and focused node, and the open page, matching what the window shows.
- A5. While hobkin runs view commands, each one shows as a line near the avatar. A click or key from the user stops the remaining ones, and hobkin's tool call returns that the user took over.
- A6. A command marked as acting outside the client asks for the same confirmation when hobkin runs it as hobkin's own tool for that action does.
- A7. Writing a page makes it appear under Pages within 1 second, and each block type renders. An invalid page is refused with the reason, and the previous version stays.
- A8. Updating an open page changes only the blocks that differ, in place, without reloading the page.
- A9. A page whose text block contains `<script>` and whose image block names a remote address shows the script as text and refuses the image.
- A10. With no window open, a view command fails with a message that says the window is closed, and a host command still runs.

## Proof

- A1. `shared/test/commands.test.ts` › "every UI action is a registered command"
- A2. `host/test/client-tool.test.ts` › "a view command round trips and returns view state"
- A3. `host/test/client-tool.test.ts` › "walks a review through commands"
- A4. `host/test/client-tool.test.ts` › "state mirrors the last view-state"
- A5. `ui/test/takeover.test.ts` › "user input cancels a running sequence"
- A6. `host/test/client-tool.test.ts` › "outside actions keep their confirmation"
- A7. `host/test/canvas.test.ts` › "validates, saves and announces a page"
- A8. `ui/test/pages.test.ts` › "patches changed blocks in place"
- A9. `host/test/canvas.test.ts` › "refuses script and remote content"
- A10. `host/test/client-tool.test.ts` › "view commands need a window"

## Steps

- [ ] S1 (A1). The registry, and moving every existing UI action onto it, with the build check.
- [ ] S2 (A2, A4, A10). View commands and view state over the socket.
- [ ] S3 (A2, A3, A6). The `client` tool. hobkin branch `client-host`: let a front end add tools to the main session.
- [ ] S4 (A5). The trace near the avatar and the takeover rule.
- [ ] S5 (A7, A9). Page files, validation and the `canvas` tool.
- [ ] S6 (A7, A8). The Pages tab and the block renderers.
