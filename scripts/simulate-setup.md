# Walk the setup as a new Mac

The scripted host can show the first-run setup a Mac with nothing installed and no model connected, so the whole
setup can be walked in a browser without a download, an install or a real sign-in. With the development UI running
(`pnpm dev`, on port 5187), start a host on a new folder:

```sh
node host/src/main.ts --dev --home <a new folder> --port 5199 --origin http://localhost:5187 --simulate-new-mac
```

Then open http://localhost:5187/?host=5199&setup=1.

What the setup finds:

- No Node with npm, no Pi and none of its packages. The Pi step offers hobkin's own Node first, then Pi, then each
  package.
- Apple's git stand-in without the command line tools, and no gh, qmd or TLA+ tools.
- Claude Code is not installed. As on a real Mac, its row in the review shows only once Claude Code is turned on in
  Settings.
- No model is connected. The setup's sign-in connects the OpenAI subscription a moment later, with no page and no
  question. hobkin's first models are then picked from it and kept with the pretend Mac, so the account step says
  what it picked, while the home's config and Settings keep the models as Pi picks them.

Each install and each program sign-in takes 1 to 3 seconds, and the next read, Look again included, finds what it
brought. The setup's own readers and installers run on pretend programs, so an install out of order is refused as on a
real Mac: Pi before Node says npm is missing. gh's sign-in shows the code `SIMU-LATE`, and both sign-in pages are on a
`.invalid` name that never loads. The answer to the usage question is kept in the home's `client/setup.json`, and
nothing is sent.

Nothing runs a program, reaches the network, opens a page or writes outside the home. The pretend Mac lives in memory:
a restarted host starts it empty again, while the home keeps what the setup saved. To start over, stop the host and use
another new folder. The flag works with the scripted model only, and the host refuses `--live` and the real hobkin
home.

Still real: the projects step lists the folders named in it on this Mac, by name only, the folder chooser is the Mac's
own, and a link opens in the browser.

The code is `host/src/simulate-new-mac.ts`, and spec `025-onboarding` (A77) says what it does.
