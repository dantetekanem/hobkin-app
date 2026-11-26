---- MODULE ReviewCodeSelection ----
\* models: ui/src/features/review/state/session.ts, ui/src/features/review/code/CodePanel.tsx
EXTENDS TLC
VARIABLES code, selection
vars == <<code, selection>>
Files == {"A", "B"}
\* words: The panel starts closed with no selected lines.
Init == code = "closed" /\ selection = "none"
\* code: ui/src/features/review/state/session.ts:453
\* words: Moving to another target clears the previous selection.
Navigate == \E f \in Files: /\ f # code /\ code' = f /\ selection' = "none"
\* code: ui/src/features/review/state/session.ts:749
\* words: Selecting lines records the file currently shown.
Pick == /\ code \in Files /\ selection' = code /\ UNCHANGED code
\* code: ui/src/features/review/state/session.ts:608
\* words: Closing the panel clears its selected lines.
Close == /\ code # "closed" /\ code' = "closed" /\ selection' = "none"
\* words: The panel can navigate, select or close.
Next == Navigate \/ Pick \/ Close
\* words: Selected lines belong only to the visible code file.
VisibleSelection == selection = "none" \/ selection = code
\* words: The small panel model starts closed and follows these transitions.
Spec == Init /\ [][Next]_vars
====
