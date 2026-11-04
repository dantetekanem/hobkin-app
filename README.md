# hobkin

hobkin is an agent you chat with in the terminal. It runs checks on a schedule through the Pi coding agent and saves what they find as Markdown reports. In work mode, agents also work on your git projects in small changes, each on its own branch.

Website: https://hobkin.dev

## Run it

You need Node 22.19 or newer, pnpm and Pi. Install the Pi version hobkin pins:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0
```

Then run hobkin from a checkout:

```sh
pnpm install
pnpm hobkin
```

The first time, hobkin asks you to sign in to a model, then opens and starts setup by itself: who you are, the services to connect and your first checks. `hobkin login` signs in again at any time, and `/setup` runs setup again. `hobkin setup` changes nothing: it checks Pi, git, `gh`, your models and routines, and says how to fix what is missing.

If `hobkin` is on your PATH, run it from any directory. Otherwise, run the `hobkin` commands below as `pnpm hobkin` from the checkout. The first launch creates `~/.hobkin`, and later launches reopen the same conversation.

Coming from pi-companion? Close it, then run `hobkin import`.

## Use it

Chat opens ready to type. Ask the agent to run a check now, switch models or remember something. Reports holds finished checks. Routines shows when each check runs next. The Work Mode tab appears while work mode is on, and a running check gets a tab of its own.

- `Enter` sends a message or opens the selected report.
- `Ctrl+V` attaches the image on the clipboard to your message and shows it above the input. `Esc` removes the last one.
- `Left` and `Right` change tabs when your draft is empty.
- `Up` and `Down` select a report. `Page Up` and `Page Down` scroll.
- `r` or `m` in a report takes it to Chat, so you can reply to it.
- `Esc` leaves a report or goes back to Chat.
- `k` in a running check's tab cancels it.
- `Ctrl+C` clears your input. `Ctrl+Q` quits.

Checks and work mode run only while hobkin is open, but agents already working in Herdr panes can outlive it: quitting asks whether to stop them or let them finish, and the next hobkin picks up what they did. On a Mac it keeps the machine awake for that long, and the display still dims and sleeps.

## Add a routine

Ask the agent in Chat, or save this as `~/.hobkin/routines/daily/morning-recap.md`:

```markdown
---
{
  "id": "morning-recap",
  "title": "Morning recap",
  "at": "09:00",
  "timezone": "America/Sao_Paulo",
  "enabled": true,
  "harness": "pi",
  "effort": "medium",
  "cwd": "/absolute/project/path",
  "context": []
}
---
Check this project for changes worth acting on. Cite the evidence.
```

Set your own timezone and `cwd`. hobkin picks the file up by itself, and `hobkin routines` lists your checks and any errors. The [routine guide](src/prompts/routine-setup.md) covers weekly, monthly, one-time and hourly checks.

## Work mode

Type `/work` in Chat to turn it on or off. The first time, hobkin asks which folder to start from. It looks through the repositories there and proposes projects. Nothing starts until you take one: answer in Chat, or press `y` or `n` on its row in the Work Mode tab.

Agents study each project you take and file items for what they find. All items go in one queue, graded P0 to P3, with P0 first. Turning work mode on starts nothing new by itself: hobkin offers the next few rows, and you start those, the first one, or let the whole queue run, so it starts by itself whenever a worker is free and the daily token budget allows it.

Every change happens on a `hobkin/*` branch, and git can bring it all back, so nothing waits for permission. Agents never commit to your default branch or merge into it. Deploying, publishing and deleting what git cannot bring back stay with you.

If a project's folder is clean, idle and on its default branch, a run works there, so you will see its branch until the run ends. Otherwise it uses a worktree.

Each project has a priority, which sets how often agents look at it, from every hour at P0 to once a day at P3, and the grade its items start at. It also has a PR setting, which is off by default. With PRs off, finished work is a local branch plus a saved description, listed on the Done subtab for you to review. `hobkin work pr <project> <item>` prints one. The `draft` and `published` settings open a PR instead.

In the Work Mode tab:

- `p` changes a project's priority or an item's grade.
- `r` changes a project's PR setting.
- `x` marks an item done.
- `s` skips a queue row or puts it back.
- `Enter` on a queue row runs it next.

The Done subtab walks through finished work, the highest priority first, each with its safety grade. Enter opens a card's page, with the one risk its review named, where to look first and how to undo it, and below it the card asks what to do, each choice in words: the arrows choose and Enter picks.

- `Merge it` merges the branch on this machine and pushes nothing. A branch behind its base offers `Refresh and merge it`: an agent brings it up to date and runs its proof again, and hobkin merges it once that run ends well.
- A card offers its merge first, graded or not, and `Get it reviewed` further down. Only a card rated risky at its commit offers its review first, and its merge says so. A review runs only when you ask for one.
- `Show the diff` opens the diff, `Cancel it` says no and hobkin learns from it, and `Ask for changes` sends an agent back with the words you type.
- Under NOT LANDED, a card closes a branch whose item says done, for good.

Whatever you do on a card, Chat says so in one line that names the project and the title, with the link for a PR. The main agent hears it with your next message. A PR you merge from its card closes at once and leaves the list.

Once you merge and push, hobkin watches what happens next. A check every half hour, with no model, sees whether origin has the change, whether CI passed and whether a revert landed, and a look reads the project's logs and errors. WATCHING on the Done subtab shows each change as it goes. When one goes wrong, hobkin files an urgent fix, and `hobkin work trouble <project> <item>` says so yourself. Agents never deploy, roll back or revert your default branch.

With learning on, a change like one that already went well comes to you as an offer in Decisions, with what happened last time and the one risk to look at: Later, Merge it, Read it or Not this one. hobkin still merges only on your word.

A question from a routine or work mode waits 30 seconds on screen, then moves to the Decisions tab, so nothing stops for you. Each one has a one-line summary and numbered choices: press the number to answer. A routine that asks what you answered in the last 30 days gets your answer back and does not ask again.

Decisions lists everything waiting on you, with work mode on or off: questions, finished branches, steps only you can take and reports with a call. Pick one and work on it there. Enter opens a row, and it asks the way a question does: each thing it can do in words, the arrows to choose and Enter to pick. A finished branch opens its page with its choices below, the same as in Done, and letters do nothing there, so a key meant for another tab cannot act on it.

When 8 or more things are waiting across your routines and work mode and you are at the screen, hobkin shows a short card, one row for each kind, and asks how you want to tackle them. It waits for an empty composer, stays out of a running turn, and stops nothing. `hobkin pending` prints the same thing as JSON.

With 8 or more finished and waiting, hobkin starts no new work and brings the next two to move as one decision, so the queue gets healthy before it grows. Reviews, rebases, urgent work and your own picks still run, and `hobkin work ship off` lets new work start for the rest of the day.

When a background agent finishes, Chat says what it did, and a session's report joins Reports.

Once a week, Chat gets a review that says what is progressing and which projects look stale, then a few lines on what hobkin brought you, what you did with it and what it settled alone. It drops nothing itself, and `hobkin work review` prints it at any time. `hobkin telemetry` prints the same numbers.

hobkin looks after itself too. When its own harness fails the same way 3 times in a day, it files a fix on its own project, or says so in one quiet line in Chat if you have not chosen that project. Work mode picks the fix up like any other item.

## From your other agents

Your other agent sessions, such as Pi or Claude Code in another project, can hand hobkin what matters to you. `hobkin skill install` puts hobkin's skill in `~/.pi/agent/skills`, and `--to` puts it in another agent's skills folder, such as `~/.claude/skills`. With it, an agent hands over:

- A date, with `hobkin remind <text> --on YYYY-MM-DD`. On that day Chat shows it, Decisions asks Done or Remind me tomorrow, and the main agent hears it.
- A choice for later, with `hobkin decide --from <name>`. It waits in Decisions, and the main agent hears your answer.
- A fact, with `hobkin remember <text>`. The main agent hears it with your next message, files it in its memory and says so.

These commands write files on your machine and send nothing anywhere.

## Where to go next

- `hobkin work help` lists every work mode command.
- `/help` shows a short guide in Chat.
- [docs/guide.md](docs/guide.md) is the full reference, with limits, recovery, learning, memory search and more.
