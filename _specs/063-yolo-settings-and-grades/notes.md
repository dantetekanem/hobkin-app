# Audit for spec 063: what stops YOLO mode, where grades come from

Made on 2026-11-24, read-only. `[code]` was read in the code, `[inferred]` is reasoned from it, `[not seen]` could not be checked here. hobkin's files are in `/Users/someone/Poetry/hobkin/src/cli/work/` (called `hobkin` below, paths relative to that folder), the app's in `/Users/someone/Poetry/hobkin-client`. hobkin's checkout was on another session's branch and was only read. Nothing under `~/.hobkin` was read, so what the user's own project shows (nine changes waiting, three broken models) is taken from the user's words, not seen.

## 1. Every rule that can stop a merge

One row per rule. "Can the user change it" means from the YOLO page or anywhere in the window today.

| Rule | Where | Default today | Can the user change it | What it protects |
| --- | --- | --- | --- | --- |
| YOLO mode on | `yolo.mjs:46-49`, `setYolo` `148-158`, pass `yolo-pass.mjs:266-269` | off | yes, the switch on the YOLO page | Nothing merges by itself unless the user said so |
| YOLO mode on this project | `yolo.mjs:63-67`, `setYoloProject` `165-178`, `whyItAsks` `yolo-pass.mjs:75` | off for a project taken on after the first pass; in an old home, as the main switch | yes, the project's switch | One project at a time |
| Project paused | `yolo-pass.mjs:76` | not paused | on Work, not on the YOLO page | Work the user parked |
| Work mode off, paused, usage or subscription pause | `yolo-pass.mjs:271`, `controls.mjs:78-83` | the state of work mode | in Work, not here | The user's quota and hours |
| Readiness never recorded | `yolo.mjs:239-241` | blocks until a readiness run records | only by running readiness | Merging blind |
| Tests part of readiness | `yolo-parts.mjs:26` (the bar), `183-193` | needed | no | A default branch whose tests fail |
| Way back (rollback) part | `yolo-parts.mjs:26`, `183-193` | needed | no | A merge nothing can undo |
| Models part: a model breaks on the default branch | `yolo.mjs:218-236` (broken is `blocks: true`, unproven and unchecked are not), `yolo-parts.mjs:26` | blocks the whole project | no | Merging on top of a rule the models found broken |
| Held after a regression a deploy showed | `holdProject` `yolo.mjs:198-201`, `needsOf` `239-242`, called at `yolo-pass.mjs:157` | lifted only when a new readiness record is written | no | A second bad change after a bad deploy |
| Monitoring, deploy path | `yolo-parts.mjs:19-24`, `yolo.mjs:245-250` | improvements, hold nothing | n/a | n/a |
| Lowest general rate | `LOWEST_RATE 6`, `HIGHEST_RATE 10`, `USUAL_RATE 8` at `yolo.mjs:23-25`, check `43`, `setYolo` `152-153`, test `yolo-pass.mjs:97` | 8, whole number 6 to 10 | yes, one number for every project | The user's bar |
| Floors on the five scores | `classified.mjs:17-19` (`safety` 8, `visibility` 7, `rollback` 7, any other under 5), `57-59`, test `yolo-pass.mjs:96` | as listed | no | Harm an average hides |
| Proof score of 3 at most when a model broke at the change's head | `classified.mjs:21, 66-77` | on | no | A model that shows the change wrong |
| The change's own models must hold at its head | `yolo-pass.mjs:48-52, 93-94` | broken, unproven or unchecked asks | no | A change that breaks a rule a model states |
| A machine it touches has no model | `yolo-pass.mjs:95`, `machines.mjs:62-68`, `askForModel` `yolo-pass.mjs:223-231` | the change is sent back once for a model | no | Changes to state machines nobody proved |
| Kinds that may merge | `classified.mjs:11-13` (`performance`, `bug-fix`, `state-machine`, `package-update`, `small-change`), test `yolo-pass.mjs:90` | those five | no | Features and unplaced changes stay with the user |
| An item filed as a feature | `yolo-pass.mjs:91` | never | no | Same |
| The readiness work's own branches | `READY_KEY` and `PULL_KEY` at `yolo-parts.mjs:17-18`, filed as `feature` (`yolo.mjs:86`, `yolo-parts.mjs:106`) | never merge by themselves, because they are features | no | YOLO mode setting up its own protections |
| Scores are for this commit, or for one whose code the change still has | `yolo-pass.mjs:82-89`, `proofs.mjs:123` | exact head, or only models changed since | no | A rating for code that is gone |
| A review exists | `yolo-pass.mjs:82` ("no review has scored it") | needs one | by getting one | The cause of "no rate yet" (section 2) |
| Item is finished work (`branch` or `pr`) | `yolo-pass.mjs:79` | | n/a | |
| The landing list lets it go | `reads.mjs:401-410`: another branch has it, it is not on its own branch, its run left a note, a grade below safe, the survey did not read its head, no proof, it brings weaker earlier work | as listed | no | Merging what the walk itself would not land |
| Brings earlier branches | `yolo-pass.mjs:81`, `holds` at `reads.mjs:313` and `231` | asks | no | Merging someone else's unreviewed commits |
| A layer of a stack lands after the layer under it | `gapWords` `reads.mjs:385-392` (`stacked`), `patterns.mjs:20-26` | waits | no | Order |
| Its run left a note for the user | `reads.mjs:404` (`row.left && !row.waitsForTheYes`) | asks | no | An agent that said it was not done |
| Size, over 300 changed lines | `patterns.mjs:12, 193`, read through `changeHolds` `205-208`, called at `yolo-pass.mjs:99` | 300 | no | A change too large to trust a score |
| More than two areas (an area is the first two folders of a path) | `patterns.mjs:8, 30-33, 48-57, 192` | 2 | no | Changes that cut across the code |
| Too many files for the survey to list | `patterns.mjs:194` | survey's own list | no | The survey cannot read what it did not list |
| Conflict, or git cannot tell | `patterns.mjs:195` | asks | no | A merge that fails |
| Deletes tests | `patterns.mjs:196` | asks | no | Losing proof |
| Touches a sensitive path (migrations, schema, auth, session, token, secret, credential, password, payment, billing, deploy, kamal, docker files, CI files and more) | `patterns.mjs:7, 189, 197` | asks | no | Changes whose harm a score misses |
| Undo is one-way or permanent | `patterns.mjs:19, 207` | asks | no | Changes nothing can reverse |
| Pull requests merge at all | `PULL_REQUESTS_MERGE = false` `yolo-pulls.mjs:23-29`, test `yolo-pass.mjs:80`, also gates reviews of pull requests `director.mjs:937`, `closing.mjs:78` | off, by a constant | no, only by editing code (a test hook sets it) | Merging through GitHub with the user's own account |
| What the pull request must be on GitHub | `pullSurveyed` `yolo-pulls.mjs:60-73`, `pullHolds` `227-262`: opened by the signed-in user, on the item's own branch, into the default branch, at the scored commit, open, not a draft, mergeable, no changes requested, no approval needed, no merge queue, every check passed, a clean merge state | all required | no | A merge GitHub would block, or one by someone else |
| Required checks cannot be listed | `yolo-pulls.mjs:210-212, 255-260, 338-342` (asks once, then merges on GitHub's clean state alone) | merges on the second pass | no | Required checks that never reported |
| A refused merge is not retried | `askedAlready` `yolo-pulls.mjs:276-277` | once a day | no | Hammering a host that refused |
| One merge a project a pass | `yolo-pass.mjs:275-276, 288` | 1 | no | Each merge moves the base under the next change |
| The deploy after a merge | `deployOf` `yolo-pass.mjs:164-168`, hand off `198-202`, `AFTER_DEPLOY_MINUTES = 30` `deploys.mjs:18` | handed to the main agent when the project has a deploy path | no | Not a rule on whether it merges |

The user can change three of these rows from the YOLO page: the main switch, a project's switch and the lowest rate (and the rate only from 6 up, a limit with no stated reason: the comment at `yolo.mjs:22` says floors already put every passing change above 6 [code]).

How a card says it: `whyItAsks` returns the first reason as a plain sentence (`yolo-pass.mjs:72-100`), so the page matches reasons by their text (`RATE_WHY` in `ui/src/features/work/yolo-page.ts`). No reason carries the name of a setting, because no setting exists for any of them but three.

Section 1 was read from hobkin's working tree, which sits on another session's branch [code]; the line numbers are of that tree on 2026-11-24.

## 2. Where grades come from, and every way a change has none

Three things get called a grade, and only one is the five scores.

| Source | When it runs | What it costs | Where kept | Who reads it |
| --- | --- | --- | --- | --- |
| hobkin's own scored run (`reviewAsked`, then `hobkin work item` with `review`) | by itself only when `reviewOnFinish` is on (default off, `store.mjs:433, 449`) or when YOLO mode is on and the project ready (`yolo.mjs:261-267`); at run end `director.mjs:930-944`, and as a sweep `closing.mjs:69-87`, two a pass (`closing.mjs:16`); on the user's ask `controls.mjs:479-493` | A whole agent run with tools, counted in hobkin's tokens and day budget; it runs `agentic_code_review` twice and up to three skills and commits fixes (`prompts/work-do.md:49`; `_specs/058-review-turns-and-ratings/notes.md` section 10.2) | `item.review` in the work item, written only from the run marked `reviewAsked` (`commands.mjs:335-338, 440`), with the five scores, a kind and the head | YOLO mode (`yolo-pass.mjs:82-97`), the landing rows (`reads.mjs:304`), the window as "hobkin's own" (`host/src/work.ts:336`, `host/src/review/seat.ts:387`) |
| Change Review's ratings (spec 058) | in a repository's line: 3 current, 20 background a day, 48 hours before the longest wait is taken (`host/src/review/turns.ts:49-53`); the user's own Review now outside the line | One Reviewer call at high thinking, prompt up to 100,000 characters (about 25,000 tokens), and one fast checker (`_specs/058-review-turns-and-ratings/notes.md` section 3) | `needs` inside the review's `graph.json` (`host/src/review/assessment.ts:1030-1039`), checked and capped by `packages/change-review/src/needs.ts` | The review panel, its row in AI Reviews, the YOLO page's rows named as the review's (`ui/src/features/work/yolo-page.ts:432`). Not YOLO mode |
| The safety grade (an A to F merge grade from pi-auto-review) and `quality` | pi-auto-review's own files (`grades.mjs`), and what the scored run writes | none of its own | `item.quality`, files under pi's auto-review folder | The landing walk (`reads.mjs:381`, `heldByItsGrade`), not the five scores |
| hobkin's own TLA+ runs at the head | after each survey, one at a time (`proof-checks.mjs:110-120`), and weekly on the default branch (`126-140`) | A local TLC run | `proofs/<id>/result.json` | They replace the proof score's evidence and cap it at 3 when a model broke (`classified.mjs:66-77`) |

Why the AI review's grades do not count in YOLO mode, today [code]: nothing carries them to the runtime. The host never calls `updateItem` on a work item (a search of `host/src` finds the call only in a type file, `hobkin-issues.d.ts:38`). The runtime reads `item.review`, which only the scored run writes. The YOLO page's own words say it: "YOLO mode goes by hobkin's own scored run, not this one" and "not scored by hobkin" (`yolo-page.ts:432, 464`), and spec 058 left this as the user's call (its open questions).

Every way a change ends with no grades [code unless marked]:

1. Scoring is off. `reviewOnFinish` is false by default, and a project not ready or off for YOLO mode gets no scored run either, because `reviewsByItself` needs one or the other (`yolo.mjs:267`). A project that is not ready therefore never gets scored, and so never becomes ready by merging its own fixes (section 3).
2. A change on its own pull request: no scored run unless `PULL_REQUESTS_MERGE` is on (`director.mjs:937`, `closing.mjs:78`), and it is off.
3. The run ended and did not send `review`. The scored run may leave `review` out; nothing asks again. Once a review was asked for a commit it is not asked again until the branch moves (`closing.mjs:55`, comment at `closing.mjs:41-45`).
4. An answer that "gave none": a malformed score is dropped and the review finishes "not rated" (`packages/change-review/src/model.ts:742-766`, `needs.ts:105-117`). Nothing asks the Reviewer again.
5. Visibility is dropped when nothing is known of the project's monitoring (`needs.ts:109-114`), and the general rate needs all five (`host/src/review/ratings.ts:29-33`). A project with no readiness record has no rate on any review. [code]
6. A review waiting its turn has no graph, so no ratings: only three reviews are current for a repository (`turns.ts:49`), 20 a day in the background. Nine waiting changes of one repository means six without a review at first. [inferred from the spec's numbers]
7. A review built before ratings existed has a `graph.json` with no `needs`, so `engineNeeds` returns nothing (`ratings.ts:36-40`). It stays unrated until rebuilt. [code]
8. Scores for an older commit: `scoresHoldAt` accepts the exact head, or a commit whose code the head still has (`proofs.mjs:123`, `sameCodeAs` `proofs.mjs:112-117`). Anything else reads "its scores are for an older commit" (`yolo-pass.mjs:88`). A scored run that fixes things moves the head, so the Change Review built for the old head is outdated, and a pull request is at a commit its review did not read (`yolo-pass.mjs:86-87`).
9. Finished work whose run left a note is never prepared by itself: the host filters the `left` group out (`host/src/work-items.ts:217-219`). [code]
10. A pull request that is not a work item: only the three `reviewPulls` choices start a review (`host/src/review/seat.ts:605-640`), default `none` (`store.mjs:450`). Such a pull request is not in YOLO mode's reach at all, since only hobkin's own items merge (`yolo-pulls.mjs:61, 231`). [code]
11. A branch that only edits Markdown has nothing to rate: `changesOnlyDocs` (`director.mjs:952`, `closing.mjs:51`). This is fine for YOLO (nothing to score), but the rule "always" has to say so.
12. Work mode off: no review starts by itself (`director.mjs:949`, `closing.mjs:72`).

What the YOLO page does with that: a change with no scores reads "no rate yet" and "no review yet" (`ui/src/features/work/yolo-page.ts:459-464, 594`), which is the sentence the user objected to.

## 3. The circle: a change that fixes a broken model

Facts [code]:

- The models part reads the latest run of each spec as the default branch has it, with no item, keyed by the spec's own hash (`proofs.mjs:190-194` `latestMainRun`, `mainFacts`; `yolo.mjs:204-207`). A broken run gives `blocks: true` (`yolo.mjs:226`).
- `blocks` makes `needs` non-empty (`yolo.mjs:239-243`) and `readinessOf(...).ready` false (`yolo.mjs:257`). Then `whyItAsks` returns "its project is not ready for YOLO mode" for every change on the project, before it looks at the change (`yolo-pass.mjs:77`). The change's own model checks (`yolo-pass.mjs:93-94`) are reached only after that line, so a change whose model holds at its head is never weighed.
- A project that is not ready also gets no scored run (`yolo.mjs:261-267`), so the fix has no scores either.
- The way out today is that the user merges the fix on their own yes. The default branch then holds the fix, but the models part reads the last run on the default branch. `recheckModels` skips a spec whose last main run is under a week old (`proof-checks.mjs:133`), and the last run is the broken one. A fix that changes only code, and not the `.tla` file, keeps the same spec hash, so its old broken run is still "the latest" for up to seven days. A fix that edits the spec gets a new hash and is checked as soon as it reaches the default branch ("as soon as a spec reaches the default branch with no run of it", `proof-checks.mjs:122-125`). [inferred from those lines, not run]

Answer: no. A change that makes a broken model hold can never merge by itself on that project while the model breaks on the default branch, because the project is held before the change is read. It can merge only after the user merges it by hand, and then, if it fixed code only, after up to a week or a later survey that rechecks it.

What would let it, smallest first:
1. A switch the user controls (spec 063): when on, a broken model on the default branch holds a change only if it does not make that model hold. The check is per change: every spec that breaks on the default branch must be covered by the change (`unit.models`) and hold at its head (`changeModels`, `proofs.mjs:184`). That reuses the models each change already carries.
2. A recheck right after a merge into the default branch of a spec that was broken, so the project does not wait a week.
3. Scores for the fix, from the same rule as every other change (grades always), so it is not stuck at "no review" while the project is not ready.

## 4. What I could not verify

- The user's real project: whether its readiness record exists, which three models break, and why nine changes wait. Not read, by rule.
- That the tests part is true on the default branch right now: it is a claim a readiness agent recorded (`partOf`, `yolo-parts.mjs:66-77`), and nothing runs the tests again when a change merges. [inferred]
- How many tokens a Change Review costs on the user's repositories: spec 058 records usage since its S3, but no home was read. The 25,000 tokens a prompt is the code's own estimate (`PROMPT_LIMIT` at `packages/change-review/src/model.ts:68`, as quoted in spec 058's notes).
- That the narrow "ratings only" re-ask costs less than a whole review: it is a design choice, not measured. [inferred]
