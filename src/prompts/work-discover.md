# Work mode: find the user's projects

Work mode is a proactive agent mode to get work done, and it starts with you. The user named one folder, `work.folder`. Find the projects in it, look at each one, and propose the ones worth working on. The user will pick from your proposals, so make that choice take seconds.

Change nothing in any repository. The request's `work.known` lists what Companion already knows. Do not read those again.

## Where to look

Look only inside `work.folder`. Find git repositories up to two levels down, and skip `node_modules`:

```sh
find "$FOLDER" -maxdepth 3 -name .git -not -path '*/node_modules/*'
```

Do not search anywhere else: not the home folder, not Pi's sessions, not the user's GitHub account. They told you where to start because a wider search wastes their time and money. They can name another folder later.

## Clean the list

A repository cloned twice, or a worktree of another repository, counts once: compare `git rev-parse --git-common-dir` and the remote URL. Set aside clones with no commits from the user, unchanged forks, tutorials, and anything with no commit in two years and nothing deployed. Keep those for the report.

## Propose

Keep each look cheap. Read the README, the manifest and `AGENTS.md`, and run `git log --oneline --since=90.days.ago | wc -l`, plus `gh pr list`, `gh issue list` and `gh run list --limit 3` if it has a GitHub remote. Do not read the code, run tests or install anything. A later agent studies each project the user takes.

Propose each one as soon as it is ready, so the list grows on the user's screen. Pipe one JSON object to `work.commands.propose`:

```json
{
  "name": "finboard-api",
  "path": "/absolute/path/to/repository",
  "summary": "One line on what the project is.",
  "level": "critical",
  "reason": "Why that level.",
  "found": "One or two lines: activity, whether it is running, CI, PRs, advisories, what is stale.",
  "first": [
    { "key": "ci:main", "kind": "fix", "title": "Fix the failing job spec", "brief": "Evidence, who benefits, the first change, how to prove it worked." }
  ]
}
```

Give up to three `first` items, written as real work you found. `kind` is one of `security`, `fix`, `update`, `chore`, `improvement` or `feature`.

Suggest `critical` for something deployed with real users or money, a client's repository, or data that cannot be lost. Suggest `important` for what the user depends on, such as a package in their own Pi setup or a repository with commits most weeks. Anything else that is alive is `casual`.

## Report

Start with one line: `Useful: Looked at 34 repositories and proposes 7. They are in Work Mode.` Then add a `Left out` section listing each repository you set aside and why, so the user can still ask for it.
