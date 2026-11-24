---
{
  "id": "064-review-story",
  "title": "Go through the reviews one by one, like a story",
  "kind": "work",
  "status": "doing",
  "depends": ["032-change-review", "060-make-it-a-stack", "061-finished-changes-rows"],
  "updated": "2026-11-24"
}
---
# Go through the reviews one by one, like a story

## Outcome

With ten or more changes waiting on the user, the list of reviews offers to take them in order, one after the other. One press on Start opens the first review of an order fixed at that moment. Each verdict closes its review and the next opens by itself, with its place on the panel ("3 of 14") and a Stop. Nobody has to choose the next review from a list of thirty-seven.

The user, 2026-11-24: "feature: if I have 10+ PRs, they should be auto-sorted and move like a story (you have more than 10 PRs, want to go one by one?). this is good fucking UI". Earlier that day, about the same list: "i cant review all the amount of PRs i have because there is no organization". And then: "because I have 37 prs waiting for me, no organization and no guiding on how to go working".

## Decisions

### The offer

- Every review waiting on the user counts: the ready ones, the ones still being built, and the ones waiting their turn. A failed one and one asked to merge that did not merge do not.
- At ten or more, one quiet line sits at the top of the list: "37 changes wait for you. Go through them one by one, easiest first?" and a Start button. Under ten there is no line and no room kept for it.
- The line has no fill of its own and is quieter than the rows under it.

### The order

Decided once, when Start is pressed, and kept until the story ends. A review that appears later is not added.

1. Reviews that are rated come before the ones still being built or not reviewed yet, since those may be ready by their turn.
2. A stack's layers stay together, bottom layer first, at the place of its best layer.
3. The highest priority first (P0 before P1, and a review with no priority last).
4. The safest first: safe to deploy, then no answer yet, then risky, then risky and critical.
5. The smallest change first, by changed lines; a review with no size comes last.
6. A tie keeps the order of the list.

### The story

- A verdict that closes the review opens the next one of the queue with no click. A review that is no longer waiting when its turn comes is skipped. One still being built when its turn comes opens as it is, showing its preparation.
- The panel's top line shows the place and a Stop, beside the hide and close buttons. They are there from the first review to the last, so nothing in the panel moves between reviews.
- Stop, an Escape that leaves the review, the close button, and opening another screen end the story and go back to the list. Nothing opens by itself after that.
- After the last review, the list shows.
- The story lives in memory. A reload ends it.

## Out of scope

- Choosing the order, or filtering what the story takes.
- Adding reviews that arrive during a story.
- Going back to the review before.
- The failed reviews and the merges that did not land.

## Acceptance

- A1. The offer shows at ten or more reviews waiting on the user, counting ready, running and waiting ones, and not under ten.
- A2. The queue follows the order above, with rated reviews before the rest and a stack together, bottom first.
- A3. A verdict that closes a review of the story opens the next review, skipping one that is gone. After the last, nothing opens.
- A4. A verdict landing after the reviewer left, an Escape, Stop and another screen end the story.
- A5. The panel shows "3 of 14" and Stop only during a story, and nothing else in it moves.

## Proof

- A1. `ui/test/work-review-story.test.ts` › "the offer counts every review waiting on the user: ready, running and waiting its turn"
- A2. `ui/test/work-review-story.test.ts` › "highest priority first, then safest, then smallest, and ties keep the list order", › "a stack stays together, bottom layer first, at the place of its best layer" and › "reviews still being prepared or not reviewed yet come after the rated ones, even when they press more"
- A3. `ui/test/work-review-story.test.ts` › "the story walks the queue, skips a review that is gone, and ends after the last"; `ui/test/review-landing.test.ts` › "approve and merge closes the review at once: with Merged! when it is known merged, with the host's words when it is not" (the verdict says it closed the review). The step into the next review in the window was not run.
- A4. check: the end of a story is wired to `story-store.ts` `left` and `stop`; none of it was pressed in the window.
- A5. check (still renders): the list's line and the panel's place at 1300 and 760 pixels, dark and light.

## Steps

- [x] S1 (A1, A2, A3). The order, the offer's count and the story's state, with their tests. 9c8997d.
- [x] S2 (A3). A verdict says whether it closed the review. 930a8bd.
- [ ] S3 (A1, A3, A4, A5). The offer on the list, the story store, the place on the panel, and the next review after a verdict.
- [ ] S4. In the app's window, with the user's own list.
