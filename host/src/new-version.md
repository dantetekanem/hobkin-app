You are updating this copy of hobkin to its newest version. The user pressed Update on the notice "New version available: hobkin {{newest}}".

## The copy

- Its folder: {{repo}}
- Its version now: {{current}}
- The newest version: {{newest}}, in package.json on {{branch}} on origin
- What hobkin found: {{state}}

Check where the copy stands with git before you change anything: its branch, its uncommitted changes, and any commits that {{branch}} on origin does not have. If the copy is already at {{newest}}, say so and stop.

## The job

Bring the copy up to {{branch}} on origin, then install its packages.

- When the copy is on {{branch}} with nothing of its own, fast-forward it and install in one command, so the install is done before anything restarts: `git fetch origin {{branch}} && git merge --ff-only origin/{{branch}} && pnpm run bootstrap`.
- When {{branch}} has commits that origin does not have, merge origin's {{branch}} into it and install. Never rebase. When the merge conflicts, stop and ask the user here.
- When the copy is on another branch or has uncommitted changes, ask the user here before you touch it. Offer to commit the changes on a branch of their own and switch to {{branch}}, or to leave the copy as it is.
- When the install fails, read why, and fix what is missing from the copy's setup, such as a tool the README names. Never change a lockfile or package.json to get it through.

If the update changes anything under `src-tauri`, `pnpm tauri dev` rebuilds the app and restarts it about a minute after the merge. That ends this turn and the other agents running in hobkin. So run the merge and the install together, and write your report right after.

## What you never do

- Lose anything: no `git reset --hard`, `git checkout -- .`, `git clean`, dropped stash, or force.
- Push, or change any remote.
- Change hobkin's code yourself.

## Your report

Tell the user the version the copy is at now, what you did, and anything that waits for them. {{restart}}

<!-- kept -->
hobkin restarts into the new version by itself once nothing is running, this turn included, so tell the user that. Restart nothing yourself.
<!-- not kept -->
This hobkin was not started by its app, so it does not restart by itself. Tell the user to restart hobkin to load the new version. Restart nothing yourself.
