# Errors: SANY, TLC and TLAPS

The quoted messages are what SANY and TLC from tla2tools.jar v1.7.4 print. hobkin passes them through in the run's `message`, so search for the words you see. Messages from TLAPS are in the last section.

## SANY: the spec does not parse

hobkin reports a parse error as "The spec does not parse: <file>, line L, column C." followed by SANY's own words. For a syntax error, the position is where the parser gave up, which is often just after the real mistake. Look at the line before it too.

`Was expecting "==== or more Module body"` with `Encountered "Init" at line 4, column 1`
: Something at the top level is not a definition or a declaration. The usual cause is a definition written with `=` in place of `==`. If it says `Encountered "<EOF>"`, the closing line of at least four `=` is missing.

`Unknown operator: 'y'`
: A name that is not declared or defined at that point. Check the spelling, then the order: TLA+ needs a definition above its first use. A recursive operator needs `RECURSIVE f(_)` above its definition, or SANY reports its own name as unknown inside it.

`Could not find declaration or definition of symbol '+'` and `Couldn't resolve infix operator symbol '+'`
: The operator comes from a module the spec does not extend. Arithmetic and `..` need `Naturals` or `Integers`. `Len`, `Append`, `Head`, `Tail`, `\o` and `Seq` need `Sequences`. `Cardinality` needs `FiniteSets`. `:>`, `@@`, `Permutations`, `Print` and `Assert` need `TLC`.

`Operator Init already defined or declared`
: Two definitions share a name, or one clashes with a name from an extended module. Rename one.

`Encountered "}" ... Some { } form`
: A set literal has a trailing comma or a missing element.

`Encountered "=" ... Field Value`
: A record written with `=`. A record is `[a |-> 1, b |-> 2]`. A set of records is `[a : S, b : T]`.

`Precedence conflict between ops \land in block ... and \lor`
: A bulleted list is out of line. Every `/\` or `\/` of one list starts in the same column, and a list nested inside an item starts to the right of that item's bullet. A misaligned bullet does not always cause an error: a bullet further right than its list can parse as part of the item above it, with another meaning and no message. Line the bullets up by eye even when SANY accepts the spec.

`Cannot find source file for module TLAPS imported in module X`
: hobkin finds `TLAPS.tla` only through the TLAPS install on the machine. Without TLAPS installed, a spec that says `EXTENDS TLAPS` does not parse. Say in `proof` that TLAPS is missing. TLAPS's lemma modules, such as `FiniteSetTheorems`, come from the same install. For a module of your own, the file must be named like the module and sit beside the spec.

## TLC: the run ended with an error

These end the run with outcome `error`. Nothing was shown to hold or break.

`Successor state is not completely specified by the next-state action. The following variable is not assigned: y.`
: An action says nothing about `y`. Add `y` to its `UNCHANGED`, or give it a primed value. The trace stops at that step and shows `y = null`.

`Attempted to apply function: <<0, 0>> to argument 3, which is not in the domain of the function.`
: A function was applied outside its domain. Either the guard is missing a condition the code has, or the function was built over too small a set. `EXCEPT ![k]` on a `k` outside the domain leaves the function unchanged, so the error shows up later, where the function is read.

`Attempted to check equality of string "a" with non-string: 1`
: One variable holds values of different kinds. Give each variable one kind of value, and use a model value such as `None` for "nothing". TypeOK as the first invariant finds the step that went wrong.

`The invariant Inv is not a state predicate (one with no primes or temporal operators).`
: A formula with a prime or `[]` is listed under INVARIANT. A rule about steps goes under PROPERTY as `[][A]_vars`.

`In computing initial states, the right side of \IN is not enumerable.`
: Init chooses from an infinite set such as `Nat`, `Int` or `Seq(S)`. Use a finite set from the constants.

`Attempted to compute the value of an expression of form CHOOSE x \in S: P, but S was not enumerable.`
: The same problem inside an action: a CHOOSE, `\E` or `\A` over an infinite set. Quantify over a finite set.

`The constant parameter N is not assigned a value by the configuration file.`
: Add `N` under CONSTANTS in the cfg.

`TLC found an error in the configuration file at line 6. It was expecting a keyword, but did not find it.`
: A keyword on that line is misspelled, or it is one TLC 1.7.4 does not have, such as `ALIAS` or `POSTCONDITION`.

## TLC: the run broke

These end with outcome `broken` and a trace in `result.json`.

`Invariant X is violated.`
: The trace runs from the initial state to the first state that breaks X. `Invariant X is violated by the initial state` means Init itself breaks it: check Init and X before any action.

`Action property X is violated.`
: A step in the trace breaks a `[][A]_vars` property. The last two states are the step.

`Deadlock reached.`
: The last state of the trace has no enabled action. Either the code can get stuck there, or the model lacks the action that leaves that state. Turn the check off only when the machine is meant to stop there (SKILL.md).

`Temporal properties were violated.`
: A liveness property broke. TLC does not say which one. The trace ends in `Stuttering` or `Back to state n`. See "Reading a run that did not hold" in SKILL.md and the liveness section of `models.md`.

## hobkin's own notes on a run

`X never fired, so nothing it guards was checked`
: TLC's coverage shows that action found no new state. The run does not count. See "Every action must fire" in SKILL.md.

`Stopped at the time limit of 20 minutes.`
: The state space is too big. Shrink the model (`models.md`).

`Warning: Declaring symmetry during liveness checking is dangerous.`
: A SYMMETRY in a run that checks a liveness property. Take it out for that run.

`Nothing checked: the spec has no .cfg for TLC, and no proof.`
: The cfg must sit beside the spec with the same name, `<Machine>.cfg`.

## TLAPS: the proof did not hold

hobkin runs TLAPS only when the model, if there is one, held, and lists every proof step in `proof.obligations` with a status:

- `proved`: a backend proved it, or tlapm found it trivial.
- `failed`: every backend tried gave up. The entry has the `goal` it had to show and the `known` facts it had. `proofs.md` explains how to read them.
- `missing`: a step has no proof at all. Under `--strict` that fails the proof. Give it `BY ...` or `OBVIOUS`.
- `omitted`: the step says `OMITTED`. Under `--strict` that also fails the proof.

Run-level notes:

`TLAPS could not prove N of M steps`
: Some steps failed, are missing or are omitted. Fix the first failed one first, since later steps often cite it.

`TLAPS proved nothing: it found no steps to prove.`
: This ends a run with a proof and no cfg when tlapm reported no steps at all. tlapm can stop on an error of its own and still exit cleanly, and then hobkin sees only that nothing was proved. Check that the theorems come after the definitions they use, and that the spec extends `TLAPS` when it uses `PTL` or a backend name.

`Waits until the model holds`
: The model broke or failed, so the proof did not run. Fix the model first.

`TLAPS is not installed, so the proof did not run`
: There is no tlapm on this machine. Say so in `proof`. The model check still counts on its own.
