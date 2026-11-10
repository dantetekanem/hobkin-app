# Autoresearch: Hobkin client rendering

## Objective and authorization
Improve the real app's rendering without changing what it shows or how it behaves. The user explicitly requested an autonomous loop, all existing work committed on main first, then a new branch from main. They emphasized no benchmark overfitting or cheating.

- Existing 449-file app snapshot: main at `4eff9d3`.
- Work branch: `autoresearch/rendering-2026-11-10`, forked directly from that snapshot.
- Preserve ignored `goal.md`; older unrelated goals are unfinished. Never commit it.
- No agents during autoresearch. No installs, pushes, host starts/restarts, real data writes, model calls or live host connections. Existing services and the user's signed-in browser are untouched.

## Metrics
- Primary: `render_ms` (ms, lower) = sum of median synchronous render+commit+layout timings for mounts and updates across chat and Reports workloads.
- Secondary: `chat_mount_ms`, `chat_update_ms`, `reports_mount_ms`, `reports_update_ms`, `update_p95_ms`, `max_dom_nodes`.
- Production Vite build of actual ChatColumn and ReportsScreen, including their real stores, Markdown, motion and CSS. An isolated ephemeral headless Chrome runs through a debugging pipe (no server). CSP blocks all network connections; no host connection is started. No test-only code path in production sources.
- Chat sizes 16/128/512, Reports 32/192/512. Chat includes mixed Markdown/notices across dates, eight streamed deltas and a corrected historical message; Reports includes reader navigation and title filtering. Three repetitions, median for each workload. Mounts are not hidden by warm-cache timings.
- This measures synchronous CPU/render/layout, NOT native Tauri WebKit frame rate, end-to-end network latency, or total asynchronous animation/paint time. Never claim those from this number.

## How to run
- `./.auto/measure.sh` through run_experiment. Always log_experiment afterwards, with exact parsed metrics and useful ASI.
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
- Do not remove animation, accessibility, keyboard paths, messages, reports, Markdown semantics, or safety restrictions to make a benchmark faster.
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
- Kept #9 (`91251b1`): memoized ReportRowContent only. Layout/button wrapper still rerenders, preserving motion/selection/current callbacks. Standard 696ms, Reports updates 328ms (was ~390–397). Same max DOM count 10670. Untimed browser guards test same-ID replacements (title/summary/tone/source/date), accessible unread mark and current callback. 43 focused Node tests + typecheck pass. Holdout/replication pending.
- Unchanged-code verification runs #7/#8 logged discard because slower than best, not because kept production changes were removed. No production changes occurred in those runs.
- Bench workload remains fixed. Additional untimed correctness checks run AFTER measured workloads. Native Tauri frame rate remains unmeasured.
