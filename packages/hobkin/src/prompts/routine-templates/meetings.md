---
title: Meetings
summary: Today's meetings, what each one needs and any clashes, and after each meeting with other people, its notes and action items.
recurrence: Weekday mornings, with a refresh at midday and mid-afternoon
goals: business, code, project
needs: calendar, meeting notes
effort: medium
fits: Someone whose day runs on meetings and who wants to walk into each one ready and come out with the action items written down.
tells: What each of today's meetings needs and any clashes, and after each meeting with others, its notes and action items.
gives: report, follow-up
closes: The meeting ending with its notes gathered, or moving or being cancelled.
asks: Where do your meeting notes land after a meeting?
version: 2
---

Read <their calendar> for today's meetings. Report what each one needs, such as a document to read or a decision to bring, and any clashes. For each meeting with other people, write a one-time routine in `once/` for 15 minutes after it ends, which gathers the notes and action items from <where their meeting notes land>. On a refresh later in the day, add routines for new meetings and turn off those of meetings that moved or were cancelled. Keep in this routine's memory which follow-up belongs to which meeting.

Each time you read the calendar, on the first run and on each refresh, write the day to `runtime/day.json` in hobkin's data folder, the part of `checkMemory.path` before `/checks/`. Replace the whole file with this shape:

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
  "writtenAt": "2026-11-26T12:00:00-05:00"
}
```

- `date` is today in their time zone, and every time has its offset.
- `workDay` is false on a weekend, a holiday or a day off.
- `hours` are their working hours, from their memory or calendar, and 09:00 to 17:00 when nothing says. On a day off it is `null`. When the file is already today's, keep its `workDay` and `hours` unless the calendar shows they changed.
- `events` are today's timed events, never all-day ones. `withOthers` says whether anyone else is invited.
- `gaps` are the free stretches between events within `hours`.

If you could not read the calendar, leave the file as it is.
