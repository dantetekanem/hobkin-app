# Prototype: not the specification

`review-graph.mjs` is a script from an earlier version of this design. It turns the `pack.json` of `agentic-search scan` into a graph and applies risk events. It was run on three small fixtures.

It is kept as a reference for two things an implementer may reuse:

- `gateRegions`: finding which lines sit on which branch of a condition (line-and-indent based; an approximation of what a syntax tree gives exactly).
- The propagation of tests across call edges, where a test crosses a condition's branch only in a matching state.

Do not copy its level logic. It predates `FOUNDATION.md` and differs from it in ways that matter:

- Its floor is keyed on whether a change is behind a flag. The specification keys it on four facts, with proof first.
- It has no notion of a life cycle test or of coverage. It links tests by name only.
- Its example outputs (`graph.json`, `graph.assessed.json`, `risk-events.jsonl`) use that older model.
