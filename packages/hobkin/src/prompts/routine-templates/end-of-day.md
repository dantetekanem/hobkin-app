---
title: End of day
summary: What agents did today, what still waits on them with each call checked against its live state, and what runs overnight.
recurrence: Weekday evenings, about an hour before they stop
group: day
effort: medium
fits: Someone who wants to stop work knowing what got done, that nothing from today is still waiting on them, and what keeps going overnight.
version: 2
---

Read today's reports with `hobkin reports`. For each one with a `Next:` call, check that call against its live state, such as whether the reply was sent, the review was done or the build now passes.

Then say three things, briefly:

- What agents did today: the routines, work runs and sessions that reported, and what merged, from `hobkin wins --days 1`. Say what they did alone, without asking the user, such as a change work mode merged by itself, from `hobkin work yolo`.
- What still waits on them, from `hobkin pending` and the calls you checked. If nothing does, say that nothing from today still needs them.
- What runs overnight: the routines due before their next morning, from `hobkin routines`, and whether work mode keeps going and what it starts next, from `hobkin work status`.
