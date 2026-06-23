# Exception Queue — Design Spec

**Date**: 2026-06-23
**Phase**: Phase 1 — A workspace, sub-project 1 of 3 (Exception Queue 例外分流台)
**Status**: plan-ready (pending user spec review)
**Umbrella**: `2026-06-23-workspace-shell-design.md` (Appendix A)
**Scope decision**: Original 3-category design + disposition state machine + **close gate**. All `frontend-design` and `sui-architect` review findings folded in. Accountant Critical findings beyond close gate are **deferred and fully recorded** in §9.

---

## 1. Purpose

`exceptions` workspace: a standalone triage surface that aggregates the entity's
pending accounting exceptions, lets a human drill into each, and disposition it —
*without* the linear gating of the close flow's Review step. It fills the `soon`
slot in the Workspace Shell (`workspaces.ts` → flip `exceptions` status to `ready`).

It is **not** a new posting path. The single accounting-posting guardrail
(AI zero posting authority; JE written only by human `decide` → `run-rules`) is
preserved unchanged.

---

## 2. Exception model (read-real, recomputed-on-read, no persistence)

`services/api/src/exceptions/collect.ts` exports a **pure read-aggregator**:

```ts
export function collectExceptions(db: Db, entityId: string): Exception[]
```

It projects current `events` into typed exceptions. **No exceptions table** — the
single source of truth stays in `events` + the rules engine. (sui-architect F2: a
persisted exceptions table would duplicate truth and rot; recompute-on-read keeps
zero derived-state drift.)

### 2.1 Categories (this scope: 3)

| category | source | reason payload |
|---|---|---|
| `CLASSIFY_REVIEW` | `status = NEEDS_REVIEW` | AI routed to human review (low classify confidence) |
| `LOW_CONFIDENCE_AUTO` | `status = AUTO` **and** `aiConfidence < threshold` | auto-classified but near the confidence floor |
| `RULES_FAILED` | event with `status ∈ {APPROVED, AUTO}` **and not POSTED** that, when run through `evaluate()`, yields `decision ≠ POSTABLE` **or** `journalEntries.length === 0` | carries the `RuleOutput` skip reason |

- `threshold` is a config value (`cfg.exceptionLowConfidence`, default e.g. `0.75`);
  surfaced so it is tunable, not magic.
- **RULES_FAILED scoping (sui-architect F2a — Important)**: only **non-POSTED**
  events. A POSTED event already produced a JE under whatever logic was live then;
  re-running `evaluate()` against current logic could falsely flag it as "broken"
  while the ledger says "done". POSTED events never surface as RULES_FAILED.
- **`evaluate()` purity (sui-architect F2b)**: `collectExceptions` calls the *same*
  pure `evaluate()` that `run-rules` calls, importing it — never re-implementing
  skip logic (single source for skip-reason strings). The call is read-only: a
  `GET` must never mutate state. Asserted by test.

### 2.2 Exception identity (sui-architect F3)

`exceptionId = ${category}:${eventId}` (derived, stable across recomputation).

- One event MAY occupy two categories at once (e.g. an AUTO event that is both
  `LOW_CONFIDENCE_AUTO` and, on re-eval, `RULES_FAILED`). The composite key keeps
  them distinct.
- **Disposition table PK = `(category, eventId)`** — never `eventId` alone, or
  dispositions cross-wire between two real exceptions on the same event.

### 2.3 Severity & ordering

`RULES_FAILED` (blocks close) > `CLASSIFY_REVIEW` > `LOW_CONFIDENCE_AUTO`.
Within a category, lower `aiConfidence` first.

> **Materiality note (accountant F6 — deferred, see §9)**: ordering is
> confidence-only in this scope. Amount-materiality ordering/escalation is recorded
> as deferred. `collectExceptions` SHOULD surface the event amount (if present in
> the normalized payload) in the DTO so the UI can show it and a future change can
> sort by it without a backend reshape.

---

## 3. Disposition (write-mock, audit overlay, never touches JE)

### 3.1 Invariant (sui-architect F1 — Important)

`exception_disposition` is **observational triage metadata**. It is:
- **never** an input to a journal entry (the structural guardrail holds: the
  disposition module imports nothing from `journalStore`);
- **never** an input to the snapshot manifest hash or merkle root, i.e. **excluded
  from anchoring**. Disposition stays mutable off-chain; folding it into the
  anchored hash chain would both bloat on-chain footprint and wrongly make a triage
  note immutable-by-anchor. *(Stated explicitly so no future dev "naturally" folds
  it in.)*

### 3.2 State machine

States: `open` (implicit — no disposition row) → `resolved` | `dismissed` | `deferred`.

Legal transitions (fail-closed transition table; illegal → `409 ILLEGAL_TRANSITION`):

```
open      → resolved | dismissed | deferred
deferred  → open | resolved | dismissed
dismissed → (terminal)
resolved  → (terminal)
```

- `open` is the absence of a row (or an explicit `open` after un-defer). The first
  disposition inserts a row; transitions update it + append to an audit log.
- `resolved` / `dismissed` are terminal — re-opening a terminal disposition to
  re-edit the audit trail is rejected (audit integrity).

### 3.3 Table

```sql
CREATE TABLE IF NOT EXISTS exception_disposition (
  category    TEXT NOT NULL,
  event_id    TEXT NOT NULL REFERENCES events(id),
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  state       TEXT NOT NULL,         -- resolved | dismissed | deferred | open
  reason_code TEXT NOT NULL,         -- enum, see §3.4
  reason_note TEXT,                  -- optional free text
  decided_by  TEXT NOT NULL,         -- mock actor (see §3.5)
  decided_at  INTEGER NOT NULL,      -- ms epoch
  PRIMARY KEY (category, event_id)
);
```

Plus an **append-only** `exception_disposition_log` (same columns + autoincrement
`seq`) so every transition is retained, not overwritten (audit trail; partial nod
to accountant F4 — reason codes + append-only history are in-scope, *anchoring* the
log is deferred).

### 3.4 Reason codes (accountant F4 — reason enum is in-scope)

Enum, not free text (free text can't be queried/analysed for control testing):
`MAPPING_ADDED`, `RECLASSIFIED`, `DUPLICATE_CONFIRMED`, `IMMATERIAL_WAIVED`,
`PENDING_DOC`, `CARRIED_FORWARD`, `OTHER` (+ optional `reason_note`).
`reason_code` required for **all** transitions; `reason_note` required when code = `OTHER`.

### 3.5 Actor (mock)

There is no auth/user system yet. `decided_by` is a **mock actor** sent by the
client (e.g. `"demo-controller"`) or defaulted server-side. The real SoD control
(`disposedBy ≠ event.decidedBy`, four-eyes) is **deferred** (§9, accountant F3) —
but the field is captured now so the future control is a check, not a schema change.

---

## 4. Close gate (accountant F5 — Critical, IN SCOPE)

Open blocking exceptions **hard-block the period freeze**.

- **Enforcement point**: `POST /entities/:id/snapshot` (freeze). Before freezing,
  call `collectExceptions(db, entityId)`; if any exception of a **blocking category**
  (`RULES_FAILED`, `CLASSIFY_REVIEW`) is in state `open` → `409 EXCEPTIONS_BLOCKING`
  with the blocking count + ids. `LOW_CONFIDENCE_AUTO` is non-blocking (advisory).
- **Escape hatch = the state machine**: `deferred` / `dismissed` / `resolved`
  exceptions do **not** block. To close with a known exception you must explicitly
  dispose it (leaving an audit trail) — exactly the governance intent.
- **Scoping limitation (documented)**: events have no `period_id` column, so the
  gate is **entity-scoped**, not per-period. Per-period exception attribution is
  deferred (ties to accountant cut-off finding, §9). For the demo's single active
  period this is equivalent.
- **Anchored-period read-only (sui-architect F4 — Critical)**: once a period's
  snapshot is `ANCHORED`, its events' exceptions are **read-only / informational**.
  The UI must not present an "open / actionable" affordance over data whose merkle
  root is committed on-chain. Disposition on an anchored-period event is allowed
  only as a `dismissed` / `deferred` audit annotation, never as a state implying the
  books will change. (Because events lack period attribution, the practical rule:
  if the entity's latest period is ANCHORED, the Exception detail pane renders
  dispositions read-only with an "anchored — informational" banner.)

`run-rules` / `decide` / `copilot` / `anchor` endpoints are **unchanged**.

---

## 5. API

| method | path | behavior |
|---|---|---|
| `GET` | `/entities/:id/exceptions` | `{ exceptions: ExceptionDTO[], summary: { open, blocking, byCategory } }` — recomputed live |
| `POST` | `/exceptions/:exceptionId/disposition` | body `{ state, reasonCode, reasonNote?, decidedBy? }`; validates exceptionId resolves to a *current real* exception, runs the transition table, writes row + log; `409` on illegal transition / unknown id |
| `GET` | `/entities/:id/close-readiness` | `{ blocking: n, blockers: ExceptionDTO[] }` — read model the close UI can poll without attempting a freeze |

`ExceptionDTO`: `{ exceptionId, category, severity, eventId, reason, amount?, ai, disposition: { state, reasonCode, decidedBy, decidedAt } | null, anchoredReadOnly: boolean }`.

`exceptionId` in the path is `category:eventId` (URL-encoded `:`); the handler
splits and re-validates against `collectExceptions` (rejects forged / stale ids).

---

## 6. Frontend (master-detail, all frontend-design findings folded in)

`exceptions` workspace = master-detail. Reuse `ConfidenceBar`, `CopilotDock`,
`DecideForm`, `EmptyState`.

### 6.1 Left — ExceptionList (triage worklist, not a generic inbox)

- **Severity as spatial weight** (FD-F1): blocking rows get a brass left accent bar
  + taller row + grouped under a quiet section label `BLOCKS CLOSE · N`. Don't rely
  on sort alone. Section labels in restrained nautical voice:
  `BLOCKS CLOSE` / `HOLD` / `CLEARED`.
- **Drain feel**: persistent count header `12 open · 4 blocking close` that ticks
  down on disposition; a brief row-collapse animation on resolve.
- **Filter chips**: category (all / classify / low-conf / rules-failed) + state
  (open / deferred / resolved). On narrow widths → horizontal scroll-strip (reuse
  SideNav pattern).
- **Two-axis visual encoding (FD-F3 — Critical, a11y)**: never collapse
  category+severity into one color.
  - **category → icon + text label** (shape-coded, color-independent):
    rules-failed = broken-link/anchor-snap glyph; classify = fork/branch glyph;
    low-confidence = dashed/partial ConfidenceBar glyph. Never icon-only.
  - **severity → position + weight + one restrained accent**: blocks-close = brass
    accent + bold; classify = navy outline badge; low-conf = ink-soft muted.
  - **one rare alarm hue** (desaturated rust/oxblood in the navy-brass family,
    *not* generic red) reserved for "blocks close + aged". If everything can turn
    red nothing is urgent.
  - **urgency without color**: a mono age-stamp (`open 2d`) — colorblind-safe,
    reads like a ship's log.

### 6.2 Right — ExceptionDetail (facts → machine opinion → assistant → decision)

Order: normalized payload → `ConfidenceBar` + AI reasoning → `CopilotDock` →
disposition controls. Sharpen the seam (FD-F4):

- **DATA ZONE** (payload + DecideForm): `--paper-card` + `--paper-line`, mono, zero
  mascot, "feels like a ledger" (mascot §8.4 — no mascot in data zone).
- **Suggestion zone** (ConfidenceBar + reasoning + CopilotDock): cream-shifted band
  with a divider hairline — different surface "temperature" so the user feels
  "record vs advice".
- **Disposition controls sticky to the bottom** of the right column (always reachable
  on long payloads; triage is a per-item commit).

### 6.3 Disposition controls (FD-F5 — Critical, audit hinge)

- **Segmented action group, not a `<select>`** — show only *valid* transitions for
  the current state; the state machine is legible from the buttons.
- **Asymmetric weight by consequence**: Resolve = brass `.btn-primary` (happy path);
  Defer = quiet ghost/outline; **Dismiss = ceremony** — ghost until clicked, then
  *inline-expands* (NOT a modal — keeps flow + attaches the reason to the record) into
  a confirm panel requiring `reasonCode` (mandatory) + explicit "Dismiss this
  exception", showing `will record: <actor> · <date>` so permanence is felt.
- Reason friction asymmetry *is* the governance signal: defer reason
  optional-with-prompt, dismiss reason required.
- **Anchored-period** (sui-architect F4): controls render read-only with an
  "anchored — informational" banner.

### 6.4 Empty state — the signature moment (FD-F2, named deliverable)

"Queue clear before close" is the workspace's emotional payoff and the one
place mascot §8.4 goes maximal: otter at the helm, cream background, brass
"Period ready to close →" CTA, copy `Clear seas · 0 exceptions blocking close`.
Celebratory `EmptyState` variant: a single staggered reveal (restraint — no particle
spam). Suggestion/celebration zone, so mascot is correct here.

### 6.5 RWD (FD-F6)

Below ~768px → single-pane stack-push: list is root; tapping a row pushes detail
full-screen with a back affordance `‹ Queue · N left` (keeps drain-count). Do not
keep both panes squished. Disposition bar stays sticky-bottom (thumb reach).

### 6.6 Character without generic-dashboard drift (FD-F6)

Character lives in typography + restraint + the one signature empty state — not
chrome. Section labels in a ship's-log voice, mono age-stamps, brass reserved for
"needs your hand". Avoid: rope borders, wave dividers, mascot in data zone, textured
list background. Avoid the opposite failure (flat gray list) by committing to the
severity-weighting hierarchy (§6.1).

---

## 7. Guardrail & Red Team (write endpoint touching financial workflow)

Core guarantee: **disposition is a triage/audit overlay, never writes a JE.** AI
zero posting authority unchanged; posting only via `decide → run-rules`.

| # | attack vector | defense |
|---|---|---|
| 1 | use disposition to bypass review and post a JE | disposition module imports nothing from `journalStore`; **import-scan test** (mirrors existing guardrail test) |
| 2 | illegal state transition (resolved→open to rewrite audit) | fail-closed transition table; `409` |
| 3 | forged / arbitrary `exceptionId` | handler re-validates id against live `collectExceptions`; unknown → `404` |
| 4 | stale exception (event already POSTED / re-classified) dispositioned | exceptions recomputed live; POSTED drops out (§2.1); disposition handler re-checks current existence |
| 5 | mass-dismiss to fake a clean close | `reasonCode` + `decided_by` required + append-only log; `dismissed` ≠ `resolved`; close gate distinguishes states (§4) |
| 6 | dispose on an anchored period to imply the books changed | anchored-period dispositions are read-only / annotation-only (§4, §6.3) |

---

## 8. Tests (Rule 9 + test.md)

Intent-encoding, not just "what renders":

- `collectExceptions`: 3 categories classified correctly; severity ordering; POSTED
  events excluded from RULES_FAILED; `evaluate()` called read-only (no state change
  after a GET); same skip-reason as `run-rules` (single source).
- Disposition state machine: every legal transition; every illegal transition
  fail-closed; terminal states reject re-open; composite-key isolation (two
  categories, same event, independent dispositions).
- Close gate: `open` blocking exception → freeze `409 EXCEPTIONS_BLOCKING`;
  `deferred`/`dismissed`/`resolved` → freeze proceeds; `LOW_CONFIDENCE_AUTO` open →
  does NOT block.
- Guardrail import-scan: disposition module has no `journalStore` import path.
- Anchored-period: dispositions render/enforce read-only.
- **Monkey** (test.md): forged exceptionId, stale/POSTED event, empty queue, extreme
  reason_note length, rapid consecutive dispositions, two-category same-event race.
- **Regression**: existing web + api tests stay green; the close flow's happy path
  stays green (freeze only blocks when genuine open blocking exceptions exist).

---

## 9. Deferred — full accountant findings recorded for future work

User decision: implement scope = original 3 categories + disposition + close gate.
The following accountant findings are **deferred but fully recorded** so they are
not lost (to be picked up in a later sub-project / hardening pass):

### 9.1 Additional exception categories (accountant F1 — Critical, deferred)
Current 3 categories cover only the "what should this be classified as" axis.
Production close is blocked by **data-completeness & period-attribution** exceptions:
- **DUPLICATE** — same on-chain tx re-ingested (event replay / indexer resend) →
  double-posting. AI confidence is *high* so it would route AUTO and never surface.
  **Must be deterministic dedup at the ingestion layer**: unique key =
  `tx digest + event index`. Not AI-driven.
- **UNMATCHED_COUNTERPARTY** — orphan transfer (out with no in; refund with no
  original).
- **PERIOD_CUTOFF** — timestamp near a period boundary; ambiguous period
  attribution (block time vs accounting period). *Requires events to carry period
  attribution — events table currently has no `period_id`.*
- **FX_RATE_MISSING** — foreign-currency event with no rate for the period/date;
  cannot translate to functional currency.
> Audit rationale: these map to the completeness / accuracy / cut-off assertions —
> detective controls. Without them, the merkle anchor commits "an internally
> consistent but possibly under-/double-/mis-period'd ledger."

### 9.2 dismissed/deferred governance (accountant F2 — Critical, deferred)
- `dismissed` is a hidden-under-reporting backdoor if a single person can dismiss a
  RULES_FAILED (out-of-balance) item and close looks clean → needs independent
  review for dismiss of material/out-of-balance items, or hard-prohibit.
- `deferred` needs `deferredToPeriod` + aging + a carry-forward queue into the next
  period + auto-escalation after N periods. (Currently `deferred` just unblocks
  close with no follow-through.)

### 9.3 Segregation of duties (accountant F3 — Critical, deferred)
Enforce `disposedBy ≠ event.decidedBy` (at least for `dismissed` / material items);
four-eyes `reviewedBy` second sign-off for material resolved/dismissed; record
maker/checker identities. **Blocked on a real user/identity system** (currently
`decided_by` is a mock actor). Field captured now so the future control is a check,
not a migration.

### 9.4 Audit-trail anchoring (accountant F4 — Important, deferred)
Anchor the exception-disposition log's merkle root alongside the JE snapshot at
close, so the "human judgment intervening in the books" trail is tamper-evident on
chain. (Reason-code enum + append-only log are *in scope*; on-chain anchoring of the
log is deferred — and note it conflicts with sui-architect F1's "disposition
excluded from anchor": a future design must anchor a *separate* disposition-log root,
not fold disposition into the JE snapshot.)

### 9.5 Materiality-driven ordering & escalation (accountant F6 — Important, deferred)
Sort/escalate by amount materiality (absolute threshold + relative to account/period),
not confidence alone (a $5M high-confidence misclassification must not sink to the
bottom). Auto-escalate over threshold; force second sign-off; block single-person
dismiss. By-amount and by-confidence dual views. (DTO surfaces `amount` now so this
is a UI+sort change later, not a backend reshape.)

---

## 10. Component / file manifest

| file | action |
|---|---|
| `services/api/src/exceptions/collect.ts` | new — `collectExceptions` pure aggregator |
| `services/api/src/exceptions/disposition.ts` | new — state machine + table writes (no journalStore import) |
| `services/api/src/store/schema.sql` | add `exception_disposition` + `exception_disposition_log` |
| `services/api/src/http/routes.ts` | add 3 endpoints; add close gate to `/snapshot` |
| `services/api/src/config.ts` | add `exceptionLowConfidence` threshold |
| `web/src/app/workspaces.ts` | flip `exceptions` status `soon` → `ready` |
| `web/src/workspaces/ExceptionsWorkspace.tsx` | new — master-detail shell |
| `web/src/components/data/ExceptionList.tsx` | new — left worklist (severity-weighted) |
| `web/src/components/data/ExceptionDetail.tsx` | new — right detail + disposition |
| `web/src/components/data/DispositionControls.tsx` | new — segmented state machine + dismiss ceremony |
| `web/src/components/data/EmptyState.tsx` | extend — celebratory "clear seas" variant |
| `web/src/api/hooks.ts` / `types.ts` | add exceptions + disposition hooks/types |

mascot governance §8.4, tokens, `.btn-primary` pill, wallet z-index — unchanged.
