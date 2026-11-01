# Changelog

## Unreleased

- Give work mode one small command surface, for the main agent and for people. `hobkin work status`, `projects`, `running`, `queue`, `items`, `search` and `attention` print short JSON with nothing running. `add`, `start`, `stop`, `pause`, `resume`, `trigger`, `cancel`, `skip`, `retry`, `level`, `drop` and `done` take a name, slug or path and the start of an item id instead of queue keys, never guess at an ambiguous name, and print `ok` and a `message` saying what comes next. `hobkin work help` lists them all, and a wrong command prints it. Older names still work.
- Let `pause` stop new work everywhere or on one project, with work mode left on and running agents finishing. `trigger` makes a look due at once, still inside the worker ceiling and the budget, and `cancel` reaches a running agent from another process through a request the owner reads on its next tick.
- Print a failed work command as `ok: false` on stdout with a non-zero exit, where it used to be an error on stderr, and stop an idle `resume` restarting the unmerged count. It does that only when there is an unmerged stop to clear.
- Plan work mode across all projects. One ranked queue of studies, looks and items replaces walking project by project, and it ranks by level, urgency, impact and how soon a change brings a benefit, in code, with no tokens. Looks file `impact` and `effort`, and items stay small.
- Run few agents, one step at a time: 2 by default where it used to be half the machine's cores, with 8 as the ceiling, 5 minutes between starts, and checks taking a place. `hobkin work agents` changes it.
- Make the queue something to steer: Enter on a row runs it now, `s` skips it and puts it back, and `hobkin work auto off` stops auto-pick and leaves work mode on. Stuck items say why, and Enter tries one again.
- Estimate each run from what similar runs really cost, and start it only if it fits what is left of the hour and the day. Urgent items on critical projects skip the hourly share and never the daily limit.
- Make every pause say which limit it hit, with its real numbers. An hourly pause offers no raise, because it clears by itself, and a daily one says what raising it changes, including the hourly share. The hourly share is now a 12th of the day, from what runs really cost.
- Show cached tokens beside fresh ones, count running agents as they go, and keep a day's allowance from becoming a permanent limit.
- Protect the subscription: read the real usage windows from each job, keep a reserve of every window for chat and checks, stop at once on a usage limit with nothing counted against the project, and give way to a busy chat.
- Work in a project's own folder on a plain branch when it is clean, idle and on its default branch, with a fast-forward-only default branch as the source of truth, and fall back to a worktree when it is not. Nothing resets or cleans that folder.
- Stop new work when 30 pieces are unmerged, or 6 on one project. The main agent then says what it thinks is blocking and asks, once for each stop, and a merge starts work again.
- Add a daily watcher, in code with no tokens, that proposes new and revived repositories and moves a project's next look up when it has new commits.
- Add the `max` level: Claude Opus at max effort, whatever harness is set, one at a time and six a day.
- Lay panes out in an even grid of four, open Work Mode 2 when a tab is full, reuse the lowest tab with room, and close every pane when its run ends. A failed run keeps its last lines in its report, and a pane closed by hand ends only that run.
- Keep a run going when one record from Pi is too big to read. A long run's last record repeats all its messages, and that used to fail the run when its work was done.

- Add memory search. Hobkin keeps a private qmd index of `memory.md`, each check's memory, `AGENTS.md`, notes and learned lessons in `runtime/.qmd/`, fresh in the background at low priority, and teaches every agent the command to search it before redoing research. Nothing is added to sessions, each `--home` has its own index, `hobkin status` shows how it stands, and without qmd Hobkin says so once and carries on.
- Add learning, off by default: `/learning` or `hobkin learning [on | off]`. It judges how checks and work mode runs ended from what Hobkin already records, with no model call, and keeps very short lessons that reach every agent, 160 tokens at most as sent. Conclusions about schedules reach Chat as short proposals, nothing changes without a plan and a yes, an answered proposal is never raised again, and a held check is left to its own plan. `hobkin learning` shows what was learned, and `hobkin learning clear` removes it.
- Bring a plan when a check becomes held. Once per hold, as soon as it is free, the main agent looks into why, says in Chat what failed, the real cause with its evidence and what it proposes, and asks yes or no. It changes nothing before a yes, then runs the check once to prove the fix. A hold not yet explained is explained on the next start.
- Make `Blocked:` mean a check could do none of its work. With one source down, a check does the rest and reports that source as unverified, and it no longer tests a known-broken dependency first and stops there.
- Let Page Up and Page Down read the conversation behind a question that fits its box, so a long plan can be read before answering on a small terminal.
- Turn work mode on and off with `/work` alone. The Work Mode tab shows only while it is on, and the harness changes by asking the agent.
- Let running agents finish when work mode stops, and stop a cancelled agent from starting again by itself.
- Look straight away when work mode starts with nothing to show, and always say in the tab what is happening now and when the next look is.
- Show the folder, the step and the repositories found while discovery looks, then say in Chat what it proposes and ask which to take. Answering there works, because what is waiting now travels with the next message to the main agent. A look that finds nothing or fails says why.
- Count a look as finished only when every root folder is done. A run that stops sooner is picked up from where it stopped, up to two more times, and the user is told if it stops early.
- Add `/help`, a short guide in Chat.
- Let Tab finish a `/` command, and walk through them when several fit.
- Make Ctrl+C clear the input, and quit on a second press when there is nothing to clear. Ctrl+Q quits straight away.
- Leave `pi-emote` out of everything Hobkin starts: the main chat, checks, work panes and `hobkin session`. Pi keeps it.
- Rename the project from Pi Companion to Hobkin: a new repository, the `hobkin` command, `~/.hobkin` as the data folder and `HOBKIN_HOME` to move it. `pi-companion` stays as it was, and older entries keep its name.
- Add Hobkin's face beside the input in Chat. It shows idle, thinking, working and happy from what the app is doing.
- Add Jev, which picks from all 18 moods as things happen. `/jev` or `hobkin jev [on | off]` sets it, and the README says what it sends.
- Add `AGENTS.md` in the data folder: standing directions for the main chat, checks and work mode.
- Add `hobkin session`, which hands massive work or a whole conversation to a full Pi session in a Herdr pane, from a brief saved in the data folder.
- Add `hobkin import`, which copies a pi-companion folder into this one and leaves the old folder unchanged.
- Add work mode: `/work` and a folder to start from sends an agent to find the projects there and propose them, and agents then study each project taken, file work and open PRs from their own worktrees.
- Run work on chosen projects in panes of a Herdr tab called Work Mode, on the harness the user picks.
- Design ideas for each project daily, fewer when it has open work, and spread work mode's tokens across a daily limit. At the limit it pauses and asks for a higher allowance, saying why.
- Let every Companion run use Chrome with no time limit. Private accounts and changes through the browser need an approved plan.
- Note an extension's error in the report instead of ending a healthy run, and name the extension.
- Add an optional `launcher` setting. With it, every Pi process starts through the configured command: the main chat as an RPC child that keeps Companion's tools, and checks, reflection, pattern review and repair. `managedExtensions` skips `--no-extensions` for installations that refuse it. Without `launcher`, nothing changes.
- Show the main binding and any launcher in `pi-companion status`.
- Read large Pi output records in linear time, stop Pi children when Companion exits, and decline extension dialogs in unattended checks instead of waiting.
- Add one-time schedules: files in `schedules/once/` with a required `date`. They run once at their local time, catch up after downtime, never repeat, and then leave Schedules, with the file kept in `checks/<id>/`. Status and the dashboard count the ones still to come.
- Let weekly schedules take a list of weekdays, such as `[1, 2, 3, 4, 5]` for Monday to Friday.
- Migrate a home that has no pi-scheduler records without installing the scheduler package. A saved daily wake that was never scheduled no longer blocks migration.
- Accept saved sessions up to 256 MiB in migration, and check the main conversation's identity from its header line at startup, so long-running conversations keep starting.
- Add Companion-only memory: a short list in `memory.md` that the agent maintains. Chat sees it on every turn; scheduled checks can read it but not change it.
- Give each check a `memory.md` it maintains and a Companion-written `log.md` under `checks/<id>/`, both supplied to every run, so checks stop rediscovering their tools and reconstructing their history from transcripts and the database.
- Add a `Blocked:` report line and stop retrying stuck checks. After two blocked or failed runs in a row, a check is held and tries again after 1, 2, 4, then 7 days. A working run or a schedule edit clears the hold, and manual runs still work.
- Show the next run the newest outcome, including manual runs and failure errors that were previously dropped.
- Keep scheduled checks running until every agent they spawned has reported, so a check no longer finishes with its interim reply as the report.
- Exit as soon as Companion has closed, so a leftover connection cannot delay quitting.
- Separate report notices in Chat with a blank line.
- Line up Chat, Reports and Schedules: each opens on the same heading row with entries at the same inset, the day stays pinned above a chat that overflows, and a divider holds one footer row across every view.
- Show the total size of Companion's memory files in the footer.
- Show occasional tips in the footer.
- Let the agent change one schedule's model or effort, list the models available, and show each schedule's effort in Schedules.
- Track which reports get opened, locally, and flag checks whose reports go unopened in Schedules and in tips, so they can be revisited.
- Fix Companion failing to start after a saved effort the current model does not support, and refuse a model without credentials before saving it.
- Keep a running check's next occurrence in the forecast, so the footer no longer skips an hourly check while it runs.
- Keep the header on one row when a job starts, where it fits, by shortening the status first.
- Add `m` inside a report to message about it: the report goes to the agent with your question, Chat shows only what you typed, and the conversation continues there.
- Draw the composer with a line above and below instead of a box.
- Show a sent message in Chat at once under `You`, gray until the agent has it. One sent while the conversation is busy waits its turn instead of failing.
- Let the main agent message a running check, so what the user says reaches it before its report.
- Add `pi-companion skill`, which prints a skill that teaches other agents to work with Companion.

## 0.1.6 - 2026-10-29

- Add `pi-companion reports` to list reports and `pi-companion reports delete ID...` to remove selected reports.
- Refresh the live dashboard after deletion and keep deleted reports out of saved and imported listings. Preserve run receipts so deletion does not replay completed checks.

## 0.1.5 - 2026-10-29

- Add the standalone `pi-companion` CLI with persistent chat, Markdown reports, live job tabs and Pi themes.
- Define daily, weekly and monthly checks in editable Markdown files. Run them through Pi with configured tools, extensions and MCP servers.
- Show running checks and their output; use `k` to cancel a selected job. Jobs have no automatic execution deadline.
- Add resumable migration from the Pi extension, preserving saved conversations, schedules, history and paused states.
- Make `/reset` start a fresh conversation and zero the displayed cost estimate without deleting history or stopping background checks.
- Fix concurrent legacy-owner startup and retry after scheduler setup failures.
- Shorten the README, guides and agent prompts; add the CLI screenshot and migration instructions for users and agents.

## 0.1.4 - 2026-09-11

- Save Companion's Herdr pane and workspace to a temporary location file on start.
- Automatically inject that location and `tail.md` into new Pi sessions, without agent-led discovery or schedule lookup.

## 0.1.3 - 2026-09-11

- Inject taste-maintenance instructions with every Companion start and review; maintain learned preferences in `~/.companion-notes/taste.md` throughout conversations and approved scheduled work.
- Restore durable context and a lightweight map of notes on returning starts, retrieving daily details only when needed.
- Shorten the prompts while preserving source permissions, evidence rules, and report safeguards; keep research references in the README.

## 0.1.2 - 2026-09-11

- Guide first-start onboarding through routines, goals, habits, approved sources, and optional voice, scheduler, and subagent setup.
- Add `/companion review` and propose an opt-in weekly review using the same bundled instructions.
- Ask questions in ordinary chat and leave unanswered requests pending. Account for corrected context and stop repeated collection failures within a run.
- Append useful review findings to the existing reports file without disturbing Herdr tail panes.

## 0.1.1 - 2026-09-11

- Direct the agent to append important updates and reports to `~/.companion-reports-updates.md`, with stable publication IDs and duplicate checks.
- Offer an optional, user-approved Herdr pane to follow the reports file on first startup.
- Remove `companion_save` and the updates/reports views. Preserve existing saved results and session-scoped schedule controls.
- Replace lookaround expressions in result validation with OpenAI-compatible schema patterns.
