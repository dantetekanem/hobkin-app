---
name: node-map
description: Build the map of a code change as nodes with facts. For every changed definition, establish what it does, whether a test that moves through the request life cycle executes it, who runs it when it ships, and what undoes it. Uses search for three of the facts and runs tests in isolation with coverage for the fourth. Use as step 2 of change-review, or alone to see what a diff touches and what proves it.
compatibility: Requires pi-agentic-search 0.7+, Git, and a repository whose tests can be run one file at a time with line coverage. Writes .review/graph.json.
---

# Node map

Collect facts. No judgment and no model reasoning about code happen here. Definitions of every fact and value: `../change-review/FOUNDATION.md` section 4.

## 1. Nodes and edges, by search

```bash
agentic-search scan --diff <range|worktree> --output-dir .review/pack --max-anchors 200 --max-nodes 300
```

Only files triage marked `scan` or `tests`. From the pack: one node per changed definition and per non-callable change (constant, class-body statement, migration, config); call edges with their resolution; tests that reference a node; definitions removed while callers remain.

Check coverage before going on: `truncatedBy` is `none`, no anchors skipped, and every scanned file has at least one node. A code diff with zero nodes is a failure to report, not a result.

## 2. Effect

For each node, from its changed lines: `text`, `behaviour`, `interface`, `data`, `load`. Patterns for writes, enqueues, serialization and cache keys are configuration; keep them in one file and record which pattern matched which line. A changed string literal in code is `behaviour`, not `text`.

## 3. Exposure

Find the conditions that dominate each changed line: in the definition itself, or on every call site of it. Record the condition as written.

- `nobody-yet` only when dominance is proven on every path and the path taken with the condition off is the old code. Anything unproven is `everyone`, with the reason (caller found by name only, no caller found, value stored in a variable).
- A definition that predates the diff and relies on its callers being behind the condition is `everyone` until every caller is shown.
- The condition check is itself a fact on the node that hosts it: it runs for everyone.
- `at-load` for code that takes effect when files load or at deploy.

## 4. Undo

`flag`, `flag-with-residue` (data effects behind the condition), `rollback`, or `none` (destructive schema change, rewritten or dropped data, sent payloads, changed serialized format).

## 5. Proof, by running tests

Static search cannot follow a request test through routing to the code it drives. Proof is measured.

1. **Find the entry points above each node**: walk call edges upward to controllers, jobs and consumers.
2. **Find their life cycle tests**: request, controller, integration, system and job tests for those entry points, by the repository's conventions. Record how the repository runs one test file with coverage in `.review-cache/runbook.md`, taken from the CI configuration, and only once a command has run and exited 0.
3. **Run them in isolation with line coverage.** For code behind a condition, also with the condition on, using the test helper the repository has for it.
4. **Read the coverage for the changed lines of each node**, and set proof: `lifecycle-observed`, `lifecycle`, `isolated`, `mocked`, `none`, `unknown`.
5. **Mocks**: a test that stubs the changed definition, a caller between entry and change, or what the change writes to, counts as `mocked` for that node. Record which double.

An entry point with no life cycle test is recorded as such, by name. That is a finding the floor turns into `high`; do not write a test to fill the gap, and do not boot a server.

Record every run: command, exit code, seconds, condition state, which nodes' changed lines it executed. A failing test is a finding at `high`. Never record a run that did not happen.

## 6. Port mode: parity before the map

1. List every test in the old tree and the new tree. Build the table: old test, new counterpart, or `missing`.
2. Old tests with no counterpart are the first nodes of the review.
3. Run both suites; both must pass.
4. Tests that speak the public interface (HTTP, CLI, queue messages) run against both implementations. That is the parity evidence; the mapping is bookkeeping.
5. Then map entry points only.

## Limits to state

Call resolution is static; a name match is not proof. Coverage shows lines ran, not that an assertion checked them. Local and test environments only.
