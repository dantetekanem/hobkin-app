---
{
  "id": "063-yolo-settings-and-grades",
  "title": "YOLO mode's rules are settings, and every change always has its grades",
  "kind": "work",
  "status": "draft",
  "depends": ["049-yolo-mode", "053-work-control-room", "058-review-turns-and-ratings"],
  "updated": "2026-11-24"
}
---
# YOLO mode's rules are settings, and every change always has its grades

## Outcome

Every rule that decides whether YOLO mode merges a change is a setting the user moves on the YOLO page, kept with the user's other settings and saved as it is made. Nothing is a constant in code and nothing is a gate the user cannot reach. Every finished change and every pull request the app lists always has its five scores and its general rate, for the commit it is at, and YOLO mode reads the same numbers the user sees. A change never reads "no rate yet": it is rated, being rated, waiting its turn with a count, or not rated after a stated number of tries, and it says which. Until the user moves a setting, nothing merges that would not merge today.

The user, 2026-11-24, looking at a project where nine changes waited and none could merge: "i also dont understand this. what is this ask? what is getting ready? why a list of non sense information? do you know what YOLO means? this UI is terribly awful". On grades: "i want the grades ALWAYS. so i can decide. i see many times they going optional, this is never the deal. i need to control all this by settings in the yolo mode." Earlier, 2026-11-20: "eligibility on YOLO is too high", "this is useless, it should prepare the environment, open all the necessary PRs, never to keep saying 'not ready yet'". And 2026-11-23: "YOLO is not designed to work that way", "if on is on, by my rating rules", "i also dont see the damn ratings in a PR for yolo mode", "each AI review should present my needs".

## Decisions

- The audit is in `notes.md` beside this spec, by file and line. It found more than thirty rules that can stop a merge. The user can move three of them (the main switch, a project's switch, the lowest rate from 6 to 10). One is a constant in hobkin's code that is false (`PULL_REQUESTS_MERGE`, `hobkin/src/cli/work/yolo-pulls.mjs:23`). It also found why a project can stay stuck: a model that breaks on the default branch holds every change on the project before any change is read, and a project that is not ready gets no scores, so the fix for the model has none (`notes.md` section 3).
- The default of every setting is today's behavior. Turning nothing leaves every case as it is. A switch that lets something merge by itself ships off. The user's click in the window is the only thing that changes a setting: no `hobkin work` command, agent tool or run writes one, as with `setYolo` today (`host/src/work.ts:721-727`).
- Limits kept are only those that protect the machine or the repository, and each is named with its reason in the list. A number the user may lift says "none" for no limit. The old limit on the lowest rate (6 to 10) was a number the lead picked, not a protection, and is lifted to 1 to 10.

### Grades, always

- One source. Every grade YOLO mode reads is the AI review's: the five ratings Change Review makes (`packages/change-review/src/needs.ts`, spec 058), which the user already reads in the panel and the row. The scores of hobkin's own scored run (`item.review` as it is written today) are no longer read by YOLO mode.
- hobkin's own scored run stops starting by itself: `reviewOnFinish` as a way to start it, `askReviews` in `closing.mjs` and `earnsAReview` in `director.mjs` end. The run stays for a card's own Review button until the user decides to retire it. Its past scores stay on the card, named as hobkin's, and YOLO mode ignores them. What it cost, a whole agent run counted in hobkin's tokens (`notes.md` section 2), is no longer spent for a score nobody reads.
- The rule the user can rely on: a finished change and a pull request are each rated at their commit. Its five scores and its general rate come from one review of that commit. Nothing is optional and no switch turns grades off. The review that starts by itself for every finished change is Change Review's, in the repository's line (3 current for a repository and 20 background reviews a day today). A change whose run left a note is rated too, and so is a hobkin pull request. A change that only edits Markdown has nothing to rate and says so.
- Mandatory. An answer that does not carry all five scores and a kind is not accepted. It is asked again, in a narrow call that holds the review's findings and names the missing scores, up to the tries the user sets (3). After the last try the change says "Not rated after 3 tries: <what the answer lacked>" with a button to rate it again. Visibility with no monitoring known is no longer dropped: it is set by rule to 3, with the evidence "no monitoring is known for this project, so a regression would not show", marked as set by rule, so the general rate always exists. The rule sits under the visibility floor (7), so such a change asks the user until monitoring exists, which is the right answer and the user's to change with the floor.
- What the user sees meanwhile: "Rated at 4f2a9c1: 8.4", "Rating now", "Waits its turn: 3 ahead", "Rating again, try 2 of 3", or "Not rated after 3 tries". Never a blank, a dash or "no rate yet". A rating made at another commit than the change is at is shown with that commit's name and marked older, and YOLO mode does not use it. The new review comes in its turn.
- How the grades reach the runtime: after a change's review finishes, the host calls one new runtime function, `recordGrades(root, slug, id, grades)` in a new file `hobkin/src/cli/work/review-grades.mjs`, as it calls `setYolo`. It checks the grades with `assertReview` (all five scores with a line of evidence, a kind, a full commit), requires the item to exist and be finished work, and writes them to the item as `review` with `by: 'change-review'` and the time. It refuses a head that is not the item's current head unless the item has none. `scoresOf`, the floors and the rate are unchanged, so the rate is the one the window works out from the same five numbers.
- What stops an agent's run writing grades: `recordGrades` is not a `hobkin work` command and no tool names it. The `item` command no longer takes `review` from any run (`commands.mjs:429-440`), so the scored run's way in is closed. YOLO mode reads a review only when it says `by: 'change-review'`, so a record written any other way is not read.
- Cost. Each review is one Reviewer call (prompt up to 100,000 characters, about 25,000 tokens, at high thinking) and one fast checker, as spec 058 counts it. With the defaults, at most 20 background reviews a day, about 500,000 prompt tokens a day before thinking and output, which is the worst case, not a measure. A re-ask is a narrow call and costs a fraction of a review (not measured). The user caps all of it with three settings: reviews kept current for a repository, background reviews a day, tries. Each may be lifted to "none". What is saved: hobkin's scored run, which cost up to two reviews' worth of agent time per change, is no longer started.

### The settings

- They are one block on the YOLO page, "What YOLO mode may do", of the rows below. The user sets each for all projects, and may set any row of the first two groups for one project, which then differs from the rest and says so. A row's default is today's behavior, in the Default column.
- Where they are kept: in work mode's own file (`work/mode.json`), under `yolo.rules` for all projects and `yoloProjectRules.<slug>` for one project's differences. The main switch and `yolo.rate` stay where they are, so nothing a home holds moves. `setYolo(root, { on, rate, rules })` takes the new `rules`, and a new `setYoloRules(root, slug | null, change)` takes one project's. Every value is checked before any is written, as `setWorkload` does (`hobkin/src/cli/work/store.mjs:454-461`), and an unknown name or a value out of range is refused with a plain sentence. `yoloStatus` reports, for the page, each project's rules in force, which of them it overrides, and for each waiting change the name of the setting that holds it.
- The host takes them through one new command, `work.yolo.rules`, marked `outside: true` like `work.yolo.project` (`shared/commands/registry.ts:1132`), so only the user's click changes them.

Group 1, "The project":

| Setting, in plain words | Kind | Default | Limits | Scope |
| --- | --- | --- | --- | --- |
| Merge only while tests pass on the default branch | switch | on | none | each project |
| Merge only while a way back is known | switch | on | none | each project |
| Merge only while no model breaks on the default branch | switch | on | none | each project |
| A change that makes a broken model hold may merge while it breaks | switch | off | none | each project |
| Hold a project after a regression its deploy showed | switch | on | none | each project |
| Merge hobkin's own pull requests | switch | off | none | each project |
| Merge a pull request when GitHub's required checks cannot be listed | switch | off | none | each project |

Group 2, "The change":

| Setting, in plain words | Kind | Default | Limits | Scope |
| --- | --- | --- | --- | --- |
| Lowest general rate | number, one decimal | 8 | 1 to 10 | each project |
| Lowest score for each question: coverage, proof, safety, visibility, rollback | five numbers | 5, 5, 8, 7, 7 | 1 to 10 each | each project |
| Kinds that may merge | set of choices | performance, bug fix, state machine, package update, small change; feature and unclear off | at least one | each project |
| Largest change, in changed lines | number | 300 | 1 or more, or none | each project |
| Most areas a change may touch | number | 2 | 1 or more, or none | each project |
| A change that deletes tests may merge | switch | off | none | each project |
| A change whose way back is one-way may merge | switch | off | none | each project |
| A change that brings earlier branches may merge | switch | off | none | each project |
| A change whose run left a note for me may merge | switch | off | none | each project |
| Paths that always ask me | list of words | the words today's rule has: migrat, schema, auth, session, token, secret, credential, password, payment, billing, deploy, kamal, dockerfile, docker-compose, fly.toml, procfile, vercel.json, netlify.toml, render.yml, .github/, .gitlab-ci, .circleci, jenkinsfile, ci/ | each word plain text up to 80 characters, at most 100 words, so a pattern can never stall the machine | each project |
| Most merges a project in one pass | number | 1 | 1 to 5, because each merge after the first rests on a survey that is older than it | each project |

Group 3, "Ratings":

| Setting, in plain words | Kind | Default | Limits | Scope |
| --- | --- | --- | --- | --- |
| Rate other pull requests: mine, waiting for me, both, none | choice (the workload's `reviewPulls`) | both for the first release of this spec, which is the user's call (see Open questions) | none | all projects |
| Reviews kept current for a repository | number | 3 | 1 or more, or none | all projects |
| Background reviews a day | number | 20 | 1 or more, or none | all projects |
| Tries to get all five ratings | number | 3 | 1 to 10, because each is a model call | all projects |

- Rules that are not settings, each with its reason: the project is paused, work mode is off or paused (both are Work's, one click away on its page, and the YOLO page links to them); a conflict or a change git cannot merge (it would fail); a change whose files the survey could not list (the survey cannot read what it did not list); the scores are for this exact commit or one whose code the change still has (a rating for code that is gone is not a rating); a layer of a stack lands after the layer under it (order, not a choice); the readiness work's own branches never merge by themselves (YOLO mode must not change its own protections); a pull request must be the one hobkin opened, from the signed-in user, on its own branch, into the default branch, at the commit that was rated, open, not a draft, mergeable, with nothing GitHub blocks it for (it is what a merge there needs, and the page lists each one met or not).
- The pull request switch. With "Merge hobkin's own pull requests" on, the page lists what GitHub must have for it to be safe and says, for each project, which is met and which is not: the default branch requires status checks to pass, no merge queue is on, no approval is required, and checks exist at the commit. hobkin reads them with the user's own gh as it does now (`yolo-pulls.mjs:121-183`), writes nothing to GitHub, and an unmet one keeps the change asking and names itself. The constant `PULL_REQUESTS_MERGE` is removed, and the switch is the one thing it was.
- A broken model. With the switch off a model that breaks on the default branch holds the project, as today. With it on, that model holds a change only if the change does not make it hold: every spec that breaks on the default branch must be among the models covering the change and hold at its head (`changeModels`). A change that touches nothing the broken model names still asks, saying which model. After such a merge hobkin checks the broken specs again at once and does not wait the week (`proof-checks.mjs:133`). With the switch off, "Merge only while no model breaks" can still be turned off by itself, which lifts the hold for every change.
- A project that is not ready no longer stops grades. Reviews are made for every finished change whatever readiness says.
- What "getting ready" becomes. Readiness work stays and keeps opening PRs, but it stops being a state. A project's card says its verdict in one line from the rules in force ("Merges small changes rated 8 or more", "Holding 9: a model breaks, tests not recorded") and under it the settings that hold changes, each once with its count and a press that opens that setting in the popup. The parts that are only improvements (monitoring, deploy path) are one quiet line, "Being set up: alerts, logs".
- The settings popup. Changed 2026-11-24, in the user's words: "yolo settings is a new pop window not that shit". The YOLO page has no inline block. Its head has one button, "Settings", and under the switch one sentence of the rules in force ("Merges small changes rated 8 or more that touch two areas or fewer, up to 300 lines, never a feature; holds a project while tests fail or a model breaks."), two lines tall whatever it says. The button opens a popup of a fixed size, as New project does: its head (title, the scope "All projects" or one project, Close) stays, and its body scrolls the three groups above. Each row has one line of what it does, a control, and, like the Workload sheet, saves as it changes with no Save button, shows "Saved" beside it, and shows hobkin's refusal in place of its line (`ui/src/features/work/WorkloadSheet.tsx:153-191`). A row set for one project says so and offers "Same as all projects". Escape and Close close it and give the keyboard back to the button; nothing on the page moves.
- Another lane is rebuilding the YOLO page's cards (`ui/src/features/work/YoloScreen.tsx`, `yolo-page.ts`). This work adds the block and the press to what that lane leaves, and does not rewrite its cards.

## Out of scope

- Deploys: handing a deploy to the main agent and watching its monitoring for 30 minutes (`yolo-pass.mjs:164-168`, `deploys.mjs:18`). They do not decide whether a change merges. They are the next spec if the user wants them as settings.
- Retiring hobkin's own scored run completely, or changing the landing walk's use of the safety grade and `quality`.
- Posting ratings on GitHub, and any write to GitHub.
- Making the project's tests run again before each merge. The tests part stays what a readiness run recorded.
- Rewriting the YOLO page's cards.

## Acceptance

- A1. With no rule set, every case of `whyItAsks` that has a rule behind it gives the same answer as before this work, and nothing that waited before merges now.
- A2. Each setting takes a value in its range and refuses one outside it with a plain sentence, nothing is written when any value in the call is refused, and an unknown name is refused. "None" is accepted where the table allows it.
- A3. A setting for one project changes that project only. The row says it differs, and "Same as all projects" returns it.
- A4. Only the window's click writes a setting: no `hobkin work` command, no agent tool and no run does.
- A5. Each of the four project switches (tests, way back, models, regression) lets go of its own hold and no other, and says in the page's words which setting holds a project that is held.
- A6. The lowest rate accepts one decimal between 1 and 10. A change rated 8.4 asks at 8.5 and merges at 8.4. Each question's lowest score lets a change with a lower score through only when the user lowered that one.
- A7. Kinds, the line limit, areas, deleted tests, one-way undo, earlier branches, a run's note and the paths list each hold or release only their own rule. A path word the user removed no longer asks, and a path with a word added asks.
- A8. With "most merges a project in one pass" at 2, two changes merge on one project in one pass, each pinned to its own commit. At the default it is one.
- A9. With a model broken on the default branch and the switch off, every change on the project asks and names the model. With it on, a change that makes every broken model hold at its head merges, and one that does not touch them asks and names the model. After the merge the broken specs are checked again at once.
- A10. With pull request merging off, a pull request waiting on its own branch asks and says the switch is off. With it on, the page lists what GitHub must have, says for each project which is met, and an unmet one keeps the change asking and names itself. With "required checks cannot be listed" off, such a pull request asks.
- A11. Every finished change and every pull request the app lists says one of: its five scores and its rate at its commit; rating now; waits its turn with how many are ahead; rating again with the try; or not rated after N tries with why. None says "no rate yet" or shows an empty row.
- A12. YOLO mode reads grades recorded from Change Review and no others: a change with only hobkin's own scored run's scores, or with a record written any other way, asks "its review has not rated it", and a change rated by Change Review at its commit is weighed.
- A13. `recordGrades` refuses a record with fewer than five scores, an unknown or unfinished item, or a head that is not the item's current one when it already has grades, and accepts a complete one. The `item` command refuses `review` from a run.
- A14. An answer without all five scores is asked again, up to the tries set, then the change is held as not rated with the reason. With no monitoring known, visibility is rated 3 by rule and the rate exists.
- A15. A change that moved to a newer commit shows the older rating marked older, with both commits, YOLO mode does not use it, and the new review is made in the repository's line. A review made before ratings existed is rated without being built again.
- A16. A change whose run left a note, and one that opened a hobkin pull request, are rated by themselves. A Markdown-only change says it has nothing to rate. With "rate other pull requests" on both, a pull request of the user's and one waiting for them are rated.
- A17. The caps (kept current, a day, tries) hold at their numbers, and "none" lifts them.
- A18. The page says the rules in force in one sentence, and its Settings button opens a popup that shows three groups. A change in a row is saved as it is made, shows Saved, and a refusal shows in the row. With no host the popup shows sample rules.
- A19. A project's card says its verdict in a line, names each setting that holds changes once with its count, and a press on it opens that setting in the popup, scrolled to it and in that project's scope when the project sets it. A project that is still being set up says so in one quiet line and is not called "getting ready".

## Proof

- A1. In hobkin, `test/cli-yolo-rules-defaults.test.mjs` › "with no rule set, each case of whyItAsks gives the answer it gave before, one case for each rule in the audit's table"
- A2. In hobkin, `test/cli-yolo-rules.test.mjs` › "each setting takes its range and refuses what is outside it in plain words, writes nothing when one value is refused, refuses a name it does not know and takes none where the table allows it"
- A3. In hobkin, `test/cli-yolo-rules.test.mjs` › "a setting for one project changes that project only, and clearing it returns the project to the rest"
- A4. In hobkin, `test/cli-yolo-rules.test.mjs` › "no hobkin work command writes a rule"; `host/test/work-yolo-rules.test.ts` › "work.yolo.rules is outside: only the window sends it, and the runtime's refusal passes on"
- A5. In hobkin, `test/cli-yolo-holds.test.mjs` › "each project switch lets go of its own hold only, and a held change names the setting that holds it"
- A6. In hobkin, `test/cli-yolo-change-rules.test.mjs` › "the lowest rate takes one decimal between 1 and 10", › "a lowest score lets a change through only when it was lowered"
- A7. In hobkin, `test/cli-yolo-change-rules.test.mjs` › "kinds, lines, areas, deleted tests, one-way undo, earlier branches and a run's note each hold or release only their own rule" and › "a path word removed no longer asks, and one added does"
- A8. In hobkin, `test/cli-yolo-pass.test.mjs` › "two merges on one project in one pass when the user set two, each pinned to its commit, and one by default"
- A9. In hobkin, `test/cli-yolo-model-fix.test.mjs` › "a broken model holds every change with the switch off; with it on a change that makes it hold merges, one that does not touch it asks and names it, and the broken specs are checked again after the merge"
- A10. In hobkin, `test/cli-yolo-pulls.test.mjs` › "pull requests ask while the switch is off, and with it on the unmet GitHub condition is named and keeps asking, and required checks that cannot be listed ask unless the user allowed it"; here `ui/test/work-yolo-pulls.test.ts` › "the page lists what GitHub must have for each project, each met or not"
- A11. `ui/test/work-yolo-grades.test.ts` › "a change says one of rated, rating now, waits its turn, rating again or not rated after N tries, and never no rate yet"; `host/test/review-grades-states.test.ts` › "each state of a change's rating comes from the review's line, its tries and its answer"
- A12. In hobkin, `test/cli-yolo-grades.test.mjs` › "YOLO mode weighs only grades recorded from Change Review at the change's commit, and asks for any other"
- A13. In hobkin, `test/cli-review-grades.test.mjs` › "recordGrades refuses fewer than five scores, an unknown or unfinished item and a head that is not the current one, and accepts a complete record", › "the item command takes no review from a run"
- A14. `packages/change-review/test/needs-retry.test.ts` › "an answer without all five scores is asked again, narrowly, up to the tries, then not rated with why" and › "with no monitoring known visibility is 3 by rule and the rate exists"; `host/test/review-grades-bridge.test.ts` › "a finished review's ratings reach the runtime through recordGrades and an agent's run cannot write them"
- A15. `host/test/review-grades-states.test.ts` › "a change at a newer commit shows the older rating marked older and YOLO mode reads none of it", › "a review made before ratings existed is rated from its graph without being built again"
- A16. `host/test/review-turns.test.ts` › "a change whose run left a note and a hobkin pull request are prepared by themselves, and a Markdown-only change says it has nothing to rate" and › "pull requests are rated by the user's choice of mine, waiting, both or none"
- A17. `host/test/review-budget.test.ts` › "the three caps hold at their numbers and none lifts them"
- A18. `ui/test/work-yolo-rules.test.ts` › "the closed block says the rules in force in a sentence, the open one shows three groups, a change is saved as it is made and a refusal shows in its row"; check: still renders of the page and the popup, light and dark, then the live window
- A19. `ui/test/work-yolo-page.test.ts` › "a card says its verdict in a line, each holding setting once with its count, and a press opens that setting"; check: still renders of a card with holds and of one still being set up, light and dark, then the live window

## Steps

The runtime first, the host next, the page last. Each step's tests are written before its code.

- [x] S1 (A1, A2, A3, A4). hobkin: the rules, their defaults, their checks and where they are kept. New `src/cli/work/yolo-rules.mjs` (names, defaults, ranges, `rulesOf(root, slug)` that reads defaults, then `yolo.rules`, then `yoloProjectRules`), `setYoloRules`, and `setYolo` taking `rules` in `yolo.mjs`. Tests: `test/cli-yolo-rules.test.mjs`. No gate reads them yet, so nothing changes. Built 2026-11-24: hobkin 81a7806.
- [x] S2 (A1, A5, A6, A7, A8). hobkin: the gates read the rules. `whyItAsks` returns the reason and the name of the setting that holds it, `changeHolds` (`patterns.mjs`) takes the line limit, the areas, the paths and the switches, `classified.mjs` takes the floors, the kinds go through the set, and the pass takes the merges a pass. The readiness bar becomes four switches. A golden test pins every default to today's answer first. Tests: `test/cli-yolo-rules-defaults.test.mjs`, `test/cli-yolo-holds.test.mjs`, `test/cli-yolo-change-rules.test.mjs`, `test/cli-yolo-pass.test.mjs`. Built 2026-11-24: hobkin fcce9b6. The golden test of each default passes on the code from before and after.
- [x] S3 (A9). hobkin: the broken-model rule. A change that makes every broken model hold passes the models hold when the switch is on, and the broken specs are checked again right after a merge that covers them (`yolo-pass.mjs`, `proof-checks.mjs`). Tests: `test/cli-yolo-model-fix.test.mjs`. Built 2026-11-24: hobkin 4013f55. No real TLC run.
- [x] S4 (A10). hobkin: pull requests by a setting. `PULL_REQUESTS_MERGE` is removed. The pass reads the project's switch and the "checks cannot be listed" switch, and a read-only report, with the user's own gh, of what GitHub must have, met or not, for the page (`yolo-pulls.mjs`, `yolo-report.mjs`). Tests: `test/cli-yolo-pulls.test.mjs`. Built 2026-11-24: hobkin 8d9dba2. Against a stand-in for gh only.
- [x] S5 (A12, A13). hobkin: the grades' door. New `src/cli/work/review-grades.mjs` with `recordGrades`. YOLO mode reads only grades that say `by: 'change-review'`. The `item` command drops `review`. Nothing starts hobkin's scored run by itself any more (`closing.mjs`, `director.mjs`, `yolo.mjs:261-267`), and a project that is not ready no longer stops reviews. Tests: `test/cli-review-grades.test.mjs`, `test/cli-yolo-grades.test.mjs`. Built 2026-11-24: hobkin 0efc685, 8c7258c. The host against it for real: 2590e75.
- [x] S6 (A14). Change Review: the five ratings are mandatory. A narrow re-ask up to the tries, visibility by rule when no monitoring is known, "not rated after N tries" with why (`packages/change-review/src/needs.ts`, `model.ts`, `pipeline.ts`). Tests: `packages/change-review/test/needs-retry.test.ts`. Built 2026-11-24: 4761efb, 524d2ee. No real model was run.
- [x] S7 (A11, A14, A15, A16, A17). Host: the bridge and the states. A finished review's ratings go through `recordGrades`. A change's rating state (rated, now, waits its turn, rating again, not rated), older ratings marked, a review without ratings rated from its graph, changes whose run left a note and pull requests prepared by themselves, the three caps carried from the workload (spec 058 S3), and the `reviewPulls` default. Files: `host/src/review/seat.ts`, `reviews.ts`, `assessment.ts`, `ratings.ts`, `host/src/work-items.ts`. Tests: `host/test/review-grades-bridge.test.ts`, `host/test/review-grades-states.test.ts`, `host/test/review-turns.test.ts`, `host/test/review-budget.test.ts`. Built 2026-11-24: fe50d3f, ab04d61, ec4e9e8. A review made before ratings is not rated from its graph: it needs one Rebuild.
- [x] S8 (A2, A4). Host and protocol: `work.yolo.rules` (`shared/commands/registry.ts`, `host/src/work.ts`), the snapshot's rules, per-project differences and the name of the setting that holds each change (`shared/protocol/work.ts`, `YoloState` and `YoloChange`). Tests: `host/test/work-yolo-rules.test.ts`, `shared/test/work-yolo-rules.test.ts`. Built 2026-11-24: 7d70354, c33d604, 353eba2.
- [x] S9 (A18). Page: the block, closed and open, with the three groups, saved as made, the project override and a refusal in its row. Files: new `ui/src/features/work/YoloRules.tsx` and `yolo-rules.ts`, and one place in `YoloScreen.tsx` where another lane's cards leave room. Sample rules with no host. Tests: `ui/test/work-yolo-rules.test.ts`. Built 2026-11-24: ee8eefd, 65c868a, 76921be. Seen in still renders only.
- [x] S10 (A11, A19). Page: a card says its verdict in a line and each holding setting once with its count, with a press that opens it in the block. A change's rating state in every row, with no "no rate yet" (`yolo-page.ts`). The readiness state word "Getting ready" goes. Tests: `ui/test/work-yolo-page.test.ts`, `ui/test/work-yolo-grades.test.ts`, `ui/test/work-yolo-pulls.test.ts`. Built 2026-11-24: 65c868a. Seen in still renders only.

## Open questions

- Built with every default as it was, so nothing merges that did not merge before. What no test ran: a real review graded and recorded end to end, a real pull request merged by the setting, and the page in the app's own window.
- `hobkin/src/prompts/work-do.md` still asks hobkin's own review run for scores, which the item command now drops. The run is no longer started by itself; whether it goes for good is the user's call.

Each is the user's call, with what I would do.

- Retire hobkin's own scored run? I would stop it starting by itself and stop YOLO reading it now, and keep the card's Review button until the user says to retire it. That pays for one review of a change, not two.
- Visibility with no monitoring known: set to 3 by rule so a rate always exists, or leave it unrated? I would set it to 3. It reads as a guess to someone who wants no guesses, but it is a stated rule shown as one, and the change then asks the user until monitoring exists.
- Rate other people's pull requests by default? The user said grades are never optional, so I set `reviewPulls` to both, bounded by the repository's line and the day's number. Today it is none. Changing it spends model calls the user did not ask for yet.
- Keep the caps (3 current, 20 a day), or lift them? With them, nine waiting changes of one repository show three rated and six waiting with "N ahead", never blank. Lifting both to none rates everything at once, at about 25,000 prompt tokens each. I would keep them and let the user lift them in the block.
- Tries to get all five ratings: 3. Each re-ask is a narrow model call.
- Most merges a project in one pass: limit 1 to 5. The limit is mine, with the reason in the table.
- Hold a project until its readiness is checked again after a regression: kept on by default. A switch off means a later bad deploy no longer stops the next merge.
- Deploy settings are not in this spec. Whether handing a deploy on, and the 30-minute watch, become settings is the user's call.
- The tests part is what a readiness run recorded, and nothing runs the tests again before a merge. Whether YOLO mode should run them is a different spec.
