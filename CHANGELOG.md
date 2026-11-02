# Changelog

## Unreleased

- Land and deploy in bulk only from a list the user said yes to. `hobkin work ready` prints what can land by real grades, each pinned to its commit, and why the rest cannot, including a branch rated A that brings earlier work rated lower. The main agent brings that list, what it left out and its numbered steps before anything starts, and answers from what it checked rather than from what it told an agent to do. `hobkin session` refuses a fourth session in 30 minutes unless the user approved the list.
- Keep test runs away from the user's Herdr. A test run inherits `HERDR_ENV`, so a test that opened hobkin could open real panes and close real ones.
- Move `working` and its timer from the tab row down beside `memory`, so a running turn no longer takes room from the tabs.
- Ask before quitting with agents at work: stop them, or let them finish. Agents left going keep working in their Herdr panes, and the next hobkin picks up each one and records it as usual, so a restart stops nothing. A signal lets them finish, because it cannot be asked.
- Add a quality grade beside the safety grade. The review run goes through a branch with `security-expert`, `test-expert` and `database-engineer`, whichever fit, because each found real problems on branches graded safe when tried. It also says who would notice the change.
- Add a Decisions tab. A question from a routine or work mode stays on screen for 30 seconds, then waits there with a one-line summary and numbered choices. `hobkin decide` lets a run file one and carry on, and the answer reaches it later.
- Add a Done subtab to Work Mode, to walk through finished work and land it. Five rows at a time, safest and smallest first, each with its safety grade, size and what is missing. `m` merges locally and pushes nothing, `w` sends an agent back with a note, `n` says no and Enter reads it. This replaces READY.
- Review each finished branch by itself, because the merge grade is how to tell what can ship. This replaces asking before each review, and `hobkin work reviews off` turns it off. A markdown-only branch is skipped, and a rebase that changes nothing keeps its grade.
- Close gaps before making more work: reviews, rebases and missing descriptions or proof go ahead of new items, and the last two only for the next five rows.
- See what is really waiting: a branch stacked under a newer one folds into it, and work already on one of the user's own branches says so.
- Add a `yours` item for a step only a person can take, so looks stop writing runbooks onto branches.
- Add All, Scheduled and Work Done subtabs to Reports, opening on All. Up from the first report reaches them, Left/Right changes subtab there, and Down goes back to the reports. Typing `/` in the list filters report titles as you type, ignoring case, across every saved report rather than the 25 the list shows. The filter stays until Esc or Ctrl+C clears it.
- Open a main tab or a Reports subtab with a mouse click.
- Make the first run seamless. With no model, `hobkin` asks the user to sign in before it opens, through Pi's own sign-in screens, and then starts setup by itself on a home with no routines, chat or profile. `hobkin login` signs in again at any time.
- Say why in Chat when the model refuses a turn. A bad key or an expired login used to look like hobkin ignoring the user.
- Get to know the user in `/setup`: their name, what to call them, their email and which services to connect through MCP. `hobkin profile` shows or changes the details, and the chat and every check get them. Opening hobkin greets the user by name in the tip row for 30 seconds, in one of seven ways.
- Write the name as hobkin across the main window: labels, tips, the input box, `/help`, what it posts in Chat and its error notices. The main agent is told to write its own name that way too.
- Rename Schedules to Routines: the tab, messages, docs, prompts, `hobkin routines`, the `run_routine` tool and the `routines/` folder in Hobkin's data. The dashboard moves the folder the next time it opens and leaves `schedules` as a link, so a path written inside a routine keeps working. `hobkin schedules` still works.
- Compact the main chat ahead of time. From 80% it compacts when the chat is quiet and either agents are working or the next check is 2 hours away or more. At 95% it is forced: a running turn compacts between model calls and carries on by itself, and new work and messages wait for it. A failed compaction holds nothing up.
- Run a review only when the user asks for one. A finished draft asks `Draft is done... Want to review it?` with no model and no tokens, a yes puts it first in the queue for a run that reviews the branch, and `r` on a READY row or `hobkin work review <project> <item>` asks at any time. Items that told an agent to review a branch left the queue for READY.
- Let a project's priority decide how often it runs: a look every hour at P0, every 3 hours at P1, 8 at P2 and 24 at P3, with new ideas every eighth look. That brings each of the seven lenses round in 7 hours at P0 and a week at P3, and a look now runs at its project's own priority so it keeps that pace. The level still sets the model and how hard it thinks, and a project with no priority of its own takes one from its level.
- Have Hobkin edit every report itself before the user reads it, whichever agent wrote it. A no-tools job on the checks model rewrites the draft in plain sentences with a bundled copy of humanizer. An edit that changes the triage label, a number, a link or any code is thrown away, and a failure leaves the report as written.
- Let the user answer a question in their own words. Every `ask_question` gets an Other row to type in, which reaches the agent as `typed`, and Esc chooses none. The list shows every choice when the terminal has room. A dialog from another extension stays a closed list.
- Open a local PR's diff in pi-coder: `d` on a READY row or `hobkin work diff` starts a Pi in a pane of its own on the branch's range, and the pane closes itself a few minutes after the user leaves it. Without pi-coder nothing opens, outside Herdr the key says what to type, and `hobkin setup` says how to install it.
- Close what a run or session leaves behind. An agent a tool opened beside it, such as a code review, goes when it ends, so an empty tab closes too.
- Check on helpers with no tokens. A run waiting on a working review gets no nudges, a review Herdr calls done still counts while its screen moves, and one that has stopped for good is named to the run, which finishes without it.
- Let an authorized push include its draft PR, whatever the project's `prs` setting says about agents working by themselves.
- Keep an extension's notes to the agent out of Chat. A message marked `display: false`, such as the task reminder from `pi-solid-tasks`, showed up as `◇ custom`.
- Let `r` reply to a report, the same as `m`.
- Give every Pi pane Hobkin opens all of the user's extensions.
- Stop a long queue sitting idle. With nothing running the next row starts within 30 seconds, and the gap between starts shrinks as the queue grows. A row that keeps failing waits longer after each try while everything else goes past it, and the tab's Next line now says what starts next instead of a look hours away.
- Close the last ways a run could stop, found by an audit. A Pi pane can no longer ask a question and wait, a run that goes quiet for an hour goes back in the queue, a dead rebase or a broken tree no longer stops the next run, a trigger always starts with auto-pick off, and an agent can record only `open`, `branch`, `pr`, `done` or `dropped`. A finished branch is released from its tree, so it can be checked out for review, and uncommitted work is committed to its own branch before a tree is reused.
- Stop repeating the look through a folder that is finished. The daily watcher proposes new repositories with no tokens.
- Add `hobkin setup`, which reads and changes nothing, and `/setup`, where the agent walks a new person through Pi, `gh`, models, Jev and their first routines. The first failures a new person meets now point at it.
- Focus on shipping. The survey finds which branches conflict or fail CI and files a rebase for each. A project with 5 or more waiting to merge moves features and improvements down a grade and gets no new ideas, and nothing waits. READY lists what merges as it stands first, and the weekly review says how much is waiting.
- Slide new chat messages up from the bottom edge and fade them in instead of jumping onto the screen, and fade rows leaving at the top rather than cutting them off. A streaming reply rises the same way, and nothing moves while you have scrolled up to read. Each message now keeps its rendered rows between frames, so a redraw of a long chat no longer rebuilds all its markdown.
- Keep the Mac awake while Hobkin is open, through `caffeinate`, so checks and work run on time. The display still dims and sleeps, and it ends when Hobkin closes.
- Wake the face when the user starts typing, so a sleeping Hobkin waits for the command.
- Cut the README to what a new reader needs, about a tenth of its size, and move the full reference to `docs/guide.md`.
- Spread routines by default. The main agent puts a weekly check on the emptiest day, a monthly one on the emptiest date and keeps hours apart, with morning briefings staying in the morning, and `hobkin routines` now shows when each check runs.
- Stop work mode blocking. No permission is ever needed: all work is branch work and git can bring everything back, so work agents never ask and never report `Blocked:`. The one thing an agent may ask about, in the main window, is deleting what git cannot bring back, and it finishes everything else meanwhile. Deploying and publishing are left for the user the same way, in a `left` line.
- Keep every item moving. A run that ends without an outcome goes back in the queue one grade lower, down to P3, and the next run carries on from the branch, so there is no stuck state, and an item that keeps failing cannot hold up the rest. A cancel sends the item to the end of the queue, skipped, until `s` or `hobkin work back` puts it back.
- Grade every queue row P0 to P3. An item starts at its project's priority and moves down one grade for medium impact and two for low, stopping at P3, and urgent and attention items are P0. `hobkin work grade` or `p` on a queue row overrides it. The order is grade, fewer tries, project priority, then worth, with the user's picks first, then P0 rows, then a project with no run for 24 hours, whose top row moves up behind the P0s. P0 rows skip the hourly share, and nothing skips the daily limit.
- Turn Needs attention into P0 rows at the top of the queue, which agents run like any other.
- Keep per project settings in Hobkin's data, not in the repository. `hobkin work priority` or `p` on a project row sets its priority, and with none set max and critical are P0, important P1 and casual P2. `hobkin work prs` or `r` sets its PRs to `off`, `draft` or `published`. The level still sets how often it looks and how hard it thinks, and no longer decides drafts.
- Deliver work as a local PR by default: a local `hobkin/*` branch and a saved PR description for the user to review, with nothing pushed. The Work tab lists these under READY, `hobkin work pr` prints one, and a PR opens only when a project's setting asks for one.
- Start every item with a test or check that fails.
- Record `summary`, `proof` and `left` on each finished item. `hobkin work items` shows them, with `grade`, `branch`, `attempts` and `lastError`.
- Find merged work without being asked. The half hour survey, also while work mode is off, closes an item as `merged` when its PR merged or the default branch holds its branch, and `hobkin work sync` does it now. A PR closed without merging sends the item back to its local branch, in state `branch`, and the work stays there for review.
- Remove the unmerged stop, with `hobkin work unmerged` and the turn the main agent got when it fired. The tab still shows unmerged counts.
- Add a weekly review, in code with no tokens. Chat gets whether work mode is running and progressing, with real numbers, and which projects look stale, with the exact `hobkin work drop <slug>`. `hobkin work review` prints it at any time, and it never drops anything itself.
- Give routines priority: they never wait on work mode, and a running check takes a worker's place.
- Stop work waiting for the main chat to be free, and let items wait for a project's study only until a first study has been tried. A folder that cannot be used, even one with a diverged default branch, now means a worktree instead of a held project.
- Start `claude` and `codex` panes with their permission checks skipped, so a pane never waits for approval.
- Remove `hobkin run` and running without the dashboard. Work mode and checks run while the dashboard is open.
- Close a `hobkin session` pane by itself when the work ends. The session writes a report to `runtime/handoffs/<name>.report.md`, and a watcher in its own process closes the pane when that file appears, when the agent stops without one, or when the agent is gone. `--keep` is for a whole conversation the user means to carry on in, and that pane stays open.
- Give a routine's report the blue dot of the Routines tab in Reports. A work mode report keeps the green one, and a failed run is a red cross on both.
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
- Add learning, off by default: `/learning` or `hobkin learning [on | off]`. It judges how checks and work mode runs ended from what Hobkin already records, with no model call, and keeps very short lessons that reach every agent, 160 tokens at most as sent. Conclusions about routines reach Chat as short proposals, nothing changes without a plan and a yes, an answered proposal is never raised again, and a held check is left to its own plan. `hobkin learning` shows what was learned, and `hobkin learning clear` removes it.
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
- Add one-time routines: files in `routines/once/` with a required `date`. They run once at their local time, catch up after downtime, never repeat, and then leave Routines, with the file kept in `checks/<id>/`. Status and the dashboard count the ones still to come.
- Let weekly routines take a list of weekdays, such as `[1, 2, 3, 4, 5]` for Monday to Friday.
- Migrate a home that has no pi-scheduler records without installing the scheduler package. A saved daily wake that was never scheduled no longer blocks migration.
- Accept saved sessions up to 256 MiB in migration, and check the main conversation's identity from its header line at startup, so long-running conversations keep starting.
- Add Companion-only memory: a short list in `memory.md` that the agent maintains. Chat sees it on every turn; scheduled checks can read it but not change it.
- Give each check a `memory.md` it maintains and a Companion-written `log.md` under `checks/<id>/`, both supplied to every run, so checks stop rediscovering their tools and reconstructing their history from transcripts and the database.
- Add a `Blocked:` report line and stop retrying stuck checks. After two blocked or failed runs in a row, a check is held and tries again after 1, 2, 4, then 7 days. A working run or a routine edit clears the hold, and manual runs still work.
- Show the next run the newest outcome, including manual runs and failure errors that were previously dropped.
- Keep scheduled checks running until every agent they spawned has reported, so a check no longer finishes with its interim reply as the report.
- Exit as soon as Companion has closed, so a leftover connection cannot delay quitting.
- Separate report notices in Chat with a blank line.
- Line up Chat, Reports and Routines: each opens on the same heading row with entries at the same inset, the day stays pinned above a chat that overflows, and a divider holds one footer row across every view.
- Show the total size of Companion's memory files in the footer.
- Show occasional tips in the footer.
- Let the agent change one routine's model or effort, list the models available, and show each routine's effort in Routines.
- Track which reports get opened, locally, and flag checks whose reports go unopened in Routines and in tips, so they can be revisited.
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
