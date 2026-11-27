# UX review of Change Review: one change in a few minutes, thirty in a row

Written 2026-11-24. Read-only review. Line numbers are from the files as they stood when this was read. Another session was changing the panel while this was written (`Questions.tsx`, `HobkinScores.tsx` and `scores.ts` were staged for deletion, `WhatMatters.tsx` and `needs.ts` were modified), so check a line before acting on it. Marks used below: (code) read in the source, (picture) seen in a still render, (inferred) not seen, reasoned from code or from the other tools.

## The answer in short

Today the screen has no order. It has about 28 blocks, and the same fact (what needs me, how risky, what it does) is told in four to six of them. The panel alone is about 1,540 px tall for a 7-file pull request (picture, measured and scaled), so on a 900 px window the verdict starts a screen and a half down. Nothing says how long the change will take.

The fix is not smaller blocks. It is three structures:

1. One Brief at the top of the panel that holds every fact the reader needs for a first call, each marked as measured by the host or judged by the review.
2. One Walk, the ordered list of the parts that need the reader, with seen marks, a progress count and a reading time. It replaces "Needs a look", the outline's Attention list, most of the story's role, and the Evidence line "Needs you".
3. A verdict pinned at the foot of the panel, and a next change that opens after it.

The graph, the outline's zone list and the code stay, one press away.

## 1. Inventory

Heights are CSS pixels. Panel heights come from the renders (picture), scaled from the thumbnail (about 1.37) and good to about 10 percent. Canvas heights are (inferred).

| Block | Question it answers | Always shown | Height | Overlaps with |
|---|---|---|---|---|
| Top line: project and PR link, hide, close (`Header.tsx:68`) | Which change is this | yes | 25 | none |
| Title (`Header.tsx:86`) | What is it called | yes | 45 | step 1 card, "What this change does" |
| By-line (`Header.tsx:87`) | Who wrote it | PR only, space kept | 20 | none |
| Risk badge, why, since, fix, Critical, Action Item (`Header.tsx:165`) | Is it risky to deploy | yes | 90 | Evidence "AI review" line, "Needs a look", per-part levels |
| Size row: files, +/-, commit range, Description, Make it a stack (`Header.tsx:90`) | How big is it | yes | 60 | Evidence has no size; story step 1 repeats files and lines (`StepCard.tsx:46`) |
| Carried line (`Header.tsx:116`, `:311`, `min-h-10`) | Was this built at this commit | space always kept, usually empty | 40 | Outdated notice |
| Outdated notice with Rebuild (`Header.tsx:128`) | Is the review current | only when true | 50 | Carried line |
| Your questions: five ratings, floors, missing, by whom (`Questions.tsx`) | Is it tested, risky, visible, undoable | yes | 500 rated, 75 not rated | Evidence "Tests" and "AI review", risk why, "Needs a look" |
| hobkin's own scored run (`HobkinScores.tsx`) | Does hobkin's own score agree | finished changes with scoring | 30 folded, 300 open | Your questions |
| What this change does (`WhatMatters.tsx:51`) | What does it do | when a sentence exists | 115 | title, step 1 card, risk why |
| TLA+ model checks (`ModelChecks.tsx`) | Do the models hold | when models exist | 48 per model | Evidence "Models and proofs", key T |
| Needs a look, up to 4 rows then "Show N more" (`WhatMatters.tsx:62`) | What do I have to read | when units are not safe | 32 per row | story steps, outline "Needs you", Evidence "Needs you", risk why |
| Open questions (`WhatMatters.tsx:102`) | What is still unsettled | when any | 32 | closing step, per-part questions in a card's Read more |
| Comments and questions: two buttons, notes list up to 320 (`StepsPanel.tsx:168`) | What did I say | yes | 100 up to 420 | the input under the canvas, keys N and D |
| Evidence: tests, AI review, models, needs you (`Evidence.tsx`) | What does the verdict rest on | yes | 165 | risk, ratings, models, Needs a look |
| Verdict: 2 to 5 buttons, a box up to 132 (`Actions.tsx:183`, `:245`) | What is my call | yes | 170 to 330 | none |
| Footer: notes on this review, ⌘? (`StepsPanel.tsx:193`) | Where are the keys | yes | 70 | Shortcuts sheet |
| Graph with zone regions and node cards (`Graph.tsx`, `ZoneRegion.tsx`) | How do the parts connect, where is each run from | yes | fills canvas | outline, step card, finder |
| Step card beside its node: level, title, From trail, one paragraph, tests, Read more (`StepBody.tsx`) | What is this part, is it tested | yes | 250 to 400 | panel "Needs a look", code panel Explanation |
| Dock: Free Roam or Story switch, G, pager with dots, put nodes back, input (`Chrome.tsx:124`) | Where am I in the walk, how do I say something | yes | 148 reserved | Outline views, J K, finder |
| Outline, key L, 272 px wide, floats over the canvas (`Outline.tsx:36`) | What are all the parts | closed at first | full height | panel "Needs a look", finder, zone keys |
| Finder, key / (`Finder.tsx`) | Where is this node | on key | small | outline filter |
| Code panel, key Enter: Explanation and diff (`CodePanel.tsx`) | What is the code, what does the review say of it | on key | 30 percent of window by default (`ReviewScreen.tsx:279`) | step card Read more |
| Proof beside the review, key T (`ProofBeside.tsx`) | What did TLC say | on key | half the canvas | ModelChecks, Evidence |
| Notice toast under the menu (`Chrome.tsx:36`) | Did the key work | 2.6 s | 36 | none |
| Shortcuts sheet, ⌘? (`Shortcuts.tsx`) | Which keys exist | on key | full | 46 keys in 7 groups |
| Celebration, then the review closes (`verdict.ts:271`) | Did it land | after verdict | short | none |

What the pictures showed that the code does not say:

- On a 900 px window the first screen ends inside "What this change does". Header, risk and ratings fill it. The verdict is at about 1,330 px (picture: `ux-b/2-pull-panel-full-mid.html.png`).
- The header leaves a blank band of about 55 px under the size row, the reserved Carried line (picture: `ux-b/1-pull-panel-900-dark.html.png`). This is the user's own "empty state stays small" rule.
- Two numbers for one thing. On the 200-file sample the header says "4 parts can break" and "AI review: 4 parts need you", while Evidence says "Needs you 0 of 7 seen" and the outline lists 7 under Needs you (picture: `ux-b/3-large-panel-full-dark.html.png`, `ux-b/4-large-outline-dark.html.png`). The first counts units (`evidence.ts:77`), the second counts nodes (`evidence.ts:119`). The reader cannot tell which is true.
- A rated review (sample PR) puts five rows of two-line evidence before the sentence on what the change does. A review with no rating puts two lines of apology there instead. Both sit above the point of the screen.
- Evidence is a list of four lines whose meaning is already said above it. It sits between the comments and the verdict, which is the right place for a fact but the wrong place for a second telling.

Things I could not render (graph, step card, dock, code panel, proof, finder): they need the canvas camera and a live window. They are reviewed from code only. I looked at the dark theme only. The pictures stayed in the review session's scratch folder and are not in the repository.

Where the same question is answered more than once (code):

| Question | Answered in |
|---|---|
| What needs me | header "N parts can break" (`sidebar.ts`), Needs a look, Evidence "AI review", Evidence "Needs you", outline Needs you, story steps, graph attention marks |
| How risky | header badge, ratings "deploy and data", Evidence "AI review", per-part levels in cards, hobkin's own run |
| What does it do | title, risk why, "What this change does", step 1 card (`StepCard.tsx:46`), story text |
| Where am I in the review | pager "Step 3 of 22", outline "0 of 7 seen", Evidence "0 of 3 seen", the graph zoom |
| How do I move | arrows and Space (steps), Up and Down (nodes), J and K (zones), U (unseen), L (outline), / (finder), G, O, P, digits, comma and period (history), W (wires) |
| What did I say | the notes list, the input under the canvas, the verdict's comment count |

## 2. How the best tools do it

Only public pages, read on 2026-11-24. Where a page does not say something I say so.

| Tool | Above the fold | Before any code | Progress | Verdict | Next change |
|---|---|---|---|---|---|
| GitHub pull request | Conversation tab: description, timeline, reviews. Merge box states blockers and missing approvals. Tabs for Commits, Checks, Files changed (`docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests`) | Description, checks and the merge box, on a different tab from the diff | "The progress bar in the pull request header shows how many files you've viewed." A viewed file collapses and is unmarked when it changes (`docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request`) | A summary comment and one of three outcomes: Comment, Approve, Request changes | Not on the page |
| Graphite | Stack list, description with a Generate button, review status and checks at the top right (`graphite.com/docs/pr-page-overview`) | Description and status | The docs do not describe viewed marks | Approve at the foot of the diff, or keys R then A, R then Y for approval with no comment, R then N for changes (`graphite.com/docs/pr-page-overview`) | Inbox section "Needs your review". Key S shows the stack, and the docs say to start at the bottom, review, and move to the next PR in the stack (`graphite.com/docs/review-pull-requests`) |
| Gerrit | Status, action buttons, reviewer chips with votes, Related Changes chain of ancestors and descendants, Submit Requirements (`gerrit-review.googlesource.com/Documentation/user-review-ui.html`) | Commit message and the relation chain come first in the file list | Reviewed checkbox per file, and an option to mark files reviewed as they are opened | Votes per label, in a Reply dialog; one quick approve button in the header when only one label can be approved | The attention set: an arrow before the name of whoever must act, and a "Your turn" dashboard section with a waiting time. A reply moves the turn to the other side (`gerrit-review.googlesource.com/Documentation/user-attention-set.html`) |
| GitLab merge request | Overview tab with description and comments, Changes tab for the diff (`docs.gitlab.com/user/project/merge_requests/reviews/`) | Overview | The page does not describe viewed files | Comments stay pending until Submit review, with Approve, Comment or Request changes and an optional summary | Review requested list on the homepage; Shift+m. No next control on this page |
| Reviewable | File matrix: every file against every revision, with a state chip and counts (`docs.reviewable.io/files`) | The matrix | Per file, per revision, per reviewer marks; filtered counts like "2/4 files"; chips for files already enough reviewed are hidden until hover; marks are drafts until published | Publish; open files or discussions defer the review automatically (`docs.reviewable.io/reviews`) | Not covered here |
| CodeRabbit Explain (Change Stack) | Overview: summary, merge readiness, "Needs your attention" (`docs.coderabbit.ai/pr-reviews/change-stack.md`) | Overview, then numbered layers in the order someone would explain the change, each with a summary | Not described; findings are tracked across pushes | Not part of the page | Not described |
| CodeRabbit walkthrough | A comment at the top of the thread: a high-level summary, then a table of files with one line each, diagrams when components interact (`docs.coderabbit.ai/pr-reviews/walkthroughs`) | The whole comment | none | none | none |

Three patterns matter most here.

1. Reviewable's marks and counts. A mark is the reader's own statement about a file at a revision, it is a draft until publish, and the counts always read "2/4". This app already has seen marks (`session.ts:400`, `:403`: a part is marked seen when its step is told or its code is opened). It never shows a total next to them in one place, and it never says how long is left.
2. Graphite's keyboard path. One key shows the stack, one pair approves, and a quick approve exists for the common case. The user's A and M with a second press is the same idea. The missing part is what Graphite and Gerrit both have: the move to the next thing as part of finishing this one.
3. CodeRabbit's Overview first, then layers in explanation order. The reader meets "merge readiness" and "needs your attention" before any layer. It also admits the limit: the grouping is model made and a later run may regroup it. This app's story steps are that idea, but they sit under a panel that already told everything.

Gerrit's attention set is the model for the thirty-in-a-row case: the queue is "changes where it is my turn", and a change leaves the queue by an action, not by being closed. That fits the AI Reviews list, which already has a priority sort (`AiReviews.tsx:74`).

## 3. Proposal

### The order of reading

First, with no press, in the panel:
1. The Brief (below): the call, what it does, what was measured, the weakest rating, how much needs me, whether the review is current.
2. The verdict, pinned at the panel's foot, so the call is always in view.

One press away:
3. U, or Enter on the Brief's "Needs you" line: the Walk, starting at the first unseen part that needs me. Its card says what the part is, why it can break, who runs it, and which tests cover it. Right arrow or Space moves on, Z marks it, Enter opens its code.
4. Read all on the ratings, and Description for a pull request.

Two presses away:
5. The code (Enter), the proof (T), the graph (G), the zone list (L, as a second view of the Walk), the finder (/), the whole shortcut sheet.
6. The safe parts, as the last item of the Walk: "Skim the other 246", opening a folded list.

Not on this screen: a second telling of risk or of what needs me; the Free Roam and Story switch; the commit range as a permanent line; "notes on this review" as a footer; the blank Carried band; hobkin's own scored run while it agrees with the review; the five ratings' two-line evidence for ratings that are 7 or more.

### What merges, collapses, goes

| Today | Becomes |
|---|---|
| Risk badge and why, What this change does, Evidence, the lead of Your questions, size row | The Brief |
| Needs a look, Open questions, outline Attention list, the story's walking order, Evidence "Needs you", pager | The Walk, with one progress count |
| Your questions (five rows), hobkin's run | One line, "Weakest: proof 4/10, ...", and Read all |
| Carried line, Outdated notice | One freshness line in the Brief, always one line tall |
| Comments and questions block | Notes appear on their part in the Walk; the count sits on the verdict buttons that send them (already there: "Send fixes 0") |
| Floating Outline | Gone. Its Zones view is a toggle of the Walk list |
| Free Roam or Story switch | Gone. The Walk is the story; the graph is G |
| Evidence as a block | Gone; its four facts are in the Brief |
| TLA+ rows | One line "2 models hold" in the Brief; rows open under it only when one does not hold |

### The summary the reader can trust in ten seconds

About 90 words, seven lines at the panel's 372 px, fixed height, in this order. Facts the host measured are marked "measured"; claims the review wrote are marked "judged". The review already caps its ratings by facts (spec 058), so the split is honest: a number the facts capped says so.

1. Title.
2. The call: "Risky to deploy" or "Safe to deploy", then one sentence of why (judged, 20 words at most).
3. What it does, two sentences at most (judged; `sidebar.ts:81` already limits it to three).
4. Measured: tests (17 pass, 1 fails, 2 did not run), size (7 files, +189 -10), reading time.
5. Weakest rating: the lowest of the five, its number and its evidence line, and "Read all".
6. Needs you: "0 of 3 seen. U goes to the first."
7. Freshness: "Reviewed at 78e2a9f, current", or "Outdated, built for b4c1d0e. Rebuild", or "Carried from 78e2a9f". Always one line, so nothing moves.

The reading time is free: the engine writes `reading_minutes` for the whole change and for each unit (`packages/change-review/src/types.ts:805`, `:816`) and the story text uses it (`story.ts:134`), but the window never shows it (no use in `ui/src` outside the sample).

### Progress through a big change, and resuming

- One count, in the Brief and the Walk: "3 of 7 seen, about 12 min left". The unit is the part that needs me, the same unit the header uses today. The minutes are the sum of `reading_minutes` for the unseen parts.
- Seen is already automatic (the step told, the code opened) and has Z for the exception. That stays. What changes is that the bar replaces the 22 pager dots as the progress, and the pager steps become the Walk's items.
- Resuming: seen marks live in the review memory keyed by commit (`memory.ts`); the place the reader was is kept when leaving for another page and dropped when the review is closed (`ReviewScreen.tsx:204`). Keep that. On open, the Brief says "Resume: 3 of 7 seen" and U already goes to the next unseen part, so a closed review costs one key, not a search. (Read from code, not tried in the live window.)
- A yes with unseen parts still says how many on its first press (`Actions.tsx:116`, `evidence.ts:138`) and never blocks. Keep it. It is the right behavior.

### The verdict and the next change, from the keyboard

Today A, M and X show what they will do and a second press does it (`keys.ts:118`, `Actions.tsx:155`). After a landing the review closes with a short celebration and the reader is back on the list (`verdict.ts:271`). No key opens another change (searched the review feature, none).

For thirty in a row:
- Keep two presses for every verdict. Keep the unseen warning.
- After a verdict lands, open the next change in the AI Reviews order, not the list. The celebration stays at five seconds or less and does not block the next review's Brief.
- `>` opens the next change without a verdict, `<` the previous. They pair with `.` and `,`, which already go forward and back through where the reader jumped. A skipped change stays in the queue and shows "Skipped" in the Brief's freshness line.
- The header shows "4 of 30" for the position, in the line that today holds the project name. It moves nothing, because the line is always there.
- Esc still goes up one level and, at the top, back to the list.
- Rule from Gerrit's attention set: a change leaves the queue because of an action (a verdict), not because it was opened.

The full keyboard path for one routine change: open, read the Brief (ten seconds), U, Right, Right, then A and A. The next change opens at its Brief.

### First screen sketch

Window 1300 by 900, panel 372 wide on the left, the part card and its code to the right. The graph is not drawn until G.

```
+------------------------------------+-------------------------------------------------+
| storefront #482            4 of 30 « x | Walk: 1 of 3   link_user_tags            [Can break] |
| Link user tags with dots and dashes,   |                                                 |
| and add a production errors script     | link_user_tags now links handles with dots.     |
| by mira                                | Every post page and the feed render through it. |
| [RISKY TO DEPLOY]                      |                                                 |
| 1 part can break: link_user_tags       | Run from   PostsController#show > render_body   |
| changes how every post links handles.  | Tests      5 call it, 3 fail with the change    |
| Does: links @handles with dots and     |            undone. None renders a post with tags|
| dashes with one lookup per post, and   |                                                 |
| adds a script of production errors.    | ---- code (Enter) ----------------------------- |
| Measured  17 pass, 1 fails, 2 did not  | 41  - def link_user_tags(text)                  |
|   run . 7 files +189 -10 . about 8 min | 41  + def link_user_tags(text, users: nil)      |
| Weakest   proof 4/10: no request test  | 42  +   handles = text.scan(HANDLE)             |
|   renders a post with tags.  Read all  | ...                                             |
| Needs you 0 of 3 seen   U first        |                                                 |
| Reviewed at 78e2a9f, current           | Z mark seen   Right next   G map   L zones      |
|                                        |                                                 |
| Walk                                   |                                                 |
|  > link_user_tags        Can break     |                                                 |
|    fetch_errors          Not shown     |                                                 |
|    report_errors         Not shown     |                                                 |
|    Skim the other 4 safe parts         |                                                 |
|    1 open question   2 notes           |                                                 |
|                                        |                                                 |
| [ Approve  A ]                         |                                                 |
| [ Comment 0 ]   by mira: theirs to merge|                                                |
+------------------------------------+-------------------------------------------------+
```

The Brief and the Walk fit in 900 px. The verdict is pinned and never scrolls away. Nothing floats over anything else: the outline is gone, the toast stays under the menu.

## 4. The ten changes that matter most

| # | Change | File | Size | Removes or adds |
|---|---|---|---|---|
| 1 | Add the Brief: the seven fixed lines above, measured and judged marked | new `panel/Brief.tsx`; edit `StepsPanel.tsx`, `Header.tsx`, `WhatMatters.tsx` | large | Removes the risk block, Evidence, "What this change does" and the size row as separate blocks; adds one block |
| 2 | Pin the verdict at the panel's foot, outside the scroll | `StepsPanel.tsx:186` | small | Removes the 1.5 screen scroll to the call; adds a fixed footer |
| 3 | Show one count of what needs me, in units, everywhere | `evidence.ts:119`, `Outline.tsx`, `sidebar.ts` | small | Removes the 4 versus 7 mismatch |
| 4 | Add the Walk: ordered needs-you list with seen marks, "3 of 7 seen" and minutes left, plus a safe-parts fold | new `panel/Walk.tsx`; edit `WhatMatters.tsx`, `outline/outline.ts`, `state/session.ts` | large | Removes "Needs a look", Open questions as a row, Evidence "Needs you"; adds the progress count |
| 5 | Show `reading_minutes` | `assessment.units` read in `panel/sidebar.ts`, used by Brief and Walk | small | Adds a time the engine already writes |
| 6 | Reduce the ratings to the weakest one plus Read all, and fold hobkin's run into Read all | `panel/Questions.tsx`, `HobkinScores.tsx`, `needs.ts` (being changed by another session) | medium | Removes about 450 px from the first screen |
| 7 | One freshness line, always one line | `Header.tsx:116`, `:128`, `:311` | small | Removes the 40 px blank Carried band and the Outdated box that pushes content |
| 8 | Next and previous change, and open the next after a verdict | `app/view-store.ts` (`openReviewFor`), `verdict.ts` (`afterVerdict`), `keys.ts`, `work/AiReviews.tsx` (queue order) | medium | Removes the trip to the list thirty times; adds `>`, `<` and "4 of 30" |
| 9 | Remove the floating Outline; its Zones view becomes a toggle of the Walk | `outline/Outline.tsx`, `ReviewScreen.tsx:425`, `:442`, `keys.ts` (L) | medium | Removes a panel that floats over the canvas |
| 10 | Make the graph the second view: open on Brief, Walk and part card; G brings the graph; drop the Free Roam or Story switch | `ReviewScreen.tsx`, `Chrome.tsx`, `story/mode.ts`, `keys.ts` (O, P) | large | Removes the three-way navigation overlap; the most debatable change, so test it on a 200-file review before the rest depend on it |

Order to build them: 2, 3, 7 (small, each helps alone), then 5, 1, 6, then 4, 8, then 9 and 10.

## 5. What I could not check

- The graph, the step card, the dock, the code panel and the proof were not rendered. Their heights and their overlap are from code.
- No live window and no host: whether seen marks survive a close, and how the queue behaves on a real list, are read from code only.
- Dark theme only was looked at. Light renders were produced but not inspected.
- The panel was drawn from a sample pull request and the 200-file sample. A real review with long evidence lines may be taller than the 1,540 px measured.
- Several tool pages do not say how they show progress or the next change; the table says "not described" rather than guessing. GitHub's Files changed page itself was not read, only its documentation.
