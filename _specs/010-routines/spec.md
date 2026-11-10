---
{
  "id": "010-routines",
  "title": "Routines on the canvas",
  "kind": "work",
  "status": "draft",
  "depends": ["002-host"],
  "updated": "2026-11-09"
}
---
# Routines on the canvas

## Outcome

The Routines screen shows every routine hobkin has, when each runs next, how its last runs went, and what it remembers. The user can run one now, pause it, and change when it runs, without opening a file.

## Decisions

- Routines are hobkin's files under `routines/{daily,weekly,monthly,once}/<id>.md`, JSON frontmatter and a prompt (`src/cli/schedules.mjs`). The screen reads them through hobkin's loader and writes them back in the same format. The folder still sets how often a routine runs.
- The screen has two views of the same data: a list grouped by recurrence, and a timeline of the next 7 days.
- A routine's detail shows its prompt, its schedule fields, its recent runs from `checks/<id>/log.md`, its working memory from `checks/<id>/memory.md`, and its latest report.
- A held routine says why it is held and until when, using hobkin's hold rules (`src/cli/holds.mjs`).
- Definition errors that hobkin's loader reports are listed at the top, each with its file.
- A running routine shows as running here and in the sidebar's agents list, and opens its live activity.
- Writing a new routine's prompt stays a conversation with hobkin. The screen offers "New routine", which starts that conversation, and hobkin's templates.

## Out of scope

- A free-form cron editor. The screen edits the fields hobkin supports.
- Editing a routine's working memory. It is the routine's own.

## Acceptance

- A1. Every routine hobkin loads appears with its title, recurrence, next run time in the routine's timezone, and state (on, off, held, running).
- A2. The timeline shows each occurrence in the next 7 days at its time, and a routine with a window shows the window.
- A3. "Run now" starts the routine through hobkin, the row turns to running within 1 second, and the finished run appears in its recent runs with its outcome.
- A4. Turning a routine off or on, or changing its time, rewrites its file in hobkin's format, and hobkin's loader accepts the file. An invalid value is refused in the form with hobkin's own error text, and the file is not written.
- A5. A held routine shows the reason and the time the hold ends.
- A6. A definition error from the loader is listed with its file path. The other routines still show.
- A7. The detail shows the last 20 runs with finish time, trigger, outcome, duration and cost, and the routine's working memory as read-only text.
- A8. With no routines, the screen shows what a routine is and one action that asks hobkin to add the first one.

## Proof

- A1. `host/test/routines.test.ts` › "lists routines with next run and state"
- A2. `ui/test/routines-timeline.test.ts` › "places occurrences in the next seven days"
- A3. `host/test/routines.test.ts` › "run now dispatches through hobkin"
- A4. `host/test/routines.test.ts` › "writes a file the loader accepts and refuses invalid values"
- A5. `host/test/routines.test.ts` › "reports a hold with its reason and end"
- A6. `host/test/routines.test.ts` › "keeps valid routines when one file is broken"
- A7. `host/test/routines.test.ts` › "reads the run log and the memory"
- A8. check: open the screen on an empty home.

## Steps

- [ ] S1 (A1, A5, A6, A7). Host: routine rows, holds, errors, log and memory as state and commands.
- [ ] S2 (A1, A2, A8). UI: the list, the timeline, the empty state.
- [ ] S3 (A3, A4). Run now, on and off, schedule edits.
- [ ] S4 (A7). The detail view.
