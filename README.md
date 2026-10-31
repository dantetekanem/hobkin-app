# Hobkin

Hobkin runs scheduled checks through Pi and saves their results as Markdown reports. Chat with the agent, watch checks as they run, and read completed reports in the terminal.

## Run it

Run from a checkout containing the standalone CLI:

```sh
pnpm install
pnpm hobkin
```

You need Node 22.19 or newer, pnpm, configured Pi credentials and `pi` on PATH. This checkout uses Pi SDK/TUI 1.4.0. If `hobkin` is already on PATH, launch it from any directory:

```sh
hobkin
```

First launch creates `~/.hobkin` and connects Pi without sending a model request. Later launches reopen the same conversation. Use `--home /absolute/path` or `HOBKIN_HOME` for another workspace.

Coming from pi-companion? Close it, then run `hobkin import`. That copies `~/.companion` into `~/.hobkin`, with your schedules, memory, reports and conversation, and points them at the new folder. The old folder is not changed. Run only one of the two: each would run every schedule.

Hobkin uses your ordinary Pi tools, extensions, MCP servers and project context. Models configured in Pi, including Anthropic/Claude models, work here. Pi's own screens and custom extension widgets are not reproduced.

Updating Hobkin? Read the [CLI update steps](docs/upgrade.md#already-using-the-cli). Moving from the older Pi extension? Read the [legacy migration steps](docs/upgrade.md#legacy-pi-extension-before-planning). Opening a new workspace never imports old data or disables that extension.

## Use it

Chat opens ready to type. Reports holds completed checks; Schedules shows their next run and any configuration errors. Running checks get their own read-only tabs. Finishing the selected check opens its report.

- **Enter** sends a message or opens the selected report. Your message shows in Chat straight away, gray until the agent has it. One sent while the agent is busy waits its turn.
- **Left/Right** changes views when the chat draft is empty; otherwise it moves the cursor.
- **Arrow keys** select reports. **Page Up/Down** and the mouse wheel scroll.
- **m** inside a report moves to the composer with that report attached, so you can ask about it and carry on in Chat. **Escape** in the composer drops the report and keeps your draft.
- **Escape** leaves a report or returns to Chat without losing the draft.
- **k** cancels the selected running check. Jobs have no automatic execution deadline.
- **Ctrl+C** quits.

Type `/` to see local commands. `/clear` hides visible chat without deleting history or changing model context. `/reset` starts a fresh conversation and resets the displayed cost estimate; old transcripts, usage history and background work remain. `/jev` turns Jev on or off. Pi's editor shortcuts and configured editor keybindings work in the composer.

Colors follow Pi's saved theme. The header shows connection state; the status bar shows the next check, the total size of Hobkin's memory files, model, context usage and estimated cost. Critical and useful report summaries appear in Chat; no-news reports stay in Reports. Occasional tips appear above the shortcuts.

Hobkin's face sits left of the input bar in Chat and follows what is happening. On its own it uses four moods: idle when nothing is running, thinking while the agent replies, working while a check or work agent runs, and happy for 30 seconds after a useful report. In Ghostty and Kitty it plays the design's own animation, including inside Herdr. Each frame is sent once, so animating it only changes text. Other terminals, tmux and `HOBKIN_FACE=blocks` use block characters instead. It hides on a narrow or short terminal.

Jev, a model from TypeSafe, can pick from all 18 moods instead. Set it with `/jev` in the dashboard or `hobkin jev [on | off]`. It needs `TYPESAFE_API_KEY` in the environment, and the status bar shows `jev` while it is on. Jev then picks a mood when a session starts, a report arrives, a schedule or work agent starts or finishes, work mode pauses, the agent finishes a reply or you send a message, and after 15 quiet minutes. Each request goes to `https://api.typesafe.ai/v1/systemone` and carries the event, a report's outcome and its line in Chat, your latest message and the agent's latest reply, each cut to its last 400 characters, and the names of what is running. Nothing is sent with Jev off.

Ask the agent to run a configured check now, even if its recurring schedule is paused. This runs it once without changing its schedule. While a check runs, tell the agent anything that bears on it and the agent passes it on: the check reads the message at its next step and carries on, and its report holds the result.

Ask the agent for a different model or thinking effort and the conversation switches on its next model call, with no restart. Each schedule has its own model and effort, and its reports use them: name a check to change only that one, and its next run picks it up. Schedules shows each check's effort.

Hobkin notices which reports you open or message about. A check is flagged in Schedules, and mentioned in tips, when at most 1 in 5 of its latest reports was, across at least 5 reports and a week of tracking, with no critical finding and no run you requested. Nothing changes on its own: ask the agent to revisit a flagged check. This stays in the data folder as run IDs and timings in `runtime/telemetry.jsonl` and a per-check summary in `runtime/report-attention.json`, and a summary you only read in Chat does not show up.

The agent keeps a short list of what matters right now in `memory.md` in the data folder: up to 20 one-line items that it adds, updates and removes as things change. Ask it to remember or forget something, or edit the file yourself. The list stays within Hobkin, chat sees it on every turn, and scheduled checks can read it but not change it.

`AGENTS.md` in the data folder holds your standing directions: how the main chat, checks and work mode should work. Memory is what matters now; this is how to work. Edit it yourself or tell the agent, and the next turn or run follows it. It starts with one direction: agents do not spawn subagents. For massive work they run `hobkin session`, which opens a full Pi session with all permissions in a new pane of a Herdr tab called Hobkin, starts it on the brief and leaves the pane open for you. Outside Herdr the agent does the work itself.

Each check also keeps its own folder at `~/.hobkin/checks/<id>/`, and every run starts with both files in it. `memory.md` is the check's working memory: checkpoints, open items and what it has already reported. Its agent maintains the file, and you can edit it too. `log.md` has one line per run, written by Hobkin, with the time, trigger, outcome, duration, cost and first report line.

A check that cannot do its work says `Blocked:` in Chat. After two blocked or failed runs in a row, Hobkin stops scheduling it instead of retrying: Schedules shows it as held, and it tries again after 1 day, then 2, 4 and 7. A working run or a schedule edit clears the hold, and you can still run it on request.

## Add a schedule

Create a Markdown file in `~/.hobkin/schedules/daily/`, `weekly/` or `monthly/`:

```markdown
---
{
  "id": "morning-recap",
  "title": "Morning recap",
  "at": "09:00",
  "timezone": "America/Sao_Paulo",
  "enabled": false,
  "harness": "pi",
  "model": "provider/model",
  "effort": "medium",
  "cwd": "/absolute/project/path",
  "context": ["notes/current.md"]
}
---
Check the approved notes for changes worth acting on. Cite the evidence.
```

Set your paths, timezone and model, then enable the file. `model: null` uses Pi's default. Weekly files take a `weekday`, or a list such as `[1, 2, 3, 4, 5]` for Monday to Friday.

For a check that runs once, put the file in `once/` with a `date` (`YYYY-MM-DD` in the file's timezone) plus `at` or `window`. If Hobkin was not running at that time, the check runs as soon as it is, however late. It never runs twice, and once it has run it leaves Schedules: its file moves to `checks/<id>/`, next to its log. The [schedule guide](src/prompts/schedule-setup.md) covers multiple daily times, hourly windows and weekly/monthly settings. Hobkin reloads edited schedules automatically. Keep the dashboard or headless runner open for checks to run.

## Start Pi through a launcher

If Pi must start through a wrapper, for example one that sets up credentials or required extensions, add `launcher` to Hobkin's `config.json`:

```json
"launcher": { "command": ["my-pi-launcher", "pi"], "env": { "EXAMPLE_MODE": "1" }, "managedExtensions": true }
```

Hobkin then starts every Pi process with that command. The main chat runs as an RPC child (`my-pi-launcher pi --mode rpc`), and checks, reflection, pattern review and repair use the same command. `env` adds variables and rejects credential-like names. Hobkin passes its own environment through and never reads credentials. Set `managedExtensions` when the launcher loads required extensions and refuses `--no-extensions`. Tool-free jobs then keep their other isolation flags. If the main chat's child exits, Hobkin says so and keeps running scheduled checks; restart it to reconnect the chat. Without `launcher`, Hobkin runs `pi` directly.

## Work mode

Work mode is a proactive agent mode to get work done on your projects. The Work Mode tab sits beside Schedules, with a grey circle while it is offline and a green one while it is active. Press Enter in that tab, or type `/work` from anywhere, and Hobkin asks which folder to start from. The agent then looks only in that folder. It lists the top level first and goes through the folders one by one, reading each repository's git history to see what is published and still moving. It offers the main projects first, with what it found and how critical it thinks each one is, and you set priority and say which ones. `/work ~/Projects` names the folder directly. In that tab, `y` takes a proposal, `1`, `2` or `3` takes it as critical, important or casual, and `n` skips it. You can also answer in Chat.

From then on, agents work on those projects without being asked. One studies each project and then looks through it for security issues, bugs, updates, chores, improvements, features and trends, filing what it finds. Another takes those items one at a time and opens a PR, in its own worktree, so your checkout is never touched. The level sets how often it looks, how hard it thinks, and whether PRs start as drafts. Once a day each project also gets new ideas designed for it: up to 3 when it has little open work, 1 when it has some, and none when it has plenty. Run `/work` again to stop; projects, items and branches stay.

Work mode watches its tokens. The Work Mode tab shows fresh tokens used today against a daily limit, 100 million by default. Set it with `hobkin work tokens <number>`. Cache reads are not counted, and `claude` and `codex` panes are not counted at all, because only Pi's session files can be read. Work spreads across the day: any rolling hour can use at most a 24th of the limit, then new work waits for the hour to move on. Past half the limit a project gets one idea at most. Urgent items always start.

Either limit pauses work mode, and nothing is lost: running agents finish, items stay, and the tab shows `● paused`. The hourly pause clears on its own, and the daily one lasts until tomorrow. If work is waiting, Hobkin says in Chat what it used, what is waiting and what happens otherwise, and proposes double the allowance for today. Press `y` or `n` on that row in the Work Mode tab, answer in Chat, or use `hobkin work allow [number | no]`.

Inside Herdr, work on the projects you took runs where you can watch it: a Herdr tab called Work Mode opens without taking focus, with one pane per agent, and each pane closes when its agent finishes. A pane stays open if its run fails, so you can read why. Press `h` in the Work Mode tab to pick the harness: `pi`, `claude` or `codex`. Each starts with your own settings for that harness, so one that asks for approvals will wait in its pane. Outside Herdr, the same work runs in the background through Pi.

Work mode runs only while the dashboard or `hobkin run` is open. Drive it from scripts with `hobkin work`.

## Chrome

Hobkin uses `pi-chrome` when it is installed, in chat, checks and work mode alike, with no time limit and no `/chrome authorize`. Agents read public pages and your own projects freely. Opening banking, financial, health, government, mail or other private accounts, or changing anything through the browser, needs an approved plan first: your yes in Chat, or a check's own instructions.

## Use it from other agents

`hobkin skill` prints a skill that teaches an agent to read reports and run history, add checks, queue one-time work and stay out of Hobkin's internals. Read it directly, or save it where your agent loads skills:

```sh
mkdir -p ~/.pi/agent/skills/hobkin
hobkin skill > ~/.pi/agent/skills/hobkin/SKILL.md
```

## Run without the dashboard

`hobkin run` runs in the foreground for your supervisor to manage. Hobkin does not install a service. Only one runner can own a workspace.

These commands read saved state without starting Pi or schedules:

```sh
hobkin status --plain
hobkin schedules
hobkin history
```

After a crash, unfinished work is marked interrupted rather than retried. A stale owner lock can take up to five minutes to expire; do not delete a live owner's lock. Costs are estimates, not invoices. See [architecture and recovery details](docs/v2-design.md).

To find recurring work in selected past sessions, use the optional [session review](src/prompts/session-patterns-setup.md). For the older Pi extension, see the [legacy guide](docs/legacy.md). Migration instructions include an [agent checklist](docs/upgrade.md#agent-checklist).
