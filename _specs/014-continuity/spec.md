---
{
  "id": "014-continuity",
  "title": "Continuity",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host", "003-chat"],
  "updated": "2026-11-09"
}
---
# Continuity

## Outcome

Nothing is lost between sittings or between front ends. The app reopens where the user left it. Work that was running survives closing the window, and a crash never repeats work. Each run still inherits its own memory. The terminal app and the client show the same hobkin.

## Decisions

### Reopen where the user left off

- The host keeps `client/state.json` in the home: the screen, the sidebar section, the divider position, the open review with its step and camera, the code panel's height and whether it is open, the open page, and the unsent text in the input.
- The host sends this state in `hello`, and the UI restores it before its first paint.
- The UI saves changes through one command, at most twice a second.

### Work survives a quit

- hobkin's receipts stay the rule: a run is admitted before it starts and finished before it is reported, and a run without a receipt becomes interrupted and is never replayed.
- Closing the window while agents or routines are running asks one question with two answers: keep working in the background, or stop the work and quit. The terminal app asks the same question for agents in panes.
- "Keep working" closes the window and leaves the host running. Opening the app again attaches to that host through `client/host.json`.
- "Stop the work" interrupts the runs, waits for their receipts and exits the host.
- With nothing running, closing the window exits the host.
- While work runs, the host keeps the Mac awake, as the terminal app does. The display may still sleep.
- A message the user sent that the model never read comes back to the input (the user, 2026-11-23: "the main agent is terrible, terrible tracking context. is he losing new messages?"). A message sent while the main agent works is steered into its turn, and the model reads it after the tool calls under way. Stop already hands the unread ones back. A close, a restart onto newer code and a crash did not: the words were gone, and the news they carried, such as a session that ended, was already marked heard. Now hobkin keeps what was not read. At a close it asks the session for its unread queue. After a crash, a steered message whose words are not in the session file was not read. When hobkin opens again those words are in the window's input, ahead of what the user had typed, once. hobkin does not send them to the model again by itself, so "never replayed" holds. News counts as heard only once the model read the message that carried it.

### Memory from run to run

- hobkin's rules are unchanged: a run gets its routine's working memory, recent log lines and latest outcome (`src/prompts/background.md`, "Continuity"). The client shows these in a routine's detail (`010-routines`).

### The same data as the terminal app

- One home, one owner at a time. The lock decides, and the client waits its turn (`002-host`).
- The client writes only inside `client/`, `canvas/` and `work/<slug>/reviews/`, plus whatever hobkin's own code writes.
- The first-run setup's answers are kept in `client/setup.json` (`025-onboarding`), written whole under another name and moved into place, private to the user. hobkin's own copy of them (`setup.json`) and what the setup hands work mode are written by hobkin's own code.
- Earlier main sessions, one for each `/reset`, are listed read-only in the sidebar's History section.

## Out of scope

- Syncing between machines.
- Running the terminal app and the client on one home at the same time.

## Acceptance

- A1. After quitting and reopening, the app shows the same screen, sidebar section, divider position, open review at the same step with its code panel as it was, and the same unsent text in the input.
- A2. Closing the window with a run active asks whether to keep working or stop. With nothing active it asks nothing.
- A3. After "keep working", the run finishes with the window closed, and reopening the app shows its result and report.
- A4. After "stop the work", the run is recorded as interrupted, and the next start does not run it again.
- A5. After the host is killed during a run, the next start shows that run as interrupted with the time, and does not run it again.
- A6. After a session in the client, the terminal app opens the same home without an error and shows the same messages, routines and reports. The reverse also holds.
- A7. A reload of the window, or a crash of the UI alone, reattaches to the running host and loses no message.
- A8. The History section lists earlier main sessions with their dates. Opening one shows its messages read-only.
- A9. While a run is active the Mac does not idle-sleep, and it can sleep again once nothing is running.
- A10. News a message carries (a session that ended, a card's action, a handed-over message, the brief) counts as heard only once the model has read that message. A message steered into a running turn and never read, because the turn was stopped or hobkin closed or crashed, leaves its news unheard, and the next message carries it.
- A11. A message hobkin accepted that the model never read is not lost when hobkin closes, restarts or crashes. When hobkin opens again it is in the window's input, ahead of what was typed there, once. hobkin never sends it to the model again by itself.

## Proof

- A1. `host/test/view-state.test.ts` › "saves and returns the view state"
- A2. check: close the window with a scripted run active, then with none.
- A3. `host/test/lifecycle.test.ts` › "a detached host finishes its run and a new window attaches"
- A4. `host/test/lifecycle.test.ts` › "stop interrupts with a receipt and nothing replays"
- A5. `host/test/recovery.test.ts` › "marks an unfinished run interrupted and does not replay it"
- A6. `host/test/shared-home.test.ts` › "hobkin's own application opens a home the client used"
- A7. `ui/test/connection.test.ts` › "reconnects and replaces stale state"
- A8. `host/test/history.test.ts` › "lists earlier main sessions read-only"
- A9. check: `pmset -g assertions` shows the assertion during a run and not after.

## Steps

- [ ] S1 (A1). View state: the file, the command, restore before first paint.
- [ ] S2 (A2, A3, A4). Window close choices, the detached host and re-attach, in the Tauri shell and the host.
- [ ] S3 (A5, A7). Recovery checks for a killed host and a reloaded window.
- [ ] S4 (A6). The shared-home test against hobkin's application, both directions.
- [ ] S5 (A8). History of earlier sessions.
- [ ] S6 (A9). Stay awake while work runs.
- [ ] S7 (A10). Runtime: news is marked heard when the model read the message that carried it.
- [ ] S8 (A11). Runtime, host and window: a message the model never read is kept across a close, a restart and a crash, and handed back to the input.
