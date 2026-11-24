---
{
  "id": "067-review-list-one-list",
  "title": "The Review list as one list, each row saying its own state",
  "kind": "work",
  "status": "doing",
  "depends": ["032-ai-reviews", "058-review-line", "064-review-story", "066-work-one-list"],
  "updated": "2026-11-24"
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

- In front, one size whatever it holds, so the height does not change when a rating lands: the rate and the five grades (Cover, Proof, Safe, Watch, Undo) when rated; otherwise the state in words. Each grade has its question as its tooltip. A grade not known is a dash.
- A rated row that is also reviewing, waiting or failed says so in a small tag by its title. An older rating says so in a tag.
- The one action stays at the right: Review again, Rebuild, Review now or Stop. After it, in the same place on every row, a "..." menu with everything the row can do: open the review, build it again, Make it a stack where offered, Stop where the host allows it, open the pull request on GitHub, Remove, and Remove and delete branch. The last two ask a second time in the menu, which stays open for it.

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

- A1. No heading says Running, Ready, Failed or Asked to merge. Each project has a heading with its count.
- A2. A row says Reviewing only while its review runs or is prepared; a row that waits says Waits its turn with how many are ahead.
- A3. The orders put rows as above; the story's order is the default.
- A4. A row does not move when only its facts change.
- A5. Everything a row did before is in its menu.

## Proof

- A2, A3, A4: `ui/test/work-ai-reviews.test.ts`, `ui/test/work-review-list.test.ts`, `ui/test/work-review-story.test.ts`.
- A1, A5: still renders at 1300 and 760 pixels, dark and light. No press or key was run in the real window.
