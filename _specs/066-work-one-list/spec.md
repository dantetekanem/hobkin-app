---
{
  "id": "066-work-one-list",
  "title": "Work's finished changes as one list with the grades in front",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "061-finished-changes-rows", "060-make-it-a-stack"],
  "updated": "2026-11-24"
}
---
# Work's finished changes as one list with the grades in front

## Outcome

Work's finished changes are one list. Every change is a row with the general rate and the five grades in front, the one sentence that matters for it, a few small tags and one action. The projects are quiet headings over their rows, a visual aid only. An order control and a tally line sit at the top. There are no groups, no group sentences and no group yes.

The user, 2026-11-24: "I need to understand the work, have information grouped. information needs to make sense to me, not slop shit all the time"; "i cant review all the amount of PRs i have because there is no organization"; "the grouping is a visual aid only"; "i want the grades ALWAYS. so i can decide."

Of a first mock with categories (Answer, Ready, Check, Stuck, Waiting): "answer? no, wtf", "fuck those categorties, all bad".

Of Work's groups as they were ("Ready to merge 14", "Refresh then merge", "Needs you", "Left for you"): "i dont like this 'Ready to Merge'", "review this whole structure", "needs you, left for you", "none of these make any sense".

And: "because I have 37 prs waiting for me, no organization and no guiding on how to go working". "none of these changes should degrade performance".

The mock the user was shown for this: `changes-list-mock.html` (https://claude.ai/artifact/2JWMkrrrmro6M1b1DsDgZp).

## Decisions

### What was wrong

- The four groups are hobkin's own categories. The user does not think in them, and a change sat in one because of how it could land, not because of what it was.
- The grades, the one thing the user decides by, were in the open row, a click away.
- Each group's yes ("Merge all 14") asked for trust in a list the user had not read.

### The list

- The host still sends the groups and the YOLO page still reads them. The window flattens them: every change of every group is one entry, a stack is one entry, and nothing is added to the host or to the shared shapes.
- Entries are put in one order (below) and then cut by project. A project's heading says its name and its count, in small quiet type. The projects come in the order of their first entry, so the order control still decides what is on top.
- The project chips filter the list as they do now.
- No group heading, no group sentence and no group yes. Nothing on the screen says "Ready to merge", "Refresh then merge", "Needs you" or "Left for you".

### A row

- In front, in the same place on every row: the general rate and the five grades, Cover, Proof, Safe, Watch and Undo. Their numbers are hobkin's scores for the change, in the order the host sends them.
- A change not graded says why in that same place, in two or three words: "grading" while its review runs or waits, "review failed", "not reviewed", "not graded". It is never blank and never a dash.
- The block is compact and has one size whatever it holds (the rate and five grades fit it exactly, and so do the words), so the row's height does not change when the grades land and the title keeps the room.
- Then the title with its priority and its place in a stack ("1 of 5"), small tags, and one sentence.
- At the right, its size, its one action and the chevron that opens the row. Where the row is narrow, the grades block stays in front, on the row's first line, and the title and the sentence go under it.

### The sentence

The first that exists of:

1. The run's note, marked as the run's own words.
2. What stands in the way: a conflict, being behind its base, a layer under it that has not landed, a grade under its floor, a review that rates it risky.
3. What the change did.
4. Why it is waiting, which every change has.

### The tags

Small, in this order: "left you a note", "conflicts", "N behind", "changes requested" and "checks fail" on its pull request, and "N lines" above 300 lines. A risky review shows in the review badge that already follows the row, and in the sentence. The mock's "not yours" is not built: the window does not know who the user is on the pull request's host.

### The one action

- Merge, in hobkin's own words for that change (the label of its merge choice), only when the change is rated at or above the user's lowest rate, from the YOLO rules when the window has them and 8 whenever they give none, and nothing is in the way: no note, no conflict, not behind, no layer under it, no grade under its floor, scores not for an older commit, and not rated risky.
- Refresh code when it is behind or conflicts and has a choice that brings it up to date. It does hobkin's own yes for that change, which refreshes and then merges, or has an agent rebase it, and its tooltip says so.
- Review otherwise, and always for a row with a note.
- Make it a stack stays in Change Review, beside Refresh review, above 300 lines. It is not a row's action.
- Everything else a card could do stays in the open row: Ask for changes with its reply box, Close without merging, Review again, Open PR, and the rest.

### The menu

- Every row, and every layer's line in a stack, has a "⋯" right after its one action, in a fixed place. It is one of the row's own controls and opens the app's dropdown menu, which Escape closes.
- It lists every choice hobkin gave the change, in its words and order (merge, refresh and merge, have an agent rebase it, show the diff, open the PR, review it again, cancel it, close without merging), Review first when none of them opens the change, Make it a stack above 300 lines, and a reply (Reply to its note, or Ask for changes).
- Close without merging asks twice, as it does in the open row. The menu holds its list and its stack store only while it is open.

### The order

An order control in a fixed place beside the section's heading, and the choice lasts while the window lives:

- Easiest first, the default: a stack together, bottom first; rated before unrated; the highest rate; the highest priority; the smallest.
- Priority, then the higher rate.
- Best grade: the highest rate, unrated last.
- Oldest: the longest since hobkin wrote it.
- Smallest: the fewest lines.

A tie keeps the order the host sent. A stack is one entry: it takes its bottom layer's rate, its best priority, its oldest time and the sum of its lines.

### The tally

One line under the heading, and the same height whatever it says: "37 changes in 5 projects. 20 graded, 6 ready to merge at 8 or more." The counts are the list's own: the changes shown after the project filter, those with scores, and those whose action is Merge.

### Cost

- No new host command, no polling, no subscription per row. The list, the order, the cut by project and the tally are computed once per change of the work state, the filter and the order, and held.
- A row keeps the review follow it has.

## Out of scope

- The host, the shared shapes and the YOLO page, which still use the groups.
- The queue, AI Reviews and the projects list.
- Filtering by words, and a pane beside the list.
- A key to move to the next change that needs the user.
- "not yours".

## Acceptance

- A1. One list: no group heading, sentence or yes. Each project has a quiet heading with its name and count, and the chips filter it.
- A2. Every row has the rate and the five grades in the same place, or two or three words saying why not. The row's height is the same either way.
- A3. A row's sentence is the run's note, else what stands in the way, else what the change did.
- A4. A row's one action follows the rule above, and a row with a note says Review.
- A5. The five orders put rows in the orders above, and the choice stays after the list changes.
- A6. The tally counts what the list holds.
- A8. Every row and layer has a "⋯" with every action the change can take.
- A7. Open in place, Space, Enter, the arrow keys, the reply box and stacks work as they did.

## Proof

- A1. Check (still renders at 1300 and 760 pixels, dark and light): the whole section.
- A2. Check (still renders): graded, grading and not reviewed rows side by side; `ui/test/work-change-list.test.ts` for the rate and the five cells.
- A3, A4, A5, A6. `ui/test/work-change-list.test.ts`.
- A8. `ui/test/work-row-menu.test.ts`; the menu's items are the host's choices.
- A7. The row's keys and its open body are the ones spec 061 built and are unchanged: `ui/test/work-change-row.test.ts`. No press or key was run in the real window.

## Steps

- [x] S1 (A3 to A6). The pure list: flatten, project cut, sentence, tags, action, orders, tally.
- [x] S2 (A1, A2, A7). The section and the row in place of the groups.
- [x] S2b. The row menu.
- [ ] S3. In the app's window, with the user's own changes.
