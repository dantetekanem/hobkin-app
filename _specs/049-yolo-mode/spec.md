---
{
  "id": "049-yolo-mode",
  "title": "Classified reviews and YOLO mode",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "020-settings", "032-change-review"],
  "updated": "2026-11-21"
}
---
# Classified reviews and YOLO mode

## Outcome

Every review hobkin runs on a finished change, on any project, scores it from 1 to 10 on five questions, each with one line of evidence, and says what kind of change it is. hobkin works out one general rate from those scores, and the change's card shows all of it. YOLO mode is a setting, off until the user turns it on in Settings, with the lowest general rate they accept (8 unless they pick another). Turning it on merges nothing. Its first job on each project is to get that project ready, and readiness does that work instead of reporting on it: it sets up tests that can cover a change, monitoring a regression would show up in (error tracking, slow query detection, performance metrics with a baseline, searchable logs, and alerts that reach the user), a way back, and a deploy path hobkin can run and undo. Each part it builds goes on a branch of its own that hobkin opens as a pull request for the user's merge, and each step only the user can take becomes one Action Item. A project is ready once its tests pass on the default branch, its way back is known and no TLA+ model there breaks. The other parts are improvements that are shown and worked on, and they never hold a project back. Once a project is ready, a small change there that a review rated at or above the user's rate merges and deploys by itself, and hobkin reports what it did and what the monitoring showed afterwards. Features, anything unclear, and every change on a project that is not ready keep asking the user, as today. With YOLO mode off, nothing about merging changes.

## Decisions

### The user's words

- 2026-11-19: "we need to have review classified. tests cover the change 100%? 1/10 grade. were the tests modified to prove this works? what else needed? does this risk deployment or data? is data integrity safe? is there metrics and visibility to cover this? what is the risk and time to rollback? can we have a feature flag system? all this in a prompt for new/existent projects, which should collect points and have a system to allow self-merge/deploy. which will only report. by default this will be off, but if i turn on, i can select (general rate 8 or more will continue). and the system will just work. will mainly focus in performance work, bug finds, implicit state machines, package updates, small things. features, etc, will still need review, a spec and a plan."
- Later the same day: the setting is named YOLO mode, and "YOLO mode will not just start, but make the environment ready for YOLO as a first task if activated".
- And again: "thinks like slow queries, etc, visibility for it, monitoring. all this should be there - just saying again".
- 2026-11-20: "eligibility on YOLO is too high, rpsleague should be ready already". Then: "this is useless, it should prepare the environment, open all the necessary PRs, never to keep saying 'not ready yet'. This state 'not ready yet' is completely useless for what hobkin should do."

### The scores

- The review is the one work mode already runs on a finished branch: the run marked `work.item.reviewAsked`, step 8 of `hobkin/src/prompts/work-do.md`. That prompt reaches every project, new or old, so the scores need nothing set up in a project.
- The review records `review` with its outcome: a `kind`, five `scores`, and `head`, the commit it read.

  | Score | The question | 10 means |
  | --- | --- | --- |
  | `coverage` | Do tests cover the change? | Every changed line and branch runs in a test that fails without the change. |
  | `proof` | Were tests added or changed to prove this works, and what proof is still missing? | A test written or changed for this change shows it working, and nothing is missing. |
  | `safety` | Does it risk the deployment or data? Is data integrity safe? | It cannot break a deploy and touches no stored data. |
  | `visibility` | Would a regression from this change show in the project's monitoring, and how fast: an error, a slower query, a slower endpoint or job? | Its errors are tracked, its queries are timed, its endpoint or job has a metric with a baseline, and an alert reaches the user within minutes. |
  | `rollback` | What is the risk and the time to roll back? Does a feature flag guard it, or should one? | One step undoes it in minutes and leaves nothing behind. |

- Each score is a whole number from 1 to 10 with one line of evidence. The review also says in `missing` what proof it still wants, when it wants any.
- For `visibility` the review names the monitoring that covers the changed path. A change that touches a query or a hot path with none on it scores 4 or less, however good its tests are.
- `kind` is one of `performance`, `bug-fix`, `state-machine`, `package-update`, `small-change`, `feature` or `unclear`. A review that cannot tell says `unclear`.
- hobkin keeps scores only from a run it started as that item's review, and refuses scores that are malformed. An author's own run cannot grade its change.
- The scores belong to one commit. On a card, scores for an older commit say so. A review's level, in Change Review, still means only the risk of breaking code or production. The scores sit beside it and never change it.

### The general rate

- The general rate is the average of the five scores, cut to one decimal and never rounded up, so 7.96 reads 7.9.
- Four floors hold a change whatever its average: `safety` under 8, `visibility` under 7, `rollback` under 7, or any score under 5. A deploy or data risk is the harm an average hides, a regression the monitoring would not show goes unseen, a change that is slow to undo needs a person, and a score of 4 or less means the review found that part missing.
- hobkin works the rate out in code from the recorded scores. A run never sends a rate.
- The lowest rate the user can pick is 6, because the floors already put every change that passes them at 6.4 or more. The most is 10, and it starts at 8.

### Getting a project ready

- A project's readiness has nine parts. `tests`: a suite that runs on the default branch and can cover a change. Five of monitoring: `errors` (exceptions reach an error tracker, and a new one raises an alert), `slowQueries` (the database's slow query log or the framework's query timing, with N+1 detection where the stack has it), `performance` (request and job timings kept, with a baseline), `logs` (logs that can be searched) and `alerts` (an alert reaches the user). `rollback`: the way back, and a flag mechanism where one makes sense. `deploy`: a deploy path hobkin can run and undo, or the fact that nothing deploys. `models`: hobkin works this one out from the state machines look and its own runs of the TLA+ specs on the default branch.
- The bar: YOLO mode may merge by itself on a project once `tests` and `rollback` are done on the default branch and no model there breaks. A regression after a deploy still holds the project until its readiness is checked again. Everything else is an improvement: monitoring, the deploy path, a model nobody has checked on the default branch yet, a model that did not hold, and a state machines look that has not run. Improvements are shown and worked on, and they never hold the project back. The review's own floors still hold each change, so a change whose regression the monitoring would not show (`visibility` under 7) keeps asking whatever the project's readiness says.
- Each part is in one of five states: done, in a PR for the user's merge, waiting on the user, in progress, or to do. A part is done when it is in place on the default branch, when it does not apply (a monitoring part only, with the reason), or when the PR that set it up has merged. "To do" is left only for what a record from before this change found missing, a PR the user said no to, and a model that did not hold.
- When YOLO mode is turned on, and again after each survey while it is on, hobkin files one item on each chosen project that has none: "Get <project> ready for YOLO mode", kind `feature`. The user can also run it on one project from the YOLO page with YOLO mode off.
- That item's run checks each part by running it. A part in place is recorded with how it works. A part that is not in place is built on a branch of its own from the default branch, made in a worktree so the run never leaves its own branch, with small related parts sharing one branch, and recorded with that branch, how it sets the part up and its proof. A part that needs something only the user can give, such as a secret, an account, a sign-up or a step that runs only in production, is recorded with one step: a title and exactly what to do, such as which variable goes where or which command to run. A part can have a branch and a step at once. The run records every part with `hobkin work yolo <project>`, and hobkin refuses a part that only says what is missing. The run leaves its own branch empty and ends done.
- For each branch, hobkin files finished work of its own, kind `feature`, titled "YOLO readiness: <the parts>", and writes its description from the parts' lines. It pushes the branch and opens its PR the way the user's Open PR does (`publishItem`), at once when the run records and again after the owner's next survey if that first try failed. After a try from the survey, a branch whose PR will not open waits on its card for the user's yes and says why. Nothing merges by itself, and the PR is the user's to merge.
- For each step, hobkin files one Action Item, and the parts that wait on the same step share it. Once the user marks it done, the part waits on its PR if it has one, and otherwise it is in progress until the next check confirms it. The run carries on with the other parts while the step waits.
- The readiness work's own branch is offered as a PR too. A readiness run from before this change built parts on that branch, as rpsleague's did, and recorded them as in place. While that branch waits for the user's yes, those parts count as in its PR, and merging it is the user's one yes that makes them count.
- Work status carries each project's readiness: whether it is ready, what holds it back in a line each, and every part with its state, its line, its PR and its Action Item. The YOLO page lists the parts in two groups, what YOLO mode needs and the improvements. It never says a project is "not ready": a project is ready, getting ready (with what holds it back), running, queued, waiting for the user's yes, or not started.

### What merges by itself

- Only the pass after the director's own survey merges anything, and it returns at once while YOLO mode is off. No `hobkin work` command and no agent tool runs it.
- A change merges by itself only when all of this holds: YOLO mode is on; work mode is on and not paused; its project is ready and not paused; it is a finished local branch that `hobkin work ready` lists as landable; it brings no earlier branch with it; its scores are for the exact commit the survey read; its kind is one of the five small kinds and its item was not filed as a feature; no floor is broken; its rate is at or above the user's; and it passes the change rules a land offer uses (`changeVetoes` in `hobkin/src/cli/work/patterns.mjs`: at most 300 lines, one or two areas, no deleted tests, nothing sensitive, an undo that is not one-way).
- The merge is hobkin's own `mergeItem`, pinned to the scored commit, so a branch that moved since is refused there too. It records route `yolo`. At most one change merges on a project in a pass.
- With YOLO mode on, a finished branch on a ready project gets its review by itself, as `hobkin work reviews on` gives every branch one. Without that the setting would do nothing.

### Deploying and reporting

- hobkin's code never deploys. After a merge by itself on a project whose readiness names a deploy path, hobkin hands the main agent one job for that project: deploy exactly that commit by the recorded path, in one session, prove it live, and report. This is the hand-off a card uses when work mode cannot start work.
- The user's own directions still win. Until their "Merging and deploying take a yes on a list" section says YOLO mode covers these deploys, the main agent asks first, as that section tells it to.
- Each merge by itself is one line in Chat and one line in `work/yolo.jsonl` in hobkin's home: when, project, item, title, commit, kind, rate, scores, and whether a deploy was handed on.
- The deploy job also says to watch the project's monitoring for 30 minutes after the deploy and record what it showed with `hobkin work yolo <project> <item>`: errors, slow queries, and latency against the baseline, each as regressed or not with one line. hobkin keeps it only for a change YOLO mode merged, writes it to the ledger and says it in Chat. A reading with no regression has to cover the whole 30 minutes.
- A regression is recorded the moment it shows. hobkin says it in Chat as critical, records trouble on that change so its fix is filed at the front of the queue, and stops merging by itself on that project until its readiness work is retried. Nothing is rolled back by itself.
- 2026-11-21, the user: "i need yolo mode reports "It is ready", the plan, what will merge, at what level, etc." and "and which work was deployed as well, grouped". While YOLO mode is on, hobkin keeps one report on each project in Reports, listed as that project's `yolo` work (`work.<project>.yolo`). It opens with "<project> is ready for YOLO mode", or "is getting ready" with what holds it and where its readiness work stands. Then the plan: the user's rate and the small kinds, one merge a project a pass, the deploy path and the 30 minutes of monitoring, a regression stopping merges, and what still asks the user. Then what will merge: each finished branch waiting with its kind and rate against the user's rate, and for the rest the reason `whyItAsks` gives. On a project still getting ready that is what each change would meet once it is ready. Last, what merged by itself, by day, newest first, each with its commit and its deploy: with the main agent, nothing deploys, no deploy path, or what the monitoring showed. The owner writes it after each pass and `hobkin work yolo <project> <item>` after a deploy's reading, only when its words changed. Each new version gets a new id, so it reads as unread and gets its own short version, and the version it replaces goes. The YOLO page has a Report button on each project that has one.

### Turning it on

- Only the window changes YOLO mode. The command `work.yolo` is marked `outside`, so hobkin's `client` tool refuses it, and no `hobkin work` command changes it. The host calls the runtime's `setYolo` itself, as `work.agents` calls `setAgents`.
- Settings has a YOLO mode tile under AI reviews: the switch, the lowest rate from 6 to 10, how many projects are ready, and what each of the others still needs.

## Out of scope

- Merging a PR by itself. PRs keep the user's yes, and `043-merges-and-deploys` holds the rules for when GitHub is ready.
- Changing the land-offer bar, Change Review's levels, or how a card's "Review again" works.
- A deploy run by hobkin's code, and a rollback by itself.
- Expiring a project's readiness. The user asks for a new check by retrying the readiness item.
- Starting a readiness check by itself to confirm a step the user marked done, or to redo a part a record from before this change found missing. The user presses Check again.
- Scores computed by Change Review from its own facts.

## Acceptance

- A1. A review's scores are kept only when all five are whole numbers from 1 to 10 with a line of evidence, the kind is one of the seven, and the commit is named. Anything else is refused with the reason, and so are scores from a run that is not the item's review.
- A2. The general rate is the average cut to one decimal. A change with `safety` under 8, `rollback` under 7 or any score under 5 is held whatever its average.
- A3. A finished change's row carries its kind, scores, rate and broken floors, and says when they are for an older commit. The card in the window shows them in one line.
- A4. YOLO mode is off in a new home. With it off, a change that would pass every rule does not merge by itself.
- A5. Turning YOLO mode on merges nothing and files one readiness item, kind `feature`, on each chosen project. A project is ready once its tests and rollback are done on the default branch and no model there breaks, and no regression holds it. Monitoring, the deploy path and models not checked yet never hold it back.
- A6. A change on a project that is not ready never merges by itself, even at rate 10.
- A7. On a ready project, a small change scored at or above the user's rate at the surveyed commit, with no floor broken, merges locally by itself with route `yolo`.
- A8. Scores for an older commit never count: a branch that moved after its review does not merge by itself.
- A9. A change classified `feature` or `unclear`, or whose item is a feature, never merges by itself, whatever its rate.
- A10. Every merge by itself leaves one line in Chat and one in `work/yolo.jsonl`, and hands the main agent a deploy job when the project's readiness names a deploy path.
- A11. Only the window turns YOLO mode on or off or sets its rate. hobkin's `client` tool refuses `work.yolo`, no `hobkin work` command changes it, and a rate outside 6 to 10 is refused.
- A12. The YOLO page shows YOLO mode's switch and rate, how many projects are ready, what holds each of the others back, and each project's parts in two groups, each with its state in words and its PR link, Action Item or card. It never says "not ready". With no host it shows sample data.
- A13. With YOLO mode on, a finished branch on a ready project gets its review by itself, and one on a project that is not ready does not.
- A14. A readiness record says every part: in place, not applicable with a reason (monitoring only), on a branch with how and proof, or with one step for the user. A record that leaves a part out, or says it is only missing, is refused and files nothing. A ready project with no deploy path merges a change by itself and deploys nothing.
- A15. A change whose `visibility` is under 7 never merges by itself, whatever its average.
- A16. After a deploy of a change YOLO mode merged, what the monitoring showed for errors, slow queries and latency over 30 minutes is written to the ledger and said in Chat. A regression is said as critical at once, its fix is filed, and the project stops merging by itself until its readiness is checked again.
- A17. Each branch a readiness run records becomes one feature item with a description, pushed and opened as a PR by hobkin, and parts on the same branch share that PR. Each step only the user can take becomes one Action Item, shared by the parts that wait on it. Each part then reads as done, in a PR (with its link), waiting on the user (with the Action Item), in progress, or to do.
- A18. A branch whose PR does not open from the readiness run waits on its card and says why, and the owner's next survey tries once more. The readiness work's own branch, waiting for the user's yes, is opened as a PR by the owner's survey.
- A19. rpsleague's record (tests, slow queries, performance, logs and rollback in place on its readiness branch; error tracking, alerts and deploy missing; its state machines look never finished) keeps that branch's parts in its PR until the user merges it, and then the project is ready, with error tracking, alerts, deploy and models shown as improvements.
- A20. With YOLO mode on, Reports holds one report on each project, listed as `work.<project>.yolo`. It says the project is ready, or what holds it and what hobkin is doing about it, and never "not ready". It gives the plan, each change waiting with its kind and rate against the user's rate and why the others ask, and what merged by itself grouped by day with its deploy and what the monitoring showed. It is written after the owner's pass and after a deploy's reading, never twice with the same words, and a new version replaces the last. With YOLO mode off none is written. The YOLO page opens a project's report.

## Proof

- A1. `hobkin/test/cli-work-classified.test.mjs` › "a review's scores are kept only when they are whole, evidenced and pinned to a commit" and › "only the item's review run records scores"
- A2. `hobkin/test/cli-work-classified.test.mjs` › "the general rate is the average cut to one decimal, and a floor holds a change whatever its average"
- A3. `hobkin/test/cli-work-classified.test.mjs` › "a finished row carries its scores and says when they are for an older commit"; `host/test/work-yolo.test.ts` › "a finished change's card says its kind, rate and scores"
- A4. `hobkin/test/cli-work-yolo.test.mjs` › "with YOLO mode off nothing merges by itself" and › "the director runs the pass after its own survey, and hands the deploy on"
- A5. `hobkin/test/cli-work-yolo.test.mjs` › "turning it on files a readiness feature on each project and merges nothing" and › "YOLO mode may run once tests and rollback are in place on the default branch and no model there is broken, and the other parts are improvements"
- A6. `hobkin/test/cli-work-yolo.test.mjs` › "a project that is not ready never merges by itself, even at rate 10"
- A7. `hobkin/test/cli-work-yolo.test.mjs` › "on a ready project a small change at the user's rate merges by itself at its scored commit"
- A8. `hobkin/test/cli-work-yolo.test.mjs` › "scores for an older commit never count"
- A9. `hobkin/test/cli-work-yolo.test.mjs` › "a feature or an unclear change never merges by itself"
- A10. `hobkin/test/cli-work-yolo.test.mjs` › "each merge by itself is reported in Chat and in the ledger, and its deploy is handed on"
- A11. `host/test/work-yolo.test.ts` › "only the window changes YOLO mode"; `hobkin/test/cli-work-yolo.test.mjs` › "no hobkin work command changes YOLO mode, and a rate outside 6 to 10 is refused"
- A12. `ui/test/settings-yolo.test.ts` › "the tile says how many projects are ready and what the others need"; `ui/test/work-yolo-page.test.ts` › "a ready project says what is still being set up, and each part says where it stands with its PR or its Action Item"; check: the page in the window, on and off, dark and light. Not done yet.
- A13. `hobkin/test/cli-work-yolo.test.mjs` › "with YOLO mode on, a finished branch on a ready project gets its review by itself"
- A14. `hobkin/test/cli-work-yolo.test.mjs` › "monitoring and a deploy path still being set up hold no change back, and with no deploy path nothing is deployed" and › "each part a readiness run set up goes in a PR hobkin opens, and each step only the user can take is one action item"
- A15. `hobkin/test/cli-work-yolo.test.mjs` › "a change whose regression would not show in the monitoring never merges by itself"
- A16. `hobkin/test/cli-work-yolo.test.mjs` › "after a deploy the report says what the monitoring showed, and a regression is a problem at once"
- A17. `hobkin/test/cli-work-yolo.test.mjs` › "each part a readiness run set up goes in a PR hobkin opens, and each step only the user can take is one action item"
- A18. `hobkin/test/cli-work-yolo.test.mjs` › "a part whose PR cannot open from the readiness run waits on its branch and says why, and the owner's survey tries once more" and › "rpsleague's record: its readiness branch is offered as a PR on its own, and YOLO mode may run there once that merges"
- A19. `hobkin/test/cli-work-yolo.test.mjs` › "rpsleague's record: its readiness branch is offered as a PR on its own, and YOLO mode may run there once that merges"
- A20. `hobkin/test/cli-work-yolo.test.mjs` › "YOLO mode keeps a report on each project: whether it is ready, the plan, what will merge at what rate, and what merged and deployed by day", › "Reports lists each project's YOLO report as that project's work" and › "the director runs the pass after its own survey, and hands the deploy on"; `ui/test/work-yolo-page.test.ts` › "a project's YOLO report is the one hobkin lists as that project's yolo work". Not seen in the window yet.

## Steps

- [x] S1 (A1, A2). Runtime: the scores, the rate and the floors as a pure module, and `hobkin work item` keeping a review's scores. Files: new `hobkin/src/cli/work/classified.mjs`, `hobkin/src/cli/work/commands.mjs`; tests new `hobkin/test/cli-work-classified.test.mjs`.
- [x] S2 (A3). Runtime: the review prompt asks for the scores, and a finished row carries them. Files: `hobkin/src/prompts/work-do.md`, `hobkin/src/cli/work/reads.mjs`.
- [x] S3 (A4, A5, A11). Runtime: the setting and each project's readiness. Files: new `hobkin/src/cli/work/yolo.mjs`, `hobkin/src/cli/work/commands.mjs`, `hobkin/src/prompts/work-do.md`; tests new `hobkin/test/cli-work-yolo.test.mjs`.
- [x] S4 (A4, A6, A7, A8, A9, A10, A13). Runtime: the pass that merges, its report and the deploy hand-off, wired in after the survey, and reviews by themselves on a ready project. Files: new `hobkin/src/cli/work/yolo-pass.mjs`, `hobkin/src/cli/work/yolo.mjs`, `hobkin/src/cli/work/patterns.mjs`, `hobkin/src/cli/work/closing.mjs`, `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/application.mjs`, `hobkin/src/prompts/v2-runtime.md`.
- [x] S5 (A3, A11). Host: the protocol, the `work.yolo` command and the card's line. Files: `shared/protocol/work.ts`, `shared/commands/registry.ts`, `host/src/work.ts`, `host/src/hobkin-work.d.ts`; tests new `host/test/work-yolo.test.ts`.
- [x] S6 (A12). Window: the YOLO mode tile in Settings and the scores on a finished card. Files: new `ui/src/features/settings/YoloTile.tsx`, new `ui/src/features/settings/yolo.ts`, `ui/src/features/settings/SettingsScreen.tsx`, `ui/src/features/work/Finished.tsx`; tests new `ui/test/settings-yolo.test.ts`.
- [x] S8 (A14, A15, A16). Runtime: monitoring in a project's readiness, the visibility floor, and the report after a deploy. Files: `hobkin/src/cli/work/yolo.mjs`, `hobkin/src/cli/work/yolo-pass.mjs`, `hobkin/src/cli/work/classified.mjs`, `hobkin/src/cli/work/commands.mjs`, `hobkin/src/prompts/work-do.md`, `hobkin/src/prompts/v2-runtime.md`; tests `hobkin/test/cli-work-yolo.test.mjs`, `hobkin/test/cli-work-classified.test.mjs`.
- [x] S9 (A5, A12, A14, A17, A18, A19). Runtime and window: the new bar, the five part states, a PR for each readiness branch and an Action Item for each user step, the readiness prompt, and the parts on the YOLO page. Files: new `hobkin/src/cli/work/yolo-parts.mjs`, `hobkin/src/cli/work/{yolo,yolo-pass,commands,director}.mjs`, `hobkin/src/cli/answer.mjs`, `hobkin/src/prompts/{work-do,v2-runtime}.md`, `shared/protocol/work.ts`, `ui/src/features/work/{yolo-page.ts,YoloScreen.tsx}`, `ui/src/features/settings/yolo.ts`, `ui/src/features/home/model.ts`. Not seen live yet: a real readiness run opening PRs, and the page in the window.
- [x] S10 (A20). Runtime and window: YOLO mode's report on each project, written after the pass and a deploy's reading, listed in Reports, and the Report button on the YOLO page. Files: new `hobkin/src/cli/work/yolo-report.mjs`, `hobkin/src/cli/work/{yolo-pass,director,commands}.mjs`, `hobkin/src/cli/{application,reports}.mjs`, `ui/src/features/work/{yolo-page.ts,YoloScreen.tsx}`; tests `hobkin/test/cli-work-yolo.test.mjs`, `ui/test/work-yolo-page.test.ts`. Not seen live yet.
- [ ] S7 (A7, A10, A12). What the tests above do not reach. A test that a deploy job the director hands on reaches the main agent as its next wake (`onHandOff` in `hobkin/src/cli/application.mjs`). A look at the tile in the window. Then, with the user's go-ahead, YOLO mode on in the live home and one project taken through its readiness.

## Open questions

- Who grades. (a) As decided: the review run scores the change, and code holds the floors, the kinds and the change rules. (b) Also need Change Review to say "Safe to deploy" at the same commit: two reviews agree before a merge, and nothing merges on a Mac where the host has not finished its review.
- Home. Work status carries the count of ready projects and what each needs, and Settings shows both. Showing them on Home's Projects widget is not built yet.
- The user's directions. Their "Merging and deploying take a yes on a list" section still says never to deploy automatically, so a deploy handed on by YOLO mode is asked about first until they change it. (a) Leave it to them. (b) Offer the new wording as an Action Item when YOLO mode is first turned on.
- Reading the monitoring. (a) As decided: the deploy's session reads it and says whether each part regressed, and code checks only the shape and the window. (b) hobkin reads the numbers itself with a command the readiness run recorded, and compares them with the baseline in code: no session's word is needed, and each project needs a read hobkin can run.
- A readiness that goes stale. (a) As decided: it stands until the user retries the item. (b) Check again every 30 days, as a signals look does.
- A broken model on the default branch holds the project back, and nothing files its fix. (a) As decided: the page says which model breaks. (b) File the fix as urgent work, as a regression after a deploy does.
