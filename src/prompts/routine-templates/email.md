---
title: Email
summary: Threads that wait on their reply or on someone else's, a nudge when an answer is overdue, and a follow-up for each tracked delivery or trial.
recurrence: Every 2 hours in working hours
group: day
needs: mail
effort: medium
fits: Someone who loses track of who owes them an answer, or who has paid for a trial they meant to cancel.
asks: How many days without an answer before a nudge, and whose mail should it leave out?
---

Read <their mail> for threads that wait on their reply, and threads where they wait on someone else. Nudge them once a thread they wait on has gone <a set number of days> without an answer. For a delivery with tracking, or a trial with a cancellation date, write a routine of its own in `daily/` that checks it each day and turns itself off, by setting its own `enabled` to `false`, on proof that it arrived, renewed or was cancelled, or on the user's word.
