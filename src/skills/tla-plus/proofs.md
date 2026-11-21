# Proofs with TLAPS

hobkin runs `tlapm --strict` on the spec file itself, after TLC, and only when the model, if there is one, held. The proof therefore lives in the same file as the model, below the definitions it uses. TLC skips the theorems, so they do not change the model check.

## Module layout

```tla
---- MODULE Machine ----
EXTENDS Naturals, TLAPS
CONSTANTS Ids, None, Max
ASSUME ConstantsOK == None \notin Ids /\ Max \in Nat
VARIABLES ...
... TypeOK, Init, the actions, Next, Spec, the invariants ...
Inv == TypeOK /\ ...
LEMMA InitHolds == Init => Inv
  ...
LEMMA StepKeeps == Inv /\ [Next]_vars => Inv'
  ...
THEOREM AlwaysInv == Spec => []Inv
  ...
====
```

`EXTENDS TLAPS` gives `PTL`, which temporal steps need, and the names that pick a backend. Name each ASSUME, so steps can cite it. TLAPS uses an assumption only where a step cites it or a `USE` names it.

TLAPS also ships modules of proved lemmas: `NaturalsInduction`, `FiniteSetTheorems` (for `Cardinality`), `SequenceTheorems` (for `Len`, `Append` and the rest) and `WellFoundedInduction`. Extend one when a proof needs facts about those operators. TLAPS knows little about them without the lemmas.

## Theorems and steps

A theorem states what it proves:

```tla
THEOREM Name == Formula
LEMMA Name == ASSUME NEW x \in S, P(x) PROVE Q(x)
```

`THEOREM`, `LEMMA`, `PROPOSITION` and `COROLLARY` mean the same thing to TLAPS. `ASSUME ... PROVE` states a claim under hypotheses, and `NEW x \in S` introduces a fresh `x` from `S`.

A proof is a leaf or a list of steps. A leaf proof is one of:

- `OBVIOUS`: the goal follows from the facts already usable. No definition is expanded unless a `USE` expanded it earlier.
- `BY f1, f2 DEF d1, d2`: use these facts, and expand these definitions, for this step only.
- `OMITTED`: no proof. hobkin's `--strict` run counts this as not proved, so use it only while you work on other steps.

A step list numbers each step with its level and a name: `<1>1.`, `<1>2.`, or `<1>a.`. A step's own proof can be a deeper list, `<2>1.` and so on. A bare `<1>` is an unnamed step. Every list ends with a `QED` step, whose goal is the goal of the whole list. A step written with no proof under it is a missing proof, which `--strict` also fails.

The step forms:

- An assertion: `<1>1. P`, then its proof.
- `<1> SUFFICES ASSUME A PROVE G`: replaces the current goal with G under A. Its proof shows that this is enough, which is usually `OBVIOUS`.
- `<1>1. CASE P`: proves the current goal assuming P. The QED step then needs the cases to cover everything.
- `<1>1. ASSUME NEW x \in S, P PROVE Q`: a claim under hypotheses, used later as a fact about every such x.
- `<1>1. PICK x \in S : P(x)`: names a witness. Its proof shows `\E x \in S : P(x)`.
- `<1> WITNESS e \in S`: proves an `\E` goal with e.
- `<1> TAKE x \in S`: starts the proof of a `\A` goal.
- `<1> HAVE P`: starts the proof of a `P => Q` goal.
- `<1> DEFINE F == ...`: a local definition.
- `<1> USE f DEF d` and `<1> HIDE f DEF d`: make a fact or definition usable, or not, for the rest of the proof. `USE` proves nothing.

## What a step can use

TLAPS gives the backends only the usable facts, so a small context is faster and more likely to prove.

- Facts from `NEW x \in S` are always usable.
- What an unnamed step asserts, such as `<1> SUFFICES ...`, is usable in every later step.
- A named step, a theorem, a lemma and an ASSUME are usable only where a step cites it in `BY` or `USE`.
- A definition is hidden until `DEF` or `USE DEF` expands it. Without `DEF Inv`, a backend sees `Inv` as an unknown name, not as its conjuncts.
- In the proof of an `ASSUME ... PROVE` or `CASE` step, cite the step's own name (`BY <2>1 DEF ...`), as Lamport's examples do, so its hypotheses are certainly in the context.

Expanding a definition also expands primes inside it: with `DEF Inv`, the goal `Inv'` becomes each conjunct primed.

## The inductive invariant proof

```tla
LEMMA InitHolds == Init => Inv
  BY DEF Init, Inv, TypeOK, ...

LEMMA StepKeeps == Inv /\ [Next]_vars => Inv'
<1> SUFFICES ASSUME Inv, [Next]_vars PROVE Inv'
  OBVIOUS
<1>1. ASSUME NEW i \in Ids, Start(i) PROVE Inv'
  BY <1>1 DEF Inv, TypeOK, ..., Start
<1>2. ASSUME NEW i \in Ids, Stop(i) PROVE Inv'
  BY <1>2 DEF Inv, TypeOK, ..., Stop
<1>3. CASE UNCHANGED vars
  BY <1>3 DEF Inv, TypeOK, ..., vars
<1>4. QED
  BY <1>1, <1>2, <1>3 DEF Next

THEOREM AlwaysInv == Spec => []Inv
  BY InitHolds, StepKeeps, PTL DEF Spec
```

One step per action keeps each obligation small, and when one fails it names the action. The QED step needs `DEF Next`, so the backend can match each disjunct of `Next` to the step that covers it. Keep the actions themselves out of the QED's `DEF`. The `UNCHANGED vars` case needs `DEF vars`, or the backend cannot see that each variable kept its value.

From `[]Inv` to the property you care about:

```tla
THEOREM AlwaysSafe == Spec => []Safe
<1>1. Inv => Safe
  BY DEF Inv, Safe, ...
<1>2. QED
  BY AlwaysInv, <1>1, PTL
```

## Strengthening until it is inductive

A step of `StepKeeps` fails when some state satisfies `Inv`, takes the action and ends up outside `Inv`. That state may be unreachable, but the proof has to rule it out anyway. To find what to add:

1. Read the failed obligation's goal and known facts in `result.json`.
2. Build a state that satisfies every known fact and breaks the goal. If you cannot, the step is missing a fact or a definition, not a conjunct (see the next section).
3. Find why no real behavior reaches that state. That reason is the missing conjunct. In the example, a running job with 0 tries is unreachable because Claim counts the try when it starts the job. The conjunct is `TriedUnlessQueued`.
4. Add it to `Inv`, and list it in the cfg as an invariant, so TLC confirms it holds before you prove it.
5. Check again. A new conjunct needs its own proof in every action step, and it sometimes needs another conjunct in turn.

`models.md` shows how to make TLC test a candidate for inductiveness before you write the proof.

## Backends

TLAPS sends each obligation to backends in turn. With no backend named, it tries SMT for about 5 seconds, then Zenon for about 10, then Isabelle for about 30, according to the TLAPS tutorial. Naming one with `BY ..., SMT` runs that one alone.

- `SMT` (Z3 by default): arithmetic, sets, functions, `EXCEPT`, records and distinct strings. Most steps of an invariant proof go here. TLAPS knows nothing of TLC's model values: `None` is a constant like any other, and only an ASSUME says it is not a worker.
- `Zenon`: first-order logic and set reasoning without arithmetic, such as quantifier shuffling.
- `Isa`: Isabelle. Slower, for obligations the others give up on.
- `PTL`: the LS4 prover for propositional temporal logic, for steps like `Spec => []Inv`. It treats each state predicate and action as an atom it knows nothing about, so expand `Spec` with `DEF Spec` to let it see `Init` and `[][Next]_vars`.

`SMTT(30)`, `ZenonT(30)` and `IsaT(60)` give one backend a longer timeout, in seconds. Reach for a longer timeout only after the step is as small as you can make it.

## What TLAPS does badly

- Liveness. Proving `WF` and `SF` properties means reasoning about `ENABLED` by hand with the rules in `TLAPS.tla`. Check liveness with TLC instead.
- Arithmetic beyond the linear. Sums and comparisons of integers prove easily. Products of variables, division and real numbers often do not, so keep the model's arithmetic linear when you mean to prove it.
- `Cardinality`, sequences and recursive definitions without the library lemmas, or an induction you write yourself.
- `CHOOSE`. A proof can only use what `CHOOSE` is known to satisfy, so prove that the chosen thing exists first.
- Set equality. No backend applies extensionality by itself. To prove `S = T` for sets, cite `SetExtensionality` from `TLAPS.tla`, or prove membership both ways.
- Large obligations. Expanding many definitions at once gives the backend more than it can search in its time. Split the step instead.
- Finding the invariant. TLAPS checks the one you give it. Finding it is your job, with TLC's help.

## Reading a failed obligation

For each failed step, hobkin records its `id` (such as `<1>2`), its `label`, the `backend` tried last, `seconds`, the `goal` and the `known` facts. Go through these causes in order:

1. The goal or a known fact still shows a definition's name, such as `Inv'` or `Claim(w, j)`, where you meant its body. Add that definition to `DEF`.
2. A fact the step needs is not among the known facts. Cite the step, lemma or ASSUME that gives it.
3. Every needed fact is there and the goal still does not follow. Build a counter-state as in "Strengthening until it is inductive". If one exists, strengthen `Inv`. If the state is reachable, TLC should have found it too, so check that the cfg lists the invariant.
4. The step used most of its time and failed. The obligation is too big. Split it into smaller steps, give the cases names, or hide definitions the step does not need.
5. A temporal step failed. Check that it cites `PTL`, that the spec extends `TLAPS`, and that `Spec` is expanded.

Fix the first failed step first. Later steps often cite it, and a fix there can change their obligations.
