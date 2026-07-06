# Opening-Equity JE for OPENING_LOT — Design Spec

**Date**: 2026-07-05
**Status**: Approved (user); CPA correctness review + three-lens review (SUI architect / CPA sufficiency / frontend) all integrated below — adjudication table in §7
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
  - `ACQUISITION` — DEBIT (reuses the existing leg name; resolves to the asset control account). **Pinned (SUI)**: populate `origCoinType = event.coinType` and `origQtyMinor = event.quantityMinor`, following every existing ACQUISITION leg (`receiptRules.ts:34`, `swapRules.ts:61`). The leaf codec anchors these fields, so the declared quantity and coinType of an anchored opening lot enter the merkle leaf too — a strictly stronger guarantee than cost-only (§6 restated accordingly).
  - `OPENING_EQUITY` — CREDIT (new leg name)
- If `openingCostMinor === '0'`: return `[]` (current JE-less path unchanged).

`lotMovements` output unchanged.

**`openingCostMinor` semantics (CPA must-add)**: the value is **functional-currency (USD) minor units of historical cost**, never native-token raw units. Its scale is unrelated to `assetDecimals`/coinType decimals. A wrong-scale value stays internally consistent (JE balances, tie-out holds, drift silent) yet is economically wrong and permanently anchored — the doc pins the contract; ingestion UX validation is out of scope.

**Validation hardening (SUI monkey lens)**: current code only checks falsy — `'-5'` would pass and emit a negative-amount leg, breaking Dr=Cr>0 and the movement sign convention. Pin: non-integer / negative / non-BigInt-parseable `openingCostMinor` → `SCHEMA_INVALID` (fail-closed, matching existing style).

### 3.2 Chart of accounts (`services/api/src/http/policyConstants.ts`)

- New account: `OpeningBalanceEquity` (equity class — opening balances are a ledger-start declaration, not a current-period economic event; posting to income accounts would pollute period P&L).
- **Clearing-account disclosure (CPA)**: `OpeningBalanceEquity` is properly a temporary clearing account — once all opening balances are loaded, a full system closes it out to Retained Earnings / Contributed Capital. A permanently nonzero OBE balance is an audit red flag. This round treats it as terminal (demo scope); the close-out entry is a documented deferred item (§6).
- Two new mappings: `(OPENING_LOT, ACQUISITION) → DigitalAssets`, `(OPENING_LOT, OPENING_EQUITY) → OpeningBalanceEquity`.
- User policies without these mappings hit the existing `MAPPING_MISSING` fail-closed exception. No new mechanism.

### 3.3 Persist (`services/api/src/http/routes.ts` run-rules transaction)

Expected zero structural change: the existing transaction already persists JE + movements + markPosted atomically. OPENING_LOT simply moves from 0 JEs to 1; the movement's `je_id` becomes the real JE id instead of NULL.

**Must verify**: the JE-less special-case branch near `routes.ts:449` (persisting movements for POSTABLE outputs with no JE) must not also fire for a JE-backed OPENING_LOT — no double-persist, no skip.

**JE idempotency key (revised by SUI review — the earlier `${eventId}|OPEN` literal was unimplementable)**: JE idempotency keys are computed engine-level, not per-rule — `index.ts:73/99` assigns `idempotencyKey(input, null)` (sha256 over event identity + policy versions, `core/idempotency.ts:5-22`); a strategy's `buildJeLines` cannot set the key, so a rule-specific literal would contradict D3. The opening JE simply uses the **engine-standard key**: deterministic per event+policySet, replay collides → REPLAY no-op, no cross-key collision. Nuance: the key folds in policy versions, so a policy bump changes it — no drift path exists because POSTED events are never re-candidates (`routes.ts:439-441`), stated here for the record.

Knock-on on the movement anchor: `routes.ts:473` computes it as `output.journalEntries[0]?.idempotencyKey ?? ev.id`, so a JE-backed OPENING_LOT's movement key becomes `${jeKey}|${lotId}`; zero-basis lots (no JE) keep `${eventId}|${lotId}`. Forward-only (D1) means no persisted legacy row ever changes key. Frontend must never reconstruct these keys client-side (§3.5b).

### 3.3b Reconciliation (added post-implementation, dual-review R1 #3, user-adjudicated)

The recon book-movement fold **excludes OPENING_LOT journal legs**. An opening declaration is pre-history: its chain-side counterpart is the recon fixture's `openingMinor`, not period activity; counting the opening JE's `origQtyMinor` as a period movement double-counts holdings and forces a manual material-break dismissal every close. Exclusion also restores symmetry with zero-basis lots, which are JE-less and therefore never counted.

### 3.4 Merkle / snapshot

No code change. Non-zero opening lots' JEs enter the spine naturally, closing the evidence gap. The `EMPTY_SNAPSHOT` edge (run containing only zero-basis opening lots) is retained as-is: it is already fail-loud, and zero-basis lots are adjudicated unanchored (D2).

### 3.5 Tie-out (tests + DTO disclosure)

Identity changes from "total − opening basis = GL" to:

> `total − (original as-loaded basis of JE-less opening lots) === GL`

**Why "original", not "remaining" (CPA must-fix)**: disposal credits do not discriminate by lot origin — when a JE-less opening lot is consumed, GL receives the disposal credit but never received the opening debit. With consumed portion `c` and remaining `r`, `total − GL = c + r = original`; using "remaining" is only correct while `c = 0`. The pre-existing tie-out test happens to never consume the opening lot, which masked this.

- JE-backed opening basis joins the full identity (its debit is in GL); JE-less (legacy, `je_id IS NULL`) and zero-basis lots are excluded at **original loaded basis**.
- **Consumed-legacy boundary (documented, not fixed)**: once a JE-less opening lot is consumed, the disposal credit has no matching opening debit; a "remaining"-style check would break by the consumed carrying amount. This round relies on forward-only + re-seedable demo DB to avoid live legacy lots; the boundary gets an explicit test (below), not a repair.
- Tests: `lots.tieout.test.ts` gains (a) a JE-backed opening fixture proving both regimes coexist, (b) a consume-a-legacy-JE-less-lot case pinning the original-basis identity (and demonstrating why "remaining" fails).

### 3.5b DTO disclosure (CPA must-fix; shape adjudicated by frontend review)

The lots DTO keeps `origin: 'opening' | 'derived'` **unchanged** and adds a lot-level field:

> `acquireJeId: string | null` — the acquire movement's `je_id`. Real JE id for derived and JE-backed opening lots; `null` for legacy and zero-basis opening lots.

Why not a three-way `origin` enum (`opening-anchored | opening-legacy | derived`): that would silently break every existing `o === 'opening'` predicate (`lots.tieout.test.ts:133-134`, `lots.route.test.ts:73/133`) — not additive; and origin (opening vs derived) and anchoring (JE-backed or not) are orthogonal axes that don't belong in one enum. The nullable-id shape also matches the existing `movements[].jeId: string | null` convention (`dto.ts:23`).

Navigation contract: `acquireJeId` is the **join key** into `GET /entities/:id/journal`, where the proof triple (idempotencyKey / leafHash / lineageHash) already lives — no proof fields are duplicated onto the lots DTO, and the frontend must never reconstruct idempotency keys client-side. Discrimination source: `lot_movement.je_id IS NULL`. Badge derivation is one line: `origin === 'opening' && acquireJeId === null → unanchored`.

### 3.6 Forward-only mechanics

No migration, no backfill script. Pre-existing JE-less opening movements remain permanently on the exclusion side; the discriminator is encoded in data (D4), not documentation memory. C4 spec §7 to be updated: gap narrows to "legacy + zero-basis lots" (housekeeping while editing: C4's `routes.ts:696` manifest-stub line reference is stale, now ~786).

### 3.7 Period attribution governance (CPA must-add — documented rule, guard deferred)

An opening balance is a ledger-start declaration; it belongs **only to the entity's inception period**. Today nothing enforces this — `periodOf(eventTime)` (`period.ts:8`) attributes OPENING_LOT to whatever open period matches, so a mid-life Q3 injection of asset basis + OBE credit is technically possible (only locked periods reject, `routes.ts:429`). Injecting opening basis into an operating period pollutes period comparability and makes "brought-in" indistinguishable from "acquired this period."

This round pins the rule at the document/fixture level: **demo uses a single inception period for all OPENING_LOT events; fixtures must not mix opening events into operating periods.** A hard guard (reject OPENING_LOT whose period is not the entity's first period) is deferred (§6).

## 4. Out of scope

- Backfill/migration of any kind (D1).
- Anchoring zero-basis lots (D2).
- Frontend UI changes — the DTO disclosure (§3.5b) is backend-only and additive; no UI work this round (verified: `web/src` has zero non-test consumers of the lots endpoint).
- OBE close-out entry to Retained Earnings (§3.2 disclosure) — deferred.
- **Future lot-panel visual language (frontend review, recorded for the UI round)**: anchored opening lot = solid-border pill badge (`.ob-badge` convention) in `--aqua-bright`, "anchored · JE #", clicking joins journal via `acquireJeId` and expands the existing four-state `ProofBadge`. Unanchored (legacy/zero-basis) = same pill, **dashed border + `--ink-soft`** — dashed is the codebase's established "provisional" signal (`.light--mock`, export draft card, AgentProposalCard) — copy "unanchored · opening basis excluded from GL tie-out" (says why, not just what). Not `--debit` red (unanchored is an adjudicated design state, not an error) and not `--brass` (reserved for primary actions).
- Move contract changes — zero `.move` diff; `sui move test` not applicable (stated, not skipped).

## 5. Testing

- **rules-engine unit**: legs balance (Dr = Cr = openingCostMinor); `'0'` → `[]`; missing `openingCostMinor` still `SCHEMA_INVALID`.
- **api tie-out**: dual-regime fixture — one JE-backed opening lot (included in GL identity) + one legacy/zero-basis (excluded at original basis); identity holds. Plus the consumed-legacy boundary case (§3.5).
- **api DTO**: `acquireJeId` asserted for all three lot classes — derived (real id), JE-backed opening (real id), legacy/zero-basis opening (null) (§3.5b).
- **snapshot**: known-answer test with an opening JE leaf in the merkle root.
- **monkey** (repo rule): hostile payloads — negative / non-integer → `SCHEMA_INVALID` (§3.1 hardening), huge numbers (BigInt range), `'0'` boundary, same-event replay (idempotency), COA mapping removed → MAPPING_MISSING.

## 7. Review adjudication table

| Lens | Verdict | Finding | Disposition |
|------|---------|---------|-------------|
| CPA correctness (round 1) | READY-WITH-FIXES | Tie-out identity must exclude *original* (not remaining) JE-less opening basis | Accepted — §3.5 |
| CPA correctness | | DTO must disclose anchoring (reconciling item, not test-only) | Accepted — §3.5b |
| CPA correctness | | OBE is a clearing account; permanent balance is an audit flag | Accepted — §3.2 disclosure + §6 |
| CPA correctness | | JE idempotencyKey undefined; proposed `${eventId}\|OPEN` | Superseded by SUI finding (below) |
| SUI architect | READY-WITH-FIXES | `${eventId}\|OPEN` literal unimplementable — key is engine-level sha256, rules can't set it | Accepted — §3.3 uses engine-standard key |
| SUI architect | | ACQUISITION leg must pin `origCoinType`/`origQtyMinor`; "anchors cost only" claim false once pinned | Accepted — §3.1 + §6 restated (stronger guarantee) |
| SUI architect | | `'-5'` passes today → negative JE leg; pin SCHEMA_INVALID | Accepted — §3.1 hardening |
| SUI architect | OK | Merkle/anchoring claims, forward-only × anchored roots, manifest declaration all verified true | No change |
| CPA sufficiency | SUFFICIENT-WITH-ADDITIONS | Inception-period attribution rule undefined | Accepted — §3.7 (doc rule; hard guard deferred) |
| CPA sufficiency | | `openingCostMinor` currency/scale semantics unpinned | Accepted — §3.1 |
| CPA sufficiency | | Correction path / cross-event duplicate / substantiation / SoD | Accepted as documented deferred items — §6 |
| CPA sufficiency | | OBE-nonzero close warning should NOT be added now | Confirmed — §6 |
| Frontend | READY-WITH-FIXES | Three-way origin enum is breaking, not additive; adopt `acquireJeId: string \| null` | Accepted — §3.5b |
| Frontend | | jeId is the join key to journal proof triple; never reconstruct keys client-side | Accepted — §3.5b |
| Frontend | | Future badge visual language | Recorded — §4 deferred |

## 6. Risks / known gaps (honest)

- Zero-basis lots remain unanchored by design (D2) — documented residual gap.
- Legacy opening lots remain unanchored forever (D1) — acceptable because demo DB is re-seedable.
- **What the opening JE anchors (corrected by SUI review)**: with `origCoinType`/`origQtyMinor` on the ACQUISITION leg (§3.1), the leaf anchors declared cost, quantity, and coinType — stronger than cost-only. Still unanchored regardless: lot identity/linkage (`lot_movement.je_id` join is DB-only; `lotId` is not in the leaf), wallet, and the lot **fold** (the leaf anchors declared amounts, not that movement rows still match them — drift recompute carries that, unchanged from C4).
- `OpeningBalanceEquity` carries a permanent balance this round (no close-out to Retained Earnings) — audit-noted, deferred (§3.2).
- Consumed legacy JE-less lots break the "remaining"-style intuition; the invariant is stated at original basis and the boundary is test-pinned, but GL for such lots is structurally one-sided forever (§3.5).
- **Correction/reversal path missing (CPA)**: a fat-fingered opening amount, once posted and anchored, has no reversal/correcting-entry strategy — deferred; demo relies on re-seed.
- **Cross-event duplicate registration is a known non-defense (CPA)**: idempotency keys only stop replay of the *same* event. Registering the same (wallet, coinType) holding under two different eventIds double-counts basis and OBE symmetrically — tie-out still balances, nothing alerts. Explicitly not defended this round.
- **Basis substantiation reference missing (CPA)**: no field carries the source of the opening basis (prior-period books, external statement); `txDigest` is a placeholder for pre-history lots. Audit-grade blocker, demo-acceptable — deferred.
- **Inception-period hard guard deferred (§3.7)**: rule is documented + fixture-enforced only; no code rejects an OPENING_LOT in a non-first period.
- SoD/authorization for opening entries: inherits the system-wide no-auth demo posture; no opening-specific handling (already flagged blocking-for-production elsewhere).
- OBE-nonzero close warning **intentionally not added**: since close-out itself is deferred, such a light would be permanently red and block every close — adding it now would be wrong (CPA-confirmed).
- **Identical-payload double-ingest fails loud with an unfriendly 500 (dual-review R1 #2, deferred)**: re-ingesting a byte-identical OPENING_LOT payload creates a second event row whose run-rules persist collides on the movement idempotency key and throws ledger-corruption-style; the duplicate event stays AUTO, so subsequent run-rules for that period keep 500ing until the duplicate row is removed. Loud, not corrupting — but the root fix is ingest-level dedup on `(entityId, txDigest, eventIndex)`, which is the already-deferred C4 item. Receipts share this path (pre-existing); this branch extends it to OPENING_LOT.
- **`skipped` counter conflates swallowed-duplicate JE with benign skip (R1 #4, accepted)**: after the R1 #1 fail-loud fix the silent-swallow branch is unreachable for mismatched payloads; the counter ambiguity remains only for true replays, where "skipped" is accurate.
