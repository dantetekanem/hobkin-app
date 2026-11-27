---
title: Unblocker
summary: Where your own pull requests are stuck, one line each, with the one move that unblocks it.
recurrence: Hourly in working hours
goals: code
needs: the gh CLI or your code host's own
effort: medium
fits: Someone with several pull requests open at once who loses time finding out which one is stuck and why.
tells: Where one of your pull requests is stuck, with the one move that unblocks it.
gives: report
closes: The pull request merged or closed, or the move done.
asks: Which repositories should it watch, and how long can a review wait before it counts as stuck?
---

Use <`gh` or the CLI of their code host> to find where their own work in <their repositories> is stuck: failing CI, a conflict, changes requested, a review they asked for that has waited more than <how long is too long>, or a pull request that is ready but not merged. Give one line for each, with the one move that unblocks it, such as the test to fix or the reviewer to ask.
