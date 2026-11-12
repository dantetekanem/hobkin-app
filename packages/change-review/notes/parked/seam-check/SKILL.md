---
name: seam-check
description: Judge whether a flagged change is built to survive more iterations, by counting flag seams and ungated changes, and propose the few tests worth adding instead of one per line. Use when asked whether a diff is well structured, what tests it needs, or whether it should be split into a prep PR.
compatibility: Requires graph.json from node-map.
---

# Seam check

Quality here means one thing: how cheaply can someone show that flag off is the old behaviour. Read it from `graph.json`; do not read code unless a step says so.

## Numbers

From `summary.gate_numbers` and `gates`:

- **Flag sites per flag.** One is the target. Each extra site is another place where on and off must be kept in step.
- **Ungated, open and ungateable nodes.** Each needs a written reason to exist in a flagged diff.
- **Nodes with `in_method.outside` lines and a gate in the same definition.** New and old logic are interleaved.
- **Gates with `form: expression`.** The flag value travels; nothing can prove what it controls.

## Verdict

- One site, no interleaving, off path `identical`: the seam is clean. Say so and stop.
- Interleaving, or more than two sites for one flag: recommend a prep PR. First PR, unflagged: the refactor that makes one seam possible, behaviour-preserving, proven by the existing tests passing unchanged. Second PR: the flagged change, purely additive.
- Ungateable nodes: name the restructure from `suggestions`, and that it ships separately, before the flag exists.

## Tests

Propose a test only where a contract is otherwise unobserved. Check each of these against `guards`; propose at most one test per gap:

1. **Flag off is the old behaviour.** Covered when an `existing`, unchanged test reaches the gated entry in `default` state. That test passing is the equivalence evidence. Do not duplicate it.
2. **Flag on works.** One `added` test reaching the gated entry in `on` state. A new test that reaches the entry in `default` state exercises the old path: flag it.
3. **Off after on.** Only when a gated node has `write`, `enqueue`, `serialization` or `cache_key` signals: one test that runs flag-on, then reads the result with the flag off.
4. **Boundaries.** One contract test per changed `enqueues` edge payload or changed signature with callers outside the diff.

Tests on helpers that sit entirely behind the gate are optional. Count them as coverage, never ask for more.

## The line

If the diff needs more than about five new tests to pass these four checks, the flag is too interleaved. The answer is the prep PR, not more tests.
