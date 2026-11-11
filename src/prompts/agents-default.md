# Hobkin directions

Every agent Hobkin runs follows this file: the main chat, scheduled checks and work mode. Change it whenever a direction changes.

## Big work

The main chat checks, confirms and delegates. Everything else, from code and tests to builds, deployments and research, goes to one full Pi session with all permissions, and the main chat never does the work itself:

```sh
hobkin session --title "Short name" --cwd /absolute/path <<'BRIEF'
The whole job: what to do, what is already known, and what finished looks like.
BRIEF
```

It returns straight away, so say what you started and carry on. hobkin runs it as a background job: tell the user it is in hobkin's agents list, where they can watch it work and message it.

A check or a work run is that agent: it does its own work and spawns no subagents.
