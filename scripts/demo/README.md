# Demo shots for hobkin.dev

Screenshots of the real window, from made-up data, taken again with one command:

```sh
REVIEW_PICTURE=<path to the review capture> scripts/demo/shoot.sh <out folder> [commit]
```

It builds the window and the host at the commit (HEAD by default; committed code only), seeds a throwaway home and
throwaway projects under `/private/tmp/hobkin-demo`, starts a scripted host on them, opens Safari, fills the screen
with its window once, takes each shot, then quits Safari, stops what it started and removes the demo folder.
Safari must not be running when it starts: a running Safari may be the user's own, so the script stops instead.

Each shot is captured whole at the screen's own size (`<n>-<name>-full.png`) and then cut, never scaled: an 8:3 band
the page's full width (`<n>-<name>.png`) and a 4:5 phone cut (`<n>-<name>-m.png`), each also as WebP, with
`contact.html` showing all of them. The review shot is a capture the user took of the real app (`REVIEW_PICTURE`),
cut the same way.

Step by step, for trying a shot again:

```sh
scripts/demo/shoot.sh prepare            # build, seed, start the host and the page, open Safari
scripts/demo/shoot.sh shots <out> work   # one or more shots by name
node scripts/demo/capture.ts /private/tmp/hobkin-demo <out> --cut work   # cut a kept capture again
scripts/demo/shoot.sh stop               # quit Safari, stop everything, remove the demo folder
```

## What is real and what is made up

- The window is hobkin-client's own UI in a production build. `page/hook.ts`, loaded first, hands it the demo host's
  address as the Mac shell does, and lets no socket open anywhere else. The build takes the usual host's port out
  of the bundle, so the page cannot reach the user's own hobkin.
- The host is `host/src/main.ts` with the scripted model, on its own home and port, with `HOME` and `PATH` pointing at
  the demo folder: it never reads the real `~/.hobkin`, `~/.pi`, `~/.claude` or git settings. The `claude` it finds is
  a stub that reports a version and a sign-in and runs nothing.
- `seed.ts` writes the home with hobkin's own code: projects with their study notes and recent looks (so the queue
  holds their work, not looks that are due), their queues, grades, finished branches in throwaway git repositories
  (made-up author), the change reviews' grades of most of those branches through hobkin's own door for them
  (`recordGrades`), token use, memories and routine files. It then opens hobkin itself on the home with a scripted
  model whose words it supplies: the routines run and report (with the clock set back, so each report has its own
  time) and the chat has one exchange.
- `page/agents.ts` adds the agents at work: two durable hobkins (one on Claude Code) and four runs, one on each
  project, with their steps, tasks and loaded skills, in the host's own wire shapes. A scripted host runs no agent and
  no change review, so these, and the finished change review it adds to the host's answer for each change the seed
  graded (at the commit graded), are the only parts of a shot that do not come from the host.
- The Work shot is cut from the main pane only, leaving out the chat column (`bandX`, `bandW`), from the page
  scrolled inside so the project chips sit clear of the menu.
- Every project, person, path, report and memory is invented. The GitHub page is the scripted host's own sample data.
