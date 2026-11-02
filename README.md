# hobkin

hobkin is an agent you chat with in the terminal. It runs checks on a schedule through the Pi coding agent and saves what they find as Markdown reports. In work mode, agents also work on your git projects in small changes, each on its own branch.

Website: https://hobkin.dev

## Run it

You need Node 22.19 or newer, pnpm and Pi. Install the Pi version hobkin pins, then run `pi` once and use `/login` there to add a model:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.4.0
```

Then run hobkin from a checkout:

```sh
pnpm install
pnpm hobkin setup
pnpm hobkin
```

`hobkin setup` changes nothing. It checks Pi, git, `gh`, your models and schedules, and says how to fix what is missing. Once hobkin opens, type `/setup` in Chat and it walks you through the rest, including Jev and your first checks.

If `hobkin` is on your PATH, run it from any directory. Otherwise, run the `hobkin` commands below as `pnpm hobkin` from the checkout. The first launch creates `~/.hobkin`, and later launches reopen the same conversation.

Coming from pi-companion? Close it, then run `hobkin import`.

## Use it

Chat opens ready to type. Ask the agent to run a check now, switch models or remember something. Reports holds finished checks. Schedules shows when each check runs next. The Work Mode tab appears while work mode is on, and a running check gets a tab of its own.

- `Enter` sends a message or opens the selected report.
- `Left` and `Right` change tabs when your draft is empty.
- `Up` and `Down` select a report. `Page Up` and `Page Down` scroll.
- `r` or `m` in a report takes it to Chat, so you can reply to it.
- `Esc` leaves a report or goes back to Chat.
- `k` in a running check's tab cancels it.
- `Ctrl+C` clears your input. `Ctrl+Q` quits.

Checks and work mode run only while hobkin is open. On a Mac it keeps the machine awake for that long, and the display still dims and sleeps.

## Add a schedule

Ask the agent in Chat, or save this as `~/.hobkin/schedules/daily/morning-recap.md`:

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

Set your own timezone and `cwd`. hobkin picks the file up by itself, and `hobkin schedules` lists your checks and any errors. The [schedule guide](src/prompts/schedule-setup.md) covers weekly, monthly, one-time and hourly checks.

## Work mode

Type `/work` in Chat to turn it on or off. The first time, hobkin asks which folder to start from. It looks through the repositories there and proposes projects. Nothing starts until you take one: answer in Chat, or press `y` or `n` on its row in the Work Mode tab.

Agents study each project you take and file items for what they find. All items go in one queue, graded P0 to P3, with P0 first. When a worker is free and the daily token budget allows it, the top of the queue starts by itself.

Every change happens on a `hobkin/*` branch, and git can bring it all back, so nothing waits for permission. Agents never commit to your default branch or merge into it. Deploying, publishing and deleting what git cannot bring back stay with you.

If a project's folder is clean, idle and on its default branch, a run works there, so you will see its branch until the run ends. Otherwise it uses a worktree.

Each project has a priority, which sets how often agents look at it, from every hour at P0 to once a day at P3, and the grade its items start at. It also has a PR setting, which is off by default. With PRs off, finished work is a local branch plus a saved description, listed under READY for you to review. `hobkin work pr <project> <item>` prints one. The `draft` and `published` settings open a PR instead.

In the Work Mode tab:

- `p` changes a project's priority or an item's grade.
- `r` changes a project's PR setting, and on a finished branch asks for a review.
- `d` opens a finished branch's diff, if you have the pi-coder extension.
- `x` marks an item done.
- `s` skips a queue row or puts it back.
- `Enter` on a queue row runs it next.

Once a week, Chat gets a review that says what is progressing and which projects look stale. It drops nothing itself, and `hobkin work review` prints it at any time.

## Where to go next

- `hobkin work help` lists every work mode command.
- `/help` shows a short guide in Chat.
- [docs/guide.md](docs/guide.md) is the full reference, with limits, recovery, learning, memory search and more.
