---
name: ludicrous-planner
description: The formats a Ludicrous mode planner writes in, the plan for people and for hobkin, the questions for the user, and the area specs. Load it before writing any planning file.
---

# Ludicrous planning formats

Everything you write lives in the project's folder. Each file has one writer: the one your task names.

## Round files

`_specs/ludicrous/planning/round-<n>/<lens>.md`, free Markdown. Start with the plan through your lens in a few lines, then the detail. Name each choice with the option you would pick and why.

## plan.md

The plan for people: the idea in the user's words, then each area with what it builds and what it builds on, the waves in order, the contracts between areas, and what done means for the whole project.

## plan.json

The same plan for hobkin. hobkin refuses to build from a plan that breaks these rules, and tells the delivery planner why.

```json
{
  "areas": [
    {
      "id": "foundation",
      "name": "Foundation",
      "depends": [],
      "writer": "architecture",
      "summary": "The repository's skeleton, build, test runner, lint, run guide and shared contracts.",
      "checks": ["pnpm install --frozen-lockfile", "pnpm -r build", "pnpm -r test", "pnpm -r lint"],
      "leaderPaths": ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]
    },
    {
      "id": "api",
      "name": "API",
      "depends": ["foundation"],
      "writer": "data",
      "summary": "The HTTP API and its data.",
      "checks": ["pnpm --filter api test", "pnpm --filter api lint"]
    }
  ],
  "checkCommands": ["pnpm", "npm", "npx", "node", "tsc", "vitest", "eslint", "java"],
  "questions": [
    {
      "id": "q1",
      "question": "Where do the users' files live?",
      "options": [{ "id": "a", "label": "On the server's disk" }, { "id": "b", "label": "In S3" }],
      "pick": "b",
      "why": "It scales past one machine with no change to the API."
    }
  ]
}
```

- `id`: lowercase letters, digits and dashes. It is the area's folder, `_specs/<id>/`, and its trails folder. Never an id a spec already has in this project.
- `foundation` is always there and depends on nothing. Every other area depends on at least one area, and the dependencies never go round in a circle. An area opens once every area it depends on has committed its contracts.
- `writer`: the planner who writes the area's spec, one of `product`, `architecture`, `data`, `quality`, `delivery`. Spread the areas across all five.
- `checks`: the commands the area's leader runs, in order, in a fresh checkout of the branch head: install, build, test, lint, and TLC for the area's models. They must run with no one at the keyboard and fail with a non-zero exit.
- `leaderPaths`: only the foundation's: the package manifests and lockfiles. Nobody else writes them.
- `checkCommands`: every program a check runs, by name: the package manager, the test runner, the compiler, the linter, and `java` for TLC. Workers are refused all of them.
- `questions`: only the questions whose answer changes the path. Each has a `pick` among its options. When the user leaves one unanswered, the build takes the pick.

## questions.md

The same questions for people: each with its options, what each costs, and the pick with its reason.

## An area's spec

`_specs/<id>/spec.md`. When the project has `_specs/README.md`, follow it. Otherwise use this format:

````markdown
---
{
  "id": "api",
  "title": "API",
  "kind": "work",
  "status": "ready",
  "depends": ["foundation"],
  "updated": "YYYY-MM-DD"
}
---
# API

## Outcome
One paragraph: what a person can see or do once this area is done.

## Decisions
- Contracts this area offers other areas, exactly: names, shapes, errors.
- Contracts it builds on, by the area that offers them.
- Its check commands, as the plan gives them.

## Out of scope
- What this area will not do.

## Acceptance
- A1. A pass or fail statement someone outside the code can observe.

## Proof
- A1. `path/to/test-file` › "the test's name"

## Steps
- [ ] S1 (A1). The first piece of work.
````

Each acceptance line has one proof line, a test that will exist or a `check:` that says what to look at. Steps name the acceptance ids they serve, and their boxes stay unchecked: the area's leader checks each one when its proof passes. Order the steps so the area's contracts land first, since other areas wait on them.
