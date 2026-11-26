---
name: tla-plus
description: How to write, check and fix TLA+ models of code state machines, and TLAPS proofs of them, the way hobkin's proof check runs them (SANY, then TLC with the .cfg beside the spec, then tlapm --strict). Covers choosing variables, TypeOK, Init and Next, cfg files, invariants, deadlock, liveness and fairness, keeping the state space small, reading counterexamples and parse errors, and inductive-invariant proofs. Use when you write or fix a spec under _specs/tla/, its .cfg or a TLAPS proof, or when a proof check run breaks, fails or reports an action that never fired.
---

# TLA+ models and TLAPS proofs in hobkin

Your work directions already say where a model goes, which comments it carries and how to run the check. This skill is the knowledge behind those rules: how to model a piece of code so that the check means something, how to read what comes back, and how to write a proof that TLAPS accepts.

Read the files beside this one when you need them:

- `models.md`: the cfg keywords TLC 1.7.4 accepts, model values, symmetry, bounding and shrinking the state space, liveness and fairness, and checking a candidate inductive invariant with TLC.
- `errors.md`: SANY, TLC and TLAPS messages, what each one means, and the fix.
- `proofs.md`: the TLAPS proof language, the backends, what TLAPS handles badly, and how to read a failed obligation.
- `example/JobLease.tla` and `example/JobLease.cfg`: a small complete model with an inductive-invariant proof. The walkthrough is at the end of this file.

## What hobkin runs and records

`work.commands.proof <spec> --head <sha>` runs three steps on the spec and the `<Machine>.cfg` beside it:

1. SANY parses the spec. A parse error ends the run with the file, line and column.
2. TLC checks the model the cfg describes, breadth first, so a counterexample is a shortest one. It checks every name under INVARIANT and PROPERTY, and deadlock unless the cfg says `CHECK_DEADLOCK FALSE`. A run stops at 20 minutes by default.
3. TLAPS runs `tlapm --strict` on the spec when the spec has a proof (a THEOREM or LEMMA with BY, OBVIOUS, OMITTED, PROOF or numbered steps) and the model, if there is one, held. Under `--strict`, a step with no proof or with OMITTED counts as not proved.

The command prints one line of JSON: the run `id`, `outcome` (`holds`, `broken`, `error` or `stopped`), `broken` (the rule that broke), `message`, `stats`, `counts`, and `result`, the path of the run's `result.json`. Read that file when a run does not hold. It has `rules` (each name, kind and status), `actions` (each action and how many new states it found), `trace` (each step's `n`, `action`, `code` from your `\* code:` comment, and `vars`), `proof.obligations` (each step's `id`, `label`, `status`, `backend`, and for a failed one its `goal` and the `known` facts), and `log`.

`counts` is true only when the run is evidence: it held, every action found at least one new state, and it checked this head and this exact spec. Anything else is not evidence, whatever the outcome says.

When the spec has a cfg, the outcome and `counts` are the model check's. A proof that fails leaves them as they are, so check `proof.proved` in `result.json` and cite it separately in `proof`.

## Modeling a state machine from code

Model what the code does now, not what it was meant to do. A model that copies the design document checks the design.

Find the state first. List what the code stores and reads back: status columns and enums, flags, nullable fields that mean something when set, counters, queues, timers and in-flight requests. Each becomes a variable, usually a function over a set of ids: `status \in [Jobs -> {"queued", "running", "done"}]`. Leave out data no guard reads and no rule mentions. A variable that never affects what can happen next only multiplies states.

Then find the actions. Every code path that changes stored state is one: a request handler, a job, a callback, a timer firing, a retry, a crash and restart, a user action, a message lost or delivered twice. Each becomes one named operator. Its guard is the code's conditions (the `if`, the `WHERE` clause, the lock check), and its primed assignments are the code's writes.

Each action is one atomic step. When the code reads, decides and then writes without a lock or a transaction around it, the read and the write are two actions. Give the process a program counter (`pc[p] \in {"idle", "read", ...}`) and a variable for what it read, so TLC can put another process between the two. Races hide exactly there.

The shape of the module:

```tla
---- MODULE Machine ----
\* models: path/to/code.ts
\* words: One sentence on what the machine is.
EXTENDS Naturals
CONSTANTS Ids, None, MaxTries
VARIABLES status, owner, tries
vars == <<status, owner, tries>>

TypeOK == /\ status \in [Ids -> {"idle", "busy"}]
          /\ ...
Init == /\ status = [i \in Ids |-> "idle"]
        /\ ...
\* code: path/to/code.ts:42
Start(i) == /\ status[i] = "idle"
            /\ status' = [status EXCEPT ![i] = "busy"]
            /\ UNCHANGED <<owner, tries>>
Next == \/ \E i \in Ids : Start(i)
        \/ ...
Spec == Init /\ [][Next]_vars
====
```

The rules that keep it checkable:

- Every action says what happens to every variable: a primed assignment, or the variable in its `UNCHANGED`. TLC stops with an error when an action leaves one out.
- `Next` is a disjunction of named actions, with `\E` for their parameters. TLC reports coverage by operator name. A disjunct written inline in `Next` is reported as `Next`, and hobkin adds those together, so a dead inline branch hides behind a live one.
- `vars` lists every variable, and `Spec == Init /\ [][Next]_vars`. `[Next]_vars` also allows steps that change none of `vars`. TLA+ specs are written that way on purpose, and it is why a liveness property needs fairness. Add fairness to `Spec` only when the cfg checks a liveness property, and only for actions the code really guarantees will happen.
- Ids are model values (`Jobs = {j1, j2}`), never numbers, unless the code does arithmetic on them. "No value" is its own model value, `None = None`, with an ASSUME that it is none of the ids.
- Anything that counts up has a bound. Take the bound from the code when it has one (a retry limit becomes `tries[j] < MaxTries` in the guard). When the code has no limit, bound it in the cfg with CONSTRAINT and say that the check covers only runs inside the bound.
- Two or three of each thing. Most bugs need two actors and one shared thing to show up. Three is for bugs that need a third party, such as two workers and a reaper.
- Aim for a state space TLC finishes in a few minutes. Tens of thousands to a few million states is the usual range. hobkin draws the state graph only up to 50,000 states. `models.md` lists what to cut when it grows.

Put `\* code: <path>:<line>` above each action, naming the line where the transition happens: the write, or the call that makes it. hobkin reads a `\* words:` or `\* code:` comment only when it starts at column 0 directly above the definition, with no blank line between. A `\* words:` line above `EXTENDS` describes the module itself.

## What to check

An invariant is a state predicate: no primes and no temporal operators. It must hold in every reachable state. List TypeOK first, then the rules the code is supposed to keep. Write each rule as the property a user or the data depends on ("a job has an owner exactly while it runs"), not as a restatement of a guard.

An action property, `[][A]_vars` under PROPERTY, says every step satisfies `A`. Use it for rules about transitions: "a done job never goes back to queued" is `[][\A j \in Jobs : status[j] = "done" => status'[j] = "done"]_vars`.

A liveness property says something eventually happens: `P ~> Q`, `<>P`, `[]<>P`. Every behavior may stop and stutter forever, so a liveness property fails without fairness on the actions that make progress. Weak fairness `WF_vars(A)` says that an action enabled without a break eventually happens. Strong fairness `SF_vars(A)` says that an action enabled again and again, even with breaks, eventually happens. `models.md` covers when each fits.

Deadlock is a state where no action is enabled. TLC reports it by default, and it is usually a bug: a status the code can enter but never leave. Turn it off with `CHECK_DEADLOCK FALSE` only when the machine is meant to stop, and say why in a comment. Then keep the check for stops you did not mean with an invariant such as `StopsOnlyWhenFinished == (~ENABLED Next) => Finished`, where `Finished` describes the intended end states. TLC 1.7.4 evaluates ENABLED in an invariant.

## Every action must fire

hobkin counts an action as fired when TLC's coverage shows it found at least one new distinct state. That is stricter than "it was enabled". An action whose every successor was already found by another action reports 0, and the run then does not count. This happens to a reset that returns to the initial state and to a toggle back to a state reached earlier.

When an action shows 0, find out why:

- The guard can never be true. That is either a bug in the model or dead code. Read the guard against the code.
- The constants are too small for it, such as a retry action with `MaxTries = 1`. Raise the constant.
- The action only revisits states. If that is the code's real behavior, add a history flag that only that action sets (`everReset' = TRUE`). Its states are then new, and no rule reads the flag. Say in `proof` why the flag is there.

## Reading a run that did not hold

A broken invariant comes with a trace from the initial state to the first state that breaks it. Walk it step by step: each step names the action and its `\* code:` line, and `vars` holds every variable after that step. At each step, ask whether the code allows that step from that state. If it does, the code has the bug, and the trace is the reproduction. If it does not, the model is wrong: a guard is missing or too loose, or an action does more than the code does. Fix whichever it is, then check again.

A deadlock trace ends in the stuck state. Look for the status with no way out, or a guard that waits on something no action provides.

A liveness trace ends in `Stuttering` (the system stops for good) or `Back to state n` (a loop that repeats forever without the good thing). A stuttering ending means an action that should have happened has no fairness. A loop means the fairness you have does not cover that loop. Decide whether the code really guarantees progress there before adding fairness. If it does not, the property is false and the code may have a real liveness bug.

An `error` outcome means TLC could not evaluate something, or SANY could not parse the spec. The message is the tool's own words. Look it up in `errors.md`.

A `stopped` outcome at the time limit means the state space is too big. TLC found no violation in the states it saw, but the run is not evidence. Shrink the model (`models.md`).

## Proofs with TLAPS

TLC checks one small world. A TLAPS proof shows a safety property for every size of world the ASSUMEs allow, but it costs much more effort. Write one when the brief asks for it, or when the property matters at sizes TLC cannot reach. hobkin runs TLAPS only after the model holds.

The proof goes in the same spec file, after the definitions it uses, and the spec says `EXTENDS TLAPS` for `PTL` and the backend names. hobkin finds `TLAPS.tla` only through the TLAPS install on the machine. Without one, SANY stops with "Cannot find source file for module TLAPS". Say so in `proof` and carry on.

The standard safety proof has three parts:

1. `Init => Inv`.
2. `Inv /\ [Next]_vars => Inv'`, split into one step per action and one for `UNCHANGED vars`.
3. `Spec => []Inv`, by `PTL` from the two above with `DEF Spec`.

Step 2 only works when `Inv` is inductive: every step from any state that satisfies `Inv` lands in a state that satisfies `Inv`, reachable or not. The property you care about is rarely inductive on its own. Strengthen it: when a step fails, read the failed goal, build a state that satisfies `Inv` but breaks the goal, see which fact about reachable states rules that state out, and add the fact as a conjunct of `Inv`. Repeat until every step proves. Put each new conjunct in the cfg as an invariant too, so TLC confirms it holds before you try to prove it. `models.md` shows how to make TLC test a candidate for inductiveness before you write the proof.

TLAPS is good at safety, and weak at liveness, nonlinear arithmetic, and anything that needs induction you have not written. Prefer TLC for liveness. `proofs.md` has the syntax, the backends and how to read failed obligations.

## The worked example

`example/JobLease.tla` models workers that lease jobs from a queue. A worker claims a queued job that has tries left, then finishes it, or the lease expires and the job goes back to the queue. Its code paths are made up for the example. A real model names real files and lines.

With two jobs, two workers and `MaxTries = 2`, TLC 1.7.4 finds 81 distinct states at depth 9, and all four invariants hold. Claim, Finish and Expire each found new states, about 20 to 35 apiece (the split changes from run to run when TLC has several workers), so a run like that counts. `CHECK_DEADLOCK FALSE` is there because the machine stops by design once every job is done or out of tries.

The property it cares about is `DoneWasTried`: a done job was tried at least once. It holds in every reachable state, but it is not inductive. From a state with a running job that has 0 tries, which no behavior reaches, `Finish` produces a done job with 0 tries. TLC confirms this when started from every state that satisfies `TypeOK /\ OwnedWhileRunning /\ DoneWasTried`: the invariant breaks after one Finish step. The proof uses `TriedUnlessQueued` instead (a running or done job was tried at least once). TLC started from every state that satisfies the stronger `Inv` finds no violation. `AlwaysDoneWasTried` then gets `DoneWasTried` from `Inv` with PTL.

The proof follows the standard shape and was written for TLAPS 1.6. It has not been run through tlapm yet, so treat its exact citations as a starting point.

## Claims

A model check covers the small world in the cfg. A proof covers the model for every world its ASSUMEs allow. Neither one is about the code itself, so never write that the code is proved. Write what was checked: "the model of `lease.ts` holds for two jobs and two workers", or "TLAPS proved the model's invariant for any number of jobs".

## Sources

Leslie Lamport, Specifying Systems, https://lamport.azurewebsites.net/tla/book.html. The TLA+ home page, https://lamport.azurewebsites.net/tla/tla.html. The TLAPS documentation, https://proofs.tlapl.us/. Learn TLA+, https://learntla.com/. The tlaplus/Examples repository, https://github.com/tlaplus/Examples. The tlapm source and its standard library, https://github.com/tlaplus/tlapm.
