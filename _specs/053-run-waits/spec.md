---
{
  "id": "053-run-waits",
  "title": "A run can wait and carry on at a time",
  "kind": "work",
  "status": "done",
  "depends": [],
  "updated": "2026-11-21"
}
---
# A run can wait and carry on at a time

## Outcome

An agent in a session hobkin runs can say "carry on at 7:30" or "carry on in 30 minutes, to read the monitoring again", and end its turn. The run is neither finished nor failed. It waits with no Pi process and no place taken, and at its time hobkin starts it again on its own session with its own note. Its one report is filed when it really ends. On 2026-11-21 two deploy sessions that had to watch production for 30 minutes stopped on Pi's `task_wait`, and hobkin filed each as "The run failed: Pi did not finish a response (toolUse)". The user: "it was deployed".

## Decisions

- hobkin's way to wait is the `hobkin_wait` tool, with `minutes` (more than 0, at most 1440) or `at` (a 24-hour `HH:MM` clock time, the next one to come, in the user's time zone), and `note`, what to do then. hobkin loads it into the runs that can wait. It reaches the host over the run's own bridge (`bridge.mjs`), the same pipe Pi already talks on, so the run is known without an id of its own. The host answers with the time it will start again.
- The runs that can wait are the sessions `hobkin session` starts (`session-jobs.mjs`): the deploys and their watches run there. Work runs and routines keep their own lifecycles and do not get the tool.
- A turn that asked to wait and then ended in the ordinary way (stop reason `stop`) ends the run as `waiting`. A wait belongs to the turn that asked for it: a later turn of the same process clears it. A run whose agents are still out is told it cannot wait yet.
- A waiting run's record keeps status `waiting` and `wait`: `until`, `note`, `askedAt`, `said` (its last words), `waits` (how many times it has waited) and `freshSession`. It holds no process, no runner job and no place in the count of routines and sessions. No report is saved and nothing is logged as finished.
- The same tick that starts session requests (`tickSessions`) starts waiting sessions whose time has come, before new requests and earliest first, by the same rule: a free place under the concurrency setting. Session starts have no budget rule today, so none is added. One without a place stays waiting and goes on a later tick.
- A resumed run keeps its run id, harness id and session file. Pi starts on that file and is told the note, the time it asked for and the minutes since it asked. Admission back to `running` and the user's Stop each commit only while the record still says `waiting`, so exactly one of them wins.
- A restart leaves a waiting record as it is. Only `running` records are interrupted at open, and the first tick after open starts a wait whose time has passed.
- The bounds are 24 hours a wait and 12 waits a run. A call past them gets a refusal in the tool's answer that tells the agent to finish and report, and the run ends as usual.
- The user stops a waiting run the way they stop a session today (`kill`). It ends `interrupted`, with its last words as the report and the user's stop recorded, and the session's end goes to the session log.
- Pi's own `task_wait` (pi-solid-tasks) and `schedule_task` (`@jl1990/pi-scheduler`) are not honored. `task_wait` returns `terminate: true` and says Pi must keep running, and its wait lives only in that process. pi-scheduler fires only inside a live Pi on that session, from the shared state file in the user's own Pi home, and its shell polls with `wakeOn` and `stopOn` have no way to fire without that process. Holding the process would break the wait's own rule, so a run that stops on either one gets one follow-up prompt: cancel what it scheduled and use `hobkin_wait`. A run that cannot wait is told to finish and report instead.
- A run that stops on a tool call with nothing to wait for fails as before, and its report says the agent stopped in the middle of a step, naming the call, and did not come back.
- The snapshot's `runs` carry what the client needs: `state: 'waiting'`, `waitUntil` (ISO time), `waitNote` and `waits`. A waiting run stays in the list however old it is. It is not a report, not usage yet and not finished evidence.

## Out of scope

- Waits for Work runs, routines and durable hobkins.
- Waking a waiting run early with a message.
- How the window shows a waiting run, and its Stop button for one. The client's `agent.stop` accepts only `running` today.
- Any change to the user's Pi packages.

## Acceptance

- A1. A session whose agent calls `hobkin_wait` and ends its turn ends that run as `waiting`: no report is filed, its Pi process has exited, its place is free for another session, and its record says until when and why.
- A2. At its time the waiting session starts again on the same session file with its note and the minutes since it asked, and when it ends it files exactly one report.
- A3. A waiting session whose time has come while every place is taken stays waiting, and starts on the first tick with a free place.
- A4. A wait survives a restart of hobkin, and a hobkin that opens after the time has passed starts the run on its first tick.
- A5. Stopping a waiting session ends it `interrupted` with its report filed and the user's stop recorded, and it never starts again.
- A6. A wait longer than 24 hours, or a run's 13th wait, is refused in the tool's answer, and the run ends as usual with its report.
- A7. A run that stops on `task_wait` or `schedule_task` is told once, as a follow-up prompt, to cancel what it scheduled and use `hobkin_wait`, and it goes on instead of failing. A run that cannot wait is told to finish and report.
- A8. A run that stops on a tool call with nothing to wait for fails, and its report says the agent stopped in the middle of a step and did not come back, naming the call, never "(toolUse)".
- A9. The snapshot lists a waiting run with state `waiting`, `waitUntil`, `waitNote` and `waits`.
- A10. The background directions say when to wait with `hobkin_wait` (a watch after a deploy, a long build, anything to look at again later) and never to sleep in a shell for it, and every deploy brief's 30-minute watch says to use it.

## Proof

- A1. `test/cli-run-waits.test.mjs` › "a session that asks to wait ends its turn waiting, with no report, no process and its place free"
- A2. `test/cli-run-waits.test.mjs` › "at its time a waiting session starts again on its own session with its note and files one report"
- A3. `test/cli-run-waits.test.mjs` › "a waiting session whose time has come starts only when a place is free"
- A4. `test/cli-run-waits.test.mjs` › "a wait outlives a restart and starts at once when its time passed while hobkin was closed"
- A5. `test/cli-run-waits.test.mjs` › "stopping a waiting session ends it with its report and it never starts again"
- A6. `test/cli-run-waits.test.mjs` › "a wait over 24 hours or past the twelfth is refused in the tool's answer and the run ends as usual"
- A7. `test/cli-run-waits.test.mjs` › "a run that stops on task_wait is told once to use hobkin_wait and goes on"
- A8. `test/cli-run-waits.test.mjs` › "a run that stops in the middle of a step fails in plain words"
- A9. `test/cli-run-waits.test.mjs` › "a waiting run shows in the snapshot as waiting, with until when and why"
- A10. check: read the "Waiting" section of `src/prompts/background.md` and the `asked` text in `src/cli/work/deploys.mjs` and `src/cli/work/yolo-pass.mjs`.

## Steps

- [x] S1 (A6). The `hobkin_wait` extension and the host's answer to it: the bounds, the time asked for and the words.
- [x] S2 (A1, A6, A7, A8). The harness: the wait over the bridge, the `waiting` outcome, the follow-up for Pi's own tools, and the plain words for a stop in the middle of a step.
- [x] S3 (A1, A2, A3, A4, A5). The runtime and session jobs: the `waiting` record, starting again at the time, and the user's Stop.
- [x] S4 (A9). The snapshot's fields, and a waiting run kept out of reports, usage and evidence.
- [x] S5 (A10). The words in `background.md`, `v2-runtime.md` and the deploy briefs.
