---
{
  "id": "012-reports-actions",
  "title": "Reports and action items",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host"],
  "updated": "2026-11-13"
}
---
# Reports and action items

## Outcome

Two screens for what hobkin brought back. Reports holds what finished runs found. Action items holds everything waiting on the user: questions, finished branches, steps only a person can take, and reports with a call to make.

## Decisions

- Both screens render hobkin's snapshot (`reports`, `decisions`, `waiting`) and call hobkin's actions.
- Reports has hobkin's three filters: All, Scheduled, Work done. A title filter narrows the list. A report opens beside the list as rendered Markdown.
- A report's first line carries its triage (nothing new, useful, critical, blocked). The list shows it as a tone, as the conversation does for notices.
- "Reply in chat" attaches the report to the next message, as `r` does in the terminal app.
- An action item opens the way a question does: each thing it can do is written out in words, with arrow keys to choose and Enter to pick. Number keys answer directly.
- An action item for a finished branch offers its choices and "Review", which opens Change Review.
- The top bar's Action items tab shows a count while something waits.
- Discuss (2026-11-13). Every action item and every report has one control, Discuss, in place of "Reply in chat". It takes the road a report reply already takes (`reports/reply.ts`, then `conversation.send` with `item` or `report`): the item goes on the next message as context, beside whatever is written and never over it, and the keyboard goes to the message input. It sends, answers, approves and completes nothing, the item stays open, and its words to hobkin say so. `conversation.draft` is not used, because it replaces the draft. The context names the item exactly (`actions/discuss.ts`): its kind, its id as hobkin holds it, its title, where it came from, and all its card says. A report goes by its id, and the host sends hobkin's own record of it. Keys: `r` or `m` on an item, as on a report; Right reaches it on a card, Up and Down in the open card.

### What the two screens show, and what Discuss sends for each

Action Items lists only rows that decide something here (`isActionItem`). The rows it does not list are here too, since Discuss covers them should they be listed.

| Row | From | Listed | Offers besides Discuss | Identity Discuss sends |
| --- | --- | --- | --- | --- |
| A routine's question | decision, `answerTo.kind` `routine` | yes | choices, own words, hobkin's pick and why | `Decision: <id> (routine)`, `Routine: <id>` |
| A to-do a routine found | decision, `action` | yes | the same | `Decision: <id> (action)`, `Routine: <id>` |
| hobkin asking about a routine or a template | decision, `routines` | yes | the same | `Routine:` or `Template: <id>`, `File:` |
| A work item's question | decision, `work` | yes | the same | `Project: <slug>`, `Work item: <item>` |
| A step only the user can take | decision, `yours` | yes | the same | `Project:`, `Work item:` |
| A finished branch | decision, `merge` | yes | the same, and Review | `Project:`, `Work item:`, `Branch head:`, `Review: change:<slug>:<item>` |
| What work mode starts | decision, `pickup` | yes | the same | `Queue: <keys>` |
| Any other decision (`chat`, `reminder`, `outside`, `pair`, `subscription`, none) | decision | yes | the same | `Decision: <id> (<kind>)`, `Filed for: <hobkin's record>` |
| A learning proposal | `waiting.proposals`, a six-hex id | yes | its three choices | `Learning proposal: <id>` |
| A project proposal | `waiting.asks`, kind `proposal` | yes | Take it, Skip | `Project proposal: <slug>` |
| A sample, with no host | `actions/sample.ts` | with samples | choices, answered in the window | `Decision: <id> (<kind>)` and a `Sample:` line |
| A question put off from the sheet | the question queue | with samples | its choices | `Question put off from the question sheet: <id>` |
| A step Work shows no card for | `waiting.yours` | no, one choice | Mark it done | `Project:`, `Work item:` |
| What is handled elsewhere | `waiting.wrong`, `asks`, `branches`, `yours`, `reports` | no, it opens there | opens in Reports or Work | `Report: <id>`, or `Waiting entry: <id>, handled in Work` |

Before Discuss, only the last row had a way to chat ("Reply in chat", while work mode was off), and it is no longer listed. Every report kind offers, in the reader: Discuss (was "Reply in chat"), Delete, View saved run.

| Report | `scheduleId` | Source shown | Identity Discuss sends |
| --- | --- | --- | --- |
| A routine's run | the routine's id | Routine · its id | the report id |
| Work done in a project | `work.<project>.<lane>` | Work done · the project | the report id |
| Work mode looking for projects | `work.discover` | Work mode | the report id |
| Another session | `work.session`, `session.<name>` | Another session | the report id |
| hobkin's own | none | hobkin | the report id |
| A finished agent's report, opened from its run | `completedJobReports` | as its source | the report id. hobkin finds it only while it is in hobkin's report list too |

## Out of scope

- Editing a report's text.
- Exporting reports.

## Acceptance

- A1. Reports lists hobkin's reports newest first with title, routine, time and tone. The three filters and the title filter narrow it.
- A2. Opening a report marks it read in hobkin, and the unread mark clears.
- A3. "Reply in chat" puts the report on the conversation input as an attachment, and the sent message reaches hobkin with that report.
- A4. Action items lists every waiting item with a one-line summary and its source. The tab's count equals the number of rows.
- A5. Answering an item by number, by arrows and Enter, or by typing another answer resolves it in hobkin, and it leaves the list.
- A6. A question that timed out of the conversation is listed here with the same choices.
- A7. Deleting a report removes it from the list and from the terminal app's list.
- A8. With nothing waiting, Action items says so in one line.
- A9. Every action item of every kind above, and every report, has one Discuss control where its other actions are: last on the right of an item's card, first among the open card's buttons, and in the report reader's toolbar. No item says "Nothing to answer here".
- A10. Discuss puts the item on the next message with its kind, its id as hobkin holds it, its title and where it came from: the routine, the project and work item, the branch and its review, the queue, the report. A report goes by its id. The context always fits what `conversation.send` takes.
- A11. Discuss keeps the words already written, moves the keyboard to the message input, and sends, answers, approves or completes nothing. The item stays open. The next message the user sends carries it, once.
- A12. Discuss works from the keyboard: `r` or `m` on an item's card or open card, as on a report, but not while typing in the answer field or with a modifier. Right reaches it on a card, and Up and Down in the open card.

## Proof

- A1. `ui/test/reports.test.ts` › "filters by kind and title"
- A2. `host/test/reports.test.ts` › "opening a report records the read"
- A3. `host/test/reports.test.ts` › "a reply carries its report"
- A4. `host/test/actions.test.ts` › "lists waiting items and counts them"
- A5. `host/test/actions.test.ts` › "an answer resolves the item"
- A6. `host/test/actions.test.ts` › "a timed-out question is listed"
- A7. `host/test/reports.test.ts` › "delete uses hobkin's deleted list"
- A8. check: open Action items on a home with nothing waiting.
- A9. check: open Action Items, with samples and with hobkin, and Reports. Each item's card, each open card and the report reader show Discuss.
- A10. `ui/test/actions-discuss.test.ts` › "every kind of action item is discussed by its own identity, and where it came from, as hobkin files it", "an item is discussed with everything its card says, and is told to stay open", "a context longer than hobkin's command takes is cut to fit", "a report of every kind is discussed by its own id, which hobkin looks up in its own list"
- A11. `ui/test/actions-discuss.test.ts` › "discussing an item keeps the words already written, sends nothing and answers nothing, and the next message carries it"
- A12. `ui/test/actions-discuss.test.ts` › "r, or m as on Reports, discusses the item that has the keyboard, never while typing or with a modifier"; check: Right to Discuss on a card and Up and Down to it on an open card, then Enter.

## Steps

- [ ] S1 (A1, A2, A3, A7). Reports: list, filters, reader, reply, delete. Client side built on sample data (2026-11-09, 31 UI tests). Left: recording reads in hobkin, the composer sending the report with the next message, and hobkin's deleted list.
- [ ] S2 (A4, A5, A6, A8). Action items: list, answer flows, empty state, the tab count. Client side built on sample data (2026-11-09); the menu badge counts the screen's own rows. Left: answers going back to hobkin.
- [ ] S3 (A9, A10, A11, A12). Discuss on every item and every report (2026-11-13): the context rules and the keys with tests, the controls on both screens. Left: the A9 and A12 checks in the window.
