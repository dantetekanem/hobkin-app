---
title: Review queue
summary: Pull requests that ask for their review, oldest first, and their own pull requests that have waited more than a day for a reviewer.
recurrence: Weekday mornings
goals: code
needs: gh or the CLI of their code host
effort: low
fits: Someone whose teammates wait on their reviews, or whose own pull requests sit for days without a reviewer.
tells: A pull request that asks for their review, oldest first, and one of theirs that waited more than a day for a reviewer.
gives: report
closes: The review done, a reviewer added, or the pull request closed.
asks: Which repositories should it watch?
---

Use <`gh` or the CLI of their code host> to find open pull requests in <their repositories> that ask for their review, oldest first. Then find their own open pull requests that have waited more than a day for a reviewer. Give each one's title, link and how long it has waited.
