# Hobkin performance investigation and repair plan

## Goal and scope

Reduce Hobkin's sustained background CPU use without delaying scheduled work, losing updates, weakening concurrency checks, or making the UI stale.

This document is a plan, not authorization to implement it. The current request authorizes creating this file only. Keep future implementation in the existing repositories, preserve unrelated work, and request permission for app restarts, profiling that changes runtime configuration, browser launches, dependency installation, or live model runs. Do not edit the real home's database, locks, sessions, or saved views to manufacture a benchmark.

Repositories:

- Client and host: `/Users/someone/Poetry/hobkin-client`.
- Linked runtime: `/Users/someone/Poetry/hobkin`. The client's `hobkin` dependency points here.

Start with host/runtime overhead. Investigate UI rendering separately rather than assuming both have the same cause. Do not start with a scheduler rewrite, blanket interval increases, or a general caching framework.

## Evidence collected

These are observations from the initial investigation, not a stable benchmark. Line numbers are navigation anchors and must be rechecked before implementation.

| Observation | Evidence | What it establishes |
| --- | --- | --- |
| Hobkin's Node host consumed roughly 30-56% CPU in early snapshots. | `ps` and interval-based `top`; host PID 46598, parent `target/debug/hobkin`. | Hobkin contributed load after Spotify stopped. macOS process CPU uses 100% for one logical core. |
| A replacement host spent much of its sampled active main-thread time in timer-triggered work. | Five-second native sample of PID 84894: 105 of 457 main-thread samples under `uv__run_timers`; JSON parsing and stringifying appeared in the stacks. | Timer work and JSON processing are measured leads. The 23% sample fraction is not an exact CPU percentage or attribution to a particular JavaScript function. |
| Runtime state reads deep-copy the whole document through JSON. | `../hobkin/src/cli/runtime.mjs:49,183`: `copy = value => JSON.parse(JSON.stringify(value))`; `state()` copies the harness snapshot. | Every such call pays for a full JSON round trip, including retained runs. |
| Multiple paths request that state independently. | `runner.mjs:178,407`; `application.mjs:399-400,1019`. | Scheduling, dashboard projection, runner snapshots, and session checks can repeat the work. |
| The scheduler ticks every second. | `../hobkin/src/cli/runner.mjs:154-162`; application callbacks at `application.mjs:265-280`. | Background maintenance continues without user interaction. |
| Work status is rebuilt before deciding whether it changed. | `application.mjs:865-874`; `work/commands.mjs:149`. | Each tick can plan work, read project/item state, assemble status, and stringify it just to compare signatures. |
| Work mode being off does not skip all maintenance. | `work/director.mjs:168-188`. | Several maintenance operations run before the mode check. Some are necessary for already-running work. |
| Host publication serializes state to detect changes. | `host/src/host.ts:195-201`; `host/src/state-sync.ts:145-178`. | Small updates can trigger broad comparisons even though the wire protocol sends deltas. |
| The busy WebKit content process belonged to Hobkin. | Open files under `Library/Caches/hobkin/WebKit`; native sample showed WebSocket message handling. | UI-side update processing adds work. It does not identify a costly React component. |

### Limits and corrections

- The host restarted during investigation, and later the native app restarted too. Neither restart was initiated by this investigation. Do not combine those process lifetimes into a before/after result or assume the restart cause.
- The replacement host and UI later showed lower load. The original spike was not captured with JavaScript function-level attribution.
- No actual temperature reading was collected. macOS reported no recorded thermal or performance warnings.
- Native samples leave JavaScript frames unnamed. Static call collection also had unresolved receivers and an unexpanded frontier. Neither proves full execution coverage.
- `forecastEachMinute()` already caches forecasts by minute and relevant inputs (`work/forecast.mjs:271`). Do not describe the eight-hour forecast as necessarily recomputed every second.
- The evidence does not yet prove that animations, a memory leak, or development mode caused the original load.

## 1. Establish a repeatable baseline

Before changing behavior:

1. Record both repositories' revisions and worktree state, Node version, build mode, process IDs, and launch times. The checkout already contains substantial unrelated changes.
2. Observe an existing settled session with no active agents. Separate visible idle, unfocused idle, and active streaming. Record the selected screen and whether a canvas is open. Arrange any required UI interaction or restart with the user first.
3. For each reproducible scenario, collect three 60-second windows after startup settles. Track host, native shell, WebKit content, and GPU processes separately. Record CPU-time deltas divided by elapsed time, memory, and process restarts. Treat WindowServer as shared system overhead, not entirely Hobkin's.
4. Capture a short native sample during sustained host load. If function attribution remains insufficient, propose a bounded JavaScript profile and obtain permission for any required inspector activation or restart.
5. For repeatable automated work, use synthetic fixtures matching observed data counts and sizes. Include retained runs, reports, projects/items, and activity history. Keep private content and credentials out of fixtures and logs.

Acceptance: retain raw measurements and workload details; discard windows interrupted by restarts or changing workloads. Identify the dominant host costs before selecting a repair. Do not claim a heat reduction from CPU measurements alone.

## 2. Measure the suspected hot paths

Once implementation/profiling is authorized, add temporary or opt-in aggregate measurements around:

- `HobkinRuntime.state()`: calls, duration, and snapshot size measured without repeatedly serializing it just for instrumentation.
- `HobkinRunner.performTick()`: total time and time in each application callback.
- `HobkinApplication.project()` and `publishActivity()`: frequency and duration.
- `workStatus()`, `planWork()`, and project/item reads: count and elapsed time.
- `StateSync.update()`: comparisons, changed fields, duration, and outgoing message bytes.

Use monotonic clocks. Report counters in batches rather than logging every event. Do not log conversation bodies. Compare instrumented and uninstrumented runs so measurement overhead is visible.

Acceptance: distinguish idle polling from streaming work, and rank the measured costs. Source inspection alone is not enough to assign each function a share of the original spike.

## 3. Remove redundant snapshot work

If profiling confirms repeated runtime copies are material:

1. Write focused failing tests for duplicate reads in a read-only projection and for freshness after a committed change.
2. Start with `project()`: it obtains runtime state and then calls `runner.snapshot()`, which reads state again. Allow this read-only projection to derive both views from the same captured state, if their contracts permit it.
3. Extend reuse only within clearly bounded read-only phases. Scheduler admission, cancellation, and session dispatch must still validate current state at their existing transaction boundaries.
4. Preserve snapshot ownership. Do not return mutable internal state or replace the JSON copy with a shallow copy without proving callers cannot mutate runtime data.
5. Do not keep one snapshot across an entire tick if that tick starts work, awaits external operations, or commits state. Explicitly refresh after mutations where required.

Acceptance: the chosen projection performs one state read rather than two; tests prove isolation and post-commit freshness. Measured copy time decreases without stale admissions, duplicate jobs, or broken cancellation.

## 4. Avoid rebuilding unchanged work and dashboard state

Proceed only on paths that measurements show are costly:

1. Add focused tests for unchanged input, an in-process update, an external file update, and a time-based transition.
2. Separate scheduling/admission checks from display-only work. Keep correctness-critical checks at their existing cadence.
3. Give expensive work projections a reliable invalidation source. Prefer existing revisions or narrowly scoped dirty flags; account for edits made by other processes and for deadlines, holds, budgets, and day/hour changes.
4. Treat filesystem watchers as hints, not the sole guarantee. Retain a bounded reconciliation path for missed events. Measure that path so it does not recreate the same full scan every second.
5. Reuse unchanged host slices or their cached encodings instead of serializing both old and new values on every publication. This requires immutable slices or explicit revisions; object identity alone is unsafe for mutated objects.
6. Keep streaming activity updates narrow. Verify that a text/tool delta does not unnecessarily rebuild reports, the work plan, or the entire conversation. Preserve the existing wire-delta behavior.

Acceptance: an unchanged idle cycle avoids the targeted full rebuilds; committed, external, and time-driven changes still reach the client within a documented bound. Scheduled dispatch, user commands, final reports, and cancellation retain their existing responsiveness. Reconnect still sends a complete current state.

## 5. Investigate UI work independently

After the host path is measured, compare WebKit load with equivalent visible and unfocused scenarios. Do not use a backgrounded window as the sole proof of improvement.

Inspect only components implicated by profiling:

- Snapshot consumers and React commit frequency after WebSocket messages.
- Repeated parsing, date formatting, or expensive derived lists on unchanged data.
- Continuous animation loops and layout reads, including `BrowserPane`'s frame loop, only if the relevant component is mounted and contributes measurable work.
- Whether hidden views continue unnecessary visual updates while essential background work remains active.

If a repair is justified, keep subscriptions narrow, preserve unchanged references, and avoid layout/animation work when it serves no visible purpose. Do not remove feedback or slow active streaming merely to lower a CPU number.

Acceptance: identify a measured UI hotspot before editing it; demonstrate reduced commits or frame work in the same visible scenario. Verify navigation, scrolling, streaming, and canvas positioning with an authorized rendered check. Source-only evidence does not close this step.

## 6. Verify and decide whether the repair is enough

For each independently measurable change:

1. Run focused red/green tests before and after implementation. Cover snapshot isolation, external invalidation, time transitions, reconnect, and the admission/cancellation paths actually affected.
2. Use deterministic scripted activity for performance checks; do not spend on live agents without authorization.
3. Repeat the same three 60-second baseline windows. Report each result and the median, not just the best run. Keep instrumentation, build mode, data shape, screen, and agent activity comparable.
4. As an initial success target, aim for at least a 50% reduction in median idle host CPU for a reproduced elevated baseline. This is a proposed target, not an observed result. If the elevated baseline cannot be reproduced, report that gap instead of claiming it fixed.
5. Require no meaningful regression in active-stream CPU, memory growth, or responsiveness. Use focused timing checks to show no missed/duplicate schedules and no added scheduler delay beyond the existing cadence under the same load.
6. Apply JavaScript/TypeScript post-processing once to the completed changed code/tests, then rerun affected checks. Review the final diff for unrelated changes.

Completion requires a before/after table, focused test results, the identified causes, and explicit remaining gaps. If host overhead improves but WebKit remains busy, report those as separate outcomes. Do not broaden the repair into a runtime redesign without revisiting scope.

## Recommended order

Baseline and attribution first. Then remove a proven duplicate read, measure again, and address unchanged-state rebuilds if they remain material. Investigate rendering only with its own evidence. Keep each repair small enough to measure and revert independently, without touching unrelated work.
