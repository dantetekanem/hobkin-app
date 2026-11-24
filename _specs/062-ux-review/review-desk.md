# Review desk: one list for 30 finished changes across five projects

Lane: UX review, read-only except this file. Date: 2026-11-24. Everything under "Today" was read in the code at the line given. Everything under "Other tools" was read on the page whose address is given. Where I infer, I say so.

## The answer in short

Today a finished change is listed by how hobkin can land it. The user has to read by what they do next. So the list becomes one list, called Changes, grouped by what the user does next, with five states, and every change in exactly one. Inside a state, changes sit under their project. A stack is one row. Every row has the same slots in the same order. The Work page's Finished changes, the AI Reviews tab and the GitHub pull request tab all turn into this one list or into a fact on its rows. Opening a change starts a walk: a verdict moves to the next row, and Escape goes back to the list.

## 1. Inventory: every place a finished change or pull request is listed

The table lists each place, what it lists, how it groups, how it orders, the facts on a row, and what the user can do there.

| Place | What it lists | Grouped by | Ordered by | Facts on a row | Actions |
| --- | --- | --- | --- | --- | --- |
| Work page, Finished changes (`ui/src/features/work/Finished.tsx:40`, `ChangeRow.tsx:79`) | hobkin's finished changes, all projects mixed, plus unmerged-but-asked rows from `work.merging` | hobkin's landing groups: Needs you, Left for you, then Ready to merge and Refresh then merge (`finished-cards.ts:9-12`). A stack sits in the group of its bottom layer (`stacks.ts:25-29`) | Needs first, then hobkin's own order inside a group. No order the user can change. Not by project, not by age | Fact line: project, issue, size, "N behind", PR review state, checks, Draft, PR link, model checks (`change-row.ts:44-54`). Then grade, "2 of 5", title, review badge. Then one sentence that depends on the group (`change-row.ts:63-73`) | One action per closed row: Answer, the change's own yes, or Review (`change-row.ts:80-85`). Open row: every card action, Ask for changes, Review again, Close without merging (`ChangeRow.tsx:217-261`). One yes per group with a question page listing every title (`Finished.tsx:165-280`). Enter opens Change Review, Space opens the row (`ChangeRow.tsx:137-144`) |
| Work page, "You said yes, merging" (`Finished.tsx:71-128`) | Changes the user said yes to that wait for a refresh | One block | The host's order | Project, title, issue and PR links, "You said yes at 14:02" | None. Links only |
| Work, AI Reviews tab (`AiReviews.tsx:32-72`, `ai-reviews.ts:90-98`) | Every review the host knows, finished changes and PRs together | Asked to merge, not merged / Running / Ready / Failed. Here "Ready" means the review is built, not that the change can merge | Priority, newest or oldest, a switch the user sets (`ai-reviews.ts:25`). Running rows under way come first (`ai-reviews.ts:208-210`) | Kind icon, project or `owner/repo #n`, grade, "Pull request" or "Finished change", five ratings and rate, author, time. Title, review badge, progress, why (`AiReviews.tsx:306-368`) | Open the review, Review again or Review now or Rebuild, Stop, Make it a stack, Remove, Remove and delete branch (`AiReviews.tsx:360-368`, `415-491`) |
| Work, AI Reviews, "Repositories" lines (`AiReviews.tsx:91-130`) | One line per repository: "3 current, 12 waiting, 2 outdated, 9 built this week, about 1.1M tokens" | Repository | Host's order | The counts | Fold out the waiting rows |
| GitHub page, Pull requests tab (`GitHubScreen.tsx:365-392`, `rows.tsx:164-213`) | Open PRs that ask for the user's review, the user's own PRs, and the last PRs the AI reviewed | Review requested / Your pull requests / Recently reviewed by AI. A project filter row above, All plus one tab per project, with counts (`GitHubScreen.tsx:124-127`) | GitHub's "most recently updated", 50 at most per list (`shared/protocol/github.ts`, `GITHUB_LIMIT`) | `owner/repo #n`, author, "updated 2h ago", checks chip, review chip (own PRs only), Draft, size, three labels, and a column with the AI review's state (`rows.tsx:182-209`) | Open the review (title), Open on GitHub, Start AI review or Open review or Try again. The key `r` refreshes (`GitHubScreen.tsx:158-163`). It cannot merge or send back |
| GitHub page, Issues tab (`rows.tsx:309-336`) | The user's issues | One group | GitHub's order | Repo, number, labels, assigned or opened | Add to queue, Close issue. Not changes, so out of this model |
| Project page, "Waiting for you" (`project/sections.tsx:152-186`, `project/model.ts:278-304`) | The finished changes of one project | Needs-first order, no heading per group | `needsFirst` then host's order | Grade, title, "reason · size", review badge | Opens its review. Nothing else |
| Home, needs cards (`home/model.ts:122-166`, `458-480`) | The user's question, decisions, finished changes, and PR review requests | One mixed "needs" list | Decisions by age, then changes in Work's order, then GitHub review requests | A card: title, project, up to five facts: size, grade, safety, behind, conflicts | Review, Open on GitHub |
| Work header, tiles and tab counts (`WorkScreen.tsx:467-468`, `384-386`; `work-tiles.ts:28-34`; `GitHubScreen.tsx:191`) | Four different counts | Not applicable | Not applicable | "N finished" in the title, "N not merged / N running / N ready" on the AI Reviews tab, the "waiting" tile (every card, and a second number for needs-you), "N to review" on the GitHub tab | Tiles open Numbers |
| YOLO page, Next to merge (`shared/protocol/work.ts:307-315`; spec 053 says each row opens its review) | Changes waiting on one project, in the order hobkin weighs them | Project | hobkin's | Title, kind, rate, why it still asks | Opens its review. I did not read `YoloScreen.tsx`, so this row comes from the protocol and the spec |

### What the inventory shows

- One change can be in three places at once. A finished change with a PR is a card on Work, a row on AI Reviews (`ReviewListItem.pr`, `shared/review/status.ts:208-209`), and on the GitHub page when the PR is the user's (`ChangeRow.tsx:88` finds the PR by its address in the GitHub lists, which is how I know both lists can hold it). The last link is an inference: I did not run it.
- The same word means two things. "Ready" on the AI Reviews tab means the review finished (`ai-reviews.ts:18`). "Ready to merge" on Work means the change can land. A tab saying "9 ready" next to a group called "Ready to merge" is two different nine's.
- There are four counts of overlapping sets (the Work title, the tab, the tile, the GitHub tab) and none says "what is left for you".
- No place says whose turn it is. "Needs you" is hobkin's reason it cannot land by one yes (`work.ts:404-411`, host), which is not the same as "the user has something to do". A change that merges after a refresh with no user step still sits among the user's changes.
- The project is a word at the start of a fact line (`change-row.ts:45`) on Work and AI Reviews. Only the GitHub page and the project page can narrow by project.
- Order is not under the user's hand on Work, where most of the changes are. It is on AI Reviews and nowhere else.
- The keyboard goes row to row inside one list, and into a change and back out. Nothing goes from one change to the next. `escapeReview` and `closeReview` return to the list (`ui/src/features/review/entry.ts`, `view-store.ts:376-383`). Spec 061 left sorting, filtering and a side pane out of scope (`_specs/061-finished-changes-rows/spec.md`, "Out of scope").

## 2. What the best tools do

I give the pattern, then the address. "Read" means I read the page. Where a page did not say, I say so and do not fill it in.

### Whose turn it is is the top level

- Phabricator's home groups revisions into "Action Required" and "Waiting on Others", for both author and reviewer. https://secure.phabricator.com/book/phabricator/article/differential/ (read; it does not describe statuses or stacks).
- Gerrit keeps an attention set per change: who is expected to act next. The default dashboard has a "Your turn" section at the top, and a "Waiting" column says how long the owner has waited for the user. A reply removes the user from the set; a new patch set that makes a vote outdated adds the reviewer back. https://gerrit-review.googlesource.com/Documentation/user-attention-set.html (read). Custom dashboards are sections written as queries, and `foreach=` adds one constraint to every section: https://gerrit-review.googlesource.com/Documentation/user-dashboards.html (read).
- Reviewable's list sorts into groups "from most to least relevant", "Awaiting my action" first, only-on-me before shared. Inside a group the oldest comes first, and the order cannot be changed. A row shows avatars of the people whose turn it is, counters, and a merge button that replaces the state once checks pass and every counter is zero. A review with no update for two weeks gets a stalled mark. The search takes predicates such as `needs:me`, `am:author`, `+draft`, and "Set as your default" keeps a query. https://docs.reviewable.io/dashboard.html (read).
- Graphite's inbox starts with six sections: Needs your review, Approved, Returned to you, Merging and recently merged, Drafts, Waiting for review. A section is a saved filter. It can be added, edited, dragged, and shared as a link that swaps the user's name for the reader's. https://graphite.com/docs/use-pr-inbox.md (read; it does not say what sits in each section, how stacks look, or what a row shows, so I use only the section names and the saved-filter idea).
- GitHub notifications have default filters by reason (assigned, participating, review requested, mentioned) and up to 15 saved custom filters, each a name and a query. https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox (read).
- Linear's My issues groups its Assigned tab "in focus order": urgent, SLA, blockers, cycle, other active, triage, backlog, completed, with empty sections hidden. https://linear.app/docs/my-issues (read).

The pattern: the top level answers "what do I do about this", the first sections are the ones on the user, and "waiting on someone else" is a section of its own that is easy to ignore, not a mix.

### A row has a fixed set of facts, and the filters are queries

- GitHub's pull request list filters are `name:value` words: `review:required`, `review:approved`, `review:changes_requested`, `status:failure`, `is:draft`, `user-review-requested:@me`, with sort by newest, oldest or recently updated, and the filter and sort live in the address so a view can be shared. https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests (read). I did not read GitHub's list row itself.
- Linear separates what is shown from what is filtered. Display options set grouping, sub-grouping, ordering and which properties show on a row. "Set as default" saves them for everyone, and a user's own change stays theirs. Each group header counts its issues. https://linear.app/docs/display-options (read). Saved filters become a view, which can be starred into the sidebar. https://linear.app/docs/custom-views (read; it does not say whether display options are saved with the view).
- GitLab's merge request list narrows with attribute filters joined by AND, and Shift+M opens "your" merge requests. The page I read does not describe a row or tabs. https://docs.gitlab.com/user/project/merge_requests/ (read, limited).

The pattern: a short set of ready-made sections, one text query that anyone can read, and a separate control for which facts show.

### A stack is one chain that lands from the bottom

- GitHub's own stacked pull requests: stacks merge from the bottom, the merge box shows the state of the whole stack, any number can merge if they form a run starting at the lowest unmerged one, and a middle one cannot merge alone. If the stack is not linear a "Rebase stack" button appears. https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests (read).
- Graphite's Merge button changes with the place in the stack: on the first PR it merges one, in the middle it says "Merge N" and merges everything up to that PR, on the top it merges the stack. A merged PR leaves the stack. A conflict stops the merge job and the user fixes it and presses again. https://graphite.com/docs/merge-pull-requests.md (read). Its PR page has a Stack section listing the PRs stacked beside the one in view. https://graphite.com/docs/pr-page-overview.md (read; it says nothing about order or icons).
- Gerrit's Related changes lists ancestors below the current change and descendants above it, with marks "Not current", "Merged", "Submittable", "Abandoned". https://gerrit-review.googlesource.com/Documentation/user-review-ui.html (read).

The pattern: one object in the list, the whole stack's state in one place, and the action's label says how far it reaches.

### Triage by keyboard: the item leaves, the cursor lands on the next

- Linear's Inbox: `J` and `K` or the arrows move, `U` read or unread, `H` snooze, Backspace delete, `G` then `I` opens it. https://linear.app/docs/inbox (read). Triage has `1` accept, `2` decline, `3` duplicate, `H` snooze. https://linear.app/docs/triage (read; it does not say what the cursor does after an action).
- GitHub notifications: `E` done, `Shift+I` read, `Shift+U` unread, `Shift+M` unsubscribe. The PR and issue lists have `O` or Enter to open, and none for moving down the list. https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts (read).
- GitLab's to-do list: done and snooze per row, bulk edit with checkboxes, and many actions close the item by themselves (a comment, a merge). Snoozed items come back marked with the original date. https://docs.gitlab.com/ee/user/todos.html (read; no keys documented there).
- Gerrit: the change list has next and previous cursor actions with `j`, `k`, `o` per a commit message in its source, and `n`/`p` or `]`/`[` for pages. I could not confirm a documented key for "go up to the list" or "next change". https://gerrit.googlesource.com/gerrit/+/3278d7b611ee65f7efca36f96c49259d49d6463e (a search result, not read in full).

The pattern: acting on an item takes it out of the list, and the user never has to find their place again. Snooze exists everywhere, because a long list needs a way to say "not now" that does not lose the item.

### What matters most for this app

1. Group by whose turn it is (Phabricator, Gerrit, Reviewable, Graphite). The user already has a turn-shaped list hidden in the code: `needsFirst` (`finished-cards.ts:9-12`). The model only makes it the whole list.
2. A stack is one unit whose state is its next layer, and the button says how far it reaches (GitHub and Graphite). Spec 060 already stands a stack in one place (`stacks.ts:25-29`).
3. Acting removes the row and the keyboard lands on the next (Linear Inbox, GitHub notifications, GitLab to-do). Work already keeps the keyboard where a card left (`WorkScreen.tsx:174-183`). Change Review does not carry on to the next change.

What I did not find in any of them: a group by project at the top. Project is a filter, a column, or a repository setting (Reviewable's organization dropdown, Graphite's default repositories, Linear's project property). I take that as the reason to keep project at the second level and as a chip row, not at the top.

## 3. The model

### The top level: what the user does next

Five states. Project is the second level and the chip row. Reason: 30 changes in five projects are not five separate jobs. The user clears one kind of work at a time, and the cost to read a change is in switching, not in the project. But reading five changes of one project in a row is cheaper than hopping, so the project stays visible and orderable inside each state.

### The vocabulary: five states, each change in exactly one

These replace "Ready to merge", "Refresh then merge", "Needs you" and "Left for you". hobkin's landing way (merge, refresh then merge, rebase) stays on the button and in the open row. It is how the change lands, and the user does not need it to choose.

| State | In the user's words | Rule, first match wins in this order | Where the data comes from today |
| --- | --- | --- | --- |
| Waiting | Nothing for you now | You said yes and it is merging; or its AI review is queued or running; or hobkin is fixing a risk it found; or it is your own PR waiting on another reviewer | `work.merging` (`work.ts:382`); `ReviewListItem.mergeAsked` with `state: 'waiting'` (`status.ts:104-113`); assessment `queued` or `running` (`review-badge.ts:37-41`); `fix` on the review (`review-badge.ts:30-35`); `GitHubPull.review === 'waiting'` on your own PR |
| Answer | A run left you a note | Its group is `left` | `FinishedChange.left` (`work.ts:247`) |
| Stuck | It cannot land until something is fixed | Conflict; checks fail; changes requested on its PR; or you said merge and it did not merge | `FinishedChange.conflict` (`work.ts:238`); `GitHubPull.checks`, `review` (`github.ts`); `mergeAsked.state === 'failed'` |
| Check | You have to read it before it can land | Its review says Risky, or has no review at this commit, or the review failed, or it has no proof; or someone asked for your review on their PR | `deployOf(summary)` (`assessment.ts:44`); `FinishedChange.proof`; `GitHubLists.reviews` |
| Ready | Nothing in the way and the review says Safe | Its review is Safe at this head, no conflict, checks not failing, and hobkin can land it | `deployOf`; groups `merge` and `refresh` |

Notes on the rules.

- Waiting goes first so a change that is already moving does not show up as something to do. A Waiting change that waits too long needs a visible age, not a hiding place: see "Open calls".
- A user's own parking ("not now until Thursday") would be a sixth way into Waiting. It needs a stored time, so it is in the data table as optional.
- Answer outranks Stuck on purpose. The note often says why it is stuck.
- "Ready" keeps its everyday meaning. The AI Reviews tab's "Ready" (review finished) goes away, because the review becomes a fact on the row.

### Counts and filters at the top

Three lines, always in the same place:

1. The count the user acts on: "29 to go through, 5 waiting, 36 changes in all, oldest has waited 6 days". A stack counts once in the first number and each layer in the last. This replaces the four overlapping counts in the inventory.
2. The state chips with counts: Answer, Ready, Check, Stuck, Waiting. A chip jumps to its section; with Enter it filters to it.
3. The project chips with counts: All, then each project. This is the GitHub page's project row (`GitHubScreen.tsx:124-127`, `project-filter.ts`) made the one project filter. It keeps its place across visits, as `useRemembered('githubProject')` does today.

Beside them one text field, opened with `/`. A chip writes its query into the field, the way Reviewable and GitHub do: `state:check project:ledger-api from:github age:>3d`. So there is one filter, readable, and the chips are shortcuts. Nothing else is saved: the chips and the remembered project are the saved views. I would not add Linear's custom views at 30 changes.

Order inside a state: the most pressing first, then the one that has waited longest. This is what the AI Reviews tab calls "priority" (`ai-reviews.ts:172-176`) and what Reviewable does. There is no order switch. The AI Reviews tab's Order switch (`AiReviews.tsx:75-84`) goes away with the tab.

### The second level: project

Inside a state, a project with two or more rows gets a thin sub-heading: its name, its count, and its oldest wait. A project with a single row there is listed under the sub-headed ones, with its project in the first slot like every row. That keeps a sub-heading from being a frame around one row. Projects are ordered by their most pressing row. In Ready the sub-heading also carries the one thing members do not have: "Merge 3" for that project's rows. The call is `work.group` with the rows of that project (`actions.ts:256-257` already sends a list of rows, so a subset needs no new host command; I did not read the host side of `work.group`).

### A stack is one row

- One row, with the stack's name (`StackPlace.name`) or its bottom layer's title, and "4 layers" in the title. No separate heading above it, so there is no frame around a single member.
- Its state is the state of its lowest layer that has not landed. Layers above wait for it and are counted as Waiting inside the open row, each with "lands after 1".
- Its facts sum or take the worst: size is the total, review is Risky if any layer is, checks fail if any layer's fail, age is the oldest.
- The sentence says which layer lands next: "Layer 1 of 4 lands next. Layers 2 to 4 wait for it."
- The button says how far it reaches, as Graphite's does: "Merge layer 1". After it merges the row stays, now at layer 2, and moves to the state that layer is in.
- Space opens the row to its layers, one line each, with the layer's own state word. Enter opens Change Review at the next layer to land.
- In the walk (below), the layers of a stack come one after another, bottom first, then the next row.

### One row, the same slots every time

Slots, in order, each with a fixed width so nothing moves when a value changes:

1. Project
2. Priority
3. Title (a PR shows its number after it, a stack shows "N layers")
4. Size: "+212 -40"
5. Review: Safe, Risky, "Reviewing 40%", "Review failed", "Not reviewed"
6. Checks: "Checks pass", "Checks fail", "Checks running", "No checks". For a change with no PR, the proof: "Proved" or "No proof"
7. Age: how long it has waited, in days
8. The one action for its state: Answer, Merge (hobkin's own word for the landing stays as the tooltip), Review, Send back, or nothing when Waiting

A second line, one line, says why it is in its state, in the state's terms: the run's note, the conflict, the failed check, what the review found, what it waits for. The full text and everything else a card holds are in the open row: what it did, proof, scores, models, behind-by, issue, branch, every action. These move off the closed row: the issue link, the PR link, behind, models and scores. Behind and conflict decide the state, so they do not also need a fact. This is spec 061's open row, kept as it is.

### What happens to the three places

The three places are Finished changes on Work, the AI Reviews tab, and the pull request tab on GitHub.

- Work, Finished changes and AI Reviews become one list. The tab that is AI Reviews today becomes Changes, between Work and Numbers. The Work tab keeps At work, the Queue and Projects, and in place of Finished changes one line under the header: "3 need an answer, 9 are ready" with a button to Changes. The "waiting for you" tile opens Changes instead of Numbers.
- AI Reviews' contents each find a home. A review's progress, failure and "waiting its turn" are the Review slot and the second line. Rebuild, Stop, Make it a stack, Remove and Remove and delete branch are in the open row. The "Repositories" lines with tokens this week move to Numbers, where spec 053 already puts cost. The Order switch goes.
- GitHub keeps its connection line, Refresh and the Issues tab. Its Pull requests tab goes: PRs that ask for the user's review become Check, the user's own PRs become Ready, Stuck or Waiting by their checks and review, and `from:github` filters to them. Start AI review is an action in the open row of a PR that has none. PRs the AI reviewed that are merged or closed are history and leave the list. `/` search can still find them.
- The project page's "Waiting for you" block is the same list with the project already chosen, drawn by the same component. Home's needs cards show the Answer and Check counts and link to Changes.

### Going through many changes in a row

- In the list: Up and Down move between rows (already so). Enter opens the change in Change Review. Space opens the row. A key on the row runs its one action, for example `y`, with the same second step Close without merging has today. `1` to `5` go to a state. `/` filters. `[` and `]` change the project chip.
- Opening a change from the list starts a walk made of the rows in view, in order, Waiting left out unless the user filtered to it. Change Review shows, in a fixed place, "4 of 29 · Check · harbor-web".
- A verdict (approve and merge, send back, ask for changes) takes the change out and opens the next one. `]` and `[` go to the next and previous without a verdict, and the change stays where it was. Escape goes back to the list with the keyboard on the row it left, which the trail and `useKeptPlace` already do (`view-store.ts:376-383`, spec 053 "The trail").
- `openReviewFor` already replaces a review opened over a review without growing the trail (`view-store.ts:361-370`), so a walk can chain reviews without a long way back.
- A stack in the walk gives its layers bottom first, then goes on.
- The last row of the walk lands back on the list at the next row still open, or on "Nothing left for you" if there is none.
- A key to hold a change back (Linear `H`, GitLab's snooze) is the optional parking in the data table.

### A first screen

```
Changes                29 to go through, 5 waiting, 36 changes in all. Oldest has waited 6 days
Answer 3   Ready 9   Check 14   Stuck 3   Waiting 5                               / to filter
All 34   harbor-web 11   ledger-api 9   kite-mobile 6   pylon-cli 5   atlas-docs 3

ANSWER 3
> harbor-web   P1  Retry failed card payments       +212 -40   Safe          Checks pass   2d  Answer
    Its run asks: keep the 3-try limit, or make it a setting?
  kite-mobile  P2  Offline cart on cold start       +96 -12    Safe          No checks     1d  Answer
    It could not reproduce the crash on iOS 17 and says why.
  atlas-docs   P3  Rewrite the install page         +310 -280  Not reviewed  No checks     4d  Answer
    Two open questions about the Windows steps.

READY 9                                                                          Merge all 9
  harbor-web  3 · oldest 3d                                                      Merge 3
  harbor-web   P1  Cache the product list           +54 -9     Safe          Checks pass   3d  Merge
    Adds a 5 minute cache. 12 product specs cover it.
  harbor-web   P2  Trim the order summary query     +18 -6     Safe          Checks pass   1d  Merge
    One query less on the order page.
  ledger-api   P1  Invoice export, 4 layers         +910 -120  Safe          Checks pass   3d  Merge layer 1
    Layer 1 of 4 lands next. Layers 2 to 4 wait for it.
  pylon-cli    P3  Fix the --quiet flag             +9 -2      Safe          Checks pass   2d  Merge
    The flag now silences the progress line.

CHECK 14
  ledger-api  4 · oldest 6d
  ledger-api   P0  Rounding in tax totals           +67 -21    Risky         Checks pass   6d  Review
    The review found a rounding path no test covers.
  ledger-api   P1  Pull request 218, from @maria    +402 -88   Not reviewed  Checks pass   2d  Review
    Asked of you. No AI review yet.
  ...
STUCK 3
  pylon-cli    P1  Parse config in one pass         +140 -33   Safe          Checks fail   5d  Send back
    Conflicts with main in 2 files.
WAITING 5, folded. Enter opens it.
```

That is 34 lines. Widths are fixed, so `Not reviewed` and `Reviewing 40%` fit the same slot as `Safe`. The `>` is the keyboard.

## 4. What in today's data must change

Most of the model is a pure join of data the window already has. I list what is missing, by file.

| Need | Why | Today | Change and file |
| --- | --- | --- | --- |
| One state per change | Every row in exactly one of five states | No state. Groups and a separate review list. The reason sentence exists in the host (`work.ts:404-411`) | A pure function `stateOf(change, group, merging, reviewItem, pull)` and the join of work and review list by `slug:item` (as `review-order.ts:30-50` already joins them by `targetOfReviewId`). New `ui/src/features/work/change-state.ts`. Later, hobkin could send the state itself; then it replaces this function. That is outside this repository (`hobkin/src/cli/work/groups.mjs`) |
| A real age | The Age slot and "oldest has waited" | `FinishedChange.at` is when hobkin last wrote the item, so it can be later than the finish. The code already says the wait can read shorter (`shared/protocol/work.ts:259-263`; `work-tiles.ts:36-45`). It is missing from older hosts | A `finishedAt` on `FinishedChange`, filled in `host/src/work.ts` (`changeOf`, line 445), taken from the item's own record. Until then the Age slot says "at least 2d" or stays empty |
| PR facts on every change that has a PR | Checks and review state for the Checks slot and for Stuck | The row joins `change.pr` to `github.pulls` and `github.reviews`, which hold the 50 most recent per list (`ChangeRow.tsx:88`, `GITHUB_LIMIT`). An older PR shows no checks | A `pull` object on `FinishedChange` (`review`, `checks`, `draft`, `mergeable`) in `shared/protocol/work.ts`, filled by a read by address in `host/src/github-gh.ts` and joined in `host/src/work.ts` |
| Whether a PR conflicts | Stuck for PRs that are not hobkin branches | `GitHubPull` has review and checks, no mergeable state (`shared/protocol/github.ts`, query at `host/src/github-gh.ts:26-32`) | Add `mergeable` to the query and to `GitHubPull` |
| Which PRs are "asked of you" and who they wait on | Check for PRs from others, and Waiting for the user's own PRs with a reviewer named | `reviews` and `pulls` are two lists; a PR's review state is a word, with no reviewer (`shared/protocol/github.ts`, `ReviewState`) | Optional: `requestedReviewers` on `GitHubPull`. The list a PR came from is enough for the first version |
| The review's answer on every row, without a request per row | Sorting and the Review slot need it for 30 rows | `ChangeRow` asks the host per row (`ChangeRow.tsx:91`, `use-change-review.ts`). `review.list` already carries `assessment.summary` for ready reviews (`ai-reviews.ts:150,161`), but only for reviews that ran | No new field. Read the Review slot from `review.list` in the list, and keep the per-row hook for the open row. A change with no list item is "Not reviewed" |
| One source for "merging" and "asked to merge" | Waiting and Stuck read both | `work.merging` (`work.ts:382`) and `ReviewListItem.mergeAsked` (`status.ts:104`) say the same fact in two lists, drawn as "You said yes, merging" and as the AI Reviews group "Asked to merge, not merged" | Join both by `slug:item` in `change-state.ts`. The two drawings go |
| The walk | Next and previous change in Change Review | `openReview` holds one id (`ui/src/app/view-store.ts:361`) | A sequence (ids and a place) set by the list and read by Change Review. The verdict code in `ui/src/features/review/state/session.ts` advances it. I read `view-store.ts` and `entry.ts`, not the verdict flow in `session.ts`, so how a verdict closes the screen is inferred from `closeReview` |
| A bulk merge per project | "Merge 3" under a project sub-heading | `work.group` takes rows (`actions.ts:256-257`) and the group question lists them (`Finished.tsx:226-280`) | The window sends a subset. I did not read the host side. The plan text (`GroupPlan`) is built by hobkin for the whole group (`shared/protocol/work.ts:399-403`), so the question page for a subset may need `work.group` to return a plan for given rows. Unverified |
| A hold-back ("not now until Thursday"), optional | A long list needs a way to say not now (Linear, GitLab) | None | A `parkedUntil` on the change, stored by hobkin and sent in `FinishedChange`. Not needed for the first version |
| One count | The four counts disagree | `WorkScreen.tsx:467`, `384-386`, `work-tiles.ts:28`, `GitHubScreen.tsx:191` | One selector over the derived states, used by the header, the tile and the tab |

## 5. Open calls for the user

- Is Waiting a good place for a change whose AI review is queued? It keeps the desk short and honest, and it also hides a change if the review never starts. The row carries its age and the Waiting section shows the oldest, but the user may prefer such a change in Check with "Not reviewed".
- Does Ready deserve to come before Check? I put it second so the user clears nine in a minute and the count drops, and then the long reads start. A user who wants the risky ones while fresh will want Check first.
- Is the project sub-heading's two-row rule right? The alternative is a sub-heading for every project in every state.
- `]` and `[` for next and previous inside Change Review. `j` and `k` are Linear's and Gerrit's, but I did not check what those keys do inside Change Review today.

## 6. What I could not verify

- I did not run the app, start a host or open a browser, so every statement about what the screen shows comes from the code, not from seeing it.
- I did not read `host/src/work.ts` beyond a few lines, `hobkin/src/cli/work/groups.mjs`, `YoloScreen.tsx`, the verdict flow in `ui/src/features/review/state/session.ts`, or the host side of `work.group`.
- Graphite's pages I read do not describe its inbox rows, how a stack looks in the inbox, or how it tells waiting on me from waiting on others. I use only its section names, saved sections and the Merge button. Gerrit's list keys and GitLab's row facts could not be confirmed from a documentation page. GitHub's own pull request list row was not read.
- The claim that one change can sit in all three places rests on `ChangeRow.tsx:88`, `status.ts:208-209` and `GitHubScreen.tsx:121`, and was not shown with real data.
