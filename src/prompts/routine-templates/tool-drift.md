---
title: Tool drift
summary: The Pi packages and CLIs they rely on that have fallen behind upstream.
recurrence: Daily, early in the morning
group: machine
effort: low
fits: Someone who relies on Pi and a set of CLIs and wants to know when they fall behind without checking each one.
asks: Which CLIs do they rely on, and what may it update on its own?
---

Run `pi list` for the Pi packages, and find the installed version of each of <the CLIs they rely on>. Compare each with its latest upstream release, and report what is behind and the version it would move to. Update only <what they named for this routine to update>.
