# Hobkin guide

This is the full reference. The [README](../README.md) is the short version.

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

Hobkin uses your ordinary Pi tools, extensions, MCP servers and project context. It leaves out `pi-emote`, because it has a face of its own: the chat and background runs never load it, and Pi keeps it. A pane Hobkin opens, for work or a session, is your ordinary Pi with every extension, that one too. With a launcher, the launcher decides which extensions load. Models configured in Pi, including Anthropic/Claude models, work here. Pi's own screens and custom extension widgets are not reproduced.

Updating Hobkin? Read the [CLI update steps](upgrade.md#already-using-the-cli). Moving from the older Pi extension? Read the [legacy migration steps](upgrade.md#legacy-pi-extension-before-planning). Opening a new workspace never imports old data or disables that extension.

## Use it

Chat opens ready to type. Reports holds completed checks; Schedules shows their next run and any configuration errors. In Reports, a schedule's report has the blue dot of the Schedules tab, a work mode report has a green one, and a failed run is a red cross on both. Running checks get their own read-only tabs. Finishing the selected check opens its report.

- **Enter** sends a message or opens the selected report. Your message shows in Chat straight away, gray until the agent has it. One sent while the agent is busy waits its turn.
- **When the agent asks you something**, pick an answer with the arrows and **Enter**. The last row, Other, takes your own words. **Esc** chooses none.
- **Left/Right** changes views when the chat draft is empty; otherwise it moves the cursor.
- **Arrow keys** select reports. **Page Up/Down** and the mouse wheel scroll.
- **m** inside a report moves to the composer with that report attached, so you can ask about it and carry on in Chat. **Escape** in the composer drops the report and keeps your draft.
- **Escape** leaves a report or returns to Chat without losing the draft.
- **k** cancels the selected running check. Jobs have no automatic execution deadline.
- **Ctrl+C** clears the input. With nothing to clear, press it twice to quit. **Ctrl+Q** quits straight away.

Type `/` to see local commands, and press Tab to finish one, or to walk through them when several fit. `/help` shows a short guide in Chat. `/clear` hides visible chat without deleting history or changing model context. `/reset` starts a fresh conversation and resets the displayed cost estimate; old transcripts, usage history and background work remain. `/jev` turns Jev on or off, and `/learning` does the same for [learning](#learning). Pi's editor shortcuts and configured editor keybindings work in the composer.

Colors follow Pi's saved theme. The header shows connection state; the status bar shows the next check, the total size of Hobkin's memory files, model, context usage and estimated cost. Critical and useful report summaries appear in Chat; no-news reports stay in Reports. Occasional tips appear above the shortcuts.

Hobkin's face sits left of the input bar in Chat and follows what is happening. On its own it uses four moods: idle when nothing is running, thinking while the agent replies, working while a check or work agent runs, and happy for 30 seconds after a useful report. In Ghostty and Kitty it plays the design's own animation, including inside Herdr. Each frame is sent once, so animating it only changes text, and only the mood on screen stays in the terminal. Other terminals, tmux and `HOBKIN_FACE=blocks` use block characters instead. It hides on a terminal under 76 columns or 20 rows.

Jev, a model from TypeSafe, can pick from all 18 moods instead. Set it with `/jev` in the dashboard or `hobkin jev [on | off]`. It needs `TYPESAFE_API_KEY` in the environment, and the status bar shows `jev` while it is on. Jev then picks a mood when a session starts, a report arrives, a schedule or work agent starts or finishes, work mode pauses, the agent finishes a reply or you send a message, and after 15 quiet minutes. Each request goes to `https://api.typesafe.ai/v1/systemone` and carries the event, a report's outcome and its line in Chat, your latest message and the agent's latest reply, each cut to its last 400 characters, and the names of what is running. Nothing is sent with Jev off.

Ask the agent to run a configured check now, even if its recurring schedule is paused. This runs it once without changing its schedule. While a check runs, tell the agent anything that bears on it and the agent passes it on: the check reads the message at its next step and carries on, and its report holds the result.

Ask the agent for a different model or thinking effort and the conversation switches on its next model call, with no restart. Each schedule has its own model and effort, and its reports use them: name a check to change only that one, and its next run picks it up. Schedules shows each check's effort.

Hobkin edits every report before you read it, whichever agent wrote it. A small job with no tools, on your checks model, rewrites the draft in plain sentences. It uses the guide in `src/prompts/humanizer.md`, based on [blader/humanizer](https://github.com/blader/humanizer) under the MIT license in `src/prompts/humanizer.LICENSE`, so it needs nothing installed. The edit has to keep the report's first label and every number, link and piece of code. If it changes one of those, fails, or takes over three minutes, you get the report as the agent wrote it. `Nothing new.` reports skip this. Each edit costs about 8,500 tokens, and it does not count against work mode's daily limit.

Hobkin notices which reports you open or message about. A check is flagged in Schedules, and mentioned in tips, when at most 1 in 5 of its latest reports was, across at least 5 reports and a week of tracking, with no critical finding and no run you requested. Nothing changes on its own: ask the agent to revisit a flagged check. This stays in the data folder as run IDs and timings in `runtime/telemetry.jsonl` and a per-check summary in `runtime/report-attention.json`, and a summary you only read in Chat does not show up.

The agent keeps a short list of what matters right now in `memory.md` in the data folder: up to 20 one-line items that it adds, updates and removes as things change. Ask it to remember or forget something, or edit the file yourself. The list stays within Hobkin, chat sees it on every turn, and scheduled checks can read it but not change it.

`AGENTS.md` in the data folder holds your standing directions: how the main chat, checks and work mode should work. Memory is what matters now; this is how to work. Edit it yourself or tell the agent, and the next turn or run follows it. It starts with one direction: agents do not spawn subagents. For massive work they run `hobkin session`, which opens a full Pi session with all permissions in a new pane of a Herdr tab called Hobkin and starts it on the brief. The pane closes by itself when the work ends: the session writes a report to `runtime/handoffs/<name>.report.md`, and a watcher in its own process closes the pane when that file appears, when the agent stops without one, or when the agent is gone. `--keep` is for a whole conversation you mean to carry on in: ask to carry on with another agent, the new one starts from a brief saved in the data folder, so nothing depends on how long it is, and that pane stays open. Outside Herdr the agent does the work itself.

Each check also keeps its own folder at `~/.hobkin/checks/<id>/`, and every run starts with both files in it. `memory.md` is the check's working memory: checkpoints, open items and what it has already reported. Its agent maintains the file, and you can edit it too. `log.md` has one line per run, written by Hobkin, with the time, trigger, outcome, duration, cost and first report line.

A check that could do none of its work says `Blocked:` in Chat. If one source is down, it does the rest and reports that source as unverified. After two blocked or failed runs in a row, Hobkin stops scheduling it instead of retrying: Schedules shows it as held, and it tries again after 1 day, then 2, 4 and 7. A working run or a schedule edit clears the hold, and you can still run it on request.

When a check becomes held, the agent brings you a plan without being asked. As soon as it is free, it reads the check's log, memory and schedule file and the failing run's tool errors, then tells you in Chat what failed, the real cause with its evidence and what it proposes, and asks yes or no. It changes nothing before a yes. On a yes it carries out the plan and runs the check once to prove it, and a working run clears the hold. On a no the check stays held. You are asked once per hold, and a retry that fails is still the same hold. If the fix is yours to make, such as reloading a browser extension, the plan says exactly what to do and the agent offers to run the check afterwards. A hold the agent has not reached when you quit gets its plan the next time you open Hobkin, and a turn that gets cut off is picked up then too, up to three tries. Each plan costs one main agent turn.

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

Ask the agent and it spreads what it schedules without being told: a weekly check goes on the day with the fewest, a monthly one on the emptiest date, and hours stay apart, while morning briefings stay in the morning. A day or time you name wins. `hobkin schedules` shows when each check runs.

For a check that runs once, put the file in `once/` with a `date` (`YYYY-MM-DD` in the file's timezone) plus `at` or `window`. If Hobkin was not running at that time, the check runs as soon as it is, however late. It never runs twice, and once it has run it leaves Schedules: its file moves to `checks/<id>/`, next to its log. The [schedule guide](../src/prompts/schedule-setup.md) covers multiple daily times, hourly windows and weekly/monthly settings. Hobkin reloads edited schedules automatically. Keep the dashboard open for checks to run.

## Start Pi through a launcher

If Pi must start through a wrapper, for example one that sets up credentials or required extensions, add `launcher` to Hobkin's `config.json`:

```json
"launcher": { "command": ["my-pi-launcher", "pi"], "env": { "EXAMPLE_MODE": "1" }, "managedExtensions": true }
```

Hobkin then starts every Pi process with that command. The main chat runs as an RPC child (`my-pi-launcher pi --mode rpc`), and checks, reflection, pattern review and repair use the same command. `env` adds variables and rejects credential-like names. Hobkin passes its own environment through and never reads credentials. Set `managedExtensions` when the launcher loads required extensions and refuses `--no-extensions`. Tool-free jobs then keep their other isolation flags. If the main chat's child exits, Hobkin says so and keeps running scheduled checks; restart it to reconnect the chat. Without `launcher`, Hobkin runs `pi` directly.

## Work mode

Work mode is a proactive agent mode to get work done on your projects. Type `/work` in Chat to turn it on or off. The first time, Hobkin asks which folder to start from, and `/work ~/Projects` names it directly or looks somewhere new. While it is on, a Work Mode tab sits beside Schedules, with a green circle while it is active and an orange one while it is paused. `/work` leaves you in Chat and says when the tab appears or goes. The agent looks only in that folder, one folder at a time, reading each repository's git history to see what is published and still moving. The tab always says what is happening now and when the next look is.

A look is finished only when every root folder is done. A run that stops sooner is picked up from where it stopped, up to two more times, and then Hobkin tells you it stopped early and why. A finished folder is not looked through again, because the daily watcher proposes new repositories with no tokens. A failed or unfinished look comes round again, and `/work <folder>` or `hobkin work trigger discover` looks whenever you ask.

When the look ends, Hobkin says in Chat which projects it proposes, main projects first, with what it found and how critical it thinks each one is, and asks which to take. If it finds nothing or fails, it says that too, with the reason. Answer in Chat, or in the Work Mode tab: `y` takes a proposal, `1`, `2` or `3` takes it as critical, important or casual, and `n` skips it. Nothing starts on a project until you pick it.

From then on, agents work on those projects without being asked. One studies each project and then looks through it for security issues, bugs, updates, chores, improvements, features and trends, filing what it finds. Another takes those items one at a time and finishes each on a `hobkin/*` branch. Work mode moves in small, finished, reviewable steps that make a project a bit better each time: a large idea is filed as its first small step. A project's priority sets how often it comes round: P0 gets a look every hour, P1 every 3 hours, P2 every 8 and P3 every 24, and each look takes the next of those areas in turn. That brings every area round in 7 hours at P0, within a day at P1, in about two days at P2 and in a week at P3. A look runs at its project's own priority, so it does not fall behind that pace, and new commits halve the wait. New ideas come every eighth look, up to 3 at a time, fewer the more open work it has. The level sets the model and how hard it thinks, and a project with no priority of its own takes one from its level. A `max` project stays 12 hours between looks, because each run is the dearest there is.

Every item starts with a test or check that fails.

A review runs only when you ask for one. When a draft is done, Hobkin asks `Draft is done... Want to review it?`, with no model and no tokens. A yes puts that item at the front of the queue, and its next run reviews the branch with the tooling it has, such as `agentic_code_review` in Pi. `Not now`, Esc or simply typing leaves it in READY, where `r` or `hobkin work review <project> <item>` asks for a review at any time. Drafts that finish close together share one question, and it waits while you are typing or the chat is busy.

 A finished item records `summary`, `proof` and `left`, which is anything left for you.

Work reaches you as a local PR: a local `hobkin/*` branch and a saved PR description for you to review, with nothing pushed. The tab lists these under READY, where `d` opens one's diff and `x` closes it, and `hobkin work pr` prints one. The diff opens in [pi-coder](https://github.com/dantetekanem/pi-coder), in a Pi of its own in a Herdr pane. That pane closes by itself once you have been away from it for five minutes and its agent has nothing to do. Outside Herdr, `d` says what to type. `hobkin setup` says how to install pi-coder.

A run can open helpers of its own, such as a code review, in a pane beside it. Hobkin checks on them with no tokens: while one is working the run is left alone, and once one has been quiet for six minutes the run is told which one stopped and to finish without it. When the run ends, what it opened goes with it, and an empty tab closes. A PR opens only when a project asks for it: `r` on its row or `hobkin work prs` sets `draft` or `published`, and the default is `off`.

No permission is ever needed. All work is branch work and git can bring everything back, so agents never ask and never report `Blocked:`. The one thing an agent may ask about, in Chat, is deleting what git cannot bring back, and it finishes everything else meanwhile. Deploying and publishing are left for you the same way. A run that ends without an outcome goes straight back in the queue one grade lower, down to P3, and the next run carries on from the branch. No timer ends a run, and an item that keeps failing keeps coming round without holding anything else up.

Work mode works in your project folders. **When a project's folder is clean, idle and on its default branch, an agent switches it to a `hobkin/*` branch and works there, so you will see that in your folder while a run is going.** Before a run it brings the default branch up to date with a fast-forward only, and it never commits to that branch, merges into it or rewrites it. When the run ends the folder goes back to the default branch and the work stays on its own branch. Looks stay on the default branch and only read. Hobkin never resets or cleans your folder, and it checks all of this as each run starts:

- Uncommitted or untracked files, another branch, a merge or rebase in progress, or a default branch that has diverged from origin: that run uses a worktree, as it does when another agent is in the same repository or a look needs to run tests, and the tab says why in a few words. If an item needs git in your folder, the agent first keeps anything uncommitted on a branch or a named stash, and says so in its summary.
- You switch branches during a run: the run stops rather than commit to the wrong branch, nothing is forced, and the item goes back in the queue.
- You changed something while a run was going: the folder stays as it is at the end, and the project says so.

A second run on a repository waits if it is small, and takes a worktree otherwise.

To start over, turn work mode off and run `hobkin work reset`, or ask the agent. It forgets the projects, proposals and notes and removes its trees, and the next `/work` looks from nothing. Your folder, harness, limits, work mode directions and every branch stay.

One queue decides what runs next across all projects, and the tab shows it. Every row has a grade, P0 to P3. An item starts at its project's priority and moves down one grade for medium impact, two for low and one for each failed try, stopping at P3. Urgent and attention items are P0, and agents run them like any other. A grade you set yourself stays where you put it. Your picks go first, then P0 rows, then the top row of a project with no run for 24 hours, then the rest. Within those the order is grade, fewer tries, project priority, then worth: how much a change matters and how soon it brings a benefit. Ranking is code and spends no tokens, and looks file `impact` and `effort` on each item. Items wait for a project's study only until a first one has been tried.

When a worker is free and the budget allows it, the top of the queue starts by itself. To steer it, select a row in the tab: Enter runs it as soon as a worker is free, inside the budget, `p` changes an item's grade, and `s` skips it, which keeps it at the end of the queue until `s` puts it back. With `hobkin work auto off`, or by asking the agent, only what you select runs and work mode stays on.

`p` on a project row sets the priority its items start at. With none set, max and critical are P0, important P1 and casual P2. Priorities and PR settings live in Hobkin's data, not in the repository.

Two agents run at once by default, and `hobkin work agents <number>` changes it, up to a ceiling of 8. Starts go one at a time. With nothing running the next one starts within 30 seconds, and while a run is going they are up to 5 minutes apart so it can show what it costs, less as the queue gets longer. A row that keeps failing waits 10 minutes more after each try, up to an hour, while everything else goes past it. Schedules take priority: they never wait on work mode, and a running check takes a worker's place.

Run `/work` again to stop. The tab goes away, a look in progress stops and carries on from its notes next time, project agents finish, nothing new starts, and projects, items and branches stay. In the tab, Enter on a running agent's row opens that agent, and `k` there cancels it. A cancelled item goes to the end of the queue, skipped, until `s` or `hobkin work back` puts it back.

Work mode watches its tokens. The Work Mode tab shows fresh tokens used today against a daily limit, 100 million by default, with cache reads beside them, as in `6m/100m tokens · 49m cached`. Only fresh tokens count against a limit. Running agents count as they go, from their session files. Set the limit for good with `hobkin work tokens <number>`. Any rolling hour can use at most a 12th of it, then new work waits for the hour to move on. Past half the limit a project gets one idea at most.

Before anything starts, its cost is estimated from what similar runs really cost, by kind of run and level, and it waits if it would not fit what is left of the hour or the day. The queue says so on its row. P0 rows skip the hourly share, and nothing skips the daily limit.

Work mode also protects your subscription, whatever the daily limit is. Every Pi job reads the usage windows the provider puts on its replies, with no credentials and no extra request. Work keeps 30% of each window for your chat and checks, and may not get more than 30 points ahead of a window's clock, so a week cannot go on a Monday. Until a reading exists, or for a provider that gives none, one agent runs at a time and the tab says so. If a run fails on a usage or rate limit, every start stops at once, Chat says so once, nothing retries, nothing counts against the project, and work carries on when the limit lifts. A `claude` pane counts when its run ends, from Claude Code's own session file, and a `codex` pane cannot be measured, so each counts as its estimate. Either way one runs at a time.

A limit pauses work mode, and nothing is lost: running agents finish, items stay, and the tab shows `● paused` with which limit it was and the real numbers. The hourly pause clears on its own, and Chat hears about it once. The daily one lasts until tomorrow. If work is waiting then, Hobkin says in Chat what it used, what is waiting and what a higher limit would change, including the hourly share it gives. Press `y` or `n` on that row in the Work Mode tab, answer in Chat, or use `hobkin work allow [number | no]`. That lasts until midnight.

Hobkin finds merged work by itself. A survey every half hour, also while work mode is off, closes an item as `merged` when its PR merged or the default branch holds its branch, and `hobkin work sync` does it now. Only a merge closes an item: after a PR closed without merging, the item goes back to its local branch, in state `branch`, for your review. The survey only reads your repositories and costs no tokens, and the tab shows what is still unmerged.

Once a week, in code with no tokens, Chat gets a review: whether work mode is running and progressing, with real numbers, and which projects look stale and are worth dropping, with the exact `hobkin work drop <slug>`. It never drops anything itself, and `hobkin work review` prints it at any time.

Once a day, while work mode is on, a watcher looks through your folder and the folders of projects one level down, with a few read-only `git` calls per repository, no tokens and no fetch. New repositories and ones that came back to life are proposed the usual way, from their git facts alone, saying they were not looked at in depth. It leaves out folders your work directions rule out, and a skipped project comes back only with clear new activity, and only once. New commits in a project you took bring its next look forward, and start nothing by themselves.

`max` is a level above critical, for super critical work. A project or item at `max` runs on Claude Code with `claude-opus-5-5` at `max` effort, whatever harness is set, under the same queue, panes and limits as everything else. Outside Herdr there is no pane for Claude Code, so it runs on your normal harness and model at their highest effort instead. It looks every 12 hours. Set it with `4` pressed twice, or `hobkin work choose <slug> max` and `hobkin work max <slug> <item>`. Agents cannot set it. Because every run is the dearest there is and shares your Claude subscription with your own work, one runs at a time and six a day, and the tab shows the count. Hobkin cannot see your Claude usage windows, so nothing here can stop at a Claude reserve the way it does for Pi.

Inside Herdr, work on the projects you took runs where you can watch it: a Herdr tab called Work Mode opens without taking focus, with up to four panes in an even grid. A fifth agent opens Work Mode 2, the lowest tab with room is always used first, and an empty tab closes. Every pane closes when its agent finishes, and a failed run keeps its last lines in its report. A pane you close yourself ends that run, and its item goes back in the queue. A `hobkin session` pane closes by itself too, unless it was started with `--keep`. The tab shows which harness runs them: `pi`, `claude` or `codex`. To change it, ask the agent in Chat. `claude` and `codex` panes start with their permission checks skipped, so a pane never waits for approval. Outside Herdr, the same work runs in the background through Pi.

Work mode and checks run only while the dashboard is open. The main agent drives work mode through `hobkin work`, and so can you or a script. `hobkin work help` lists every command:

| Command | What it does |
| --- | --- |
| `hobkin work status` | On or off, any pause and why, tokens, limits and what is next |
| `hobkin work projects`, `items [project]` | What there is, and `--state` narrows it. `items` shows each `grade`, `branch`, `attempts`, `lastError`, `summary`, `proof` and `left` |
| `hobkin work running`, `queue`, `attention` | Each agent, the plan in order, and what waits on you |
| `hobkin work search <text>` | Finds projects by name or path, and items by title, summary, `left` or last error |
| `hobkin work pr <project> <item>`, `diff <project> <item>`, `review` | A local PR, its diff in pi-coder, or the weekly review |
| `hobkin work start [folder]`, `stop` | The same as `on` and `off`, and `/work` in the dashboard |
| `hobkin work pause [project]`, `resume [project]` | Stops new work, everywhere or on one project. Work mode stays on and running agents finish |
| `hobkin work add project <path> [level]`, `add item <project> <title>` | Adds by hand |
| `hobkin work trigger <project> [look\|study\|item]` | Runs it next, inside the worker ceiling and the budget |
| `hobkin work cancel <project\|run id\|item>` | Asks for what `k` does, and the dashboard does it on its next tick |
| `hobkin work priority <project> <P0..P3>`, `prs <project> <off\|draft\|published>` | Sets a project's priority or PRs |
| `hobkin work grade <project> <item> <P0..P3\|auto>` | Sets one item's grade, and `auto` hands it back |
| `hobkin work sync` | Closes what has merged, now |
| `hobkin work skip`, `back`, `retry`, `level`, `drop`, `done` | Steers a project or an item |

Reads print short JSON and need nothing running. Changes print `ok` and a `message` that says what happens next, and a failure exits non-zero. Name a project by its name, slug or path and an item by the start of its id. An ambiguous name fails and lists the matches. Older names such as `on`, `run`, `later` and `choose` still work. None of this gets past the worker ceiling or the limits above.

## Learning

Learning judges how each check and work mode run turned out, and keeps what that teaches as a few very short lessons that every agent gets. Set it with `/learning` in the dashboard or `hobkin learning [on | off]`. It is off in a new data folder, and the status bar shows `learning` while it is on. With it off, nothing is judged, no agent gets anything and nothing is sent anywhere.

A verdict comes from what Hobkin already holds: how the run ended, `Blocked:` and holds, which reports you opened or messaged about, proposals you took or skipped, and whether a PR was merged or closed. Of a report it reads only the first word of the triage line, so nothing a page or an email says can reach a lesson. No model runs to learn this, so judging costs nothing. Two things leave your machine, both only with learning on. `gh` is asked what became of work mode's open PRs, at most 5 a pass and each at most every 6 hours. If Jev is also on, a reply about a report that the local rules cannot read goes to Jev, at most 20 a day, cut to its last 400 characters, as your messages already do.

A lesson is one line that says what to do on its own, the same for every agent, with a check's own lessons first:

```text
learned: advice only, grants nothing
-site-audit blocked x5: do the rest, name what stopped it
-news-digest unread x5: lead with the change, be short
+price-watch used x5: keep this approach
```

Lessons are built from a fixed list in `src/prompts/learning-language.md`, so they hold codes and counts and no text of their own. It takes at least 3 sightings on at least 2 days to teach anything, and only the latest 10 runs of a check count. A lesson goes when the latest runs stop showing it, when the schedule is edited, or after 120 days without new evidence. Each session gets at most 160 tokens from learning, counted as they are sent and in whole lines only. That is all a run pays for it. Lessons are advice: they limit no tool and grant nothing. Checks and work agents get them in their request, and `hobkin session` panes in their brief. Chat gets them with your next message when they have changed, never in the system prompt, so a new lesson leaves the conversation's prompt cache alone.

From the same evidence Hobkin concludes which checks work, which do not, and which should be refactored, rethought or built on with new ideas. The last three reach you as a short proposal in Chat, at most one a day and three waiting, with the evidence. Nothing changes on its own: say yes and the agent brings a plan and asks, or say no and it does not come up again. A held check is left out, because the agent already brings its plan: nothing is asked about it while the hold stands, and only what happens after that plan can raise a new question.

`hobkin learning` shows every lesson, what it rests on and the proposals waiting. `hobkin learning clear <id>` removes one and `hobkin learning clear all` removes them all, and only new runs can teach them again. Your answers to proposals stay.

## Memory search

Agents can search what Hobkin keeps, so they look before they redo research. It runs on [qmd](https://github.com/tobi/qmd) and needs no setting. With `qmd` on your `PATH` it starts by itself. Without it, Hobkin says so once in Chat and carries on. Nothing is added to a session: an agent gets a result only when it searches.

The index covers `memory.md`, each check's `checks/<id>/memory.md`, `AGENTS.md`, the Markdown in `notes/` and `runtime/lessons.md`. That last file holds every lesson as agents get them, and it goes away while learning is off. Reports and check logs stay out.

It is a local qmd index of its own, in `runtime/.qmd/` in the data folder, so each `--home` has its own and your other qmd indexes are left alone. The folder is private to you, it holds the same text as the files it covers, and nothing in it leaves your machine. To search it yourself, run `qmd` from that `runtime/` folder:

```sh
cd ~/.hobkin/runtime
qmd search "invoice"
qmd query "what was decided about the invoice"
```

Hobkin keeps it fresh while the dashboard is open, and stops when it closes. It compares file times every 10 seconds. When something has changed and stayed put for 20 seconds, it runs `qmd update`, `qmd embed` and `qmd status`, one at a time and at the lowest priority. Update and status take about a tenth of a second on a small index. Embed does nothing unless text changed, and then loads a 330 MB model on your machine, at no token cost. qmd downloads that model the first time if it is not there yet. `qmd search` uses no model, so it works while embedding catches up.

`hobkin status` shows the last pass, such as `Index 14 files · embeddings up to date · checked 2026-11-01T12:33:00.000Z`.

## Chrome

Hobkin uses `pi-chrome` when it is installed, in chat, checks and work mode alike, with no time limit and no `/chrome authorize`. Agents read public pages and your own projects freely. Opening banking, financial, health, government, mail or other private accounts, or changing anything through the browser, needs an approved plan first: your yes in Chat, or a check's own instructions.

## Use it from other agents

`hobkin skill` prints a skill that teaches an agent to read reports and run history, add checks, queue one-time work and stay out of Hobkin's internals. Read it directly, or save it where your agent loads skills:

```sh
mkdir -p ~/.pi/agent/skills/hobkin
hobkin skill > ~/.pi/agent/skills/hobkin/SKILL.md
```

These commands read saved state without starting Pi or schedules:

```sh
hobkin status --plain
hobkin schedules
hobkin history
```

## Recovery and other guides

Only one dashboard can own a workspace. After a crash, a check that was running is marked interrupted rather than retried, and a work item carries on from its branch. A stale lock can take up to five minutes to expire; do not delete a live dashboard's lock. Costs are estimates, not invoices. See [architecture and recovery details](v2-design.md).

To find recurring work in selected past sessions, use the optional [session review](../src/prompts/session-patterns-setup.md). For the older Pi extension, see the [legacy guide](legacy.md). Migration instructions include an [agent checklist](upgrade.md#agent-checklist).
