---- MODULE GitHubReviewRefresh ----
\* models: ui/src/features/github/GitHubScreen.tsx, ui/src/features/github/pull-reviews.ts, ui/src/features/github/rows.tsx

VARIABLES cached, failed

\* words: The page has not yet read the review list.
Init == /\ cached = "none"
        /\ failed = FALSE

\* code: ui/src/features/work/use-review-list.ts:36
\* words: A successful refresh replaces the cached list and clears the error.
Read == /\ cached' \in {"badges", "empty"}
        /\ failed' = FALSE

\* code: ui/src/features/work/use-review-list.ts:37
\* words: A failed refresh keeps the prior list but sets the error.
Fail == /\ UNCHANGED cached
        /\ failed' = TRUE

\* words: A refresh can either supply the latest list or fail.
Next == Read \/ Fail

\* words: A cached result is visible only when the last refresh did not fail.
ShowsReviews == cached = "badges" /\ ~failed

\* words: On the connected GitHub page the alert follows the refresh error.
ShowsAlert == failed

\* words: The error alert never appears beside AI reviews from the old list.
NoStaleReviews == ~(ShowsAlert /\ ShowsReviews)

\* words: A successful refresh with AI reviews makes them visible.
ShowsCurrentReviews == (~failed /\ cached = "badges") => ShowsReviews
====
