# Opening-Equity JE for OPENING_LOT — Design Spec

**Date**: 2026-07-05
**Status**: Approved (user), pending CPA review
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
- Two new mappings: `(OPENING_LOT, ACQUISITION) → DigitalAssets`, `(OPENING_LOT, OPENING_EQUITY) → OpeningBalanceEquity`.
- User policies without these mappings hit the existing `MAPPING_MISSING` fail-closed exception. No new mechanism.

### 3.3 Persist (`services/api/src/http/routes.ts` run-rules transaction)

Expected zero structural change: the existing transaction already persists JE + movements + markPosted atomically. OPENING_LOT simply moves from 0 JEs to 1; the movement's `je_id` becomes the real JE id instead of NULL.

**Must verify**: the JE-less special-case branch near `routes.ts:449` (persisting movements for POSTABLE outputs with no JE) must not also fire for a JE-backed OPENING_LOT — no double-persist, no skip.

`idempotencyKey` stays `${eventId}|${lotId}` — decoupled from JE presence, replay semantics unchanged.

### 3.4 Merkle / snapshot

No code change. Non-zero opening lots' JEs enter the spine naturally, closing the evidence gap. The `EMPTY_SNAPSHOT` edge (run containing only zero-basis opening lots) is retained as-is: it is already fail-loud, and zero-basis lots are adjudicated unanchored (D2).

### 3.5 Tie-out (tests; no schema/DTO change)

Identity changes from "total − opening basis = GL" to:

> `total − (JE-less opening basis remaining) === GL`

JE-backed opening basis now lands in DigitalAssets GL and joins the full identity; legacy (je_id NULL) and zero-basis stay excluded. Discrimination via `lot_movement.je_id IS NULL`. `lots.tieout.test.ts` gains a JE-backed opening fixture proving both regimes coexist.

### 3.6 Forward-only mechanics

No migration, no backfill script. Pre-existing JE-less opening movements remain permanently on the exclusion side; the discriminator is encoded in data (D4), not documentation memory. C4 spec §7 to be updated: gap narrows to "legacy + zero-basis lots".

## 4. Out of scope

- Backfill/migration of any kind (D1).
- Anchoring zero-basis lots (D2).
- Frontend changes — the lots DTO already exposes movements; `je_id` visibility is a nice-to-have, not in this round.
- Move contract changes — zero `.move` diff; `sui move test` not applicable (stated, not skipped).

## 5. Testing

- **rules-engine unit**: legs balance (Dr = Cr = openingCostMinor); `'0'` → `[]`; missing `openingCostMinor` still `SCHEMA_INVALID`.
- **api tie-out**: dual-regime fixture — one JE-backed opening lot (included in GL identity) + one legacy/zero-basis (excluded); identity holds.
- **snapshot**: known-answer test with an opening JE leaf in the merkle root.
- **monkey** (repo rule): hostile payloads — negative, huge numbers, `'0'` boundary, same-event replay (idempotency), COA mapping removed → MAPPING_MISSING.

## 6. Risks / known gaps (honest)

- Zero-basis lots remain unanchored by design (D2) — documented residual gap.
- Legacy opening lots remain unanchored forever (D1) — acceptable because demo DB is re-seedable.
- JE anchors cost only, never quantity; quantity tampering on any lot is caught only by drift recompute, unchanged from C4.
