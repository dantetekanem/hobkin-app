---
{
  "id": "046-teams-layer",
  "title": "Seeing a run's pi-extended-teams agents",
  "kind": "work",
  "status": "doing",
  "depends": ["010-routines", "021-agent-rendering", "034-durable-hobkins", "038-resources"],
  "updated": "2026-11-15"
}
---
# Seeing a run's pi-extended-teams agents

## Outcome

A durable hobkin's turn or a routine run runs in its own Pi process, and the agent in it can start agents of its own with pi-extended-teams. The user sees those agents on the durable hobkin's page and on the routine run's screen: a quiet strip with each agent's name, what it was asked, how it stands, when it started to the second, and when it finished or failed, running ones first. Opening one shows, read only, what it was asked, its last steps and the messages between it and the run. hobkin only shows them. It never starts, stops, messages or owns them, and they never count as hobkin's helpers.

## Decisions

### What it is

- The user, 2026-11-15: "i also need to see the agents running from a durable/routine agent screen", and then "i want it to support pi-extended-teams, as a visual layer". Asked how far it goes: "hobkin (app) doesnt but the agent can do everything, as pi does".
- Display only in the app. The agent's own use of pi-extended-teams is unchanged and unrestricted: inside a run it keeps every tool and behavior it has in the user's own Pi (`spawn_agent`, `spawn_swarm_agents`, `send_message`, `read_inbox`, `get_agent_status`, stopping or waiting for its agents, and the rest). Nothing here filters, wraps, blocks or limits them. The layer only reads what the run's process already sends hobkin and what teams already writes to disk.
- It shows agents only for a run that loads pi-extended-teams. `038-resources` decides what loads. The main chat loads nothing of Pi's, and a Claude Code run has no Pi, so neither shows anything.
- Any run on an agent's screen gets the strip, so a delegated job or a Work run that starts teams agents shows them too.

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
  - `runtime/<name>.json`: a running agent's phase (`currentAction`), its tool and its heartbeat.
  - `inboxes/<name>.json` and `inboxes/team-lead.json`: the messages between the run and each agent, with the run ids they were sent to and from.
  - `agent-sessions/<name>/<run id>/*.jsonl`: the agent's own Pi session, which teams keeps for a day (`PRIVATE_AGENT_SESSION_RETENTION_MS`).
- Plain reads only. hobkin takes none of teams' locks, writes nothing in its folders, calls none of its tools and sends it no event. A missing, unreadable or malformed file is skipped. A JSON file over 8 MB is not read, and of a session file only its last 256 KB is read.
- The folder is the one teams writes: `.pi/teams` in the home of the user hobkin runs as. Tests give the reader a folder of their own and never read `~/.pi`.
- Reads happen at most every 2 seconds: while a run that named the session is running, once more after it ends, and after that only while teams still lists one of its agents as running with a fresh heartbeat (a durable hobkin's process outlives its turn). An idle hobkin reads nothing. A file is parsed again only when its size or time changed.

### Matching, never by name alone

- teams' files belong to a run only through the session the run's own spawn result named. The folder counts when its `config.json` has that name and its `leadSessionId` is the session's id, and its `lead-session.json` has the same `sessionId`. teams calls a Pi with no session id `session-local-session`, which many processes could share, so that folder is never read.
- Within the session, a record of teams belongs to a row when it has the row's name and started at or after the row's spawn call began (with 2 seconds' slack), and is the earliest such record. teams keeps one run of a name alive at a time in a session, and spawning a name again ends the run it had (`spawnTeammate`, `extensions/tools/team-tools.ts`), so this finds the run that call started. An agent spawned in an earlier turn of the same durable hobkin is therefore not listed again under a later turn.
- A report or a wake in the run's own events ends the newest row in that run that is still out with that name, or with that completion group. Only the run's own Pi process sends those to it.

### What a row shows

- A row: the name, the first line of what it was asked, its status, when it started to the second in the page's clock (`stamp.ts`), and when it finished or failed. A running or queued one says since when.
- Where room is short, a chip: the name, its status and one time, since when it has been out or when it finished or failed. Its label, read on hover and by a screen reader, has the rest of a row, and the list behind "+N more" has every row whole.
- Statuses: `queued`; `running`, with teams' phase or tool when its runtime file has one; `done`, it reported, which does not say whether the work is right; `failed`, it could not start or it reported a failure; `unknown`, no report was seen and either the run has ended or teams no longer lists it, so hobkin cannot tell how it ended.
- Running first, then queued and unknown, then failed and done. Within each, in the order they were spawned.
- A done agent leaves a screen's teams strip; a failed or unknown one stays, since it may need the user. Changed on 2026-11-19, the user's words: "done sub-sub agents should disappear"; until then a done agent stayed in the strip with its end time.
- At most 24 rows for a run. hobkin keeps the rows of the 20 runs that ended last, so a finished run's screen and a waiting durable hobkin's page still show theirs until hobkin restarts.

### Opening one

- A click or Enter on a row opens a read-only sheet over the page: the name, status and times, everything it was asked (up to 2,000 characters), its summary when it reported, and its last 16 steps, drawn as an agent's steps are (`021-agent-rendering`), from its own session file when teams kept one. Then up to 12 messages between it and the run, from teams' inboxes, or else from the run's own `send_message` calls and the agent's report. When none of these is there, it says hobkin has nothing of its work to show.
- Its steps keep only what hobkin keeps of any agent (`JobActivity`): its words and each tool call with its input and output, cut short. Never its thinking or a tool's details.
- The sheet has no input and no stop or send control. Escape or Close puts the keyboard back on the row.

### Where it shows

- An agent's screen (`AgentScreen.tsx`), for a routine run or any other: one line of chips under the shrunken header, beside where the helpers' strip and the tasks' line sit. A spawn call is a step, so a run with teams agents always shows its exchange and this line.
- A durable hobkin's page (`HobkinScreen.tsx`): rows under its header, for every turn whose run hobkin still holds, with a line above them that counts them by status.
- Quiet: small faces, names and times in muted text. Three at most, running ones first, and "+N more" opens the whole list in the sheet. The chips take `HelpersGlance`'s look, not its data.

### On the wire

- `teamsAgents` in hobkin's snapshot: for each run that has any, its rows, by run id. It travels whole, as `jobChildren` does, and the host passes it on as it passes any key it does not hold back (`toWire`, `host/src/state-sync.ts`).
- The reader never fails a run, a refresh or the snapshot. Every read and every event it takes is caught, and on an error the rows stay as they were.

## Out of scope

- Starting, stopping, messaging, steering or waiting for a teams agent from the app or the host.
- Any change to what a run's agent may do with pi-extended-teams, or to how its harness waits for agents (`src/cli/harnesses.mjs`).
- Teams agents of the main chat and of Claude Code runs.
- An agent's own children (teams' nested read agents) as rows of their own. They report to the agent that started them.
- Completion group journals, checkpoints and claims.
- Counting teams agents' tokens or cost in hobkin's usage.
- What loads in each kind of run, which `038-resources` decides.

## Acceptance

- A1. While a durable hobkin's turn or a routine run has pi-extended-teams agents, its screen shows them, running ones first. A durable hobkin's page lists each with its name, the first line of what it was asked, its status, when it started to the second, and when it finished or failed. A routine run's screen shows each with its name, status and time, and the rest in its label and in the list one click away. A run that started none looks as it did before.
- A2. With teams' files missing, unreadable, malformed or for another session, the rows come from the run's own spawn calls, reports and wakes. A reader error never fails the run and never keeps the screen from drawing.
- A3. teams' files fill a run's rows only when their session is the one the run's own spawn result named, as both `config.json` and `lead-session.json` say. An agent of the same name in another session, or an earlier run of the same name in the same session, never fills a row.
- A4. An agent the run saw start and never saw end reads running while its run is live, unless teams' files are there and no longer list it. After its run ends it reads running only while teams lists it with a heartbeat from the last 90 seconds. Otherwise it reads unknown. hobkin never says an agent finished or stopped when neither teams' files nor the run's own events said so.
- A5. Opening a row shows, read only, what it was asked, its status and times, its last steps when teams kept its session, and the messages between it and the run, or says there is nothing to show. Escape puts the keyboard back on the row.
- A6. Nothing in hobkin starts, stops, messages or waits for a teams agent. The strip and the sheet have no such control. Teams agents never appear in `jobChildren`, `mainChildren`, Stop or Force targets, helper counts or budgets, and hobkin writes nothing in teams' folders.
- A7. A run's pi-extended-teams tool calls behave exactly as before the layer existed. hobkin filters, wraps, blocks or limits none of them, and the events the run's harness handles are the same ones, unchanged.

## Proof

- A1. `hobkin/test/cli-teams-agents.test.mjs` › "a run's own spawn calls give each agent its name, task, status and times"; `ui/test/teams-rules.test.ts` › "running agents come first, then queued and unknown, then failed and done"; check: still renders of a routine run's screen and a durable hobkin's page with four teams agents, light and dark.
- A2. `hobkin/test/cli-teams-agents.test.mjs` › "without teams' files, or with broken ones, the rows stand on the run's own events"
- A3. `hobkin/test/cli-teams-agents.test.mjs` › "teams' files count only for the session the run named, and a name alone never matches"
- A4. `hobkin/test/cli-teams-agents.test.mjs` › "an agent never seen to end reads unknown once its run ended or teams no longer lists it"
- A5. `hobkin/test/cli-teams-agents.test.mjs` › "an agent's steps and messages come from its own session and the inboxes, cut to size"; `ui/test/teams-rules.test.ts` › "an opened agent says what it was asked and what hobkin has of its work"; check: still render of the opened sheet, light and dark.
- A6. `hobkin/test/cli-teams-agents.test.mjs` › "reading teams' files writes nothing there"; `hobkin/test/cli-application.test.mjs` › "a run's teams agents travel in teamsAgents, never in jobChildren"; check: `rg teamsAgents` in hobkin and the client finds only the reader, the snapshot, the protocol type, `ui/src/features/teams/` and their tests, and nothing in stop, Force, children or usage code.
- A7. `hobkin/test/cli-teams-agents.test.mjs` › "observing a run's events changes none of them"; check: `git diff` shows `src/cli/harnesses.mjs`, `src/cli/bridge.mjs` and the pi-extended-teams package untouched by this work, and `observeActivity` hands the reader each event after the run's own feed has it.

## Steps

S1 comes first, then S2 and S3 can be built at once (S3 against the protocol type until S2 lands). S2 wires the reader in last, after its tests pass, so the live host never runs it untested. S5 needs the user's go-ahead.

Note, 2026-11-15. S1 to S4 are built and their proofs pass: the reader's 8 tests (red first against an empty module), the publication test in `cli-application.test.mjs` (red against the application at HEAD, green with the wiring), the window's 2 rule tests, the client typecheck, and still renders of both screens, the opened sheet and its list, light and dark (server markup with the app's built CSS, no browser). Three other tests in `cli-application.test.mjs` fail the same way at HEAD without this work (tool lists and harness options), and are not this spec's. Not seen yet: a real Pi run with pi-extended-teams writing these files while hobkin reads them, the sheet's focus and Escape in the live window, and the reads' cost on a busy session. S5 covers the first two.

- [x] S1 (A2, A3, A4, A5, A6, A7). Runtime: the reader, unwired. Files: new `hobkin/src/cli/teams-agents.mjs`; tests new `hobkin/test/cli-teams-agents.test.mjs`, with fixture folders and fake events, no real Pi and no real `~/.pi`.
- [x] S2 (A1, A6, A7). Runtime: `hobkin/src/cli/application.mjs` hands each run's events to the reader after its feed, publishes `teamsAgents` beside `jobChildren`, and closes the reader with the app.
- [x] S3 (A1, A5, A6). Window: new `shared/protocol/teams.ts` and one field in `shared/protocol/snapshot.ts`; new `ui/src/features/teams/` (`rules.ts`, `use-teams-agents.ts`, `TeamsStrip.tsx`, `TeamsAgentSheet.tsx`); the strip in `ui/src/features/work/AgentScreen.tsx` and `ui/src/features/hobkins/HobkinScreen.tsx`; tests new `ui/test/teams-rules.test.ts`.
- [x] S4 (A1, A5). Still renders without a browser: a routine run's screen, a durable hobkin's page, the opened sheet and its list, with four teams agents, light and dark.
- [ ] S5 (A1, A4, A5). With the user's go-ahead, once the live host has taken the new runtime: a durable hobkin asked to start one teams agent shows it running, then done, with its steps.

## Open questions

- teams writes under `os.homedir()` of the Pi process. A launcher whose environment sets another `HOME` sends teams' files there, and hobkin, reading its own home, then shows rows from the run's events only. (a) Keep it so. (b) Read under the launcher's `HOME` when it sets one: one more place hobkin reads, chosen by a setting the user made for another reason.
