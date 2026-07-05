# Opening-Equity JE for OPENING_LOT — Design Spec

**Date**: 2026-07-05
**Status**: Approved (user); CPA review READY-WITH-FIXES — all 4 findings integrated below
**Predecessor**: `2026-07-05-c4-lot-store-design.md` §7 deferred item #1

## 1. Problem

OPENING_LOT events currently take the no-JE branch (`services/rules-engine/src/rules/openingLotRules.ts:24` returns `[]`). Consequences:

- **Zero cryptographic anchoring**: the merkle spine only ingests JEs (`services/snapshot-svc/src/core/buildSnapshot.ts:24`). An opening lot's cost basis lives solely in mutable SQLite rows (`events`, `lot_movement`); coordinated tampering of both is undetectable by drift checks, which recompute from the same rows.
- **Exclusion-style tie-out**: subledger↔GL tie-out must exclude opening basis (`total − openingBasisRemaining === GL`, pinned in `services/api/test/lots.tieout.test.ts:133-141`) because DigitalAssets GL never received the opening debit.
- **EMPTY_SNAPSHOT edge**: a snapshot run containing only opening lots throws `EMPTY_SNAPSHOT`.

## 2. Decisions (user-adjudicated)

| # | Question | Decision |
|---|----------|----------|
| D1 | Retroactivity | **Forward-only.** Only newly ingested OPENING_LOT events produce a JE. Existing JE-less opening movements are never backfilled; locked/anchored periods untouched. Demo DB is re-seedable, so practical coverage is equivalent to full. |
| D2 | Zero-basis lots (`openingCostMinor === '0'`, airdrops) | **No JE.** A 0/0 entry is meaningless in accounting and risks debits=credits>0 invariants. Zero-basis lots keep the movement-only path; residual evidence gap documented (a JE anchors cost, not qty, so a zero-cost JE would anchor only a `0` anyway). |
| D3 | Implementation locus | **Rules engine** emits the JE (not API-layer synthesis), so it flows through the existing pipeline: COA resolution, merkle, and the atomic persist transaction. |
| D4 | Legacy/new discriminator | `lot_movement.je_id IS NULL` — legacy and zero-basis movements have NULL, JE-backed ones carry the real JE id. No schema change. |

## 3. Design

### 3.1 Rules engine (`openingLotRules.ts`)

`buildJeLines` for OPENING_LOT:

- If `openingCostMinor > 0`: return two legs, both with `amountMinor = openingCostMinor`:
  - `ACQUISITION` — DEBIT (reuses the existing leg name; resolves to the asset control account)
  - `OPENING_EQUITY` — CREDIT (new leg name)
- If `openingCostMinor === '0'`: return `[]` (current JE-less path unchanged).

`lotMovements` output unchanged. Schema validation unchanged (missing/malformed `openingCostMinor` → `SCHEMA_INVALID`, fail-closed, as today).

### 3.2 Chart of accounts (`services/api/src/http/policyConstants.ts`)

- New account: `OpeningBalanceEquity` (equity class — opening balances are a ledger-start declaration, not a current-period economic event; posting to income accounts would pollute period P&L).
- **Clearing-account disclosure (CPA)**: `OpeningBalanceEquity` is properly a temporary clearing account — once all opening balances are loaded, a full system closes it out to Retained Earnings / Contributed Capital. A permanently nonzero OBE balance is an audit red flag. This round treats it as terminal (demo scope); the close-out entry is a documented deferred item (§6).
- Two new mappings: `(OPENING_LOT, ACQUISITION) → DigitalAssets`, `(OPENING_LOT, OPENING_EQUITY) → OpeningBalanceEquity`.
- User policies without these mappings hit the existing `MAPPING_MISSING` fail-closed exception. No new mechanism.

### 3.3 Persist (`services/api/src/http/routes.ts` run-rules transaction)

Expected zero structural change: the existing transaction already persists JE + movements + markPosted atomically. OPENING_LOT simply moves from 0 JEs to 1; the movement's `je_id` becomes the real JE id instead of NULL.

**Must verify**: the JE-less special-case branch near `routes.ts:449` (persisting movements for POSTABLE outputs with no JE) must not also fire for a JE-backed OPENING_LOT — no double-persist, no skip.

**JE idempotency key (CPA — must be pinned before coding)**: the opening JE's `idempotencyKey` is deterministic: `${eventId}|OPEN`. Note the knock-on effect: `routes.ts:473` computes the movement anchor as `output.journalEntries[0]?.idempotencyKey ?? ev.id`, so once OPENING_LOT carries a JE, the movement idempotency key shifts from `${eventId}|${lotId}` to `${eventId}|OPEN|${lotId}`-shaped (`${jeIdempotencyKey}|${lotId}`). Replay semantics are preserved because the JE key is deterministic — same event replayed collides and no-ops. Zero-basis lots (no JE) keep the `${eventId}|${lotId}` anchor. Forward-only (D1) means no persisted legacy row ever changes key.

### 3.4 Merkle / snapshot

No code change. Non-zero opening lots' JEs enter the spine naturally, closing the evidence gap. The `EMPTY_SNAPSHOT` edge (run containing only zero-basis opening lots) is retained as-is: it is already fail-loud, and zero-basis lots are adjudicated unanchored (D2).

### 3.5 Tie-out (tests + DTO disclosure)

Identity changes from "total − opening basis = GL" to:

> `total − (original as-loaded basis of JE-less opening lots) === GL`

**Why "original", not "remaining" (CPA must-fix)**: disposal credits do not discriminate by lot origin — when a JE-less opening lot is consumed, GL receives the disposal credit but never received the opening debit. With consumed portion `c` and remaining `r`, `total − GL = c + r = original`; using "remaining" is only correct while `c = 0`. The pre-existing tie-out test happens to never consume the opening lot, which masked this.

- JE-backed opening basis joins the full identity (its debit is in GL); JE-less (legacy, `je_id IS NULL`) and zero-basis lots are excluded at **original loaded basis**.
- **Consumed-legacy boundary (documented, not fixed)**: once a JE-less opening lot is consumed, the disposal credit has no matching opening debit; a "remaining"-style check would break by the consumed carrying amount. This round relies on forward-only + re-seedable demo DB to avoid live legacy lots; the boundary gets an explicit test (below), not a repair.
- Tests: `lots.tieout.test.ts` gains (a) a JE-backed opening fixture proving both regimes coexist, (b) a consume-a-legacy-JE-less-lot case pinning the original-basis identity (and demonstrating why "remaining" fails).

### 3.5b DTO disclosure (CPA must-fix — reconciling items must be visible, not test-only)

The lots DTO's `origin` field is refined so an auditor can see which opening lots are anchored: `origin: 'opening-anchored' | 'opening-legacy' | 'derived'` (or equivalently, expose the movement's `jeId` and keep `origin: 'opening'`; final shape decided at plan time against the existing DTO/consumers — additive either way, no removal). Discrimination source: `lot_movement.je_id IS NULL`. Zero-basis lots report as `opening-legacy` (unanchored by D2).

### 3.6 Forward-only mechanics

No migration, no backfill script. Pre-existing JE-less opening movements remain permanently on the exclusion side; the discriminator is encoded in data (D4), not documentation memory. C4 spec §7 to be updated: gap narrows to "legacy + zero-basis lots".

## 4. Out of scope

- Backfill/migration of any kind (D1).
- Anchoring zero-basis lots (D2).
- Frontend UI changes — the DTO disclosure (§3.5b) is backend-only and additive; no UI work this round.
- OBE close-out entry to Retained Earnings (§3.2 disclosure) — deferred.
- Move contract changes — zero `.move` diff; `sui move test` not applicable (stated, not skipped).

## 5. Testing

- **rules-engine unit**: legs balance (Dr = Cr = openingCostMinor); `'0'` → `[]`; missing `openingCostMinor` still `SCHEMA_INVALID`.
- **api tie-out**: dual-regime fixture — one JE-backed opening lot (included in GL identity) + one legacy/zero-basis (excluded at original basis); identity holds. Plus the consumed-legacy boundary case (§3.5).
- **api DTO**: origin refinement / jeId disclosure asserted for all three lot classes (§3.5b).
- **snapshot**: known-answer test with an opening JE leaf in the merkle root.
- **monkey** (repo rule): hostile payloads — negative, huge numbers, `'0'` boundary, same-event replay (idempotency), COA mapping removed → MAPPING_MISSING.

## 6. Risks / known gaps (honest)

- Zero-basis lots remain unanchored by design (D2) — documented residual gap.
- Legacy opening lots remain unanchored forever (D1) — acceptable because demo DB is re-seedable.
- JE anchors cost only, never quantity; quantity tampering on any lot is caught only by drift recompute, unchanged from C4.
- `OpeningBalanceEquity` carries a permanent balance this round (no close-out to Retained Earnings) — audit-noted, deferred (§3.2).
- Consumed legacy JE-less lots break the "remaining"-style intuition; the invariant is stated at original basis and the boundary is test-pinned, but GL for such lots is structurally one-sided forever (§3.5).
