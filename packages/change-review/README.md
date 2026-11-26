# change-review

change-review reviews a code change for a person. It gives them three things:

1. A map: the change, split into units they can review one at a time.
2. A level for each unit: `safe` (needs no attention), `mid` (worth a look, and can be patched in a quick follow-up) or `high` (needs a person or a fix).
3. A story: one document, read from top to bottom, that gives them what they need to decide.

The ideas behind it are in [`skills/change-review/FOUNDATION.md`](skills/change-review/FOUNDATION.md). The skills under `skills/` describe each step for an agent, and the code under `src/` carries out those steps.

## Isolation

This package stands alone, so it can be published on its own. It imports only Node's built-in modules and its own files, never the app that hosts it. The host app gives it a checkout, a git range such as `main...feature/x` and, if it has one, a model to ask (`ModelRunner` in `src/types.ts`).

For search, it runs [pi-agentic-search](https://github.com/dantetekanem/pi-agentic-search) as a separate program. `notes/agentic-search-changes.md` lists what the review would like the search tool to report.

## Layout

```
src/            the steps, as code
  types.ts        the types every step writes and reads
test/           node --test
prompts/        the instructions for each model pass
skills/         the design, as agent skills (from the original specification)
notes/          search facts for agentic-search, parked skills, an earlier prototype
```

## Run the tests

From the repository root:

```sh
node --test "packages/change-review/test/**/*.test.ts"
```
