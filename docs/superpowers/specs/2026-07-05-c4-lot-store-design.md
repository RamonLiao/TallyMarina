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
- **Drift**: if a from-events recompute of lot state disagrees with persisted movements (e.g. policy changed after a lock), that is surfaced fail-loud (drift flag on the read endpoint, § 5) — never silently averaged, never silently rewritten. Consistent with C2 lock semantics: closing a period fixes its accounting facts.

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
| `idempotency_key` TEXT NOT NULL UNIQUE | derived from JE idempotency_key + lot_id; for OPENING_LOT, from event id + lot_id |

- Values stored as strings (minor units), matching engine BigInt-string convention and `je_json` practice.
- **Atomicity**: movements are inserted in the same SQLite transaction as `insertJournalEntry`. A crash can never leave a JE without its consumption record (or vice versa). This closes the `routes.ts:403` gap.
- **Idempotency**: UNIQUE `idempotency_key` makes replay a no-op, same pattern as `journal_entries.idempotency_key`.

## 3. OPENING_LOT event type

- New event type flowing through the existing events table + fixtures (single source of truth; enters merkle/audit spine like every other event).
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

`GET /entities/:id/lots` (read-only, no frontend work this round):

- Per (wallet, coinType): lots with remaining qty, carrying cost, origin event id, movement history.
- Includes a **drift flag**: recompute-from-events vs persisted-movements comparison result (fail-loud surface for §1 drift).
- Optional `periodId` filter (movements carry period attribution).

## 6. Red team (core accounting path — mandatory)

| # | Attack | Defense |
|---|---|---|
| 1 | Concurrent run-rules double-consume the same lot | movements in same tx as JE + UNIQUE idempotency key + existing per-entity serialization |
| 2 | Insert OPENING_LOT into a locked period after close (falsify opening state) | event period attribution (C2) + existing lock guards reject writes into locked periods |
| 3 | Replay run-rules to double-count movements | UNIQUE idempotency_key → conflict = skip, mirrors JE insert |
| 4 | Negative / garbage / overflow quantities on OPENING_LOT | fail-closed schema validation at ingest (§3); FIFO engine already throws on bad lots |
| 5 | Partial write: JE persisted but movements lost (or reverse) | single transaction (§2); no cross-call gap |

## 7. Deferred (honest, not silently skipped)

- Opening-equity JE for OPENING_LOT (Dr asset / Cr opening equity) — lot origination only this round.
- Manual lot adjustments / write-downs.
- Cost-basis method switching (FIFO only; `cost_basis_method` per accounting-spec is future).
- Frontend lot panel (endpoint exists; UI is a separate round).
- Multi-entity shared-wallet lot attribution (pre-existing sharp edge, unchanged).
- Backfill of movements for JEs persisted before C4 (demo DBs are reset; production would need a migration).

## 8. Testing

- **Unit**: fold logic (movement rows → remaining lots), OPENING_LOT strategy, drift comparator.
- **Integration**: run-rules twice → identical lot state, zero duplicate movements; consumption in period P then evaluation in P+1 sees rolled-forward remaining; locked-period pin (recompute disagreement → drift flag, persisted values unchanged).
- **Monkey** (mandatory per test.md): garbage OPENING_LOT payloads, BigInt extremes, concurrent run-rules hammering, movement/JE atomicity under injected failure.
- Tests must encode *why*: e.g. the double-run test exists because transient lots previously made re-runs double-consume — a test that passes with the hardcoded lot restored is wrong.

## 9. Verify-before-coding (plan stage)

- Exact `LotPlan`/`lotSeq` ordering contract consumed by `fifo.ts` (what field orders lots today).
- Whether `RuleOutput.lotMovements` carries lotSeq / enough data for the persisted row, or the strategy layer must be extended.
- run-rules transaction boundaries in `routes.ts` (is there an existing tx wrapper per event or per run).
- All `buildRuleInput` call sites (per 2026-07-04 lesson: grep every usage + read call-site comments for deliberate pins before touching shared input builders).
