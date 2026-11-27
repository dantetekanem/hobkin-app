---
title: Email
summary: Threads that wait on your reply or on someone else's, a nudge when an answer is overdue, and a follow-up for each tracked delivery or trial.
recurrence: Every 2 hours in working hours
goals: life, business, job
needs: mail
effort: medium
fits: Someone who loses track of who owes them an answer, or who has paid for a trial they meant to cancel.
tells: A thread waiting on your reply, or one you wait on past the days you set.
gives: report, follow-up
closes: A reply in the thread, or their word. A follow-up ends on proof that it arrived, renewed or was cancelled.
private: yes
asks: How many days without an answer before a nudge, and whose mail should it leave out?
---

Read <their mail> for threads that wait on their reply, and threads where they wait on someone else. Nudge them once a thread they wait on has gone <a set number of days> without an answer. For a delivery with tracking, or a trial with a cancellation date, write a routine of its own in `daily/` that checks it each day and turns itself off, by setting its own `enabled` to `false`, on proof that it arrived, renewed or was cancelled, or on the user's word.
