# Routine templates

Each file here is one routine that setup can offer. The app's setup asks what the person is working toward and shows each goal's templates as cards, and the setup guide matches what they said against each template's `fits`. Both read the list from `hobkin routines templates`. To add one, add a file. Nothing else lists them.

## A template

The file name is the template's name: lowercase words joined by hyphens, such as `deadlines-ahead.md`. It starts with a header between two `---` lines, one `key: value` per line, then the body:

```markdown
---
title: Deadlines ahead
summary: Appointments, bills and renewals coming up, each warned once a week ahead and once the day before.
recurrence: Daily, early in the morning
goals: life, project
needs: calendar, mail
effort: low
fits: Someone who has missed a bill, a renewal or an appointment because it crept up on them.
tells: A dated commitment 7 days away, and again the day before.
gives: report
closes: The date passing, or their word.
private: yes
---

Read <their calendar> and <their mail> for appointments, bills, renewals and other dated commitments in the next 8 days.
```

- `title`, `summary`, `recurrence`, `fits`, `goals`, `tells`, `gives` and `closes` are required here. A template of your own needs only the first four.
- `goals` lists the goals it serves, separated by commas, the best first: `job`, `business`, `project`, `life` or `code`. Setup shows it as a card under the first goal the person picked that it names. A template of your own that has the older `group` and no `goals` still reads: `day`, `week` and `life` count as `life`, and `code` and `machine` as `code`. One with neither is under no goal, and still listed.
- `needs` lists the tools or sources it needs, separated by commas. Setup offers to connect what is missing.
- `effort` is `low`, `medium` or `high`, and `medium` when left out.
- `fits` says who it suits, in the words a person would use about their own life, because that is what setup matches.
- `tells` is its bar: what is worth telling.
- `skips` is what it leaves out unless the person says otherwise. Leave it out when it leaves nothing out by itself.
- `gives` lists what the person gets, separated by commas: `report`, `action` for an Action Item, `critical` for a critical alert, and `follow-up` for a routine of its own that it writes, such as one for a delivery.
- `closes` says what closes an item, such as a reply in the thread or their word.
- `private: yes` marks one that reads the person's own accounts, such as their mail, money, calendar or health. On a work computer, its card says so. Leave it out otherwise.
- `asks` is what setup has to ask before it writes the routine, such as whose birthdays to keep. Leave it out when the answers before are enough.
- `version` is a whole number, and `1` when left out. Raise it when a template here changes in a way a routine made from the old one should get, and after the next update hobkin tells the user which templates are new or newer. A change to the header alone leaves the body as it is, so it does not raise the version.

The body is the draft of the routine's instructions, for an agent that has seen nothing of setup: what to read, what to report and what to leave alone. A routine that watches something keeps what it already told in its memory, so nothing unchanged is told twice. Put what setup fills in for the person in angle brackets, such as `<their calendar>`. Leave out what `RULES.md` already says, because setup adds those rules to every routine made from a template.

## Your own

Put templates of your own in `routines/templates/` in your hobkin data folder, in the same format. One named like a template here replaces it. `hobkin routines templates` lists both, and names any file it cannot read and why.
