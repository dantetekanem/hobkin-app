# Notes for spec 056: what the audit of 2026-11-23 found

A read-only audit of the user's Pi scheduler extension, of hobkin's runtime (`~/Poetry/hobkin`) and of this app, made on 2026-11-23. Paths with no repository named are hobkin's `src/cli/` or this app's, as the file name shows. Line numbers are of that day. Everything here was read in the code unless it says inferred. No test was run.

## 1. The reference: `@jl1990/pi-scheduler` 0.6.0

Installed under `~/.pi/agent/npm/node_modules/@jl1990/pi-scheduler`. MIT licensed, third-party: hobkin has its own design and its own code.

- Tools. `schedule_task` takes `action` (notify, prompt, shell or message; the schema says its default is prompt, `index.ts:862`, while the core defaults to notify, `core.cjs:219`), `type` (once, interval or cron, default once), `schedule` or `when`, `name`, `scope` (session, cwd or global, default session), `enabled`, `maxRuns`, `backoff`, `expiresIn`, `command`, `cwd`, `timeoutMs`, `wakeOn`, `stopOn`, `followUpPrompt`, `successPrompt`, `failurePrompt` and `triggerTurn` (`index.ts:861-901`). `list_scheduled_tasks` takes `includeAll`, `includeHistory` and `id`. `cancel_scheduled_task` takes `id`. `manage_scheduled_task` does enable, disable, remove, update or cleanup (`index.ts:930-1037`).
- Firing. notify shows a toast and a message, with no turn. prompt sends a user message. message sends a custom message whose `triggerTurn` defaults to true. shell runs `bash -lc` in its folder with a 5 minute default timeout, keeps 12k characters of output and gives the agent 18k (`index.ts:28-30`, `407-461`).
- Wake. `wakeOn` defaults to always when a prompt is given, otherwise never. `change` hashes the output, and its first run only sets the baseline. `stopOn` is separate from `wakeOn` (`core.cjs:236-240`, `876-936`, `1025-1050`). An idle agent is woken with `sendUserMessage`, which starts a turn; mid-turn the wake is queued as a follow-up (`index.ts:65-71`).
- Widget. Below the editor: "Scheduled Actions", then the next 3 tasks, each as "label action/type in 1m 5s (at 14:30) runs=N last=…". It redraws every second, and the status bar says "N scheduled" (`index.ts:213-268`).
- Storage and restart. Tasks persist in `~/.pi/agent/state/scheduler/tasks.json` under a lock, with the last 10 runs. On restart overdue tasks expire, runs cut off are recovered (a once task fails, a repeating one is rescheduled), overdue once and interval tasks fire, and missed cron runs catch up within 24 hours, at most 5 (`core.cjs:657-688`, `976-999`).
- Limits. `maxRuns` has no default and nothing caps the number of tasks. Pending is not a state of its own (`README.md:92`): a command that prints a failed pipeline may still exit 0.
- What watching CI needs: a shell command on an interval, `wakeOn`, `stopOn`, `maxRuns` or `expiresIn`, `timeoutMs` and a note. A plain timed wake is useful too. Notify, message, cron, backoff, the cwd and global scopes, update, cleanup, slash commands and catch-up settings are extras.

## 2. How a tool reaches each agent today

- Main chat. It runs as a Pi child (`host/src/owner.ts:445`). Its tools go over the bridge from `hobkin-extension.mjs:19`, and two exact checks cover them: `rpc-session.mjs:418-433` with `:477` ("did not activate its tools"), and the `bridgeTools` list in `pi-session.mjs:339-341`, checked at `:357-359`. The lists in tests are `test/cli-main-session-child.test.mjs:239,305`, `test/persona-rpc.test.mjs:91` and `test/cli-rpc-session.test.mjs:386`. A new main tool has to be added to all of these.
- Jobs. `hobkin_wait` loads only when a request carries `waits` (`harnesses.mjs:111-118`), and only `session-jobs.mjs:93` sets it. So durable hobkins, Work runs and routines cannot wait. With a launcher configured, `namingExtensions` is skipped (`application.mjs:287-293`, this app's `host/src/agents.ts:31`), so those homes get no tool. The job harness answers bridge calls itself (`harnesses.mjs:481-486`).
- Helpers. Their tools are an exact list, and any other tool is blocked (`owned-agent-extension.mjs:6-13`, `67-69`).
- Claude Code. There is no bridge. Only a durable turn passes `env` (`host/src/claude-code/route.ts:139`), which is how `hobkin tell` works from Claude's shell (`hobkins.mjs:329`). Session runs get no env (`route.ts:166-171`).
- Name clash. pi-scheduler is left out only of the main chat. Every other Pi run loads it (`pi-extensions.mjs:11,17`), and hobkin counts `schedule_task` as one of Pi's own waits (`run-waits.mjs:15`). The reference's tool names would collide with it.

## 3. How hobkin wakes an agent today

- Main. A hidden `<hobkin-wake>` turn, only while the main chat is free; it never steers a turn under way (`application.mjs:1206-1273`). A `scheduled` brief and its prompt words already exist (`wake.mjs:13-42`, `v2-runtime.md:142-148`), and nothing feeds them, because the scheduler is out of the main chat (hobkin f3bc7bd).
- A running job. A message is steered in through `onReady` (`harnesses.mjs:560-563`).
- A waiting session. `tickSessions` starts it again on its own session file when a place is free (`application.mjs:1282-1325`, `session-jobs.mjs:136-144`).
- A durable hobkin. One that waits takes words as a new turn; one that works queues them (`hobkins.mjs:357-401`, `676-679`).
- Routines. They come from files, reloaded on every 1 second tick (`runner.mjs:213-235`). Agent schedules can ride the same tick through `onTick` (`application.mjs:354-371`), and not the routine files: a routine starts a fresh session each time.
- Budget and places. The daily budget counts only Work's own runs (`work/budget.mjs`). A durable turn takes no place (`runner.mjs:297-300`). Starting a session again does take one. "Work mode off or paused" only affects Work.

## 4. Shell commands today

`executeShell` runs `bash -lc` in its own process group, ends it with SIGTERM then SIGKILL, caps output at 1 MiB and takes a stop signal (`shell.mjs:5-81`). It has no timeout: one would be added through an abort signal. An agent's own Pi shell has no sandbox, and sessions run with `--approve`.

## 5. The window today

- Runs carry their waits (`shared/protocol/snapshot.ts`, `RunSummary.waitUntil`). The snapshot key `schedules` is already the routines (`application.mjs:795`), so the new list is `agentSchedules`.
- Tasks are worked out in the window from the tool calls in the activity feed (`ui/src/features/agent-activity/tasks.ts:418`).
- Commands for one agent: `agent.stop` and `agent.say` (`shared/commands/registry.ts:1176-1193`, `host/src/agents.ts`).

## 6. The footer today

- Main chat. The status line's room is always kept (`ui/src/features/chat/StatusLine.tsx:83-84`): the face's bubble on the left, the working line and "esc esc stops" on the right. Below the input come the agents dock, which grows upward, and the key hints (`ui/src/app/Frame.tsx:63-70`).
- An agent's page and a hobkin's page. The talk box sits at the bottom. The status sentence under it only appears when it has something to say (`ui/src/features/work/AgentScreen.tsx:828-839`, `ui/src/features/hobkins/HobkinScreen.tsx:712-722`).
- Keys. Control+Option+W is free (`ui/src/app/key-map.ts`, `key-list.ts`); Control+Option+T opens the tasks list.

## 7. The tools as designed

`hobkin_schedule` takes:
- `name?`, up to 80 characters.
- `command?`, up to 4000 characters. Left out, the schedule is a plain wake.
- `note`, 1 to 1000 characters, required: what to do when woken.
- `in?` (a duration) or `at?` (HH:MM) for the first time it fires.
- `every?`, 1 minute to 1 hour. Left out, it fires once.
- `wakeOn?`: change, failure, success, always or never. Default change for a repeating command, always otherwise.
- `stopOn?`: success, failure or never.
- `pendingExit?`: up to 4 exit codes that mean "not yet": no wake, no stop, not a failure. This is hobkin's one addition, because pending is not a state in the reference.
- `maxRuns?`, up to 1440.
- `expiresIn?`, default 2 hours, at most 24. Every schedule has one.
- `timeoutMs?`, 5 seconds to 10 minutes, default 2 minutes.

`hobkin_schedules` takes `action` (list, cancel, pause, resume or run) and `id?`.

Limits: at most 12 wakes a schedule; at most 5 live schedules for one owner and 20 in the home; output keeps 8 KB a stream, and a wake carries up to 4000 characters of it; history keeps the last 10 runs.

## 8. The interface as sketched

```
main chat:   (face) writing…    0:42  esc esc stops   [2 · Watch CI in 1:42 ▾]
             ╭ Message hobkin ──────────────────────────────────────────────╮
popover ▲    Schedules  2                                         Ctrl+Opt+W
             ● Watch CI for #412 · hobkin session "Ship 412"         in 1:42
               gh pr checks 412 · every 2 min · 7 of 30 left · until 16:10
               last: pending (exit 8), 2 min ago · no wake
               [Run now] [Pause] [Cancel]
agent page:  ╭ Message Ship 412 ─────────────────────────────────────────────╮
             Received · admitted into a Pi turn.         [Watch CI in 1:42 ▾]
```

## 9. Not determined

- That `gh pr checks` exits 8 while checks are pending.
- The `claude` CLI's MCP flags in stream-json mode.
- Inferred, not read: that wakes should wait while a provider usage limit holds, with commands still running.
