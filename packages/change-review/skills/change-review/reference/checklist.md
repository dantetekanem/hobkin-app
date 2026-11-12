# Checklist for the model pass

Four directions, three aspects. Ask only the rows for the node's exposure. Each "yes" is one risk event with that `direction` and `aspect`.

Aspects: **behaviour** (different result), **performance** (new query, allocation, lock, cache miss), **failure** (new way to raise, time out, or partially complete).

## Runs for everyone

**Up: callers.**
- Does any caller rely on a return shape, nil-ness, ordering or exception that changed?
- Are there callers outside this request path (jobs, tasks, other components)? Does each have a life cycle test?
- Did the signature change while callers outside the diff remain?

**Down: callees.**
- Does a callee now receive a value it never received before (nil, larger collection, different type, unpersisted record)?
- Is a callee now called more often, or inside a loop or transaction it was not in before?

**Sideways: shared state.**
- Does it change what is written to or read from a cache key, memoized value, column, global or thread-local that other code shares?
- Does it change a serialized shape that another process or an older deploy reads?

**Time.**
- During a rolling deploy, old and new code run together. Can old code read what new code wrote?
- After a rollback, is anything left behind that old code mishandles?

## Runs for nobody yet (behind a condition)

**Time: off after on.** Only when the undo fact is `flag-with-residue`.
- While the condition is on, what is written, enqueued or cached? Name it.
- When it goes off, what reads it? Follow async edges: the job runs later, possibly with the condition off, and what it calls may run for everyone.
- Can the condition change between two reads in one request?

**The check itself.** For the node that hosts a new condition check.
- What do its arguments evaluate on every call (an association load, a query)?
- What happens to this path if the flag service raises or times out?
- Is it evaluated once per request, or per item in a loop?

## Takes effect at load or deploy

- **Constant, class-body statement**: who reads it? If nothing does, that is `unreferenced`.
- **Migration**: is it safe on a live table (lock, rewrite, backfill)? Must it deploy before a condition can turn on? Does the new code tolerate the column being absent or empty?
- **Config or dependency**: does it change behaviour of code outside this diff?
- **Deploy skew**: is there a window where code expects the change and it is not there yet, or the reverse?

## Do not ask

- Style, naming, structure.
- Anything the facts already state: who calls it, which tests execute it, what dominates it.
- Whether proof is good enough when the floor says it is missing. It is missing.
