---
title: Deploy follow-up
summary: Follows the deploy of each of their pull requests that merges, and reports a failed deploy or new errors.
recurrence: The day each of their pull requests merges, written by the unblocker, or by an hourly check for their merges when they do not use one
group: code
needs: deploys, error tracker
effort: medium
fits: Someone who merges and moves on, and wants to hear when a deploy fails or brings new errors.
asks: Where can it read their deploys and their errors?
---

When one of their pull requests merges, write a one-time routine in `once/` for that day, with a window that checks <every 10 minutes for the next two hours>. It follows the deploy in <their deploy tool>, reports a failed deploy or new errors in <their error tracker> since the merge, and says once that the deploy is live. After that, its runs in the window say `Nothing new.`
