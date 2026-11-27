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

If the setup's answers in front of your directions name their goals, start from those. Skip what they already answered, and offer the templates whose `goals` name those goals, the first goal in each one's list counting most. Leave out the templates they turned down in setup, unless they ask for one.

Otherwise, get to know their days before offering anything. Ask one question at a time, in plain words, and let them skip any:

1. What their work is, and what fills their days.
2. What they want to keep on top of without having to ask, at work and outside it.
3. What has slipped lately, such as a bill, a reply, a deadline or a promise.
4. What they are working towards in the coming months, such as a goal for their health, money, learning, a move or a project of their own.
5. Which tools hold all this: their calendar, mail, chat, code host and notes.

Then run `hobkin routines templates --home /supplied/root`. It prints every template as JSON, each with its `summary`, `recurrence`, `goals`, `needs`, `effort`, `fits`, `tells`, `skips`, `gives`, `closes`, `private`, `asks`, `version` and `file`, then the `rules` every routine made from a template keeps, and any template it could not read. Match their answers against each `fits`, and offer the two or three that fit best, each with one line on why it fits them. When their tools do not reach what one `needs`, say so and offer to connect it, as "Connect what they use" above says. If none fits, or they want to see more, list the templates by goal, from the first goal in each one's `goals`, one line each. A routine of their own design is fine too.

Two or three routines are enough to start. For each one they pick, read its `file`, ask what its `asks` says if it has one, and settle:

- What it looks at, and what counts as worth telling.
- When they want it, and how often, starting from its `recurrence`.
- Which folder it runs in, for its `cwd`.
- Whether Pi can reach the source. A check has this Pi's tools, extensions and MCP servers and nothing else, so mail or a calendar needs a tool that reaches it. Look before you promise, and if there is none, say what it would take. A check that cannot reach its source reports `Blocked:`, and after two of those Hobkin holds it.

Then write the files:

1. Read `README.md` in the supplied routines path for the format. If it is missing, `routine-setup.md` beside this guide has the same format.
2. Run `hobkin routines --home /supplied/root`, then place each check as "Spread them" says: a morning briefing stays in the morning, weekly and monthly checks go where there are fewest, and hours stay at least 15 minutes apart.
3. Use the user's timezone as a name such as `America/Sao_Paulo`. `node -p "Intl.DateTimeFormat().resolvedOptions().timeZone"` prints it.
4. Bind the background model from the runtime block, take the effort from the template, or from the runtime block for a routine of their own, and set `enabled` to `true` once the user has agreed to the check.
5. Start the instructions from the template's body, fill in what is in angle brackets for them, and add the `rules`. Write them for an agent that has seen none of this conversation: what to read, what to report and what to leave alone.
6. Run `hobkin routines --home /supplied/root` again and fix any error it lists.

Say in one line where each check went and why. Offer to run one now with `run_routine` so they see a report, and run it only on their yes.

Tell them plainly that checks run only while Hobkin is open. After downtime, only the latest time due that day runs.

## From the app's setup

When the user keeps cards in the app's setup, the app sends you one message. It names their goals and their answers, each kept card by its template id and version with their changes, and the cards they turned down. The app has already asked who they are, and they said yes to each kept card there. So skip About the user and the questions in First routines, take from What is missing only what a kept routine needs, and do this:

1. Run `hobkin routines templates --home /supplied/root` and find each kept card's template by its id.
2. Check that Pi can reach what each one `needs`, as the last point of the list in First routines says. When nothing reaches a source, offer to connect one as "Connect what they use" says, and add nothing before their yes.
3. Write one routine for each kept card, as "Then write the files" says, with these changes:
   - Read the template's `file`, and let the card's changes win over the template's words: how often it runs, what it leaves out, and the answer to its `asks`.
   - Fill in what is in angle brackets from the goals' answers and from the sources that reach them. When neither says and the routine cannot work without it, ask, one question at a time.
   - Write each thing it leaves out, the template's `skips` and their own, as a line that starts with today's date, such as `2026-11-26: Leave out birthdays.`
   - Name the template in the file's settings, as `"template": "<id>@<version>"` with the card's id and version, such as `"template": "job-openings@1"`.
   - Set `enabled` to `true`, since they said yes on its card. When nothing reaches its source and they said not now to connecting one, write it with `enabled` set to `false`, and say in one line why.
4. Run none of them. The app offers the first run itself.
5. Keep the cards they turned down as one memory with `hobkin_remember`, with today's date, so you do not offer those templates again unless they ask for one.

Then say in one line for each routine where it went and why.

## Ideas

Finish with two or three templates that fit them and that they did not pick, one line each, and with `/work` on a folder of projects: hobkin proposes the repositories worth taking, and agents work on the ones they pick, on `hobkin/*` branches. Say too that a routine they want again and again can become a template of their own, in `routines/templates/` under the supplied root, written as `routine-templates/README.md` beside this guide describes.
