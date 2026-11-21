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
- Agent processes, and what they start, run at utility priority on macOS (`taskpolicy -c utility`), so the window and the host keep the fast cores when every core is busy.
- The daily app wraps the window in React's StrictMode only when `VITE_STRICT=1` is set. StrictMode draws every component twice in the development build.
- A protocol change keeps an older window or host working: a new kind of step goes only to a window that says it reads it.
- The largest measured cost goes first. Each lane commits its benchmark, with the numbers of 2026-11-21, before its first fix.

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
- A19. Every agent process hobkin starts runs at utility priority on macOS, and plainly on any other system.
- A20. While the background opacity is 1 the window is opaque with no blur behind it. A lower opacity turns both back on.
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

## Steps

- [ ] S1 (A2, A11, A13, A15). The benchmarks, committed with the numbers of 2026-11-21: the window's frame replay, the host load lab, the runtime's tick, main chat and work scripts, and the live windows reading.
- [ ] S2 (A1, A2). Window store: one agents list per message, an agent's words cached per entry, and a summary line that stops at its first line.
- [ ] S3 (A3). Window store: what the screen reads follows the host store once per frame, five times a second for lists of agents, and not while hidden.
- [ ] S4 (A2, A18). Home's model, the work store, thread notes and step times stop recomputing for every message, and go with their run.
- [ ] S5 (A1, A4). The dock: a row reads its own agent, and only the rows in view are mounted.
- [ ] S6 (A2, A5). The menu's agents row, the chat's rows and streaming Markdown draw only what changed.
- [ ] S7 (A6). Faces: small ones move as a whole, large ones as layers.
- [ ] S8 (A6, A8). Home's pulse and the review's wires move on the compositor, and the per-step swaps leave `popLayout`.
- [ ] S9 (A7). Away: a hidden, covered or background window stops moving.
- [ ] S10 (A6). Transitions move transform and opacity (canvas, menu, backdrops), and the page canvas follows events instead of every frame.
- [ ] S11 (A10, A11). Host: the identity path in the activity diff, and the small allocations of each publish.
- [ ] S12 (A12, A13). Runtime: main chat events that are not ends travel as activity.
- [ ] S13 (A14). Runtime: token counts leave the tick's signature and travel the light way.
- [ ] S14 (A13, A15). Runtime: a cheaper rebuild: one read of the document, routine rows once a minute, usage and evidence only on change.
- [ ] S15 (A15). Runtime: the tick's reads cached by file version, and routine times computed once.
- [ ] S16 (A11). Runtime: a feed's snapshot patches what changed.
- [ ] S17 (A19). Agent processes at utility priority, Pi and Claude Code.
- [ ] S18 (A16, A17). Activity on demand: growth sent as growth, bounded feeds, whole steps only for watched agents, older steps read from the saved session.
- [ ] S19 (A9, A20). The restart batch as one patch: an opaque window at opacity 1, optimized dev dependencies, the inline-style fix for every other `popLayout`. Without a restart: StrictMode behind its flag and the screens that load on first use.
- [ ] S20 (A21). Post-processing of the changed code, a review by someone who did not write it, and the closing numbers in `notes.md`.

## Open questions

- Limits. hobkin runs about 25 agents at most today: 1 main chat, 8 work agents and routines together, 12 hobkins, 4 helpers (`notes.md`, Limits). 100 at once needs higher ceilings. The proposal: keep today's defaults and raise what Settings allows to 100 work agents, 16 routines and 48 hobkins. Each agent is a process of 113 MB or more.
- The daily app. `pnpm tauri dev` runs React's development build, which costs about twice the production build after StrictMode is off. A production window that rebuilds on save loses hot reload: every save reloads the window after a 2 to 6 second build.
- Keep awake. `caffeinate` holds the Mac awake for the host's whole life, on battery too. Holding it only while something runs or a routine is due within minutes lets the Mac sleep, and a routine due during sleep runs late.
- Old runs. The runtime document keeps every run. Each 1,000 runs add 29 MB of memory and 38 ms to every rebuild. Archiving runs past a window changes what history can show.
- A rendered measurement. Frame times and paint cost can only be read in a real window. That needs a browser or a second app window on a throwaway home.
- The restart and the version number for S19.
