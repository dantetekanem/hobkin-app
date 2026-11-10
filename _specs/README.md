# Specs

Work in this project starts from a spec. An agent or a person writes down what will be true when the work is done, how that will be proven, and the steps to get there. hobkin's Change Review reads the same files to tell the story of a change, so the format is small and strict.

The convention is the same in every project hobkin works on.

## Layout

    _specs/
      README.md            this file
      <id>/
        spec.md            required
        notes.md           optional: findings and decisions made while working
        ...                optional attachments (mockups, sample data)

`<id>` is a unique kebab-case name. It does not change once work starts.

- hobkin's work agents use the item id and slug, the same text as the branch after `hobkin/`. Branch `hobkin/3fa9c1-fix-login-redirect` has its spec in `_specs/3fa9c1-fix-login-redirect/`.
- People planning ahead may use a number and a slug, such as `004-signin`.

## spec.md

A spec starts with JSON frontmatter, then fixed sections in this order. Leave a section out when it has nothing to say. Outcome and Acceptance are always present.

    ---
    {
      "id": "004-signin",
      "title": "Sign in with OpenAI",
      "kind": "work",
      "status": "ready",
      "depends": ["002-host"],
      "updated": "2026-11-09"
    }
    ---
    # Sign in with OpenAI

    ## Outcome
    One paragraph. What a person can see or do once this is finished.

    ## Decisions
    - Boundaries, contracts and behavior that are already settled.

    ## Out of scope
    - What this work will not do.

    ## Acceptance
    - A1. A pass or fail statement that someone outside the code can observe.
    - A2. Another one.

    ## Proof
    - A1. `host/test/signin.test.ts` › "finishes the sign-in over the socket"
    - A2. check: open the app signed out. The sign-in screen shows before the chat.

    ## Steps
    - [ ] S1 (A1). First piece of work.
    - [ ] S2 (A1, A2). Next piece of work.

    ## Open questions
    - A choice that could change the work, with the options and what each one costs.

### Frontmatter

| Field | Meaning |
| --- | --- |
| `id` | Same as the folder name. |
| `title` | Short name of the work. |
| `kind` | `work` (the default) or `context`. A context spec describes the product or a standing rule and has no steps. |
| `status` | `draft`, `ready`, `doing`, `done` or `dropped`. |
| `depends` | Ids of specs that must be done first. |
| `updated` | Date of the last edit, `YYYY-MM-DD`. |

### Rules

- Acceptance ids (`A1`, `A2`) and step ids (`S1`, `S2`) are never renumbered. To retire one, strike it through and say why.
- An acceptance line describes a result, with the failure or empty case when that matters. "Tests pass" and "the file exists" are not acceptance.
- Each acceptance id has one Proof line. It names a test (the path, then `›`, then the test name) or starts with `check:` and says what to look at. An acceptance id without a Proof line counts as unproven.
- A step names the acceptance ids it serves in parentheses. Check its box when its proof passes, and never before.
- When a commit finishes a step, start its subject with the step id, for example `S2: answer sign-in prompts over the socket`. Change Review uses this to order the story.
- A spec records intent. It grants no permission to deploy, publish, send or delete.

## How Change Review reads a spec

- Each acceptance line becomes a spec node in the graph.
- Each Proof line links that node to the test it names. A test that does not exist, or an acceptance line with no proof, shows as a warning on the node.
- Steps set the order of the story. Commits that name a step fill it with the code they changed.
- Outcome opens the story. Out of scope and Open questions close it.
