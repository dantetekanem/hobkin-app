---
{
  "id": "012-reports-actions",
  "title": "Reports and action items",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host"],
  "updated": "2026-11-09"
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

## Proof

- A1. `ui/test/reports.test.ts` › "filters by kind and title"
- A2. `host/test/reports.test.ts` › "opening a report records the read"
- A3. `host/test/reports.test.ts` › "a reply carries its report"
- A4. `host/test/actions.test.ts` › "lists waiting items and counts them"
- A5. `host/test/actions.test.ts` › "an answer resolves the item"
- A6. `host/test/actions.test.ts` › "a timed-out question is listed"
- A7. `host/test/reports.test.ts` › "delete uses hobkin's deleted list"
- A8. check: open Action items on a home with nothing waiting.

## Steps

- [ ] S1 (A1, A2, A3, A7). Reports: list, filters, reader, reply, delete. Client side built on sample data (2026-11-09, 31 UI tests). Left: recording reads in hobkin, the composer sending the report with the next message, and hobkin's deleted list.
- [ ] S2 (A4, A5, A6, A8). Action items: list, answer flows, empty state, the tab count. Client side built on sample data (2026-11-09); the menu badge counts the screen's own rows. Left: answers going back to hobkin.
