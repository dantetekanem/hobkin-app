# Per-line tax rounding behind a flag

*Illustration of the story format, written by hand for the fixture diff in this folder. The proof facts are what running the fixture's tests would be expected to show. Nothing was executed, and no blind check was run on this text.*

## Opening

**Claims:** inferred, no description. The change adds per-line tax rounding to checkout totals behind the flag `:per_line_tax_rounding`.

**Does:** that, plus three changes outside the flag.

**Size:** 4 files, 45 lines added, 10 removed. 8 changed definitions, all read.

**Level: high.** Becomes **mid** if the changes suggested under units 1 to 3 are made. Reading time: about 9 minutes.

**Needs you (3):**
- **Critical.** Unit 1: round_money changes its rounding mode for every caller, flag on or off.
- **Critical.** Unit 3: legacy_discount is deleted while Cart#discounted_subtotal still calls it.
- Unit 2: The totals cache key prefix changes, and nothing shows who reads it.

Then 2 worth a look, and 3 that are safe. Every unit below is shown the same way; the level says how fast you can move.

## Setting

The path, in the order it runs. "Behind the flag" means the code runs only when the flag is on. A "life cycle test" is a test that enters through the controller or job and moves through the request, as opposed to one that calls a method directly.

1. `CheckoutController#create` calls `compute_totals`. Unchanged. Life cycle tests: `CheckoutControllerTest`, one with the flag off (existing), one with the flag on (added).
2. `compute_totals` checks the flag. **New check; runs for everyone.**
3. Flag on: `per_line_totals`, which calls `round_line_tax`, writes a column, and enqueues `ReceiptJob`. **Behind the flag.**
4. Flag off: the old body, re-indented, calling `tax_for` and `round_money`. **`round_money` changed; runs for everyone.**
5. `totals_cache_key`: changed. No caller found, no test executes it.
6. Later, outside the request: `ReceiptJob#perform` calls `round_money`; this job has no life cycle test. `Cart#discounted_subtotal` calls `legacy_discount`, **which this diff deletes.**

Outside the path: a constant (takes effect when the file loads) and a migration (takes effect at deploy).

## Needs you

### 1. round_money changes its rounding mode for every caller, flag on or off (high, critical)

**Where:** Stop 4 (the flag-off branch) and stop 6 (the receipt job).

**What changed:** `Checkout::TotalsCalculator#round_money` went from `amount.round(TAX_PRECISION)` to `amount.round(2, half: :even)`.

`app/services/checkout/totals_calculator.rb`, the changed line:

```diff
 def round_money(amount)
-  amount.round(TAX_PRECISION)
+  amount.round(2, half: :even)
 end
```

`app/jobs/receipt_job.rb`, the caller outside the request:

```diff
 def perform(cart_id)
   cart = Cart.find(cart_id)
   calculator = Checkout::TotalsCalculator.new(cart)
   ReceiptMailer.receipt(cart, calculator.round_money(cart.subtotal)).deliver_later
 end
```

**Facts:**
- Does: **behaviour**. One executable line changed, line 35.
- Proven: **none on the job path**. Request path: `CheckoutControllerTest` (unchanged) executes it with the flag off. Job path: `ReceiptJob` has no life cycle test. One isolated test asserts 1.235 rounds to 1.24, which is true under both modes..
- Runs for: **everyone**. Called on the flag-off branch of `compute_totals` (line 15) and from `ReceiptJob#perform` (line 5); neither checks the flag.
- Undone by: **rollback**. Reverting the deploy restores the old rounding.

**Why this level:** Floor rule 5: no test that ran shows the changed line, and an entry point above it, `ReceiptJob#perform`, has no life cycle test. Raised to high: with the flag off, every total now rounds half to even, so 2.675 was charged as 2.68 and is charged as 2.67. Critical: the wrong amount is on a money path, for every caller.

**Would change it:**
- Add a job test for `ReceiptJob`, and one request assertion that tells the two rounding modes apart. Then: **mid**.
- Also branch on `:per_line_tax_rounding` at `round_money:35`, keeping the old line as the flag-off path. Then: **safe**.

**Watch:** no metric or log on the totals path. Undone by: revert the deploy.

**Questions for you:**
- Is half-even rounding meant to apply to existing totals, or only to per-line tax? If only per-line tax, the second suggestion applies.

### 2. The totals cache key prefix changes, and nothing shows who reads it (high)

**Where:** Stop 5.

**What changed:** `totals_cache_key` returns `totals/v2/<cart id>`. It returned `totals/<cart id>`.

`app/services/checkout/totals_calculator.rb`, the changed key:

```diff
 def totals_cache_key
-  "totals/#{@cart.id}"
+  "totals/v2/#{@cart.id}"
 end
```

**Facts:**
- Does: **data**. The method builds a cache key; line 39 changed.
- Proven: **none**. No test executes line 39, and no entry point was found above it.
- Runs for: **everyone**. No caller was found, so no condition is proven in front of it.
- Undone by: **rollback**. Entries under the old prefix are still there.

**Why this level:** Floor rule 4: it changes the key everyone's totals are cached under, and no test goes through a request to it.

**Would change it:**
- Show its callers, and a life cycle test that executes it. Then: **mid**.

**Watch:** no cache hit or miss metric found. Undone by: revert the deploy.

**Questions for you:**
- Who reads the `totals/` cache key? If nothing reads it, this is dead code. If a live read path does, every cached entry misses at deploy.

### 3. legacy_discount is deleted while Cart#discounted_subtotal still calls it (high, critical)

**Where:** Stop 6.

**What changed:** The diff removes `Checkout::TotalsCalculator#legacy_discount`. `app/models/cart.rb:9` still calls it.

`app/models/cart.rb`, the remaining caller, and what was removed:

```diff
 def discounted_subtotal
   Checkout::TotalsCalculator.new(self).legacy_discount(subtotal)
 end

 # removed from app/services/checkout/totals_calculator.rb:
-def legacy_discount(amount)
-  amount * 0.95
-end
```

**Facts:**
- Does: **interface**. A definition was removed.
- Proven: **not-applicable**. A broken reference is decided by search, not by a test.
- Runs for: **everyone**. Every call to `Cart#discounted_subtotal`.
- Undone by: **rollback**. Reverting the deploy restores the method.

**Why this level:** Floor rule 1: what remains refers to something removed. Every call raises `NoMethodError`.

**Would change it:**
- Keep `legacy_discount` until its caller is migrated, or migrate the caller in a separate change first. Then: **safe**.

**Watch:** no error report call found on this path. Undone by: revert the deploy.

**Questions for you:** none.

## Worth a look

### 4. The new flag check runs on every checkout and loads the shop (mid)

**Where:** Stop 2.

**What changed:** `compute_totals` now starts with `Features.enabled?(:per_line_tax_rounding, @cart.shop)`. The old body is the flag-off branch, unchanged apart from indentation.

`app/services/checkout/totals_calculator.rb`, the check and both branches:

```diff
 def compute_totals
+  if Features.enabled?(:per_line_tax_rounding, @cart.shop)
+    per_line_totals
+  else
     subtotal = @cart.subtotal
     tax = tax_for(subtotal)
     { subtotal: round_money(subtotal), tax: round_money(tax), total: round_money(subtotal + tax) }
+  end
 end
```

**Facts:**
- Does: **behaviour**. A branch was added.
- Proven: **lifecycle-observed**. `CheckoutControllerTest`: the existing test (unchanged) executes the flag-off branch; the added test executes the flag-on branch with the flag on.
- Runs for: **the check: everyone; the new branch: nobody yet**. The flag-off branch is the removed code, re-indented.
- Undone by: **flag**. Turning the flag off takes the old branch.

**Why this level:** Floor rule 10: safe. Raised to mid: the check itself runs for everyone. It passes `@cart.shop`, so every checkout loads the shop before branching, and `Features.enabled?` calls `Store.fetch` with no rescue.

**Would change it:**
- Pass an already-loaded value to the check, and confirm the flag store fails closed. Then: **safe**.

**Watch:** nothing on either branch is tagged with the flag state, so the two groups cannot be compared during ramp. Undone by: flag off.

**Questions for you:**
- What does `Features.enabled?` do when the flag store is unreachable? If it raises, every checkout fails during a flag-store outage and this unit is high.

### 5. The flag-on path writes a column and enqueues a job that outlive the flag (mid)

**Where:** Stop 3.

**What changed:** `per_line_totals` is new and called only from the flag-on branch. It writes `carts.line_tax_cents` and enqueues `ReceiptJob`.

`app/services/checkout/totals_calculator.rb`, the write and the enqueue:

```diff
+def per_line_totals
+  tax = @cart.lines.sum { |line| round_line_tax(line) }
+  @cart.update!(line_tax_cents: (tax * 100).to_i)
+  ReceiptJob.perform_later(@cart.id)
+  { subtotal: round_money(@cart.subtotal), tax: tax, total: round_money(@cart.subtotal + tax) }
+end
```

**Facts:**
- Does: **data**. `update!` on line 21, `perform_later` on line 22.
- Proven: **lifecycle-observed**. The added request test executes it with the flag on.
- Runs for: **nobody yet**. Its one call site is on the flag-on branch of `compute_totals`.
- Undone by: **flag-with-residue**. Turning the flag off leaves the written values and the queued jobs.

**Why this level:** Floor rule 7: what it writes outlives the flag. The queued job calls `round_money`, which is unit 1.

**Would change it:** nothing proposed.

**Watch:** nothing counts the rows written or jobs enqueued under the flag. Undone by: flag off; rows and jobs stay.

**Questions for you:** none.

## Safe

### 6. round_line_tax is new and only runs behind the flag (safe)

**Where:** Stop 3, called from `per_line_totals`.

**What changed:** A new helper that rounds one line's tax half to even.

`app/services/checkout/totals_calculator.rb`, the new helper:

```diff
+def round_line_tax(line)
+  (line.amount * TaxRate.for(@cart.region)).round(2, half: :even)
+end
```

**Facts:**
- Does: **behaviour**. New executable lines.
- Proven: **lifecycle-observed**. The added request test executes it with the flag on; an added isolated test calls it directly.
- Runs for: **nobody yet**. Its one call site is `per_line_totals:20`, behind the flag.
- Undone by: **flag**. Nothing is written.

**Why this level:** Floor rule 10.

**Would change it:** nothing proposed.

**Watch:** not assessed.

**Questions for you:** none.

### 7. TAX_PRECISION changes from 2 to 4, and nothing reads it (safe)

**Where:** Outside the request path: takes effect when the file loads.

**What changed:** The constant's value changed. `round_money` was its only reader and no longer uses it.

`app/services/checkout/totals_calculator.rb`, the constant:

```diff
-TAX_PRECISION = 2
+TAX_PRECISION = 4
```

**Facts:**
- Does: **load**. A constant assignment.
- Proven: **not-applicable**. No executable path reads it.
- Runs for: **at-load**. Evaluated when the file loads.
- Undone by: **rollback**. Reverting restores the value.

**Why this level:** Floor rule 8: mid. Lowered to safe with evidence `unreferenced`: no reference to `TAX_PRECISION` remains under the root.

**Would change it:** nothing proposed.

**Watch:** not assessed.

**Questions for you:** none.

### 8. The migration adds one nullable column that old code never reads (safe)

**Where:** Outside the request path: takes effect at deploy.

**What changed:** `AddLineTaxCentsToCarts` adds `carts.line_tax_cents`, an integer with no default and no NOT NULL.

`db/migrate/20261111000000_add_line_tax_cents_to_carts.rb`, the migration:

```diff
+def change
+  add_column :carts, :line_tax_cents, :integer
+end
```

**Facts:**
- Does: **data**. Additive schema change.
- Proven: **not-applicable**. Schema changes are decided by their operation, not by a test.
- Runs for: **at-load**. Applies to everyone at deploy.
- Undone by: **rollback**. The column can be dropped.

**Why this level:** Floor rule 8: mid. Lowered to safe with evidence `additive-schema`: no constraint, no rewrite, and old code never reads the column. It has to deploy before the flag is turned on.

**Would change it:** nothing proposed.

**Watch:** not assessed.

**Questions for you:** none.

## Conclusion

**Verdict: high**, because of units 1 to 3. With their suggested changes made it is **mid**.

**Proof:** the request path through `CheckoutController#create` has a life cycle test in both flag states. `ReceiptJob#perform` has none, and nothing executes `totals_cache_key`. In this illustration no test was run.

**After launch:** no metric, log or error report was found anywhere on this path. Before the flag ramps, the totals path needs one signal tagged with the flag state. The flag undoes units 4 to 6; only a revert undoes units 1 to 3.

**Fast follow:**
- Tag the totals path with the flag state (unit 4).
- Count rows written and jobs enqueued under the flag (unit 5).
- Remove `TAX_PRECISION` if it stays unused (unit 7).

**Open questions:**
- Is half-even rounding meant to apply to existing totals, or only to per-line tax? (unit 1)
- Who reads the `totals/` cache key? (unit 2)
- What does `Features.enabled?` do when the flag store is unreachable? (unit 4)

**Claims:** none to check; the change had no description.
