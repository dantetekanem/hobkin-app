# What Hobkin can do

Hobkin runs your checks on a schedule, saves what they find as reports, and gives you an agent to talk to about all of it. Almost everything works by asking in Chat, so start there when you are not sure.

## Moving around

- `←` `→` change views while the draft is empty. A running check gets its own tab.
- `↑` `↓`, `pgup` `pgdn` and the mouse wheel scroll.
- `esc` goes back and keeps your draft.
- `k` cancels the running check on screen.
- `ctrl+c` quits. Checks run only while Hobkin or `hobkin run` is open.

## Commands

Type `/` to see them. Tab fills in the rest, and cycles when several fit.

- `/help` opens this page.
- `/clear` hides the visible chat. History and context stay.
- `/reset` starts a fresh conversation. Old transcripts and background work stay.
- `/work` turns work mode on or off. `/work ~/Projects` starts it in that folder.
- `/jev` turns Jev on or off.

## Chat

Enter sends. Your message shows straight away, gray until the agent has it, and waits its turn if the agent is busy. `ctrl+j` adds a line and `↑` brings back what you sent.

Some things to ask:

- "Switch to Opus with high thinking." It changes on the next model call, with no restart.
- "Remember that the release moved to Friday." The agent keeps up to 20 short items in `memory.md` and sees them on every turn.
- "From now on, keep reports under ten lines." Standing directions go in `AGENTS.md`. The chat, the checks and work mode follow them from their next turn or run.

Both files sit in the data folder, `~/.hobkin` by default, and you can edit them yourself.

## Checks and schedules

A check is a Markdown file in `schedules/daily`, `weekly`, `monthly` or `once` in the data folder. Hobkin picks up edits by itself, so ask the agent to add one or write the file yourself.

Some things to ask:

- "Run the morning recap now." This works on a paused check and leaves its schedule alone.
- "Tell the running email check to skip newsletters." It reads the message at its next step and carries on.
- "Use Haiku for the email check." Each check has its own model and thinking effort, and the next run picks them up.
- "Why did the email check stop?" Each check keeps a run log and its own memory in `checks/<id>/`.

A one-time check leaves Schedules once it has run. After two blocked or failed runs in a row, a check is held and tries again after 1 day, then 2, 4 and 7. A working run or an edit clears the hold.

## Reports

Enter opens the selected report. Critical and useful summaries also show in Chat, and no-news reports stay in Reports.

Press `m` inside a report to ask about it. You land in the input with the report attached, and `esc` drops it.

Hobkin notices which reports you open. A check you keep ignoring gets flagged in Schedules, so you can ask the agent to revisit it. Nothing changes on its own.

## Work mode

Work mode is a proactive agent that finds work on your projects. Press Enter in the Work Mode tab or type `/work`, then name a folder to start from. The agent goes through it folder by folder, reads the git history and offers the main projects. You choose which ones and how much they matter.

Keys in that tab:

- `y` takes a proposal, `n` skips it, and `1` `2` `3` take it as critical, important or casual.
- `1` `2` `3` also change a project's level, and `d` twice drops it.
- `x` clears something only you could do, once you have done it.
- `h` picks the harness: `pi`, `claude` or `codex`.
- Enter on a running agent watches it.

Agents then study each project, file what they find and open PRs one at a time from their own worktrees. Once a day each project also gets new ideas: up to 3 with little open work, none with plenty. Inside Herdr they run in a tab called Work Mode, where you can watch them.

Work mode has a daily allowance of 100 million tokens, spread across the day. `hobkin work tokens <number>` changes it. If it runs out, work pauses, nothing is lost, and Hobkin asks in Chat for more and says why. Run `/work` again to stop. Projects, items and branches stay.

## Big jobs

Agents here do not spawn subagents. When a job is massive, the agent opens a full Pi session with all permissions in a new Herdr pane, in a tab called Hobkin, and leaves it there for you. Outside Herdr it does the work itself. That direction lives in `AGENTS.md`, so you can change it.

## The face

The face left of the input follows what is happening: idle, thinking, working, and happy after a useful report. With Jev on, a model from TypeSafe picks from all 18 moods as things happen. It needs `TYPESAFE_API_KEY`, and each request carries short excerpts of Chat. Nothing is sent with Jev off.

Ghostty and Kitty show the full animation. Other terminals, tmux and `HOBKIN_FACE=blocks` use block characters. The face hides on a narrow or short terminal.

## Chrome

Agents can use your signed-in Chrome through `pi-chrome` when it is installed. They read public pages and your own projects freely. Opening private accounts or changing anything through the browser needs an approved plan first: your yes in Chat, or a check's own instructions.

## From the terminal

- `hobkin` opens this dashboard.
- `hobkin run` runs checks with no dashboard.
- `hobkin status --plain` and `hobkin reports` show saved state without starting anything.
- `hobkin work` shows work mode and controls it from scripts.
- `hobkin jev on` or `off` sets Jev.
- `hobkin skill` prints a skill that teaches other agents to use Hobkin.
- `hobkin --help` lists the rest.
