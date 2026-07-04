# C2 — Period Attribution Design

**Date:** 2026-07-04
**Status:** Approved (brainstorming) → three-lens review integrated → pending implementation plan
**Backlog origin:** `reviews/architecture-review-4lens-2026-07-03.md:13` (C2, Critical); `tasks/notes.md:74`
**Depends on / unblocks:** H2 (snapshot persistence) builds on this; C4 (lot store) is independent.
**Review record:** three-lens review 2026-07-04 — sui-architect (READY-WITH-FIXES), CPA (SUFFICIENT-WITH-ADDITIONS), frontend-design (ADEQUATE-WITH-ADDITIONS). All accepted findings integrated below; §12 records the verdict.

## 1. Problem

The subledger is single-period by fiat. `DEFAULT_PERIOD = '2026-Q2'` is hardcoded at `services/api/src/http/routes.ts:70` and referenced by 12 call sites. `events` and `journal_entries` carry **no** `period_id`, and `collectExceptions()` scans `listEvents(db, entityId)` — the entity's **entire** history with no time filter. Consequently:

- No mechanism attributes a transaction to a period.
- No query scopes a period's ledger to *its own* transactions.
- Snapshots are built "per period" nominally, but since JEs have no `period_id`, a snapshot is really "all entity JEs labelled `2026-Q2`". The lie is invisible only because there is exactly one period.
- The **cutoff** accounting assertion — *defined* as "was the transaction recorded in the correct period" — is therefore vacuous.

**Scope of the claim (CPA C-M2):** period-slicing delivers **cutoff** (what is held is binned to the correct period). It does **not** deliver **completeness** (that every transaction which occurred was ingested) — that requires an expected-population / control-total / sequence-completeness control, which is out of scope (§2). This spec does not claim to fix completeness.

## 2. Scope

**In scope:** real per-transaction period attribution + multi-period slicing so that every period-level operation (lock, snapshot, exceptions, cutoff) sees only that period's transactions, plus the anchor/merkle invariants that keep this safe against the live on-chain anchor chain (§6).

**Out of scope (explicit, YAGNI):**
- Prior-period adjustment / restatement of *changed* anchored periods, and general snapshot version-chain semantics (`supersedesSeq`) — H2. This spec pins only the migration-time invariant (§6) that makes deferral safe.
- A `periods` registry table / period lifecycle CRUD (periods are derived, §5.1). Calendar quarters are contiguous and non-overlapping by construction, so a derived calendar has **no gap/overlap risk**; a mutable registry could introduce one (CPA C-S4) — this is a deliberate control reason to prefer derivation.
- Completeness controls (expected-population / control totals) — see §1.
- Opening-balance roll-forward between periods; per-period snapshots are **activity-only** (flows), not balance-sheet balances (CPA C-S2). Q(n) opening = Q(n-1) closing is not computed here.
- Cross-period revenue recognition (prepaids, deferred revenue, multi-period contracts) — attributed wholly by `eventTime`; rev-rec/accrual policy is out of scope (CPA C-S3).
- Per-entity configurable fiscal calendar and non-UTC cutoff timezone — fixed calendar-year UTC quarters here; `periodOf` left extensible (§11).
- Frontend multi-period UI implementation — this spec defines the backend contract and the future UI direction (§9), not the components.

## 3. Attribution rule

A transaction's period is derived **deterministically from its transaction date** (`eventTime`) via a fixed calendar-year quarterly fiscal calendar. This is the normative definition of the cutoff assertion. Attribution is pure code, never an LLM judgment (Rule 5).

### 3.1 `eventTime` — source and accounting semantics (CPA C-M1)

- `eventTime` is the event's existing timestamp field on the `events` table (confirm exact column at plan time, §10).
- **Accounting policy (stated limitation):** the cutoff date is the **chain-confirmation / event timestamp**, not a separately-asserted trade/invoice/value/settlement date. A Dec-31 economic event that confirms on-chain Jan-1 will book to Q1 under this policy. This is an accepted demo-grade limitation, not an oversight.
- **Extension point (§11):** a source may later declare an economic-event date that overrides chain time for attribution; `periodOf` and the ingest gate are designed to accept that input without schema change to the period model.

### 3.2 `periodOf`

```
periodOf(eventTime: string | Date): PeriodId   // 'YYYY-Q{1..4}'
```

- Quarter: `Q = floor(UTCmonth0 / 3) + 1`; id = `${UTCFullYear}-Q${Q}`.
- **Computed in UTC — this is an accounting policy choice, not display (CPA C-M5).** UTC is the *assumed cutoff timezone*. For a non-UTC entity, a boundary-day transaction (e.g. `2026-04-01T01:00Z` is Q1 in US-Pacific) can be mis-quartered by up to one day. This limitation is named here and routed to the fiscal-config extension point (§11), **not** treated as a mere display concern. UTC is pinned for determinism and reproducibility; jurisdiction-local cutoff is future work.
- Lives in `packages/rules-engine` (the existing shared boundary), imported by the API and every period consumer, so there is exactly **one** quarter implementation. Any second copy (e.g. a SQL expression in migration) is forbidden.
- Invalid / unparseable `eventTime` → rejected upstream as `INVALID_EVENT_TIME`; there is no "no period" event.

## 4. Schema changes (additive migration)

| Table | Change | Nullability |
|-------|--------|-------------|
| `events` (schema.sql:8-16) | add `period_id TEXT` | app-enforced non-null (see below) |
| `journal_entries` (17-24) | add `period_id TEXT`, inherited from source event | app-enforced non-null |
| `exception_disposition` (46-58) | add `period_id TEXT` | nullable (matches existing `recon_break_disposition`) |
| `exception_disposition_log` (59-71) | add `period_id TEXT` | nullable |

- Index `(entity_id, period_id)` on `events`, `journal_entries`, `exception_disposition`.
- No `periods` table (§2). `period_lock`, `snapshots`, `recon_break_disposition(+log)`, `triage_proposal` already carry `period_id` and are structurally unchanged.

**Why `NOT NULL` is app-enforced, not a DB constraint:** SQLite cannot add a `NOT NULL` column to a populated table without a full table-rebuild (create-new → copy → drop → rename). Rebuilding tables with append-only-log semantics is higher risk than the guarantee is worth. Instead: backfill to zero nulls, verify, and rely on the ingest path always writing `period_id` (§5.2). The schema comment states this is app-enforced (Rule 12 fail-loud — name the enforcement honestly rather than fake a DB constraint). `exception_disposition.period_id` stays nullable to conform to the existing recon disposition pattern (Rule 11).

## 5. Data flow: entity-scoped → period-scoped

### 5.1 Periods are derived, not created

- Existing periods for an entity = `SELECT DISTINCT period_id FROM events WHERE entity_id=?`.
- A period is OPEN iff `getPeriodLock(db, entityId, periodId)` returns no row or `status !== 'LOCKED'` (existing lazy pattern; "no row = OPEN").
- No period-creation step; the calendar function + the lazy `period_lock` row carry all per-period state.

### 5.2 Ingest gate (attribution + locked-reject, atomically)

On ingest of an event, before insert, within one transaction:
1. `pid = periodOf(event.eventTime)` (reject `INVALID_EVENT_TIME` if unparseable).
2. If `getPeriodLock(db, entityId, pid).status === 'LOCKED'` → **409 `PERIOD_LOCKED_FOR_DATE`**, and **record the rejection in an append-only rejected-events log** (never a silent drop — CPA C-M3). Do not insert into `events`.
3. Else set `events.period_id = pid` and insert.
4. Downstream classify→JE creation copies the source event's `period_id` onto the JE.

The lock check and the insert **must share one transaction** to close the TOCTOU window between computing the period and inserting (same class of race the round-1 triage agent's lock-sweep TOCTOU exposed).

**Legitimate period-end entries (CPA C-M3):** accruals, provisions, reclasses, top-side true-ups and late-arriving in-period source items are real and must not be lost. Policy: such adjusting entries into a locked period go through the **reopen → post → re-lock** flow (owned by the period-close cockpit), not the ingest path. The ingest gate's job is only to refuse mis-period drops silently; the rejected-events log is the audit record of what was refused and must be reviewable so a controller can decide to reopen. A dedicated suspense/holding lane is explicitly **not** built here (would expand scope); reopen is the sanctioned path.

### 5.3 Query layer (new period-scoped variants; existing signatures preserved)

- `listEvents(db, entityId)` → add `listEventsByPeriod(db, entityId, periodId)` (`WHERE entity_id=? AND period_id=?`). Keep `listEvents` for genuine full-history needs (e.g. audit lineage).
- `collectExceptions(db, entityId, ...)` → takes `periodId`, uses `listEventsByPeriod` internally. **This is the cutoff fix**: exception scanning stops seeing all history and sees only the period.
- `buildSnapshot` JE set → `WHERE entity_id=? AND period_id=?` (now genuinely per-period). **This changes the snapshot's merkleRoot for any multi-period entity — see §6, the safety-critical section.**

### 5.4 Route layer (periodId: implicit constant → explicit parameter)

| Route | Current | New |
|-------|---------|-----|
| `GET /cockpit` | `DEFAULT_PERIOD` | query param `?periodId=` **required**, else 400 `PERIOD_ID_REQUIRED` |
| `GET /entities/{id}/periods` | — (new) | list periods + lock status (§5.5) |
| `POST /decide` | `DEFAULT_PERIOD` | derived from target event/exception's own `period_id` (**not** caller-supplied) |
| `POST /period/lock` | body `?? DEFAULT_PERIOD` | body `periodId` **required**, else 400 `PERIOD_ID_REQUIRED` |
| `POST /run` (triage) | pinned `DEFAULT_PERIOD` | sweeps all OPEN periods (§5.1); **off-chain only, no anchor write** (§6.5) |
| `startTriageScheduler` | pinned `DEFAULT_PERIOD` | per entity, per OPEN period |

`POST /decide` intentionally does **not** accept a caller-supplied periodId (the target's period is already fact; caller supply = mis-period hole). `GET /cockpit` intentionally has **no default** (a default silently shows the wrong period under multi-period; fail-loud beats guessing). `DEFAULT_PERIOD` is removed once all 12 call sites are converted.

### 5.5 `GET /entities/{id}/periods` (frontend blocker fix — FE-a1)

With `?periodId=` now required and no server default, the frontend must be able to enumerate valid periods. New endpoint returns, for the entity:
```
[{ periodId: 'YYYY-Q{n}', lockStatus: 'OPEN' | 'LOCKED' }, ...]   // ordered ascending
```
- `periodId` list = `SELECT DISTINCT period_id FROM events WHERE entity_id=?` (§5.1).
- `lockStatus` per row from the lazy `period_lock` lookup (§5.1) — the UI needs it to render open vs locked distinctly.
- **Ordered** so the client can pick a deterministic landing period (`max(periodId)` = latest) without inventing its own rule (FE-a4).

## 6. Anchor & merkle invariants (safety-critical)

**Root cause the naive scope-cut missed (sui-architect):** the snapshot `merkleRoot` is a pure function of the JE set. Changing JE selection (§5.3) silently redefines the root that may already be committed on chain. The Move contract stores `latest_link`/`seq` blindly (`move/audit_anchor/sources/audit_anchor.move:166-192`) and will **not** reject a changed root — it fails as an *unverifiable* anchor, not a rejected tx. Therefore:

### 6.1 `period_id` MUST be excluded from the merkle leaf preimage (B1)

- Leaf = `SHA256(0x00 || encodeJeLeaf(je))` (`services/rules-engine/src/core/merkle.ts:34`). Adding `journal_entries.period_id` (§4) MUST NOT enter `encodeJeLeaf`; `leafCodecVersion` MUST stay unchanged.
- If it entered the preimage, **every existing anchored root would change even for a single-period entity**, making on-chain anchors non-reproducible.
- **Plan-time verification (§10):** confirm `period_id` is not in the preimage. If it is, this spec is wrong and must be revised to mandate a `leafCodecVersion` bump + full re-anchor.

### 6.2 Migration precondition P1 — no anchored period's JE set may change (B2, M4)

- For every entity with an on-chain anchor, migration MUST assert that after backfill each anchored period's re-derived snapshot root equals its committed on-chain root. For today's demo (single period `2026-Q2`, all JEs map to Q2) this holds trivially: the sliced set == the all-history set.
- If any anchored period's set would change, migration **aborts fail-loud**. Restating changed anchored periods (reopen → re-anchor via `supersedes_seq`) is H2.
- The cross-quarter demo seed (§7) is applied **before** any multi-period anchoring, so no anchored period is ever retroactively re-sliced.

### 6.3 Deferring `supersedesSeq` is safe *because* of P1 (I1)

- §2 defers version-chain semantics to H2. This is a clean cut only because P1 guarantees no anchored period's set changes at migration → no restatement is forced now. The general "changed anchored period ⇒ restatement (`supersedesSeq` = prior seq)" rule stays in H2. We resolve the intermediate-state hazard by *strengthening the precondition*, not by importing H2 work.

### 6.4 period → anchor-seq mapping (I2)

- The contract keeps ONE global monotonic `seq` chain per entity; `period_id` is informational on-chain (`last_period`). Periods interleave in one `seq`.
- "Which on-chain `seq` is authoritative for period P" is off-chain state, derived from `snapshots` rows joined to anchor confirmations — **no new storage**. Verification and future restatement both need it; the spec names the derivation, implementation deferred with H2's version chain.

### 6.5 Serial anchoring / off-chain sweep (I3)

- `POST /run` and the scheduler sweep (§5.4) operate on triage/exceptions **off-chain only — they do not anchor.** The 40-quarter monkey case (§9) is off-chain query load, not on-chain writes.
- Anchoring N periods is inherently serial: each anchor writes the single shared `EntityAnchorChain` guarded by `assert prev_link == latest_link` (`audit_anchor.move:166`). Serial anchoring is **explicitly accepted**; a stale sweep round cannot double-anchor because the `prev_link` echo self-guards.

### 6.6 lock ↔ anchor ordering (Minor M1)

- §5.2's atomic lock-check+insert is an off-chain DB transaction; the on-chain anchor is a separate trust boundary. A period may be locked off-chain with its anchor not yet on chain. The sanctioned order is **lock (off-chain) → snapshot → anchor (on-chain)**; a locked-but-unanchored period is a valid intermediate state.

## 7. Migration & backfill

One migration step, order matters:
1. `ALTER TABLE events ADD COLUMN period_id TEXT` (nullable — SQLite limitation, §4).
2. Backfill in **app-layer JS** using the same `periodOf` (no second quarter algorithm): `UPDATE ... SET period_id = periodOf(eventTime)` per event.
3. `journal_entries.period_id` ← source event's `period_id` via the JE→event linkage.
4. `exception_disposition(+log).period_id` ← corresponding event's period (best-effort, nullable).
5. Create `(entity_id, period_id)` indexes.
6. **Verification gate:** assert `events` has zero `period_id IS NULL`; residual → abort fail-loud.
7. **Precondition P1 gate (§6.2):** assert no anchored period's re-derived root changes; else abort.
8. **Audit record (CPA M4):** emit a migration record — timestamp, `periodOf`/`leafCodecVersion` version, row counts per table, and an explicit affirmation that no anchored leaf/root changed. Pre-C2 anchored snapshots retain their original all-history semantics and MUST NOT be reinterpreted as period-scoped.

## 8. Error handling / invariants

All error bodies conform to the existing client envelope `{ error: { code, message, details? } }` (`web/src/.../client.ts:7-41` only parses this shape — FE-a2/a3):

| Situation | Behavior | Envelope |
|-----------|----------|----------|
| ingest event lands in LOCKED period | 409, logged (not dropped), no insert | `{error:{code:'PERIOD_LOCKED_FOR_DATE', message, details:{periodId, eventTime}}}` |
| event missing / unparseable `eventTime` | ingest rejected | `{error:{code:'INVALID_EVENT_TIME', message, details:{field, value}}}` (names offending field) |
| `GET /cockpit` without `periodId` | 400 | `{error:{code:'PERIOD_ID_REQUIRED', message}}` |
| `POST /period/lock` without `periodId` | 400 | `{error:{code:'PERIOD_ID_REQUIRED', message}}` |
| backfill leaves any `period_id IS NULL` | migration abort | — |
| anchored period's root would change (P1) | migration abort | — |
| lock acquired between period computation and insert (TOCTOU) | lock-check + insert in one transaction | — |

## 9. Frontend contract impact & future UI direction (planning only; implementation out of scope)

**Contract (baked into this backend spec):** §5.5 periods endpoint; §8 error envelopes with `details`. These close the FE blocker.

**Future multi-period UI direction (for the frontend spec, not built here):**
- **Selector = promote the existing read-only `PeriodPill` (`TopBar.tsx:40`)** into an interactive popover built from existing `Button`+`Card` primitives. No native `<select>` (that is the `.btn-primary`→native-button regression path). Keep `--font-mono` + `--radius-pill` for ids.
- **Locked vs open — reuse the house pattern:** locked = navy `--ink` fill + cream text (`close.css .period-ribbon--locked`) + lock glyph; open = `--paper` surface + `--credit`-tinted "OPEN" marker (Badge tint convention: `color-mix(…, 30%, transparent)` border, `--text-xs`, `--radius-sm`). Reserve `--warn` for stale/attention, never for locked itself.
- **Prevent cross-period misreads:** persistent period-ribbon header showing the active id in `--font-display`; on period switch, dim/skeleton tiles until refetch resolves so stale prior-period numbers never read as current; echo the id in verdict copy ("Q2 ready to lock").
- **Aesthetic traps:** never `--aqua` (blockchain-reserved) or `--brass` (primary action) for period badges — locked=navy, open=credit-tint, warn=`--warn`. Size pill/rows with `max-content` + monospace, never a hardcoded px `min-width` (ConfidenceBar 390-overflow lesson). No global toast exists — render the `PERIOD_LOCKED_FOR_DATE` 409 inline beside the triggering control using `details.periodId`/`eventTime`.

## 10. Code facts to confirm at plan time

Marked, not guessed — writing-plans/explore will pin these:
1. JE creation path and its FK/link field to the source event (drives "JE inherits period_id").
2. `POST /decide` target: hangs off an event row or an exception row, and how it currently obtains periodId (drives "derive period from target").
3. Exact ingest insert location and whether it already runs in a transaction (drives §5.2 atomic lock-check).
4. **`period_id` is NOT in `encodeJeLeaf` preimage / `leafCodecVersion` unchanged (§6.1)** — safety-critical.
5. Exact `events.eventTime` column name/type and format (drives §3.1, backfill).

## 11. Future extension points (noted, not built)

- `periodOf` takes an entity fiscal-config parameter for non-calendar fiscal years **and non-UTC cutoff timezone** (§3.2 limitation).
- A source-declared economic-event date overriding chain time for attribution (§3.1).
- Opening-balance roll-forward between periods (§2 / CPA C-S2).
- Cross-period revenue recognition (§2 / CPA C-S3).
- A `periods` registry table if period lifecycle beyond lazy derivation is ever needed.
- H2: `supersedesSeq` version-chain semantics + reopen→re-anchor restatement of changed anchored periods (§6.3), layered on the now-correct per-period snapshot JE set.

## 12. Review verdicts (three-lens, 2026-07-04)

- **sui-architect — READY-WITH-FIXES** (B1, B2 blockers; I1–I3 important; M1–M2 minor). All integrated: §6 (new safety-critical section) + §10.4. Object model / upgradeability confirmed clean (no Move change).
- **CPA — SUFFICIENT-WITH-ADDITIONS** (M1–M5 must; S1–S4 suggest). All integrated: §1 (completeness declaim), §3.1/§3.2 (eventTime semantics, UTC policy), §5.2 (reject-log + reopen for adjusting entries), §7.8 (backfill audit), §2 (opening-balance/rev-rec/no-gap out-of-scope). SoD escalation (S1): C2 gives lock data-dropping teeth → the period-close cockpit's deferred SoD gap (`2026-06-24-period-close-cockpit-design.md §9`) is re-rated upward; cross-referenced, remediation owned there.
- **frontend-design — ADEQUATE-WITH-ADDITIONS** (list-periods blocker; error-envelope + init-period additions; UI direction). All integrated: §5.5, §8, §9.

## 13. SoD cross-reference (CPA C-S1)

Under C2, an erroneous or unauthorized period lock **rejects incoming transactions** (data-affecting), not merely freezes a UI. This raises the severity of the period-close cockpit's known single-control lock with no enforced separation-of-duties (`docs/superpowers/specs/2026-06-24-period-close-cockpit-design.md §9`, C3/I5). Remediation (maker-checker on lock/reopen) is owned by that cockpit spec; C2 flags the escalation and depends on it for production, but does not implement SoD here.
