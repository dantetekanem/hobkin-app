---
{
  "id": "043-merges-and-deploys",
  "title": "Auto-merge, merge counts and what waits to deploy",
  "kind": "work",
  "status": "draft",
  "depends": ["011-work", "024-github", "031-home", "032-change-review", "038-resources", "042-stacked-work", "045-dev-system"],
  "updated": "2026-11-14"
}
---
# Auto-merge, merge counts and what waits to deploy

## Outcome

Each project hobkin works on gets three things. Auto-merge: a setting the user turns on only from the window, after two separate confirmations, that lets hobkin merge its own PRs on that project without asking, and only a PR that meets every rule of today's land-offer bar. Each auto-merge shows in Chat and in the project's list of what merged by itself, and trouble after a merge there turns it off. Merge counts: the PRs merged into the project's default branch per day and per week, everyone's and hobkin's, on the Work screen and on Home. What waits to deploy: hobkin finds the project's deploy setup in its files, proposes a read-only way to read the version that is live, the user confirms it once, and hobkin then shows how many merged PRs the live version does not hold yet, and which. hobkin never deploys.

## Decisions

### What exists today

- An offer covers a finished local branch only. `weighedRows` lists the items in state `branch` (`src/cli/work/reads.mjs:287`, `:311-323`), each weighed by `offerFor` (`src/cli/work/patterns.mjs:224-240`). Offers are filed in Decisions one at a time, at most every two hours, and only with learning on (`src/cli/work/land-offer.mjs:6`, `:115-124`, `:173-191`). A yes goes through `answerOffer` (`src/cli/answer.mjs:22`, `src/cli/work/controls.mjs:787-798`) to `mergeItem`, which merges on this Mac and pushes nothing (`controls.mjs:483-507`).
- A PR merges on GitHub only from its card or a group, on the user's word. `mergePullRequest` runs `gh pr merge <url> --merge --match-head-commit <head>` with gh's login and closes the item (`controls.mjs:523-535`). No offer is ever made for a PR.
- Every 30 minutes the survey reads each hobkin PR with its head, size, paths, conflict, checks, review decision and draft state, and grades its head as it grades a branch (`src/cli/work/unmerged.mjs:76-88`, `:264-276`, `:294-331`; `src/cli/work/director.mjs:49`). A PR already carries every fact the bar reads.
- A project's PR mode is `off`, `draft` or `published` (`src/cli/work/store.mjs:19`, `:453-458`, `:594`; `controls.mjs:36-40`, `:402-406`; `shared/protocol/work.ts:10`, `:65`; `host/src/work.ts:266`, `:364-372`). Its control is "Finished work" on the project's row in Work › Projects (`ui/src/features/work/Queue.tsx:344-354`).
- No agent deploys on its own. The fix filed for trouble is told "You never deploy, roll back or revert the default branch" (`src/cli/work/launches.mjs:180`), and a deploy happens only through a session after the user's yes on a list (`src/prompts/v2-runtime.md:234-243`). This work keeps both.

### The bar

- Auto-merge uses the bar an offer uses, unchanged: `offerFor` with the same track records (`patterns.mjs:164-240`). Its grade is Change Review's, as `045-dev-system` S13 makes it: pi-auto-review is not used (the user, 2026-11-14), and safe A gives way to Change Review's answer at this commit. The first confirmation shows the left column:

  | Rule | From |
  | --- | --- |
  | Change Review says "Safe to deploy" for this exact commit, and no part of it is above safe. | `gradeVetoes`, `patterns.mjs:175-185`, after 045 S13 |
  | Its quality grade, for this commit, is B or better. | same |
  | At most 300 changed lines, and no more files than hobkin read. | `changeVetoes`, `:187-199` |
  | It sits in one or two areas, and the survey has read it. | same |
  | It touches nothing sensitive: migrations, schema, auth, sessions, tokens, secrets, passwords, payments, billing, deploy setup or CI. | `SENSITIVE_PATH`, `:7` |
  | It has no conflict, and git could tell. | same |
  | It deletes no tests. | same |
  | It has proof and leaves nothing for the user. | `vetoesOf`, `:201-209` |
  | Its undo is not one-way or permanent. | same |
  | Everything it brings with it passes that too. | same |
  | A change like it (same project, kind and area) landed before, and no trouble has reset that since. Docs, tests and dependencies may lean on another project's. | `precedentFor`, `historyVetoes`, `:165-170`, `:211-216` |
  | That kind of change is not turned off, by the user or by severe trouble. | same |

- A PR must also be ready on GitHub, as the survey read it. hobkin opened it (its head is on `hobkin/`), it is not a draft, its base is the default branch, GitHub says it is mergeable, no review asks for changes, and its checks pass. Checks still running wait. A PR with no checks at all goes only when the project has no workflow files under `.github/workflows/`, because checks that have not started yet also read as none. The survey adds `baseRefName` to the PR fields it reads (`unmerged.mjs:19`).
- A spot check stays a spot check. One in five PRs that pass, chosen by item id as today (`SPOT_ONE_IN`, `patterns.mjs:13`, `:218`), is not merged. It waits on the Work screen as a finished change marked "A spot check: hobkin asks you about 1 in 5 it could merge alone", so the user keeps seeing what the bar lets through.
- Grades come from Change Review. A live host reviews each finished change at its head by itself, hobkin's open PRs among them (`toPrepare`, `host/src/review/seat.ts:205-209`), and a review hobkin asks for is a request for that build, never an agent run (`045-dev-system`, "Change Review in place of pi-auto-review"). A PR with no Change Review at the head the survey read does not auto-merge, and the project's row says that Change Review has not finished that commit.
- A PR in a stack auto-merges only once it is the bottom of its stack, based on the default branch, and passes the bar on its own. hobkin merges with no `--delete-branch` (`controls.mjs:527`), so GitHub does not move the PRs above it. They wait until `042-stacked-work`'s pass after a merge sets their base to the default branch, which it does only while its `restack` is on.

### How an auto-merge lands

- It is the PR's own landing, without the question: `mergePullRequest` at the head the survey graded, with `--match-head-commit`, so GitHub refuses a PR that moved since. It merges as the user, with gh's login, as a card merge does. It never passes `--admin`, never uses GitHub's own auto-merge (`--auto`) and never marks a draft ready. Its item closes with `landed.route` set to `auto`. A PR merged from its card records `remote` today (`unmerged.mjs:355-371`).
- It runs after each survey, by itself, so gh never holds a tick, as `settleMerges` and `pickUpIssues` do (`director.mjs:379-398`). One pass merges at most one PR a project. It merges none on a project while an earlier auto-merge there has checks failing or still running on the default branch, as the launch's pulse reads them (`launches.mjs:60-67`, `:107-110`).
- It merges nothing while work mode is off or paused, while the project is paused, while learning is off (`land-offer.mjs:116`), or while the project's PR mode is not `published`. The project's row says which one holds it.
- A merge GitHub refuses (branch protection, a merge method the repository does not allow, a head that moved) is not tried again at that head. The PR stays a finished change with GitHub's reason as its first line, and auto-merge stays on.
- A landing with route `auto` opens its launch at stage `pushed`, as a merge on GitHub does (`launches.mjs:46`). It counts toward its pattern's record like any landing, because the record learns from what happened after a merge and never from the yes (`patterns.mjs:140-143`).

### Turning it on and off

- Auto-merge is off on every project until the user turns it on. Only the window turns it on or off, on the user's click.
- The command is `work.auto-merge`, marked `outside`, so hobkin's `client` tool refuses it (`shared/commands/registry.ts:50-51`, `host/src/client-tool.ts:40`). The runtime has no `hobkin work` command and no work action for it. The host calls the runtime's function itself, as `work.agents` calls `setAgents` (`host/src/work.ts:374-379`).
- There are two separate confirmations, and the host checks both. The first is "Continue" under the bar. It asks the host for `work.auto-merge-preview`, which answers with what holds auto-merge on this project now and a `confirm` for the project, its repository, its PR mode and the bar. The second is "Turn on auto-merge" on a screen of its own, which sends `work.auto-merge` with that `confirm`. The host refuses a `confirm` older than ten minutes, or one whose facts changed. This follows `review.preview` and `review.verdict` (`registry.ts:895-906`).
- Turning it off is one click with no question. Two things also turn it off, each keeping its reason: trouble (below), and a change of the project's PR mode by anyone, since the user confirmed auto-merge for PRs that open as PRs.
- Each change is appended to `work/<slug>/auto-merge.jsonl` in hobkin's home: on or off, when, why (`window`, `trouble` with its item, or `pr-mode`), and for on, the `confirm` it came with. The last line stands. The project's lightbox shows the history.
- hobkin's directions in `v2-runtime.md` say that the user sets auto-merge and the live read in the window, that hobkin can read both with `projects`, and that it cannot change either.
- hobkin's code holds this, not the operating system. A session with the user's rights could still write the file, as `038-resources` says of what loads. The history makes such a write visible.

### Trouble turns it off

- When trouble is recorded on a change that landed on the project after auto-merge was last turned on, auto-merge turns off in the same step (`recordTrouble`, `launches.mjs:200-214`). That holds for trouble the pulse saw, a watch look reported, or the user named with `trouble` (`controls.mjs:833-841`), severe or not, and whether the change merged by itself or not.
- It files one Action Item: `Auto-merge on <project> is off: "<title>" went wrong after it merged`, with what the launch saw and the fix hobkin filed. A new Action Item notifies, by `037-notifications`.
- It stays off until the user turns it on again with both confirmations. The first confirmation then also names the trouble and its fix.
- Turning a pattern back on with `trust` (`controls.mjs:801-814`) lets offers come again. It does not turn auto-merge back on.

### Seeing each auto-merge afterwards

- One line in Chat for each, from the after-merge pass (`src/cli/work/after-merge.mjs:61-90`): `Merged "<title>" on <project> by itself, PR #482: safe to deploy, quality B, 120 lines, like "<precedent>" merged Nov 3. Undo: <how>.` What the pass says today, the issue it closed and what is left for the user, follows on the same line.
- The project's lightbox lists what merged by itself in the last 30 days, newest first: title, PR link, when, Change Review's answer, lines, and its watch as it stands (watching, held, quiet, unexercised or trouble).
- The weekly scoreboard counts merges by itself apart from the user's (`src/cli/work/scoreboard.mjs:23-34`).
- To say one went wrong, the user tells hobkin in Chat, which runs `trouble`, as today.

### Merge counts

- For each project on GitHub: the PRs merged into its default branch, everyone's, and among them hobkin's (head on `hobkin/`) and those merged by itself. Today, each of the last 7 days, and each of the last 8 weeks. A week is the 7 days ending today, in the Mac's own days.
- After each survey the runtime asks gh what merged since its last read, with one day of overlap: `gh pr list --repo <origin> --state merged --base <default> --search "merged:>=<date>" --json number,title,url,mergedAt,mergeCommit,headRefName,author`. The first read goes back 8 weeks. It only reads, with gh's own login, as the survey does (`unmerged.mjs:94-102`).
- Each merged PR is one line in `work/<slug>/merges.jsonl`, by number, kept 90 days, so a PR read twice counts once. A read that reaches gh's limit says the count is at least that.
- A project not on github.com has no PR counts and says so. A merge on this Mac with PR mode `off` is no PR and is not counted here.
- The counts reach the window with each project in the Work state, beside the `merged` count it has today (`shared/protocol/work.ts:78`).
- The GitHub page's query stays as `024-github` set it, open items only (`host/src/github-gh.ts:17-39`). The counts come from the runtime, never from that query.
- They show on the project's row ("12 PRs merged this week, 7 by hobkin"), in its lightbox as 7 day bars and 8 week bars, in the weekly review in Chat, and on Home's This week widget as totals across projects ("4 PRs merged today, 19 this week").

### Finding the deploy setup

- Detection reads the project's files at its default branch, as last fetched, and runs nothing of the project's. It looks for:

  | Found | Proposed read |
  | --- | --- |
  | `config/deploy.yml`, and `config/deploy.<destination>.yml` (Kamal) | `kamal app version`, with `-d <destination>` for each destination file |
  | `fly.toml` (Fly) | `fly releases --json -a <app>`, with the app from `fly.toml` |
  | A workflow under `.github/workflows/` whose file or job names deploy or release, or whose job names an `environment` | that workflow's last successful run on the default branch, through `gh run list` |
  | GitHub deployments on the repository, whatever wrote them (a workflow environment, or a provider's GitHub app) | the newest successful deployment to an environment named like production, through `gh api` |
  | `vercel.json` or `.vercel/`, `netlify.toml`, `render.yaml` | named as the setup, then read through GitHub deployments when the repository has any, else through a page that shows the commit |
  | A `package.json` that names a published package | `npm view <name> version`, matched to its tag |
  | Releases or tags | the newest release or tag reachable from the default branch |

- To list environments, deployments, workflow runs and releases, detection reads the project's own repository with gh's login, as the survey does. It never runs kamal, flyctl or npm and never contacts a site.
- A `deploy` command a signals look proved (`src/cli/work/signals.mjs:32`, `src/prompts/work-look.md:105-119`) is proposed too, when it is one of the read forms below.
- Proposals come strongest first: a read of the running system, then GitHub deployments, then a workflow run, then a release or tag.

### The read, and how it is gated

- A read is one of a closed list, and each one only reads: `kamal app version`, `fly releases --json` or `fly status --json`, `npm view <name> version`, GitHub deployments, a workflow's last successful run, the newest release or tag, or a GET of one https page that shows the commit. The user may edit what selects it: a destination, an app, an environment, a workflow file, a tag pattern, or the page's address. The verb never changes. A read outside the list is refused with the reason.
- Nothing runs until the user asks in the window. "Try it" runs a read once, on the click, and shows what it read ("Live: abc1234, 2 hours ago. 3 PRs on main are not in it."). "Use this read" confirms it, and is offered only after a try in the last ten minutes that read a version. `work.deploy-try` and `work.deploy-confirm` are `outside`. The confirmed read is kept in `work/<slug>/deploy.json`, with when it was confirmed.
- A confirmed read that changes, by an edit or because a look found another, runs only once the user confirms it again. Until then the last confirmed one runs.
- Before a try, each read says what it reaches and with whose login: "GitHub, with gh's login", "your servers over SSH with your keys, as kamal does", "fly.io, with flyctl's login", "the npm registry, with no login", "<host>, with no login".
- A command runs with `execFile`, never a shell, in the project's folder, with no terminal and its input closed, so anything that would ask for a password or a passphrase fails at once. It has 60 seconds. A page read sends no cookie and no auth header, and follows no redirect to another host. hobkin never asks for, keeps or passes a key or token: gh, kamal and flyctl keep their own.
- What a read prints stays in the runtime. It is cut to 64 KB, anything shaped like a token is hidden, and it never goes into a prompt or to a model, as the pulse never runs a command an agent wrote (`launches.mjs:289-292`).
- A read that fails shows "Could not read what is live: <reason>", with the last good reading and its age. It never reads as up to date. After three failures in a row it waits for "Read now".
- Tests use fakes for gh, git, HTTP and commands, and fake addresses end in `.invalid`.

### What waits to deploy

- With a confirmed read that gives a commit, what waits is the commits on the default branch, as last fetched from origin (`launches.mjs:266`), that the live commit does not contain. The PRs among them come from the ledger's `mergeCommit`, and the rest count as "and 2 other commits". A live commit this Mac does not have is said, and nothing is counted.
- A read that gives only a time, such as a release with no commit, counts the PRs merged after it, labeled "by time".
- With no confirmed read, hobkin counts what came after the newest tag reachable from the default branch, labeled "since v1.4.2, not a live read". With no tag either, it says it cannot tell what is live and offers to set it up.
- A merge on this Mac that is not pushed is not on origin, so it counts only once it is.
- The read runs every hour, and every 10 minutes in the hour after a merge on the project, stopping early once that merge is live. "Read now" runs it at once.
- A launch whose merge commit a read shows live is marked live at that read's time, as a watch look marks it (`launches.mjs:309-316`). The watch and the deploy count then agree on what is live.
- It shows on the project's row ("3 PRs to deploy", "Live is up to date"), in its lightbox with each PR waiting (title, number, when it merged, hobkin's or not) and the read's last result, and on Home's Projects widget as a count beside the project, which goes to its Work row.

### On the screen

- Work › Projects, on each project's row (`Queue.tsx:315-375`): the facts line gains the week's merges, auto-merge when it is on, and what waits to deploy. A new control, "Auto-merge", reads Off or On. While PR mode is not `published` it is disabled and says "Needs Finished work set to PR". A "Merges and deploys" button opens the project's lightbox, mounted where the tiers lightbox is (`ui/src/app/Frame.tsx:66`).
- The lightbox has three parts. Merges: the counts, the bars, and what merged by itself. Auto-merge: its switch, what holds it now, and its history. Deploys: what was found, the confirmed read or the proposals, Try it, Use this read, Edit, Read now and Stop reading, and the list of what waits.
- Turning auto-merge on. The first screen, "What hobkin may merge on <project> by itself", lists the bar above, then what holds auto-merge on this project now (for example "Change Review has not finished the newest commit of 2 PRs"), then that a merge goes to GitHub at the graded commit with a merge commit, that one in five comes to the user as a spot check, and that trouble turns it off. Its buttons are Cancel and Continue. The second screen, "Turn on auto-merge for <project>?", says: "From the next survey, within 30 minutes, hobkin merges its PRs on <owner/name> that pass every rule, without asking you. Each one shows in Chat and here. You can turn it off here at any time." Its buttons are Cancel and Turn on auto-merge. On both screens Cancel has the keyboard first, and Escape is Cancel.
- With no host the lightbox draws sample data and says so, and its actions answer as hobkin would without reaching it.
- Everything works from the keyboard, by `019-keyboard`.

### Commands

- `work.auto-merge-preview { slug }`: the first confirmation. It answers with the bar, what holds auto-merge on the project now, and `confirm`. It changes nothing.
- `work.auto-merge { slug, on, confirm? }`: `outside`. On needs a fresh `confirm`. Off needs none.
- `work.deploy-try { slug, read }`: `outside`. It runs one read once and answers with what it read.
- `work.deploy-confirm { slug, read, tried }`: `outside`. `tried` is what the try answered.
- `work.deploy-forget { slug }`: `outside`. The project goes back to counting from its newest tag.
- `work.deploy-read { slug }`: runs the confirmed read now. hobkin may run it, since it runs only what the user confirmed.

## Out of scope

- Deploying, releasing, rolling back or restarting anything, and a Deploy button. A deploy stays what `v2-runtime.md` says: a session after the user's yes on a list.
- Auto-merging a local branch (PR mode `off`), a PR hobkin did not open, or a draft.
- Offers for PRs while auto-merge is off.
- Any merge method but a merge commit.
- Changing the bar, or how offers work for local branches.
- Hosts other than github.com.
- A read that needs a key hobkin would keep, such as a provider's API token.
- Filling the deploy follow-up template (`src/prompts/routine-templates/deploy-follow-up.md`) from the confirmed read.
- Saying a merge went wrong from the window.
- Stacks beyond the line above, which `042-stacked-work` covers.

## Acceptance

- A1. Auto-merge is off on every project until the user turns it on in the window. Turning it on takes two confirmations on two screens: the first lists every rule of the bar and what holds auto-merge on that project now, and the second names the project and its repository. Cancel or Escape on either screen leaves it off.
- A2. hobkin cannot change auto-merge or the confirmed deploy read. Its `client` tool refuses `work.auto-merge`, `work.deploy-try`, `work.deploy-confirm` and `work.deploy-forget`, and no `hobkin work` command changes them. The host refuses `work.auto-merge` with `on` and no `confirm`, with a `confirm` older than ten minutes, or with one whose facts changed.
- A3. With auto-merge on, a PR hobkin opened that passes every rule of the bar and is ready on GitHub merges on GitHub at the commit the survey graded, with no question, in the first pass after it qualifies. Its item closes with route `auto`, and its launch opens at stage `pushed`.
- A4. A PR that fails a rule of the bar, or is not ready on GitHub (a draft, checks failing or running, changes asked for, not mergeable, based on another branch, or with no checks in a project that has workflows), does not merge, and the project's lightbox names the rule that held it. A PR that moved since it was graded does not merge.
- A5. One in five PRs that pass, the same ones an offer would spot check, does not merge and waits on the Work screen marked as a spot check.
- A6. Nothing auto-merges while work mode is off or paused, the project is paused, learning is off, or PR mode is not `published`, and the project's row says which. At most one PR merges on a project in a pass, and none while an earlier auto-merge there has checks failing or still running on the default branch.
- A7. A merge GitHub refuses leaves the PR a finished change with GitHub's reason, and it is not tried again at that head. Auto-merge stays on.
- A8. Each auto-merge posts one line in Chat with its title, project, PR, Change Review's answer, lines and precedent. It shows in the project's list of what merged by itself, with its watch as it stands, and the weekly scoreboard counts it apart from the user's merges.
- A9. Trouble on any change that landed on the project after auto-merge was turned on, severe or not, turns auto-merge off as the trouble is recorded, keeps why in the project's history, and files one Action Item. It stays off until the user turns it on again with both confirmations, and `trust` on the pattern does not turn it back on.
- A10. A change of the project's PR mode turns auto-merge off and keeps why.
- A11. For a project on GitHub, the counts give the PRs merged into its default branch today, on each of the last 7 days and in each of the last 8 weeks: everyone's, hobkin's, and those merged by itself. A PR read twice counts once. A project not on GitHub shows no PR counts and says so.
- A12. The counts show on the project's row and in its lightbox, in the weekly review in Chat, and as totals on Home's This week widget. With no host, each screen shows sample data and says so.
- A13. For a repository with Kamal, Fly, a deploy workflow, GitHub deployments, Vercel, Netlify, Render, a published npm package, or releases or tags, the lightbox names what was found and proposes its reads, strongest first. Finding them runs no kamal, flyctl or npm and sends no request to the project's site.
- A14. No read runs until the user asks in the window. Try it runs a read once and shows what it read. Use this read is offered only after a try in the last ten minutes that read a version. A read outside the closed list is refused. A confirmed read that changes runs only once it is confirmed again.
- A15. Before a try, each read says what it reaches and with whose login. A command read runs with no shell, no terminal and its input closed, and stops at 60 seconds. A page read sends no cookie or auth header and follows no redirect to another host. What a read prints never reaches a model, and anything in it shaped like a token is hidden.
- A16. A read that fails shows why, with the last good reading and its age, and never shows the project as up to date. After three failures in a row it waits for Read now.
- A17. With a confirmed read, the project shows how many PRs merged into the default branch the live version lacks, each one listed, and how many other commits, or that live is up to date. A read that gives only a time counts by time and says so. With no read the project counts from its newest tag and says it is not a live read, and with no tag it says hobkin cannot tell.
- A18. The confirmed read runs every hour, and every 10 minutes in the hour after a merge until that merge is live. A launch whose merge commit a read shows live is marked live at that read's time.
- A19. Home's Projects widget shows each project's count waiting to deploy, and a click on it opens that project's row on the Work screen.
- A20. Nothing in this work deploys, releases, rolls back or restarts. A read form that would is refused, and the fix filed for trouble keeps its rule.
- A21. Every control of this work works from the keyboard, both confirmations included, with Cancel taking the keyboard first on each screen.

## Proof

- A1. `ui/test/merges-deploys-rules.test.ts` › "auto-merge turns on only after Continue and then Turn on, and Cancel at either step leaves it off"; check: the lightbox on both confirmation screens with sample data, as a still render (server markup with the app's built CSS, no browser), dark and light.
- A2. `host/test/work-merges-deploys.test.ts` › "hobkin's client tool refuses the auto-merge and deploy read changes" and › "auto-merge on needs a fresh confirm whose facts still hold"; `hobkin/test/cli-work-auto-merge.test.mjs` › "no hobkin work command or work action changes auto-merge"
- A3. `hobkin/test/cli-work-auto-merge.test.mjs` › "a PR that passes the bar and is ready on GitHub merges at its graded head with route auto"; `hobkin/test/cli-work-launches.test.mjs` › "an auto landing opens its launch at pushed"
- A4. `hobkin/test/cli-work-auto-merge.test.mjs` › "each rule of the bar and of GitHub holds a PR back and names itself" and › "a PR that moved since its grade does not merge"
- A5. `hobkin/test/cli-work-auto-merge.test.mjs` › "a spot check does not merge and waits for the user"
- A6. `hobkin/test/cli-work-auto-merge.test.mjs` › "nothing merges while work mode, the project or learning is off or paused, or PR mode is not published" and › "one PR a project a pass, and none while an earlier one's checks fail or run"
- A7. `hobkin/test/cli-work-auto-merge.test.mjs` › "a refused merge keeps the PR with GitHub's reason and is not tried again at that head"
- A8. `hobkin/test/cli-work-after-merge.test.mjs` › "an auto-merge says in Chat what merged, Change Review's answer, its size and precedent"; `hobkin/test/cli-work-review.test.mjs` › "the scoreboard counts merges by itself apart"; `ui/test/merges-deploys-rules.test.ts` › "what merged by itself lists each one with its watch"
- A9. `hobkin/test/cli-work-auto-merge.test.mjs` › "trouble after it was turned on turns auto-merge off and files one Action Item" and › "trust on the pattern does not turn auto-merge back on"
- A10. `hobkin/test/cli-work-auto-merge.test.mjs` › "a change of PR mode turns auto-merge off"
- A11. `hobkin/test/cli-work-merges.test.mjs` › "merged PRs count by day and week, everyone's, hobkin's and by itself" and › "a PR read twice counts once, and a project not on GitHub has no counts"
- A12. `host/test/work-merges-deploys.test.ts` › "each project carries its merge counts, auto-merge and deploy state"; `hobkin/test/cli-work-review.test.mjs` › "the weekly review gives the week's PR counts"; `ui/test/home-model.test.ts` › "This week totals the PRs merged today and this week"; check: the Work row, the lightbox and Home with sample data as still renders, dark and light.
- A13. `hobkin/test/cli-work-deploys.test.mjs` › "each setup's files propose its reads, strongest first" and › "detection runs no project tool and requests no site"
- A14. `hobkin/test/cli-work-deploys.test.mjs` › "a read outside the closed list is refused" and › "a changed read waits for its confirmation"; `host/test/work-merges-deploys.test.ts` › "a read is confirmed only after a try that read a version in the last ten minutes"
- A15. `hobkin/test/cli-work-deploys.test.mjs` › "a command read runs without a shell or terminal, with its input closed, and stops at its limit", › "a page read sends no credentials and stays on its host" and › "a read's output is cut and its tokens hidden"
- A16. `hobkin/test/cli-work-deploys.test.mjs` › "a failed read keeps the last good reading and never reads as up to date" and › "three failures in a row wait for Read now"
- A17. `hobkin/test/cli-work-deploys.test.mjs` › "with a live commit, the PRs and other commits it lacks are counted" and › "a time read counts by time, no read counts from the newest tag, and no tag says so"; check: in S8, the confirmed project's count matches what its deploy tool shows as live.
- A18. `hobkin/test/cli-work-deploys.test.mjs` › "the read runs hourly and every 10 minutes after a merge until it is live"; `hobkin/test/cli-work-launches.test.mjs` › "a live read marks a launch live at its time"
- A19. `ui/test/home-model.test.ts` › "a project's count to deploy shows on Projects and goes to its Work row"
- A20. `hobkin/test/cli-work-deploys.test.mjs` › "the closed list holds only reads, and a deploy, release, rollback or restart form is refused"
- A21. check: on sample data, walk the lightbox with the keyboard alone: both confirmations with Cancel first, then Try it, Use this read and Read now.

## Steps

S1, S2 and S3 can be built at once: they share no file. S2 needs `045-dev-system` S13, since the bar reads Change Review's answer. S4 comes after all three. S5 comes after S4. S6 and S7 can start on sample data at once and connect once S5's `shared/protocol/work.ts` is in. S8 needs the user's go-ahead.

Auto-merge and the live reads ship switched off. Once S4 is committed the pass runs on the live home, but no project has auto-merge on and no project has a confirmed read, so nothing merges and no read runs. The user's go-ahead is what turns each on, in the window: the two confirmations for auto-merge on a project, and Try it then Use this read for a deploy read (S6).

- [ ] S1 (A11). Runtime: the merges ledger, as a module no pass calls yet. The gh read since the last one, the ledger by PR number kept 90 days, and the counts by day and week. Files: new `hobkin/src/cli/work/merges.mjs`; tests new `hobkin/test/cli-work-merges.test.mjs`.
- [ ] S2 (A2, A3, A4, A5, A6, A7, A9, A10). Runtime: the auto-merge rule and its record, called by nothing yet. The history file and its last word; each open PR weighed by `offerFor` with GitHub's own rules added; the pace; the pass that merges through `mergePullRequest`; off by trouble and by a change of PR mode. `mergePullRequest` and `closeMergedPull` take a `route` that stays `remote` unless given, so nothing changes until S4 passes `auto`. The survey reads `baseRefName`. Files: new `hobkin/src/cli/work/auto-merge.mjs`, `hobkin/src/cli/work/controls.mjs`, `hobkin/src/cli/work/unmerged.mjs`; tests new `hobkin/test/cli-work-auto-merge.test.mjs`.
- [ ] S3 (A13, A14, A15, A16, A17, A20). Runtime: deploy setup, reads and what waits, as modules no pass calls yet. Detection from files and gh; the closed list of reads and how each runs; the confirmed read kept in the project's folder; and what the live version lacks, from git and a list of merged PRs passed in, so it needs nothing from S1. Each read's parser follows its tool's documented output, and S8 checks the reads the user confirms against the real tool. Files: new `hobkin/src/cli/work/deploys.mjs`, new `hobkin/src/cli/work/deploy-reads.mjs`; tests new `hobkin/test/cli-work-deploys.test.mjs`.
- [ ] S4 (A3, A6, A8, A9, A11, A12, A17, A18). Runtime: wire it in. After each survey the director runs the ledger read, the auto-merge pass and the deploy reads that are due, each by itself. `workStatus` and `projects` carry each project's counts, auto-merge and deploy state. A landing with route `auto` opens its launch at `pushed`; `recordTrouble` turns auto-merge off and files the Action Item; a live read marks launches live; the after-merge pass writes the line for an auto-merge; the scoreboard and the weekly review count it; the directions say who sets these. Files: `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/work/commands.mjs`, `hobkin/src/cli/work/reads.mjs`, `hobkin/src/cli/work/launches.mjs`, `hobkin/src/cli/work/after-merge.mjs`, `hobkin/src/cli/work/scoreboard.mjs`, `hobkin/src/cli/work/review.mjs`, `hobkin/src/prompts/v2-runtime.md`; tests `hobkin/test/cli-work-launches.test.mjs`, `hobkin/test/cli-work-after-merge.test.mjs`, `hobkin/test/cli-work-review.test.mjs`, `hobkin/test/cli-work-auto-merge.test.mjs`, `hobkin/test/cli-work-deploys.test.mjs`. Once this lands, the live home's survey also asks gh for each project's merged PRs. Nothing merges by itself and no deploy read runs until the user turns them on in the window.
- [ ] S5 (A1, A2, A12, A14). Host: the protocol and the commands. `WorkProject` gains merge counts, auto-merge and deploy state; the six commands, with each preview's `confirm` kept for ten minutes and checked; the runtime's new functions declared for the host. Files: `shared/protocol/work.ts`, `shared/commands/registry.ts`, `host/src/work.ts`, `host/src/hobkin-work.d.ts`; tests new `host/test/work-merges-deploys.test.ts`.
- [ ] S6 (A1, A4, A5, A8, A12, A14, A15, A16, A17, A21). Work screen: the row's facts and Auto-merge control, the Merges and deploys lightbox with both confirmations, the spot check mark on a finished card, and sample data in the shape the host sends. Files: `ui/src/features/work/Queue.tsx`, new `ui/src/features/work/MergesDeploys.tsx`, new `ui/src/features/work/merges-deploys.ts`, `ui/src/features/work/finished-cards.ts`, `ui/src/features/work/actions.ts`, `ui/src/features/work/sample.ts`, `ui/src/features/work/sample-actions.ts`, and one line in `ui/src/app/Frame.tsx` for the lightbox; tests new `ui/test/merges-deploys-rules.test.ts`.
- [ ] S7 (A12, A19). Home: the PR totals on This week, and the count to deploy beside each project on Projects. Files: `ui/src/features/home/types.ts`, `ui/src/features/home/input.ts`, `ui/src/features/home/widgets.ts`, `ui/src/features/home/HomeWidgets.tsx`; tests `ui/test/home-model.test.ts`.
- [ ] S8 (A3, A8, A17, A18). Live, with the user's go-ahead, since it merges real PRs and reads real servers. Confirm the live read on one project and see its count match what its deploy tool shows. Turn on auto-merge on one project the user picks and see the first merge by itself in Chat and in the lightbox.

## Open questions

- ~~Which grade counts. The bar asks for a safe A grade read from pi-auto-review's folder (`src/cli/work/grades.mjs:10`, `:32`; `patterns.mjs:175-185`). (a) Keep the bar as written. (b) Count a 032 review whose overall level is `safe` at this exact head. (c) Ask for both.~~ Answered by the user on 2026-11-14: (b), "we are not using pi-auto-review", and "dont just remove, where is being used? we made a custom system". `045-dev-system` S13 points every use at Change Review: "Safe to deploy" with no part above safe, at this exact commit.
- Checks. (a) As decided: passing, or none only in a project with no workflow files. (b) Passing always: a project with no CI never auto-merges. (c) The bar alone, as for a local offer: GitHub's branch protection is then the only check on CI.
- The second confirmation. (a) As decided: two clicks on two screens, Cancel first. (b) Type the project's name to arm Turn on auto-merge: harder to click through by habit, and a few seconds more each time.
- Pace. (a) As decided: one a project a pass, and none while an earlier one's checks fail or run. (b) Also a daily cap, such as 3 a project: a watch takes 2 to 7 days to close (`launches.mjs:9-10`), so without a cap a fault the bar misses could land several times before trouble shows.
- Which trouble turns it off. (a) As decided: any trouble on any change that landed on the project since it was turned on. (b) Only trouble on a change that merged by itself: fewer turn-offs, but a fault in a change the user merged keeps auto-merge going on that project. (c) Only severe trouble: the fewest turn-offs, and an ordinary break never stops it.
- Command reads. (a) As decided: the closed list, with only what selects the read editable. (b) Any command the user types: covers any setup, and one wrong word, `deploy` for `version`, runs unattended every hour.
- A stronger guard for the two settings. (a) As decided: hobkin's code and a visible history. (b) Sign each turn-on with a key in the macOS Keychain that only the app reads, so a line written by anything else is ignored: more work, and a session with the user's rights can still ask the Keychain, behind its prompt.
