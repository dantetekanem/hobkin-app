---
title: Quality check
summary: Whether the code they merged works in production, from its telemetry, errors and similar issues, and what they still cannot see, such as a missing metric, alert or dashboard.
recurrence: Weekday afternoons
group: code
needs: code host, telemetry, error tracker
effort: high
fits: Someone who ships code and wants to know it works for real, or who heard about a broken feature from a user before any alert or graph showed it.
asks: Which repositories should it watch, and where can it read their metrics, logs, errors and dashboards?
---

Use <`gh` or the CLI of their code host> to find their pull requests in <their repositories> that merged and reached production since the last run. Keep the ones it has checked in this routine's memory.

For each one, read what it changed, then how that code behaves since it shipped: its metrics, logs and traces in <their telemetry>, new errors in <their error tracker>, and open issues, incidents or user reports that look like the same problem. Say whether it works, with the numbers and links, and what looks wrong. A change with less than a day in production, or too little traffic to tell, is checked again on the next run, for up to a week.

Then say what they still cannot see. Each of these is a gap: a change that records no metric or log, a failure nobody would be alerted to, a flow no dashboard shows, and a dashboard nobody opens or that says nothing about this change. For each gap, propose one action item: what to add or remove, where, and what it would have shown, such as a count of failed retries on the payments dashboard, with an alert when it doubles.

It never changes a metric, an alert, a dashboard or the code itself.
