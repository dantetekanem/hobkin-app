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

Agents study each project you take and file items for what they find. All items go in one queue, graded P0 to P3, with P0 first. Turning work mode on starts nothing new by itself: hobkin offers the next few rows, and you start those, the first one, or let the whole queue run, so it starts by itself whenever a worker is free and the daily token budget allows it. Letting it run stays your choice the next time you turn work mode on. Work that finishes a branch, such as a rebase, a fix that gets it merged, a review or your note, goes ahead of new work and starts by itself either way.

Every change happens on a `hobkin/*` branch, and git can bring it all back, so nothing waits for permission. Agents never commit to your default branch or merge into it. Deploying, publishing and deleting what git cannot bring back stay with you.

If a project's folder is clean, idle and on its default branch, a run works there, so you will see its branch until the run ends. Otherwise it uses a worktree.

Each project has a priority, which sets how often agents look at it, from every hour at P0 to once a week at P3, and the grade its items start at. It also has a PR setting, which is off by default. With PRs off, finished work is a local branch plus a saved description, listed on the Done subtab for you to review. `hobkin work pr <project> <item>` prints one. The `draft` and `published` settings open a PR instead.

In the Work Mode tab:

- `p` changes a project's priority or an item's grade.
- `r` changes a project's PR setting.
- `x` marks an item done.
- `s` skips a queue row or puts it back.
- `Enter` on a queue row runs it next.

The Done subtab lists finished work in three groups, and Decisions lists the same ones. READY TO MERGE is what one yes can land: it has proof, no conflict and no grade against its commit, and it brings no other branch along. REFRESH THEN MERGE is the same work behind its base. NEEDS YOU is the rest, and each card says what is in its way. A group starts with its action, such as `Merge all 9`. Enter opens a page with every title it will carry out, by project and in order, and one more Enter does exactly those, each at the commit its card showed. One that cannot go says why in Chat, and the rest still go.

Every card still opens by itself, the highest priority first, each with its safety grade. Enter opens a card's page, with the one risk its review named, where to look first and how to undo it. Below it the card says whether the work is finished and what it did, its proof, whether a review covers this commit, and what Merge does to which branch, then asks what to do, each choice in words: the arrows choose and Enter picks.

- `Merge it` merges the branch on this machine and pushes nothing. A branch behind its base offers `Refresh and merge it`: an agent brings it up to date and runs its proof again, and hobkin merges it once that run ends well.
- A card offers its merge first, graded or not, and `Get it reviewed` further down. Only a card rated risky at its commit offers its review first, and its merge says so. A review runs only when you ask for one.
- `Show the diff` opens the diff, `Cancel it` says no and hobkin learns from it, and `Ask for changes` sends an agent back with the words you type. With work mode off or paused, asking for changes, a rebase or a review goes to the main agent, which starts a session on that branch.
- A step only you can take offers `Mark it done`, `Talk it over in Chat` or `Not needed`, which says no and hobkin learns from it.
- Under NOT LANDED, an older item that says done with work still on its branch waits until the next survey makes it finished work again. Its card can close it for good.

Whatever you do on a card, Chat says so in one line that names the project and the title, with the link for a PR. The main agent hears it with your next message. A group's yes gets the same line for each card, then one line that sums it up. A PR you merge from its card closes at once and leaves the list.

Once you merge and push, hobkin watches what happens next. A check every half hour, with no model, sees whether origin has the change, whether CI passed and whether a revert landed, and a look reads the project's logs and errors. WATCHING on the Done subtab shows each change as it goes. When one goes wrong, hobkin files an urgent fix, and `hobkin work trouble <project> <item>` says so yourself. Agents never deploy, roll back or revert your default branch.

With learning on, a change like one that already went well comes to you as an offer in Action Items, with what happened last time and the one risk to look at: Later, Merge it, Read it or Not this one. hobkin still merges only on your word.

A question from a routine or work mode opens on screen for 30 seconds while you are there, then moves to the Action Items tab, so nothing stops for you. One that comes while you are away waits for you, and after ten minutes it goes to Decisions without opening. Each one has a one-line summary and numbered choices: press the number to answer, or pick the last row to answer in your own words. A routine that asks what you answered in the last 30 days gets your answer back and does not ask again.

Action Items lists everything waiting on you, with work mode on or off: questions, finished branches, steps only you can take and reports with a call. Pick one and work on it there. Enter opens a row, and it asks the way a question does: each thing it can do in words, the arrows to choose and Enter to pick. A finished branch opens its page with its choices below, the same as in Done, and letters do nothing there except `r`, so a key meant for another tab cannot act on it. `r` on any row, or with its box open, talks it over in Chat.

When you come back after two hours or more to three or more things that came in, Chat says so in one line, such as `It's been a while. While you were away: 4 decisions, 6 reports (2 with a call) and 1 from work mode. Want a brief? Just say: brief me`. It asks nothing, and it comes once each time you come back, even after a night with hobkin closed. Say `brief me` and the main agent writes the brief: what matters most and why, what changed, then what needs you, numbered. Answer in your own words, such as `1 yes, 2 drop it`, and it carries each one out. A merge still takes your yes on its numbered line. `hobkin pending` prints what waits as JSON.

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

## What leaves your machine

Your model provider, and the tools you connect, see what agents work on. Beyond that, hobkin sends two things to its own server, and only from a machine enrolled with it. While usage upload is on, a machine enrolls by itself on its first send: hobkin's server gives it its own key, which hobkin keeps private in `runtime/remote.json`. With upload off, nothing is sent and it never enrolls.

- **Usage events, on by default.** Which parts of hobkin were used, and how runs, questions, decisions and crashes ended, as fixed words, counts and durations with fresh random ids. Never a message, a report, a name, a path or a local id. Chat says so the first time. `hobkin telemetry upload off` stops it, and `hobkin telemetry upload status` says what goes and where.
- **Feedback, only when you send it.** `/feedback` in Chat drafts a report, shows its exact JSON and SHA-256, and sends it only on your yes. Emails, tokens, keys, credentials in URLs and home paths come out first. That is best effort, so read it before you say yes. After a crash, the next start offers a crash report the same way. `hobkin feedback list` shows what you sent, `hobkin feedback delete <id>` deletes one here and on the server, and `hobkin feedback off` stops sending, even what waits.

The local event stream, your chats, reports and memory stay on your machine.

## Development checks

Use pnpm 11.12.0, as pinned in `package.json`. `pnpm install` downloads the Node 26.3.1 development runtime declared in `devEngines.runtime`; pnpm scripts and their child commands use it without changing your global Node or pnpm launcher. The application still supports Node 22.19 or newer.

```sh
pnpm install
pnpm test
pnpm test:cli
pnpm test:migration
```

The CLI suite exercises qmd when it is installed, using temporary private indexes without loading embedding models. Its native addons must support the development runtime (Node 26 ABI 147). If `qmd --version` works but indexing fails, run `pnpm exec qmd --index probe status` from the checkout with both `XDG_CACHE_HOME` and `XDG_CONFIG_HOME` set to temporary directories; version output alone does not load the database addon. Use a compatible qmd installation rather than skipping these tests. The checkout denies the optional build scripts listed in `pnpm-workspace.yaml`; dependency preflight checks remain enabled.

## Where to go next

- `hobkin work help` lists every work mode command.
- `/help` shows a short guide in Chat.
- [docs/guide.md](docs/guide.md) is the full reference, with limits, recovery, learning, memory search and more.
