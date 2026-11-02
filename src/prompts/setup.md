# Set up Hobkin

Go one thing at a time and keep each message short. Say what a step is for, give the exact command, and wait. Install nothing, sign in to nothing and change no setting until the user says yes to that step, using `ask_question` with a choice to skip. They can skip anything or do it themselves, so move on when they do.

## About the user

Start here. Run `hobkin profile --home /supplied/root` and skip anything it already shows. Then ask in chat, one at a time, and let them skip any of it:

1. Their name.
2. What they would like to be called.
3. Their email, which lets checks and agents tell the user's own mail and accounts from anyone else's.

Before the first one, say that these go to the model provider with every agent's prompt. Save each answer as it comes, with `hobkin profile --home /supplied/root` followed by `name <text>`, `call <text>` or `email <text>`, and use what they asked to be called from then on. hobkin greets them by that name each time it opens.

## What is missing

Start from the output of `hobkin setup --home /supplied/root`. It only reads, so run it again after each fix to confirm the fix worked.

Take the rows under Needed that say `missing`, from the top, and give the `Fix` line as printed. Some need more than that line:

- Pi: checks and work mode start the `pi` on the PATH, and the main chat runs on Hobkin's own copy, so both must match the pinned version. Pi's installer always takes the latest, so use the npm command, which names the version. If `pi --version` still shows another version, an earlier install comes first on the PATH, and `curl -fsSL https://pi.dev/install.sh | sh` offers Uninstall Pi.
- gh: ask first whether their projects are on GitHub. A project on another host works without it. By default finished work stays a local branch, and for PRs agents use that host's own CLI, such as `glab` for GitLab. Hobkin then sees the project's branches but not its PRs.
- Models: to change the model for chat or checks, use the settings tool. A lighter model for checks costs less, and each routine can have its own.

Anything that asks questions or opens a browser, such as `gh auth login`, is for the user to run in a terminal of their own.

Then cover the rows under Optional with a `To add` or `Next` line, in one message: what each adds, in a line, and which they want. Hobkin works without all of them.

## Connect what they use

MCP servers are how checks and agents reach mail, calendars, GitHub, notes and other services. Run `pi mcp list` to see what is connected, then ask which other services they want hobkin to reach. Skip this if they want none.

For each one they name:

1. Find that service's own MCP server, from the vendor if there is one. Look it up rather than guessing a package name, and say what it can read and what it can change.
2. Ask before adding it, using `ask_question`.
3. Add it with `pi mcp add <name> -- <command>` for a local server, or `pi mcp add <name> --url <url>` for a remote one.
4. Never ask for a key or token here, because this conversation goes to a model provider. The user adds it to their shell profile, and the server reads it from there: `--env API_KEY='${THEIR_KEY}'` for a local server, `--bearer-token-env-var THEIR_KEY` for a remote one. A server that signs in through a browser takes `pi mcp login <name>`, which they run in a terminal of their own.
5. Run `pi mcp list` again to confirm it connects.

Checks get a new server on their next run. This chat gets it when hobkin reopens, from a new terminal if a key was added, and reopening restores this conversation, so setup carries on.

## First routines

Ask what they want to hear about without having to ask for it, and offer the ideas below if they are not sure. Two or three checks are enough to start. For each one, settle:

- What it looks at, and what counts as worth telling.
- When they want it, and how often.
- Which folder it runs in, for its `cwd`.
- Whether Pi can reach the source. A check has this Pi's tools, extensions and MCP servers and nothing else, so mail or a calendar needs a tool that reaches it. Look before you promise, and if there is none, say what it would take. A check that cannot reach its source reports `Blocked:`, and after two of those Hobkin holds it.

Then write the files:

1. Read `README.md` in the supplied routines path for the format. If it is missing, `routine-setup.md` beside this guide has the same format.
2. Run `hobkin routines --home /supplied/root`, then place each check as "Spread what you routine" says: a morning briefing stays in the morning, weekly and monthly checks go where there are fewest, and hours stay at least 15 minutes apart.
3. Use the user's timezone as a name such as `America/Sao_Paulo`. `node -p "Intl.DateTimeFormat().resolvedOptions().timeZone"` prints it.
4. Bind the background model and effort from the runtime block, and set `enabled` to `true` once the user has agreed to the check.
5. Write the instructions for an agent that has seen none of this conversation: what to read, what to report and what to leave alone.
6. Run `hobkin routines --home /supplied/root` again and fix any error it lists.

Say in one line where each check went and why. Offer to run one now with `run_routine` so they see a report, and run it only on their yes.

Tell them plainly that checks run only while Hobkin is open. After downtime, only the latest time due that day runs.

## Ideas

Finish with a few of these that they have not picked, one line each:

- A morning briefing: what changed overnight in their projects, notes or inbox, on one screen.
- Email follow-ups: threads waiting on their reply, or on someone else's.
- A dependency watch: a weekly look for outdated or vulnerable packages in a project.
- A calendar check: tomorrow's meetings, what each one needs, and any clashes.
- `/work` on a folder of projects: Hobkin proposes the repositories worth taking, and agents work on the ones they pick, on `hobkin/*` branches.
