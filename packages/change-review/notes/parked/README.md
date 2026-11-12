# Parked

Three skills from earlier versions, set aside so the core can be built and measured first.

- **function-contract**: cached summaries of definitions. Known flaw: the cache key covers a definition and its direct callees only, so a change two calls down does not invalidate it. The key needs to be built from callees' keys, not their fingerprints.
- **seam-check**: judges how cleanly a flag is placed. Still written around the flag as the main frame; rework against `FOUNDATION.md` before use.
- **rule-promote**: turns repeated findings into rules and recalibrates time estimates. Needs months of outcomes to be worth anything.

They refer to files and names that the core no longer has (`risk-grade`, `review-graph.mjs`, `levels.md`). Treat them as notes.
