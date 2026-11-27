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

hobkin knows which version it is and the newest version on GitHub. When a new one is out, the window says "New version available: hobkin 0.2.4", with an Update button. Update opens an agent on the mid tier that brings the copy up to that version and installs its packages, and hobkin restarts into it once nothing is running. The agent asks the user before it touches a copy on another branch or with work of its own. hobkin's own agent can read the same status, so it can answer when the user asks whether it is up to date.

## Decisions

- The user, 2026-11-27: "we need a system to track versions of hobkin, if you are outdated, to update your system", and "new version available".
- This is for a copy run from its git repository, which is how the README installs hobkin (`pnpm tauri dev`). A release build already updates itself from GitHub's latest release (`src-tauri/src/updates.rs`, 016-packaging), and its host is not a git checkout, so it never looks here.
- A new version is a higher `version` in the app's `package.json` on the default branch of the copy's `origin`. A merge without a version bump is not a new version, so the notice does not show after every merge (the user's yes to that pick, 2026-11-27). Versions compare as numbers, so 0.2.10 is newer than 0.2.9.
- The host looks with `git fetch` of that one branch and reads its `package.json` with `git show`. That changes nothing in the copy's files. A look that worked holds for six hours, as the release build's updater waits. One that failed holds for half an hour. Update always makes a fresh look. Only a live host looks, so tests and throwaway homes never reach the network.
- The default branch is the one `origin/HEAD` names, or `main` when the copy has no `origin/HEAD`.
- The user, 2026-11-27: "clicking the update can open an agent to do it? mid tier", "would be the easiest". Update opens one durable hobkin on the mid tier in the copy's folder, the way Refresh opens one (`host/src/review/refresh-code.ts`), and the window opens it. Its brief is `host/src/new-version.md`: this copy's version, the newest, the branch, what stands in the way, and whether hobkin restarts by itself. While that agent is there, Update opens it again and starts no other. The host itself no longer moves the copy or installs anything.
- What stands in the way of a plain fast-forward is read and said: the copy on another branch, uncommitted changes to tracked files, or commits origin's branch lacks. The notice shows it, and the agent asks the user before it touches any of it. It never loses work, pushes, or changes hobkin's code.
- Nothing restarts an agent's work for this. The host already restarts itself onto newer code on disk once nothing runs (`host/src/code-age.ts`), so it waits for the update agent's turn too. The window's code reloads as it changes. When the update changes `src-tauri`, `tauri dev` rebuilds the shell and restarts the app, which ends running turns, so the brief has the agent merge and install in one command and report right after. A host the app does not keep, such as one started with `pnpm host:dev`, has the agent tell the user to restart hobkin.
- `version.read` is a command hobkin's agent may run through its client tool. `version.update` starts an agent that changes the copy, so it is marked `outside`, and only the user's click in the window runs it.

## Out of scope

- Publishing a release and a changelog.
- The release build's updater, which stays as 016-packaging built it.

## Acceptance

- A1. A live copy whose version is lower than the one on its origin's default branch reads that a new version is available, with both versions. A merge without a version bump, and an equal or lower version, are not new.
- ~~A2. Update fast-forwards a clean copy on the default branch to the newest version, runs the package install in it, and says whether hobkin restarts into it by itself.~~ Retired 2026-11-27: an agent moves the copy now (A8).
- ~~A3. A copy on another branch, with uncommitted changes, or with commits its origin lacks, reads why Update can't move it, and Update leaves it where it was.~~ Retired 2026-11-27: the agent handles these with the user (A9).
- ~~A4. A failed install tells the user the copy is at the new version and gives the install's last lines and the command to run.~~ Retired 2026-11-27: the install is the agent's (A8).
- A5. A look that can't reach the origin says so and finds nothing new. A host that is not live, or not run from a git checkout, never runs git to look.
- A6. A look that worked holds for six hours, so a copy looks at most that often. One that failed, such as a look made offline, is made again after half an hour.
- A7. The window shows "New version available" with Update when the host says one is out, once for each new version, and again when what stands in the way changes. ~~With the reason Update can't run, it shows the reason in place of the button.~~ Update always shows now, with what stands in the way beside it (A9).
- A8. Update opens one agent on the mid tier in the copy's folder, titled "Update hobkin to <version>", and told this copy's version, the newest, the branch, and whether hobkin restarts into it by itself. A second press while that agent is there opens it and starts no other. With nothing newer, or no look that worked, Update starts nothing and says why. The host itself changes nothing in the copy.
- A9. A copy on another branch, with uncommitted changes, or with commits its origin lacks reads what stands in the way, and the agent is told it. The host leaves the copy where it was.

## Proof

- A1. `host/test/new-version.test.ts` › "a copy one version behind its origin's default branch hears of the newest, and a merge without a bump is not new"; `host/test/new-version.test.ts` › "versions compare as numbers"
- ~~A2.~~ Retired.
- ~~A3.~~ Retired.
- ~~A4.~~ Retired.
- A5. `host/test/new-version.test.ts` › "a look that can't reach the origin says so, a host that is not live or not a checkout never runs git, and Update then opens no agent"
- A6. `host/test/new-version.test.ts` › "a look holds six hours, and one that failed is made again after half an hour"
- A7. `ui/test/new-version.test.ts` › "a new version is shown once for each version the host names, and reads stop with the window"; check: the notice in a window of a copy one version behind.
- A8. `host/test/new-version.test.ts` › "Update opens one agent in the copy, told both versions and the branch, and opens it again while it is there"; check: Update pressed in a window of a copy one version behind opens the agent, and it brings the copy up to date.
- A9. `host/test/new-version.test.ts` › "a copy on another branch, with uncommitted changes, or with commits its origin lacks reads what is in the way, and its agent is told"

## Steps

- [x] S1 (A1, A2, A3, A4, A5, A6). The host's look and Update, with `version.read` and `version.update`. `new-version.test.ts` 7 of 7 on Node 26.13.1, on real git repositories in a temporary folder, with a stand-in for the install. Seen through a live host on a scratch copy at 0.2.3: `version.read` found 0.2.4, and `version.update` fast-forwarded the copy and ran `pnpm run bootstrap`.
- [ ] S2 (A7). The window's notice. `ui/test/new-version.test.ts` 1 of 1. Not yet seen in a window.
- [ ] S3 (A8, A9). Update opens a mid-tier agent in place of the host's own fast-forward and install. `new-version.test.ts` 6 of 6 and `ui/test/new-version.test.ts` 1 of 1 on Node 26.13.1, with a stand-in for starting the agent, as Refresh's tests have. Not checked yet: an agent started from a window updating a real copy.
