---
{
  "id": "021-agent-rendering",
  "title": "How an agent's work is drawn",
  "kind": "work",
  "status": "ready",
  "depends": ["008-review-code", "011-work"],
  "updated": "2026-11-09"
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
  | Code change | Each file edit or write | A diff with the review's diff component: path, added and removed lines, syntax colors, three lines of context with expansion |
  | Shell group | Shell commands in a row | Only the newest command is open: its command line, a live tail of its output, its state and time. The ones before it fold into one row, "4 commands", which opens to the list |
  | Read group | File reads and searches in a row | One row, such as "read 6 files, searched twice", which opens to the list |
  | Thinking | Thinking | Hidden. See below |
  | Result | The run's final report | Markdown, with the branch and the proof it names |

- Edits to the same file in a row are one code change block that updates in place. It shows the file's change so far, not each step.
- A command that failed is never folded away. It stays open with its exit code and its last lines, even when later commands follow.
- A command that is running shows at most its last 12 lines of output and its elapsed time. The full output opens on request.
- Thinking is hidden. While the agent thinks, the canvas says so and for how long. A thought is surfaced, as one short line, only in two cases: the agent has been thinking for more than 20 seconds with nothing else to show, so the user can tell it is not stuck, or the thought states a blocker, a question for the user, or a change of plan.
- Above the blocks, in one line and with no box around it: the agent's mission (goal, question, expected result), what it is doing now, the time so far, its tier and its tokens. The mission opens in full on request.
- Motion: a new block rises into place. When a command gives way to the next, it slides up into its group's row. A code change draws its lines in. Output streams without the block jumping.
- Keys: Up and Down move between blocks, Right or Enter opens a group or a diff, Left closes it, End returns to the newest block. Stepping into the agent to talk to it is `011-work`.
- A long run is drawn with a virtual list, so its length does not slow the canvas.

## Out of scope

- Editing or approving a single tool call. An agent's work is steered by talking to it (`011-work`) or stopped.
- Replaying a run step by step.

## Acceptance

- A1. A file edit appears as a diff with syntax colors, old and new line numbers, and added and removed lines tinted, within 1 second of the edit.
- A2. Three edits to one file in a row are one block showing the file's change so far. An edit to another file between them starts a new block.
- A3. After five shell commands in a row, the canvas shows one folded row for the first four and the fifth open. When a sixth starts, the fifth joins the folded row with a movement the eye can follow, and the sixth is open.
- A4. A command that exits with a failure stays open with its exit code and last lines after later commands run, and the folded row counts only the ones that passed.
- A5. A running command shows its last lines as they arrive, never more than 12, with its elapsed time. Opening it shows all of its output.
- A6. No thinking text appears on the canvas, except one short line when the agent has thought for more than 20 seconds with nothing else to show, or when the thought states a blocker, a question for the user, or a change of plan.
- A7. Reads and searches in a row are one row that names how many, and opens to the list of paths and queries.
- A8. While the agent works the newest block is in view. After the user scrolls up, the canvas stays where it was put and offers a way back to the newest block.
- A9. Every block can be reached, opened and closed with the keyboard alone.
- A10. A run of 2,000 blocks scrolls at 60 frames per second.
- A11. After the agent finishes, the result block is last and everything before it can still be read and opened.

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

## Steps

- [ ] S1 (A2, A3, A4, A5, A6, A7). The function from activity to blocks, with its tests.
- [ ] S2 (A1, A3, A7, A11). The block components, with the diff from `008-review-code`, on a scripted run.
- [ ] S3 (A8, A10). Pinning to the newest block, and the virtual list.
- [ ] S4 (A9). Keys.
- [ ] S5 (A1, A5). Live activity through the host.

## Open questions

- What counts as a thought worth surfacing? This spec uses fixed cues in the thought's text (blocked, cannot, need the user, instead, changing approach). A different rule may fit the user's models better.
- Agents on other harnesses (Claude, Codex) report activity in other shapes. The first version draws Pi's.
