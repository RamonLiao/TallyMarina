# C4 Lot Store — Design Spec

**Date**: 2026-07-05
**Status**: Approved by user (brainstorming session)
**Depends on**: C2 period attribution (merged `5d92361`)

## 0. Problem

Lot / cost-basis state is currently transient and fake:

- `services/api/src/http/buildRuleInput.ts:35-38` hardcodes a single demo lot; nothing is read from DB.
- The rules engine computes `lotMovements` per event (`services/rules-engine/src/index.ts:105`), but the run-rules route (`routes.ts:403`) persists only the JE — **lot movements are dropped on the floor**.
- Consequence: no roll-forward. Every run sees the same lot inventory; consumption never sticks across runs; lots have no period attribution; a locked period's lot consumption has no durable record to pin against.
- `accounting-spec-v3.md` §lots (≈580-630) already defines lot semantics (lot_id, FIFO, lot_seq); architecture spec mandates "missing lot → fail closed". This spec supplies the persistence design.

## 1. Truth model: derived ledger

**Lots are derived deterministically from events.** Persisted rows are a materialized audit trail, never an independent source of truth.

- `OPENING_LOT` events establish pre-history holdings (the role the hardcoded demo lot plays today).
- Acquisition strategies already emit positive-delta movements (`receiptRules.ts:19`, `swapRules.ts:40` acquired leg); disposal strategies emit negative-delta movements via FIFO (`paymentRules.ts`, `swapRules.ts` disposed leg, `gasRules.ts`).
- Remaining quantity per lot = Σ signed `delta_qty_minor` over persisted movements. **No mutable `lot` head table, no CAS updates** — one append-only table is the entire persistence surface.

### Locked vs open periods (pin rule)

- **Locked periods**: lot consumption is whatever the persisted movements (written alongside the frozen JEs) say. We never re-run old rules over locked periods to answer "what did period P consume".
- **Open period**: recomputed as usual (evaluate over remaining lots).
- **Drift**: if a from-events recompute of lot state disagrees with persisted movements (e.g. policy changed after a lock), that is surfaced fail-loud (drift object on the read endpoint, § 5) — never silently averaged, never silently rewritten. Consistent with C2 lock semantics: closing a period fixes its accounting facts.
- **Drift resolution (accounting procedure)**: the correct remedy for wrong locked-period facts is a forward correcting entry / restatement in an open period — never an in-place fix. This round only surfaces drift; the correcting-JE workflow is deferred (§7). [CPA I3]

## 2. Schema (additive; no existing table changes)

New table `lot_movement` in `services/api/src/store/schema.sql`:

| column | notes |
|---|---|
| `id` TEXT PK | deterministic movement id |
| `entity_id` TEXT NOT NULL REFERENCES entities(id) | |
| `event_id` TEXT NOT NULL REFERENCES events(id) | origin event |
| `je_id` TEXT NULL REFERENCES journal_entries(id) | NULL for OPENING_LOT (no JE this round) |
| `lot_id` TEXT NOT NULL | engine convention, e.g. `R-{txDigest}-{eventIndex}` |
| `period_id` TEXT NOT NULL | inherited from source event (C2 attribution) |
| `coin_type`, `wallet` TEXT NOT NULL | |
| `delta_qty_minor` TEXT NOT NULL | **signed string** — mirrors engine `LotMovement.deltaQtyMinor` (`domain/types.ts:112-118`); +acquire / −dispose. No direction enum. |
| `delta_cost_minor` TEXT NOT NULL | signed string, same convention |
| `lot_seq` TEXT NOT NULL | **explicit FIFO ordering key** (acquisition datetime / block sequence per accounting-spec §4.3). `lot_id` (`R-{txDigest}-{eventIndex}`) is NOT chronological; without this column cross-run FIFO order — and therefore cost basis — cannot be reconstructed from rows. [CPA C3] |
| `cost_basis_method` TEXT NOT NULL | constant `FIFO` this round. Append-only rows cannot be retroactively tagged with the method that produced them — stamp now, cheap. [CPA I2] |
| `policy_set_version` TEXT NOT NULL | policy version at evaluation time, same append-only-provenance argument. [CPA I2] |
| `idempotency_key` TEXT NOT NULL UNIQUE | derived from JE idempotency_key + lot_id; for OPENING_LOT, from event id + lot_id |

- Index: `(entity_id, wallet, coin_type)` — the buildRuleInput fold scans per event. [SUI M5]
- Values stored as strings (minor units), matching engine BigInt-string convention and `je_json` practice.
- **Sign semantics**: the sign of `delta_qty_minor` encodes quantity direction (inflow/outflow), NOT debit/credit — an acquisition is a debit to the asset yet a positive delta. Future UI must not map sign to `--debit`/`--credit` tokens blindly. [FE F5]
- **Snapshot manifest stays JE-only, intentionally**: the current `lotMovements: []` stub in the snapshot route (`routes.ts:696`) remains empty after C4. Adding movements to the manifest would change merkle roots of already-anchored periods. Do not "helpfully" wire it. [SUI M4]
- **Atomicity**: movements are inserted in the same SQLite transaction as `insertJournalEntry`. A crash can never leave a JE without its consumption record (or vice versa). This closes the `routes.ts:403` gap.
- **Idempotency**: UNIQUE `idempotency_key` makes replay a no-op, same pattern as `journal_entries.idempotency_key`.

## 3. OPENING_LOT event type

- New event type flowing through the existing events table + fixtures (single source of truth). It enters the **events table + ingest audit trail** — NOT the merkle/anchor spine: the merkle tree is built exclusively from JEs (`buildSnapshot.ts:24-31`; events carry no `leaf_hash`). Cryptographic anchoring of opening lots only becomes possible once the opening-equity JE lands (§7). [SUI C1]
- **GL tie-out exclusion**: because OPENING_LOT posts carrying cost into the lot subledger with no offsetting GL entry, the subledger↔GL reconciliation (§8) fails by construction for opening lots. The tie-out invariant is explicitly scoped to **post-opening movements** until the opening-equity JE lands; this exclusion is a documented limitation, not an oversight. [CPA C2]
- New rules-engine strategy: emits a positive-delta movement establishing the lot (with explicit `lotSeq` ordering for FIFO). **No JE this round** — opening-equity JE is honestly deferred (§7).
- **Not** in the F3 AUTO allow-list: an LLM path can never auto-create lot origins. OPENING_LOT events are fixture/ingest data, not classification output.
- Validation is fail-closed at schema level: non-positive quantity, missing cost, missing wallet/coinType → reject at ingest (per 2026-06-21 lesson: direction is carried by event type, never by sign of input values).

## 4. buildRuleInput: real lots in, hardcode out

- Delete the hardcoded demo lot (`buildRuleInput.ts:35-38`).
- Replace with a fold: for the event's (entity, wallet, coinType), read persisted `lot_movement` rows → group by `lot_id` → remaining = Σ delta_qty; carrying cost = Σ delta_cost → drop zero-remaining lots → order by lot seq → feed FIFO.
- The FIFO engine (`core/fifo.ts`) and its 12 tests are **untouched** — only the input source changes.
- Missing/insufficient lots → existing fail-closed behavior (RuleException → exception queue). No new leniency.
- Demo fixture: the current hardcoded lot becomes an `OPENING_LOT` fixture event so the demo pipeline runs end-to-end through the real path.

## 5. Read endpoint

`GET /entities/:id/lots` (read-only, no frontend work this round). The DTO is the future lot panel's only contract — shape it now: [FE F1-F4]

- Grouped per (wallet, coinType), each group carrying **`decimals`** (repo convention: `ReconRowDTO.decimals` + `fmtMinor`; minor-unit strings are unrenderable without it).
- Per lot: `lotId`, `lotSeq`, remaining qty, carrying cost, origin event id, **`origin: 'opening' | 'derived'`** plus a provenance block (repo's honest-layering convention — fixture opening lots must not render at the same trust level as event-derived movements).
- **Drift as an object, not a boolean**: per-lot `{ recomputed: {qty, cost}, persisted: {qty, cost} }` when they disagree — the existing `drift-warn` fail-loud pattern (`ReconDetail.tsx:55-59`) displays both sides.
- Movement history entries mirror §2 rows: `eventId`, `jeId` (nullable — OPENING_LOT renders honestly as "no JE", not a broken link), `periodId`, signed `deltaQtyMinor`/`deltaCostMinor`.
- Optional `periodId` filter (movements carry period attribution).

## 6. Red team (core accounting path — mandatory)

| # | Attack | Defense |
|---|---|---|
| 1 | Concurrent run-rules double-consume the same lot | movements in same tx as JE + UNIQUE idempotency key + existing per-entity serialization |
| 2 | Insert OPENING_LOT into a locked period after close (falsify opening state) | event period attribution (C2) + existing lock guards reject writes into locked periods |
| 3 | Replay run-rules to double-count movements | UNIQUE idempotency_key → conflict = skip, mirrors JE insert |
| 4 | Negative / garbage / overflow quantities on OPENING_LOT | fail-closed schema validation at ingest (§3); FIFO engine already throws on bad lots |
| 5 | Partial write: JE persisted but movements lost (or reverse) | single transaction (§2); no cross-call gap |

All defenses above are **app-level** (route guards, transactions, constraints), not evidence-level. The evidence layer (anchor) covers consumption indirectly via gain/loss amounts embedded in anchored `je_json`; opening lots have no evidence-level protection this round (§7). [SUI I3]

## 7. Deferred (honest, not silently skipped)

- **Opening-equity JE for OPENING_LOT** (Dr asset / Cr opening equity) — lot origination only this round. **Elevated priority — this deferral carries two documented costs**: ① opening lots have zero cryptographic anchoring (no JE → no leaf → no merkle → tampering with an opening event+movement pair after lock poisons all downstream cost basis and the anchor cannot detect it; the drift comparator recomputes from the same tamperable SQLite rows) [SUI I2]; ② GL tie-out excludes opening lots (§3) [CPA C2]. First candidate for the next round.
- Lot-level realized gain/loss capture (proceeds + realized G/L per disposal movement; accounting-spec §4.4 disposal analysis). G/L lives in the JE this round. [CPA I1]
- Drift-resolution workflow (forward correcting JE in an open period; §1 only surfaces). [CPA I3]
- Existence assertion (lot remaining qty vs live on-chain wallet balance; partially overlaps the recon workspace's live chain-balance column). [CPA M1]
- Dual-track carrying vs historical cost / impairment fields (accounting-spec §4.4). [CPA M2]
- Manual lot adjustments / write-downs.
- Cost-basis method switching (FIFO only; the `cost_basis_method` column is stamped now, switching logic is future).
- Frontend lot panel (endpoint contract shaped in §5; UI is a separate round).
- Multi-entity shared-wallet lot attribution (pre-existing sharp edge, unchanged).
- Backfill of movements for JEs persisted before C4 (demo DBs are reset; production would need a migration).

## 8. Testing

- **Unit**: fold logic (movement rows → remaining lots), OPENING_LOT strategy, drift comparator, FIFO order stability across runs (consume, then verify next run's order comes from persisted `lot_seq`, not `lot_id`).
- **Integration**: run-rules twice → identical lot state, zero duplicate movements; consumption in period P then evaluation in P+1 sees rolled-forward remaining; locked-period pin (recompute disagreement → drift object, persisted values unchanged).
- **Subledger↔GL tie-out (the defining subledger invariant)**: Σ(remaining carrying cost) per (coin, wallet) ties to the GL asset control-account balance derived from persisted JEs — scoped to post-opening movements (§3 exclusion). Without this a lot ledger can silently diverge from the JEs it claims to explain. [CPA C1]
- **Monkey** (mandatory per test.md): garbage OPENING_LOT payloads, BigInt extremes, concurrent run-rules hammering, movement/JE atomicity under injected failure.
- Tests must encode *why*: e.g. the double-run test exists because transient lots previously made re-runs double-consume — a test that passes with the hardcoded lot restored is wrong.

## 9. Verify-before-coding (plan stage)

- Exact `LotPlan`/`lotSeq` ordering contract consumed by `fifo.ts` (what field orders lots today) — and that the persisted `lot_seq` column (§2) is populated from the same source, so persisted order and engine order can never diverge.
- Whether `RuleOutput.lotMovements` carries lotSeq / enough data for the persisted row (incl. `cost_basis_method`/`policy_set_version` stamps), or the strategy layer must be extended.
- run-rules transaction boundaries in `routes.ts` (is there an existing tx wrapper per event or per run).
- All `buildRuleInput` call sites (per 2026-07-04 lesson: grep every usage + read call-site comments for deliberate pins before touching shared input builders).
- GL control-account identification for the tie-out test (§8): which COA accounts constitute the digital-asset control account in the current rules/policy set.

## 10. Review adjudication (2026-07-05, three-lens)

Three parallel fresh-context reviews — SUI architect (w/ sui-architect skill), senior CPA, frontend-design (DTO-as-contract) — all READY-WITH-FIXES, zero conflicts. All 15 findings accepted: 12 folded into §§1-9 above (tagged inline `[SUI …]`/`[CPA …]`/`[FE …]`), 3 deferred-documented in §7 (CPA I1/M1/M2). Key corrections: §3 merkle-spine claim was FALSE (rewritten); `lot_seq`/`cost_basis_method`/`policy_set_version` columns added (append-only provenance can't be backfilled); GL tie-out invariant added to §8 with explicit opening-lot exclusion; §5 DTO shaped as the future UI contract (decimals/origin/drift-object/movement shape).
