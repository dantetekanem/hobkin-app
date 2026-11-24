---
{
  "id": "056-agent-schedules",
  "title": "Schedules an agent keeps for itself",
  "kind": "work",
  "status": "doing",
  "depends": ["010-routines", "033-claude-code-agents", "034-durable-hobkins", "053-run-waits"],
  "updated": "2026-11-23"
}
---
# Schedules an agent keeps for itself

## Outcome

An agent in hobkin can schedule work for itself: a command hobkin runs on a timer, or a plain timed wake, that brings the agent back when there is something for it to do. One agent can watch a pull request's checks and come back only when they turn red or finish. The window shows every schedule in a line near the input, with when it fires next, and the user can run one now, pause it or cancel it.

The user, 2026-11-23: "I also need schedule tasks to run inside Hobkin, like my pi scheduler extension I use. this will be a custom tools for agents and subagents to use. so one agent can watch CI, for example. and I need a great interface like tasks do, but at the footer near the input for it."

## Decisions

- The reference is the Pi extension the user runs, `@jl1990/pi-scheduler`. hobkin has its own design and code, kept close to the extension where the user's habit is: a command on an interval, when to wake, when to stop, a cap on runs, a lifetime and a timeout. What the audit of 2026-11-23 found is in `notes.md` beside this spec.
- The tools are `hobkin_schedule`, which makes one, and `hobkin_schedules`, which lists them and cancels, pauses, resumes or runs one now. The extension's own names are not used: every Pi run but the main chat loads that extension, and hobkin counts its `schedule_task` as one of Pi's own waits. A run that gets hobkin's tools does not load the extension.
- A schedule is a command or a wake. With a command, hobkin runs it each time in the agent's folder and wakes the agent by its `wakeOn`: when the result changes (the default for a repeating command, whose first run only sets what to compare with), on failure, on success, always or never. Without a command it only wakes the agent, with its note.
- A schedule fires once, after a delay or at a time, or every 1 minute to 1 hour. `stopOn` ends a repeating one on success or on failure.
- `pendingExit` names up to four exit codes that mean "not yet", such as checks still running. Such a run wakes nobody, stops nothing and is no failure. The extension has no such state.
- Every schedule ends. It has a lifetime, two hours unless the agent says, twenty-four at most, and it may have a cap on runs. It wakes its agent twelve times at most. An owner has five live schedules at most, and the home twenty.
- A command runs for two minutes at most unless the agent says, between five seconds and ten minutes, with the host's environment. Its output is kept to 8 KB a stream, and a wake carries up to 4000 characters of it. The last ten runs are kept.
- The main chat, a durable hobkin and a run started with `hobkin session` may schedule. A helper and a teams agent may not: their tools are an exact list or not hobkin's, so the agent above them schedules for them. Work runs and routines come later, as waits do.
- A schedule belongs to the agent that made it and wakes only that agent. The main chat's end on `/reset`, a durable hobkin's when it is ended, a run's when the run ends or is stopped.
- A run whose turn ends while it has a live schedule waits, with no process and its place free, as a run that called `hobkin_wait` does. A wake starts it again on its own session, and each start counts as one of its waits. A schedule that ends without waking it starts it once more, told that its schedule ended, so it can write its report.
- The main chat is woken by a hidden turn while it is free, a durable hobkin by a turn or by a queued message while it works, a running run by a message steered in, a waiting run by a start.
- Schedules are kept in the home (`runtime/agent-schedules.json`) and fire on the runtime's one-second tick. Three commands run at once at most, and a schedule never runs twice at once. After a restart a run that was cut off counts as interrupted, an overdue schedule fires once, an expired one ends quietly, and a wake that was not delivered is delivered.
- A run on Claude Code has no tool bridge. It schedules through `hobkin schedule` in its shell, with a token of its own, the way `hobkin tell` works. A run on Claude Code whose permissions are not "all" may schedule wakes only: a scheduled command would run without the prompt Claude Code would have shown.
- The window gets every schedule in the snapshot as `agentSchedules` (`shared/protocol/schedules.ts`). `schedules` stays the routines. `schedule.cancel`, `schedule.pause` and `schedule.run` are the window's alone: hobkin's own agents use their tools.
- In the main chat the schedules are a line at the right end of the status row above the input. The row keeps its height, and with no schedule the line takes no width, so the row is as it was. While a turn runs, the working line (spec 054) and the stop hint keep the width they have with no schedule; the schedules line takes the widest of its forms that fits in what is left (name and countdown, count and countdown, the dot with the count, the dot alone), and the bubble takes the rest. On an agent's page and a durable hobkin's page the line under the talk box becomes a row that is always there, the status words at its left and the schedules at its right.
- The line says how many there are and the next one with its countdown, "2 · Watch CI in 1:42". With none, nothing is drawn in its place. A press, or Control+Option+W, opens the list upward, as the tasks line opens its list. Each row says what it does, when it fires next, how often, what its last run found, and the runs and time it has left, with Run now, Pause or Resume, and Cancel, which asks for a second press. The main chat lists every schedule in the home with its owner; a page lists its own.
- The countdown is text that changes once a second. The only endless motion is a running schedule's dot, on opacity.

## Out of scope

- Cron expressions, backoff, reminders that only notify, and schedules shared by a folder or by every session.
- Schedules for Work runs, routines, helpers and teams agents.
- Editing a schedule from the window. The agent that made it changes it.

## Acceptance

- A1. A schedule is refused with no note, with an interval under a minute or over an hour, a lifetime over twenty-four hours, a timeout outside five seconds to ten minutes, a sixth live one for an owner or a twenty-first in the home. One given no lifetime gets two hours.
- A2. A schedule's command runs when it is due, in its owner's folder, never twice at once for one schedule and three commands at once at most, and is ended at its timeout.
- A3. A run wakes its agent by `wakeOn`: on a change after the first run, on failure, on success, always or never. An exit code named as pending wakes nobody, stops nothing and is no failure. `stopOn`, the cap on runs, twelve wakes and the lifetime each end the schedule, with the reason kept.
- A4. A wake reaches its owner and no one else: the main chat as a hidden turn while it is free, a durable hobkin as a turn or a queued message, a running run as a steered message, a waiting run as a start, each with the note and the command's output.
- A5. A run whose turn ends with a live schedule waits with no process. A schedule that ends without waking it starts it once more to report. Schedules end when their owner does.
- A6. Schedules outlive a restart: a run cut off counts as interrupted, an overdue schedule fires once, an expired one ends quietly, and an undelivered wake is delivered.
- A7. The main chat, a durable hobkin and a `hobkin session` run each have `hobkin_schedule` and `hobkin_schedules`. A helper has neither. A run that has them does not load the Pi scheduler extension.
- A8. A run on Claude Code schedules through `hobkin schedule` with its own token, and one whose permissions are not "all" is refused a command and allowed a wake.
- A9. The snapshot carries every schedule as `agentSchedules`. `schedule.cancel`, `schedule.pause` and `schedule.run` do what they say for a live schedule, are refused for an unknown or ended one, and only the window may send them.
- A10. The schedules line shows in the main chat's status row, on an agent's page and on a durable hobkin's page, says the count and the next one with its countdown, and takes room that is always kept, so no control moves when a schedule appears or ends.
- A11. The line opens to every schedule, each with what it does, its next time, how often, its last run and what it has left, with Run now, Pause or Resume, and a Cancel that asks twice. Control+Option+W opens it and Escape closes it.
- A12. With no host the window shows sample schedules in each of the three places.

## Proof

- A9. `shared/test/schedules.test.ts` › "a runtime that has none reads as none, and an empty list as an empty one"; `host/test/schedules.test.ts` › "the handlers reach a running application's own schedule methods, and the runtime's refusal passes on", › "an unknown or ended schedule is refused in plain words, and the runtime is never asked" and › "only the window sends them: hobkin's own client tool neither lists nor runs them"; `host/test/schedules-host.test.ts` › "the window gets the runtime's schedules in the snapshot, and the host answers its commands"
- A10. `ui/test/schedules.test.ts` › "the line says nothing with no schedule, the name and countdown of one, and the count and the next of many" and › "the main chat shows every schedule in the home, and a page shows only its own agent’s"; `ui/test/schedules-line-fit.test.ts`, every test in it (which form the line takes in the room it has, and what keeps its room while a turn runs); check: still renders of the status row with none, one and three schedules at 460 and 360 pixels, idle and with a turn running, and of both pages, light and dark (2026-11-23), then the live window.
- A11. `ui/test/schedules.test.ts` › "what the last run found: how it ended, its exit code, how long ago and whether it woke the agent"; `ui/test/schedules-actions.test.ts` › "Cancel asks first, and only a second press within ten seconds cancels", › "Control+Option+W opens and closes the schedules, whatever character Option makes W type" and › "Escape closes the open list only while the keyboard is in it or on its line"; check: a still render of the open list with a running, a waiting, a paused and an ended schedule, light and dark (2026-11-23), then the live window.
- A12. `ui/test/schedules.test.ts` › "the sample schedules keep counting down: a repeating one that came due moves on to its next time"

## Steps

- [ ] S1 (A1, A2, A3). Runtime: the rules, the store, the tick and the commands.
- [ ] S2 (A4, A5, A6, A7). Runtime: the tools for the main chat, durable hobkins and session runs, and the wakes.
- [ ] S3 (A8). Runtime and host: `hobkin schedule` for runs on Claude Code.
- [x] S4 (A9). Host and protocol: the snapshot's list and the three commands. 2b291b1, 0155a70, 3c4e836, 6a9be9e. Tested with a fake of the runtime and one scripted host: no real schedule has gone through a host. The host must reload itself before the window gets any.
- [x] S5 (A10, A11, A12). Window: the line near the input and its list. c501f42, 0585cff, 5bab651, a6bfe0b, 09e9327. With no schedule the status row is as it was. While a turn runs, the working line and the stop hint keep their room and the line takes the widest form that fits, down to its dot. Seen only as still renders, with sample schedules: not in the live window, and not with a real schedule.

## Open questions

- A schedule lives twenty-four hours at most, as a wait does. The user has not said whether a watch should be able to run for days.
- Work runs cannot schedule yet. They have their own budget and places, and what a wake costs there is not decided.
- That `gh pr checks` exits 8 while checks are pending was not checked.
