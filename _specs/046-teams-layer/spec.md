---
{
  "id": "046-teams-layer",
  "title": "Seeing a run's pi-extended-teams agents",
  "kind": "work",
  "status": "doing",
  "depends": ["010-routines", "021-agent-rendering", "034-durable-hobkins", "038-resources"],
  "updated": "2026-11-27"
}
---
# Seeing a run's pi-extended-teams agents

## Outcome

A durable hobkin's turn or a routine run runs in its own Pi process, and the agent in it can start agents of its own with pi-extended-teams. The user sees those agents on the agent's page as pi-extended-teams shows them under Pi's editor: under the input, one row each with its name, the model and level it runs on, its tier, how long it has been out, what its context holds and what it is doing, running ones first. Down from the empty input opens a navigator floating over the page that shows, read only, what each was asked, its last steps and the messages between it and the run. hobkin only shows them. It never starts, stops, messages or owns them, and they never count as hobkin's helpers.

## Decisions

### What it is

- The user, 2026-11-15: "i also need to see the agents running from a durable/routine agent screen", and then "i want it to support pi-extended-teams, as a visual layer". Asked how far it goes: "hobkin (app) doesnt but the agent can do everything, as pi does".
- Display only in the app. The agent's own use of pi-extended-teams is unchanged and unrestricted: inside a run it keeps every tool and behavior it has in the user's own Pi (`spawn_agent`, `spawn_swarm_agents`, `send_message`, `read_inbox`, `get_agent_status`, stopping or waiting for its agents, and the rest). Nothing here filters, wraps, blocks or limits them. The layer only reads what the run's process already sends hobkin and what teams already writes to disk.
- It shows agents only for a run that loads pi-extended-teams. `038-resources` decides what loads. The main chat loads nothing of Pi's, and a Claude Code run has no Pi, so neither shows anything.
- Any run on an agent's screen gets the rows, so a delegated job or a Work run that starts teams agents shows them too.

### Kept apart from hobkin's helpers

- hobkin commit `398b3f2` (2026-11-12) removed `SpawnedAgents`, an earlier tracker of teams agents. It keyed each agent by name alone, so a report from any agent with that name finished the row and a reused name took over another agent's row. It read only the parent's stream, so it could not see a teams agent's own children. When the run ended it marked every agent still out `stopped`, which was a guess. And it published its rows as `jobChildren` and `mainChildren`, the fields hobkin's own helpers now use for their exact lifecycle, custody, Force stop and budget (`OwnedActivity` in `src/cli/job-activity.mjs`; the plan for that change said the display "must not become another execution/authority registry").
- This layer does not bring that back. Teams agents travel in their own field, `teamsAgents`, with a shape of their own (`shared/protocol/teams.ts`). They never enter `jobChildren`, `mainChildren`, `stopControls`, Force, helper counts, budgets or custody, and no code that decides what to stop or charge reads `teamsAgents`.
- A name alone never identifies an agent (see "Matching"). hobkin says an agent finished, failed or is still running only when teams' files or the run's own events say so. Otherwise it says the agent's state is unknown.

### What is read, and from where

- Always available: the run's own Pi events, which hobkin already receives for the run's activity (`observeActivity` in `src/cli/application.mjs`). They give each `spawn_agent` and `spawn_swarm_agents` call with its arguments (each agent's name, what it was asked, its model slot) and its result (queued or started, failed with why, and `details.session`, the run's teams session `session-<Pi session id>`), each `send_message` the run sent an agent, and the `pi-extended-teams-report` and `pi-extended-teams-wake` messages that reached the run.
- When they exist, teams' own files for that session, in `~/.pi/teams/session-<Pi session id>/` (pi-extended-teams 2.7.1, `src/utils/paths.ts`):
  - `config.json`: the team's name and `leadSessionId`, and its members while they run, each with its prompt, `joinedAt` and `lifecycleRunId`.
  - `lead-session.json`: the lead's `sessionId`.
  - `reports.json`: each run that reported, with its status, `startedAt`, `createdAt`, summary and `result.runId`.
  - `runtime/<name>.json`: a running agent's phase (`currentAction`), its tool, its heartbeat and what it last said it is doing (`latestProgress`, kept to 200 characters).
  - `inboxes/<name>.json` and `inboxes/team-lead.json`: the messages between the run and each agent, with the run ids they were sent to and from.
  - `agent-sessions/<name>/<run id>/*.jsonl`: the agent's own Pi session, which teams keeps for a day (`PRIVATE_AGENT_SESSION_RETENTION_MS`). Its last response that measured anything gives the tokens its context held, as Pi's own footer counts them (`calculateContextTokens`: the total, or else input, output and cache reads and writes). A response cut short or failed measured nothing.
- Plain reads only. hobkin takes none of teams' locks, writes nothing in its folders, calls none of its tools and sends it no event. A missing, unreadable or malformed file is skipped. A JSON file over 8 MB is not read, and of a session file only its last 256 KB is read.
- The folder is the one teams writes: `.pi/teams` in the home of the user hobkin runs as. Tests give the reader a folder of their own and never read `~/.pi`.
- Reads happen at most every 2 seconds: while a run that named the session is running, once more after it ends, and after that only while teams still lists one of its agents as running with a fresh heartbeat (a durable hobkin's process outlives its turn). An idle hobkin reads nothing. A file is parsed again only when its size or time changed.

### Matching, never by name alone

- teams' files belong to a run only through the session the run's own spawn result named. The folder counts when its `config.json` has that name and its `leadSessionId` is the session's id, and its `lead-session.json` has the same `sessionId`. teams calls a Pi with no session id `session-local-session`, which many processes could share, so that folder is never read.
- Within the session, a record of teams belongs to a row when it has the row's name and started at or after the row's spawn call began (with 2 seconds' slack), and is the earliest such record. teams keeps one run of a name alive at a time in a session, and spawning a name again ends the run it had (`spawnTeammate`, `extensions/tools/team-tools.ts`), so this finds the run that call started. An agent spawned in an earlier turn of the same durable hobkin is therefore not listed again under a later turn.
- A report or a wake in the run's own events ends the newest row in that run that is still out with that name, or with that completion group. Only the run's own Pi process sends those to it.

### What a row shows

- Changed on 2026-11-27, the user's words: "i dont like the agents in a durable or temp new agent running in the top as a pill to open and see more. this is based on pi-extended-teams and i want it to behave the exactly same way, behind the input, showing a quick status update, tokens used, how long is running, if press down i can see more in the screen like floating, etc. same thing, not the pill". Until then the agents were a pill under the header with a list one click away, and a sheet for one agent.
- Under the agent's input, as pi-extended-teams' activity widget under Pi's editor (`ui/src/features/teams/SubagentActivity.tsx`): a heading, "Agent activity" with how many are active, failed, unknown and done, and "↓ navigate" at its right, then one row each. A row: its face, its name in its face's color, what it is doing (its own words while it runs, else the first line of what it was asked, else its phase or tool, else how it stands with its report's summary; only its own words read in full color), then chips at the right, each with its icon, as the GitHub page draws a stack's layer: the model's own id and level ("gpt-6-luna · xhigh"), its tier (a magnifier for a read tier, a pencil for a write tier), how long it has been out ("38s", "1m05s", "1h05m") or how long it ran once it ended, and what its context holds with its share of the model's window when the window knows its size ("26k · 10%", orange from 75% and red from 90%, where pi-extended-teams warns). Each kind of chip has a column of its own, as wide as its widest chip down the list; each chip is as wide as its words and keeps to its column's right edge, and a column no row has anything for takes no room, so the chips line up at the right and the text keeps the rest (the user, 2026-11-27: "the badges should align (they in the right, text in the left), and they should not have useless gap, like in seconds"). The names share a column as wide as the longest. On a narrow page the model and the tier give way first. Its hover has the rest: what it was asked and when it started and ended.
- Changed again on 2026-11-27, once the user saw it live: "there is too much space in the bottom, no right gap between each, too close, i want real icons like github integration users for stack". Until then a row was one line of words joined by "·" on tree branches, with a dot for its standing, and an empty status line under the rows.
- hobkin's own helpers share the list, as they shared the header's lines: their name, model, level and tier, and how they stand. hobkin measures no helper's tokens and keeps no times for an owned helper, so those parts are left out.
- Statuses: `queued`; `running`, with teams' phase or tool when its runtime file has one; `done`, it reported, which does not say whether the work is right; `failed`, it could not start or it reported a failure; `unknown`, no report was seen and either the run has ended or teams no longer lists it, so hobkin cannot tell how it ended.
- Running first, then queued, then unknown, then failed and done. Within each, teams agents before helpers, each in the order they were spawned.
- A done agent leaves; a failed or unknown one stays, since it may need the user. The user's words on 2026-11-19: "done sub-sub agents should disappear". A helper that reported, completed or was cancelled leaves the same way.
- What the user is reading does not leave under them: while the navigator is open, every agent it showed stays in it, marked as it ended. Once they close it, an ended one leaves. Added on 2026-11-21, after the user's report that the agents "vanish" when clicked.
- Ten rows at most, then "… N more agents"; the navigator lists every one.
- At most 24 rows for a run. hobkin keeps the rows of the 20 runs that ended last, so a finished run's screen and a waiting durable hobkin's page still show theirs until hobkin restarts.

### The navigator

- Down from the agent's empty input, or a click on a row, opens pi-extended-teams' agent navigation over the right side of the window, 95% of its width and height and above its menu, on the first agent or the one clicked. Changed on 2026-11-27, the user's words: "press down should take 95% of width/height of this right side of the window, not a float"; until then it was a dialog of at most 960px in the middle of the window. It holds "↑" with the agent's own name, every agent's row as under the input with the one shown marked, and the keys; then, read only, everything it was asked (up to 2,000 characters), its summary when it reported, and its last 16 steps, drawn as an agent's steps are (`021-agent-rendering`), from its own session file when teams kept one, and up to 12 messages between it and the run, from teams' inboxes, or else from the run's own `send_message` calls and the agent's report. When none of these is there, it says hobkin has nothing of its work to show. Its foot says where hobkin read it from and that hobkin does not control these agents.
- Its steps keep only what hobkin keeps of any agent (`JobActivity`): its words and each tool call with its input and output, cut short. Never its thinking or a tool's details.
- Keys, as pi-extended-teams' own: Down and Up walk the agents, Up from the first and Escape close it with the keyboard back where it was, Left and Right go round, Page Up and Page Down scroll what it did, Home goes to its top and End follows the newest again. It follows the newest until the user scrolls up.
- No input and no stop or send control: pi-extended-teams' `m`, `i` and `x` reach an agent, which hobkin never does (see "Out of scope").
- With no agents, Down in the input does what it did before.

### Where it shows

- Every agent's page has it under its input: a durable hobkin's and a run's. While the rows are there, the input's empty status line takes no room under them. hobkin's mind has no input of its own (the chat is its input), so its agents show at the page's foot, opened by a click. The header's lines keep the tasks, schedules and loaded skills (`AgentLines.tsx`).
- A durable hobkin's rows read every turn whose run hobkin still holds.
- A spawn call is a step, so a run with teams agents always shows its exchange too.

### On the wire

- `teamsAgents` in hobkin's snapshot: for each run that has any, its rows, by run id. It travels whole, as `jobChildren` does, and the host passes it on as it passes any key it does not hold back (`toWire`, `host/src/state-sync.ts`).
- The reader never fails a run, a refresh or the snapshot. Every read and every event it takes is caught, and on an error the rows stay as they were.

## Out of scope

- Starting, stopping, messaging, steering or waiting for a teams agent from the app or the host.
- Any change to what a run's agent may do with pi-extended-teams, or to how its harness waits for agents (`src/cli/harnesses.mjs`).
- Teams agents of the main chat and of Claude Code runs.
- An agent's own children (teams' nested read agents) as rows of their own. They report to the agent that started them.
- Completion group journals, checkpoints and claims.
- Counting teams agents' tokens or cost in hobkin's usage. The tokens a row shows are what its context holds, for the user to read; nothing adds them up.
- Measuring hobkin's own helpers' tokens or keeping their times for the rows.
- What loads in each kind of run, which `038-resources` decides.

## Acceptance

- ~~A1. While a durable hobkin's turn or a routine run has pi-extended-teams agents, its screen shows them, running ones first. A durable hobkin's page lists each with its name, the first line of what it was asked, its status, when it started to the second, and when it finished or failed. A routine run's screen shows each with its name, status and time, and the rest in its label and in the list one click away. A run that started none looks as it did before.~~ Retired on 2026-11-27: the pill and its list gave way to the rows under the input (A8).
- A2. With teams' files missing, unreadable, malformed or for another session, the rows come from the run's own spawn calls, reports and wakes. A reader error never fails the run and never keeps the screen from drawing.
- A3. teams' files fill a run's rows only when their session is the one the run's own spawn result named, as both `config.json` and `lead-session.json` say. An agent of the same name in another session, or an earlier run of the same name in the same session, never fills a row.
- A4. An agent the run saw start and never saw end reads running while its run is live, unless teams' files are there and no longer list it. After its run ends it reads running only while teams lists it with a heartbeat from the last 90 seconds. Otherwise it reads unknown. hobkin never says an agent finished or stopped when neither teams' files nor the run's own events said so.
- ~~A5. Opening a row shows, read only, what it was asked, its status and times, its last steps when teams kept its session, and the messages between it and the run, or says there is nothing to show. Escape puts the keyboard back on the row.~~ Retired on 2026-11-27: the sheet gave way to the navigator (A9).
- A6. Nothing in hobkin starts, stops, messages or waits for a teams agent. The rows and the navigator have no such control. Teams agents never appear in `jobChildren`, `mainChildren`, Stop or Force targets, helper counts or budgets, and hobkin writes nothing in teams' folders.
- A7. A run's pi-extended-teams tool calls behave exactly as before the layer existed. hobkin filters, wraps, blocks or limits none of them, and the events the run's harness handles are the same ones, unchanged.
- A8. A durable hobkin's page and a run's page show the agent's pi-extended-teams agents and hobkin's helpers under its input, never as a pill under its header: "Agent activity" with how many are active, failed and unknown, then a row each, running ones first, ten at most with the rest counted. A row has its name, the model and level it runs on, its tier, how long it has been out, what its context holds with its share of the model's window when the window knows it, and what it is doing. A done agent leaves and a failed or unknown one stays. An agent with none shows nothing there.
- A9. Down from an agent's empty input, or a click on a row, opens the navigator over 95% of the right side of the window on the first agent or the one clicked, read only: the agents with the shown one marked, its row, the keys, what it was asked, its report, its last steps and its messages, or that there is nothing to show. Down and Up walk the agents, Up from the first and Escape close it with the keyboard back in the input, Left and Right go round, Page Up and Page Down scroll and End follows again. While it is open no agent leaves it. With no agents, Down does what it did before.
- A10. A running teams agent says what it is doing in its own words from teams' runtime file, only while it runs and up to 200 characters, and what its context holds from its own session's last response that measured anything, as Pi counts it. A response cut short or failed counts nothing. Without those files a row has neither.

## Proof

- ~~A1.~~ Retired with its acceptance.
- A2. `hobkin/test/cli-teams-agents.test.mjs` › "without teams' files, or with broken ones, the rows stand on the run's own events"
- A3. `hobkin/test/cli-teams-agents.test.mjs` › "teams' files count only for the session the run named, and a name alone never matches"
- A4. `hobkin/test/cli-teams-agents.test.mjs` › "an agent never seen to end reads unknown once its run ended or teams no longer lists it"
- ~~A5.~~ Retired with its acceptance.
- A6. `hobkin/test/cli-teams-agents.test.mjs` › "reading teams' files writes nothing there"; `hobkin/test/cli-application.test.mjs` › "a run's teams agents travel in teamsAgents, never in jobChildren"; check: `rg teamsAgents` in hobkin and the client finds only the reader, the snapshot, the protocol type, `ui/src/features/teams/` and their tests, and nothing in stop, Force, children or usage code.
- A7. `hobkin/test/cli-teams-agents.test.mjs` › "observing a run's events changes none of them"; check: `git diff` shows `src/cli/harnesses.mjs`, `src/cli/bridge.mjs` and the pi-extended-teams package untouched by this work, and `observeActivity` hands the reader each event after the run's own feed has it.
- A8. `ui/test/agent-activity-rows.test.ts` › "teams agents and helpers make one list, what is still out first, teams agents before helpers in a tie", "a running teams agent reads as pi-extended-teams' activity row: model and level, tier, time out, context and what it is doing", "an agent no longer running says how it stands, and its time stops where it ended", "a helper's row has what hobkin keeps of it: its model, level and tier, and how it stands", "the heading counts what is out, then what failed or was lost, as the activity header does", "the strip draws ten rows at most and counts the rest", "times and token counts are written as pi-extended-teams writes them", "a running teams agent without its own words says what it was asked, else its tool or phase, else that it runs" and "a helper that reported, completed or was cancelled leaves; one still out, failed or never seen to end stays"; `ui/test/teams-rules.test.ts` › "a done agent leaves the strip, and a failed or unknown one stays"; check: still renders of the rows under a durable hobkin's input with four teams agents and a helper, light and dark, and `rg 'TeamsStrip|HelpersLine' ui` finds nothing.
- A9. `ui/test/teams-agents-read.test.ts` › "an agent the navigator shows stays in it once it finishes, marked as it ended, and leaves when the navigator closes" and "Down opens the navigator only over an agent whose strip draws agents, on the first or the one asked for"; `ui/test/agent-activity-rows.test.ts` › "in the navigator Down walks to the next agent, Up back, and Up from the first leaves it; Left and Right go round"; `ui/test/teams-rules.test.ts` › "an opened agent says what it was asked and what hobkin has of its work"; check: still renders of the navigator, light and dark; in the live window, Down from the empty input of a durable hobkin with a teams agent running opens it, and Escape puts the keyboard back in the input.
- A10. `hobkin/test/cli-teams-agents.test.mjs` › "a running agent says its latest progress and how many tokens its context holds, from teams' own files" and "an agent's steps and messages come from its own session and the inboxes, cut to size".

## Steps

S1 comes first, then S2 and S3 can be built at once (S3 against the protocol type until S2 lands). S2 wires the reader in last, after its tests pass, so the live host never runs it untested. S5 needs the user's go-ahead.

Note, 2026-11-15. S1 to S4 are built and their proofs pass: the reader's 8 tests (red first against an empty module), the publication test in `cli-application.test.mjs` (red against the application at HEAD, green with the wiring), the window's 2 rule tests, the client typecheck, and still renders of both screens, the opened sheet and its list, light and dark (server markup with the app's built CSS, no browser). Three other tests in `cli-application.test.mjs` fail the same way at HEAD without this work (tool lists and harness options), and are not this spec's. Not seen yet: a real Pi run with pi-extended-teams writing these files while hobkin reads them, the sheet's focus and Escape in the live window, and the reads' cost on a busy session. S5 covers the first two.

- [x] S1 (A2, A3, A4, A5, A6, A7). Runtime: the reader, unwired. Files: new `hobkin/src/cli/teams-agents.mjs`; tests new `hobkin/test/cli-teams-agents.test.mjs`, with fixture folders and fake events, no real Pi and no real `~/.pi`.
- [x] S2 (A1, A6, A7). Runtime: `hobkin/src/cli/application.mjs` hands each run's events to the reader after its feed, publishes `teamsAgents` beside `jobChildren`, and closes the reader with the app.
- [x] S3 (A1, A5, A6). Window: new `shared/protocol/teams.ts` and one field in `shared/protocol/snapshot.ts`; new `ui/src/features/teams/` (`rules.ts`, `use-teams-agents.ts`, `TeamsStrip.tsx`, `TeamsAgentSheet.tsx`); the strip in `ui/src/features/work/AgentScreen.tsx` and `ui/src/features/hobkins/HobkinScreen.tsx`; tests new `ui/test/teams-rules.test.ts`.
- [x] S4 (A1, A5). Still renders without a browser: a routine run's screen, a durable hobkin's page, the opened sheet and its list, with four teams agents, light and dark.
- [ ] S5 (A4, A9). With the user's go-ahead, once the live host has taken the new runtime: a durable hobkin asked to start one teams agent shows it running, then done, with its steps.
- [x] S6 (A10). Runtime: the reader keeps teams' `latestProgress` and counts the context tokens of the agent's session as it reads its steps (`hobkin/src/cli/teams-agents.mjs`); `progress` and `tokens` in `shared/protocol/teams.ts`. Red first: the new reader test failed on `tokens` before the change.
- [x] S7 (A8, A9). Window: `ui/src/features/teams/activity.ts` (the rows' words, order and keys), `use-activity.ts` (the agents and the navigator's state) and `SubagentActivity.tsx` (the rows and the navigator), under the inputs of `HobkinScreen.tsx` and `RunPage.tsx` and at the foot of `MainAgentScreen.tsx`. The teams line (`TeamsStrip.tsx`), the helpers line, the sheet and their drops are gone from `AgentLines.tsx`. Still renders of the rows and the navigator, light and dark.
- [x] S9 (A8, A9). The rows as the GitHub page draws its cards: faces, chips with icons at one width each on a grid whose name column fits the longest name, its own words apart from what it was asked, and no empty line under them; the navigator lists the same rows. Still renders, light and dark, wide and narrow.
- [x] S11 (A8). Each chip kind in its own column, each chip as wide as its words at its column's right; empty columns take no room. Still renders: rows with no context yet, rows with everything, and a narrow page.
- [x] S10 (A9). The navigator renders into the right side (`data-canvas-surface` in `Canvas.tsx`) at a 2.5% inset, above its menu; with no right side, over the window. Still render over a mock right side, light and dark.
- [ ] S8 (A8, A9, A10). Live: once the host has restarted onto S6, a durable hobkin's teams agent shows its tokens and its own words under the input, and Down opens the navigator on it.

## Open questions

- teams writes under `os.homedir()` of the Pi process. A launcher whose environment sets another `HOME` sends teams' files there, and hobkin, reading its own home, then shows rows from the run's events only. (a) Keep it so. (b) Read under the launcher's `HOME` when it sets one: one more place hobkin reads, chosen by a setting the user made for another reason.
