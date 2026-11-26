---
title: Weekly review
summary: What shipped, what they unblocked and what slipped this week, the days that were too full, how much deciding the week took, and what to approve or stop.
recurrence: The last working day of the week
group: week
effort: high
fits: Someone who ends the week unsure what they actually got done, or who has to report on it.
version: 2
---

Read this week's reports with `hobkin reports` and <their notes>. Say what shipped, what they unblocked and what slipped, each with the report or link that shows it. If the weekly plan named the outcome that matters most this week, start with how the week went against it.

Then add the parts below. Run each `hobkin` command with `--home` set to hobkin's data folder, the part of `checkMemory.path` before `/checks/`.

- Days that were too full. Find the morning brief in `hobkin routines`, and read its reports from this week in `hobkin reports` by that `routineId`. Each has a load line, such as "About 6 of 8 hours are taken (75%).", and a day at 80% or more was too full. Name each such day with its line. A day with no brief is unknown, not a day that fit.
- Decision load. From `hobkin telemetry questions --days 7`, the questions each day, in total and how many hobkin settled itself (`ended.settled`). From `hobkin telemetry interruptions --days 7`, the interruptions each day. From `hobkin telemetry presence --days 7`, when they were on. Questions should fall, so say whether they did against last week, from this routine's memory or `--days 14`. Keep this week's total in memory. Add the repeats from the same view's `repeats`. From the `scoreboard` in `hobkin telemetry --days 7`, give `answers.under3s` of `answers.total`: answers that fast may be rubber stamps.
- Autonomy moves to approve. From `hobkin telemetry autonomy`, each task class with `promotionDue`, with its level and clean streak. hobkin files the card for each, so file none. Its `overrides` and `undos` are totals, so give each class's change since the counts you kept in memory last week, and keep this week's.
- Outward actions that would have been blocked. From `hobkin telemetry outward --days 7`, how many of each kind. This should be zero, so any count gets a line.
- Routines to stop. hobkin's open items in `hobkin decisions` that offer to turn a routine off, and the routines marked `ignored` in `runtime/report-attention.json` in the data folder. Name each routine once, with how many of its latest reports were opened (`read` of `reports`).

`hobkin telemetry help` lists the views this hobkin has. When `autonomy` or `outward` is not among them yet, leave that part out and do not mention it. Do the same when the questions view has no `repeats` field yet.

Change nothing. Do not turn a routine off, move a task class or answer an item. The user decides those in Action Items.

Lead with the point and keep the report to about 100 words. Put the numbers behind it in `<details><summary>The numbers</summary>…</details>`.

Last, ask one question. Pipe this to the `decide` command in your request, with this week's ISO week in the key. The key keeps it to once a week.

```json
{
  "key": "decision-load:2026-W48",
  "kind": "decision-load",
  "question": "How heavy did deciding feel this week?",
  "tldr": "How heavy was deciding this week?",
  "choices": [
    { "value": "very-light", "label": "Very light" },
    { "value": "light", "label": "Light" },
    { "value": "fine", "label": "Fine" },
    { "value": "heavy", "label": "Heavy" },
    { "value": "very-heavy", "label": "Very heavy" }
  ],
  "why": "Only the user knows how the week felt."
}
```
