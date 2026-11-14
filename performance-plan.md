# Plan: lower Hobkin's background CPU without breaking anything

This turns `performance-investigations.md` into concrete changes. It rests on the code as it stood on 2026-11-13 (hobkin-client at 40957bb; hobkin at e50676f plus that checkout's uncommitted work) and on process readings and file sizes from the same day. No code has changed. Line numbers come from those working trees and need rechecking before each edit.

## What was measured

One 60-second window from 18:19:45, as `ps` CPU-time deltas (100% is one core):

| Process | CPU |
| --- | --- |
| Host (`node host/src/main.ts --dev --live`, PID 30010) | 33% |
| WebKit content (PID 9740) | 17% |
| WebKit GPU (PID 9738) | 12% |
| Native shell (`target/debug/hobkin`, PID 7180) | 9% |

The host had two or three `pi` agent runs and a change review's test process as children, and the main conversation was idle. The host averaged 30% over its first 11 minutes, so the elevated load reproduces while agents run. The hobkin runtime runs inside the host process, so the host's share covers both. A window with nothing running has not been measured, and no profile names the JavaScript functions yet.

File sizes in the real home, listed as metadata only, with no contents read: `runtime/hobkin.sqlite` 14.8 MB, `runtime/view.json` 1.6 MB, 712 report files, `decisions.jsonl` 64 KB, `work/tokens.jsonl` 72 KB. `work/subscription.json` (107 bytes) had been rewritten three seconds before it was listed. The WebKit content process held 1.38 GB resident.

## Where the code spends it

This is a model built from reading the code, not a profile. It fits the earlier native sample (timer work, JSON parse and stringify).

### Every second, even with nothing running

1. The scheduler ticks every second (`hobkin/src/cli/runner.mjs:154`; the host passes no interval), and a tick never overlaps the next, so the idle share is roughly the length of one tick.
2. Each tick makes at least two full copies of the runtime document by JSON round trip (`runner.mjs:178`, `application.mjs:1019`), a third when any one-time routine exists (`runner.mjs:214`) and a fourth with learning on (`application.mjs:908`). The host adds one every five seconds for titles (`host/src/host.ts:671`, `hobkin/src/cli/hobkins.mjs:466-467`). The copy is `JSON.parse(JSON.stringify(...))` (`runtime.mjs:49`, `183-185`) of a document that keeps every run with its prompt and full result and never drops one, so each copy costs more as history grows.
3. `tickWork()` (`application.mjs:866-875`) rebuilds all of `workStatus()` (`work/commands.mjs:149-215`: the plan, reads for each project, `tokens.jsonl` parsed three times, `config.json` several times) together with open decisions and the learning flag, then stringifies the lot only to see whether it changed.
4. That signature includes `subscription.elapsedPercent`, a float computed from the clock (`work/usage.mjs:41-54`), whenever `work/subscription.json` holds a window with a future reset. Agent processes write that file from rate-limit headers. While the condition holds, the signature differs on every tick, so every tick runs a full `project()` and a host publish. The text that shows the value rounds it (`work/subscription.mjs:11-14`). The real home may meet the condition, but that is unconfirmed because the file's contents were not read.
5. Smaller reads with no cache run every tick: `decisions.jsonl` parsed four times, the director's maintenance before its Work mode check (`work/director.mjs:168-188`, including every project's items), every routine file parsed with new `Intl.DateTimeFormat` objects (`schedules.mjs:191-239`, `runner.mjs:42-66`), and the inbox log twice.

### On every update while agents stream

6. Agent events batch into one update per 25 ms (`application.mjs:167-177`, `353-367`). An activity-only update (`publishActivity()`, `370-384`) makes a new snapshot object but keeps every other key's value as the same object.
7. Every update runs the host's `publish()` (`host.ts:196-203`): `facts()` (`320-333`), then `StateSync.update()` (`host/src/state-sync.ts:145-224`), which does its full work whatever changed. It stringifies each host fact twice, new and old (`146-157`), and every top-level snapshot key (`171`). It hashes every schedule with sha256 (`40-44`, `hobkin/src/cli/checks.mjs:104-107`), and `diffMessages` stringifies each of up to 100 kept messages twice (`shared/protocol/message-ops.ts:46-48`). The snapshot carries every report with its full body (`application.mjs:573-577`) and up to 100 finished job reports with bodies (`620-643`). The saved view, which cuts each body to 32 KB, is already 1.6 MB. So the host can serialize megabytes up to 40 times a second when only the activity feed moved.
8. A full refresh (`project()`, `application.mjs:397-699`) runs when an agent ends a message or reports performance (`179-182`) and when the tick's signature changes. It copies the runtime document three times (`compatibility.mjs:80`, `application.mjs:399`, `runner.mjs:408`), reads a report file for each finished run (`420`) and up to 100 more (`632`), hashes up to 100 chat messages (`87-99`), and stringifies the whole saved view as a signature (`608`). The host then reads hobkin's items again for the Work screen and the GitHub page (`host/src/work-items.ts:225-233`, `host/src/work-issues.ts:120-133`).

### In the window

9. Each host message replaces the whole store state (`ui/src/lib/host/client.ts:22`, `ui/src/lib/host/state.ts:82-119`). The always-mounted Composer and the Home screen subscribe to the whole state (`ui/src/features/chat/Composer.tsx:68`, `ui/src/features/home/use-home.ts:26`), so both re-render on every message, including every streamed token of a chat reply.

## Ground rules

- Saves go live. The live host restarts itself onto newer code once nothing runs and its files have been still for a minute (`host.ts:674-700`, `host/src/code-age.ts:52-69`). Its watch covers `host/src`, `shared`, `packages/change-review` and hobkin's `src/cli`, and the window hot-reloads UI saves. Every save must leave working code: write a new export before the code that imports it, make each edit complete, and run the focused tests right after saving.
- hobkin's checkout holds another session's uncommitted work in 18 files, including `application.mjs` (some hunks inside `project()`), `runner.mjs`, `runtime.mjs` and `work/director.mjs`. Before any runtime step, ask the user how to handle that work. Commit only this plan's hunks (`git apply --cached`, then check `git diff --cached`), with a pathspec.
- Never start a host on `~/.hobkin` or send anything to port 5188. Tests and benchmarks use temporary homes, the scripted model and port 0.
- Each behavior change starts with a failing test. Run only the focused tests named here (`node --test <file>` in each repository). A broad suite needs the user's word, as do commits, restarts, version bumps and pushes.
- Each step stays small enough to measure and revert alone, and goes ahead only if the measurements show its target matters.

## Step 0. Measure

1. Baselines (no permission needed): three 60-second `ps` windows for the host, shell, WebKit content and GPU processes, in two scenarios: agents running, and nothing running. Note the runs under the host, the screen shown and whether a canvas page is open. Drop windows that span a restart.
2. Attribution (needs the user's yes): one 60-second CPU profile of the live host in each scenario, with no restart. SIGUSR1 opens Node's inspector on 127.0.0.1:9229, and a scratch script records with the Profiler domain and saves the `.cpuprofile` in the scratchpad. The inspector then stays open, idle, until the host's next restart, because closing it from the same connection can block the host. While it is open, local processes can attach to the host. The quiet-scenario profile also settles item 4: it shows whether `project()` runs every second.
3. Reproduction (no permission needed): a scratch script builds a temporary home with synthetic data at the sizes above, starts a scripted host on port 0, replays agent events at the rate the profile shows, and runs under `--cpu-prof`. The same script gives every later step its before and after numbers.
4. Micro-benchmarks in the scratchpad: `StateSync.update` for an activity-only publish and for a full one, `runtime.state()`, and `project()` on the synthetic home.

Done when the functions are ranked by self time in both scenarios, with the publish and full-refresh rates. Steps 1 to 3 are independent, so take them in the order the profile ranks them. Without a profile, start with Step 1, which touches no runtime file.

## Step 1. Host: stop re-serializing what did not change

Files: `host/src/state-sync.ts`, `shared/protocol/message-ops.ts`, `host/test/state-sync.test.ts`.

1. `diffMessages`: skip the stringify comparison when a kept message is the same object as before. The output is the same as today's, since an object compared with itself always stringifies equal.
2. Host facts (owner, sign-in, models, GitHub, integrations, work, canvas, canvases, nudge, appearance): keep the encoding last sent instead of stringifying the old value again, and skip the new stringify when the value is the same object. Results match today's, because each producer replaces its object on change (`github.ts:189`, `integrations.ts:298`, `signin.ts:115`, `nudge.ts:37`, `canvases.ts:106`, `work-items.ts:229-232`, `work-issues.ts:124-129`). Comparing against the encoding last sent is also safer than today's check if a producer ever edits an old object in place.
3. Snapshot keys: when a key's value is the same object as at the last publish, reuse its stored encoding, and memoize `toWire`'s schedule rows on the same input array so their sha256 does not run again. This differs from today in one case: a runtime object changed in place after it was published. The runtime builds new objects instead (its one direct write, `application.mjs:693`, happens before publishing). As a safety net, re-encode every key at least once a second anyway. Before relying on it, read the producers of the large keys (reports, completedJobReports, runs, work, waiting, telemetry, usage, schedules) for in-place writes.

Tests first: a same-object key or fact sends nothing; an equal new object sends nothing (covered now); a changed value is sent; a value changed in place is sent within the one-second bound (injected clock); `full()` and a new owner state still send everything; same-object messages give no update step, and changed ones do. Then run the host tests that use `StateSync` or `toWire`: `state-sync`, `activity-sync`, `work-streaming`, `chat`, `work`, `integrations`, `shell-messages` and `routine-delete`.

Done when the micro-benchmark shows most of an activity-only publish's cost gone, and Step 0's windows, repeated with agents running, show what is left of the host's share.

## Step 2. Runtime: no full refresh every second

Only if Step 0 shows `project()` running every second while nothing runs. File: `application.mjs`, in `tickWork()`, which none of the pending hunks touch.

1. In the `tickWork()` signature, compare `elapsedPercent` at the precision the text shows (whole percent), for example with a replacer in the `JSON.stringify` call at `871`. The snapshot keeps the exact value. Look for other values in `workStatus()` that change with the clock alone and treat them the same way.
2. While the condition holds today, everything in the projection that depends on the clock (wins today, report attention, waiting rows, the forecast, day changes) refreshes every second as a side effect. List those values and check that each has its own trigger. Add the current minute to the signature as a floor, so the projection still refreshes at least once a minute.

Tests (`test/helpers/work-director.mjs` already writes a weekly `subscription.json` with `resetAt`): two ticks a second apart with nothing else changed request no refresh; a new used percent, a new whole elapsed percent or a new minute each request one.

## Step 3. Runtime: cheaper copies and reads, same results

Files: `hobkin/src/cli/runtime.mjs`, `application.mjs`, `runner.mjs`, `reports.mjs`, and focused tests under `hobkin/test`.

1. `state()`: keep the JSON text of the last document and reuse it while pi-durable returns the same document object. A commit swaps in a new immutable value and bumps a revision (`@earendil-works/chord` 1.4.0, `dist/delta/tracker.js:129-156`, `218-225`), so the same object means the same content, and every caller still gets its own copy from `JSON.parse`. First check that no hobkin code mutates what `harness.snapshot()` returns. The cost is one extra string the size of the document. Tests (`test/cli-runtime.test.mjs` opens a real runtime): two reads with no commit stringify once; a commit shows in the next read; editing a returned copy does not change the next one.
2. `project()`: read the document once instead of twice by passing the state it read into `runner.snapshot()` (`runner.mjs:407-408`), which only reads it. `syncEvidence()` keeps its own read, because it can commit evidence receipts before `project()` reads (`compatibility.mjs:79-92`). Tests: one `project()` read per refresh; a change committed after a refresh shows in the next one.
3. Report bodies: keep the bodies `project()` reads through `readReport` (`reports.mjs:115`; `application.mjs:420`, `632`), keyed by the file version that `work/store.mjs` already computes for its own cache (`124-155`: device, inode, size, mtime and ctime, with a second stat that rejects a read that raced a write). Read a file again only when its version changes. Tests: an edited report shows its new body on the next refresh; a deleted one falls back as today; an unchanged one is not read again (the read-counting pattern in `test/cli-work-read-cache.test.mjs`).
4. Only if the profile shows them: the saved-view signature (`application.mjs:608`), the chat-message hash (`87-99`), the routine parsing and formatters (one `Intl.DateTimeFormat` per time zone), and the logs read several times a tick, using the same version cache.

Keep `state()`'s deep copy, so no caller gets mutable runtime data, and never hold one copy across a tick that starts work, awaits outside work or commits.

## Step 4. Runtime: rebuild work status only when its inputs change

Only if the quiet-scenario profile still shows `tickWork()` after Steps 2 and 3. Rebuild `workStatus()` only when an input changed: the work store files (other processes write them), decisions, the learning flag, the director's outlook, and the clock at the granularity work status uses for holds, deadlines, budgets and new days. Rebuild in full anyway every N seconds as reconciliation, and measure that path so it does not bring back the per-second cost. Tests: unchanged inputs skip the rebuild; an item written by another process, a filed decision, a hold that ends and a new day each still reach the snapshot within the stated bound.

## Step 5. Window

The window's processes used about 38% of a core in the same minute (WebKit content 17%, GPU 12%, shell 9%), so this step needs its own measurements and does not wait for the host steps.

1. Composer and Home: select only the fields that `executionTargets` and `gatherHomeInput` read (`ui/src/features/work/actions.ts:42`, `ui/src/features/home/input.ts:17`), with `useShallow` as `ui/src/features/routines/Routines.tsx` already does. The Composer then stops re-rendering on every token.
2. If React commits stay high: apply the host messages that arrive in one frame as a single store update.
3. If a page canvas is open in the measured scenario: BrowserPane's per-frame loop, which reads layout and calls the shell every frame (`ui/src/features/canvas-panel/BrowserPane.tsx:66-80`).
4. Memory: record the content process's size over an hour of normal use before calling 1.38 GB a leak.

Checks: React commit counts in the same visible scenario, then a rendered check of streaming, navigation, scrolling and canvas position. Rendered checks need the user's yes, or the user looks at the live window.

## Step 6. Verify

Repeat Step 0's windows in the same scenarios and report each window and the median. The target is a drop of at least half in the median host CPU in each scenario. Routines still fire once and on time, cancellation and stop receipts behave as before, a reconnect gets the full state, and typecheck adds no errors. Post-process the changed JavaScript and TypeScript once, rerun the focused tests, and check the diff for unrelated changes. Report host and window results separately.

## Decisions for the user

- Whether to profile the live host through its inspector (Step 0.2).
- Whether a session may read `work/subscription.json` (107 bytes of rate-limit figures) to confirm item 4, or leave that to the profile.
- How to handle hobkin's pending uncommitted work before Steps 2 to 4.
- Commits, the batch's version number, and any restart.
- Rendered checks for Step 5.

Not in this plan: the runtime document never drops old runs, so every copy grows with history. Pruning it would change what hobkin keeps and shows, so it needs its own decision. Also left out, as in the investigation: a scheduler rewrite, longer intervals across the board, and a general caching layer. Host-side throttling of publishes comes back only if Step 1 leaves streaming publishes dominant.
