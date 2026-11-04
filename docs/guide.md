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

Coming from pi-companion? Close it, then run `hobkin import`. That copies `~/.companion` into `~/.hobkin`, with your routines, memory, reports and conversation, and points them at the new folder. The old folder is not changed. Run only one of the two: each would run every routine.

Hobkin uses your ordinary Pi tools, extensions, MCP servers and project context. It leaves out `pi-emote`, because it has a face of its own: the chat and background runs never load it, and Pi keeps it. A pane Hobkin opens, for work or a session, is your ordinary Pi with every extension, that one too. With a launcher, the launcher decides which extensions load. Models configured in Pi, including Anthropic/Claude models, work here. Pi's own screens and custom extension widgets are not reproduced.

Updating Hobkin? Read the [CLI update steps](upgrade.md#already-using-the-cli). Moving from the older Pi extension? Read the [legacy migration steps](upgrade.md#legacy-pi-extension-before-planning). Opening a new workspace never imports old data or disables that extension.

## Use it

Chat opens ready to type. Reports holds every completed check, newest first, 25 to a page under the day they ran: Page Down and Page Up turn the pages, and the arrows carry on past a page's last or first report. Routines shows their next run and any configuration errors. In Reports, a routine's report has the blue dot of the Routines tab, a work mode report has a green one, and a failed run is a red cross on both. Running checks get their own read-only tabs. Finishing the selected check opens its report.

- **Enter** sends a message or opens the selected report. Your message shows in Chat straight away, gray until the agent has it. One sent while the agent is busy waits its turn.
- **Ctrl+V** attaches the image on the clipboard to the message you are writing, or a copied image file. A small preview and an `image 1` row appear above the input: a real picture in Ghostty and Kitty, including inside Herdr, and text cells in other terminals, tmux and with `HOBKIN_FACE=blocks`. **Esc** removes the newest image first, **Ctrl+C** clears them with the draft, and **Enter** sends them even with nothing typed. A message holds up to four. The agent gets them as images it can see, and Chat marks the message with `↳ 1 image`. Anything longer than 1568 pixels or over about 750 KB is shrunk first, and a clipboard image over 64 MB is refused. A model that cannot see images says so instead of attaching one. Images wait in `runtime/pasted/`, readable only by you, and go once the message has gone. Each sent image stays in the conversation's transcript under `sessions/`, so a chat holds more than 200 even at the largest size. Once its transcript is within 32 MB of the size hobkin will reopen, the chat refuses more images and `/reset` starts a fresh one. Text keeps working. With text on the clipboard Ctrl+V does what it always did, which is nothing; paste text with your terminal's paste key.
- **When the agent asks you something**, pick an answer with the arrows and **Enter**. The last row, Other, takes your own words. **Esc** chooses none. The mouse wheel and **Page Up/Down** still scroll the conversation above it, so you can read all of what it is asking about, and the wheel over a question too long for its box scrolls the question.
- **Left/Right** changes views when the chat draft is empty; otherwise it moves the cursor. A click on a tab opens it too.
- **Arrow keys** select reports. **Page Up/Down** and the mouse wheel scroll.
- **Up** from the first report reaches the row of subtabs: All, Scheduled and Work Done. There, **Left/Right** changes subtab and **Down** goes back to the reports, and a click on a subtab works from anywhere. Reports opens on All.
- **/** in Reports filters by title as you type, ignoring case. The arrows move through the matches and **Enter** opens one. The filter stays while you read or change subtabs, until **Esc** clears it.
- **m** inside a report moves to the composer with that report attached, so you can ask about it and carry on in Chat. **Escape** in the composer drops the report and keeps your draft.
- **Escape** leaves a report or returns to Chat without losing the draft.
- **k** cancels the selected running check. Jobs have no automatic execution deadline.
- **Ctrl+C** clears the input. With nothing to clear, press it twice to quit. **Ctrl+Q** quits straight away.

Type `/` to see local commands, and press Tab to finish one, or to walk through them when several fit. `/help` shows a short guide in Chat. `/clear` hides visible chat without deleting history or changing model context. `/reset` starts a fresh conversation and resets the displayed cost estimate; old transcripts, usage history and background work remain. `/learning` turns [learning](#learning) on or off. Pi's editor shortcuts and configured editor keybindings work in the composer.

The first time, hobkin asks you to sign in to a model before it opens, using the same sign-in as `/login` in Pi, and then starts setup by itself. `hobkin login` signs in again, for a key that was refused or a login that ran out. If the model refuses a turn, Chat says why.

`/setup` also asks your name, what to call you and your email, and which services to connect through MCP. It skips what is already saved and you can skip the rest. Once it has a name, hobkin greets you with it in the tip row each time it opens. The name and email go to the model provider with every agent's prompt, so the chat and your checks know who they work for. `hobkin profile` shows them, `hobkin profile name`, `call` or `email` followed by a value changes one, and `hobkin profile clear` forgets them.

Colors follow Pi's saved theme. The header shows connection state; the status bar shows the next check, the total size of Hobkin's memory files, model, context usage and estimated cost. Critical and useful report summaries appear in Chat. A scheduled check that found nothing new keeps only its line in `checks/<id>/log.md`, with no report, and a run you asked for still shows its report. Occasional tips appear above the shortcuts.

Hobkin's face sits left of the input bar in Chat and follows what is happening. hobkin shows all 18 moods, and plain code chooses them, so the same moment always gives the same mood: hello when a session starts, thinking while the agent writes, searching while it reads, working while it runs any other tool or while a check or work agent runs, focused when it has thought for 5 minutes, listening while you type or when something waits on you, happy after a useful report or a long turn, celebrating when a merge lands, love when you clear everything waiting, wink when you answer at once, sad when you say no to work or hear bad news, grumpy when a merge hits a conflict or the same work stalls twice, confused when the work changed under your answer or a command is unknown, surprised when something stops by itself, error when something blows up, dizzy with too much at once and sleepy after 15 quiet minutes. Telling it the work is bad makes it sad, and it will not cheer up at the very next thing. What you type is read in memory for this, in English and Portuguese, and is kept nowhere. In Ghostty and Kitty it plays the design's own animation, including inside Herdr. Each frame is sent once, so animating it only changes text, and only the mood on screen stays in the terminal. Other terminals, tmux and `HOBKIN_FACE=blocks` use block characters instead. It hides on a terminal under 76 columns or 20 rows.

Ask the agent for a different model or thinking effort and the conversation switches on its next model call, with no restart. Each routine has its own model and effort, and its reports use them: name a check to change only that one, and its next run picks it up. Routines shows each check's effort.

The main chat compacts itself in two ways, and you can see it in the footer. From 80% of the context window it compacts ahead of time when nobody needs it: the chat has been quiet for 2 minutes, and either other agents are working or the next check is at least 2 hours away. At 95% it is forced. During a turn Pi compacts between model calls and the turn carries on by itself. New work and your own messages wait for it and then continue, and routines keep their time. A compaction that fails holds nothing up and tries again 10 minutes later. Turning auto-compaction off in Pi turns both off. The 95% setting stays in memory, so your Pi settings do not change. On a window under about 328,000 tokens it comes a little sooner, to keep the room Pi needs.

Hobkin edits every report before you read it, whichever agent wrote it. A small job with no tools, on your checks model, rewrites the draft in plain sentences. It uses the guide in `src/prompts/humanizer.md`, based on [blader/humanizer](https://github.com/blader/humanizer) under the MIT license in `src/prompts/humanizer.LICENSE`, so it needs nothing installed. The edit has to keep the report's first label, its `Next:` line and every number, link and piece of code. If it changes one of those, fails, or takes over three minutes, you get the report as the agent wrote it. `Nothing new.` reports skip this. Each edit costs about 8,500 tokens, and it does not count against work mode's daily limit.

Hobkin notices which reports you open or message about. A check is flagged in Routines, and mentioned in tips, when at most 1 in 5 of its latest reports was, across at least 5 reports and a week of tracking, with no critical finding and no run you requested. Nothing changes on its own: ask the agent to revisit a flagged check. This stays in the data folder as run IDs and timings in `runtime/telemetry.jsonl` and a per-check summary in `runtime/report-attention.json`, and a summary you only read in Chat does not show up.

The agent keeps a short list of what matters right now in `memory.md` in the data folder: up to 20 one-line items that it adds, updates and removes as things change. Ask it to remember or forget something, or edit the file yourself. The list stays within Hobkin, chat sees it on every turn, and scheduled checks can read it but not change it.

`AGENTS.md` in the data folder holds your standing directions: how the main chat, checks and work mode should work. Memory is what matters now; this is how to work. Edit it yourself or tell the agent, and the next turn or run follows it. It starts with one direction: agents do not spawn subagents. For massive work they run `hobkin session`, which opens a full Pi session with all permissions in a new pane of a Herdr tab called Hobkin and starts it on the brief. The pane closes by itself when the work ends: the session writes a report to `runtime/handoffs/<name>.report.md`, and a watcher in its own process closes the pane when that file appears, when the agent stops without one, or when the agent is gone. `--keep` is for a whole conversation you mean to carry on in: ask to carry on with another agent, the new one starts from a brief saved in the data folder, so nothing depends on how long it is, and that pane stays open. Outside Herdr the agent does the work itself.

Each check also keeps its own folder at `~/.hobkin/checks/<id>/`, and every run starts with both files in it. `memory.md` is the check's working memory: checkpoints, open items and what it has already reported. Its agent maintains the file, and you can edit it too. `log.md` has one line per run, written by Hobkin, with the time, trigger, outcome, duration, cost and first report line.

A check that could do none of its work says `Blocked:` in Chat. If one source is down, it does the rest and reports that source as unverified. After two blocked or failed runs in a row, Hobkin stops scheduling it instead of retrying: Routines shows it as held, and it tries again after 1 day, then 2, 4 and 7. A working run or a routine edit clears the hold, and you can still run it on request.

When a check becomes held, the agent brings you a plan without being asked. As soon as it is free, it reads the check's log, memory and routine file and the failing run's tool errors, then tells you in Chat what failed, the real cause with its evidence and what it proposes, and asks yes or no. It changes nothing before a yes. On a yes it carries out the plan and runs the check once to prove it, and a working run clears the hold. On a no the check stays held. You are asked once per hold, and a retry that fails is still the same hold. If the fix is yours to make, such as reloading a browser extension, the plan says exactly what to do and the agent offers to run the check afterwards. A hold the agent has not reached when you quit gets its plan the next time you open Hobkin, and a turn that gets cut off is picked up then too, up to three tries. Each plan costs one main agent turn.

## Add a routine

Create a Markdown file in `~/.hobkin/routines/daily/`, `weekly/` or `monthly/`:

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

Ask the agent and it spreads routines out without being told: a weekly check goes on the day with the fewest, a monthly one on the emptiest date, and hours stay apart, while morning briefings stay in the morning. A day or time you name wins. `hobkin routines` shows when each check runs.

New routines can start from a template. `/setup` asks about your work, your life and what you are working towards, then offers the two or three templates that fit, for your day, your code, your week, your life and your machine, and asks what a template needs to know, such as whose birthdays to keep. Each template is one file with a short header: what it reports, when it runs best, what it needs and who it fits. Your own go in `routines/templates/` in your data folder, in the same format, one file each, and one named like a built-in template replaces it. `hobkin routines templates` lists them all as JSON and names any it cannot read. The format is in [src/prompts/routine-templates/README.md](../src/prompts/routine-templates/README.md).

Each built-in template has a version. When an update brings a new one, or a newer version of one, Chat says so once, and you can ask for a routine from it. A routine you already made from a template keeps working as it is.

For a check that runs once, put the file in `once/` with a `date` (`YYYY-MM-DD` in the file's timezone) plus `at` or `window`. If Hobkin was not running at that time, the check runs as soon as it is, however late. It never runs twice, and once it has run it leaves Routines: its file moves to `checks/<id>/`, next to its log. The [routine guide](../src/prompts/routine-setup.md) covers multiple daily times, hourly windows and weekly/monthly settings. Hobkin reloads edited routines automatically. Keep the dashboard open for checks to run.

## Start Pi through a launcher

If Pi must start through a wrapper, for example one that sets up credentials or required extensions, add `launcher` to Hobkin's `config.json`:

```json
"launcher": { "command": ["my-pi-launcher", "pi"], "env": { "EXAMPLE_MODE": "1" }, "managedExtensions": true }
```

Hobkin then starts every Pi process with that command. The main chat runs as an RPC child (`my-pi-launcher pi --mode rpc`), and checks, reflection, pattern review and repair use the same command. `env` adds variables and rejects credential-like names. Hobkin passes its own environment through and never reads credentials. Set `managedExtensions` when the launcher loads required extensions and refuses `--no-extensions`. Tool-free jobs then keep their other isolation flags. If the main chat's child exits, Hobkin says so and keeps running scheduled checks; restart it to reconnect the chat. Without `launcher`, Hobkin runs `pi` directly.

## Work mode

Work mode is a proactive agent mode to get work done on your projects. Type `/work` in Chat to turn it on or off. The first time, Hobkin asks which folder to start from, and `/work ~/Projects` names it directly or looks somewhere new. While it is on, a Work Mode tab sits beside Routines, with a green circle while it is active and an orange one while it is paused. `/work` leaves you in Chat and says when the tab appears or goes. The agent looks only in that folder, one folder at a time, reading each repository's git history to see what is published and still moving. The tab always says what is happening now and when the next look is.

Under that, a line says about how many jobs work mode expects to start in the next 8 hours, by priority, as in `Next 8h: about 9 jobs · 5 P0 · 3 P1 · 1 P2 · 2 agents at a time.` The reply to `/work` ends with the same line. It plays the real queue forward with no model: what is ready, the looks that come due at each project's pace, your agents, the gap between starts, the daily budget and its hourly share, and any pause. When something holds the number down, it says what, such as `The daily budget caps it.` A run takes as long as the middle of the last 12 like it, and about 10 minutes for an item or 4 for a look until 3 have been timed. `hobkin work status` carries it as `forecast`, counted as if the mode were on.

A look is finished only when every root folder is done. A run that stops sooner is picked up from where it stopped, up to two more times, and then Hobkin tells you it stopped early and why. A finished folder is not looked through again, because the daily watcher proposes new repositories with no tokens. A failed or unfinished look comes round again, and `/work <folder>` or `hobkin work trigger discover` looks whenever you ask.

When the look ends, Hobkin says in Chat which projects it proposes, main projects first, with what it found and how critical it thinks each one is, and asks which to take. If it finds nothing or fails, it says that too, with the reason. Answer in Chat, or in the Work Mode tab: `y` takes a proposal, `1`, `2` or `3` takes it as critical, important or casual, and `n` skips it. Nothing starts on a project until you pick it.

From then on, agents work on those projects without being asked. One studies each project and then looks through it for security issues, bugs, updates, chores, improvements, features and trends, filing what it finds. Another takes those items one at a time and finishes each on a `hobkin/*` branch. Work mode moves in small, finished, reviewable steps that make a project a bit better each time: a large idea is filed as its first small step. A project's priority sets how often it comes round: P0 gets a look every hour, P1 every 3 hours, P2 every 8 and P3 every 24, and each look takes the next of those areas in turn. That brings every area round in 7 hours at P0, within a day at P1, in about two days at P2 and in a week at P3. A look runs at its project's own priority, so it does not fall behind that pace, and new commits halve the wait. New ideas come every eighth look, up to 3 at a time, fewer the more open work it has. The level sets the model and how hard it thinks, and a project with no priority of its own takes one from its level. A `max` project stays 12 hours between looks, because each run is the dearest there is.

Every item starts with a test or check that fails.

A review runs only when you ask for one: `Get it reviewed` on a card, or `hobkin work review <project> <item>`. It costs about $2 and 14 minutes of a worker, and it runs next, ahead of new work. In Pi that is `agentic_code_review`, which grades a branch safe, medium or risky, with a letter from A to F. The same run goes through the branch with `security-expert`, `test-expert` and `database-engineer`, whichever fit the diff, and records a quality letter and who would notice the change. It fixes what all of this finds, then reviews once more, so the grade belongs to the last commit: a review that read on from one commit to a later one files its grade under the later one. A branch of markdown alone is not reviewed, and a rebase that changes nothing keeps its grade. A grade is information, never a gate. Work with proof can land with no grade, or with a grade for an older commit, and only a review that rated its commit below safe holds it back. `hobkin work reviews on` gives each finished branch a review by itself, as its next run, and the survey every half hour asks one for a branch that missed it, two at a time and only once for each commit. It is off unless you turn it on. When work can land, hobkin asks `...can land. Walk it now?`, with no model and no tokens. Branches that finish close together share one question, at most one every two hours. Each branch already waits in Decisions, so the question leaves once it has had its 30 seconds on screen, and its yes opens Done, or Decisions with work mode off.

A question from a routine or work mode never holds anything up. It stays on screen for 30 seconds, then moves to the Decisions tab. The same happens at once if you press Esc or keep typing, or if the chat is busy, and it waits while you have a card open. A question from your conversation with hobkin is about what the agent just said, so it opens in Chat under that message, whichever tab you were on, and answering it takes you back there.

Decisions lists everything waiting on you, with work mode on or off, and appears while anything waits. Its groups are what went wrong, questions, finished work to approve and not landed, your turn, work already elsewhere, and reports with a `Next:`. Each group says how many it holds, and the tab counts them all. Up and Down select a row and Enter opens it. An open row asks the way a question on screen does: what it is, each thing it can do in words, the arrows to choose, Enter to pick and Esc to go back. Letters do nothing on a card, so a key meant for another tab cannot act on one. An answer brings the list back with the next row selected. Whatever you do on a card, Chat says so in one system line that names the project and the title, with the link for a PR, and the main agent hears it with your next message. Nothing takes the place of the keys:

- A question opens with its full text and numbered choices, and a number answers it, as does Enter and a choice in its box. The choice the agent recommends is marked and the choices stay in the agent's order, because Enter takes the first and the first stays the harmless one. Below the question it says why only you can answer. A routine reads the answer in its memory on its next run, and a work item goes back in the queue with it.
- A learning proposal offers `Yes, plan it`, which has the main agent write a plan and ask about it before changing anything, `No, but ask me later`, which brings it back in a week, and `No, never again`, which for work mode reads `No, never again for this repo` and stops every proposal about that repo.
- TO APPROVE is a card for each finished branch or open PR, the highest priority first. Each says its priority, project, grades and size, and the selected one opens to what the work did, its proof, its PR and when it finished. Enter opens its page with its choices below it, as in Done, and Page Up and Page Down read the page. A PR merged from its card closes its item at once and leaves the list, and a card sent for a review leaves it until it comes back to approve with its grade.
- A step only you can take opens in place with all it says, and its card marks it done once you have sorted it.
- Enter on a report opens it in Reports.

A routine never asks the same thing twice. If you answered a question in the last 30 days, `hobkin decide` files nothing and hands the run your answer with its date, and the run carries on. Each question has a `key`, which comes from its words when the agent gives none. The agent can ask again only by saying what `changed`, and the tab shows that too. Work runs never get an earlier answer, because their one use of a question is deleting what git cannot restore.

The same holds for reports. A check that found nothing to act on says `Nothing new.`, even when the news is good. A report that needs you says `Next: <the one call>` on the line after its triage line, and Chat shows that with the notice. Only those reports count as waiting on you.

A report reads like a short essay: its first sentence is the one thing that matters most, then what backs it up, and sources and gaps last. Agents are asked to write it that way, and hobkin's editor moves the point to the front when they do not. The first line also carries a word for hobkin, `Critical:`, `Blocked:` or `Useful:`. `Useful:` tells you nothing, so the Reports tab leaves it out, in old reports too, and the saved file keeps it for hobkin to read.

When 8 or more calls pile up and you are there, hobkin shows a card and asks how you want to tackle them. It counts every source together: finished branches, reports with a `Next:`, launches that went wrong, questions, allowance requests, project and learning proposals, and steps left for you, across all routines and work mode. There is one row for each kind, in its own color, with a count and one fact. An empty kind has no row, and `Not now` comes first because Enter takes the first:

- `●` ready: an offer, or work with its proof and nothing in the way, graded or not, unless its review found it below safe or its quality below B. `Start with the N ready` opens Decisions.
- `◐` to read: every other branch, and reports with a `Next:`.
- `▲` went wrong: trouble on a launch, or a critical or blocked report with a `Next:`. `Just what went wrong` opens it. A launch lives on the Work tab, so with work mode off the main agent takes it instead.
- `?` questions: what routines and work mode asked, and requests and proposals.
- `◇` yours: steps only you can take.

`Walk it all` opens Decisions, which lists every row the card counts. The Other row takes your own words, as in "drop the old finboard branches", and they reach the main agent with the card's rows attached. Pressing a number answers, and typing anywhere else on the card means not now, with what you typed going on to where you were.

You count as there for two minutes after a key, a click or the mouse wheel, or after the terminal gains focus, and not once it loses focus. Inside Herdr focus reports may not arrive, so keys and clicks are enough alone. The card waits while you are writing a message or a note, while a turn runs, while another question is up, and while you are in Decisions or Done, which is where it would send you. It gets 30 seconds on screen unless you use it, and it stops nothing. After a card hobkin stays quiet for 4 hours, unless 5 more calls arrive or something new goes wrong, and a restart remembers that. `hobkin pending` prints the same rows as JSON and changes nothing.

A finished item records `summary`, `proof` and `left`, which is anything left for you.

Work reaches you as a local PR: a local `hobkin/*` branch and a saved PR description, with nothing pushed. The Done subtab of Work Mode is where you walk through them: press up from the first row to reach the subtabs, or click one. With more than one project waiting, BY PROJECT at the top says how much waits on each, the biggest pile first, with its P0s. TO APPROVE shows five at a time, the highest priority first and then the safest and smallest, each with its priority, its safety and quality grades, its size and anything missing. Enter opens a card's page and asks what to do with it:

- `Merge it` merges into the default branch on this machine, away from your folder, and pushes nothing. Uncommitted changes in the files it touches stop it, and so does a conflict, and so does a branch that moved since the card showed it. An open PR offers `Merge the PR on GitHub` instead, pinned the same way, and `Open the PR in the browser`.
- A branch behind its base says `refresh and merge`, and so does its merge choice: picking it sends an agent to bring the branch up to date with the base and run its proof again, and hobkin merges it once that run ends well, because picking it was your word.
- A card offers its merge first, graded or not, and `Get it reviewed` further down. Only a card rated risky at its commit offers its review first, since Enter takes the first choice, and its merge says so: `Merge it anyway: it is rated risky`. A card that conflicts offers `Have an agent rebase it` and no merge.
- `Show the diff` opens the diff and keeps the card open. `Cancel it` keeps the branch, and learning reads it as your answer. `Ask for changes` is the last row: type what to change and Enter sends an agent back with your words.

A done item with work on its branch offers to merge it or close it, and a step or work already elsewhere offers to close it.

Asked to land or deploy a batch, the main agent starts from `hobkin work ready`. Work with proof goes on it, graded or not, pinned to the commit the survey read. It reads each grade from the review of that exact commit, and leaves out work a review rated below safe there, and any branch that brings such work with it. It lists every finished branch and every open PR, one row per branch and none left off. A PR row names its `pr`, at the head its host reports, because it lands there and not on this machine. A PR the last survey did not see open, or whose head it did not read, says so instead of a grade. It brings you a table of the exact items, what it left out and why, and the numbered steps, then asks. A yes covers those items at those commits and nothing else. `hobkin session` refuses a fourth session in 30 minutes unless the agent passes `--approved`, which it does only after that yes.

Hobkin closes what it can before you get there. A rebase goes to an agent by itself, and so does a row among the next five with no description or proof. These go ahead of new work, and AGENT ON IT shows them. A branch stacked under a newer one folds into it, and merging the newer one closes both. YOUR TURN holds what only you can do, and ALREADY ELSEWHERE holds work one of your own branches already has, where `x` closes it. On the page Enter opens, `d` opens the diff and `r` asks for a review. `hobkin work pr` prints the same page. The diff opens in [pi-coder](https://github.com/dantetekanem/pi-coder), in a Pi of its own in a Herdr pane. That pane closes by itself once you have been away from it for five minutes and its agent has nothing to do. Outside Herdr, `d` says what to type. `hobkin setup` says how to install pi-coder.

`done` means no change was needed, so an agent recording `done` on a branch with commits the default branch lacks is recorded as `branch`. Older items that say `done` with work still on their branch show under NOT LANDED, where `m` lands one and `x` closes it for good. So does `hobkin work done`, and it stays closed. A `hobkin/*` branch with no item gets one from the survey, titled from its last commit. A branch ending in `-kept-` and a time is what a run left uncommitted, so it stays with that run's item and gets none. A branch ending in `-before-` and an item's id, or `-before-rebase-` and a commit or a date, is a backup a run made before rewriting a branch, so it gets no item, no fix and no say in where work landed, and the survey drops what it filed for one before, keeping the branch.

Every merge writes `landed` on its item, in code: the commit, the route (`key`, `offer`, `batch`, `pair`, `chat`, or `remote` for one the survey found), whether the page or the diff was read and for how long, the grades, the size and the area. A row whose kind of change has landed before says so in a few words, such as `like 3 merged`.

#### Offers

An offer replaces walking to the Done tab for a change like one that already went well. It is one decision with the harmless choice first, because Enter takes it: Later, Merge it, Read it, Not this one. It says what happened to the last one, in counts and never percentages, and a precedent still in its watch says so. It names the one risk to look at and how to undo it, and it says what hobkin cannot see on that project. Later and Read it hold the offer for a day. At most one comes every two hours, and hobkin never merges by itself: the merge is your word, and if the branch moved since you were asked, it refuses and says so.

A pattern is `project/kind/area`. The area is the two folders holding the most changed lines, leaving out tests and docs, or `docs`, `tests` or `deps` for a branch that touches nothing else, and `multi` past two areas. For `docs`, `tests` and `deps` alone a precedent from another project counts, and the offer says where it came from.

| Tier | Needs | What you get |
| --- | --- | --- |
| new | nothing landed like it | the normal walk |
| seen | something landed, and no trouble since | one offer at a time |
| earned | a clean weight of 8 or more | up to five alike on one decision, which stops at the first failure and leaves the rest |

What counts is what happened after a merge, never the yes. A change that held weighs 1, one on a project that cannot show how it went weighs 0.5, and one that nothing exercised weighs nothing. Weights halve every 90 days. An `n` or a `w` takes one off. Trouble starts the pattern again, and severe trouble turns it off until `hobkin work trust <pattern> on`. `hobkin work trust <pattern> off` is your own switch for any pattern.

Whatever its history, a branch gets no offer if it is below safe A, has a grade from an older commit, is rated below B for quality, changes over 300 lines, touches too many areas, has a conflict, has no proof, leaves anything for you, deletes tests, can only be undone one way, or brings earlier work below safe A with it. The same goes for a path naming migrations, schema, auth, sessions, tokens, secrets, payments, billing, CI or deploy config. One qualifying item in five goes through the normal walk with no offer and no precedent, marked `spot` in `landed`, so hobkin can compare what offers cost. `hobkin work offers` lists what qualifies and why the rest does not, and changes nothing. With learning off nothing is judged: there are no offers and no precedents, and the plain `can land` question stays.

A run can open helpers of its own, such as a code review, in a pane beside it. Hobkin checks on them with no tokens: while one is working the run is left alone, and once one has been quiet for six minutes the run is told which one stopped and to finish without it. When the run ends, what it opened goes with it, and an empty tab closes. A PR opens only when a project asks for it: `r` on its row or `hobkin work prs` sets `draft` or `published`, and the default is `off`.

No permission is ever needed. All work is branch work and git can bring everything back, so agents never ask and never report `Blocked:`. The one thing an agent may ask about, in Decisions, is deleting what git cannot bring back, and it finishes everything else meanwhile. Deploying and publishing are left for you the same way. A run that ends without an outcome goes straight back in the queue one grade lower, down to P3, and the next run carries on from the branch. No timer ends a run that is still working, and one that goes quiet for an hour goes back in the queue. An item that keeps failing keeps coming round without holding anything else up.

Work mode works in your project folders. **When a project's folder is clean, idle and on its default branch, an agent switches it to a `hobkin/*` branch and works there, so you will see that in your folder while a run is going.** Before a run it brings the default branch up to date with a fast-forward only, and it never commits to that branch, merges into it or rewrites it. When the run ends the folder goes back to the default branch and the work stays on its own branch. Looks stay on the default branch and only read. Hobkin never resets or cleans your folder, and it checks all of this as each run starts:

- Uncommitted or untracked files, another branch, a merge or rebase in progress, or a default branch that has diverged from origin: that run uses a worktree, as it does when another agent is in the same repository or a look needs to run tests, and the tab says why in a few words. If an item needs git in your folder, the agent first keeps anything uncommitted on a branch or a named stash, and says so in its summary.
- You switch branches during a run: the run stops rather than commit to the wrong branch, nothing is forced, and the item goes back in the queue.
- You changed something while a run was going: the folder stays as it is at the end, and the project says so.

A second run on a repository waits if it is small, and takes a worktree otherwise.

To start over, turn work mode off and run `hobkin work reset`, or ask the agent. It forgets the projects, proposals and notes and removes its trees, and the next `/work` looks from nothing. Your folder, harness, limits, work mode directions and every branch stay.

One queue decides what runs next across all projects, and the tab shows it. Every row has a grade, P0 to P3. An item starts at its project's priority and moves down one grade for medium impact, two for low and one for each failed try, stopping at P3. Urgent and attention items are P0, and agents run them like any other. A grade you set yourself stays where you put it. Your picks go first, then P0 rows, then the top row of a project with no run for 24 hours, then the rest. Within those the order is grade, fewer tries, project priority, then worth: how much a change matters and how soon it brings a benefit. Ranking is code and spends no tokens, and looks file `impact` and `effort` on each item. Items wait for a project's study only until a first one has been tried.

Turning work mode on, with `/work` or `hobkin work start`, starts nothing new by itself, so a long queue cannot fire at once. hobkin offers the next four rows it would start, in Decisions: `Not now`, `Start these 4`, `Start the first one`, or `Let it run the whole queue`, which turns auto-pick on. With auto-pick on, the top of the queue starts by itself when a worker is free and the budget allows it, and `hobkin work start --auto` turns the mode on that way. What closes a gap in finished work still starts by itself either way: a review, your note and a fix to get a branch merged. A plain retry goes back in line. To steer the queue, select a row in the tab: Enter runs it as soon as a worker is free, inside the budget, `p` changes an item's grade, and `s` skips it, which keeps it at the end of the queue until `s` puts it back. `hobkin work auto on` and `off` switch auto-pick without turning the mode off.

`p` on a project row sets the priority its items start at. With none set, max and critical are P0, important P1 and casual P2. Priorities and PR settings live in Hobkin's data, not in the repository.

Two agents run at once by default, and `hobkin work agents <number>` changes it, up to a ceiling of 8. Starts go one at a time. With nothing running the next one starts within 30 seconds, and while a run is going they are up to 5 minutes apart so it can show what it costs, less as the queue gets longer. A row that keeps failing waits 10 minutes more after each try, up to an hour, while everything else goes past it. Routines take priority: they never wait on work mode, and a running check takes a worker's place.

Run `/work` again to stop. The tab goes away, a look in progress stops and carries on from its notes next time, project agents finish, nothing new starts, and projects, items and branches stay. In the tab, Enter on a running agent's row opens that agent, and `k` there cancels it. A cancelled item goes to the end of the queue, skipped, until `s` or `hobkin work back` puts it back.

Work mode watches its tokens. The Work Mode tab shows fresh tokens used today against a daily limit, 100 million by default, with cache reads beside them, as in `6m/100m tokens · 49m cached`. Only fresh tokens count against a limit. Running agents count as they go, from their session files. Set the limit for good with `hobkin work tokens <number>`. Any rolling hour can use at most a 12th of it, then new work waits for the hour to move on. Past half the limit a project gets one idea at most.

Before anything starts, its cost is estimated from what similar runs really cost, by kind of run and level, and it waits if it would not fit what is left of the hour or the day. The queue says so on its row. P0 rows skip the hourly share, and nothing skips the daily limit.

Work mode also watches your subscription, whatever the daily limit is, and never pauses for it by itself. Every Pi job reads the usage windows the provider puts on its replies, with no credentials and no extra request, and the Work tab shows how much of each is used and how much of its time has gone. When work gets more than 30 points ahead of a window's clock, or past 70% of it, Chat says so once a day and hobkin asks whether to pause new work until the clock catches up, with Keep working first. A pause you choose ends by itself at that time, or sooner with `hobkin work resume`. Until a reading exists, or for a provider that gives none, one agent runs at a time and the tab says so. If a run fails on a usage or rate limit, every start stops at once, Chat says so once, nothing retries, nothing counts against the project, and work carries on when the limit lifts. A `claude` pane counts when its run ends, from Claude Code's own session file, and a `codex` pane cannot be measured, so each counts as its estimate. Either way one runs at a time.

A limit pauses work mode, and nothing is lost: running agents finish, items stay, and the tab shows `● paused` with which limit it was and the real numbers. The hourly pause clears on its own, and Chat hears about it once. The daily one lasts until tomorrow. If work is waiting then, Hobkin says in Chat what it used, what is waiting and what a higher limit would change, including the hourly share it gives. Press `y` or `n` on that row in the Work Mode tab, answer in Chat, or use `hobkin work allow [number | no]`. That lasts until midnight.

Hobkin finds merged work by itself. A survey every half hour, also while work mode is off, closes an item as `merged` when its PR merged or the default branch holds its branch, and `hobkin work sync` does it now. A PR you merge from its card closes its item at once, the same way. Only a merge closes an item: after a PR closed without merging, the item goes back to its local branch, in state `branch`, for your review. The survey only reads your repositories and costs no tokens, and the tab shows what is still unmerged.

A merge is where watching starts. Each one opens a launch, which goes `merged`, `pushed` once origin holds it, `live`, and closed. A repository with no remote counts as pushed when merged, and a change of markdown alone closes at once. A merge you have not pushed is not watched, so no clock runs on it.

A pulse runs with the survey, every half hour, mode on or off, with no model and no tokens. It fetches origin, which changes no branch and no file, reads CI on the commit with `gh run list --commit`, makes one GET of the project's proved health URL with a 10 second limit, and looks for reverts. It runs `git`, `gh` and that GET and nothing else, and never a command an agent wrote, because a project's own text could reach one. A `gh` or network failure is a gap and never a clean result: the launch stays open until it can be read or its limit comes.

A watch look is a look with the focus `watch`, one per project however many changes it covers. It comes an hour after a push and then every 12 hours at the project's priority, and at once at P0 when the pulse sees CI fail or the health URL answer badly. It subtracts the error classes seen before the merge from those seen after, says whether the touched paths were exercised and by how many requests, and writes a summary, because Kamal logs roll over at about 10 MB. It never deploys, rolls back or flips a flag. With the mode off none starts, and what is due goes ahead when it comes back on.

A launch closes on the later of 48 hours live and exposure seen, and after 7 days at most. WATCHING on the Done subtab has a row for each open one, with its stage, how long and what is known so far, and `hobkin work watching` prints the same.

| Outcome | Means |
| --- | --- |
| `held` | Exposure seen and nothing new. A revert in the 14 days after the merge still turns it to `trouble`. |
| `quiet` | The project cannot show exposure, and nothing went wrong. |
| `unexercised` | No exposure within 7 days, or a gap or failing check that never cleared. |
| `trouble` | A new error, a revert, a fix naming it, or your word. |

On trouble hobkin files an urgent `fix` naming the merge, whose run fixes forward or prepares a revert branch, and the look's report opens with `Critical:` so Chat hears at once. `hobkin work trouble <project> <item> [severe] [why]` is your word for the same thing, and `severe` is for data loss or an outage. A repeat files nothing.

Each review also records how to undo the change, the one thing most likely to go wrong and where to look first, and the page Enter opens on Done shows them. `undo` is `code` when a rollback or revert undoes it, `one-way` for drops, renames, type changes, emails, charges and external writes, `forward-fix` for data backfills, `two-phase` for serialized formats and job payloads, and `permanent` for published packages and app store builds. Agents use a flag only if rollback cannot undo the harm, a real named audience exists for partial exposure, or a flaky dependency needs a kill switch. Every flag gets an expiry when it is made, and when its watch closes clean hobkin files the removal as a `chore`, which you merge like any other branch.

Each project gets `work/<slug>/signals.json`, written by a `signals` look once it is studied and again every 30 days. The look runs each command before recording it, and hobkin works out the number from what was proved, each step needing the ones below it:

| Signal | hobkin can |
| --- | --- |
| 0 | not tell what is live |
| 1 | see when a change goes live: deploy, CI, release |
| 2 | see it working: request or run outcomes |
| 3 | prove it is up with a real page or smoke test, not `/up` alone |
| 4 | see new errors grouped and tagged by release |

`service` and `app` projects want 4, `site` wants 3, and `package` and `tool` want 1. Under what it wants, the look files what closes the gap with keys like `signal:logs`. Those rank as closing work does, at P1 or better, and features and improvements there step down one grade, unless you marked them by hand. Nothing waits on it. A project under signal 2 gets no watch look, and its launches close as `quiet` 48 hours after the push. A project row shows `signal 2`, and `hobkin work signals <project>` prints the record.

Once a week, in code with no tokens, Chat gets a review: whether work mode is running and progressing, with real numbers, and which projects look stale and are worth dropping, with the exact `hobkin work drop <slug>`. It never drops anything itself, and `hobkin work review` prints it at any time.

The review ends with a scoreboard of a few lines: what hobkin brought you (decisions, reports with a `Next:`, and allowance and learning requests), what you did with it, how many answers came in under 3 seconds, how many merges had the page or diff opened, and what hobkin settled alone: answers it recalled, checks with nothing new, watches that closed clean and fixes it filed on itself. An answer's seconds run from when the question came on screen, or in the Decisions tab from when that decision opened. A merge found on the remote says nothing about reading, so it stays out of that count. Everything here is counted from events and `landed` records, so what was not measured gets no line, and with no events yet it says so. The fight is working when calls fall and the share read stays up.

A failure in hobkin's own harness is never a call. Once a day, mode on or off, in code with no tokens, hobkin reads the last day of its own events for errors on screen, by where they came from, and runs that failed, by what failed: a work lane across projects, a routine, the main turn or compaction. A usage limit is the provider's word, so it does not count. A class seen 3 times or more in a day files a `fix` on the project that is hobkin itself, found by comparing each chosen project's folder with the one hobkin runs from. The brief holds the counts, the class, the events to look at and how to prove the fix, and no message text, because events hold none. A repeat files nothing, even once the fix is finished, so the same class needs a new look by hand if it comes back. Nothing starts by itself: work mode picks the item up like any other, and shipping first holds it too. If hobkin is not a chosen project, Chat gets one quiet line for each class instead, once.

Once a day, while work mode is on, a watcher looks through your folder and the folders of projects one level down, with a few read-only `git` calls per repository, no tokens and no fetch. New repositories and ones that came back to life are proposed the usual way, from their git facts alone, saying they were not looked at in depth. It leaves out folders your work directions rule out, and a skipped project comes back only with clear new activity, and only once. New commits in a project you took bring its next look forward, and start nothing by themselves.

`max` is a level above critical, for super critical work. A project or item at `max` runs on Claude Code with `claude-opus-5-5` at `max` effort, whatever harness is set, under the same queue, panes and limits as everything else. Outside Herdr there is no pane for Claude Code, so it runs on your normal harness and model at their highest effort instead. It looks every 12 hours. Set it with `4` pressed twice, or `hobkin work choose <slug> max` and `hobkin work max <slug> <item>`. Agents cannot set it. Because every run is the dearest there is and shares your Claude subscription with your own work, one runs at a time and six a day, and the tab shows the count. Hobkin cannot see your Claude usage windows, so nothing here can stop at a Claude reserve the way it does for Pi.

Inside Herdr, work on the projects you took runs where you can watch it: a Herdr tab called Work Mode opens without taking focus, with up to four panes in an even grid. A fifth agent opens Work Mode 2, the lowest tab with room is always used first, and an empty tab closes. Every pane closes when its agent finishes, and a failed run keeps its last lines in its report. A pane you close yourself ends that run, and its item goes back in the queue. A `hobkin session` pane closes by itself too, unless it was started with `--keep`. The tab shows which harness runs them: `pi`, `claude` or `codex`. To change it, ask the agent in Chat. `claude` and `codex` panes start with their permission checks skipped, so a pane never waits for approval. Outside Herdr, the same work runs in the background through Pi.

Work mode and checks run only while the dashboard is open, so nothing new starts once it closes. Quitting with agents at work in Herdr panes asks whether to stop them or let them finish, and Esc keeps hobkin open. Agents you let finish keep working in their panes. A small background process keeps each one going and closes its pane when it ends, and the next hobkin picks each one up, records its report and tokens, and hands its folder back, so restarting stops nothing. A signal such as a closing terminal lets them finish too, because it cannot ask. Work outside Herdr runs inside hobkin, so it stops when hobkin does and starts again on its next run. The main agent drives work mode through `hobkin work`, and so can you or a script. `hobkin work help` lists every command:

| Command | What it does |
| --- | --- |
| `hobkin work status` | On or off, any pause and why, tokens, limits and what is next |
| `hobkin work projects`, `items [project]` | What there is, and `--state` narrows it. `items` shows each `grade`, `branch`, `attempts`, `lastError`, `summary`, `proof` and `left` |
| `hobkin work running`, `queue`, `attention` | Each agent, the plan in order, and what waits on you |
| `hobkin work search <text>` | Finds projects by name or path, and items by title, summary, `left` or last error |
| `hobkin work ready` | What can land now, each pinned to its commit, open PRs included, and why the rest cannot |
| `hobkin work pr <project> <item>`, `diff <project> <item>`, `review` | A local PR, its diff in pi-coder, or the weekly review |
| `hobkin work merge <project> <item>`, `decline`, `ask <project> <item> [note]` | Merge it locally and push nothing, say no, or send an agent back |
| `hobkin work watching`, `signals <project>` | What landed and is still being watched, and what a project can show |
| `hobkin work trouble <project> <item> [severe] [why]` | Says a merge went wrong and files the urgent fix |
| `hobkin work reviews [on\|off]` | Whether each finished branch gets a review by itself. It is off unless you turn it on |
| `hobkin work start [folder] [--auto]`, `stop` | The same as `on` and `off`, and `/work` in the dashboard. Without `--auto` nothing new starts until you pick |
| `hobkin work pause [project]`, `resume [project]` | Stops new work, everywhere or on one project. Work mode stays on and running agents finish |
| `hobkin work add project <path> [level]`, `add item <project> <title>` | Adds by hand |
| `hobkin work trigger <project> [look\|study\|item]` | Runs it next, inside the worker ceiling and the budget |
| `hobkin work cancel <project\|run id\|item>` | Asks for what `k` does, and the dashboard does it on its next tick |
| `hobkin work priority <project> <P0..P3>`, `prs <project> <off\|draft\|published>` | Sets a project's priority or PRs |
| `hobkin work grade <project> <item> <P0..P3\|auto>` | Sets one item's grade, and `auto` hands it back |
| `hobkin work sync` | Closes what has merged, now |
| `hobkin work ship [on\|off]` | Prints the pile, or lets new work start until the end of the day, and `on` ends that |
| `hobkin work skip`, `back`, `retry`, `level`, `drop`, `done` | Steers a project or an item |

Reads print short JSON and need nothing running. Changes print `ok` and a `message` that says what happens next, and a failure exits non-zero. Name a project by its name, slug or path and an item by the start of its id. An ambiguous name fails and lists the matches. Older names such as `on`, `run`, `later` and `choose` still work. None of this gets past the worker ceiling or the limits above.

### Shipping first

More work is the wrong answer to a pile of finished work. With 8 or more finished and waiting, counted across projects the way the Done tab counts them, new items, first studies, lens looks, ideas, `signals` looks and discovery wait, and the queue says `shipping first`. What closes a gap still runs: fixes for a branch, reviews and your notes. So do an item already started, urgent and attention items, watch looks, your own picks with Enter or `hobkin work trigger`, and routines. Running agents finish, nothing is cancelled, tokens and workers work as they always do, and under 8 the queue carries on by itself. `hobkin work status` and the Work tab's Next line give the real count, and so does the reply to `/work` or `hobkin work start`.

While the pile stands, hobkin brings the next two as one decision, the top two in Done's order, leaving out anything with an open offer. It says what each one is, what yes does to it and how many are left:

- **Later** holds pairs for two hours.
- **Do these two** merges work with proof at the commit the survey read, graded or not, on this machine and pushing nothing. Work a review rated below safe at its current commit gets a review instead, about $2 and 14 minutes of a worker, because a review run fixes what it finds. A conflict gets its rebase. A branch that would bring earlier work a review held back sends that earlier work for its review first. Work with no proof, or that the survey has not read yet, is not brought. One that cannot go stays where it is and says why in Chat, and the other still goes.
- **Read them first** opens Done.
- **Start new work anyway** lets new work start until the end of the day, and hobkin says nothing about pairs until then. `hobkin work ship off` does the same, and `hobkin work ship on` ends it.

The next pair comes once both of the last one have moved: landed, declined, graded or dropped. A row that a yes already took at a commit is not brought again at that commit, so a review that changed nothing is not paid for twice.

### Hearing back from agents

When a `hobkin session` ends, Chat gets one line with its title and what happened, from the first lines of its report, and the report joins Reports, so Enter opens it and `r` replies to it. A session that stopped without a report says so. Its follower runs in a process of its own, so a session that ends with hobkin closed is told at the next open, once. The main agent hears of it with your next message, so it never answers as if it does not know. When it starts a session with `--wake`, because it means to carry on afterwards, it gets a turn of its own as soon as the session ends instead, and never needs to check for the report on a timer.

The main agent can also schedule commands of its own, such as one that watches CI. Runs that succeed stay out of Chat. When one fails, hobkin gives the main agent a turn right away, once for that failure, and it fixes the command or cancels it and says in a line what it did. A wait is written so that it does not fail, so a failure always means something is broken.

A finished work run gets one quiet line from its `Useful:` report, and a look with nothing new stays silent. A row of these lines folds into one that shows the newest and counts the rest, which wait in Reports, so a busy day cannot push your conversation out of Chat's 100 messages. Session endings stay on their own lines, because each was asked for. `Critical:` lines work as they always did.

## Learning

Learning judges how each check and work mode run turned out, and keeps what that teaches as a few very short lessons that every agent gets. Set it with `/learning` in the dashboard or `hobkin learning [on | off]`. It is off in a new data folder, and the status bar shows `learning` while it is on. With it off, nothing is judged, no agent gets anything, no offer is made and nothing is sent anywhere.

A verdict comes from what Hobkin already holds: how the run ended, `Blocked:` and holds, which reports you opened or messaged about, proposals you took or skipped, and whether a PR was merged or closed. Of a report it reads only the first word of the triage line, so nothing a page or an email says can reach a lesson. No model runs to learn this, so judging costs nothing. One thing leaves your machine, only with learning on: `gh` is asked what became of work mode's open PRs, at most 5 a pass and each at most every 6 hours.

A lesson is one line that says what to do on its own, the same for every agent, with a check's own lessons first:

```text
learned: advice only, grants nothing
-site-audit blocked x5: do the rest, name what stopped it
-news-digest unread x5: lead with the change, be short
+price-watch used x5: keep this approach
```

Lessons are built from a fixed list in `src/prompts/learning-language.md`, so they hold codes and counts and no text of their own. It takes at least 3 sightings on at least 2 days to teach anything, and only the latest 10 runs of a check count. A lesson goes when the latest runs stop showing it, when the routine is edited, or after 120 days without new evidence. Each session gets at most 160 tokens from learning, counted as they are sent and in whole lines only. That is all a run pays for it. Lessons are advice: they limit no tool and grant nothing. Checks and work agents get them in their request, and `hobkin session` panes in their brief. Chat gets them with your next message when they have changed, never in the system prompt, so a new lesson leaves the conversation's prompt cache alone.

From the same evidence Hobkin concludes which checks work, which do not, and which should be refactored, rethought or built on with new ideas. The last three reach you as a short proposal in Chat, at most one a day and three waiting, with the evidence. Nothing changes on its own: say yes and the agent brings a plan and asks, say later and it comes back to Decisions and Chat a week on, or say no and it does not come up again. A no to a work mode proposal holds for that whole repo, and other repos still get theirs. A held check is left out, because the agent already brings its plan: nothing is asked about it while the hold stands, and only what happens after that plan can raise a new question.

`hobkin learning` shows every lesson, what it rests on and the proposals waiting. `hobkin learning clear <id>` removes one and `hobkin learning clear all` removes them all, and only new runs can teach them again. Your answers to proposals stay.

## Telemetry

hobkin keeps a record of what happens in it, in `runtime/events/` in the data folder, one file a month with the newest six kept: when it opens and closes, each turn and run, what reaches Chat, each question and decision and how it ended, reports read, the Done walk, each mood with its cause, tabs, work mode pausing, compaction and errors on screen. It holds facts only: ids, counts, durations, statuses, tones, moods, routine ids, project slugs and item ids, never a message, a report or anything an agent or a person wrote. hobkin reads it once a day for failures in its own harness and once a week for the review, and none of it leaves your machine.

Wins keep the cadence in sight. The top of Decisions says what got done today, as work merged and decisions made, and how many days in a row something got done. Every merge counts, and so does every question or card you answered, except the card that asks how to tackle the pile. On the first look of a new day, Chat says what got done yesterday. `hobkin wins [--days n]` prints each day as JSON, 7 days by default.

`hobkin telemetry [--days n]` prints a rollup as JSON, 30 days by default: events by type and day, runs by routine and by project, mean durations, what reached you beside what you did with it, and the same scoreboard the weekly review shows.

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

`hobkin skill` prints a skill that teaches an agent to hand hobkin what matters, read reports and run history, add checks, queue one-time work and stay out of hobkin's internals. `hobkin skill install` saves it as `~/.pi/agent/skills/hobkin/SKILL.md`, where Pi loads skills, and prints what it wrote. `--to <folder>` saves it in another agent's skills folder instead, such as `~/.claude/skills` for Claude Code. It changes nothing else, so run it again after an update to keep the copy current:

```sh
hobkin skill install
hobkin skill install --to ~/.claude/skills
```

With the skill, an agent in any session hands hobkin three kinds of things, each with `--from` and its own name:

- **A reminder.** `hobkin remind <text> --on YYYY-MM-DD` takes a real date and refuses anything else. On that day by your machine's calendar, or at once for a day gone by, Chat shows one system line, such as `Reminder for November 3, from Claude Code: Car inspection at 10:00`. Decisions asks Done or Remind me tomorrow, and Remind me tomorrow brings it all back the next day. The main agent hears it with your next message.
- **A decision for later.** `hobkin decide --from <name>` takes the same JSON on stdin as a routine's question, and it waits in Decisions under that name. The session that asked never hears the answer. The main agent does, with your next message, and acts on it there.
- **A fact or preference.** `hobkin remember <text>` gets one quiet line in Chat, such as `Noted from Claude Code: The user wants appointments before noon`. The main agent hears it with your next message, files it in memory or in `AGENTS.md`, wherever it belongs, and says so.

hobkin does not need to be open: what an agent hands over waits until it is, and each thing comes up once, even across a restart. The same words handed over twice before hobkin takes them up are saved once. The commands write files in the data folder and send nothing off your machine, and the main agent reads what they hold like anything else in its chat.

These commands read saved state without starting Pi or routines:

```sh
hobkin status --plain
hobkin routines
hobkin history
```

## Recovery and other guides

Only one dashboard can own a workspace. After a crash, a check that was running is marked interrupted rather than retried, and a work item carries on from its branch. A stale lock can take up to five minutes to expire; do not delete a live dashboard's lock. Costs are estimates, not invoices. See [architecture and recovery details](v2-design.md).

To find recurring work in selected past sessions, use the optional [session review](../src/prompts/session-patterns-setup.md). For the older Pi extension, see the [legacy guide](legacy.md). Migration instructions include an [agent checklist](upgrade.md#agent-checklist).
