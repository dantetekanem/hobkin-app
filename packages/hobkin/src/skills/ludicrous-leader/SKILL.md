---
name: ludicrous-leader
description: How a Ludicrous mode area leader writes packets, checks committed work, keeps its area's status, and waits for its workers. Load it before leading an area.
---

# Leading a Ludicrous area

Three commands are on your PATH: `land`, `check` and `wait`. Your area's id is in `$LUDICROUS_AREA`, and the run's branch in `$LUDICROUS_BRANCH`.

## queue.jsonl

`_specs/ludicrous/trails/<area>/queue.jsonl`. One packet a line, as JSON:

```json
{"id":"api-12","step":"S3","title":"The users route","brief":"Add GET /users with paging, as Decisions say. Tests in test/api/users.test.ts.","paths":["src/api/users.ts","test/api/users.test.ts"],"tier":"mid","after":["api-10"]}
```

- `id`: `<area>-<n>`, never used twice. To change a packet that no worker has taken yet, write it again with the same id: the last line wins. `"cancelled": true` takes it back.
- `paths`: files or folders the worker owns. No two open packets own the same path. A worker can write nothing else.
- `tier`: `mid` for ordinary work, `high` for hard work, `fast` for mechanical work.
- `after`: packets that must be done first. Leave it out when there are none.
- A fix packet that `check` files has a `fix` field: the check that failed, the commit that brought it and the trail whose assumption was wrong.

hobkin starts a worker for each ready packet as soon as the tier has room, a share for each area by how many ready packets it has. The run's packet states are in `$LUDICROUS_RUN/packets.json`: `running`, `done`, `back` (ready again) or `failed` (ended three times without landing).

## status.json

`_specs/ludicrous/trails/<area>/status.json`:

```json
{ "contracts": true, "done": false, "checked": { "head": "<commit>", "passed": true, "at": "<time>" } }
```

`check` writes `checked`. You set `contracts` once the contracts other areas build on are committed and pass, and `done` once every step of your spec is checked.

## leader.md

Your notes for the leader after you: what is in flight, what failed and why, what comes next.

## Commands

- `land leader "<message>"`: commits your queue, status, notes, your area's spec and notes, and for the foundation the manifests and lockfiles. Run it after each change to them.
- `check`: runs your area's checks from the plan on the branch head, in a check worktree. It exits 0 when they pass and 1 when one fails, with the end of its log. It waits for a free worktree, and refuses when your area's check is running already.
- `wait`: returns when your area has new commits, new or changed trails, a trail of another area that names your area under Needs, a packet that failed or came back, or fewer ready packets than it was given with `--low <n>` (2 by default), and after ten minutes at the latest. It prints what changed.

## A trail's Needs

A worker of any area writes what it needs under `## Needs` in its trail, naming the area: `- api: GET /users returns the user's team id`. Read the needs that name your area and write the packets for them.
