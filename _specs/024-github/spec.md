---
{
  "id": "024-github",
  "title": "GitHub through gh",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "019-keyboard", "023-integrations"],
  "updated": "2026-11-10"
}
---
# GitHub through gh

## Outcome

GitHub is the first integration that reads real data. It connects through gh, GitHub's command line tool, with the login gh already has, so connecting takes nothing in the app. A page under Pages, Pages › GitHub, shows the pull requests waiting for the user's review, the user's own open pull requests with where each one's review and checks stand, and the user's open issues. Each row opens its page on github.com. The Integrations screen shows GitHub as connected through gh, as which account, with a way to open the page.

## Decisions

- The host runs gh as a program of its own with execFile, never through a shell, with a 20 second limit. It runs one command only: `gh api graphql --hostname github.com` with one fixed query (`host/src/github-gh.ts`). The query only reads. The host never runs `gh auth token` and never sees a token. gh keeps its own.
- One query reads everything: the account (`viewer`) and four GitHub searches, each for the 50 most recently updated: `is:pr is:open review-requested:@me`, `is:pr is:open author:@me`, `is:issue is:open assignee:@me` and `is:issue is:open author:@me`, all with `archived:false`. An issue that is both assigned to the user and opened by them is listed once.
- Review state: GitHub's review decision when a review is required, otherwise the latest review of each reviewer (changes asked for outweigh an approval), otherwise waiting when a review is asked for, otherwise none. Checks state: the status rollup of the last commit, as passing, failing, pending or none.
- The connection is not known yet, gh missing, gh not signed in, or connected as a login. gh's exit code 4 and an HTTP 401 mean not signed in. The host looks for gh on the PATH, then in Homebrew's folders, because an app opened from the Finder has a short PATH.
- The host keeps what it read last and sends it as the `github` slice of the state messages, whole, when any of it changed and with every reset. It reads when it starts, on `github.refresh`, and every 5 minutes while a UI is connected. A refresh during a read joins that read, so there is never more than one at a time. A failed read keeps the lists and says what went wrong in plain words. Anything shaped like a token is taken out of what gh says before it reaches the state or the log.
- The scripted host shows made-up data and never runs gh. `--github` makes it read the real GitHub through gh, read only. A `--live` host always reads the real GitHub. A host started in a test reads made-up data unless the test hands it a source of its own.
- A row is a link. In a browser tab it opens its page as any link does. The Mac window's web view opens no window for a link, and the shell has no opener, so there the host opens it: `github.open` runs `open <url>` with execFile, only for an address that starts with `https://github.com/`. Nothing opens a browser unless the host's entry hands it an opener. The app does. A test never does.
- The page sits under Pages, as Integrations sits under Settings: the menu's second row reads Pages › GitHub, and Escape goes back up to Pages. Keys: Up and Down walk the rows and Refresh, Enter opens a row, and `r` reads again. Left and Right are free, and Tab is the frame's.
- Rows land one after another as the page arrives, and a row that a refresh brings rises in on its own. With Movement set to Still, or following a Mac that asks for less, nothing travels and only fades remain.
- In Integrations, GitHub's tile follows gh: it sits with the connected services while gh is signed in, says "Connected through gh as @login", and its detail has a button that opens the GitHub page. GitHub's MCP server stays in the catalog, for the tools agents use.

## Out of scope

- Writing to GitHub: commenting, reviewing, merging, closing. This version only reads.
- GitHub Enterprise and hosts other than github.com.
- Signing gh in from the app. The page names the command to run in Terminal.
- Notifications, and filters on the page.

## Acceptance

- A1. One gh call reads the account, the open pull requests waiting for the user's review, the user's own open pull requests, each with its review state, checks state and whether it is a draft, and the open issues assigned to the user or opened by them. Each row has its repository, number, title, labels, when it was last updated and its address.
- A2. With gh missing, the connection reads gh missing. With gh installed and not signed in, or with a sign-in GitHub refuses, it reads not signed in.
- A3. The host runs only `gh api graphql --hostname github.com` with its fixed read query: never `gh auth token`, and never a write.
- A4. A refresh while a read is under way starts no second read.
- A5. A read that fails, such as one that finds no network, keeps what was read before and shows gh's reason in plain words.
- A6. The scripted host shows sample data and never runs gh. With `--github` it reads through gh.
- A7. The host opens a page only when asked, and only an address that starts with `https://github.com/`.
- A8. The page works with the keyboard alone: Up and Down reach every row and Refresh, Enter opens a row, `r` refreshes, and Escape goes back to Pages.
- A9. Rows land one after another as the page arrives, and a row that a refresh brings rises in by itself. With Movement set to Still nothing travels.
- A10. A group with nothing in it shows a line of its own, and a group that holds only the most recent 50 says that GitHub has more.
- A11. In Integrations, GitHub's tile follows gh: it sits with the connected services while gh is signed in and says "Connected through gh as @login", and it waits in the catalog, saying what gh needs, while gh is missing or not signed in.
- A12. A UI that connects gets the GitHub slice at once, and later gets it again only when something in it changed.
- A13. No token appears in the state, in a message to the UI, or in the log.
- A14. The host reads by itself every 5 minutes while a UI is connected, and not while none is.
- A15. A gh that hangs is stopped after 20 seconds, and the read fails with that reason.
- A16. The window keeps the GitHub slice between messages, and drops it when a host that does not read GitHub starts over.
- A17. While gh is signed in, the page shows the account, when it last read, and the three groups, with each of the user's own pull requests showing its review and checks state. While gh is missing or not signed in, it says which and names the command to run in Terminal.
- A18. A row opens its page on github.com: in the system browser from the Mac window, and in a new tab from a browser tab.
- A19. In Integrations, GitHub's detail has a button that opens the GitHub page, with the keyboard on its first row.

## Proof

- A1. `host/test/github.test.ts` › "reads the three lists from one gh answer"
- A2. `host/test/github.test.ts` › "gh runs only the fixed read, and how it ends becomes the connection"
- A3. `host/test/github.test.ts` › "gh runs only the fixed read, and how it ends becomes the connection"
- A4. `host/test/github.test.ts` › "there is never more than one read at a time"
- A5. `host/test/github.test.ts` › "a failed read keeps what was read before and says what went wrong"
- A6. `host/test/github-host.test.ts` › "the scripted host shows sample GitHub data, and gh runs only with --github"
- A7. `host/test/github-host.test.ts` › "a refresh answers with the slice, and only pages on github.com open"
- A8. check: open Pages › GitHub and use it with Up, Down, Enter, `r` and Escape only, in light and dark.
- A9. check: open the page on the scripted host and press `r` twice (every second sample read brings one more review request), then again with Movement set to Still.
- A10. check: a group with nothing in it, such as Waiting for your review on a quiet day, shows its line.
- A11. `ui/test/integrations-gh.test.ts` › "GitHub follows gh: with the connected services while gh is signed in, in the catalog while it is not"
- A12. `host/test/github-host.test.ts` › "the GitHub slice travels whole, only when some of it changed"
- A13. `host/test/github.test.ts` › "nothing shaped like a token reaches what gh said"
- A14. `host/test/github.test.ts` › "it reads again on a gentle timer, only while someone is looking"
- A15. `host/test/github.test.ts` › "gh runs as its own program, with a time limit"
- A16. `ui/test/github.test.ts` › "the GitHub slice comes with state messages, and a reset without it means the host does not read GitHub"
- A17. check: open Pages › GitHub on a host started with `--github`, then look at the page with gh missing and with gh signed out.
- A18. check: press Enter on a row in the Mac window and in a browser tab.
- A19. check: in Integrations, press Enter on GitHub's tile, then on Open the GitHub page.

## Steps

- [x] S1 (A1, A2, A3, A4, A5, A13, A14, A15). Host: run gh, read its answer, the refresh rules, and a sample source, tested on a fake gh.
- [x] S2 (A6, A7, A12, A16). Wiring: the `github` state slice, the `github.refresh` and `github.open` commands, and `--github`.
- [ ] S3 (A8, A9, A10, A17, A18). The page, Pages › GitHub. Checked in a browser tab on 2026-11-10 with the real gh, in light and dark and with Movement set to Still. A row's link was taken with Enter there, and its opening was held back. Still to check: Enter on a row in the Mac window.
- [x] S4 (A11, A19). Integrations: GitHub's tile and detail follow gh.

## Open questions

- Should hobkin itself read this list, so it can answer "what waits for my review?" Marking `github.refresh` as a command hobkin may run (013-hobkin-access) would do it. It is off for now.
- Actions on GitHub from the page, such as approving or merging, are each a write and need a decision of their own.
