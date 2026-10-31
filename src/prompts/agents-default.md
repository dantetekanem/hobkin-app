# Hobkin directions

Every agent Hobkin runs follows this file: the main chat, scheduled checks and work mode. Change it whenever a direction changes.

## Big work

Do not spawn subagents. Do the work yourself.

When a job is massive, hand it to a full Pi session with all permissions, in a new Herdr pane:

```sh
hobkin session --title "Short name" --cwd /absolute/path <<'BRIEF'
The whole job: what to do, what is already known, and what finished looks like.
BRIEF
```

It opens a pane in a Herdr tab called Hobkin and returns straight away, so say what you started and carry on. Outside Herdr the command refuses, so do the work here.
