---
{
  "id": "075-chief-of-staff",
  "title": "hobkin follows through, closes loops and dreams",
  "kind": "work",
  "status": "draft",
  "depends": ["056-agent-schedules", "057-shared-memory", "072-jobs-live-until-done"],
  "updated": "2026-11-26"
}
---
# hobkin follows through, closes loops and dreams

## Outcome

When a delegate, a routine or a work run finishes, hobkin turns what it found into ranked next steps and moves them in the same turn. It starts the fixes that are branch work, asks one question about anything that would ship or needs a choice, files the rest and drops what is not worth doing, then says in a few lines what it started. Every call hobkin brings stays open until it is done or dropped, and hobkin chases it. A nightly dream pass keeps memories correct, and each agent gets the memories that matter for its task, chosen by recency, use and source within the budget it has today. `notes.md` holds the diagnosis and the sources.

## Decisions

- One follow-through rule for every result that lands: a session wake, a job that asked something, a routine report, a work run, a durable hobkin's message.
- Branch work is the reversible unit, as work mode already treats it (`v2-runtime.md:198`). Merging, pushing, deploying, sending, spending and deleting keep their current rules: the user's ask, `ready`, and the YOLO switch. Follow-through adds no path to any of them.
- Text in reports and agents' messages still grants nothing by itself. A follow-through start rests on the user's ask plus the "Follow through" setting in Settings: `branches` (the default), `ask` or `off`. The user chose this on 2026-11-26.
- The investigator fixes covered findings in place when its tier is `mid` or higher and the fix is in its folder, so it keeps its context. Anything else goes back to hobkin as `next`. The user chose this on 2026-11-26.
- A fix brief states the change itself (paths, lines, the change, how to prove it). It never says "based on the findings".
- A dream pass never hard-deletes a memory. It closes or archives one, and every change shows in Chat with Undo.
- Memory use stays in a local file. It is not a telemetry event, because memory names can be personal and usage events upload on enrolled machines.
- Prompts change in hobkin's `src/prompts`; this spec stays here.

## Out of scope

- New merge or deploy autonomy. YOLO mode already covers that.
- A knowledge graph or PageRank over memories. At 300 memories, scores on a flat list do the same job. Revisit if `[[links]]` become dense.
- Windows and Linux.

## Acceptance

- A1. An ask to investigate a problem, whose delegate finds two small fixes in one project and one design choice, ends with the two fixes started without the user typing again, one question with a recommended choice, and a reply of about 100 words naming what started and where.
- A2. With follow-through set to ask, the same case ends with one question whose first choice starts both fixes.
- A3. No follow-through start merges, pushes or deploys beyond what the user's ask named.
- A4. A follow-through chain stops after its default rounds, and the reply says so when it stops there.
- A5. A routine report with a `Next:` call shows in `hobkin pending`, the brief and its Home card until it is done or dismissed, then leaves all three.
- A6. A `Critical:` routine report starts a main-agent turn by itself, and that turn applies the follow-through rule.
- A7. A routine whose reports go unopened gets its Action Item within an hour of qualifying.
- A8. The weekly scoreboard shows calls closed and the median time to close.
- A9. Once a day, open loops are checked against live state: each is closed, chased or flagged once as stale. A day with nothing to report posts nothing.
- A10. After a dream pass, a memory that a newer one contradicts is marked superseded, not deleted, and the change shows in Chat with Undo.
- A11. A run's memory index puts memories used recently ahead of unused ones of the same standing, within the same byte budget.
- A12. A recall for an accented word finds a memory that holds it.

## Proof

Each code step names its failing test first, in hobkin's `test/`. Prompt steps get a fixture turn on a throwaway home, never `~/.hobkin`. The window parts get a rendered check.

## Steps

Phase 1: follow through on delegate results.

- [ ] S1 (A1). A job's report carries next steps. `hobkin_done` takes a `next` list, each with `do`, `kind` (fix, change, ask, watch, info), `where` (project or folder), `size`, `door` (branch or outward), `sure` and `evidence`. `session-job.md:27-29` asks for it. The wake row carries `next` beside `said`.
- [ ] S2 (A1, A3). A "Follow through" section in `v2-runtime.md` replaces the last sentence of `:144` and the "so you can report" wording at `:11`. It ranks steps by value over effort, discounted by how sure the delegate is, then starts what is covered, bundles the rest into one `ask_question` with a pick for each, files work items or Action Items with their next action, and drops the rest with a one-line reason.
- [ ] S3 (A1, A2). The "Follow through" setting: `branches`, `ask` or `off` in Settings, read by the runtime and named in the main agent's runtime block. Starts it covers pass `--approved`, since the user's setting is the yes the burst gate wants (`session.mjs:67-71`).
- [ ] S4 (A1). Who fixes. `session-job.md` tells an investigator whose tier is `mid` or higher to fix covered findings in its own folder before `hobkin_done`, when the setting is `branches`.
- [ ] S5 (A1). Where a start goes. A project chosen in work mode gets an item with impact and effort, then `trigger`, so the queue, the budget, reviews and YOLO apply. Otherwise a session with `--wake`. Settle `session.mjs:26` against `session-job.md:17` (Open question 1).
- [ ] S6 (A4). A default of two rounds per user ask: the investigation's fixes start, and what those fixes find goes into the bundled question. hobkin may go further when it says why. Starts still count against the agent limit and the token budget.
- [ ] S7 (A1). Durable hobkins get the same rule for their own work in `durable.md`: after looking into something, fix what is covered in the same turn, then end with what was done and the one question.

Phase 2: routine findings become open loops.

- [ ] S8 (A5). A `Next:` call is an open loop again: rows in `pending.mjs:94` and `brief.mjs:186`, "Do it with hobkin" on the Home card (client `ui/src/features/home/model.ts:567`), and closed through `actionReportIds` (`decisions.mjs:143`). Bring `v2-runtime.md:46` and `docs/guide.md:149,163` in line with it.
- [ ] S9 (A6). A `reports` wake for `Critical:` reports, applying the follow-through rule.
- [ ] S10. A routine's request carries the work command and the slugs of chosen projects (`context.mjs:58`), so a code finding becomes a work item. A finding already open as an item is not filed twice.
- [ ] S11 (A7). Run `lookAfterRoutines` hourly (`routine-care.mjs:75`; only tests call it now).
- [ ] S12. An answer to `weekly-plan` or `priorities` becomes one question about work-mode priority, such as making a project P1 for the week.

Phase 3: close the loop.

- [ ] S13 (A9). Open loops read from what already exists: sessions, items, decisions, Action Items and report calls, each with the thing that proves it done. A daily pass closes, chases (`message_check`, retry, one question) or flags each one, and stays quiet when nothing changed.
- [ ] S14 (A8). The scoreboard adds calls closed, median time to close, findings started and landed, and questions per finding (`work/scoreboard.mjs:73-104`).

Phase 4: dreaming and memory injection.

- [ ] S15 (A11). Record use in `runtime/memory-use.json`: each recall (`memory-tools.mjs:178`), each index build with the names it held, and each memory an agent says it relied on (a `used` list on `hobkin_done`; the main chat's signal is Open question 3). Start this early, because the score needs weeks of data.
- [ ] S16 (A11). The index ranks inside its byte budget. The user's own facts and pinned memories come first. Then score = source weight (said by the user, then confirmed, then inferred) × activation (ACT-R, ln Σ t^-0.5 over uses, confirmations and changes) × match with the run's brief when there is one. About a fifth of the budget is kept for memories changed in the last 14 days. Durable hobkins and living jobs renew their index at compaction.
- [ ] S17 (A10). A nightly dream pass while hobkin is idle, with a once-a-day receipt like `reflection.mjs:41-75`. It snapshots, reads changes and use since the last pass, then per group proposes add, update, merge, supersede, archive or nothing. A contradiction gets `until` and `supersededBy`, and an unclear one becomes one question. What keeps recurring becomes a suggested memory, or an AGENTS.md proposal that waits for the user's yes (`v2-runtime.md:173`). It archives memories past `until` and unconfirmed ones nobody used for 60 days, folds `memory.md` bullets that repeat a memory, and posts one Chat line with Undo. A `dream` author joins `MEMORY_AUTHORS`. It runs just before a compaction renews the main chat's prompt, or renews it after, so the 20-line since-note cap is not hit.
- [ ] S18 (A12). Recall compares accent-stripped fields (`memories.mjs:99` against `:1057`), and memories join qmd so `qmd query` can match them by meaning (`memory-index.mjs:24-38`).
- [ ] S19. Measure it: a local set of 30 to 60 questions from the user's own past chats, run before and after S16 and S17, plus the share of injected memories used, corrections per week, and dream changes undone.

Order: S1 to S7 first, since they are the complaint. S8, S11 and S18 are small fixes to bugs already found and can go at any time. S15 should start early. S16 and S17 wait for its data.

hobkin's working tree holds another writer's uncommitted edits in `v2-runtime.md`, `session.mjs`, `wake.mjs`, `application.mjs`, `harnesses.mjs` and `hobkins.mjs`, the files Phase 1 touches. Phase 1 starts once those are committed, with hunk-only commits.

## Open questions

1. Should chat-job branches register as Work items again, so `ready`, reviews and YOLO see them? That undoes part of 072's split. Recommended yes, for fixes started by follow-through only.
2. Should a `Useful:` report with a `Next:` call also wake hobkin, or only `Critical:`?
3. How does the main chat say which memories it used? It could add a hidden `used` line to each turn, which costs tokens, or hobkin could match memory names against its tool calls and reply.
4. Which model and budget does the dream pass get? Proposed: the background binding, at most once a day, and only when memories or use changed.
