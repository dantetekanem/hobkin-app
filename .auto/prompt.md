# Autoresearch: Hobkin client rendering

## Objective and authorization
Improve the real app's rendering without changing what it shows or how it behaves. The user explicitly requested an autonomous loop, all existing work committed on main first, then a new branch from main. They emphasized no benchmark overfitting or cheating.

- Existing 449-file app snapshot: main at `4eff9d3`.
- Work branch: `autoresearch/rendering-2026-11-10`, forked directly from that snapshot.
- Preserve ignored `goal.md`; older unrelated goals are unfinished. Never commit it.
- No agents during autoresearch. No installs, pushes, host starts/restarts, real data writes, model calls or live host connections. Existing services and the user's signed-in browser are untouched.

## Metrics
- Phase 2 primary: `main_thread_ms` (ms, lower) = Chrome Performance.TaskDuration delta over the full fixed browser workload, including frames between updates and the real-motion acceptance flows. Excludes bundle/build/page-load time and Node checks. This measures active renderer task time rather than idle frame waits.
- Secondary: `script_ms`, `layout_ms`, `style_ms`, plus Phase 1's `render_ms` and its components `chat_mount_ms`, `chat_update_ms`, `reports_mount_ms`, `reports_update_ms`, `update_p95_ms`, `max_dom_nodes`.
- `render_ms` remains the sum of median synchronous render+commit+layout times across the multi-size workloads. Phase 2's primary covers all three repetitions, warmup, and end-of-run behavior/motion checks; it is not a median. Workload and check flow must stay fixed for comparable main-thread results.
- Production Vite build of actual ChatColumn and ReportsScreen, including their real stores, Markdown, motion and CSS. An isolated ephemeral headless Chrome runs through a debugging pipe (no server). CSP blocks all network connections; no host connection is started. No test-only code path in production sources.
- Chat sizes 16/128/512, Reports 32/192/512. Chat includes mixed Markdown/notices across dates, eight streamed deltas and a corrected historical message; Reports includes reader navigation and title filtering. Three repetitions, median for each workload. Mounts are not hidden by warm-cache timings.
- Phase 1 measured only synchronous CPU/render/layout. Phase 2 adds renderer main-thread work during animation frames, but neither measures native Tauri WebKit frame rate, compositor/GPU cost, end-to-end network latency, or proves pixel equivalence. Never claim those from these numbers.

## How to run
- `./.auto/measure.sh` through run_experiment. Always log_experiment afterwards, with exact parsed metrics and useful ASI. Commands must enter through measure.sh, not begin with an auxiliary node command.
- `BASE_REV=<commit> ./.auto/measure.sh` builds prior changed ui/src modules directly from git show in the isolated bundle only, without switching checkout or making a worktree. Use separate redirected logs for diagnostic comparisons, then run normal HEAD last for the logged metric.
- `PROFILE=1` captures a separate unminified CPU sampling run in `.auto/out/profile.json`; never compare those profiled timings. `TRIAGE_CHECK=1` adds a parser-only before/after diagnostic in `.auto/out/triage-comparison.log`, excluded from browser timings.
- `.auto/checks.sh` automatically runs typecheck and focused chat/Markdown/Reports tests after passing benchmarks.
- `HOLDOUT=1 ./.auto/measure.sh` uses different sizes (23/91/337 chat, 41/157/431 reports), different wording/widths and Still motion. Compare it only to its own baseline; do not mix holdout numbers into the primary series. Use an auxiliary command within a measured run to retain primary comparable metrics when validating holdouts.
- Raw per-case timings: `.auto/out/latest.json`; holdout: `.auto/out/holdout.json`. Generated bundles/browser profiles/output are ignored.

## Files in scope
- `ui/src/features/chat/` for conversation building and message rendering.
- `ui/src/features/reports/` for report derivation and screen rendering.
- `ui/src/lib/host/live.ts` or `hooks.ts` only for in-memory render preparation/subscription costs, not transport or host behavior.
- Relevant focused `ui/test/` files. Existing Node test runner, no new dependencies.
- `.auto/` playbook, benchmark and backlog. Freeze workload for comparable metrics; instrumentation may be added transparently. Reset the baseline if the timed workload changes.

## Off limits / constraints
- Backend, auth, protocols, real home, dependencies/lockfile, Tauri configuration, unrelated app features and any persisted user state.
- USER REAFFIRMED: NEVER sacrifice an animation, only improve performance. Do not remove, disable, shorten or simplify any existing animation, duration, choreography or layout transition. The primary workload stays Lively; the Still holdout tests the pre-existing user-selected setting, not a speed shortcut. Preserve motion wrappers and directly verify animated transitions before accepting further rendering changes.
- Do not remove accessibility, keyboard paths, messages, reports, Markdown semantics, or safety restrictions to make a benchmark faster.
- No workload detection, precomputed fixture answers, skipped checks, watered-down assertions, or unbounded caches.
- Tests before implementation, then smallest change and focused checks. Read call context with sparsity_collect before changing definitions. Final post-processing once a cohesive implementation is complete; preserve clear code.
- Keep/discard via log_experiment; no manual experiment commits/reverts. Check branch/status each iteration and stop on unrelated concurrent edits.
- Each experiment budget: usually one hypothesis, <=2 production files and ~80 changed production lines; tests as needed. Reconsider rather than growing speculative abstractions.

## Findings / what's been tried
- Initial source inspection: buildConversation makes a new Intl.DateTimeFormat for every message's dayKey (and more for dayLabel), on every live delta. Candidate: reuse formatters within a build while preserving timezone and midnight/DST behavior.
- MessageList rerenders all Row/Message motion trees on each streaming delta. Entry objects are rebuilt, so naive memo(Row) would not help. Markdown is already memoized. Need preserve layout propagation and verify corrected historical messages.
- Reports renders every row and repeatedly derives triage for full bodies. Avoid changing keyboard navigation or motion to reduce row count.
- Harness setup runs #1–3 crashed before timings (missing production NODE_ENV / selector counting Markdown list items); log records 0. Dashboard baseline/best percentage is therefore invalid. DO NOT compare against zero. First valid standard baseline #4 = 891.2ms; unchanged replication #5 = 869.1ms (~2.5% variability). Holdout baseline = 691.1ms (chat updates 200.1, Reports updates 325.7).
- Kept #6 (`6ef37f3`): conversation day-key Intl formatter scoped to one build, today computed once. Standard 741.1ms, verification 755.5/757.4. Chat updates 270.4→152.8–161.6ms. Holdout 614.1ms, chat updates 119.2. New midnight/DST/timezone characterization passed before/after. Production diff: 7 additions/10 deletions; test adds 18 lines.
- Kept #9 (`91251b1`): memoized ReportRowContent only. Layout/button wrapper still rerenders, preserving motion/selection/current callbacks. Standard 696ms, Reports updates 328ms (was ~390–397). Same max DOM count 10670. Untimed browser guards test same-ID replacements (title/summary/tone/source/date), accessible unread mark and current callback. 43 focused Node tests + typecheck pass. Standard replication #10/#11 = 678.3/676.6ms, Reports updates 332.3/330.2. Holdout saved in `.auto/out/holdout-report-content.log`; inspect before citing.
- Unchanged-code verification runs #7/#8 logged discard because slower than best, not because kept production changes were removed. No production changes occurred in those runs.
- #12: original main (`BASE_REV=4eff9d3`) and optimized head both pass real-frame positive checks for report row arrival, reader growth, page slide/outgoing retention, reader closing return, chat message rise, streaming block rise and fresh-word fade. Also added same-key chat role/text/about/image/time/completion checks. These run after synchronous timings. Main recheck 858.7ms; optimized 653.4ms, equal DOM node counts.
- Discarded #14: shallow-memo(Message) with Zustand shallow comparator allocated Maps on every entry compare. 659.9ms, not better than 653.4ms. Motion and correctness passed. Do not retry same comparator; primitive props or upstream identity would change assumptions, but benefit needs profiling proof.
- Kept #15 (`6b6af3a`): triage lazily reads two nonblank lines instead of splitting whole body. Primary 650.1ms vs 653.4ms is noise; matched replication before655.7/after661.4 did NOT establish an additional browser speedup. Separate 40-case parser diagnostic (0/20/200/2000-line reports, 5 balanced samples, exact output equality) was 20.79→0.47ms, parser only. Holdout full app532.3ms. New long-body/CRLF/Unicode blank-line/limit tests pass.
- Kept #18 (`a30002a`): storedBesideLive uses a fresh local Set for membership, replacing quadratic repeated array scans. 647.1ms is within noise; no claimed standalone end-to-end gain. Identity/order/duplicate-ID characterization added.
- Kept #19 (`6d77fcf`): chat day-label formatters and yesterday calculation scoped to the build, lazily created for current/other years. 644.5ms, chat updates135.7ms. Small increment requires replication. 45 focused tests/typecheck pass and all seven animation paths pass.
- Phase 2 starts after #19: user emphasized never sacrificing animation and the synchronous micro-gains plateaued. Change the primary target to actual renderer task time including animation frames, using CDP Performance metrics. Call init_experiment once for this genuinely different metric. Do not compare new primary numbers to Phase1 render_ms. Old phase zeros are harness setup/admission failures, never performance evidence.
