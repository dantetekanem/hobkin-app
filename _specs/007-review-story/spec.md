---
{
  "id": "007-review-story",
  "title": "Change Review: the story",
  "kind": "work",
  "status": "doing",
  "depends": ["006-review-graph"],
  "updated": "2026-11-10"
}
---
# Change Review: the story

## Outcome

Reviewing a change is a guided walk. The right arrow moves to the next step: the camera travels along a wire to the next node, that node comes into focus, the rest blurs, and a short text teaches what this part does and why. The reviewer always feels movement from one thing to the thing it connects to.

## Decisions

- A step has a title, a teaching text, one to three focus nodes, the acceptance ids it serves, and the wire the camera rides in on when the step's focus connects to the previous one.
- Focus has three levels. Focus nodes are sharp with an accent ring. Their direct neighbors are dimmed and sharp. Everything else is faded, never so far that it cannot be read, and not blurred (the user, 2026-11-12: the page was too dim and blurred to read; this replaces "blurred and faded"). Wires that touch the focus stay bright, and the others fade.
- Moving to a step:
  1. A pulse travels along the connecting wire from the previous focus to the new one, and the camera follows it. Without a connecting wire the camera glides straight.
  2. Nodes and wires seen for the first time draw in, each wire from its visible end.
  3. The step's text appears beside the focus, on the side with the most room, and never on top of a focus node.
- The camera always frames the focus nodes inside the part of the canvas that is not covered, which shrinks when the code panel is open.
- All movement is interruptible. A second key press retargets the camera from where it is.
- The story rail is a row of segments, one per step, in the style of the rail on hobkin.dev. The current segment is wide and accented. Steps the reviewer has seen are filled.
- Keys: Right or Space for next, Left for previous, Home and End for first and last, `1` to `9` and `0` for steps 1 to 10, Enter to open code for the focus, `S` to go to the steps panel and back, `G` for the whole graph. An Escape with nothing left to step back from is the frame's.
- A digit goes to its step: `1` to `9` are steps 1 to 9 and `0` is step 10. Two digits typed within 600ms make one number. A number that cannot grow into another step of the story is taken at once, so a story of nine steps never waits. A number past the end is the last step. The rail shows the digits while they wait. The camera makes one movement to the step, however far.
- `G` shows the whole graph, which `0` did before digits went to steps. G is the graph, it needs no modifier, and ⌘G stays the frame's.
- Focus moves by connection first. Up and Down go to the nearest node above or below. Shift with Right follows a wire this node sends, and Shift with Left a wire it receives, to the end nearest in height. With no wire on that side they go to the nearest node that way.
- `/` opens a finder: any node by name, its humps (`wr` for workingRow), its path, its acceptance id or its kind, every word typed matching. The node the keyboard is on lights up in the graph before the reviewer goes there, and Enter goes.
- `,` and `.` go back and forward through the places the reviewer jumped to: a node found or followed, a step reached by number or the rail, the whole graph. A walk with Left and Right is not kept, because Left and Right already undo it.
- Escape steps back one level at a time: the note editor, the finder, an open wire, selected lines, the code panel, a detour back to its step, the step to the whole graph. Only then is it the frame's, which closes the review.
- A note in the steps panel goes to what it is about when chosen: its step, its node, its wire, or its lines in the code panel.
- The steps panel sits on the left of the review, full height, as in pi-coder's Steps sidebar: the story's summary, then every step by number and title, seen steps marked, the current one highlighted with its text and its notes (`009-review-notes`) under it, then the review's facts and keys. A long story folds the steps far from the current one into ranges.
- The panel is always part of the screen. While the reviewer walks the story or moves the graph it tucks away to a strip, dimmed and slightly blurred, and it comes back whole when they go to it: the pointer over it, the keyboard in it, or `1`. It can be pinned open. The camera counts the part of it on screen as covered, so a focus is never framed under it.
- While the panel is open it tells the step in full, so the card beside the focus keeps only the step's number and title: a step is never told twice. Tucked away, the card beside the focus carries the whole text.
- Clicking any node focuses it outside the story. A control then offers "Back to step N".
- The conversation shows a chip above the input with the review's title and the current step. A message sent during a review carries the step and the focused node to hobkin as context.
- The step index and the seen steps are saved with the review's progress.

## Out of scope

- Voice narration and autoplay.
- Editing the story.

## Acceptance

- A1. Right and Left, and the on-screen arrows, move one step. The focus nodes are sharp, their neighbors are dimmed, and all other nodes are blurred and faded.
- A2. When the new focus is wired to the previous focus, a pulse runs along that wire from old to new and the camera arrives with it. When it is not, the camera moves in a straight glide.
- A3. After every step change, each focus node is fully inside the uncovered canvas area, with the code panel closed and with it open.
- A4. A node or wire that appears in the story for the first time draws in. On later visits it is already there.
- A5. The step's title, text and acceptance ids show beside the focus without overlapping a focus node, at window widths from 1100px up.
- A6. The rail has one segment per step. The current one is wider and accented, a click on a segment jumps to its step, and hovering shows its title.
- A7. Pressing Right three times within 300ms ends on the third step ahead, with one continuous camera movement and no jump.
- A8. After clicking a node that is not in the current step, "Back to step N" is offered and returns to that step.
- A9. Closing and reopening the review, or the app, returns to the same step with the same seen marks.
- A10. While a review is open, the chip above the conversation input names the review and the step, and a sent message reaches hobkin with that step and node attached.
- A11. With reduced motion on, a step change is a cut with a short fade. There is no blur, no pulse and no camera travel.
- A12. The steps panel tucks to a strip while the story moves and opens whole on pointer, focus or `1`. No focus node and no step text is framed under it, tucked or open.
- A13. A long story folds the steps far from the current one into ranges, keeping both ends of the story and the steps around the current one.
- A14. `1` to `9` go to steps 1 to 9 and `0` to step 10. Two digits typed within 600ms make one number, a number that cannot grow is taken at once, and the camera arrives in one movement however far the step.
- A15. `/` finds any node by name, humps, path, acceptance id or kind, ranks the start of a name first, lights the chosen node in the graph, and Enter focuses it.
- A16. `,` goes back and `.` forward through the places the reviewer jumped to, not through single steps along the story.
- A17. Escape steps back one level at a time, and a detour returns to its step before the step gives way to the whole graph. Only an Escape with nothing left reaches the frame.
- A18. Choosing a note in the steps panel goes to what it is about.

## Proof

- A1. `ui/test/review-focus.test.ts` › "assigns focus, neighbor and background levels for a step"
- A2. `ui/test/review-travel.test.ts` › "picks the connecting wire, or a straight glide when there is none"
- A3. `ui/test/review-camera.test.ts` › "frames the focus inside the uncovered area"
- A4. `ui/test/review-focus.test.ts` › "reveals a node once"
- A5. `ui/test/review-camera.test.ts` › "hangs the step text under its node, never on another focus node"
- A6. `ui/test/review-pager.test.ts` › "the pager counts the steps and walks them: back and next one at a time, a position straight there"
- A7. check: press Right three times fast and watch for a jump.
- A8. `ui/test/review-focus.test.ts` › "remembers the step when focus leaves the path"
- A9. `ui/test/review-progress.test.ts` › "restores the step and the seen marks"
- A10. `host/test/review-context.test.ts` › "a message sent during a review carries the step and node"
- A11. check: reduced motion on, step through the story.
- A12. `ui/test/review-camera.test.ts` › "the left panel is covered area too, tucked or open"
- A13. `ui/test/review-notes.test.ts` › "a long story folds the steps far from the current one into ranges"
- A14. `ui/test/review-digits.test.ts` › "two digits typed quickly make one number"
- A15. `ui/test/review-finder.test.ts` › "finds a node by the start of its name first, then by a word in it, then anywhere in it"
- A16. `ui/test/review-history.test.ts` › "back and forward walk the places the reviewer jumped to"
- A17. `ui/test/review-focus.test.ts` › "Escape steps back one level at a time, and the last Escape is the frame's"
- A18. check: in the steps panel, choose a note on a node, one on a wire and one on lines. Each goes to what it is about.

## Steps

- [x] S1 (A1, A4, A8). The story state: current step, focus levels, revealed set, off-path focus.
- [ ] S2 (A2, A3, A7). The camera: framing inside the uncovered area, travel along a wire, retargeting.
- [ ] S3 (A5, A6). The step text and the rail.
- [x] S4 (A9). Saved progress.
- [ ] S5 (A10). The review chip in the conversation and the context sent with a message.
- [ ] S6 (A11). The reduced-motion path.
- [x] S7 (A12, A13). The steps panel: the list, folding, tucking away, and the covered area it adds to the camera.
- [x] S8 (A14, A16, A17). Digits to steps, focus history, and Escape one level at a time.
- [ ] S9 (A15, A18). The finder, and notes that go to their target.
