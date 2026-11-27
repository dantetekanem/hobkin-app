---
{
  "id": "077-new-version",
  "title": "A copy run from git hears of a new version and updates itself",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "016-packaging"],
  "updated": "2026-11-27"
}
---
# A copy run from git hears of a new version and updates itself

## Outcome

hobkin knows which version it is and the newest version on GitHub. When a new one is out, the window says "New version available: hobkin 0.2.4", with an Update button. Update brings the copy up to that version, installs its packages, and hobkin restarts into it once nothing is running. A copy that Update can't move safely says why, and is left alone. hobkin's own agent can read the same status, so it can answer when the user asks whether it is up to date.

## Decisions

- The user, 2026-11-27: "we need a system to track versions of hobkin, if you are outdated, to update your system", and "new version available".
- This is for a copy run from its git repository, which is how the README installs hobkin (`pnpm tauri dev`). A release build already updates itself from GitHub's latest release (`src-tauri/src/updates.rs`, 016-packaging), and its host is not a git checkout, so it never looks here.
- A new version is a higher `version` in the app's `package.json` on the default branch of the copy's `origin`. A merge without a version bump is not a new version, so the notice does not show after every merge (the user's yes to that pick, 2026-11-27). Versions compare as numbers, so 0.2.10 is newer than 0.2.9.
- The host looks with `git fetch` of that one branch and reads its `package.json` with `git show`. That changes nothing in the copy's files. A look that worked holds for six hours, as the release build's updater waits. One that failed holds for half an hour. Update always makes a fresh look. Only a live host looks, so tests and throwaway homes never reach the network.
- The default branch is the one `origin/HEAD` names, or `main` when the copy has no `origin/HEAD`.
- Update needs the copy on that branch, with no uncommitted changes to tracked files, and with no commits GitHub lacks. Otherwise it changes nothing and says which of the three it is. Git refuses on its own if an untracked file is in the way.
- Update fast-forwards with `git merge --ff-only`, then runs `pnpm run bootstrap`, which installs `packages/hobkin` and the app from their lockfiles. If the install fails, the copy is already at the new version, and the error says so, with the install's last lines and the command to run by hand.
- Nothing restarts an agent's work for this. The host already restarts itself onto newer code on disk once nothing runs (`host/src/code-age.ts`). The window's code reloads as it changes, and `tauri dev` rebuilds the shell when its code changes. A host the app does not keep, such as one started with `pnpm host:dev`, tells the user to restart hobkin.
- `version.read` is a command hobkin's agent may run through its client tool. `version.update` changes the copy, so it is marked `outside`, and only the user's click in the window runs it.

## Out of scope

- Publishing a release, bumping the version, and a changelog.
- Updating a copy on another branch, or with work of its own, by merging or rebasing it.
- The release build's updater, which stays as 016-packaging built it.

## Acceptance

- A1. A live copy whose version is lower than the one on its origin's default branch reads that a new version is available, with both versions. A merge without a version bump, and an equal or lower version, are not new.
- A2. Update fast-forwards a clean copy on the default branch to the newest version, runs the package install in it, and says whether hobkin restarts into it by itself.
- A3. A copy on another branch, with uncommitted changes, or with commits its origin lacks, reads why Update can't move it, and Update leaves it where it was.
- A4. A failed install tells the user the copy is at the new version and gives the install's last lines and the command to run.
- A5. A look that can't reach the origin says so and finds nothing new. A host that is not live, or not run from a git checkout, never runs git to look.
- A6. A look that worked holds for six hours, so a copy looks at most that often. One that failed, such as a look made offline, is made again after half an hour.
- A7. The window shows "New version available" with Update when the host says one is out, once for each new version. With the reason Update can't run, it shows the reason in place of the button.

## Proof

- A1. `host/test/new-version.test.ts` › "a copy one version behind its origin's default branch hears of the newest, and a merge without a bump is not new"; `host/test/new-version.test.ts` › "versions compare as numbers"
- A2. `host/test/new-version.test.ts` › "Update fast-forwards a clean copy on the default branch and installs its packages in it"
- A3. `host/test/new-version.test.ts` › "Update leaves alone a copy on another branch, with uncommitted changes, or with commits its origin lacks, and says why"
- A4. `host/test/new-version.test.ts` › "a failed install says the copy is at the new version, with the install's last lines"
- A5. `host/test/new-version.test.ts` › "a look that can't reach the origin says so, and a host that is not live or not a checkout never runs git"
- A6. `host/test/new-version.test.ts` › "a look holds six hours, and one that failed is made again after half an hour"
- A7. `ui/test/new-version.test.ts` › "a new version is shown once for each version the host names, and reads stop with the window"; check: the notice in a window of a copy one version behind.

## Steps

- [x] S1 (A1, A2, A3, A4, A5, A6). The host's look and Update, with `version.read` and `version.update`. `new-version.test.ts` 7 of 7 on Node 26.13.1, on real git repositories in a temporary folder, with a stand-in for the install.
- [ ] S2 (A7). The window's notice. `ui/test/new-version.test.ts` 1 of 1. Not yet seen in a window.
