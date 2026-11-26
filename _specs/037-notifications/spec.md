---
{
  "id": "037-notifications",
  "title": "Notifications for what needs the user",
  "kind": "work",
  "status": "doing",
  "depends": ["012-reports-actions", "022-questions", "032-change-review", "034-durable-hobkins"],
  "updated": "2026-11-26"
}
---
# Notifications for what needs the user

## Outcome
When something needs the user and the window is not in front (it is hidden, minimized, or another app is active), the Mac shows one notification for it, from hobkin, with a title and one line. Each thing is told once, across reconnects and restarts of the window. Nothing is told while the window is in front, and nothing for what merely happened. A click brings the window to the front and opens the place that answers it. The first time there is something to tell, the Mac asks for permission; a refusal is respected and Settings says how to turn notifications on.

## Decisions

### What notifies, what it says, where a click goes

| What needs the user | Title | Line | A click opens |
| --- | --- | --- | --- |
| A question on the sheet | `hobkin asks`, or `<asker> asks` for a routine, project or session | The question's heading | The window, with the sheet up |
| A new action item | `New action item` | Its summary | Action Items, with the item open |
| A durable hobkin waiting, not looked at yet | The hobkin's title | How its turn ended, and that it waits | That hobkin's page |
| A review that just became ready | `Review ready` | hobkin's line about it | The review |

- Nothing else notifies: reports, finished runs, notices and chat lines are things that happened, except the lines hobkin's desk levels (below).

### Lines by level (075-chief-of-staff S5)
hobkin's desk puts a `level` on a line it lets through by itself and posts what it held as one digest. Within ten minutes of the line:

| The line | How it reaches the user | Title | A click opens |
| --- | --- | --- | --- |
| A `P0` line | A notification with the chime | `Needs you now` (`Review ready` for a review) | Chat (the review) |
| A `P1` line, which comes alone only at a pause | The nudge alone, a softer bell, with no notification | none | nothing |
| A digest | One notification with the nudge | `Digest`, then its counts | Chat |
| A `P2` or `P3` line | Nothing | | |
| A line with no level, from a hobkin before the desk | As above: only a review that is ready | | |

- Every rule above holds for these too: told once, nothing while the window is in front, the sound only with what is told. A cue shows nothing, so it never asks the Mac and still plays after a refusal.
- A review is "just ready" for ten minutes after hobkin's line about it. An older line in the chat is history.
- A durable hobkin notifies once for each time it starts to wait (`waiting.since`), and not once the user has looked (`waiting.seen`).
- The words come from hobkin's own facts, cut to one line. The notification carries no address and no command.

### One notification per thing, by its own identity
- A thing's identity is its own id in its home: the question's id, the item's id, `hobkin:<id>:<since>`, the review line's id. hobkin shows a filed question on the sheet with the item's own id (`requestId`), so on the sheet and under Action Items it is one thing.
- The main agent's own question that the user puts off is filed again with a new id (`filePutOff`). It was told as the question, so its item under Action Items is not told again.
- The window keeps, per home, the ids it told or that the user saw with the window in front: the newest 500, in the window's storage. A reconnect, a reload and a restart of the app keep them.
- A home the window has never seen is taken as it is: what already waits is counted as told, and only what comes after notifies. Storage that cannot be read counts the same way, so nothing is ever told twice; storage that cannot be written keeps the list for the window's life.
- Something that first appears while the window is in front counts as seen, and is never told later.

### Permission
- The Mac's prompt shows only when there is a first thing to tell, never at start.
- A refusal is respected: what was waiting then is not told, then or later. Settings shows one plain line after a refusal, with how to turn notifications on (`NotificationsLine`).
- The prompt and the refusal come from the Mac's own notification settings (UNUserNotificationCenter), which only an app bundle has. In `tauri dev` the app is a bare binary: there the plugin's own answer, always yes on a desktop, stands.

### A click
- The shell brings the window to the front, shown, not minimized and focused, and hands the window back only the notification's key. The window looks the key up in what needs the user now, and opens that thing's place through its own navigation, from a fixed list: the sheet, Action Items with an item open, Action Items, a durable hobkin's page, a review.
- A key from another home, a key the window cannot read, or a thing that no longer waits opens nothing beyond the window. A question that left the sheet opens Action Items, where it waits.

### Where it lives
- `ui/src/features/notifications/rules.ts`: what needs the user, the words, the destinations, the Settings line. Pure.
- `ui/src/features/notifications/request.ts`: the controller: once per thing, the window in front, permission, the click. Pure, with the shell handed in.
- `ui/src/features/notifications/live.ts`: connects the controller to the host's state, Action Items and the app's navigation. The frame loads it once.
- `ui/src/lib/native.ts`: the shell's commands. Without them (a browser tab, or a shell from before this) nothing starts and the window is as before.
- The shell (`src-tauri/src/notices.rs`): `tauri-plugin-notification` sends, `notice_permission` asks the Mac, `notice_send` shows one notification, and a click emits `notice:open` with the key to the main window's webview. Both commands answer the main window's webview only.

## Out of scope
- Notifying while the window is in front, or for anything that is not in the table.
- Buttons on a notification, replies typed into it, grouping, sounds of hobkin's own, badges on the Dock icon.
- Taking a notification back once its thing is answered: the plugin cannot remove one on a Mac.
- A setting to turn some kinds off.

## Acceptance
- A1. A question on the sheet, a new action item, a durable hobkin waiting unseen and a review just ready each make one need with its title, one line and its place. Seen hobkins, old review lines, other notices and chat lines make none.
- A2. A filed question is one need on the sheet and under Action Items. The main agent's question put off into Action Items is not told again.
- A3. Each need is told once in its home, across a reload and a reconnect. What waited in a home the window never saw is not told; what comes after is.
- A4. Nothing is told while the window is in front, and what was seen there is not told later.
- A5. A refusal tells nothing, then or later, and Settings shows a line saying how to turn notifications on. Only a refusal shows it.
- A6. A click opens the need's own place while it still waits, a question that left the sheet opens Action Items, and anything else opens nothing.
- A7. A change of home, connection or state during any step stops the notification, and a failure is tried again.
- A8. With the window hidden or another app in front, a question from a routine shows a Mac notification from hobkin; a click brings the window up with the question on the sheet. (Native patch needed.)
- A9. The first notification of a built hobkin.app shows the Mac's own permission prompt first; after "Don't Allow", Settings shows the line. (Native patch and a built app needed.)
- A10. With the window in front, the same question shows no notification. (Native patch needed.)
- A11. A fresh `P0` line notifies with the chime, a fresh lone `P1` line plays the nudge alone, a fresh digest is one notification with the nudge, and `P2`, `P3` and old lines tell nothing. A line without a level is as before. A cue asks the Mac nothing and plays after a refusal, and nothing sounds with the window in front.

## Proof
- A1. `ui/test/notification-rules.test.ts` › "a question, a new action item, a durable hobkin waiting unseen and a fresh review ready each need the user once" and "what merely happened, or was already seen, needs nobody"
- A2. `ui/test/notification-rules.test.ts` › "a filed question keeps its own identity: on the sheet and under Action Items it is one need" and "the main agent's question put off into Action Items is the question it was, and is not told again"
- A3. `ui/test/request-notifications.test.ts` › "each thing that needs the user is told once, across a reload and a reconnect, and in each home" and "a home this window never saw is taken as it is: what already waits is not told, what comes after is"
- A4. `ui/test/request-notifications.test.ts` › "nothing is told while the window is in front, and what was seen there is not told later"
- A5. `ui/test/request-notifications.test.ts` › "a refusal is respected, while an unavailable shell or a dispatch that failed is tried again"; `ui/test/notification-rules.test.ts` › "only a refusal shows a line in Settings"
- A6. `ui/test/request-notifications.test.ts` › "the listener comes before the first notification; a click opens only what still waits, and dispose removes it"
- A7. `ui/test/request-notifications.test.ts` › "home, generation, reset and closed requests invalidate pending permission checks" and "async listener, window and send steps recheck freshness; failures remain retryable"
- A8. check: after the native patch, hide the window and run a routine that files a question. One notification shows; click it.
- A9. check: in a built hobkin.app never allowed before, cause a first question with the window hidden; answer the prompt "Don't Allow" and open Settings.
- A10. check: after the native patch, with the window in front, cause a question. No notification shows.
- A11. `ui/test/notification-rules.test.ts` › "levels set how a line reaches the user: P0 with the chime, a lone P1 as a soft cue alone, a digest as one soft notification", "a review that is ready keeps its notification without a level, and follows its level with one" and "a leveled line or a digest is news only while it is fresh, and needs nobody once it is history"; `ui/test/request-notifications.test.ts` › "a cue alone asks the Mac nothing and plays after a refusal; a digest is one soft notification that opens the chat"; `ui/test/sound.test.ts` › "what cannot wait chimes, and what can wait a little nudges: one bell, softer and shorter than the chime"; check: with the window hidden, a desk digest shows one notification and nudges. Not yet heard or seen.

## Steps
- [x] S1 (A1, A2, A5). The rules: needs, words, destinations, the Settings line.
- [x] S2 (A3, A4, A5, A6, A7). The controller, with the shell handed in.
- [x] S3 (A8, A9, A10). The window's wiring and the shell boundary, and the native patch (`notices.rs`, the plugin, the capability).
- [ ] S4 (A8, A10). The frame loads `ui/src/features/notifications/live.ts` once; apply the native patch.
- [ ] S5 (A9). Settings shows `<NotificationsLine />`.
- [x] S6 (A11). Lines by level, 2026-11-26: the rules, the cue without a notification, the nudge. Tested with fakes; not heard or seen in the app.

## Open questions
- An earlier request of the user's asked for notifications for requests needing input "even while active". This spec follows the later word: nothing while the window is in front. If "active" meant the window in front, the rule in A4 is one line to change.
- In `tauri dev` the plugin posts as Terminal (`com.apple.Terminal`), so the name, icon, permission and prompt are Terminal's, and a click may also bring Terminal forward. Only a built hobkin.app posts as hobkin.
- The plugin sends through NSUserNotificationCenter while the permission is read from UNUserNotificationCenter. That the Mac applies the one switch to both is expected from its settings, and is to be seen in a built app.
