# Routine ideas

These are checks that work well for an engineer's day. Offer them when the user is not sure what to set up: show the groups with one line per idea, numbered, and let them pick by number or name. Two or three are enough to start.

Each idea says what it reports, when it works best and what it needs. Check that their tools reach those sources before you offer it, and say plainly when one needs something they do not have. Then write it for their own tools, folders and hours.

## Rules every idea keeps

Write these into each routine you make from this list:

- It reads and reports. It may draft what the user could send, but it never posts, sends, comments, pushes or changes a calendar unless the user names that exact action for that routine.
- It reports only what is theirs: what mentions them, what they own and what they are responsible for. Being on the same team is not enough, and a bot's message counts only when a person joins in.
- It lists at most three things to do, starting with the one where others are waiting on the user.
- On a day the calendar shows them out of office or on holiday, it reports `Nothing new.` with one line saying why.

## Your day

1. Morning brief. Weekday mornings. Today's meetings and what each needs, the reviews waiting on them, their own work that is stuck and what is left from yesterday, on one screen. It ends with at most two things they set aside that come due before the next brief, such as an alert they muted or a promise to look at something on a given day. On Fridays it looks through Monday. Needs a calendar and their code host, and it reads the notes the other checks keep.
2. Meetings. Weekday mornings, with a refresh at midday and mid-afternoon. Today's meetings, what each one needs and any clashes. For each meeting with other people, it writes a one-time check for 15 minutes after the meeting ends, which gathers the notes and action items. A refresh adds checks for new meetings and turns off the checks of meetings that moved or were cancelled. Needs a calendar, and for the follow-ups, wherever their meeting notes land.
3. Messages waiting on them. Every 30 minutes in working hours. Mentions, direct messages and threads that wait on their reply, and mail threads that wait on them or on someone else. Needs a tool that reaches their chat or their mail.
4. End of day. Weekday evenings, about an hour before they stop. It takes today's `Critical:` and `Useful:` reports from `hobkin reports`, checks each one against its live state, and says either that nothing from today needs them or what is still open.

## Your code

5. Review queue. Weekday mornings. Pull requests that ask for their review, oldest first, and their own pull requests that have waited more than a day for a reviewer. Needs `gh`, or the CLI of their code host.
6. Unblocker. Hourly in working hours. Where their work is stuck: failing CI, a conflict, changes requested, a review that has waited too long, or a pull request that is ready but not merged. One line for each, with the one move that unblocks it. Needs the same as the review queue.
7. Deploy follow-up. When one of their pull requests merges, the unblocker writes a one-time check that follows the deploy until it is live and reports a failed deploy or new errors. Needs a tool that reads their deploys and errors.
8. Dependency watch. Weekly. Outdated or vulnerable packages in a project, and the upgrade that fixes each one.

## Your week

9. Weekly plan. The first working day of the week. Three outcomes for the week, how full the calendar is and what carries over from last week. It needs their answers, so inside Herdr it opens a Pi session with `hobkin session --keep` where they talk it through. Without Herdr, it reports a draft plan instead.
10. Weekly review. The last working day of the week. What shipped, what they unblocked and what slipped, built from the week's reports and notes.
11. Wins. Friday afternoon, before the weekly review. It adds the week's wins to a notes file, each with a link that proves it, so the list is ready for their next performance review.
12. Agent sessions. Weekly. The week's Pi sessions in `~/.pi/agent/sessions`: requests they keep repeating, errors that keep coming back and tools that are slow. It proposes a skill, a routine or a setting for each pattern, and changes nothing.

## Your machine

13. Disk space. Daily, early in the morning. What takes space, such as caches, build output and old worktrees. It removes only what can be rebuilt, such as a worktree whose branch is merged and has no local changes, and reports the rest.
14. Tool drift. Daily, early in the morning. The Pi packages that `pi list` shows and the CLIs they rely on, compared with upstream. It reports what is behind and updates only what the user named in the routine.
