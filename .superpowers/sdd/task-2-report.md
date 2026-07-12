# Task 2 Report: IFRS_COST 減損/迴轉（雙上限）+ GAAP_COST no-write-up

## Status: DONE

## Commit
`bdc022ebdcb1d3bf8d3359f763821235694aa02b` — feat(rules-engine): impairment tracks — IFRS dual-cap reversal, GAAP_COST no-write-up

## Files changed
- Modified: `services/rules-engine/src/revaluation/revalue.ts`
- Added: `services/rules-engine/test/revalue.impair.test.ts`

## What was built

`revalueLots` now dispatches on `input.basis`:
- `GAAP_FV` → existing per-lot net-delta track (unchanged, Task 1).
- `IFRS_COST` / `GAAP_COST` → new `impairmentTrack(input, coinType, lots, px, decimals, out)`.

### Formula (both IFRS_COST and GAAP_COST)
- `attributedImpairment(lot, valuationState)` — the single source of truth for the impairment
  attributed to the lot's *current remaining quantity*:
  - `0` if no cumulative impairment.
  - `cumulativeImpairmentMinor` unscaled if there's no valuation state, or
    `qtyAtLastValuationMinor` is missing/`'0'` (spec: proportion = 1 in that case).
  - Otherwise `floor(cumulativeImpairmentMinor × remainingQtyMinor / qtyAtLastValuationMinor)`.
- `carrying = lot.costMinor − attributedImpairment(...)`.
- `value = valueOfQty(remainingQtyMinor, unitPriceMinor, decimals)`.
- `value < carrying` → **IMPAIR**, full amount `carrying − value` recognized (cost model never caps
  impairment side), reason `IMPAIR`.
- `value > carrying`:
  - `GAAP_COST` → skip entirely (ASC 350-30, one-way, no JE, no valuation row).
  - `IFRS_COST` → **REVERSE**, `reverseAmt = min(recovery, cap1, cap2)` where
    `recovery = value − carrying`, `cap1 = lot.costMinor − carrying` (post-reversal carrying can't
    exceed original cost), `cap2 = attributedImpairment(...)` (reversal can't exceed the
    proportionally-attributed cumulative impairment). Both caps intentionally reuse
    `attributedImpairment` so they stay internally consistent (see mutation-check #2 below).
- Per-coin JE aggregation: all lots' IMPAIR amounts sum into one `Dr ImpairmentLoss / Cr
  DigitalAssets` line pair; all lots' REVERSE amounts sum into one `Dr DigitalAssets / Cr
  ImpairmentReversalGain` pair. Both pairs can coexist in the same JE (IMPAIR and REVERSE do not
  net against each other), matching brief Step 3.
- `draft()` helper (Task 1) extended with an optional `reason` param (default `'REVALUE'`) so both
  tracks share it; `seq: 1` placeholder contract preserved per Task 1 review note (api overwrites).

## TDD evidence

**Step 2 (red):** ran `npx vitest run test/revalue.impair.test.ts` against the four brief
sequences before any implementation — all 4 failed (GAAP_FV fallback path produced wrong
reason/`REVALUE` instead of `IMPAIR`/`REVERSE`, wrong deltas, non-empty valuations for
GAAP_COST).

**Step 4 (green):** after implementation, all 4 sequences pass; full suite `133/133` (Task 1's
129 + 4 new, no regression); `npx tsc --noEmit` clean.

### Mutation check 1 — GAAP_COST no-write-up bypass
Temporarily changed `if (basis === 'GAAP_COST') continue;` → `if (false) continue;`.
Result: sequence C ("GAAP_COST：價回升不迴轉") went **red** — got a REVERSE valuation row +
JE instead of the expected empty arrays. Reverted; suite back to green.

### Mutation check 2 — cap2 proportion removed
Temporarily changed `attributedImpairment` to always return raw `cumulativeImpairmentMinor`
(no proportional scaling by `remainingQty/qtyAtLastValuation`).
Result: sequence B ("IFRS 迴轉：部分處分後 cap 按比例下降") went **red** — got
`deltaMinor: '30000'` / `priorCarryingMinor: '20000'` instead of expected `'15000'` /
`'35000'`. This confirms `attributedImpairment` is genuinely load-bearing for both the carrying
computation and cap2 (they intentionally share one function, so the mutation cascades through
both — this is why cap1 and cap2 evaluate to the same number in exact-division test data, but
both are still independently meaningful constraints per spec text). Reverted; suite back to
green.

Both mutations were applied via file edit, verified with `npx vitest run test/revalue.impair.test.ts`,
then reverted (verified with `git diff` / `npx vitest run` showing clean state before commit).

## Four test sequences (in `test/revalue.impair.test.ts`)

- **序列 A** — IFRS basic impairment: cost 100000, price drop to value 70000 (no prior
  valuation) → `Dr ImpairmentLoss 30000 / Cr DigitalAssets 30000`, reason `IMPAIR`.
- **序列 B** — IFRS dual-cap reversal after partial disposal: `qtyAtLastValuationMinor='100'`,
  `cumulativeImpairmentMinor='30000'`, lot now `remainingQtyMinor='50'`, `costMinor='50000'`,
  value recovers to `60000` (via decimals=0, unitPriceMinor=1200×50). cap2=15000,
  carrying=35000, recovery=25000, cap1=15000 → reversal clamped to **15000**.
  `Dr DigitalAssets 15000 / Cr ImpairmentReversalGain 15000`, reason `REVERSE`.
- **序列 C** — same inputs as B but `basis: 'GAAP_COST'` → `journalEntries: []`,
  `valuations: []` (no write-up).
- **序列 D** — IFRS reversal clamped to original cost on a price spike (no disposal, full
  cumulative impairment 30000 on cost 100000, carrying 70000, value 500000, recovery 430000,
  cap1=cap2=30000) → reversal clamped to **30000**, new carrying = 100000 = original cost.

## Verification numbers
- `npx vitest run test/revalue.impair.test.ts`: 4/4 passed.
- `npx vitest run` (full suite): 133/133 passed, 25 test files.
- `npx tsc --noEmit`: 0 errors.

## Concerns / notes for reviewer
- `attributedImpairment` is shared between the carrying computation and cap2 by design (see
  mutation check 2 rationale above). Under the invariant used throughout `impairmentTrack`
  (`carrying := cost − attributed`, assigned once per lot before either cap is computed),
  `cap1 = cost − carrying = cost − (cost − attributed) = attributed = cap2` is an **algebraic
  identity**, not a coincidence of exact-division test data — there is no input for which cap1
  and cap2 diverge, because cap1 is definitionally a re-derivation of `attributed` through
  `carrying`. Floor-division rounding inside `attributedImpairment` does not create a divergence
  path either: `carrying` is computed once from the (possibly floor-rounded) `attributed`, and
  `cap1` is then derived from that same `carrying`, so any rounding is baked into `attributed`
  before `cap1` is derived from it — both caps see the identical rounded value. The two caps are
  kept as separate expressions (`cap1 = cost - carrying`, `cap2 = attributed`) rather than one
  shared variable purely as a defensive-coding choice: if `carrying` is ever refactored to be
  tracked independently of `cost - attributed` (e.g. a future schema stores carrying directly),
  the two clamps would then diverge and both are still independently correct constraints per
  spec text — see the added code comment in `revalue.ts` for the same argument in situ.
- Did not run dual-review (external/independent review round) — out of scope for this
  implementer turn per the dispatch instructions (verifier and review are separate downstream
  steps in the 13-task plan).

## Fix wave

Applied review findings from the original Task 2 report:

1. **Test gap — IMPAIR/REVERSE non-netting across lots in one coin.** Added 序列 E to
   `test/revalue.impair.test.ts`: two lots on the same coin/price point, lot A triggers IMPAIR
   30000 (no prior impairment, value drops below carrying), lot B triggers REVERSE 20000 (prior
   `cumulativeImpairmentMinor=20000`, price recovers above carrying). Asserts a single JE with
   exactly 4 lines — `ImpairmentLoss` DEBIT 30000 / `DigitalAssets` CREDIT 30000 (leg `IMPAIR`)
   and `DigitalAssets` DEBIT 20000 / `ImpairmentReversalGain` CREDIT 20000 (leg `REVERSE`) — and
   that the two pair totals (30000, 20000) are unequal, i.e. not netted into one pair.

   **Mutation evidence (red before fix):** temporarily changed `impairmentJe` in `revalue.ts` to
   net `totalImpair`/`totalReverse` before building lines (`net = totalImpair - totalReverse`,
   then only the surviving side emits a pair). Result:
   `expected [ { …(8) }, …(1) ] to have a length of 4 but got 2` — 序列 E went red as required.
   Reverted; `npx vitest run test/revalue.impair.test.ts` back to 5/5 green.

2. **Cap1/cap2 equality comment.** Added an in-code comment in `revalue.ts` above the `cap1`/`cap2`
   assignments explaining the algebraic identity (`cap1 = cost - carrying = attributed = cap2`
   under the `carrying := cost - attributed` invariant) and why both clamps are kept as separate
   expressions (defensive against a future refactor where carrying is tracked independently). No
   logic changed.

3. **Report correction.** The original Concerns section speculated that floor-division rounding
   could make cap1 and cap2 "diverge in real data" — this was incorrect; per the reviewer's
   algebraic argument above, no input causes divergence because cap1 is a re-derivation of
   `attributed` via `carrying`, not an independently-rounded quantity. Rewritten above to state
   the identity and the no-divergence conclusion directly.

### Verification (fix wave)
- `npx vitest run test/revalue.impair.test.ts test/revalue.gaapfv.test.ts`: 10/10 passed
  (5 impair incl. new 序列 E, 5 gaapfv).
- `npx vitest run` (full suite): no regressions vs. prior 133/133 baseline + 1 new test.
- `npx tsc --noEmit`: 0 errors.
