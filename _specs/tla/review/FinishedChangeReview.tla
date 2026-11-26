-------------------------- MODULE FinishedChangeReview --------------------------
\* models: ui/src/features/work/use-change-review.ts, ui/src/features/work/review-follow.ts
\* words: One mounted card follows two commits on the same review and host.
CONSTANTS A, B, None
VARIABLES head, pending, last

\* words: The model tracks the card's head, its open poll and the last result.
vars == <<head, pending, last>>

\* words: The card can point to either of two commits.
Heads == {A, B}

\* words: The card shows a result only when its commit matches the current head.
Shown == IF last = head THEN last ELSE None

\* words: The card mounts at A with no result and starts its first poll.
Init == /\ head = A
        /\ pending = A
        /\ last = None

\* words: The card moves to the other commit and replaces its poll without clearing the stored result.
\* code: ui/src/features/work/use-change-review.ts:16
Move == /\ head' \in Heads \ {head}
        /\ pending' = head'
        /\ UNCHANGED last

\* words: The active poll can succeed with either commit in the response.
\* code: ui/src/features/work/review-follow.ts:63
Reply == /\ pending # None
         /\ last' \in Heads
         /\ pending' = None
         /\ UNCHANGED head

\* words: A failed first poll leaves the stored result untouched.
\* code: ui/src/features/work/review-follow.ts:67
Fail == /\ pending # None
        /\ pending' = None
        /\ UNCHANGED <<head, last>>

\* words: No badge or merge emphasis can come from the other commit.
CurrentCommitOnly == Shown = None \/ Shown = head

\* words: Normal card operation lets the commit change and the active poll settle.
Next == Move \/ Reply \/ Fail

\* words: Start at mount and follow these actions or stay as we are.
Spec == Init /\ [][Next]_vars
=================================================================================
