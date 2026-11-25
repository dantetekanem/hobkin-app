---
{
  "id": "067-review-list-one-list",
  "title": "The Review list as one list, each row saying its own state",
  "kind": "work",
  "status": "doing",
  "depends": ["032-ai-reviews", "058-review-line", "064-review-story", "066-work-one-list"],
  "updated": "2026-11-25"
}
---
# The Review list as one list, each row saying its own state

## Outcome

The Review list is one list. Every row says its own state in the same place, in words that are true: its rate and five grades when it is rated, "Reviewing" with its percent only while its review runs, "Waits its turn" with how many are ahead while it waits, "Review failed", "Did not merge". The projects are quiet headings over their rows, a visual aid only. There are no category headings.

The user, 2026-11-24, about this list: "review is also broken", "there are a list of 'running' which isnt running", "these made up categories are all broken".

And, earlier today, about the same kind of list on Work: "none of these make any sense", "fuck those categorties, all bad", "the grouping is a visual aid only", "i want the grades ALWAYS. so i can decide", "I have 37 prs waiting for me, no organization and no guiding on how to go working", "none of these changes should degrade performance".

And, for every row: "i need full control, a fucking `...` allowing me to do whatever i want".

## Decisions

### What was wrong

- The list had four headings: "Asked to merge, not merged", "Running", "Ready" and "Failed". A review that only waited its turn sat under "Running", so a list of rows that were not running said they were.
- The tab said "N running" by the same rule.
- Repositories had their own section, and the rows that waited were folded under it, away from the list.

### The state of a row

- Reviewing: the review runs, or its review is being prepared (reading, arranging, checking). Nothing else is called running.
- Waits its turn: the host says so, the review is queued behind others, or preparation has not started. It says how many are ahead when the host says.
- Review failed: it stopped. The host's reason is under the title, in two lines at most and whole in its tooltip.
- Did not merge: the user said merge and it failed. A tag and the reason under the title. A merge that only waits has no row.
- Ready: a review opens. With no ratings it says "Not rated".

### A row

- In front, one narrow size whatever it holds, so the height does not change when a rating lands: the general rate alone, in its tone, when rated; otherwise the state in words ("Reviewing · 48%", "Waits its turn · 3 ahead", "Review failed", "Not rated"). The five grades (Cover, Proof, Safe, Watch, Undo) are on a hover of the rate, in the app's Tooltip: one line each with its number and its evidence, or its question when the review gave none. A grade not known is a dash. The user, 2026-11-24, for every row: "just leave the average rate and a hover to see details".
- A rated row that is also reviewing, waiting or failed says so in a small tag by its title. An older rating says so in a tag.
- The one action stays at the right: Review again, Rebuild, Review now or Stop. After it, in the same place on every row, a "..." menu with everything the row can do: open the review, build it again, Make it a stack where offered, Stop where the host allows it, open the pull request on GitHub, Remove, and Remove and delete branch. The last two ask a second time in the menu, which stays open for it.

### Stacks and one row each

The user, 2026-11-24, looking at four full cards of the rpsleague stack: "does this looks like a stack?". Earlier the same day, of Work: "i should see the main one, the others as a grouped effect of cards, a nice looking badge of which one of how many", "i want the card and all other 4 below in lines with arrows", "and review should connect them".

- A stack is drawn as on Work: one quiet frame under "Stack of 4 · name", its layers bottom first. The lowest layer here is the whole row (rate, state, action, "..."). Each layer over it is one line: its place ("2 of 4"), title, rate or state and its "...", with an arrow in front that curves down from the layer under it and points right. A press on a line opens its whole row under it and closes it again. A layer alone in its stack is an ordinary row.
- The frame sits at the place its best layer takes in the order, and the order never splits it, in every order.
- One row for each layer. A change review and a pull request review are the same layer when they share the stack id and layer, or the head commit; a pull request review is matched to a finished change by the pull request that change opened, or by the head commit. The row shown is the pull request's when there is one, since merging happens there. It borrows what it lacks from the other: grades, summary, priority, and a merge that did not land. Outside stacks, two reviews at the same head commit are one row by the same rule.
- Why: pull requests opened outside hobkin are not named by the item, so a layer was listed twice, once as `change:rpsleague:<item>` and once as `pr:dantetekanem/rpsleague/<n>`, and the list said "41 changes wait for you".
- A pull request review is listed under the hobkin project whose `repo` (`owner/name`, not case sensitive) is its repository, so one project has one heading. A pull request in no known project keeps `owner/name`.
- Every count follows the rows shown: the offer ("N changes wait for you"), the order control, each heading (a stack's layers counted one by one) and the story's queue.
- A pull request that matches no finished change takes its place from the user's open pull requests (`pullStacks`, `shared/review/pull-stacks.ts`: a pull request whose base branch is another's head branch sits on it), so a stack opened outside hobkin is one frame too. The list reads them from the GitHub part's slice the window already holds: no new host command and no polling.
- One stack is one frame. A change and a pull request are the same layer when the pull request is the one the change opened, is at its commit, or is on its branch; a stack of hobkin's and a stack of pull requests are the same stack when a layer or a branch joins them (a change's branch is a pull request's head or its base). A frame that holds pull requests is numbered by the pull requests' order, for every layer in it: hobkin counts a layer the user said merge to out of its own stack, so its numbers and the pull requests' disagree, and two numberings in one frame would make "2 of 3" and "3 of 5" sit side by side. A layer of hobkin's with no pull request sits just under the pull request that is based on its branch, else beside its neighbours in hobkin's own stack. Never two frames for one stack, never a layer twice.
- A layer the user already said merge to (a finished change with a waiting merge, listed in the work's `merging`) has no row, so the frame draws it as one quiet line, "merging", in its place, with its place and title and nothing to press. It is read through its pull request or its branch; a merge no pull request or branch joins to a stack has no line. If that merge failed, its own row is shown and the line is not drawn beside it.
- Work's own stack frame is unchanged: it draws hobkin's finished changes only.

### The tab

- The tab beside "Ready for Review" shows one number: the reviews that wait on the user, over the rows shown. The three chips ("not merged", "running", "ready") are gone: the user rejected categories ("these made up categories are all broken"). A merge that did not land keeps its red mark and reason on its own row, not on the tab.

### The list and its order

- One list, cut by project under a quiet heading with its name, its count and, where the host keeps one, its line of reviews in words.
- The orders: Easiest (the story's own, the default), Priority, Newest, Oldest, Smallest. The control is in one place above the list. In Easiest a merge that failed comes first and reviews that stopped last.
- A row's place holds while the user looks at the list. The list is sorted again only when its set of rows changes or the user picks an order. Facts on a row (percent, state, grades) change in place.
- The story offer stays at the top, and its order is the same as Easiest.

### Cost

- No new host command and no polling: the list is read as before, every second while a review runs or waits and every three seconds otherwise.
- The rows, the story queue, the project cut and the order are held, and computed again only when the list, the order or what the order reads changes.

## Out of scope

- The Work page's own list (spec 066) and its menu.
- The host. The GitHub window still reads `ReviewRow.group`, which keeps its old meaning there.

## Acceptance

- A6. A stack of two layers or more is one frame with its layers bottom first, in every order; a layer is never listed twice; a pull request sits under its project; counts follow the rows shown.
- A8. A stack of pull requests with no change of hobkin is one frame; a mixed stack is one frame, numbered by the pull requests' order; a layer said merge to is a quiet "merging" line in its place.
- A7. The tab has one number and no category words.
- A1. No heading says Running, Ready, Failed or Asked to merge. Each project has a heading with its count.
- A2. A row says Reviewing only while its review runs or is prepared; a row that waits says Waits its turn with how many are ahead.
- A3. The orders put rows as above; the story's order is the default.
- A4. A row does not move when only its facts change.
- A5. Everything a row did before is in its menu.

## Proof

- A6. `ui/test/work-review-stacks.test.ts`; still renders at 1300 and 760 pixels, dark and light. No press or key was run in the real window.
- A8. `ui/test/work-review-stacks.test.ts`.
- A2. `ui/test/work-ai-reviews.test.ts`, `ui/test/work-review-list.test.ts`, `ui/test/work-review-story.test.ts`.
- A3. `ui/test/work-ai-reviews.test.ts`, `ui/test/work-review-list.test.ts`, `ui/test/work-review-story.test.ts`.
- A4. `ui/test/work-ai-reviews.test.ts`, `ui/test/work-review-list.test.ts`, `ui/test/work-review-story.test.ts`.
- A1. Still renders at 1300 and 760 pixels, dark and light. No press or key was run in the real window.
- A5. Still renders at 1300 and 760 pixels, dark and light. No press or key was run in the real window.
- A7. Still renders at 1300 and 760 pixels, dark and light. No press or key was run in the real window.
