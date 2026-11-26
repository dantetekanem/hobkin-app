# Models: the cfg, the state space and liveness

The keywords and behavior below were checked against the TLC that hobkin runs, v1.7.4 from tla2tools.jar.

## The cfg file

A cfg is a list of keyword sections. Comments are `\*` to the end of a line or `(* ... *)`. Names in it refer to definitions in the spec.

| Keyword | What it does |
| --- | --- |
| `SPECIFICATION Spec` | The behavior formula to check, usually `Init /\ [][Next]_vars` with any fairness. Use this form whenever a liveness property is checked. |
| `INIT Init` and `NEXT Next` | The other way to say it, without fairness. Use one form or the other, never both. |
| `CONSTANT` or `CONSTANTS` | A value for each constant of the spec. Every constant needs one, or TLC stops before it starts. |
| `INVARIANT` or `INVARIANTS` | State predicates that must hold in every reachable state. |
| `PROPERTY` or `PROPERTIES` | Temporal formulas: action properties `[][A]_vars`, and liveness such as `P ~> Q`. |
| `CONSTRAINT` or `CONSTRAINTS` | State predicates that limit the search. TLC still checks the invariants of a state that breaks one, but explores nothing past it. |
| `ACTION_CONSTRAINT` or `ACTION_CONSTRAINTS` | The same for steps: a predicate over a state and its successor, with primes. |
| `SYMMETRY Name` | A set of permutations, defined in the spec, under which states count as the same. |
| `VIEW Name` | An expression TLC fingerprints in place of the whole state, so states that agree on it count as one. |
| `CHECK_DEADLOCK FALSE` | Turns off the deadlock check. It is on by default. |

TLC 1.7.4 rejects a cfg with `ALIAS` or `POSTCONDITION` ("It was expecting a keyword, but did not find it"). Those came in later TLC versions.

Constant values:

- `MaxTries = 2` and `Names = {"a", "b"}` are ordinary values.
- `Jobs = {j1, j2}` makes `j1` and `j2` model values: distinct from each other and from every other value, with nothing known about them. Use them for ids.
- `None = None` makes `None` a single model value. It is the usual "no owner" or "no value".
- `Limit <- SmallLimit` replaces the constant with the definition `SmallLimit` from the spec. Use it for values the cfg cannot write, such as a function or a set of records.

hobkin reads the cfg too. It lists the INVARIANT and PROPERTY names as the run's rules, adds deadlock as a rule unless `CHECK_DEADLOCK FALSE`, and shows the constant assignments as the model's size. Keep all of that in the one cfg beside the spec.

## Model values and symmetry

When nothing in the spec tells two ids apart, every state has copies that differ only by swapping them. Symmetry makes TLC keep one of each:

```tla
EXTENDS TLC
Symmetry == Permutations(Jobs) \cup Permutations(Workers)
```

with `SYMMETRY Symmetry` in the cfg. In the JobLease example this cuts 81 states to 31, and the invariants still hold.

Use it only when the set is model values that the spec treats the same way: no CHOOSE over the set, no ordering, and no single member named in the spec. Never use symmetry while checking liveness. TLC warns that it can miss liveness violations then.

## Bounding what grows

Anything unbounded makes the state space infinite, and TLC runs until the time limit.

- A counter in the code with a limit: put the limit in the guard (`tries[j] < MaxTries`) and make it a constant. This is the code's own bound, so the model stays faithful.
- A counter with no limit in the code (versions, sequence numbers, ids handed out): bound it with a CONSTRAINT such as `\A j \in Jobs : version[j] <= 3`. The check then covers only runs within the bound, so pick one big enough for the interesting cases: at least one wrap, retry or conflict.
- A queue or a log: guard appends with `Len(queue) < MaxQueue`, or bound it with a CONSTRAINT.
- Time: model events, not clocks. A lease that runs out is an `Expire` action that can happen whenever the lease is held. If the code compares times, model the comparison's outcome as a choice, unless the exact order is what you check.
- Messages: a set of messages in flight lets a message be delivered twice when the receive action leaves it in the set. Removing it on receipt models exactly-once delivery. Choose the one the transport really gives.

A CONSTRAINT hides states, so a bug that needs one more step than the bound allows goes unseen. Say what the bound is when you report a run.

## Keeping the state space in minutes

The number of states is roughly the product of the choices each variable has. A function `[S -> T]` has |T| to the power |S| values: three jobs with three statuses is 27, four jobs is 81, and each variable like that multiplies again. What to cut, in this order:

1. Variables no guard or rule reads. Remove them.
2. The number of each kind of thing. Go from three to two before anything else.
3. Bounds on counters and queues. Use the smallest that still shows the behavior.
4. Data inside records. Keep only the fields guards and rules read.
5. Symmetry over interchangeable ids, for safety runs.
6. History variables you added for a rule. A VIEW without them keeps states from splitting on their values.

Signs a model is too big: the distinct state count keeps climbing with no sign of slowing, or the queue of unexplored states keeps growing. In both cases, stop and cut rather than wait.

## Liveness and fairness

The temporal operators TLC checks:

- `[]P`: P always holds. For a state predicate P, TLC checks this like an invariant. List P under INVARIANT instead, so hobkin reports it as one.
- `<>P`: P holds at some point. It stays satisfied even if P turns false later.
- `P ~> Q`: every time P holds, Q holds then or later.
- `[]<>P`: P holds again and again, forever.
- `<>[]P`: from some point on, P holds forever.

Every behavior may stop forever, so without fairness a property that needs something to happen fails, with a trace that ends in `Stuttering`. Fairness rules out the stops the code cannot make:

- `WF_vars(A)`: if A stays enabled without a break, A eventually happens. This fits a worker or a timer that keeps running while there is work.
- `SF_vars(A)`: if A is enabled again and again, even with breaks, A eventually happens. This fits an action that competes with others, like taking a lock that others also take.

Put fairness on each instance when every one must progress: `\A j \in Jobs : WF_vars(Expire(j))`. `WF_vars(\E j \in Jobs : Expire(j))` only promises that some job's lease runs out, not that each one's does. Never put fairness on actions the environment may simply not do: a user who never clicks, a crash, a message that is never sent.

Checked on the JobLease example: `RunningEnds == \A j \in Jobs : status[j] = "running" ~> status[j] # "running"` breaks under plain `Spec`, with a trace that ends in Stuttering while a job runs. It holds under `Spec /\ \A j \in Jobs : WF_vars(Expire(j))`. `<>(\A j \in Jobs : status[j] = "done")` breaks even with weak fairness on every Claim and Finish, because Expire can use up a job's tries. That is the model telling the truth: the code gives up on a job.

TLC says only "Temporal properties were violated", never which one, so hobkin cannot name the broken property when the cfg has several. While you work on one, check it alone with a separate cfg, run with `--cfg` as in the next section. Liveness checking is slower than safety, so keep liveness models small.

## Testing a candidate inductive invariant with TLC

Before you write a TLAPS proof, check that the invariant is inductive. Make TLC start from every state the invariant allows and take one step:

```text
INIT Inv
NEXT Next
CONSTANTS Jobs = {j1, j2} Workers = {w1, w2} None = None MaxTries = 2
INVARIANT Inv
CHECK_DEADLOCK FALSE
```

TLC can only start from `Inv` when it can list those states, so `Inv` must begin with TypeOK, and TypeOK must give each variable a finite set with `\in`. A violation is a state that satisfies `Inv` but steps out of it: the state to rule out by strengthening. No violation means `Inv` is inductive for these constants, which is good evidence that the proof can go through.

Run it with `work.commands.proof <spec> --cfg <that cfg>`. Write the cfg outside `_specs/` and do not commit it. That run tests the invariant, not the model, so never cite it as the model's check. In `proof`, cite the run that used the spec's own cfg.

On the JobLease example, starting from `Inv` gives 81 states and no violation. Starting from the weaker `TypeOK /\ OwnedWhileRunning /\ DoneWasTried` gives 121 states and breaks after one Finish step, from a running job with 0 tries.
