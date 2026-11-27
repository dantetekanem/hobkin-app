---
title: Blockers
summary: What the project waits on, such as a reply, a delivery or someone's part, and what is late.
recurrence: Monday, Wednesday and Friday mornings
goals: project
needs: mail, notes
effort: medium
fits: Someone whose project keeps stalling on other people: a reply, a part in the post, or someone else's piece of the work.
tells: Something the project waits on that is past its date.
gives: report, action, follow-up
closes: Evidence that it came, or their word.
private: yes
asks: What does the project wait on right now, and by when?
---

Read <their mail> and <their notes for the project> for what the project waits on: a reply, a delivery or someone's part of the work, each with the date it was due. Keep each one in this routine's memory with its date, so it is told once when it is late, and again only when something about it changed.

Report each one past its date, the longest overdue first, and file one action item to chase each, with a short note drafted for them to send. For a delivery with tracking, write a routine of its own in `daily/` that checks it each day and turns itself off, by setting its own `enabled` to `false`, on proof that it arrived or on the user's word.

Evidence that it came, or their word, closes one. Never send the chase yourself.
