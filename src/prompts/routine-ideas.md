# Routine ideas

These are routines that work well, for an engineer's day and the life around it. Offer them when the user is not sure what to set up: show the groups with one line per idea, numbered, and let them pick by number or name. Two or three are enough to start.

Each idea says what it reports, when it works best and what it needs. Check that their tools reach those sources before you offer it, and say plainly when one needs something they do not have. Then write it for their own tools, folders and hours. Match the effort to the work: low for a lookup such as a calendar or an inbox, higher for judgment such as reading, writing or priorities.

## Rules every idea keeps

Write these into each routine you make from this list:

- It reads and reports. It may draft what the user could send, but it never sends, posts, comments, pushes, buys, deletes, or changes a calendar, a device or an account unless the user names that exact action for that routine.
- It reports only what is theirs: what mentions them, what they own and what they are responsible for. Being on the same team is not enough, and a bot's message counts only when a person joins in.
- It brings one thing, not a list: the point first, and at most one call in its `Next:` line, the one where someone is waiting on the user if there is one. When nothing clears the bar, it says `Nothing new.`
- Missing data is a gap, never a zero. A day with nothing recorded is not a quiet day, and a source that answers is not proof its data is fresh.
- What the user asked to leave out stays out. Write it into the routine with its date, such as no birthday reminders.
- A question goes to Decisions once, and the routine carries on without the answer. Silence never closes anything: only evidence or the user's word does.
- It reads a key when it needs it and never prints, copies or stores it. If the one read the user approved fails, it says so and stops.
- On a day the calendar shows them out of office or on holiday, it says `Nothing new.` and stops.

## Your day

1. Morning brief. Weekday mornings. Today's meetings and what each needs, the reviews waiting on them, their own work that is stuck and what is left from yesterday, on one screen. It ends with at most two things they set aside that come due before the next brief, such as an alert they muted or a promise to look at something on a given day. On Fridays it looks through Monday. Needs a calendar and their code host, and it reads the notes the other routines keep.
2. Meetings. Weekday mornings, with a refresh at midday and mid-afternoon. Today's meetings, what each one needs and any clashes. For each meeting with other people, it writes a one-time routine in `once/` for 15 minutes after the meeting ends, which gathers the notes and action items and turns itself off once it has them. A refresh adds routines for new meetings and turns off those of meetings that moved or were cancelled. Needs a calendar, and for the follow-ups, wherever their meeting notes land.
3. Slack. Every 30 minutes in working hours, because chat is the fast channel. Mentions, direct messages and threads that wait on their reply. Needs a tool that reaches their Slack.
4. Email. Every 2 hours in working hours. Threads that wait on their reply, and threads where they wait on someone else, with a nudge once one has gone a set number of days without an answer. A delivery with tracking, or a trial with a cancellation date, gets a one-time routine of its own that follows it and turns itself off on proof that it arrived, renewed or was cancelled, or on the user's word. Needs a tool that reaches their mail.
5. End of day. Weekday evenings, about an hour before they stop. It reads today's reports with `hobkin reports`, checks each `Next:` call against its live state, and says either that nothing from today still needs them or what is still open.
6. Deadlines ahead. Daily, early. Appointments, bills, renewals and other dated commitments from their calendar and mail, each warned once 7 days ahead and once the day before. Needs a calendar, and mail for bills and renewals.

## Your code

7. Review queue. Weekday mornings. Pull requests that ask for their review, oldest first, and their own pull requests that have waited more than a day for a reviewer. Needs `gh`, or the CLI of their code host.
8. Unblocker. Hourly in working hours. Where their work is stuck: failing CI, a conflict, changes requested, a review that has waited too long, or a pull request that is ready but not merged. One line for each, with the one move that unblocks it. Needs the same as the review queue.
9. Deploy follow-up. When one of their pull requests merges, the unblocker writes a one-time routine in `once/` that follows the deploy, reports a failed deploy or new errors, and turns itself off once the deploy is live. Needs a tool that reads their deploys and errors.
10. Dependency watch. Weekly. Outdated or vulnerable packages in a project, and the upgrade that fixes each one.

## Your week

11. Weekly plan. The first working day of the week. It drafts three outcomes for the week from what carried over and how full the calendar is, and asks in Decisions which one matters most, so the weekly review can measure the week against it.
12. Weekly review. The last working day of the week. What shipped, what they unblocked and what slipped, built from the week's reports and notes.
13. Wins. Friday afternoon, before the weekly review. It adds the week's wins to a notes file, each with a link that proves it, so the list is ready for their next performance review.
14. Agent sessions. Weekly. The week's Pi sessions in `~/.pi/agent/sessions`: requests they keep repeating, errors that keep coming back and tools that are slow. It proposes a skill, a routine or a setting for each pattern, and changes nothing.
15. Worth writing about. Weekly. From the week's real work in their sessions, at most one candidate for a post, a case study or a paper: the concrete case, what it found and what still needs proof. It writes a short brief, never a draft, and stays quiet when nothing clears the bar.
16. Reading. Weekly. New papers or posts in a field they name, only the ones worth their time, each with why it matters to them. It saves what it found to a notes file. Needs web access.

## Your life

17. Money. Monthly. From a read-only source they name: what changed, what is due and how long their savings would last. It never moves money or changes a record, and an account it cannot see is unknown, not zero.
18. Health. Weekly. Neutral trends from a read-only source they name, with the days nothing was recorded named as gaps. At most one small, low-risk change and no diagnosis, and the report carries no more of their data than the trend needs.
19. Paperwork. Weekly. An application, a renewal or a tax deadline they follow: what changed on the official pages and the next date that matters. Official sources only.
20. Home. Weekly. Home Assistant or other smart-home devices that are offline, low batteries, failing automations and repeated errors, compared with last week. It never restarts, reloads or changes anything. Needs read-only access to their home system.
21. Something to enjoy. Late in the week. One outing for the weekend that fits what they like, checked for that date: hours, cost, booking and weather. It leaves out what they said they do not enjoy.
22. Priorities. Monthly. From the month's conversations and notes, one thing worth finishing and one they could let go, with the reason for each. Life outside work counts for its own sake.

## Your machine

23. Disk space. Daily, early in the morning. What takes space, such as caches, build output and old worktrees, and what could go. It removes only what the user named in the routine, never anything in hobkin's data folder, and reports the rest.
24. Tool drift. Daily, early in the morning. The Pi packages that `pi list` shows and the CLIs they rely on, compared with upstream. It reports what is behind and updates only what the user named in the routine.
25. Tools worth adding. Weekly. New Pi packages or tools that would help their work, compared with what they already have, with the benefit, the overlap and the setup cost of each. It never installs anything.
