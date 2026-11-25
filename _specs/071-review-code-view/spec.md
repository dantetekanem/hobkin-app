---
{
  "id": "071-review-code-view",
  "title": "A review opens as a graph or as code",
  "kind": "work",
  "status": "doing",
  "depends": ["008-review-code", "009-review-notes", "020-settings", "032-change-review"],
  "updated": "2026-11-24"
}
---
# A review opens as a graph or as code

## Outcome

A review can be read two ways. Graph is the review as it is today, with Story and Free Roam, and it is how a new installation opens reviews. Code is the change as a diff, one file at a time, the way pi-coder's `/diff` shows it: the changed files beside the diff, a cursor that walks the changed lines, and comments and questions on lines. Both looks share the review's panel and its notes, so a comment written in one is there in the other. Settings › Reviews chooses the look a review opens in, and inside a review one key or the switch at the bottom moves between them. A review the user is in covers 98% of the window's width.

The user, 2026-11-24: "i love the current review system that use graph, but i want it to be option a (default in new installations), option b should be a code diff like pi-coder do, with /diff, see how it works right now, the code is fantastic. will be comment/discuss, same UI, basically, and features. the setting will set the default in review, but from graph you can also open the code mode. and the review should even be larger in the left when open, right now it doesnt cover everything, should go to 98%".

## Decisions

### The setting

- Settings › Reviews has "A review opens in", Graph or Code. It is kept in the window's settings (`reviewView` in `hobkin-client-settings`). A saved state without it opens reviews in Graph, so a new installation and every existing one start in Graph.
- The choice decides how each review opens. Switching inside a review changes that review only. A review left for another page keeps its look and its file when the user comes back (`SessionPlace`). A review closed and opened again starts from the setting.

### The switch

- The switch at the bottom of the review becomes "Code | Free Roam | Story", with I, O and P on it, in the order the keys sit on the keyboard. I opens the code view, and I again goes back to the graph where it was. O and P go back to the graph in their mode and start it from the beginning, as they always have. The switch sits at the same place at the bottom in both looks.
- I is free in the review: no key of the graph, the code panel, the panel or the proof uses it.

### The code view

The model is pi-coder 0.9.10's `/diff` (`src/ui/review-app.ts`, read on 2026-11-24). What it has that a review here does not need is out of scope, below.

- The review panel stays at the left as it is: the scores, what needs a look, the comments and questions, the evidence and the verdict. S hides it and the code view takes its room. The code view starts under the frame's menus and ends above one line at the bottom, which holds the switch and the keys to start with ("C a comment · D ask hobkin · ⌘? every key", as pi-coder's footer). Nothing floats over the code.
- Two columns: the files and the diff. As in pi-coder, the view opens with the files focused. Up and Down move between files and the diff follows. Enter or Right goes to the diff, and Left comes back.
- The files are the changed files, in the order the story tells them: the first step that shows a file puts it first. Files no step shows follow, by path. A file in the review only because unchanged code in it is shown is not listed. The top line says "N files · +X −Y". A row has the status letter (A, M, D or R) in its color, the path shortened from the left, its added and removed lines, how many comments and questions it carries, a mark when a part of it needs the reviewer, and a check once it is seen.
- Over the diff: the file's path (old → new for a rename), which group of changes the cursor is in ("Change 2 of 5"), the file's added and removed lines, and what is selected. Then the diff, drawn as the code panel draws it (`DiffView`): three unchanged lines around each group of changes, Show more, Whole file, highlighting in a worker and a virtual list for long files. One column until V asks for two, and the choice is the code panel's (`splitDiff`).
- The cursor is a bar across one line. A file opens with it on its first changed line, and while the review is open each file keeps its own cursor.

### Keys in the code view

- In the diff, Up and Down move the cursor through changed lines only. Option with them reaches any line and opens the unchanged lines it comes to. Shift with them selects lines from where the selection started, on one side only (the old file or the new one), and Option with Shift selects through unchanged lines too.
- J and K go to the next and previous group of changes, as they go to the next and previous zone in the graph. Home and End go to the first and last changed line. Page Up and Page Down move a page.
- ] and [ go to the next and previous file, round from the last to the first. U and Shift+U go to the next and previous file not seen. In two columns, Left and Right first move between the old side and the new.
- Z marks the file seen, or takes the mark off. R does the same, as it does in pi-coder.
- V, E and F are the code panel's: one column or two, more lines around the changes, the whole file.
- C and N, D and H, A, M, X, S, T, { and }, Shift+S, / and ⌘? do what they do in the graph.
- Escape closes the note being written, then the finder, then the proof, then the selection (the cursor stays on its line), then the review.

### Notes

- A note is a comment, kept for the verdict, or a question asked of hobkin: pi-coder's COMMENT and DISCUSS. pi-coder's MODIFY is left out, since a review does not edit code (spec 008).
- In the diff a note is about the selected lines, or the cursor's line when nothing more is selected. With the files focused it is about the file, through the review's first part in it. Its step, which says where it was taken when hobkin or an agent reads it, is the first step that shows those lines or that file, else the step the story is on.
- The review's input, the same one as at the bottom of the graph, opens right under the lines, where pi-coder opens its editor: Comment or Ask hobkin, Enter keeps the comment or asks, Shift+Enter starts a new line, Escape goes back to the code with the words kept. A note about the file opens it over the diff's first line.
- A saved note shows beside its first line, in a column of the gutter that is always kept: a square for a comment, a diamond in the question color for a question. C or D with the cursor in lines that carry a note of that kind opens that note to change. The panel's list still has every note, and choosing one there shows its lines in the code view.

### Seen

- The code view and the graph share what is seen. A file is seen once every part of the review in it is seen, and Z marks them all. Opening a file marks nothing: in pi-coder a file is reviewed only when the reviewer says so. In the graph, visiting a step and opening a node's code still mark what they show.

### Going somewhere from the panel

- In the code view, whatever goes to a step or a part (a unit under What matters, a note in the list, the finder) shows its file with the cursor on its lines. The graph's story follows along, so going back to the graph shows the same place.

### The width

- A review the user is in covers 98% of the window's width, in both looks. The rest, at the left, is a strip of the chat, which keeps its blur and its movement. Before, the review left 112 pixels of the chat: about 91% of a 1440 pixel window with a 460 pixel chat.

## Out of scope

- pi-coder's MODIFY, canned comments (`t`), search inside the diff (`/` here is the finder), line wrap, the tree of folders and the order switch, hidden locale files, the panes toggled by digits, and pull request threads.
- How notes leave with a verdict, and what hobkin is told: unchanged.
- The graph's code panel: unchanged.

## Acceptance

- A1. A new installation, and a saved state without the choice, open reviews in Graph. With Code chosen in Settings › Reviews, the next review opens in the code view.
- A2. In a review, I opens the code view and I again the graph, where it was. O and P open the graph in their mode from its start. The switch shows Code, Free Roam and Story with their keys, at the same place in both looks.
- A3. The code view lists the changed files in the story's order, each with its status, size, notes, needs-you mark and seen check, beside the chosen file's diff. Up and Down in the files change the file, and the diff follows.
- A4. In the diff, Up and Down move the cursor through changed lines only, Option with them reaches unchanged lines, Shift selects lines on one side, J and K go to the next and previous group of changes, ] and [ to the next and previous file, and U to the next file not seen.
- A5. C and D open the review's input under the selected lines. Enter keeps a comment or asks hobkin. The note then shows in the gutter and in the panel, and in words with its step, file and lines.
- A6. Z marks the file seen, its check shows in the list, and the graph has its parts as seen.
- A7. In the code view, a unit in the panel, a note in the list and a node from the finder each show their file and lines.
- A8. A review the user is in covers 98% of the window's width, in both looks, with a strip of the chat left in view.
- A9. A review left for another page comes back in the same look, on the same file.

## Proof

- A1. `ui/test/settings-review-view.test.ts`; `ui/test/review-look.test.ts` › the session opens in the look it is given.
- A2, A6, A7, A9. `ui/test/review-look.test.ts`.
- A3. `ui/test/review-code-files.test.ts`; still renders at 1440 pixels, dark and light.
- A4. `ui/test/review-code-cursor.test.ts`.
- A5. `ui/test/review-look.test.ts` › a note's target and step in the code view; a still render of the input under the lines.
- A8. `ui/test/review-width.test.ts`.
- All: check in the app's window, by the user: open a review in each look, switch with I, write a comment and a question on lines, mark a file seen, reload.

## Steps

- [x] S1 (A8). The width: `canvasGrowth` covers 98% of the window for a review.
- [ ] S2 (A1, A2, A6, A7, A9). The look in the review's session: its keys, its place kept, the setting it opens from, notes and seen marks in the code view.
- [ ] S3 (A3, A4, A5). The code view: the files, the diff with its cursor and selection, the gutter marks, the input under the lines, its keys.
- [ ] S4 (A1, A2). The switch with Code on it, the choice in Settings › Reviews, the keys in the review's shortcuts and the Keys page.
- [ ] S5 (all). The code view on the review's stage, and still renders.
