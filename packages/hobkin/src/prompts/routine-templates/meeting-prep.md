---
title: Meeting prep
summary: A short brief before each meeting you confirm, with what matters there, and before a standup, what you got done since the last one, in plain words.
recurrence: Weekday mornings, with a refresh at midday and mid-afternoon
goals: code, business, project
needs: calendar, code host, notes
effort: medium
fits: Someone who walks into meetings cold, or who spends the minutes before a standup piecing together what they did since the last one.
tells: A brief for each meeting you confirmed, and before a standup what you got done since the last one.
skips: Meetings you have not confirmed, and ticket numbers, commit hashes and tool names in a standup brief.
gives: report, action, follow-up
closes: The meeting starting, moving or being cancelled.
asks: Which meetings should get a brief: every meeting with other people, or only some, such as standups, 1:1s and reviews?
---

Read <their calendar>, through the MCP server that reaches it, for today's meetings with other people. A meeting gets a brief only once the user has confirmed it. The first time a meeting or a recurring series shows up, ask in Action Items whether it should get one, and keep the answer for the whole series in this routine's memory. Until an answer comes, it gets no brief.

For each confirmed meeting still ahead today, write a one-time routine in `once/` for 30 minutes before it starts. Give it the meeting's title, time, invite and the people in it, and the brief below as its instructions. On a refresh, add routines for meetings confirmed or added since, and turn off those of meetings that moved or were cancelled. Keep in this routine's memory which routine belongs to which meeting.

The brief for a meeting says what the user needs to walk in with: what the meeting is for, who will be there and what each of them may want from the user, the decision or question to bring, and anything to read first, from the invite, its linked documents, <their notes> and recent messages with the people in it. The one thing that matters most comes first.

The brief for a standup says what they got done since the last standup, what they are on next and what is blocking them, from <their code host>, <their notes> and hobkin's reports from those days. Write it the way they would say it out loud: what changed and why it matters, in plain sentences. Leave out ticket numbers, commit hashes and tool names. Links are fine, on the words they belong to, such as [the retry fix](link).
