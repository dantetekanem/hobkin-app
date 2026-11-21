# Notes: what was measured and where the cost is

Measured on 2026-11-21 on an Apple M5 Pro (18 cores, 64 GB), hobkin-client at a365ca6 and hobkin at 732105f. Five read-only audits ran that day. A claim here is measured unless it says "read in code" or "inferred". CPU is a share of one core.

## The live app

`ps` CPU time over 60-second windows of the user's running app (`pnpm tauri dev`, so React's development build with StrictMode and a debug shell). Median of three windows each.

| | Host | Window content | Window GPU | Shell | Together | Content memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Two agents running | 20% | 17% | 22% | 3.5% | 62% | 3.2 GB |
| Nothing running | 11% | 2.2% | 0.6% | 0.5% | 14.5% | 3.5 GB |

- A 10-second native sample of the idle host: its main thread is 10.7% busy, and 802 of 825 busy samples sit under the timer callback. The leaves are JSON parsing, string splitting and file reads. That is the scheduler tick (Runtime, below).
- A 5-second native sample of the content process with two agents: the main thread is 14% busy, almost all of it in rendering updates (style, compositing requirements, event regions, paint). Handling the socket's messages is 1.4%.
- The GPU process runs an audio thread for the life of the page (`ui/src/features/sound/index.ts` opens an `AudioContext` and never suspends it) and holds a WebGL context once Nerd stats has been opened (`ui/src/features/settings/NerdStats.tsx:67`).

## Window: script

From a replay of host messages through the real store and hooks in node, 100 agents, one message per 25 ms. No page is drawn, so these are lower bounds.

| Configuration | Script per message | Share of a core at 40 messages a second |
| --- | ---: | ---: |
| Development build with StrictMode, as written | 60.8 ms | 243% |
| Production build, as written | 48.2 ms | 193% |
| Production, agents only streaming text | 100.2 ms | 400% |
| Production, with W1 and W2 fixed | 3.9 ms | 15.7% |

Cost grows with the square of the agent count: 1.5 ms at 10 agents, 9.3 at 50, 48 at 100, 279 at 200.

- W1. `ui/src/app/AgentsDock.tsx:316`: every dock row builds the list of all agents on every message to read its own line. 40 to 50 ms of the 48.
- W2. Every reader of the agents list builds it again per message (`ui/src/features/hobkins/list.ts:75`, `ui/src/app/running-agents.ts:99,115`, `ui/src/lib/host/hooks.ts:50`), and `ui/src/lib/summary-line.ts:20` splits a whole message into lines to find its first: 1.9 µs on 200 characters, 30 µs on 5 KB.
- W3. One store update and one React commit per socket message (`ui/src/lib/host/client.ts:23`): 120 commits for 120 messages. With 100 agents some agent starts or ends a tool in nearly every message, so the dock, the menu and Home draw 40 times a second.
- W4. The dock draws every agent and shows four (`AgentsDock.tsx:193-218`): one full draw at 100 agents is 16.2 ms and 314 KB of markup.
- W5. The menu's agents row on an agent's page draws all 100 items on every change (`ui/src/app/ScreenMenu.tsx:249-300`): 2.8 ms each, and every item measures its own layout because its `layout` has no `layoutDependency`.
- W6. Home rebuilds its whole model on every agent change (`ui/src/features/home/use-home.ts:46-54`): 2.7 ms with 700 reports.
- W7. Streaming Markdown parses the whole message on every update: 4 ms at 5 KB, 17 ms at 20 KB (`ui/src/features/agent-activity/StepView.tsx:100`, `ui/src/features/chat/markdown.ts:176`). The agent's page is not paced at all.
- W8. Every chat row draws again for each token (`ui/src/features/chat/MessageList.tsx:138`, `ChatColumn.tsx:45`).
- W9. Step times are kept for every entry ever seen, 167 bytes each, and never dropped (`ui/src/features/agent-activity/use-agent-activity.ts:16`). Thread notes copy their map per message (`ui/src/features/work/agent-threads.ts:61`). The work store sets its startup state on every message (`ui/src/features/work/store.ts:94`).
- Holding up: the composer, the chat column, the avatar and the status line draw 0.01 times per message. Reports, actions and routines listeners return early.

## Window: motion and paint

Read in code, with the content sample above as the measured part.

- P1. A working face runs up to 9 endless animations on parts of an SVG (`ui/src/avatar/hob.css:36-89,149-231`). WebKit cannot hand those to the compositor, so each frame restyles, lays out and repaints on the main thread. Faces are mounted for every agent and never paused off screen: the dock (`AgentsDock.tsx:279`), helper faces (`ui/src/features/work/ChildAgents.tsx:37`), the menu (`ScreenMenu.tsx:281`), the Work map (`ui/src/features/work/DelegationMap.tsx:459`). At 100 agents that is 900 or more such animations per frame. At 24 px the motion is under a pixel.
- P2. 34 lists use `AnimatePresence mode="popLayout"`. Its `PopChild` adds a `<style>` element on every exit and removes it after (`framer-motion/dist/es/components/AnimatePresence/PopChild.mjs`). Each change resets WebKit's style resolver, registers the build's 94 `@property` rules again and tells every running animation. The sites that fire per agent step: `ui/src/features/work/AgentScreen.tsx:394`, `ui/src/features/agent-activity/StepView.tsx:155,236`, `TaskList.tsx:166,193,279,327`, `ui/src/features/chat/SpeechBubble.tsx:62`, `AgentsDock.tsx:193`.
- P3. In the daily app a Tailwind class that is new to the build makes Vite rewrite the whole 200 KB style sheet, the same reset plus a full repaint. It happens while agents edit this checkout.
- P4. Large faces are always on screen: `ui/src/features/chat/ChatAvatar.tsx:72` (104 px), `ui/src/features/home/Stage.tsx:347` (184 px), `AgentScreen.tsx:93` (120 px).
- P5. The chat keeps animating under a backdrop blur while the canvas covers it (`ui/src/app/ChatDim.tsx:28`, `ui/src/app/view-store.ts:27`).
- P6. The dock's `mask-image` is set even when nothing fades (`AgentsDock.tsx:158`).
- P7. `home-pulse` animates `box-shadow`, a repaint per frame (`ui/src/features/home/home.css:33`).
- P8. Transitions that animate layout: the canvas's `marginLeft` on a container (`ui/src/app/Canvas.tsx:190`), the menu's width and height (`ScreenMenu.tsx:224`), backdrop blur radius in eight sheets.
- P9. The page canvas reads layout every frame (`ui/src/features/canvas-panel/BrowserPane.tsx:66-80`) and asks the shell for its state once a second.
- P10. The review graph moves a dot along each active wire with SMIL (`ui/src/features/review/graph/Wire.tsx:104`).
- P11. A visible window in the background runs at full rate. Nothing in the app reacts to focus.
- Not found: the app has no SVG gradients, filters or masks, and no code writes CSS rules at runtime.

## Host

From a load lab that starts the real host on a temporary home and feeds synthetic Pi events into real work agents. 60-second runs.

| Agents | Host CPU | Publishes a second | Socket | Note |
| --- | ---: | ---: | ---: | --- |
| 0 | 1.7% | 0 | 169 B/s | a small synthetic home |
| 1 | 6.0% | 28 | 11 KB/s | |
| 10 | 10.0% | 28 | 97 KB/s | 3.7% without the rebuild every second |
| 100 | 13.5% | 28 | 958 KB/s | |
| 100, each with 1,000 steps | 44.5% | 26 | 893 KB/s | 9.7 ms per publish |
| the same, with H1 and H2 prototyped | 19.2% | 28 | 963 KB/s | 1.6 ms per publish |

- H1. `jobSteps` in `shared/protocol/activity.ts:69` builds two sets and filters every entry of every changed feed on each publish: 23.8% of a core at 100 agents with long feeds. Walking both lists by index and skipping the same object is 29 times cheaper and gives the same steps.
- H2. `JobActivity.snapshot` maps every entry again on each publish (hobkin `src/cli/job-activity.mjs:213`): 4.2%. Patching the last list is 12 times cheaper.
- H3. A text or output update resends the whole entry (`activity.ts:49`): 461 KB/s for 10 agents writing long messages, against 97 KB/s for short ones.
- H4. A window that connects gets every job's whole feed: 95 MB at 100 agents of 1,000 steps (`host/src/state-sync.ts:183-203`). The host also keeps the whole feeds of the 20 jobs that ended last (`host/src/activity.ts:32-41`).
- H5. Small allocations per publish: helper rows (`host/src/activity.ts:51`), stop controls (`host/src/owner.ts:327`), the reminders file read (`host/src/host.ts:368`), one stringify per socket (`host.ts:212`). Under 0.5% together.
- H6. Timers that run with nothing open: proofs poll every second (`host/src/proofs.ts:264`), canvases every 2 s (`host.ts:769`), hobkin titles every 5 s, which parses the whole runtime document (`host.ts:772`).
- Not worth the work: reading Pi's events (1.1 µs each) and the code-age walk (0.006%). The host's own files are under 1% in every profile.

## Runtime

On a synthetic home the size of the real one: 1,500 runs, an 11.7 MB document, 24 projects, 47 routines.

| | Today | With the prototypes |
| --- | ---: | ---: |
| Idle tick, work mode on | 44 to 49 ms CPU | 18.9 ms |
| Whole rebuild (`project()`) | 98 ms | 39 ms |
| Main chat streaming, 2 tool steps and 20 words a second | 31.6% | 6.9% |
| Eight work agents writing every 3 s | 19.7% | 4.7% |
| 100 fake Pi agents, the runtime's own event work | 4.0 to 8.2% | |

- R1. Every main chat event that is not a delta asks for a whole rebuild (hobkin `src/cli/runtime.mjs:337`). Read in code and measured.
- R2. A running work agent's token counts sit in the tick's signature (`src/cli/application.mjs:902-919`), so every second in which a session file grew rebuilds everything.
- R3. The rebuild parses the whole document three times (`compatibility.mjs:80`, `application.mjs:427`, `runner.mjs:420`), computes every routine's next time with about 5,000 date formats, syncs the usage ledger with 1,500 hashes, stringifies a 3.5 MB signature, and writes a 3.6 MB `view.json` with fsync when the view changed.
- R4. The idle tick reads 208 files and parses 13.3 MB of already cached work records: `decisions.jsonl` 32 times, `tokens.jsonl` 6 times, every routine file, and 88 new date formatters with 2,172 formats (`work/store.mjs:119-159`, `decisions.mjs:55-67`, `deploys.mjs:92-115`, `schedules.mjs:191-239`, `runner.mjs:23-79`). On the real home this is the 11% the idle host uses.
- R5. With learning on, the tick copies the whole document (`application.mjs:950-959`): 14.7 ms. A run's end copies it two or three times: 60 ms of CPU per end.
- R6. A background run's feed has no cap and keeps every tool's whole output: 6 MB after 300 tool calls (`application.mjs:178`, `job-activity.mjs:86`).
- R7. `guardFolders` starts `git branch --show-current` every tick for each run in a user's folder (`work/director.mjs:364-373`).
- R8. Each agent is a Pi process of 113 MB or more, and each finished report starts a second Pi to edit its prose (`report-editor.mjs:43-66`).
- R9. The document never shrinks. Each 1,000 runs add 29 MB of heap and 38 ms to a rebuild.

### Limits

| What | Most at once | Where |
| --- | --- | --- |
| Main chat | 1 turn | `runtime.mjs:910` |
| Routines and session jobs | 4, default 2 | `config.mjs:146`, `runner.mjs:136` |
| Work agents, routines included | 8, default 2, one start per tick and a 5-minute gap while anything runs | `work/store.mjs:35,47`, `work/plan.mjs:598` |
| Durable hobkins | 12 | `hobkins.mjs:26` |
| Helpers of the main chat | 4 running, 8 queued | `owned-agent-lifecycle.mjs:7` |

About 25 agents that hobkin owns can run today. Pi's own teams agents are shown and not counted.

## Shell, build and the machine

Read in code and in read-only samples of the live app.

- S1. The daily app runs React 19's development build inside StrictMode (`ui/src/main.tsx:17`): every component body runs twice, every element captures a stack, and every commit is timed. Measured in the replay: 1.9 times the script cost of production, and 1.5 to 2.7 times on full draws.
- S2. The window is transparent with a 20 px blur behind it at every opacity (`src-tauri/tauri.conf.json:23`, `src-tauri/src/lib.rs:238-259,406`), and the default opacity is 1. WindowServer blends and blurs on every update, and windows behind hobkin are never treated as covered.
- S3. The shell's own CPU is WebKit's compositing, and it follows how often the page redraws.
- S4. Agent processes run at normal priority (`host/src/claude-code/harness.ts:307`, hobkin `src/cli/rpc-process.mjs:26`). Only `qmd` is lowered.
- S5. `caffeinate -i -s` runs for the host's whole life (`host/src/main.ts:51`, hobkin `src/cli/stay-awake.mjs`), on battery too.
- S6. Each notification left in Notification Center adds a thread and a check twice a second on the shell's main thread.
- S7. Loaded at startup without need: the highlighter through `ui/src/features/viewer/FileViewer.tsx:11`, the proof graph with `@xyflow/react` and `dagre` through `ui/src/features/proofs/ProofScreen.tsx:18`, onboarding through `ui/src/app/Frame.tsx:24`.
- S8. `src-tauri/Cargo.toml` sets no build profile, so the debug shell checks every Objective-C message its dependencies send.

## Where the scripts are

Until S1 commits them under `scripts/perf/`, the audits' scripts are in the lead session's scratchpad, under `lanes/react/`, `lanes/host/` and `lanes/runtime/`, each with its commands in `lanes/<name>.md`.
