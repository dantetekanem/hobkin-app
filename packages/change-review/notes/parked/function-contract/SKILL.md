---
name: function-contract
description: Read or write the cached contract of a definition (inputs, return, effects, flags read, raises, caller assumptions), keyed by a hash of the definition and its callees. Use when a review needs to know what a neighbouring function does without reading its source, and to keep repeated reviews of an old codebase cheap.
compatibility: Requires graph.json from node-map (for node.contract.key) and a writable .review-cache/ directory shared across reviews.
---

# Function contract

A contract is a one-screen statement of what a definition does. It is written once per version of the code and reused by every later review.

## Read

`node.contract.key` in `graph.json` is the cache key. Look for `.review-cache/contracts/<key>.json`. A hit is final: use it, do not re-read the source.

The key hashes the definition's fingerprint with the fingerprints of everything it calls. If a callee changes, the key changes. If the key is unchanged, nothing the contract describes has changed.

## Write (on a miss)

1. Read the definition from the pack section or with `agentic-search collect <path>:<line> --max-depth 1`. Read callees through their own contracts.
2. Fill `../change-review/schemas/contract.schema.json`. Write only what the code shows:
   - `effects`: writes, enqueues, cache access, outbound IO, mutation of arguments or shared state.
   - `assumes`: what callers must guarantee (non-nil, persisted, inside a transaction, already authorized).
   - `flags_read`: flag names checked in the body.
3. Copy `partial` from `node.contract.partial`. It is true when a callee is reached by dynamic dispatch. Do not set it to false yourself.
4. Save to `.review-cache/contracts/<key>.json`.

Use the cheapest model available. A contract is a description, not a judgment.

## Stop propagating

After writing, compare with the previous contract for the same `symbol` if one exists. If every field except `key` and `fingerprint` is equal, the change did not alter the contract: callers do not need their contracts rewritten, and the `up` direction of the checklist has nothing to check for this node.

## Do not

- Write a contract from memory of the codebase, or for a definition you have not read at this fingerprint.
- Put opinions, risks or suggestions in a contract. Those are risk events.
- Cache anything keyed by path or line. Only the key.
