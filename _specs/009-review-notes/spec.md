---
{
  "id": "009-review-notes",
  "title": "Change Review: notes and the verdict",
  "kind": "work",
  "status": "doing",
  "depends": ["007-review-story", "008-review-code", "011-work"],
  "updated": "2026-11-12"
}
---
# Change Review: notes and the verdict

## Outcome

The reviewer takes notes while walking the story, on a node, a wire, a step or a few lines of code. At the end the notes become the request hobkin acts on, or the change is merged. hobkin can leave notes too, so a review is something the two do together.

## Decisions

- A note has a target (node, wire, step, or a line range of a file side), text, an author (the user or hobkin) and a time. Notes are appended to `notes.jsonl` beside the review file and folded by id, the way hobkin keeps its other logs.
- A note is taken on a step, and is about that step or about something more particular the reviewer is on: lines selected in the code panel, then an open wire, then a node they pointed at, else the step itself.
- A note has an intent, as in pi-coder: a comment, kept for the verdict, or a question for hobkin. `N` or `C` writes a comment, and `D` or `H` a question. ~~Typing happens in the steps panel.~~ Replaced by the user on 2026-11-12: typing happens in one input at the bottom of the review, over the canvas and under the step pager, there while the review is open, with a choice between a comment and asking hobkin. The steps panel no longer imitates hobkin's chat. Enter keeps a comment, and the keyboard goes back to the review. Enter sends a question to hobkin at once, with the step and the node, and keeps it as a question marked asked; hobkin's own chat comes into view beside the review to answer, and the keyboard stays in the review's input, never in the chat's. Shift+Enter starts a new line, and Escape gives the keyboard back to the review with the words kept as a draft. Escape there never reaches the chat, so it never stops hobkin. A note can be changed, in the same input, and removed.
- A target with notes shows a small marker with the count: on a node card, on a wire's label, beside the lines in the code panel, and on the step in the steps panel. The notes of the current step are listed under its text in the steps panel (`007-review-story`), which replaces the drawer this spec first planned.
- A question not handed over yet, such as one hobkin could not take or one written before questions went at once, waits. "Ask your questions", under the review's input, sends every such question as one message, in the order of the story, each with its step and target written out in words. Handing it over marks those questions, so they are not sent twice. Comments stay for the verdict.
- The UI hands the message over through a small interface (`ReviewHandoff`). The sample keeps the message and says nothing was sent. The host will put it into the conversation.
- The last step of the story offers the same choices as the change's card in work mode (`src/cli/work/controls.mjs`): Merge it, Refresh and merge it, Get it reviewed, Ask for changes, Cancel it. Each one calls hobkin's existing action.
- "Ask for changes" sends the selected notes as one request, each with its target written out in words (file, lines, node title), so the work agent can act without the graph.
- A reviewer marks a step understood. The rail shows it, and the review says how many steps remain.
- Notes are commands, so hobkin can add and resolve them (`013-hobkin-access`).

## Out of scope

- Threads and replies on a note.
- Sharing notes outside the machine.

## Acceptance

- A1. `N` adds a note to the current focus. Selecting lines in the code panel and pressing `N` adds a note to those lines. Notes are still there after a restart.
- A2. A node, wire, step or line range with notes shows a marker with the count.
- ~~A3. The notes drawer lists every note with its target in words. Clicking a note focuses its target, opening the code panel for a line note.~~ Retired: notes live under their step in the steps panel instead of a drawer. See A10.
- A4. "Ask for changes" with two notes selected sends one request to hobkin for that change containing both notes and their targets, and the change's card shows that changes were asked.
- A5. "Merge it" at the end of the story merges exactly as the card does, and refuses with the card's own reason when the change cannot merge.
- A6. A note added by hobkin through a command shows hobkin as its author.
- A7. Marking a step understood shows on the rail, and the count of remaining steps drops by one.
- A8. A note whose line range no longer matches the review's bytes is kept and shown as detached, not dropped.
- A9. `N` or `C` starts a comment and `D` or `H` a question about what the reviewer is on (selected lines, an open wire, a node they pointed at, or else the step), in the review's input at the bottom. Enter keeps a comment, and sends a question to hobkin with the step and node while hobkin's chat comes into view and the keyboard stays in the review. Shift+Enter starts a new line, and Escape gives the keyboard back to the review without losing the words.
- A10. The steps panel shows each step's count of comments and questions, and lists the current step's notes under its text, each saying what it is about.
- A11. "Ask your questions" sends one message with every question not yet handed over, in story order, each with its step and target in words. Handing it over marks those questions as handed, and comments are not in it.
- A12. Notes are still there after the review, or the app, is closed and opened again.

## Proof

- A1. `host/test/review-notes.test.ts` › "appends notes and folds them by id"
- A2. check: add notes to each kind of target in the sample review.
- A3. Retired.
- A4. `host/test/review-notes.test.ts` › "ask for changes sends selected notes with their targets"
- A5. `host/test/review-verdict.test.ts` › "merge calls the card's action and passes its refusal through"
- A6. `host/test/review-notes.test.ts` › "records the author"
- A7. `ui/test/review-progress.test.ts` › "counts understood steps"
- A8. `host/test/review-notes.test.ts` › "keeps a detached note"
- A9. `ui/test/review-notes.test.ts` › "an open review writes a note about what the reviewer is on, and keeps following its notes after a double mount"; `ui/test/review-panel.test.ts` › "N and C start a comment, and D and H a question to hobkin, in the review's input, about what the reviewer is on" and "in the review's input Enter sends, Shift with Enter starts a line, and Escape gives the keyboard back to the review"; `ui/test/review-ask.test.ts` › "a comment written in the review's input is kept on what the reviewer is on, nothing goes to hobkin, and the keyboard goes back to the review" and "a question written in the review's input goes to hobkin with the step and the node, brings the chat into view, and the keyboard stays in the input"; check: in the window, ask a question from the input, press Escape while hobkin answers, and see hobkin keep answering.
- A10. `ui/test/review-notes.test.ts` › "counts the notes of each step, node, wire and line range, for their markers"
- A11. `ui/test/review-notes.test.ts` › "hands the questions over as one message, each with its step and target in words"
- A12. `ui/test/review-notes.test.ts` › "a note belongs to a step and to what the reviewer was on, and is still there after a restart"

## Steps

- [ ] S1 (A1, A6, A8). Host: the notes log and its commands.
- [ ] S2 (A1, A2, A3). UI: adding notes, markers, the drawer.
- [ ] S3 (A4, A5). The verdict step and its calls into hobkin's work actions.
- [ ] S4 (A7). Understood marks.
- [x] S5 (A9, A10, A11, A12). UI: comments and questions on sample data, kept in the reviewer's memory, the markers, the notes in the steps panel, and the hand-over message behind `ReviewHandoff`.
