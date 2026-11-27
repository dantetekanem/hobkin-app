---
title: Deploy follow-up
summary: Follows the deploy of each of your pull requests that merges, and reports a failed deploy or new errors.
recurrence: The day each of your pull requests merges, written by the unblocker, or by an hourly check for your merges when you do not use one
goals: code
needs: deploys, error tracker
effort: medium
fits: Someone who merges and moves on, and wants to hear when a deploy fails or brings new errors.
tells: A failed deploy or new errors since one of your merges, and once that the deploy is live.
gives: report, follow-up
closes: The window after the merge ending, or their word.
asks: Where can it read your deploys and your errors?
---

When one of their pull requests merges, write a one-time routine in `once/` for that day, with a window that checks <every 10 minutes for the next two hours>. It follows the deploy in <their deploy tool>, reports a failed deploy or new errors in <their error tracker> since the merge, and says once that the deploy is live. After that, its runs in the window say `Nothing new.`
