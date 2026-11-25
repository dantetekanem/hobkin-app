---
{
  "id": "072-jobs-live-until-done",
  "title": "A job lives until its agent says it is done",
  "kind": "work",
  "status": "doing",
  "depends": ["053-run-waits", "056-agent-schedules"],
  "updated": "2026-11-24"
}
---
# A job lives until its agent says it is done

## Outcome

A job hobkin's chat hands out works in the user's own folder, stays alive after its turn, hears the user and its own agents while it lives, can ask the user and wait for the answer, merges its own branch when the user's ask covers it, always reports back to the chat, and ends only when its agent says it is done. Nothing waits by the clock.

The user, 2026-11-24: "review how hobkins work when asked, they keep creating worktree, doesnt merge, doesnt connect, doesnt ask. spend tokens for NOTHING", then "hobkin_wait was added to avoid autokill from spawned agents. this is just dumb as fuck" and "the main agent should decide it is done and kill itself or not". `hobkin_wait` is already gone from what agents are offered (hobkin d93bc17). On merging, the user chose: the job merges its branch itself when the ask names the change and its tests pass.

## Decisions

### What was there before (the review of 2026-11-24)

- A job's run ends when its turn ends: `harnesses.mjs` `finishOwned` settles once no agents are out and the process is terminated (~675). Steering is then refused. Agents it spawned die with it on an abort or a failure.
- A job with a live schedule still ends as `waiting` and is restarted later on its whole session (`harnesses.mjs:643`, `session-jobs.mjs` `resumeSessionJob`), and `scheduleHandler` tells it to end its turn and wait.
- A job cannot ask: job dialogs are declined (`harnesses.mjs:545-560`), `ask_question` is only in the main chat, and `background.md` points at a `decide` command a job never gets.
- After a restart a cut-off job never reports (`runtime.mjs` `interruptAbandonedRuns` never ends its session), and the user's card choices are dropped when one send fails (`application.mjs` `handOffs.splice(0)`).
- No prompt keeps a job in the user's folder, so agents make sibling worktrees (`~/Poetry/<repo>-<words>-<hex4>`, fifteen on disk), and nothing removes them.
- Jobs are told never to merge, and a branch outside a Work project reaches the user nowhere.
- Every job runs on `background.md`, written for routines, and files Work items that start further runs.

### Life

- A job runs with `untilDone`. Its turn ending does not end it: hobkin keeps its process, idle, taking messages.
- `hobkin_done { report }` is the only way a job ends itself. Its report is the job's report, as the last reply was before.
- While it lives, the user's messages, its own agents' reports and its live schedules each start a turn on the same process. A schedule never ends a job as `waiting` any more.
- The user can stop a job from the window at any time, as today. hobkin sets no idle limit of its own on a living job.
- A living job that is idle does not count against routines' concurrency (`runner.mjs` `scheduledJobCount`).

### Asking

- A job asks the user in its reply and ends its turn. hobkin tells the chat and the user that reply, as it tells a durable hobkin's, and the user's answer reaches the job as a message.

### Where it works and merging

- A job works in the folder it was given, on a branch it makes there. It never makes a worktree. If the folder holds changes that are not its own, it asks the user before touching anything.
- When the user's ask names the change and the job's tests pass, the job merges its branch into the default branch there, locally, and says so in its report. It never pushes. Otherwise it asks.

### Reporting back

- A job cut off by a restart ends its session with a report that says so, and the chat is woken as for any end.
- A card choice the main agent could not be sent stays queued for the next try.

### Tokens

- A job runs on its own short prompt, `session-job.md`, instead of `background.md`. It files no Work items.
- The main agent may do a job of a few commands itself instead of handing it out.

## Out of scope

- Removing the worktrees already on disk. The window may list them later; deleting them is the user's call.
- Work mode's own runs, which keep their worktrees and their landing.

## Acceptance

- A1. A job's run outlives its turn and ends only on `hobkin_done` or the user's stop; its report is the one `hobkin_done` gave.
- A2. A message from the user, a report from one of its agents and a due schedule each start a turn on the living job; none ends it as `waiting`.
- A3. An idle living job does not count against routines' concurrency.
- A4. A job's reply that asks the user reaches the chat and the user, and the answer reaches the job.
- A5. `session-job.md` keeps the job in its folder with no worktree, asks before touching changes not its own, merges its own branch locally when the ask names the change and its tests pass, never pushes, files no Work items, and ends with `hobkin_done`.
- A6. After a restart, a job that was cut off ends its session with a report saying so and wakes the chat.
- A7. A card choice that could not be sent is sent on the next try.

## Steps

- [x] S1. The spec (lead). 093c77b.
- [x] S2 (A1 to A3). Runtime: hobkin b8e2e26, 4b19f5b, ca2a4d3, debb6e7 (`idle`, `idleSince` on a run in the snapshot). `test/cli-jobs-live-until-done.test.mjs` 14 of 14 on an export of main.
- [x] S3 (A4, A5). Runtime: hobkin 35ae661 (`session-job.md`, the main may do a job of a few commands), 4eea6b5 (`v2-runtime.md` matches). Left: `src/cli/session.mjs`'s closing words still say not to merge; another agent holds uncommitted edits there. A job may push only when it is a push or deploy the user said yes to.
- [x] S4 (A6, A7). Runtime: hobkin 3564e0e, d8ca6f6.
- [x] S5. The window: a living idle job reads as idle, not working, and Stop ends it. The host passes `runs` whole, so `idle` and `idleSince` only needed their types on `RunSummary`. The dock says "idle since 10:51 PM · its last words" with its face at rest and counts it apart ("1 working · 1 idle"), Home's chip leaves it out and its card says Idle, and the agent page says "Idle since 10:51 PM · waiting for a message" where Thinking was. Stop is unchanged: the run stays among hobkin's active runs while it lives, so hobkin lists its stop control (read in hobkin's `runtime.mjs` and `harnesses.mjs`, not run). `ui/test/run-idle.test.ts` 5 of 5. Not seen in the window.
