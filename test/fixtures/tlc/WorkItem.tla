------------------------------ MODULE WorkItem ------------------------------
\* models: src/cli/work/items.mjs, src/cli/work/yolo-pass.mjs
\* words: How one work item moves from queued to merged.
EXTENDS Naturals

CONSTANTS MaxPush

VARIABLES state, head, reviewed

vars == <<state, head, reviewed>>

\* words: The item is in one of three states, and a review remembers the head it read.
TypeOK == /\ state \in {"queued", "branch", "merged"}
          /\ head \in 0..MaxPush
          /\ reviewed \in 0..MaxPush

\* words: The item starts queued, with no pushes and no review.
Init == /\ state = "queued"
        /\ head = 0
        /\ reviewed = 0

\* code: src/cli/work/runner.mjs:88
\* words: An agent finishes the item, so its branch has a head.
Finish == /\ state = "queued"
          /\ state' = "branch"
          /\ head' = 1
          /\ UNCHANGED reviewed

\* code: src/cli/work/review.mjs:61
\* words: A review reads the branch at its current head.
Review == /\ state = "branch"
          /\ reviewed' = head
          /\ UNCHANGED <<state, head>>

\* code: src/cli/work/runner.mjs:203
\* words: The agent pushes again. The head moves; the review does not.
Fix == /\ state = "branch"
       /\ head < MaxPush
       /\ head' = head + 1
       /\ UNCHANGED <<state, reviewed>>

\* code: src/cli/work/yolo-pass.mjs:165
\* words: YOLO mode merges a reviewed branch.
YoloMerge == /\ state = "branch"
             /\ reviewed > 0
             /\ state' = "merged"
             /\ UNCHANGED <<head, reviewed>>

Next == Finish \/ Review \/ Fix \/ YoloMerge

Spec == Init /\ [][Next]_vars

\* words: Whatever merged was reviewed at the head that merged.
MergedAtReviewedHead == state = "merged" => reviewed = head
=============================================================================
