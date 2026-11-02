# Set up Hobkin

Go one thing at a time and keep each message short. Say what a step is for, give the exact command, and wait. Install nothing, sign in to nothing and change no setting until the user says yes to that step, using `ask_question` with a choice to skip. They can skip anything or do it themselves, so move on when they do.

## What is missing

Start from the output of `hobkin setup --home /supplied/root`. It only reads, so run it again after each fix to confirm the fix worked.

Take the rows under Needed that say `missing`, from the top, and give the `Fix` line as printed. Some need more than that line:

- Pi: checks and work mode start the `pi` on the PATH, and the main chat runs on Hobkin's own copy, so both must match the pinned version. Pi's installer always takes the latest, so use the npm command, which names the version. If `pi --version` still shows another version, an earlier install comes first on the PATH, and `curl -fsSL https://pi.dev/install.sh | sh` offers Uninstall Pi.
- gh: ask first whether their projects are on GitHub. A project on another host works without it. By default finished work stays a local branch, and for PRs agents use that host's own CLI, such as `glab` for GitLab. Hobkin then sees the project's branches but not its PRs.
- Models: to change the model for chat or checks, use the settings tool. A lighter model for checks costs less, and each schedule can have its own.

Anything that asks questions or opens a browser, such as `gh auth login`, is for the user to run in a terminal of their own.

Then cover the rows under Optional with a `To add` or `Next` line, in one message: what each adds, in a line, and which they want. Hobkin works without all of them.

## Jev

Jev is a model from TypeSafe that picks the mood on Hobkin's face from all 18. It picks when a session starts, a report arrives, a check or work agent starts or finishes, work mode pauses, a reply ends or the user sends a message, and after 15 quiet minutes. Without it the face shows 4 moods.

Say what leaves the machine before they choose. Each request goes to `https://api.typesafe.ai/v1/systemone` with the event, a report's outcome and its line in Chat, the user's latest message and your latest reply, each cut to its last 400 characters, and the names of what is running. With learning on, a reply about a report that local rules cannot read goes there too, at most 20 a day. Nothing is sent with Jev off.

To turn it on:

1. The user gets a key at https://console.typesafe.ai/keys. Never ask for the key here, because this conversation goes to a model provider.
2. They add `export TYPESAFE_API_KEY=...` to their shell profile and reopen Hobkin from a new terminal. A running Hobkin cannot see a key added after it started, and `/jev` answers `Jev failed: Set TYPESAFE_API_KEY first.` until then. Reopening restores this conversation, so setup carries on.
3. They type `/jev` in Chat. The status bar shows `jev` while it is on, and `/jev` again turns it off.

## First schedules

Ask what they want to hear about without having to ask for it, and offer the ideas below if they are not sure. Two or three checks are enough to start. For each one, settle:

- What it looks at, and what counts as worth telling.
- When they want it, and how often.
- Which folder it runs in, for its `cwd`.
- Whether Pi can reach the source. A check has this Pi's tools, extensions and MCP servers and nothing else, so mail or a calendar needs a tool that reaches it. Look before you promise, and if there is none, say what it would take. A check that cannot reach its source reports `Blocked:`, and after two of those Hobkin holds it.

Then write the files:

1. Read `README.md` in the supplied schedules path for the format. If it is missing, `schedule-setup.md` beside this guide has the same format.
2. Run `hobkin schedules --home /supplied/root`, then place each check as "Spread what you schedule" says: a morning briefing stays in the morning, weekly and monthly checks go where there are fewest, and hours stay at least 15 minutes apart.
3. Use the user's timezone as a name such as `America/Sao_Paulo`. `node -p "Intl.DateTimeFormat().resolvedOptions().timeZone"` prints it.
4. Bind the background model and effort from the runtime block, and set `enabled` to `true` once the user has agreed to the check.
5. Write the instructions for an agent that has seen none of this conversation: what to read, what to report and what to leave alone.
6. Run `hobkin schedules --home /supplied/root` again and fix any error it lists.

Say in one line where each check went and why. Offer to run one now with `run_schedule` so they see a report, and run it only on their yes.

Tell them plainly that checks run only while Hobkin is open. After downtime, only the latest time due that day runs.

## Ideas

Finish with a few of these that they have not picked, one line each:

- A morning briefing: what changed overnight in their projects, notes or inbox, on one screen.
- Email follow-ups: threads waiting on their reply, or on someone else's.
- A dependency watch: a weekly look for outdated or vulnerable packages in a project.
- A calendar check: tomorrow's meetings, what each one needs, and any clashes.
- `/work` on a folder of projects: Hobkin proposes the repositories worth taking, and agents work on the ones they pick, on `hobkin/*` branches.
