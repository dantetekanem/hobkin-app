---
name: rule-promote
description: After a review closes, record how its levels held up and turn findings that keep recurring into deterministic rules, so the next review gets them without a model call. Use once a reviewed change has merged, been reverted or caused an incident, or on a schedule over the review log.
compatibility: Requires the assessed graph.json files of past reviews and write access to .review-cache/review-log.jsonl and the change-review skill directory.
---

# Rule promote

Two jobs: keep score, and move work from the model to the config.

## Keep score

Append one line per assessed node to `.review-cache/review-log.jsonl` when the change's fate is known:

```json
{"review":"<head sha>","node":"<symbol>","floor":"high","final":"high","critical":true,"rules":["rounding-mode-change"],"outcome":"merged-clean|fixed-before-merge|reverted|incident","suggestion_taken":"add-flag|null"}
```

`outcome` comes from the repository and incident tracker, not from judgment. If it is unknown, do not write the line.

## Promote

Count `rules` across the log. A rule is a candidate when the same slug appears in 2 or more reviews and at least one was `fixed-before-merge`, `reverted` or `incident`.

For each candidate, pick the cheapest form that would have caught it:

1. **A signal pattern** in `../change-review/tools/review.config.json` (`signals`, `ungateable`, `migration`). Use when the finding is recognizable on the changed line itself.
2. **A floor rule or deterministic finding** in `../change-review/tools/review-graph.mjs`. Use when it depends on graph shape: gate state, guards, edge types.
3. **A checklist line** in `../change-review/reference/checklist.md`. Use only when it needs reading the code. This is the fallback, because it still costs a model call.

Propose the change as a diff with the reviews that motivate it. Do not apply it unreviewed: a wrong floor rule mis-levels every later review.

## Demote

A deterministic finding that fired 5 or more times with outcome `merged-clean` and was never acted on is noise. Propose lowering its severity or removing it. A floor that `risk-level` lowered with evidence in most reviews is too high: propose narrowing the rule.

## Recalibrate time

`.review/progress.jsonl` of each review holds measured seconds per step beside the estimate. When a step is off by more than 2x across 5 reviews, propose new numbers for `../change-review/reference/budget.md`.

## Report

One table: rule, times seen, outcomes, proposed form. Then the diffs.
