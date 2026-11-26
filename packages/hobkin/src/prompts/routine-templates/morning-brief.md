---
title: Morning brief
summary: Whether today holds more than fits, today's meetings and what each needs, the reviews waiting on them, their stuck work and what is left from yesterday, on one screen.
recurrence: Weekday mornings
group: day
needs: calendar, code host
effort: medium
fits: Someone who wants one look in the morning to know what today holds, whether it fits, and what yesterday left open.
version: 2
---

Find their calendar yourself among the tools you have, such as an MCP server with calendar tools. Try the one your memory says worked first. Say in one short line which calendar you used. If you find none, say so.

Read the calendar for today's meetings and what each one needs, and <their code host> for the reviews waiting on them and their own work that is stuck. Read the notes the other routines keep, such as their memory in hobkin's `checks/` folder, for what is left from yesterday. Keep it all to one screen. End with at most two things they set aside that come due before the next brief, such as an alert they muted or a promise to look at something on a given day. On Fridays, look ahead through Monday.

Near the top, check the load in one line, such as "About 6 of 8 hours are taken (75%)." Add up:

- today's timed events, counting an overlap once, and on a work day only those inside working hours;
- the work committed to today, such as a deadline, a promise or a reminder, at your best guess of how long it takes;
- what waits on them in `hobkin pending`, about 15 minutes for each review and 5 for each decision, unless you know better.

A work day holds 8 hours. A day off work holds 4, unless their memory says what their normal day off holds. On a day off, leave out work that can wait for the next work day. At 80% or more, say the day is too full. Then name what to move, least important first, until it fits. Only suggest the moves. Never book, move, accept or decline anything in the calendar.

Before the report, write the day to `runtime/day.json` in hobkin's data folder, the part of `checkMemory.path` before `/checks/`. Do it on every run that read the calendar, even one that ends with `Nothing new.`, such as a day off. Replace the whole file with this shape:

```json
{
  "version": 1,
  "date": "2026-11-26",
  "timezone": "America/Toronto",
  "workDay": true,
  "hours": { "start": "2026-11-26T09:00:00-05:00", "end": "2026-11-26T17:00:00-05:00" },
  "events": [{ "start": "2026-11-26T10:00:00-05:00", "end": "2026-11-26T10:30:00-05:00", "withOthers": true }],
  "gaps": [{ "start": "2026-11-26T10:30:00-05:00", "end": "2026-11-26T12:00:00-05:00" }],
  "source": "the calendar you used",
  "writtenAt": "2026-11-26T07:45:00-05:00"
}
```

- `date` is today in their time zone, and every time has its offset.
- `workDay` is false on a weekend, a holiday or a day off.
- `hours` are their working hours, from their memory or calendar, and 09:00 to 17:00 when nothing says. On a day off it is `null`.
- `events` are today's timed events, never all-day ones. `withOthers` says whether anyone else is invited.
- `gaps` are the free stretches between events within `hours`.

If you could not read the calendar, leave the file as it is.
