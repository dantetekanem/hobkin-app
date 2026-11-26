# Routine templates

Each file here is one routine that `/setup` can offer. Setup asks the user about their work, their life and what they want to keep on top of, runs `hobkin routines templates`, and offers the templates whose `fits` match what they said. To add one, add a file. Nothing else lists them.

## A template

The file name is the template's name: lowercase words joined by hyphens, such as `deadlines-ahead.md`. It starts with a header between two `---` lines, one `key: value` per line, then the body:

```markdown
---
title: Deadlines ahead
summary: Appointments, bills and renewals coming up, each warned once a week ahead and once the day before.
recurrence: Daily, early in the morning
group: day
needs: calendar, mail
effort: low
fits: Someone who has missed a bill, a renewal or an appointment because it crept up on them.
---

Read <their calendar> and <their mail> for appointments, bills, renewals and other dated commitments in the next 8 days.
```

- `title`, `summary`, `recurrence`, `group` and `fits` are required. `group` is one of `day`, `code`, `week`, `life` or `machine`.
- `needs` lists the tools or sources it needs, separated by commas. Setup offers to connect what is missing.
- `effort` is `low`, `medium` or `high`, and `medium` when left out.
- `fits` says who it suits or which goal it serves, in the words a person would use about their own life, because that is what setup matches.
- `asks` is what setup has to ask before it writes the routine, such as whose birthdays to keep. Leave it out when the answers before are enough.
- `version` is a whole number, and `1` when left out. Raise it when a template here changes in a way a routine made from the old one should get, and after the next update hobkin tells the user which templates are new or newer.

The body is the draft of the routine's instructions, for an agent that has seen nothing of setup: what to read, what to report and what to leave alone. Put what setup fills in for the person in angle brackets, such as `<their calendar>`. Leave out what `RULES.md` already says, because setup adds those rules to every routine made from a template.

## Your own

Put templates of your own in `routines/templates/` in your hobkin data folder, in the same format. One named like a template here replaces it. `hobkin routines templates` lists both, and names any file it cannot read and why.
