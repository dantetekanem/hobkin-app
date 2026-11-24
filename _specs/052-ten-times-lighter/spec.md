---
{
  "id": "052-ten-times-lighter",
  "title": "Ten times lighter: 100 agents on one Mac",
  "kind": "work",
  "status": "doing",
  "depends": [],
  "updated": "2026-11-21"
}
---
# Ten times lighter: 100 agents on one Mac

## Outcome

hobkin costs a tenth of what it costs today in the window, the host and the runtime. With 100 agents writing at once the window still scrolls and types smoothly, a window nobody is looking at does almost nothing, and what hobkin keeps in memory follows what is on screen, not how long agents have run. `notes.md` holds what was measured on 2026-11-21 and where each cost comes from.

## Decisions

- Work follows what changed and what is on screen. Nothing is redone per agent, per kept step or per second while its inputs are the same.
- The window draws host messages once per animation frame. A list of agents takes new words at most five times a second. The open agent's page and the chat follow every frame. A hidden window applies messages and draws nothing.
- Endless motion runs on the compositor: transform and opacity of HTML boxes only. A face under 40 px moves as a whole. Larger faces keep their moods, drawn as stacked layers. A face nobody can see is not mounted or holds still.
- The runtime rebuilds its whole view when a message, a turn or a run ends, or when a file it reads changes. Words and tool steps travel as activity.
- Tests hold budgets as counts: list builds, draws, rebuilds, reads. Times come from the scripts under `scripts/perf/` in each repository, which the test run does not include.
- Background agent processes, and what they start, run at utility priority on macOS (`taskpolicy -c utility`): work agents, routines, helpers, a hobkin's turns, Claude Code runs and change review's test runs. The window, the host and the main chat's own process keep normal priority, so they keep the fast cores when every core is busy.
- The daily app wraps the window in React's StrictMode only when `VITE_STRICT=1` is set. StrictMode draws every component twice in the development build.
- A protocol change keeps an older window or host working: a new kind of step goes only to a window that says it reads it.
- The largest measured cost goes first. Each lane commits its benchmark, with the numbers of 2026-11-21, before its first fix.
- While the window is hidden the face makes no sound of its own: its babble and its hop chirp wait until the window shows. Notices and their chime are as before.
- Activity reaches the window at most ten times a second after its first publish, which goes out as fast as before. The window shows growing text on a 100 ms cadence anyway.
- A window in the background for a minute holds its endless loops still and nothing else. A pointer, a wheel or a key over it brings them back at once.
- The audio context is left running. Suspending it when quiet could silence the notice chime, which plays with no press.
- Limits, on the user's word of 2026-11-21 ("raise to 100"): work mode may run up to 100 agents at once, 16 routines and session jobs, and 48 durable hobkins. The defaults stay as they were. "Agents at once" in Settings is hobkin's own number, with the same stepper on the Work screen.
- Starts come 30 seconds apart whether or not something runs (it was five minutes while a run was going), on the user's word that work mode was too slow. The budget paces work from there: the hour's share and the day.
- On an agent's page a step's words appear the moment the window has them, with no pacing and no motion of their own. The user reported both changes as a "weird movement like bubbling and filling". Since 2026-11-23 the transcript follows new steps without a glide: it goes to its end at once, at most once a frame, from what the page laid out, and reads nothing of the page while drawing (the user: "Steps appear in place with no rise and no glide. Lightest by far", replacing following "by reading its place while drawing").
- A backup holds what hobkin and the client write by design and nothing an agent leaves in the home. The user: "this should never be in the backup path".

## Out of scope

- How fast a model answers, and what an agent's own tools cost.
- Dropping old runs from the runtime document, which changes what Reports and history show (Open questions).
- How many agents may run at once, until the user chooses the limits (Open questions).
- Pushing, a version bump, a restart, and any change under `src-tauri/` or to `package.json` without the user's word. Those wait as one patch.
- A browser or a second app window for measuring, without the user's word.

## Acceptance

- A1. One host message builds the list of running agents once, however many rows and screens read it, and a dock row reads only its own agent's words.
- A2. With 100 agents writing at once, the window's script time for each 25 ms of host messages is 4.8 ms or less with production React. It was 48 ms.
- A3. Host messages that arrive inside one animation frame draw once. A list of agents takes new words at most five times a second. A hidden window draws nothing and shows the latest state when it comes back, with no message lost.
- A4. The agents dock mounts at most six rows however many agents run, and the arrow keys still reach every agent.
- A5. While a reply streams, a chat row whose message did not change does not draw again, and streaming text parses only its open block.
- A6. No endless animation needs the main thread: each moves only transform or opacity of an HTML box, and none is set on part of an SVG.
- A7. Motion nobody can see is stopped: the chat while the canvas covers it, and everything while the window is hidden or has been in the background for a minute.
- A8. The lines that change with every step of an agent (its current line, its counts, its tasks, hobkin's speech bubble) swap without adding a style sheet to the page.
- A9. On the live app with two agents running, the window's content and GPU processes together use 4% of a core or less. They used 39%.
- A10. The host's activity diff skips an entry the runtime kept, the same object, without building a set or comparing its fields, and sends the same steps as before.
- A11. With 100 agents writing, each holding 1,000 steps, the host uses 4.5% of a core or less. It used 44.5%.
- A12. While the main chat streams a reply with tools, the runtime rebuilds its whole view only when a message, a turn or a run ends.
- A13. With the main chat streaming two tool steps and twenty words a second on a home the size of today's, the runtime uses 3.2% of a core or less. It used 31.6%.
- A14. While work agents write and nothing else changes, a tick rebuilds nothing, and their token counts still reach the window within the second.
- A15. An idle tick on a home the size of today's uses 4.9 ms of CPU or less and reads no file that did not change. It used 44 to 49 ms and read 208 files. The live host idles at 1.1% of a core or less. It idled at 11%.
- A16. The window holds whole steps only for the agents on screen and one line for every other agent. Connecting to a host with 100 agents of 1,000 steps each sends 9.5 MB or less. It sent 95 MB.
- A17. A run's feed keeps at most 200 steps and 8 KB of each tool's output in memory. The agent's page still opens older steps and whole outputs, read from the run's saved session.
- A18. What the window keeps for a run (step times, thread notes) goes when the run goes.
- A19. Every background agent process hobkin starts runs at utility priority on macOS, and plainly on any other system. The main chat's own process keeps normal priority.
- A20. While the background opacity is 1 the window is opaque with no blur behind it. A lower opacity turns both back on.
- A22. Work mode can run 100 agents at once, routines 16 and durable hobkins 48, with the defaults as they were, and "Agents at once" in Settings sets hobkin's own number.
- A23. With a free worker and room in the budget, the next start comes 30 seconds after the last, also in a home that saved the old five minutes.
- A24. A backup leaves out what is not hobkin's own at the home's root, in `runtime/` and in a project's folder, lists it with its size, and never counts a socket as a failure.
- A25. On an agent's page ten updates inside one frame scroll the view to its end once and never smoothly, nothing is read of the page while it draws, and a step's words carry no motion of their own (2026-11-23).
- A21. Nothing else the user sees changes: the time to the first word, notifications, completion sounds, keyboard walks and the agent's page read as before. The focused tests of every changed module pass and typecheck adds no error.

## Proof

- A1. `ui/test/agent-redraws.test.ts` › "100 rows and five list readers build the agents list once for a message"
- A2. check: `node scripts/perf/window-frames.ts` prints the script time per message at 100 agents.
- A3. `ui/test/screen-store.test.ts` › "messages in one frame draw once, a hidden page draws none, and showing it draws the latest"
- A4. `ui/test/agents-dock-rows.test.ts` › "100 agents mount six rows and the keys walk all of them"
- A5. `ui/test/chat-rows.test.ts` › "a token draws the writing row only"
- A6. check: `node scripts/perf/motion.ts` lists every endless animation and fails on one that breaks the rule.
- A7. `ui/test/away.test.ts` › "the page is away when hidden or a minute in the background, and back at once"
- A8. check: in Settings, Nerd stats, "style sheets added" stays still while an agent works on its open page.
- A9. check: `scripts/perf/live-windows.sh 3 60` on the live app with Home on screen.
- A10. `shared/test/activity-steps.test.ts` › "one grown entry among 1,000 kept gives one update and compares no kept entry"
- A11. check: `node scripts/perf/host-load.ts --agents 100 --history 500` prints the host's share of a core.
- A12. hobkin `test/cli-activity-refresh.test.mjs` › "a main tool start publishes activity and rebuilds nothing, and a message end rebuilds once"
- A13. check: hobkin `node scripts/perf/main-chat.mjs 2 20 30` prints the runtime's share of a core.
- A14. hobkin `test/cli-work-tick-refresh.test.mjs` › "a tick where only a work session grew publishes its tokens and rebuilds nothing"
- A15. check: hobkin `node scripts/perf/tick.mjs` prints CPU and file reads per tick, and three 60-second windows of the live host with nothing running.
- A16. `host/test/activity-sync.test.ts` › "a new window gets whole steps only for the agents it watches"
- A17. hobkin `test/cli-job-activity.test.mjs` › "a feed keeps 200 steps and a bounded output, and the saved session still has the rest"
- A18. `ui/test/activity-state.test.ts` › "a run that left takes its step times with it"
- A19. hobkin `test/cli-priority.test.mjs` › "a command starts through taskpolicy at utility priority on macOS and plainly elsewhere"
- A20. check: after the restart, at opacity 1 a busy page behind hobkin stops drawing, and at 0.8 the desktop shows through.
- A21. check: `pnpm typecheck`, and the focused tests named in each commit.
- A22. hobkin `test/cli-work-plan.test.mjs` › "a hundred agents can run at once: the 100th is admitted and the 101st waits for a free worker"
- A23. hobkin `test/cli-work-plan.test.mjs` › "with a free worker and room in the budget the second start comes 30 seconds after the first, not five minutes"
- A24. `host/test/backup-strays.test.ts` › "what is not hobkin's own at the root, in runtime/ and in a project's folder is left out, told with its size, and is no failure"
- A25. `ui/test/agent-follow-frames.test.ts` › "ten updates inside one frame scroll the view to the end once, at once, and read no layout while drawing"

## Steps

- [x] S1 (A2, A11, A13, A15). The benchmarks, committed with the numbers of 2026-11-21: the window's frame replay, the host load lab, the runtime's tick, main chat and work scripts, and the live windows reading. 7a0d54c, 81d030e, bd2c1fd, 9d6510d, 09113c5; hobkin 17f6f1a.
- [x] S2 (A1, A2). Window store: one agents list per message, an agent's words cached per entry, and a summary line that stops at its first line. cffacdd, dc1ffc1: 43 ms to 1.5 ms per message.
- [x] S3 (A3). Window store: what the screen reads follows the host store once per frame, five times a second for lists of agents, and not while hidden. ab2e3df: 1.5 ms to 0.40 ms.
- [x] S4 (A2, A18). Home's model, the work store, thread notes and step times stop recomputing for every message, and go with their run. e5c5644: 0.40 ms to 0.27 ms.
- [x] S5 (A1, A4). The dock: a row reads its own agent, and only the rows in view are mounted. 96d3501, 01814a7: a full draw at 100 agents 14.8 ms to 0.32 ms.
- [x] S6 (A2, A5). The menu's agents row, the chat's rows and streaming Markdown draw only what changed. e0f5e5a, c669272, 9a32434, f4fca37, e095f69: a reveal step of a 20 KB reply 22.7 ms to 0.15 ms.
- [x] S7 (A6). Faces: small ones move as a whole, large ones as layers. 5c692b3, bb0ee9e, a36224f: a working face 9 animations on SVG parts to 1 move of its box.
- [ ] S8 (A6, A8). Home's pulse and the review's wires move on the compositor, and the per-step swaps leave `popLayout`. db59524, 7ad74ef, be47280, 7d7f27f. The speech bubble and five lists keep `popLayout` until S19's patch is applied, so A8 waits for the restart.
- [x] S9 (A7). Away: a hidden, covered or background window stops moving. a503efd, d098851.
- [ ] S10 (A6). Transitions move transform and opacity (canvas, menu, backdrops), and the page canvas follows events instead of every frame. The page canvas: aa9d8e2. The transitions are as they were: each needs a look in a real window to keep its look.
- [x] S11 (A10). Host: the identity path in the activity diff, and the small allocations of each publish. 7fe096c, f617267: at 100 agents of 1,000 steps 44.5% to 23.5% of a core, 9.5 ms to 1.0 ms per publish.
- [x] S12 (A12). Runtime: main chat events that are not ends travel as activity. hobkin 97899e6: with S14, the main chat at 2 tool steps and 20 words a second 32.7% to 6.1% of a core.
- [x] S13 (A14). Runtime: token counts leave the tick's signature and travel the light way. hobkin ab14bae: eight work agents writing 17.6% to 2.3% of a core.
- [ ] S14 (A13, A15). Runtime: a cheaper rebuild: one read of the document, routine rows once a minute, usage and evidence only on change. hobkin 557474c, ed9ba54, 8fe13a5: a rebuild 98 ms to 14 ms, the main chat 31.6% to 3.3% of a core alone and 2.0% side by side. A15 is not met.
- [ ] S15 (A15). Runtime: the tick's reads cached by file version, and routine times computed once. hobkin 1290e77, 772f874, 864a835, 622285a: an idle tick 44 to 49 ms to 8 to 11 ms of CPU, 208 file reads to 4, and the live host with nothing running 11.1% to 2.2 to 2.7%. A15 asks 4.9 ms and 1.1%: what is left is planning itself, which can be reused across ticks only once the planner takes the clock as an input.
- [x] S16 (A10). Runtime: a feed's snapshot patches what changed. hobkin e41e208: a publish of 100 feeds 1.7 ms to 0.04 ms.
- [x] S17 (A19). Agent processes at utility priority, Pi and Claude Code. hobkin 7bd554d, client 5d0a29b.
- [ ] S18 (A11, A16, A17). Done: client 2ea87f5, 0f876f7, 8f5a32e, e785721; hobkin bfc780b, 4e39f60. A16 and A17 are met: a new window gets 0.5 MB where it got 95 MB. A11 is not: the host is at 6.3% of a core against 4.5% (44.5% before). Activity on demand: growth sent as growth, bounded feeds, whole steps only for watched agents, older steps read from the saved session.
- [ ] S19 (A9, A20). Done without a restart: b7ec90d, 366e5fe, ac4bd86, 46d423a, 6c9c928 (startup script 2,446 to 1,940 kB). Applied on the user's word at 18:00 (ad2b0d1, with `pnpm install`), and the version is 0.1.23 (085378e). After the restart the window holds 560 MB where it held 3,227 MB. A9 is not met: with one agent running and the user in the window, content and GPU together used 11 to 17% of a core. A20 waits for a look at the window. What was applied: the restart batch as one patch: an opaque window at opacity 1, optimized dev dependencies, the inline-style fix for every other `popLayout`. Without a restart: StrictMode behind its flag and the screens that load on first use.
- [x] S21 (A22, A23). Limits and the pace of starts: hobkin d668d5d, 54d815d, 6fa5932, d37922f; client 198c746, e47e347, 636dc01, 4f2bc10, a77ec7b.
- [x] S22 (A24). Backups hold only hobkin's own: b53c75c, 341504a, acc9d2b, e549b45; hobkin 322ae19 tells agents to keep builds and virtual machines out of the home.
- [x] S23 (A25). An agent's page moves as it did before this work: 5f4ce62, e8738de.
- [x] S20 (A21). Post-processing of the changed code, a review by someone who did not write it, and the closing numbers in `notes.md`. Three reviews, twelve defects found and fixed; 178 client and 232 runtime tests of the changed files pass, typecheck is clean, and the 3 runtime tests that fail did so before this work.

## Open questions

- The daily app. `pnpm tauri dev` runs React's development build, which costs about twice the production build after StrictMode is off. A production window that rebuilds on save loses hot reload: every save reloads the window after a 2 to 6 second build.
- Keep awake. `caffeinate` holds the Mac awake for the host's whole life, on battery too. Holding it only while something runs or a routine is due within minutes lets the Mac sleep, and a routine due during sleep runs late.
- Old runs. The runtime document keeps every run. Each 1,000 runs add 29 MB of memory and 38 ms to every rebuild. Archiving runs past a window changes what history can show.
- A rendered measurement. Frame times and paint cost can only be read in a real window. That needs a browser or a second app window on a throwaway home.
- The hour's share. One hour may use a 12th of the daily budget, which at the default of 100M is about 8 agents at once and at ten times that about 83. It is what paces work now that the gap is 30 seconds. A 6th, or no hourly share, would let work mode spend the day's budget sooner.
- The virtual machine a work run left running on 2026-11-20 (`limactl hostagent`, a Postgres in `/tmp/rps-ee8d-gate.d1hlix`) and its 3.5 GB in `~/.hobkin/runtime/rps-ee8d-build.OwUqoa8K`: stop and delete, or keep.
- A run's leftover processes are not ended when the run ends. Ending them needs each run's processes tracked to the run's end.
