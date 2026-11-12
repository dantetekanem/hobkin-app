# change-review

Reviews a code change on behalf of a person. It hands them:

1. **A map**: the change as reviewable units.
2. **A level per unit**: `safe` (no attention needed), `mid` (worth a look, fast follow) or `high` (needs a person or a fix).
3. **A story**: one document, read top to bottom, that lets them decide.

The theory is in [`skills/change-review/FOUNDATION.md`](skills/change-review/FOUNDATION.md). The skills under `skills/` describe each step for an agent; the code under `src/` implements them.

## Isolation

This package stands alone so it can be published by itself. It imports only Node's own modules and its own files. Nothing here imports the app that hosts it. A host hands it a checkout, a range and, when it has one, a model to ask (`ModelRunner` in `src/types.ts`).

It uses [pi-agentic-search](https://github.com/dantetekanem/pi-agentic-search) for search, as a program it runs. The facts the review would like the search tool to report are in `notes/agentic-search-changes.md`.

## Layout

```
src/            the steps, as code
  types.ts        the contract every step writes and reads
test/           node --test
prompts/        what the model passes are told
skills/         the design, as agent skills (from the original specification)
notes/          search facts for agentic-search, parked skills, an earlier prototype
```

## Run the tests

```sh
node --test "packages/change-review/test/**/*.test.ts"
```
