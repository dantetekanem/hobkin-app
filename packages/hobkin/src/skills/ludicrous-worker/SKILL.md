---
name: ludicrous-worker
description: How a Ludicrous mode worker writes its trail and lands its packet. Load it before starting a packet.
---

# Working a Ludicrous packet

Your packet's id, area and paths are in your task. `land` is on your PATH. Check commands are not: test runners, compilers, linters, package managers and `java` answer "Workers don't run checks. Your leader does." and the refusal is logged.

## The trail

`_specs/ludicrous/trails/<area>/<packet>.md`, written by you alone:

```markdown
# api-12 The users route

## Did
What you wrote, file by file.

## Tests
- `test/api/users.test.ts` › "pages through users": passes because `listUsers` slices `limit` from `offset` (src/api/users.ts:14), and the route reads both from the query (line 31). Assumes the foundation's `db.query` returns rows in id order, as its spec's Decisions say.

## Commit
The commit `land` printed.

## Needs
- foundation: `db.query` should accept a `limit` above 100.
```

Every test you wrote has its line: why you expect it to pass, and what you assumed. Leave out Needs when there are none.

## land

`land <packet> "<what it does>"` commits your packet's paths and your trail from the branch head, and nothing else. Write the trail before you land, then land again after you add the commit to it.

- "Landed <packet> as <commit>.": it is on the branch.
- "<paths> changed on the branch since you read them at <commit>": another agent changed a path you own. Run `git show <commit>..$LUDICROUS_BRANCH -- <path>` to read the change, fold it into your work, then `land <packet> "<message>" --read <the commit it names>`.
- "Nothing of <packet> differs": your paths already hold what you wrote.

## Unfinished work from an earlier worker

When your task names a patch, an earlier worker on this packet was stopped. Apply it first with `git apply <patch>`, read what it did, and finish the packet.
