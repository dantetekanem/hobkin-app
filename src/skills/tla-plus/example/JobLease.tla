---------------------------- MODULE JobLease ----------------------------
\* models: src/jobs/lease.ts
\* words: Workers lease jobs from a queue, finish them or lose the lease, and a job is retried up to a limit.
EXTENDS Naturals, TLAPS

CONSTANTS Jobs, Workers, None, MaxTries

\* None is not a worker, and the try limit is a natural number. Proof steps cite this by name.
ASSUME ConstantsOK == None \notin Workers /\ MaxTries \in Nat

VARIABLES status, owner, tries

\* words: Every variable, for UNCHANGED and for the steps that change nothing.
vars == <<status, owner, tries>>

\* words: Each job is queued, running or done, its owner is a worker or None, and it has tried at most MaxTries times.
TypeOK ==
  /\ status \in [Jobs -> {"queued", "running", "done"}]
  /\ owner \in [Jobs -> Workers \cup {None}]
  /\ tries \in [Jobs -> 0..MaxTries]

\* words: Every job starts queued, with no owner and no tries.
Init ==
  /\ status = [j \in Jobs |-> "queued"]
  /\ owner = [j \in Jobs |-> None]
  /\ tries = [j \in Jobs |-> 0]

\* code: src/jobs/lease.ts:14
\* words: A worker takes a queued job that has tries left, and the try counts.
Claim(w, j) ==
  /\ status[j] = "queued"
  /\ tries[j] < MaxTries
  /\ status' = [status EXCEPT ![j] = "running"]
  /\ owner' = [owner EXCEPT ![j] = w]
  /\ tries' = [tries EXCEPT ![j] = @ + 1]

\* code: src/jobs/lease.ts:31
\* words: The worker that holds a running job finishes it.
Finish(w, j) ==
  /\ status[j] = "running"
  /\ owner[j] = w
  /\ status' = [status EXCEPT ![j] = "done"]
  /\ owner' = [owner EXCEPT ![j] = None]
  /\ UNCHANGED tries

\* code: src/jobs/lease.ts:47
\* words: A running job's lease runs out, and the job goes back to the queue.
Expire(j) ==
  /\ status[j] = "running"
  /\ status' = [status EXCEPT ![j] = "queued"]
  /\ owner' = [owner EXCEPT ![j] = None]
  /\ UNCHANGED tries

\* words: One step is a claim, a finish or an expiry, by some worker on some job.
Next ==
  \/ \E w \in Workers, j \in Jobs : Claim(w, j)
  \/ \E w \in Workers, j \in Jobs : Finish(w, j)
  \/ \E j \in Jobs : Expire(j)

\* words: The machine starts in Init, and every step is a Next step or changes nothing.
Spec == Init /\ [][Next]_vars

\* words: A job has an owner exactly while it runs.
OwnedWhileRunning == \A j \in Jobs : (owner[j] # None) <=> (status[j] = "running")

\* words: A done job was tried at least once.
DoneWasTried == \A j \in Jobs : status[j] = "done" => tries[j] >= 1

\* words: A running or done job was tried at least once. This is what makes DoneWasTried provable step by step.
TriedUnlessQueued == \A j \in Jobs : status[j] # "queued" => tries[j] >= 1

\* words: What the proof carries from each state to the next.
Inv == TypeOK /\ OwnedWhileRunning /\ TriedUnlessQueued

\* words: The first state satisfies the invariant.
LEMMA InitHolds == Init => Inv
  BY DEF Init, Inv, TypeOK, OwnedWhileRunning, TriedUnlessQueued

\* words: Any step from a state that satisfies the invariant leads to one that satisfies it too.
LEMMA StepKeeps == Inv /\ [Next]_vars => Inv'
<1> SUFFICES ASSUME Inv, [Next]_vars PROVE Inv'
  OBVIOUS
<1>1. ASSUME NEW w \in Workers, NEW j \in Jobs, Claim(w, j) PROVE Inv'
  BY <1>1, ConstantsOK DEF Inv, TypeOK, OwnedWhileRunning, TriedUnlessQueued, Claim
<1>2. ASSUME NEW w \in Workers, NEW j \in Jobs, Finish(w, j) PROVE Inv'
  BY <1>2 DEF Inv, TypeOK, OwnedWhileRunning, TriedUnlessQueued, Finish
<1>3. ASSUME NEW j \in Jobs, Expire(j) PROVE Inv'
  BY <1>3 DEF Inv, TypeOK, OwnedWhileRunning, TriedUnlessQueued, Expire
<1>4. CASE UNCHANGED vars
  BY <1>4 DEF Inv, TypeOK, OwnedWhileRunning, TriedUnlessQueued, vars
<1>5. QED
  BY <1>1, <1>2, <1>3, <1>4 DEF Next

\* words: The invariant holds in every state of every behavior.
THEOREM AlwaysInv == Spec => []Inv
  BY InitHolds, StepKeeps, PTL DEF Spec

\* words: In every behavior, a done job was always tried.
THEOREM AlwaysDoneWasTried == Spec => []DoneWasTried
<1>1. Inv => DoneWasTried
  BY DEF Inv, TriedUnlessQueued, DoneWasTried
<1>2. QED
  BY AlwaysInv, <1>1, PTL
=============================================================================
