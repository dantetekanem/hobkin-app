---
{
  "id": "071-review-code-view",
  "title": "A review opens as a graph or as code",
  "kind": "work",
  "status": "doing",
  "depends": ["008-review-code", "009-review-notes", "020-settings", "032-change-review"],
  "updated": "2026-11-25"
}
---
# A review opens as a graph or as code

## Outcome

A review can be read two ways. Graph is the review as it is today, with Story and Free Roam, its panel and hobkin's change review, and it is how a new installation opens reviews. Code is the change as a diff, one file at a time, the way pi-coder's `/diff` shows it: the changed files beside the diff, a cursor that walks the changed lines, comments and questions on lines, and the verdict along its bottom line. Code needs no change review: it opens on the diff, and only Graph starts hobkin's review. Both looks share the review's notes, so a comment written in one is there in the other. Settings › Reviews chooses the look a review opens in, and inside a review one key or the switch at the bottom moves between them. A review the user is in covers 98% of the window's width.

The user, 2026-11-24: "i love the current review system that use graph, but i want it to be option a (default in new installations), option b should be a code diff like pi-coder do, with /diff, see how it works right now, the code is fantastic. will be comment/discuss, same UI, basically, and features. the setting will set the default in review, but from graph you can also open the code mode. and the review should even be larger in the left when open, right now it doesnt cover everything, should go to 98%".

The user, 2026-11-25, after trying it: "review should be only triggered in graph mode, normal code can be only rendered automatically"; "d/c both open comment, d still discuss"; "left side bar should not be there at this moment. \"Send fixes\" doesnt mean fixes anyway, can be a question too, should be \"Talk to agent\" and a different \"Publish comments (reviewed by agent)\" and \"Request changes\" when remote, etc"; "an esc from diff is not going back to graph if was graph, is closing all, wrong". Asked, they chose D as a question kept for the agent, the verdict on the code view's bottom line, and an agent that rewords the comments with the user confirming, "like pi-coder does".

## Decisions

### The setting

- Settings › Reviews has "A review opens in", Graph or Code. It is kept in the window's settings (`reviewView` in `hobkin-client-settings`). A saved state without it opens reviews in Graph, so a new installation and every existing one start in Graph.
- The choice decides how each review opens. Switching inside a review changes that review only. A review left for another page keeps its look and its file when the user comes back (`SessionPlace`). A review closed and opened again starts from the setting.

### The switch

- The switch at the bottom of the review becomes "Code | Free Roam | Story", with I, O and P on it, in the order the keys sit on the keyboard. I opens the code view, and I again goes back to the graph where it was. O and P go back to the graph in their mode and start it from the beginning, as they always have. In the graph the switch stays where it was, beside the pager. In the code view it starts the line at the bottom, at its left: the graph's row centers what the step has (the pager, the whole graph), so the two places cannot be one without moving the graph's.
- I is free in the review: no key of the graph, the code panel, the panel or the proof uses it.
- Escape in a code view opened from the graph goes back to the graph, where it was, once the note, the finder, the proof and a selection of several lines are closed. A code view the review opened in closes the review. A review left for another page keeps which it was.

### What starts hobkin's review

- Graph starts hobkin's change review, as it always has: a review opened in Graph waits for it and shows its progress. Code opens on the diff as soon as the host has built the review's files, which asks no model, and starts no change review. A pull request opened in Code builds its diff by itself, with no "Start AI review" to press.
- Going from Code to Graph starts the change review of a finished change when none is ready or under way at the review's commit, and the graph shows its progress, beside the panel and over the switch's own row, until it is ready. On a pull request the graph offers Start AI review instead, as opening one in the graph does: a pull request is reviewed only once the user asks. While the graph waits, only I, O and P act. A change review already made, as the background makes one for each finished change, shows in both looks.
- The host builds a review's graph and files alone with `review.prepare` and `changeReview: false`. A full ask joins such a build, queued or running, and starts the change review when the graph is drawn. The window's graph-only ask counts as the user's, so the line never drops it, and hobkin says nothing of it in the chat.
- In Code nothing sits in the corner over the code: no Refresh review, no run card, no Make it a stack. Refresh review would start the change review.

### The code view

The model is pi-coder 0.9.10's `/diff` (`src/ui/review-app.ts`, read on 2026-11-24). What it has that a review here does not need is out of scope, below.

- The code view has no review panel: the scores, what needs a look and the evidence are the graph's. It takes the whole width under the frame's menus and ends above one line at the bottom: the switch at its left, the keys to start with ("C a comment · D discuss with the agent · ⌘/ every key", as pi-coder's footer), and the verdict at its right. A key that does not fit gives way to the verdict, whole, and a verdict that does not fit scrolls. Nothing floats over the code but what a verdict choice will do, shown over the line while it says something.
- Two columns: the files and the diff. As in pi-coder, the view opens with the files focused. Up and Down move between files and the diff follows. Enter or Right goes to the diff, and Left comes back.
- The files are the changed files, in the order the story tells them: the first step that shows a file puts it first. Files no step shows follow, by path. A file in the review only because unchanged code in it is shown is not listed. The top line says "N files · +X −Y". A row has the status letter (A, M, D or R) in its color, the path shortened from the left, its added and removed lines, how many comments and questions it carries, a mark when a part of it needs the reviewer, and a check once it is seen.
- Over the diff: the file's path (old → new for a rename), which group of changes the cursor is in ("Change 2 of 5"), the file's added and removed lines, and what is selected. Then the diff, drawn as the code panel draws it (`DiffView`): three unchanged lines around each group of changes, Show more, Whole file, highlighting in a worker and a virtual list for long files. One column until V asks for two, and the choice is the code panel's (`splitDiff`).
- The cursor is a bar across one line. A file opens with it on its first changed line, and while the review is open each file keeps its own cursor.
- The review's short words (such as "Every file is seen.") show in the line at the bottom for 2.6 seconds, in the keys' place, as pi-coder's status line, instead of floating over the code.
- The diff is drawn by the same component as the code panel's (`DiffView`), with optional props for the cursor, the glyphs and the row under a line. Two things changed in the code panel with it: an unchanged line now counts inside a selection or a note of the old side, and in two columns the selection's bar shows in the right column too.

### Keys in the code view

- In the diff, Up and Down move the cursor through changed lines only. Option with them reaches any line and opens the unchanged lines it comes to. Shift with them selects lines from where the selection started, on one side only (the old file or the new one), and Option with Shift selects through unchanged lines too.
- J and K go to the next and previous group of changes, as they go to the next and previous zone in the graph. Home and End go to the first and last changed line. Page Up and Page Down move a page.
- ] and [ go to the next and previous file, round from the last to the first. U and Shift+U go to the next and previous file not seen. In two columns, Left and Right first move between the old side and the new.
- Z marks the file seen, or takes the mark off. R does the same, as it does in pi-coder.
- V, E and F are the code panel's: one column or two, more lines around the changes, the whole file.
- C and N, D, H, A, M, X, T, / and ⌘/ do what they do in the graph. ⌘/ lists every key: the Mac's Help menu takes ⌘? first. S, { and } and Shift+S are the panel's and the corner's, which the code view does not have.
- Escape closes the note being written, then the finder, then the proof, then the selection (the cursor stays on its line), then goes back to the graph when the code view was opened from it, else closes the review.

### Notes

- A note is a comment (C or N), a question to discuss with the agent (D) or a question asked of hobkin at once (H), in both looks. A comment and a question to discuss are kept for Talk to agent, as pi-coder's COMMENT and DISCUSS wait for its submit; a question for hobkin goes to hobkin's chat on Enter, as before. pi-coder's MODIFY is left out, since a review does not edit code (spec 008).
- In the diff a note is about the selected lines, or the cursor's line when nothing more is selected. With the files focused it is about the file, through the review's first part in it. Its step, which says where it was taken when hobkin or an agent reads it, is the first step that shows those lines or that file, else the step the story is on.
- The review's input, the same one as at the bottom of the graph, opens right under the lines, where pi-coder opens its editor: Comment, Discuss or Ask hobkin. Enter keeps a comment or a question to discuss, or asks hobkin; Shift+Enter starts a new line; Escape goes back to the code with the words kept. A note about the file opens it over the diff's first line, and in a code view that has not moved yet, that is the first file it shows. The input starts on Comment when nothing is being written.
- A saved note shows beside its first line, in a column of the gutter that is always kept: a square for a comment, a diamond in the question color for a question. C or D with the cursor in lines that carry a note of that kind opens that note to change. The graph's panel still lists every note, and choosing one there shows its lines in the code view.

### The verdict

- Send fixes is Talk to agent (X). On a finished change it gives the change's agent the comments and the questions to discuss, numbered through, each kind under its own heading when there are both (comments to act on, questions to answer in words), as pi-coder's local review goes to its agent. Both are marked sent.
- A pull request offers Approve, Approve and merge, Publish comments, Request changes, Talk to agent and Remove, someone else's too but for merging and closing. Publish comments and Request changes post one review on GitHub with the user's comments, their grammar checked first by the host's two passes, as pi-coder's: a correction that is only grammar is made, and one that could change the meaning is shown apart, with Use it to change the user's comment to it and show the choice again. Talk to agent hands the questions to discuss to hobkin in one message, at once; the comments stay for the pull request.
- X presses Talk to agent wherever the verdict is. In the code view the verdict is the panel's own, in a row at the right of the bottom line, and what a choice will do shows over the line.

### Seen

- The code view and the graph share what is seen. A file is seen once every part of the review in it is seen, and Z marks them all. Opening a file marks nothing: in pi-coder a file is reviewed only when the reviewer says so. In the graph, visiting a step and opening a node's code still mark what they show.

### Going somewhere from the panel

- In the code view, whatever goes to a step or a part (a unit under What matters, a note in the list, the finder) shows its file with the cursor on its lines. The graph's story follows along, so going back to the graph shows the same place.

### The width

- A review the user is in covers 98% of the window's width, in both looks. The rest, at the left, is a strip of the chat, which keeps its blur and its movement. Before, the review left 112 pixels of the chat: about 91% of a 1440 pixel window with a 460 pixel chat.

## Out of scope

- pi-coder's MODIFY, canned comments (`t`), search inside the diff (`/` here is the finder), line wrap, the tree of folders and the order switch, hidden locale files, the panes toggled by digits, and pull request threads.
- How notes leave with a verdict, and what hobkin is told: unchanged but for Talk to agent, above.
- The host's background reviews (spec 058): they still review each finished change in its turn, whatever look the window opens in.
- The graph's code panel: unchanged.

## Acceptance

- A1. A new installation, and a saved state without the choice, open reviews in Graph. With Code chosen in Settings › Reviews, the next review opens in the code view.
- A2. In a review, I opens the code view and I again the graph, where it was. O and P open the graph in their mode from its start. The switch shows Code, Free Roam and Story with their keys, at the same place in both looks.
- A3. The code view lists the changed files in the story's order, each with its status, size, notes, needs-you mark and seen check, beside the chosen file's diff. Up and Down in the files change the file, and the diff follows.
- A4. In the diff, Up and Down move the cursor through changed lines only, Option with them reaches unchanged lines, Shift selects lines on one side, J and K go to the next and previous group of changes, ] and [ to the next and previous file, and U to the next file not seen.
- A5. C and D open the review's input under the selected lines. Enter keeps a comment or a question to discuss. The note then shows in the gutter and in the graph's panel, and in words with its step, file and lines.
- A6. Z marks the file seen, its check shows in the list, and the graph has its parts as seen.
- A7. In the code view, a unit in the panel, a note in the list and a node from the finder each show their file and lines.
- A8. A review the user is in covers 98% of the window's width, in both looks, with a strip of the chat left in view.
- A9. A review left for another page comes back in the same look, on the same file.
- A10. Escape in a code view opened from the graph goes back to the graph; in one the review opened in, it closes the review.
- A11. C keeps a comment, D keeps a question to discuss, H asks hobkin at once. Talk to agent on a finished change sends the comments and the questions to discuss, and both are marked sent.
- A12. The code view shows no review panel. Its bottom line has the verdict at its right; on a pull request, there and in the graph's panel, Publish comments and Request changes are offered, and Talk to agent hands the questions to hobkin.
- A13. Publish comments shows the grammar corrections it did not make, and Use it changes the user's comment to one.
- A14. A review opened in Code shows the diff without starting hobkin's change review. Opened in Graph, or switched to it, the review starts it when none is ready or under way.

## Proof

- A1. `ui/test/settings-review-view.test.ts`; `ui/test/review-look.test.ts` › the session opens in the look it is given.
- A2. `ui/test/review-look.test.ts`.
- A3. `ui/test/review-code-files.test.ts`; still renders at 1440 pixels, dark and light (lane C, `scratchpad/lane-c/page-*.png`).
- A4. `ui/test/review-code-cursor.test.ts`, `ui/test/review-code-keys.test.ts`.
- A5. `ui/test/review-look.test.ts` › a note's target and step in the code view; a still render of the input under the lines.
- A6. `ui/test/review-look.test.ts`.
- A7. `ui/test/review-look.test.ts`.
- A8. `ui/test/review-width.test.ts`.
- A9. `ui/test/review-look.test.ts`.
- A10. `ui/test/review-look.test.ts` › Escape in a code view opened from the graph.
- A11. `ui/test/review-ask.test.ts`, `ui/test/review-panel.test.ts`, `shared/test/review-verdict.test.ts`, `host/test/review-notes.test.ts`.
- A12. `ui/test/review-foot.test.ts`, `ui/test/review-verdict-actions.test.ts`, `ui/test/review-panel.test.ts` › X; still renders of the code view's line for a change and for someone else's pull request at 1411 and 1040 pixels (`scratchpad/still-b/page-*.png`).
- A13. `shared/test/review-grammar.test.ts`, `host/test/review-verdict.test.ts`, `ui/test/review-verdict-actions.test.ts`. The suggestion block is not seen in a still.
- A14. `host/test/review-graph-only.test.ts`, `ui/test/review-look-load.test.ts`; a still of the graph's wait view at 1411 pixels (`scratchpad/lane-look/page2-1411-dark.html.png`).

All: check in the app's window, by the user: open a review in each look, switch with I, write a comment and a question on lines, mark a file seen, reload.

## Steps

- [x] S1 (A8). The width: `canvasGrowth` covers 98% of the window for a review.
- [x] S2 (A1, A2, A6, A7, A9). The look in the review's session: its keys, its place kept, the setting it opens from, notes and seen marks in the code view. 809ebd1, 997c3d7, 6fd1006, d264207, 0aa5b1a.
- [x] S3 (A3, A4, A5). The code view: the files, the diff with its cursor and selection, the gutter marks, the input under the lines, its keys. 16c73ca, 38f1da7, fa1bb34, 9c638e3, 904e33e.
- [x] S4 (A1, A2). The switch with Code on it, the choice in Settings › Reviews, the keys in the review's shortcuts and the Keys page. e1bcc92, d87b4de.
- [x] S5 (A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14). The code view on the review's stage. 2ee9f41. Still renders of the code view and of the Settings row; the stage as a whole is not seen.
- [ ] S6 (A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14). The user's check in the app's window.
- [x] S7 (A10, A11, A12, A13). The user's notes of 2026-11-25: Escape back to the graph 44f7a22; D and H apart 177c8a5; Talk to agent and a pull request's choices f9b1661; no panel in the code view, the verdict on its line 7d414fd; a note on the first file 1fa9217; grammar suggestions with Use it 7e0ddc1; the input on Comment again be9f2f5.
- [x] S8 (A14). Code opens on the diff with no change review, and Graph starts one: the host's graph-only build 3a1de77, the loader by look e5d9629, the screen and the graph's wait view 6fcae03, post-processing 70a0773 (one lane); a pull request's Start AI review in the graph, the wait view's switch row and keys 97f2b6b. The live host restarted itself at 09:25 onto all of it.
