---
{
  "id": "049-yolo-mode",
  "title": "Classified reviews and YOLO mode",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "020-settings", "032-change-review"],
  "updated": "2026-11-19"
}
---
# Classified reviews and YOLO mode

## Outcome

Every review hobkin runs on a finished change, on any project, scores it from 1 to 10 on five questions, each with one line of evidence, and says what kind of change it is. hobkin works out one general rate from those scores, and the change's card shows all of it. YOLO mode is a setting, off until the user turns it on in Settings, with the lowest general rate they accept (8 unless they pick another). Turning it on merges nothing. Its first job on each project is to get that project ready: tests that can cover a change, a way to see a failure, a way back, and a deploy path hobkin can run and undo. That work is filed as a feature and lands on the user's yes like any other. Once a project is ready, a small change there that a review rated at or above the user's rate merges and deploys by itself, and hobkin reports what it did. Features, anything unclear, and every change on a project that is not ready keep asking the user, as today. With YOLO mode off, nothing about merging changes.

## Decisions

### The user's words

- 2026-11-19: "we need to have review classified. tests cover the change 100%? 1/10 grade. were the tests modified to prove this works? what else needed? does this risk deployment or data? is data integrity safe? is there metrics and visibility to cover this? what is the risk and time to rollback? can we have a feature flag system? all this in a prompt for new/existent projects, which should collect points and have a system to allow self-merge/deploy. which will only report. by default this will be off, but if i turn on, i can select (general rate 8 or more will continue). and the system will just work. will mainly focus in performance work, bug finds, implicit state machines, package updates, small things. features, etc, will still need review, a spec and a plan."
- Later the same day: the setting is named YOLO mode, and "YOLO mode will not just start, but make the environment ready for YOLO as a first task if activated".

### The scores

- The review is the one work mode already runs on a finished branch: the run marked `work.item.reviewAsked`, step 8 of `hobkin/src/prompts/work-do.md`. That prompt reaches every project, new or old, so the scores need nothing set up in a project.
- The review records `review` with its outcome: a `kind`, five `scores`, and `head`, the commit it read.

  | Score | The question | 10 means |
  | --- | --- | --- |
  | `coverage` | Do tests cover the change? | Every changed line and branch runs in a test that fails without the change. |
  | `proof` | Were tests added or changed to prove this works, and what proof is still missing? | A test written or changed for this change shows it working, and nothing is missing. |
  | `safety` | Does it risk the deployment or data? Is data integrity safe? | It cannot break a deploy and touches no stored data. |
  | `visibility` | Do metrics and visibility cover it? | A failure would show by itself, in a failing check, an error report, a log or a metric on its path. |
  | `rollback` | What is the risk and the time to roll back? Does a feature flag guard it, or should one? | One step undoes it in minutes and leaves nothing behind. |

- Each score is a whole number from 1 to 10 with one line of evidence. The review also says in `missing` what proof it still wants, when it wants any.
- `kind` is one of `performance`, `bug-fix`, `state-machine`, `package-update`, `small-change`, `feature` or `unclear`. A review that cannot tell says `unclear`.
- hobkin keeps scores only from a run it started as that item's review, and refuses scores that are malformed. An author's own run cannot grade its change.
- The scores belong to one commit. On a card, scores for an older commit say so. A review's level, in Change Review, still means only the risk of breaking code or production. The scores sit beside it and never change it.

### The general rate

- The general rate is the average of the five scores, cut to one decimal and never rounded up, so 7.96 reads 7.9.
- Three floors hold a change whatever its average: `safety` under 8, `rollback` under 7, or any score under 5. A deploy or data risk is the harm an average hides, a change that is slow to undo needs a person, and a score of 4 or less means the review found that part missing.
- hobkin works the rate out in code from the recorded scores. A run never sends a rate.
- The lowest rate the user can pick is 6, because the floors already put every change that passes them at 6.0 or more. The most is 10, and it starts at 8.

### Getting a project ready

- A project's readiness has four parts: `tests` (a suite that runs and can cover a change), `visibility` (how a failure after a change shows), `rollback` (the way back, and a flag mechanism where one makes sense) and `deploy` (a deploy path hobkin can run and undo, or the fact that nothing deploys).
- When YOLO mode is turned on, and again after each survey while it is on, hobkin files one item on each chosen project that has none: "Get <project> ready for YOLO mode", kind `feature`. It runs through the queue like any feature, builds what is missing on a branch, and waits for the user's yes.
- That item's run records what it found with `hobkin work yolo <project>`: for each part, either how it works (`how`) or what is missing (`missing`). hobkin keeps the record only from that item's run.
- A project is ready when all four parts are in place and its readiness item is merged, or done with no change needed. Work that still waits for the user's yes does not count.
- Work status carries each project's readiness and what it still needs, and the count of ready projects, so Settings and Home can say "3 of 5 projects ready".

### What merges by itself

- Only the pass after the director's own survey merges anything, and it returns at once while YOLO mode is off. No `hobkin work` command and no agent tool runs it.
- A change merges by itself only when all of this holds: YOLO mode is on; work mode is on and not paused; its project is ready and not paused; it is a finished local branch that `hobkin work ready` lists as landable; it brings no earlier branch with it; its scores are for the exact commit the survey read; its kind is one of the five small kinds and its item was not filed as a feature; no floor is broken; its rate is at or above the user's; and it passes the change rules a land offer uses (`changeVetoes` in `hobkin/src/cli/work/patterns.mjs`: at most 300 lines, one or two areas, no deleted tests, nothing sensitive, an undo that is not one-way).
- The merge is hobkin's own `mergeItem`, pinned to the scored commit, so a branch that moved since is refused there too. It records route `yolo`. At most one change merges on a project in a pass.
- With YOLO mode on, a finished branch on a ready project gets its review by itself, as `hobkin work reviews on` gives every branch one. Without that the setting would do nothing.

### Deploying and reporting

- hobkin's code never deploys. After a merge by itself on a project whose readiness names a deploy path, hobkin hands the main agent one job for that project: deploy exactly that commit by the recorded path, in one session, prove it live, and report. This is the hand-off a card uses when work mode cannot start work.
- The user's own directions still win. Until their "Merging and deploying take a yes on a list" section says YOLO mode covers these deploys, the main agent asks first, as that section tells it to.
- Each merge by itself is one line in Chat and one line in `work/yolo.jsonl` in hobkin's home: when, project, item, title, commit, kind, rate, scores, and whether a deploy was handed on.

### Turning it on

- Only the window changes YOLO mode. The command `work.yolo` is marked `outside`, so hobkin's `client` tool refuses it, and no `hobkin work` command changes it. The host calls the runtime's `setYolo` itself, as `work.agents` calls `setAgents`.
- Settings has a YOLO mode tile under AI reviews: the switch, the lowest rate from 6 to 10, how many projects are ready, and what each of the others still needs.

## Out of scope

- Merging a PR by itself. PRs keep the user's yes, and `043-merges-and-deploys` holds the rules for when GitHub is ready.
- Changing the land-offer bar, Change Review's levels, or how a card's "Review again" works.
- A deploy run by hobkin's code, and a rollback by itself.
- Expiring a project's readiness. The user asks for a new check by retrying the readiness item.
- Scores computed by Change Review from its own facts.

## Acceptance

- A1. A review's scores are kept only when all five are whole numbers from 1 to 10 with a line of evidence, the kind is one of the seven, and the commit is named. Anything else is refused with the reason, and so are scores from a run that is not the item's review.
- A2. The general rate is the average cut to one decimal. A change with `safety` under 8, `rollback` under 7 or any score under 5 is held whatever its average.
- A3. A finished change's row carries its kind, scores, rate and broken floors, and says when they are for an older commit. The card in the window shows them in one line.
- A4. YOLO mode is off in a new home. With it off, a change that would pass every rule does not merge by itself.
- A5. Turning YOLO mode on merges nothing and files one readiness item, kind `feature`, on each chosen project. A project is ready only when all four parts are recorded as in place and that item is merged or done.
- A6. A change on a project that is not ready never merges by itself, even at rate 10.
- A7. On a ready project, a small change scored at or above the user's rate at the surveyed commit, with no floor broken, merges locally by itself with route `yolo`.
- A8. Scores for an older commit never count: a branch that moved after its review does not merge by itself.
- A9. A change classified `feature` or `unclear`, or whose item is a feature, never merges by itself, whatever its rate.
- A10. Every merge by itself leaves one line in Chat and one in `work/yolo.jsonl`, and hands the main agent a deploy job when the project's readiness names a deploy path.
- A11. Only the window turns YOLO mode on or off or sets its rate. hobkin's `client` tool refuses `work.yolo`, no `hobkin work` command changes it, and a rate outside 6 to 10 is refused.
- A12. Settings shows YOLO mode's switch and rate, how many projects are ready, and what each of the others still needs. With no host it shows sample data.

## Proof

- A1. `hobkin/test/cli-work-classified.test.mjs` › "a review's scores are kept only when they are whole, evidenced and pinned to a commit" and › "only the item's review run records scores"
- A2. `hobkin/test/cli-work-classified.test.mjs` › "the general rate is the average cut to one decimal, and a floor holds a change whatever its average"
- A3. `hobkin/test/cli-work-classified.test.mjs` › "a finished row carries its scores and says when they are for an older commit"; `hobkin-client/host/test/work-yolo.test.ts` › "a finished change's card says its kind, rate and scores"
- A4. `hobkin/test/cli-work-yolo.test.mjs` › "with YOLO mode off nothing merges by itself"
- A5. `hobkin/test/cli-work-yolo.test.mjs` › "turning it on files a readiness feature on each project and merges nothing" and › "a project is ready only once every part is in place and its readiness item has landed"
- A6. `hobkin/test/cli-work-yolo.test.mjs` › "a project that is not ready never merges by itself, even at rate 10"
- A7. `hobkin/test/cli-work-yolo.test.mjs` › "on a ready project a small change at the user's rate merges by itself at its scored commit"
- A8. `hobkin/test/cli-work-yolo.test.mjs` › "scores for an older commit never count"
- A9. `hobkin/test/cli-work-yolo.test.mjs` › "a feature or an unclear change never merges by itself"
- A10. `hobkin/test/cli-work-yolo.test.mjs` › "each merge by itself is reported in Chat and in the ledger, and its deploy is handed on"
- A11. `hobkin-client/host/test/work-yolo.test.ts` › "only the window changes YOLO mode"; `hobkin/test/cli-work-yolo.test.mjs` › "no hobkin work command changes YOLO mode, and a rate outside 6 to 10 is refused"
- A12. `hobkin-client/ui/test/settings-yolo.test.ts` › "the tile says how many projects are ready and what the others need"

## Steps

- [ ] S1 (A1, A2). Runtime: the scores, the rate and the floors as a pure module, and `hobkin work item` keeping a review's scores. Files: new `hobkin/src/cli/work/classified.mjs`, `hobkin/src/cli/work/commands.mjs`; tests new `hobkin/test/cli-work-classified.test.mjs`.
- [ ] S2 (A3). Runtime: the review prompt asks for the scores, and a finished row carries them. Files: `hobkin/src/prompts/work-do.md`, `hobkin/src/cli/work/reads.mjs`.
- [ ] S3 (A4, A5, A11). Runtime: the setting and each project's readiness. Files: new `hobkin/src/cli/work/yolo.mjs`, `hobkin/src/cli/work/commands.mjs`, `hobkin/src/prompts/work-do.md`; tests new `hobkin/test/cli-work-yolo.test.mjs`.
- [ ] S4 (A4, A6, A7, A8, A9, A10). Runtime: the pass that merges, its report and the deploy hand-off, wired in after the survey. Files: `hobkin/src/cli/work/yolo.mjs`, `hobkin/src/cli/work/patterns.mjs`, `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/application.mjs`, `hobkin/src/prompts/v2-runtime.md`.
- [ ] S5 (A3, A11). Host: the protocol, the `work.yolo` command and the card's line. Files: `shared/protocol/work.ts`, `shared/commands/registry.ts`, `host/src/work.ts`, `host/src/hobkin-work.d.ts`; tests new `host/test/work-yolo.test.ts`.
- [ ] S6 (A12). Window: the YOLO mode tile in Settings and the scores on a finished card. Files: new `ui/src/features/settings/YoloTile.tsx`, new `ui/src/features/settings/yolo.ts`, `ui/src/features/settings/SettingsScreen.tsx`, `ui/src/features/work/Finished.tsx`, `ui/src/features/work/sample.ts`; tests new `ui/test/settings-yolo.test.ts`.

## Open questions

- Who grades. (a) As decided: the review run scores the change, and code holds the floors, the kinds and the change rules. (b) Also need Change Review to say "Safe to deploy" at the same commit: two reviews agree before a merge, and nothing merges on a Mac where the host has not finished its review.
- Home. Work status carries the count of ready projects and what each needs. Showing it on Home's Projects widget is not built here.
- A readiness that goes stale. (a) As decided: it stands until the user retries the item. (b) Check again every 30 days, as a signals look does.
