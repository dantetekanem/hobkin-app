# hobkin

hobkin is an agent you chat with in the terminal. It runs scheduled checks, called routines, through the Pi coding agent. It saves what they find as Markdown reports. It also has a work mode, where agents work on your git projects in small changes, each on its own branch.

Website: https://hobkin.dev

## Run it

You need Node 22.19 or newer, pnpm and Pi. hobkin needs one exact version of Pi. Install it with:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0
```

Then start hobkin from a checkout of its code:

```sh
pnpm install
pnpm hobkin
```

The first time, hobkin asks you to sign in to a model. Then it opens and starts setup on its own. Setup asks who you are, which services to connect, and which checks you want first.

- To sign in again at any time: `hobkin login`
- To run setup again: type `/setup` in Chat
- To check your install without changing anything: `hobkin setup`. It checks Pi, git, `gh`, your models and your routines, and tells you how to fix anything missing.

The first launch creates `~/.hobkin`, the folder where hobkin keeps everything. Later launches reopen the same conversation. If `hobkin` is on your PATH, you can run it from any folder. If it is not, run each `hobkin` command in this README as `pnpm hobkin` from the checkout.

Coming from pi-companion? Close it, then run `hobkin import`.

## Use it

hobkin opens on the Chat tab, ready for you to type. In Chat you talk to the main agent. Ask it to run a check now, switch models or remember something. The other tabs:

- Reports holds the reports of finished checks.
- Routines shows when each check runs next.
- Action Items lists everything waiting on you. It appears while anything is waiting.
- Work Mode appears while work mode is on.
- Each running check gets a tab of its own.

Keys:

- `Enter` sends a message or opens the selected report.
- `Ctrl+V` attaches the image on the clipboard to your message and shows it above the input. `Esc` removes the newest one.
- `Left` and `Right` change tabs when your draft is empty.
- `Up` and `Down` select a report. `Page Up` and `Page Down` scroll.
- `r` or `m` in a report takes you to Chat with that report, so you can reply to it.
- `Esc` leaves a report or goes back to Chat.
- `k` in a running check's tab cancels the check.
- `Ctrl+C` clears your input. `Ctrl+Q` quits.

Checks and work mode run only while hobkin is open. The exception is agents already working in Herdr panes, which can keep going after hobkin closes. When you quit, hobkin asks whether to stop them or let them finish. If you let them finish, the next time you open hobkin it picks up what they did.

While hobkin runs on a Mac, it keeps the Mac from sleeping. The display still dims and sleeps as usual.

## Add a routine

To add a routine, ask the agent in Chat, or save a file like this as `~/.hobkin/routines/daily/morning-recap.md`:

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

Change `timezone` to yours, and `cwd` to the folder the check should work in. hobkin loads the new file on its own. To list your checks and any errors in their files: `hobkin routines`. The [routine guide](src/prompts/routine-setup.md) covers weekly, monthly, one-time and hourly checks.

## Work mode

Type `/work` in Chat to turn work mode on or off.

The first time, hobkin asks which folder to start from. It looks through the repositories in that folder and proposes projects. Nothing starts until you take a project. To answer, reply in Chat, or press `y` (take it) or `n` (skip it) on its row in the Work Mode tab.

Agents study each project you take. For each thing worth doing, they file an item. Items from all your projects go into one queue, graded P0 to P3. P0 runs first.

Turning work mode on does not start new work by itself. First, hobkin offers you the next few rows of the queue in Action Items. You can start those rows, start only the first one, or let the whole queue run. If you let it run, hobkin starts the next item whenever an agent is free and the daily token budget allows it. hobkin keeps this choice for the next time you turn work mode on.

Some work finishes a branch that already exists: a rebase, a fix that gets the branch merged, a review, or a note you left. That work goes ahead of new work, and it starts by itself even if you have not let the queue run.

Every change happens on a `hobkin/*` branch, and git can undo all of it. That is why agents do not wait for your permission. They never commit to your default branch or merge into it. Deploying, publishing and deleting anything git cannot bring back stay with you.

When a project's folder is clean, idle and on its default branch, the agent works right in that folder. You will see its branch checked out there until the run ends. Otherwise, the agent works in a separate git worktree.

Each project has a priority, P0 to P3. It sets two things: how often agents look at the project, from every hour at P0 to once a week at P3, and the grade its new items start at.

Each project also has a PR setting, `off` by default. With PRs off, finished work stays on your machine as a local branch with a saved description. The Done subtab of the Work Mode tab lists it for you to review. To print one: `hobkin work pr <project> <item>`. The `draft` and `published` settings open a pull request instead.

In the Work Mode tab:

- `p` changes a project's priority or an item's grade.
- `r` changes a project's PR setting.
- `x` marks an item done.
- `s` skips a queue row or puts it back.
- `Enter` on a queue row runs it next.

### Finished work

Each piece of finished work shows as a card. The Done subtab and the Action Items tab sort the cards into the same three groups:

- READY TO MERGE: work you can land with one yes. It has proof that it works, it has no conflict, no review rated its commit below safe, and merging it brings in no other branch.
- REFRESH THEN MERGE: the same, except that the branch is behind its base.
- NEEDS YOU: everything else. Each card says what is in its way.

Each group starts with its action, such as `Merge all 9`. Enter opens a page that lists every title the action covers, by project and in order. One more Enter carries out exactly those, each at the commit its card showed. If one cannot go, Chat says why, and the rest still go.

You can also open each card on its own. Cards are listed highest priority first, each with its safety grade. Enter opens a card's page. It shows the main risk its review named, where to look first, and how to undo the change. Below that, the card says whether the work is finished and what it did, what proves it works, whether a review covers this commit, and which branch Merge changes. Then it asks what to do, with each choice written out: the arrows choose and Enter picks.

- `Merge it` merges the branch on this machine. It pushes nothing. A branch that is behind its base offers `Refresh and merge it` instead: an agent updates the branch and runs its proof again, and hobkin merges it if that run succeeds.
- The merge choice comes first, whether or not the work has a grade, and `Get it reviewed` comes further down. The only exception is a card whose review rated its current commit risky. That card offers the review first, and its merge choice says the work is rated risky. A review runs only when you ask for one.
- `Show the diff` opens the diff. `Cancel it` says no, and hobkin learns from your no. `Ask for changes` sends an agent back to the branch with the words you type. When work mode is off or paused, a request for changes, a rebase or a review goes to the main agent instead, and the main agent starts a session on that branch.
- A card for a step only you can take offers `Mark it done`, `Talk it over in Chat` and `Not needed`. `Not needed` says no, and hobkin learns from it.
- NOT LANDED holds older items marked done that still have work on their branch. Each one waits there until the next survey, hobkin's check of your repositories every half hour, turns it back into finished work. Its card can also close it for good.

Whatever you do on a card, Chat shows one line with the project, the title and, for a PR, its link. The main agent learns of it with your next message. A yes to a whole group shows that line for each card, then one line that sums up the group. A PR you merge from its card closes at once and leaves the list.

When 8 or more finished changes are waiting for you, hobkin stops starting new work. Instead, it brings you the next two as one decision, so finished work lands before the queue grows. Reviews, rebases, urgent work and the items you pick yourself still run. To let new work start anyway for the rest of the day: `hobkin work ship off`.

When a background agent finishes, Chat says what it did. If it ran as a session, its report also appears in Reports.

### After you merge

After you merge and push a change, hobkin watches what happens next. Every half hour, a check that uses no model looks at whether origin has the change, whether CI passed and whether a revert landed. An agent also reads the project's logs and errors. WATCHING on the Done subtab shows how each change is doing.

When a change goes wrong, hobkin files an urgent fix. To report a problem yourself: `hobkin work trouble <project> <item>`. Agents never deploy, roll back or revert your default branch.

Learning is a setting that lets hobkin learn from how earlier work turned out. With learning on, a change like one that already went well comes to you as an offer in Action Items. The offer says what happened last time and names the one risk to look at. It gives four choices: Later, Merge it, Read it or Not this one. hobkin still merges only when you say so.

### Questions and Action Items

A question from a routine or from work mode never holds up other work. If you are at the screen, the question opens for 30 seconds, then moves to the Action Items tab. If you are away when it comes, it waits for you, and after ten minutes it moves to Action Items without opening. Each question has a one-line summary and numbered choices. Press a number to answer, or pick the last row to answer in your own words. If a routine asks something you already answered in the last 30 days, it gets your earlier answer and does not ask again.

The Action Items tab lists everything waiting on you, whether work mode is on or off: questions, finished branches, steps only you can take, and reports that ask you to act. Pick a row and deal with it there. Enter opens the row, and it asks what to do the way a question does: each choice in words, the arrows to choose and Enter to pick. A finished branch opens its page with its choices below, as in Done. There, letter keys do nothing except `r`, so a key meant for another tab cannot act on the card by mistake. `r` on any row, or with its box open, starts a conversation about it in Chat.

### When you come back

If you were away for two hours or more and three or more things came in, Chat tells you in one line, such as `It's been a while. While you were away: 4 decisions, 6 reports (2 with a call) and 1 from work mode. Want a brief? Just say: brief me`. The line asks nothing. It comes once each time you come back, even after a night with hobkin closed.

Say `brief me` and the main agent writes a brief: what matters most and why, what changed, then a numbered list of what needs you. Answer in your own words, such as `1 yes, 2 drop it`, and it carries out each answer. A merge still needs your yes on its own numbered line. To print what is waiting as JSON: `hobkin pending`.

### Weekly review and self-repair

Once a week, hobkin posts a review in Chat. It says what is moving forward and which projects look stale. Then a few lines count what hobkin brought you, what you did with it, and what it settled without you. hobkin never drops a project by itself.

- To print the review at any time: `hobkin work review`
- To print the same numbers: `hobkin telemetry`

hobkin also watches for its own failures. When it fails the same way 3 times in a day, it files a fix on its own project. If you have not taken hobkin as a work mode project, it posts one quiet line in Chat instead. Work mode picks up the fix like any other item.

## From your other agents

Agents you run elsewhere, such as Pi or Claude Code in another project, can pass hobkin things that matter to you. hobkin's skill teaches them how. To install it:

- For Pi: `hobkin skill install` puts it in `~/.pi/agent/skills`
- For another agent: add `--to` with that agent's skills folder, as in `hobkin skill install --to ~/.claude/skills`

With the skill, an agent can hand hobkin three kinds of things:

- A date: `hobkin remind <text> --on YYYY-MM-DD`. On that day, Chat shows the reminder, Action Items asks Done or Remind me tomorrow, and the main agent hears about it.
- A choice for you to make later: `hobkin decide --from <name>`. It waits in Action Items, and your answer goes to the main agent.
- A fact: `hobkin remember <text>`. The main agent hears it with your next message, saves it to its memory and tells you.

These commands write files on your machine and send nothing anywhere.

## What leaves your machine

Your chats, reports, memory and event history stay on your machine. Three kinds of data leave it.

### Your agents' work goes to your AI model

Your messages, and whatever your agents read while they work, are sent to the model provider you use. A tool you connect, such as GitHub, gets whatever your agents send it.

### Usage counts go to hobkin's server, unless you turn them off

Usage counts say which parts of hobkin you used and how runs, questions, decisions and crashes ended. They hold fixed labels, counts and durations. They never hold a message, a report, a name or a file path, and each one gets a new random id that is not used anywhere on your machine. Chat tells you the first time they are sent.

- To stop sending them: `hobkin telemetry upload off`
- To see what is sent and where: `hobkin telemetry upload status`

### Feedback goes to hobkin's server only when you send it

Type `/feedback` in Chat to write a report. hobkin removes emails, tokens, keys, passwords in links and home folder paths from it, then shows you the exact JSON it will send. Nothing is sent until you say yes. The removal can miss things, so read the report first. After a crash, hobkin offers to send a crash report the same way.

- To see what you sent: `hobkin feedback list`
- To delete a report on your machine and on the server: `hobkin feedback delete <id>`
- To stop sending feedback, including reports still waiting: `hobkin feedback off`

### Sending nothing at all

To send anything, your machine needs its own key from hobkin's server. It gets one the first time it sends usage counts, and keeps it in `runtime/remote.json`. If you turn usage counts off before that happens, your machine never gets a key and nothing goes to hobkin's server. If it already has a key, turn feedback off too.

## Development checks

Use pnpm 11.12.0, the version pinned in `package.json`. `pnpm install` downloads Node 26.3.1, the development runtime set in `devEngines.runtime`. pnpm scripts, and the commands they start, run on that Node. Your global Node and pnpm launcher stay as they are. hobkin itself still runs on Node 22.19 or newer.

```sh
pnpm install
pnpm test
pnpm test:cli
pnpm test:migration
```

When qmd is installed, the CLI suite tests it too. The tests use temporary private indexes and do not load embedding models. qmd's native addons must support the development runtime (Node 26, ABI 147).

`qmd --version` does not load qmd's database addon, so it can work while indexing fails. In that case, run `pnpm exec qmd --index probe status` from the checkout, with both `XDG_CACHE_HOME` and `XDG_CONFIG_HOME` set to temporary folders. If qmd does not work with this runtime, install a version that does. Do not skip these tests.

The checkout turns off the optional build scripts listed in `pnpm-workspace.yaml`. Dependency preflight checks still run.

## Where to go next

- `hobkin work help` lists every work mode command.
- `/help` shows a short guide in Chat.
- [docs/guide.md](docs/guide.md) is the full reference, with limits, recovery, learning, memory search and more.
