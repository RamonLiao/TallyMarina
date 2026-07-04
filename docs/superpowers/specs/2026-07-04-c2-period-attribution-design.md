# C2 — Period Attribution Design

**Date:** 2026-07-04
**Status:** Approved (brainstorming) → pending implementation plan
**Backlog origin:** `reviews/architecture-review-4lens-2026-07-03.md:13` (C2, Critical); `tasks/notes.md:74`
**Depends on / unblocks:** H2 (snapshot persistence) builds on this; C4 (lot store) is independent.

## 1. Problem

The subledger is single-period by fiat. `DEFAULT_PERIOD = '2026-Q2'` is hardcoded at `services/api/src/http/routes.ts:70` and referenced by 12 call sites. `events` and `journal_entries` carry **no** `period_id`, and `collectExceptions()` scans `listEvents(db, entityId)` — the entity's **entire** history with no time filter. Consequently:

- No mechanism attributes a transaction to a period.
- No query scopes a period's ledger to *its own* transactions.
- Snapshots are built "per period" nominally, but since JEs have no `period_id`, a snapshot is really "all entity JEs labelled `2026-Q2`". The lie is invisible only because there is exactly one period.
- The **completeness** and **cutoff** accounting assertions — which are *defined* as "was the transaction recorded in the correct period" — are therefore vacuous.

## 2. Scope

**In scope:** real per-transaction period attribution + multi-period slicing so that every period-level operation (lock, snapshot, anchor, exceptions, completeness) sees only that period's transactions, and cutoff genuinely holds.

**Out of scope (explicit, YAGNI):**
- Prior-period adjustment / restatement.
- A `periods` registry table / period lifecycle CRUD (periods are derived, see §5).
- Per-entity configurable fiscal calendar (fixed calendar-year quarters here; `periodOf` left extensible).
- Frontend multi-period UI (cockpit period selector) — this spec defines only the backend contract impact.
- H2 snapshot version-chain semantics (`supersedesSeq`). This spec makes a snapshot select the *correct* JE set; it does not touch how `supersedesSeq` is computed.

## 3. Attribution rule

A transaction's period is derived **deterministically from its transaction date** (`eventTime`) via a fixed calendar-year quarterly fiscal calendar. This is the normative definition of the cutoff assertion: a transaction is recorded in the period in which the economic event occurred. Attribution is pure code, never an LLM judgment (Rule 5).

### 3.1 `periodOf`

```
periodOf(eventTime: string | Date): PeriodId   // 'YYYY-Q{1..4}'
```

- Quarter: `Q = floor(UTCmonth0 / 3) + 1`; id = `${UTCFullYear}-Q${Q}`.
- **Computed in UTC.** Entity timezone is a display concern and does **not** enter attribution — this is deliberate and pinned by a test, because timezone drift on a boundary date is exactly how transactions get mis-periodized.
- Lives in `packages/rules-engine` (the existing shared boundary) and is imported by the API and every other period consumer, so there is exactly **one** quarter implementation. Any second copy (e.g. a SQL expression) is forbidden.
- Invalid / unparseable `eventTime` → throws / rejected upstream as `INVALID_EVENT_TIME`; there is no "no period" event.

## 4. Schema changes (additive migration)

| Table | Change | Nullability |
|-------|--------|-------------|
| `events` (schema.sql:8-16) | add `period_id TEXT` | app-enforced non-null (see §6) |
| `journal_entries` (17-24) | add `period_id TEXT`, inherited from source event | app-enforced non-null |
| `exception_disposition` (46-58) | add `period_id TEXT` | nullable (matches existing `recon_break_disposition` pattern) |
| `exception_disposition_log` (59-71) | add `period_id TEXT` | nullable |

- Index `(entity_id, period_id)` on `events`, `journal_entries`, `exception_disposition`.
- No `periods` table. `period_lock`, `snapshots`, `recon_break_disposition(+log)`, `triage_proposal` already carry `period_id` and are unchanged structurally.

**Why `NOT NULL` is app-enforced, not a DB constraint:** SQLite cannot add a `NOT NULL` column to a populated table without a full table-rebuild (create-new → copy → drop → rename). Rebuilding tables that carry append-only-log semantics is higher risk than the guarantee is worth. Instead: backfill to zero nulls, verify, and rely on the ingest path always writing `period_id` (§5.2). The schema comment states this is app-enforced. This is Rule 12 fail-loud: better to name the enforcement honestly than fake a DB constraint. `exception_disposition.period_id` stays nullable to conform to the existing recon disposition pattern (Rule 11).

## 5. Data flow: entity-scoped → period-scoped

### 5.1 Periods are derived, not created

- Existing periods for an entity = `SELECT DISTINCT period_id FROM events WHERE entity_id=?`.
- A period is OPEN iff `getPeriodLock(db, entityId, periodId)` returns no row or `status !== 'LOCKED'` (existing lazy pattern; "no row = OPEN").
- No period-creation step exists; the calendar function + the lazy `period_lock` row together carry all per-period state.

### 5.2 Ingest gate (attribution + locked-reject, atomically)

On ingest of an event, before insert, within one transaction:
1. `pid = periodOf(event.eventTime)` (reject `INVALID_EVENT_TIME` if unparseable).
2. If `getPeriodLock(db, entityId, pid).status === 'LOCKED'` → **409 `PERIOD_LOCKED_FOR_DATE`**, body `{ periodId: pid, eventTime }`, do not insert.
3. Else set `events.period_id = pid` and insert.
4. Downstream classify→JE creation copies the source event's `period_id` onto the JE.

The lock check and the insert **must share one transaction** to close the TOCTOU window between computing the period and inserting (same class of race the round-1 triage agent's lock-sweep TOCTOU exposed).

### 5.3 Query layer (new period-scoped variants; existing signatures preserved)

- `listEvents(db, entityId)` → add `listEventsByPeriod(db, entityId, periodId)` (`WHERE entity_id=? AND period_id=?`). Keep `listEvents` for genuine full-history needs (e.g. audit lineage).
- `collectExceptions(db, entityId, ...)` → takes `periodId`, uses `listEventsByPeriod` internally. **This is the fix for completeness/cutoff**: exception scanning stops seeing all history and sees only the period.
- `buildSnapshot` JE set → `WHERE entity_id=? AND period_id=?` (now genuinely per-period).

### 5.4 Route layer (periodId: implicit constant → explicit parameter)

| Route | Current | New |
|-------|---------|-----|
| `GET /cockpit` | `DEFAULT_PERIOD` | query param `?periodId=` **required**, else 400 `PERIOD_ID_REQUIRED` |
| `POST /decide` | `DEFAULT_PERIOD` | derived from the target event/exception's own `period_id` (**not** caller-supplied) |
| `POST /period/lock` | body `?? DEFAULT_PERIOD` | body `periodId` **required**, else 400 `PERIOD_ID_REQUIRED` |
| `POST /run` (triage) | pinned `DEFAULT_PERIOD` | sweeps all OPEN periods (§5.1) |
| `startTriageScheduler` | pinned `DEFAULT_PERIOD` | per entity, per OPEN period |

`POST /decide` intentionally does **not** accept a caller-supplied periodId: decide acts on one concrete event/exception whose period is already fact; letting the caller supply it only creates a mis-period hole. `GET /cockpit` intentionally has **no default**: cockpit shows one period's close status, and a default would silently show the wrong period under multi-period (fail-loud beats guessing).

`DEFAULT_PERIOD` is removed once all 12 call sites are converted.

## 6. Migration & backfill

One migration step, order matters:
1. `ALTER TABLE events ADD COLUMN period_id TEXT` (nullable — SQLite cannot add NOT-NULL-with-default to a populated table).
2. Backfill in **app-layer JS** (SQLite has no quarter function; must use the same `periodOf` implementation — no second quarter algorithm): for each event `UPDATE ... SET period_id = periodOf(eventTime)`.
3. `journal_entries.period_id` ← source event's `period_id` via the JE→event linkage.
4. `exception_disposition(+log).period_id` ← corresponding event's period (best-effort, nullable).
5. Create `(entity_id, period_id)` indexes.
6. **Verification gate:** assert `events` has zero `period_id IS NULL`. Any residual → abort migration, fail-loud (means an event lacks/has malformed `eventTime` and needs a human).

## 7. Demo: multi-period story

Existing demo events (`evt-demo-review/2`, …) land in their `eventTime`'s quarter after backfill. Add a seed set spanning **Q1 and Q2** so the demo runs the full script:
- Q1 has transactions → `POST /period/lock` locks Q1.
- Ingest an event whose `eventTime` falls in Q1 → **`PERIOD_LOCKED_FOR_DATE`** (cutoff visibly rejects the mis-period entry).
- Q2 still OPEN → a Q2 event ingests normally.

Seed lives in the existing demo seed mechanism (`services/api/data/` / demo seed script), not in the migration itself.

## 8. Error handling / invariants

| Situation | Behavior | Code |
|-----------|----------|------|
| ingest event lands in LOCKED period | 409, no insert | `PERIOD_LOCKED_FOR_DATE` |
| event missing / unparseable `eventTime` | ingest rejected | `INVALID_EVENT_TIME` |
| `GET /cockpit` without `periodId` | 400 | `PERIOD_ID_REQUIRED` |
| `POST /period/lock` without `periodId` | 400 | `PERIOD_ID_REQUIRED` |
| backfill leaves any `period_id IS NULL` | migration abort | — |
| lock acquired between period computation and insert (TOCTOU) | lock-check + insert in one transaction | — |

## 9. Testing (TDD; tests encode intent — Rule 9)

- **`periodOf` unit:** boundary dates pinned — `2026-03-31T23:59:59Z → 2026-Q1`, `2026-04-01T00:00:00Z → 2026-Q2`, `2026-12-31 → 2026-Q4`, year rollover. A dedicated test pins the **UTC decision** on a boundary date (so a timezone change can't silently mis-periodize).
- **Attribution integrity:** post-ingest `events.period_id === periodOf(eventTime)`; JE `period_id === source event`.
- **Multi-period slicing (core intent test):** seed Q1+Q2 → `collectExceptions(Q1)` returns **only** Q1 exceptions, **not** Q2; `snapshot(Q1).leafCount === Q1 JE count`. **This test must fail under the old "scan all history" behavior** — so seed cross-period deliberately, making "didn't slice" an observable bug.
- **Locked-reject:** lock Q1 → ingest Q1 event → 409; concurrently ingest Q2 event → 200.
- **Migration:** run backfill on a fixture DB with legacy data → assert zero nulls + each period correct.
- **Monkey (mandated by `.claude/rules/test.md`):**
  - `eventTime` at quarter boundary ±1ms, leap-day 2/29, year-end, negative/future time, garbage string → either correct attribution or `INVALID_EVENT_TIME`; **never** silent mis-period or null.
  - Concurrency: same period locked + ingested simultaneously (TOCTOU stress) → no event slips into a locked period.
  - Many distinct periods (e.g. 40 quarters) → scheduler sweep doesn't blow up; indexed queries don't degrade.

## 10. Code facts to confirm at plan time

Marked, not guessed — writing-plans/explore will pin these:
1. JE creation path and its FK/link field to the source event (drives "JE inherits period_id" wiring).
2. `POST /decide` target: does it hang off an event row or an exception row, and how does it currently obtain periodId (drives "derive period from target").
3. Exact ingest insert location and whether it already runs in a transaction (drives §5.2 atomic lock-check).

## 11. Future extension points (noted, not built)

- `periodOf` can later take an entity fiscal-config parameter for non-calendar fiscal years.
- A `periods` registry table if period lifecycle (soft-open/pre-create/close-schedule) is ever needed beyond lazy derivation.
- H2 will layer `supersedesSeq` version-chain semantics on top of the now-correct per-period snapshot JE set.
