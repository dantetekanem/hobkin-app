# Notes for spec 058: what the audit of 2026-11-23 found, and the policy

A read-only audit of how change reviews start, go out of date and are kept, what one costs, and where the user's ratings come from, made on 2026-11-23. Line numbers are of that day. `[code]` was read in the code, `[run]` seen in a probe on a temporary repository with a stand-in engine and no model, `[inferred]` reasoned. The home was not read.


Labels: [code] read in the code, [run] seen in the scratch probe (`rv/probe.test.ts`, temp repo, fake engine, no model), [inferred] reasoned, not shown. Nothing in `~/.hobkin` was read, so nothing here says what the user's own list holds.

Two kinds of "review" cost money here:
- Change Review (the client's, spec 032): graph, the repository's tests in a review worktree, one Reviewer call (high tier, high thinking) and one blind check (fast tier). This is what AI Reviews lists.
- hobkin's scored review (spec 049): a whole agent run (`reviewAsked`) that also runs `agentic_code_review` twice and commits fixes. Only with "Score finished changes" on, or YOLO on a ready project.

## 1. What starts a Change Review

| Trigger | Where | Once per commit? | Queue / limit |
|---|---|---|---|
| Host publishes state (every change of hobkin's state) | `host/src/host.ts:236-241` calls `reviews.watch(toPrepare(...))` | yes: `watched` version `head@updatedAt` (`reviews.ts:1916-1924`), `store.has(target, head)` (`store.ts:134`) | graph prep: `limit = 3` waiting or running (`reviews.ts:1873-1888`), one graph at a time (`work()`, `reviews.ts:891-915`). Change reviews: `Assessments` queue, unbounded, `AT_ONCE = 4` (`assessment.ts:617, 703-745`), one at a time per project because the project has one review tree and `inTree` takes turns on it (`assessment.ts:794-817, 827-830`). [code] |
| A change hobkin finishes | `toPrepare` lists every change in hobkin's groups (`seat.ts:352-367`), minus "Left for you" (`work-items.ts:216-218`) | yes | as above. Probe: 20 finished changes of one repository, all 20 change reviews started within about 1 s of publishing. [run] |
| Branch moved (agent rework, hobkin's own review run committing fixes, a TLA+ model commit, a risk-fix round, a conflict rebase) | `followBranches` asks git once a minute per change (`reviews.ts:1895-1907`), `watchOne` sees `!store.has(head)` and calls `prepare` (`reviews.ts:1927-1928`) | yes, per new head | rebuilt by itself, no cap. Probe: an agent's commit with the card unchanged: 1 rebuild; a commit of only `_specs/tla/x/X.tla`: 1 full rebuild; 19 branches rebased onto main: 19 rebuilds. [run] |
| Pull request opened or updated | only with workload `reviewPulls` mine/waiting/both (`seat.ts:352-367`; default none, `hobkin store.mjs:449`); drafts and hobkin's own PRs left out | watched by `updatedAt`; a same-head update costs a GitHub call and nothing else (`reviews.ts:932-944`) | same queues [code] |
| "Start AI review" (GitHub page, Preparing page) | `rows.tsx:242`, `loader.ts:264-269` | uses what exists for the head | same queues [code] |
| "Review again" (AI Reviews row, Work card) | `AiReviews.tsx:142`, `Finished.tsx:352`, `review-follow.ts:79`: `review.prepare {refresh: true}` | no: it pays the whole review again at the same commit, even when nothing changed | same queues [code] |
| "Rebuild" in an outdated header | `Header.tsx:301-316` → `loader.ts:185-186` `refresh: true` | no, full again | [code] |
| Opening a review | a finished change that is idle is prepared on open (`loader.ts:45, 196-202`); a pull request waits for Start; a ready one only asks status | opening a ready review is free | [code] |
| hobkin's agent | `review.prepare` is `hobkin: true` (`shared/commands/registry.ts:897-903`) | as Review again when `refresh` | [code] |
| Host start (after quit or crash) | `watched` is in memory, so every finished change is looked at again; a run with `progress.json` and no `summary.json`/`failed.json`/`restarted.json` restarts once (`assessment.ts:681-686, 703-713`); one never started at a stored graph starts (`reviews.ts:1929-1933`) | once per commit (`restarted.json`) | [code], test `host/test/review-starts-by-itself.test.ts` |
| YOLO's own checks | YOLO reads only hobkin's scores (`yolo-pass.mjs:68-88`), never Change Review; with YOLO on a ready project, hobkin scores by itself (`yolo.mjs:208`) | scores per head, held across spec-only commits (`proofs.mjs:112-123`) | hobkin asks at most 2 scored reviews a survey pass (`closing.mjs:15, 64-79`) [code] |
| Risk-fix | a risky answer sends hobkin's agent back, at most 2 rounds (`risk-fix.ts:11, 45-52`), each round moves the head, which is reviewed again by itself | up to 3 Change Reviews per change from risk alone [inferred from code] |

Nothing is rate-limited per repository or per day for Change Review. The workload's day cap and hours do not hold reviews: "work on a finished change (its review, a fix, the refresh before a merge)" is not new work (`plan.mjs:426-431`). Change Review's model calls are not in hobkin's token budget at all (they run in the client's own Pi session, `agent.ts:92-103`). [code]

Worst case per finished change with scoring on [inferred]: Change Review at the finish commit, hobkin's scored run commits fixes (work-do.md:45 "Fix what all of this finds that is real, commit that"), Change Review again, a TLA+ model commit (work-do.md:120), again, up to 2 risk-fix rounds, again twice, a conflict rebase, again: about 6 Change Reviews, each with full tests and two model calls.

## 2. What makes a review outdated, and what happens then

- Head moved: `stale` in status (`reviews.ts:649`), "Outdated. Built for X, and the change is now at Y" when opened (`outdated.ts:23-26`). Rebuilt by itself at once for every finished change (`reviews.ts:1927-1928`) and every auto-reviewed pull request; not for a change being brought up to date on the user's yes (`reviews.ts:1918-1920`). [code][run]
- Start moved (A45, A46): `lookAgain` keeps `startsAt` (`reviews.ts:846, 853-859`), the header says "Built from X, and the change starts at Y" (`outdated.ts:28-31`) and offers Rebuild. Never rebuilt by itself: the store is keyed by head only. [code] When does the start move? Not when an unrelated change merges: the merge-base of a branch with a main that moved forward is still its fork point (`sources.ts:63-74`). Probe: one merge into main, 19 other reviews: 0 starts moved, 0 rebuilds. [run] It moves for a change stacked on another unmerged branch once that one merges (probe: start moved, marked only, rebuilt 0 times [run]), and it moved for every review built before c8236f2 where this machine's main had parted from origin's (spec 032 S21). That last group is a likely source of many "outdated" notices at once, as each old review of such a project says so when opened [inferred; the home was not read].
- Engine or host changed: never outdated, never rebuilt. `meta.graph` older than `GRAPH_RULES = 3` is redrawn only when someone prepares it (`reviews.ts:411, 932-934`), which costs no model; `producerVersion` is kept and never compared (`store.ts:28-29`). Spec 032 S23: "A review built before this keeps what it said until it is built again." [code]
- Pull request head moved: asked of GitHub when opened (`reviews.ts:826-850`), marked; rebuilt by itself only when auto PR reviews include it (`reviews.ts:1927`). [code]
- After one change merges: its own review leaves the list (`reviews.ts:760`, `retireClosed` 726-734). The others: 0 outdated by head, 0 by start (unless stacked), nothing rebuilt [run]. hobkin then puts them in "Refresh then merge" because `behind > 0` (`hobkin groups.mjs:25-28, 41-44`); a refresh on the user's yes does not rebuild the review (landing `refreshing`). What does rebuild many at once is hobkin rebasing them (conflict rebase from pairs or ship, `pairs.mjs:40, 143-147`, `unmerged.mjs:563-567`): every moved branch is reviewed again, at once, 19 of 19 in the probe [run].
- A change sent back to work (risk-fix, a note, hobkin's scored run) leaves Finished, but its queued or running change review is not stopped: `retireClosed` only stops merged or closed ones (`reviews.ts:701-734`). It finishes reviewing a commit an agent is about to replace [inferred from code].

## 3. What a review costs

- Models: one Reviewer call, `pass: 'review'` (`pipeline.ts:832`), on the tier the user names, `high` by default, always high thinking (`agent.ts:26, 66-73`); one blind check, `pass: 'checker'` (`blind.ts:197`), fast tier (`agent.ts:81-85`). Grammar fixes on the quick tier only for verdict words. Prompt up to 100,000 characters, about 25,000 tokens (`model.ts:60-61`), plus high-thinking output. Each call may run 10 minutes (`agent.ts:195`). [code]
- Tokens: recorded nowhere. `askSession` reads only the text parts of the answer (`agent.ts:222-224`); `host/src/metrics.ts` counts reviews safe, risky and failed and their time (`metrics.ts:62, 140-151`), not tokens; hobkin's `tokens.jsonl` has only its own runs (`director.mjs:1054`). hobkin reads `child.usage` for its runs (`director.mjs:348-356`), so Pi gives usage; the in-process session's assistant message likely carries it too [inferred].
- Tests: the proof runs every candidate test at head, then for each changed definition a revert run, sometimes a probe and a reach run (`assessment.ts:451-462` names them), plus every test file the change touches (A49). Napkin numbers, not measured: small fix 2 to 6 minutes of tests and 2 to 4 of model time; 1,000 lines 5 to 15 and 10 to 15 (`packages/change-review/skills/change-review/reference/budget.md`). Each review also runs the call-graph scan (`sources.ts:139-140`). [code]
- Worktree: one linked worktree per project, `client/review-trees/<slug>` (`assessment.ts:422-424`), kept between reviews, reset and cleaned each time (`assessment.ts:310-340`). Pull requests: a clone per repository in `client/review-clones/...` (`pull-checkout.ts:59`). Twenty reviews of one project wait in line for that one tree, the model calls included, since the whole engine run holds it (`assessment.ts:833-872`). [code] At the napkin numbers, 20 small reviews of one project are 1.5 to 3 hours of machine time in a row [inferred].
- What a rebuild reuses: at the same head, the graph if drawn by the current rules (`reviews.ts:932-944`), nothing else: `refresh` reruns the whole change review (`reviews.ts:974`, `assessment.ts:703-706, 843-845`). At a new head, nothing. The building blocks for reuse already exist: `movedSince` tells a rebase that kept the same commits (`landing.ts:63-75`, `git range-diff`), and hobkin treats commits after the last code change that touch only `_specs/` as the same code (`proofs.mjs:112-123`, `tree.mjs:263-266`).

## 4. What is kept, listed and removed

- Home: `client/reviews/<folder>/` holds `review-<head12>.json`, `files-<head12>.json`, `meta-<head12>.json` for every commit ever built (`store.ts:151-158`), `notes.json`, `landed.json`, `merge-asked.json`, `risk-fix.json`; `change-review/<head12>/` holds triage, graph, risk events, units, story, story words, blind check, progress, summary, failed and restarted (`assessment.ts:397-399`; spec 032 Decisions). Nothing is ever pruned: the only deletion is `review.remove` (`store.ts:203-207`). Broken review trees move aside as `<tree>-broken-<time>` and stay (`assessment.ts:325-328`). [code]
- Metrics read every `summary.json` and `progress.json` under each review (`metrics.ts:129-151`), so cleanup must keep those two small files or the numbers lose history.
- The list (`reviews.ts:752-798`, `ai-reviews.ts:83-91`): groups "Asked to merge, not merged", Running (under way, then waiting its turn), Ready, Failed. Merged ones and ones the user discarded leave (`reviews.ts:760`). A finished change with no review yet shows as "Waiting its turn" (`reviews.ts:688-695`). Outdated is never shown in the list: no row carries `stale` or `startsAt` (probe [run]: 0 rows with a mark). A change hobkin closed without a merge (declined from its card, dropped, done) keeps its row in Ready forever, because the landing reader returns null for those states (`seat.ts:169-183`) and the list hides only merged and landed [code]; probe shows rows of changes no longer finished stay listed [run, with no landing reader].
- Remove on a row deletes everything of that review (`reviews.ts:1142-1152`) and keeps the watched version, so it is not built again until the change moves.
- Twenty finished changes of one project: 20 rows; at first most under Running as "Waiting its turn" (16 of 20 at 200 ms in the probe [run]), then 20 under Ready with no per-project summary, sorted newest first unless the user picks another order.

## 5. What says which change matters most now

- hobkin's landing order: no conflict first, then safety grade, quality, smaller diff, oldest (`hobkin reads.mjs:207-211`); `readyItems` / `hobkin work ready` (`reads.mjs:373`, `commands.mjs:347`). Work's groups: Ready to merge, Refresh then merge, Needs you (`groups.mjs:25-39`). `toPrepare` hands changes to the background in that order (`seat.ts:353-354`).
- hobkin already caps by "what the user sees next": `NEXT_ROWS = 5` ("Filling in any more would pay for work they may never ship", `closing.mjs:10-11`) and `REVIEWS_A_PASS = 2` ("Each review is a whole run", `closing.mjs:14-15`).
- Priority: AI Reviews' Priority order, the change's grade else its project's priority (spec 032 A44; `ai-reviews.ts:139-149`); `FinishedChange.grade`, `behind`, `conflict`, `size`, `at` (`shared/protocol/work.ts:145-197`).
- Ship first: new work holds at 8 finished changes waiting (`store.mjs:404`).
- YOLO: its "Next to merge" list, from hobkin's scores, not Change Review.
- What the user opened last: only in memory (`Reviews.lookedAt`, `reviews.ts:426`) and the window's trail. Nothing kept.

## 6. Policy

Goal: for one repository, the reviews that exist are few, current and worth their cost, and nothing is paid twice without a reason.

### 6.1 The line (cap per repository)

- Each repository (a project's slug, or a pull request's `owner/repo`) keeps at most K reviews current. Default K = 3.
- The line, per repository: what the user asked for (Review now, Review again, opening a change that has no review) always goes and never pushes another out; then the changes in Work's order (Ready to merge, Refresh then merge, Needs you; inside, hobkin's landing order), with P0 always taken. A change waiting longer than 48 hours is taken next (no change waits for ever).
- Not in the line, each with its reason: one that conflicts ("reviewed after its rebase", since the rebase moves its head); one being brought up to date; one back at work ("an agent is on it", and a queued review of it is dropped; one running finishes); with scoring on, one hobkin has not scored at its head yet ("waits for hobkin's scoring", up to 2 hours, since that run commits fixes).
- The rest are listed "Waits its turn: 3 ahead in shop" with Review now.
- Where: new pure `host/src/review/turns.ts` (from `WorkState.finished`, statuses and K: current ids, and for the rest `{ ahead, why }`); `reviews.ts` `watch`/`watchOne` build only current ids and `prepare(asked)` skips the line; `waitsItsTurn` and `list` carry `turn`. Protocol: optional `turn?: { ahead: number; why: string }` on `ReviewListItem` (`shared/review/status.ts`).

### 6.2 Outdated reviews

- Head moved: rebuilt by itself only when the change is current; otherwise marked "Outdated, built for X" and it waits its turn. After a merge, only the next change in line is built: the rest keep their marks.
- Carry instead of rebuild when only the base moved: the new head's commits are the old ones on a newer start (`movedSince(...).same`), and no file the review read changed between the old start and the new one (the change's files, every test file a run held in `graph.json`, every context node's file), and the call-graph scan at the new head finds the same callers for each changed definition. Then the review is copied to the new head with `carried: { from, why }`, its words, units, levels and blind check kept, and only the baseline run of the change's tests is made at the new head. No model call. If that run fails, or any check above fails, it is a full build in its turn. What proves it: a test that rebases a change onto a main that changed an unrelated file (carried, 0 model calls, 1 test run), and one where main changed a test's file or added a caller (built again).
- Commits after the review that touch only `_specs/**` or Markdown (hobkin's own same-code rule): carried with a line saying so; a new TLA+ model's check is read at the new head as today, and the line says the code read is the same.
- Start moved with the same head (stacked): marked, and rebuilt in its turn.
- Engine or host changed: as today, never outdated by itself; the header names the engine version that built it.
- Review again or Rebuild with nothing changed (same head, start and engine): the first click says "Nothing changed since this review; it costs a whole review again", the second does it.
- Where: new `host/src/review/carry.ts` (the proof and the copy), `assessment.ts` (a baseline-only run and `carried` in `summary.json`), `outdated.ts` and `Header.tsx` for the words.

### 6.3 Reuse

Kept across a rebuild only in the carry cases above. Not built now: partial reuse of the Reviewer's words per unit (the Reviewer is one call over the whole map, spec 032 "There is no second model loop", and a unit's words depend on its neighbours) and a test result cache (no import graph proves a test unchanged). Always paid again when the change's own patch changed: the proof's revert runs, the Reviewer call and the blind check.

### 6.4 Budget

- First record it: each model call's usage (input, output, cache, cost when Pi gives it) into `change-review/<head>/usage.json`, and the numbers add review tokens per day (`agent.ts`, `assessment.ts`, `host/src/metrics.ts`).
- Background reviews a day, across all repositories: default 20. At the limit the background builds nothing more until local midnight; rows say "Today's 20 background reviews are spent; the next at 00:00"; the user's own asks still run. Tokens a week per repository becomes a setting once usage has been recorded a week.
- Set in the workload sheet's AI review row (`WorkloadSheet.tsx:392-401`), stored in hobkin's `mode.json` through `setWorkload` (`hobkin store.mjs:414-466`: `reviewsPerProject`, `reviewsADay`), passed through `workloadFrom` (`host/src/work.ts:191-206`).
- Review tokens are shown beside hobkin's, not counted in its allowance.

### 6.5 Cleaning up

- Per change: keep the newest two built heads whole; older heads keep `summary.json` and `progress.json` (numbers and "before") and lose review, files, meta, graph, units, story and the rest.
- A change merged, discarded, or closed by hobkin (declined, dropped, done): leaves the list (the landing reader in `seat.ts:169-183` learns those states); heavy files go after 30 days; notes, landed, risk-fix and summaries stay.
- Outdated and not current for 14 days: folded under "Outdated (n)"; its heavy files go once a newer head is built.
- Review trees: a `-broken-` tree after 7 days; a project's tree once the project leaves hobkin; a pull request clone with no review in 30 days.
- Remove stays the user's delete. Cleanup runs on host start and once a day. Where: new `host/src/review/cleanup.ts`, `store.ts` (`prune`).

### 6.6 What the user sees

AI Reviews gets one line per repository above its rows: "shop: 3 current · 12 waiting · 2 outdated · 9 built this week, about 1.1M tokens". Rows that wait fold under "Waiting (12)"; each says why it is not built and offers Review now; outdated rows say when they will be built; carried ones say from which commit. Protocol: optional `repos` on `review.list`.

## 7. Tests first

Host and runtime lane:
- `host/test/review-turns.test.ts` › "of twenty finished changes of one project only the first three in Work's order are built; the rest wait, each with how many are ahead"; › "a change that conflicts, is being brought up to date or is back at work is not built, and says why"; › "Review now builds one outside the line and stops none of those current"; › "after a merge only the next change in line is built"; › "a change that waited two days is taken next"; › "a queued review of a change sent back to work is dropped".
- `host/test/review-carry.test.ts` › "a change rebased with the same commits onto a main that changed nothing it read is carried: no model call, one test run at the new commit"; › "main changed a file the review read, or a caller of a changed definition: it is built again"; › "a carried review whose tests fail at the new commit is built again in its turn"; › "commits of specs or docs alone carry the review and say so".
- `host/test/review-budget.test.ts` › "at the day's number of background reviews the rest wait for midnight and say so, and the user's own ask still runs"; `host/test/metrics.test.ts` › "each model call's tokens are kept beside its review and the numbers add them by day".
- `host/test/review-cleanup.test.ts` › "older heads keep their summary and progress and lose the rest"; › "a change hobkin closed leaves the list and its heavy files go after thirty days, its notes kept"; › "a broken review tree goes after seven days".
- `host/test/review-verdict.test.ts` › "a yes on a carried review says it was carried, from which commit, and merges the commit shown".
- In hobkin, `test/cli-work-store.test.mjs` › "the reviews kept current per project and the background reviews a day are kept in the mode file, 3 and 20 unless set".

Window lane:
- `ui/test/work-ai-reviews.test.ts` › "each project's line counts its current, waiting and outdated reviews and what they cost this week"; › "a row that waits says how many are ahead and offers Review now"; › "rows that wait fold under Waiting".
- `ui/test/review-outdated.test.ts` › "a carried review says from which commit it was carried and that its tests passed at this one".
- No tests for copy; still renders for the rows and the workload row.

## 8. Risks

- A change that never gets its review: aging (48 hours), Review now, and opening it builds it.
- A merge on a stale review: the verdict already pins to the commit shown and says what moved (`reviews.ts:372-384`, `landing.ts:82-87`); a carried review must say carried in the preview.
- YOLO: it does not read Change Review today (`yolo-pass.mjs:68-88`), so the cap cannot make it merge on a stale Change Review. Its own scores hold across a base that moved (`scoresHoldAt`), which nothing here changes. If spec 049's option (b) is taken (Change Review must agree), YOLO's candidate must always be current and a carried review counts only once its baseline ran at that exact commit.
- Risk-fix sends an agent only for the review at the card's commit (`risk-fix.ts:46`); a change not current gets no review and so no agent: risky work then waits for its turn instead of being fixed by itself.
- Hot reload: `watched` and the line live in memory; a reload looks at everything again, so the line must be recomputed, not remembered.

## 9. The user's choices, with the default I would take

1. Reviews kept current per repository: 3.
2. The order of the line: Work's landing order with P0 always in (rather than the AI Reviews Priority sort).
3. Carry when only the base moved: on.
4. Carry across spec-only and doc-only commits: on.
5. Wait for hobkin's scoring before Change Review when scoring is on: yes, 2 hours at most.
6. Background reviews a day: 20; tokens a week once measured.
7. Opening a waiting review builds it: yes, as Review now.
8. Keep: newest two heads whole, 30 days for closed changes, 14 days before outdated ones fold.
9. Review tokens counted in hobkin's daily allowance: no, shown beside it.

## 10. The user's needs (the five ratings) in every review, and YOLO mode

The user, 2026-11-23: "i also dont see the damn ratings in a PR for yolo mode", "each AI review should present my needs". The needs are spec 049's questions: coverage, proof (tests added or changed, what is missing), deploy and data, visibility (monitoring), rollback (risk and time).

### 10.1 Where a rating comes from, and when it exists [code]

- Only hobkin's scored review writes one: a work run marked `reviewAsked`, step 8 of `hobkin/src/prompts/work-do.md:45-81`; hobkin keeps scores only from that run (spec 049 A1; `classified.mjs:30-47`), computes the rate and floors itself (`classified.mjs:51-83`).
- It runs by itself only when `reviewsByItself`: "Score finished changes" on (`reviewOnFinish`, default off, `store.mjs:433, 449`), or YOLO on and the project ready (`yolo.mjs:208`). Then at finish (`director.mjs:878-894`) or from the survey, 2 a pass (`closing.mjs:15, 50-79`). By hand only with `hobkin work review` (`controls.mjs:444-459`), from chat or the CLI.
- The Work card no longer asks for it: its Review choice is replaced by Change Review's Review again (`Finished.tsx:321-322, 351, 484-489`). The panel's line still says "Review on the change's Work card starts a scored review" (`ui/src/features/review/panel/scores.ts:16-17`): that is wrong now.
- Never rated: any change while scoring is off and YOLO is off (the default); a change on a project YOLO says is not ready; a pull request from GitHub (`scores.ts:19-20`, spec 032 A47); a change that finished as a pull request, on a project in draft or published PR mode: scoring by itself needs state `branch` (`director.mjs:878`; the survey's rows are `branch` items only, `reads.mjs:327`, so `askReviews` never sees it), and YOLO refuses it, "it is not a finished local branch" (`yolo-pass.mjs:73`). A change reworked since its scores: stale (`proofs.mjs:123`, `reads.mjs:300`) until scored again, which happens by itself only where scoring is on.
- What each place shows then:
  - Review panel: a "Scores" part under "What this change does", finished changes only, or the one "not scored" line (`WhatMatters.tsx:49`, `scores.ts:23-32`). Taken from the card (`reviews.ts:652`), so it is the card's scores even when the review open is of another commit.
  - AI Reviews row: "· rate N" only, nothing for the five, nothing when stale, nothing for a pull request (`AiReviews.tsx:228`, `reviews.ts:786`).
  - Work card: one line (`host/src/work.ts:305-312, 395`).
  - YOLO page: each waiting change's general rate against the user's, or "–" and "no rate yet" (`yolo-page.ts:348-360, 482-485`). Not the five, not their evidence.
  - Dropped on the way: `missing` (what proof is still wanted) and the commit the scores were made at never reach the window (`host/src/work.ts:315-324`; `shared/protocol/work.ts:11-22` has neither).
  - On GitHub: the pull request's description has no ratings (`work-do.md:82`; the client's own publish body, `reviews.ts:1847-1849`).

### 10.2 Two reviews of one change, two bills [code; costs inferred]

- hobkin's scored review: a whole agent run with tools, counted in hobkin's tokens and day budget (`director.mjs:1054`, `plan.mjs:539-542`), running `agentic_code_review` twice and up to three skills, and committing fixes (`work-do.md:45`). Those commits move the head, so Change Review builds again (section 1). It knows what an agent can look up in the project: its monitoring, deploy path, flags, the way back; it also writes `quality`, `notices` and `launch` (`work-do.md:45-48`), which hobkin's launch watch reads.
- Change Review: one Reviewer call and one blind check, tests and the scan. It knows by measurement what the scored run guesses: which test proves each changed definition (revert runs), whether through a request or alone, whether the diff added or changed that test (`-observed`), tests the change removed, tests that did not run, callers and entry points, each definition's effect, exposure and undo, TLC runs at the head (`assessment.ts:97-125, 244-287`; spec 032 A5, A35, A49-A51). It knows nothing of the project's monitoring: hobkin's readiness record has that per project (`yolo.mjs:195-203`, parts tests, monitoring, way back, deploy).
- So four of the five come from facts Change Review already holds (coverage, proof, deploy and data, rollback from undo), and the fifth needs the readiness parts handed in as the host hands in `modelChecks` (`seat.ts:222-224`). One more object in the Reviewer's existing answer costs far less than a second agent run [inferred].

### 10.3 What YOLO needs from a rating

- The commit it was made at, the very head that merges (today `scoresHoldAt`, with spec-only commits after it allowed, `proofs.mjs:112-123`; `yolo-pass.mjs:78`).
- Who made it: never the change's author (spec 049: "An author's own run cannot grade its change"). Change Review is not the author.
- When the change moves: stale, YOLO holds. When the base moves under it: today the scores hold (head unchanged), and nothing ran the change's tests with what merged under it [inferred risk]. With section 6.2, a carry check (baseline tests at the rebased head, no model call) settles it.

### 10.4 Position

- Every AI review, finished change and pull request alike, opens with "Your questions": five rows, each a number and its evidence; the kind; the general rate and floors by hobkin's own formula (the host imports `classified.mjs`, as it imports hobkin's store in `seat.ts:8-10`); what is still missing; the commit it was made at and by whom. At the top of the panel, above "What this change does"; in the row, the five numbers and the rate; on the YOLO page, the rate with its floors and "rated by the AI review at abc1234".
- The Reviewer's one call answers it: its answer gains `needs: { kind, missing, scores: { coverage, proof, safety, visibility, rollback: { score, evidence, facts } } }`. Code checks it as it checks claims: whole numbers from 1 to 10, an evidence line, facts that exist; and caps it by the facts (no test proves a changed definition: coverage at most 3; no test added or changed: proof at most 4; a high unit: deploy and data at most 5; nothing undoes it: rollback at most 4; no monitoring part ready on a path with an effect on data or load: visibility at most 4, as hobkin's prompt already says). An answer without it leaves the review "not rated", never a guessed number. No new call.
- It replaces hobkin's scored run as the rating, after a trial: on YOLO-ready projects both run for two weeks and the page shows both and whether they agree, and YOLO merges only when both pass. Then YOLO reads Change Review's rating and hobkin stops starting its scored run by itself (`yolo.mjs:208` path); the agent review stays as a choice the user can pick for its fixes.
- YOLO reads it through a new hobkin record, written by the host as `fixRisk` is (`reviews.ts:589-592`): `rating: { by: 'change-review', head, start, engine, kind, scores, missing, at }`. hobkin refuses it unless `head` is the branch's tip and the item is finished. `whyItAsks` reads `rating` before `review`, and also holds a change whose AI review at that head failed a test, left a test of the change not run, or was carried without its tests run there. YOLO's candidates always have a place in the line (6.1).

### 10.5 The user's choices, with my default

1. Replace hobkin's scored run, run both for a trial, or run both always: trial of two weeks, then replace.
2. Caps from the facts on the model's numbers: on.
3. A repository hobkin has no readiness record for (most pull requests): visibility not rated and no general rate, the other four shown.
4. YOLO for hobkin changes that are pull requests: still off, the rating shown.
5. The ratings on GitHub, in the description hobkin writes or a comment: off; it sends something outside, so only on the user's word.

### 10.6 Tests first

- Engine: `packages/change-review/test/needs.test.ts` › "the Reviewer's answer carries the five ratings with their evidence, the kind and what is missing; one that is malformed is dropped with why and the review still finishes"; › "the ratings are capped by the facts"; › "a pull request is rated the same way, with monitoring unknown when none is given".
- Host: `host/test/review-needs.test.ts` › "a review's status and row carry its ratings, the commit they were made at and hobkin's rate and floors"; › "the project's monitoring and way back reach the Reviewer"; `host/test/review-rating-to-hobkin.test.ts` › "a ready review at the branch's commit records its rating in hobkin, and one of an older commit is refused".
- hobkin: `test/cli-work-yolo.test.mjs` › "YOLO mode merges by the AI review's rating only at the commit it was made at, and holds one rated at an older commit, carried without a test run there, or whose review had a test fail or not run".
- Window: `ui/test/review-needs.test.ts` › "every review opens with the five ratings, their evidence, the rate and what is missing, a pull request too"; `ui/test/work-ai-reviews.test.ts` › "a row carries the five ratings and the rate"; `ui/test/work-yolo-page.test.ts` › "a waiting change shows its rate, who rated it and at which commit".
- Small fix now, no test (copy): the "not scored" line in `scores.ts:16-17` names a button that no longer starts a scored review.
