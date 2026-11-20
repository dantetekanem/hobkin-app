------------------------------- MODULE Proved -------------------------------
EXTENDS Naturals, TLAPS

VARIABLE x

\* words: The counter starts at zero.
Init == x = 0

\* words: Each step adds one.
Next == x' = x + 1

\* words: The counter is always a natural number.
TypeOK == x \in Nat

THEOREM Safety == Init /\ [][Next]_x => []TypeOK
<1>1. Init => TypeOK
  BY DEF Init, TypeOK
<1>2. TypeOK /\ [Next]_x => TypeOK'
  BY DEF TypeOK, Next
<1>3. QED
  BY <1>1, <1>2, PTL
=============================================================================
