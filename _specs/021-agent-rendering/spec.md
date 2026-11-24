---
{
  "id": "021-agent-rendering",
  "title": "How an agent's work is drawn",
  "kind": "work",
  "status": "ready",
  "depends": ["008-review-code", "011-work"],
  "updated": "2026-11-23"
}
---
# How an agent's work is drawn

## Outcome

An agent's canvas shows its work as it happens, in a form a person can follow at a glance: what it is doing now, what it changed, what it ran and what it concluded. It is not a log. Code changes are drawn as well as they are in Change Review, shell commands keep out of the way, and the agent's thinking stays hidden unless it says something the user needs.

## Decisions

- The source is hobkin's job activity for one run: the agent's text, its thinking, and each tool call with its input, output and end state. The host forwards it in order.
- A pure function turns that activity into blocks (`shared/activity`). The canvas draws blocks. The rules below are that function's rules, so they can be tested without a window.
- The canvas is one column of blocks, oldest at the top. It stays pinned to the newest block while the agent works, unless the user has scrolled up.
- Blocks:

  | Block | Made from | Drawn as |
  | --- | --- | --- |
  | Says | The agent's own text | Markdown, as in the conversation |
  | Code change | Each file edit or write | A diff with the review's diff component: path, added and removed lines, syntax colors, three lines of context with expansion. One box per file: the places it changed follow each other, with a quiet band where lines were left out, as Pi's code previews draw an edit (the user, 2026-11-13) |
  | Shell group | Shell commands in a row | Only the newest command stays out of the fold: its command line, its state and time, and a live tail of its output once opened. The ones before it fold into one row, "4 commands", which opens to the list |
  | Read group | File reads and searches in a row | One row, such as "read 6 files, searched twice", which opens to the list |
  | Thinking | Thinking | Hidden. See below |
  | Result | The run's final report | Markdown, with the branch and the proof it names |

- Edits to the same file in a row are one code change block that updates in place. It shows the file's change so far, not each step.
- A command that failed is never folded away. Its row keeps its exit code, even when later commands follow.
- Each kind of tool block arrives open or shows only its one-line header as Settings says (`020-settings`): every kind arrives closed, code changes too (the user, 2026-11-23, who chose a change as one row whose diff is drawn only when the row is pressed; it replaces the rule of 2026-11-13 that code changes arrive open). Settings saved before that day load with code changes closed, since they had kept the old default and not a choice. A change in Settings applies at once to the blocks not opened or closed by hand, and a block opened or closed by its header keeps that. Control+O opens every block on the screen, and closes them all again. Blocks that arrive while they are open arrive open, and ones that arrive after they closed follow Settings.
- The agent's tasks, from its task tools, are one line above the blocks that stays in sight while they scroll: how many are done of how many and the one in progress, or the next one, or that all are done, such as "2 of 5 tasks · in progress: Write the report". A click or Enter on it opens every task under it, with its state and its description, and the same again closes it. The task calls are not blocks, except one that failed (the user, 2026-11-13).
- A command that is running shows at most its last 12 lines of output and its elapsed time. The full output opens on request.
- Thinking is hidden. While the agent thinks, the canvas says so and for how long. A thought is surfaced, as one short line, only in two cases: the agent has been thinking for more than 20 seconds with nothing else to show, so the user can tell it is not stuck, or the thought states a blocker, a question for the user, or a change of plan.
- Above the blocks, in one line and with no box around it: the agent's mission (goal, question, expected result), what it is doing now, the time so far, its tier and its tokens. The mission opens in full on request.
- Motion (the user, 2026-11-23: "i really dont like that bubbling jump that happens. i think i want something moving down up but without changing size", after "Steps appear in place with no rise and no glide. Lightest by far"): a step, a message, a command or the thinking row that comes after the page was drawn fades in as it moves about 14 px up, by translate alone, and is then a plain row with no transform or opacity of its own; under Still it only fades. Nothing in the transcript scales, glides or animates its size, and nothing leaves with a motion: a command giving way goes into its group's row at once, and a box opens or closes to its new height at once. While the view follows, it goes to the newest block at once, at most once a frame, never by a smooth scroll. Output streams without the block jumping.
- Keys: Up and Down move between blocks, Right or Enter opens a block, Left closes it, Control+O opens or closes them all, End returns to the newest block. Talking to the agent is `011-work`.
- Every row says when it happened, in a quiet column at its left (the user asked for it on durable hobkins and routines, 2026-11-15). The time is to the second, in the conversation's own clock: "03:59:12 PM", or "15:59:12" where the clock is 24-hour. A row from another calendar day has its date under the time, "Nov 14", with the year when it was another year. A step's time is when hobkin first saw it, which hobkin stamps on each activity entry (`at`). A message's time is when hobkin took it, and until hobkin has it, when the user pressed Enter. An answer's time is when its turn ended. A group times each of its rows: the folded row by its first command, and each open command and each item of an opened list by its own. A row with no time keeps its place in the column, empty, so every row's words start on one line. The user's messages are placed among the steps by the same times. An agent's page and a durable hobkin's page show the column; the main agent's page does not yet.
- A long run is drawn with a virtual list, so its length does not slow the canvas.
- A file path too long for its row is cut from its front (the user, 2026-11-23: "it cuts the end of it, the most important part. I want the begin to be cap"). The first folders go, one by one, with one `…` where they were, and the file's name stays: `…/models/change.rb`. How much shows follows the row's width as the window or the split is resized. Only a name wider than the row is cut, also from its front, so its extension stays. A path that fits shows whole. This holds for an edit, a write, a read and a listing, in the step rows and on the line that says what the agent is doing now. A command, a search pattern and an address keep their cut at the end. The whole path is the row's title and what a copy takes. What stands before and after the path keeps its place.

## Out of scope

- Editing or approving a single tool call. An agent's work is steered by talking to it (`011-work`) or stopped.
- Replaying a run step by step.

## Acceptance

- A1. A file edit appears within 1 second as one row: its verb, its path, `+N −M`, and `K edits` when more than one. Pressing the row, or Control+O, opens the diff with syntax colors, old and new line numbers, and added and removed lines tinted; while it is closed nothing of its diff is worked out (the user, 2026-11-23: "One line: 'Edited path +3 −1' on one row; the diff is drawn only when you press it"). Until Settings' default for code changes is closed, a change still arrives open.
- A2. Three edits to one file in a row are one row whose counts are the file's change so far. An edit to another file between them starts a new row.
- A3. After five shell commands in a row, the canvas shows one folded row for the first four and the fifth open. When a sixth starts, the fifth joins the folded row at once, and the sixth arrives open, fading in as it moves up (2026-11-23).
- A4. A command that exits with a failure stays out of the fold with its exit code after later commands run, and the folded row counts only the ones that passed.
- A5. A running command shows its last lines as they arrive, never more than 12, with its elapsed time. Opening it shows all of its output.
- A6. No thinking text appears on the canvas, except one short line when the agent has thought for more than 20 seconds with nothing else to show, or when the thought states a blocker, a question for the user, or a change of plan.
- A7. Reads and searches in a row are one row that names how many, and opens to the list of paths and queries.
- A8. While the agent works the newest block is in view. After the user scrolls up, the canvas stays where it was put and offers a way back to the newest block.
- A9. Every block can be reached, opened and closed with the keyboard alone.
- A10. A run of 2,000 blocks scrolls at 60 frames per second.
- A11. After the agent finishes, the result block is last and everything before it can still be read and opened.
- A12. Every kind of block arrives closed to its header, a code change too, and settings saved before 2026-11-23 load with code changes closed. After a kind is turned on or off in Settings, its blocks on screen that were not opened or closed by hand follow at once. Control+O still opens and closes them all.
- A13. An agent that keeps tasks shows them in one line above its blocks, such as "2 of 5 tasks · in progress: …", which opens to every task with its state and its description. No task call shows as a block, except one that failed.
- A14. Coming back to an agent's page shown before in this window, its code changes are in their colors on the first paint, without asking the highlighter again. A code change seen for the first time is drawn at once in plain lines of their final size and takes its colors in place, off the page's thread, once it is in or near view; the ones far from view wait until they are scrolled to.
- A15. On an agent's page and a durable hobkin's page, every step, message and answer shows the time it happened to the second, in one column that reads straight down the page and never crowds a row's words, its state or its duration. A row from another day also shows its date. A row with no time shows none, and its words still start where the others' do.
- A16. A file path wider than its row shows its last folders and its file's name after one `…`, as many folders as fit, and the whole path when it fits. A name wider than the row is cut from its front. What the row hides and what it shows add up to the whole path.

## Proof

- A1. check: watch a scripted run that edits a TypeScript file.
- A2. `shared/test/activity-blocks.test.ts` › "edits to one file in a row are one change, and another file starts a new one"
- A3. `shared/test/activity-blocks.test.ts` › "commands in a row fold into one group with the newest open"
- A4. `shared/test/activity-blocks.test.ts` › "a failed command stays out of the fold"
- A5. `shared/test/activity-blocks.test.ts` › "a running command keeps a tail of twelve lines"
- A6. `shared/test/activity-blocks.test.ts` › "thinking is hidden except when long or important"
- A7. `shared/test/activity-blocks.test.ts` › "reads and searches in a row are one group"
- A8. `ui/test/activity-pin.test.ts` › "stays on the newest block until the user scrolls away"
- A9. check: walk a scripted run with Up, Down, Right, Left and End.
- A10. check: load the 2,000 block sample and read the frame-time overlay.
- A11. check: let a scripted run finish and open blocks from its middle.
- A12. `ui/test/agent-blocks.test.ts` › "a block arrives open or closed as Settings says for its kind, and a change in Settings applies at once", "Control+O opens every block and closes them all again, over what was chosen for one of them"; check: watch an agent edit a file, then turn Commands on in Settings.
- A13. `ui/test/agent-tasks.test.ts` › "the tasks read as one line: how many are done, then the one in progress, the next one, or that all are done", "each task keeps the description it was given, and a later one replaces it"; `ui/test/agent-activity.test.ts` › "where the page shows the tasks in their own line, task calls are not steps, and one that failed still is"; check: open an agent that keeps tasks and click its line.
- A14. `ui/test/agent-colors.test.ts` › "a code change colored once is drawn in its colors at once when it is shown again, without asking the highlighter again", "a code change far from view waits for its colors, and one in or near view asks for them", "what is kept is what was shown most lately, up to a bound on how much code, and only once all of it is colored"; check: move between two agents whose steps hold code changes, and back, and watch for a second paint.
- A15. `ui/test/agent-stamp.test.ts` › "a step says when it happened to the second, in the conversation's own clock", "a step from another day says its date too, and one from another year its year", "hobkin's written times read as its numbers do, and a step with no time has no stamp" and "the column is as wide as the widest time of day, whatever the hour"; `ui/test/agent-activity.test.ts` › "a step says when it began, and each command and read in a group when it happened" and "the user's messages sit where they were sent, and split a run of steps around them"; `ui/test/hobkins-send.test.ts` › "every row says when it happened: a message when it was asked or sent, a step when it began, an answer when it ended"; `hobkin/test/cli-job-activity.test.mjs` › "each entry keeps when hobkin first saw it, and what comes after never moves it". Seen 2026-11-15 as a still render (server markup with the app's built CSS, no browser, canned activity): a durable hobkin's page in light and dark, with every block opened, at the split's width, and a routine run's page.
- A16. `ui/test/file-path.test.ts` › "a long path loses its first folders one by one, with one mark where they were", › "the file name stays whole while it fits, and only then is cut from its front", › "the cut follows measured pixels, not characters" and › "what the row holds unseen and what it shows add up to the whole path, which is what a copy takes"; `ui/test/agent-activity.test.ts` › "what it is doing now fits one line: the tool it runs, or the last thing it said" (a path says it is one); check: a still render of a row at 600, 300 and 220 pixels (2026-11-23), then the live window while the split is dragged.

## Steps

- [ ] S1 (A2, A3, A4, A5, A6, A7). The function from activity to blocks, with its tests.
- [ ] S2 (A1, A3, A7, A11). The block components, with the diff from `008-review-code`, on a scripted run.
- [ ] S3 (A8, A10). Pinning to the newest block, and the virtual list.
- [ ] S4 (A9). Keys.
- [ ] S5 (A1, A5). Live activity through the host.
- [x] S6 (A16). Paths cut from the front: the rule 36f345e, the step rows 251e152, the line that says what the agent is doing 5409d12. Seen only as a still render: the refit while the window is resized, the first paint and what a copy takes in the window were not seen.

## Open questions

- What counts as a thought worth surfacing? This spec uses fixed cues in the thought's text (blocked, cannot, need the user, instead, changing approach). A different rule may fit the user's models better.
- Agents on other harnesses (Claude, Codex) report activity in other shapes. The first version draws Pi's.
