---- MODULE ReviewSentReceipts ----
\* models: host/src/review/reviews.ts

CONSTANT Notes
VARIABLES posted, receipts, staleSaved

\* words: Neither comment has been posted, and no stale window has saved yet.
Init == posted = {} /\ receipts = {} /\ staleSaved = FALSE

\* words: A verdict preview offers comments without receipts.
Unsent == Notes \ receipts

\* code: host/src/review/reviews.ts:1279
\* words: A comment eligible in a preview can be posted and get a receipt.
Post ==
    \E comment \in Unsent :
        /\ posted' = posted \cup {comment}
        /\ receipts' = receipts \cup {comment}
        /\ UNCHANGED staleSaved

\* code: host/src/review/reviews.ts:717
\* words: A window saves existing notes with at least one receipt missing from its snapshot.
Save ==
    /\ \E windowReceipts \in (SUBSET posted) \ {posted} : receipts' = receipts \cup windowReceipts
    /\ staleSaved' = TRUE
    /\ UNCHANGED posted

\* words: This model covers posting and same-ID saves, not explicit note removal.
Next == Post \/ Save

\* words: No already-posted comment appears in the next preview.
NoRepost == posted \cap Unsent = {}
====
