# Period Close Cockpit (Phase 2 B1) — Design

**Date:** 2026-06-24
**Scope:** Phase 2 = **B1 only**. B2 (Audit lineage → Sui digest) deferred — thin net-new surface, backend-blocked (§11). Upgrades the existing `close` workspace.
**Backend strategy:** read paths compute real signals; demo-hard writes (period lock / reopen) are a mock state machine layered on the existing **real** on-chain anchor flow.
**Reviews integrated:** SUI-architect (READY-WITH-FIXES), senior-accountant, frontend-design. Findings folded below; adjudication notes in §10.

---

## 1. Goal & narrative

Today `close` is a **linear 5-step flow** (ingest → classify → review → journal → anchor). B1 upgrades it into an **enterprise period-close cockpit**: a readiness-light dashboard gating an explicit **Lock** (accounting close), with the existing on-chain **Anchor** layered on top as tamper-evidence, and a **Reopen** path for restatements.

Two layered concepts (an ERP user expects both):
- **Lock** = accounting "close the books" — a mock soft-lock state. Freezes exception/recon dispositions for the period.
- **Anchor** = blockchain tamper-evidence — the **existing real** freeze→snapshot→wallet-sign→on-chain flow, now gated to require LOCKED first.

The 5 steps are **not deleted** — they become actions reachable by clicking a non-green light.

## 2. Period state machine (net-new, mock)

```
OPEN ──(blocking lights all green)──> LOCKED ──(anchor: real on-chain)──> LOCKED (+anchored flag)
  ^                                      │                                       │
  └── REOPEN (restatement reason+code + maker→checker SoD ritual) ───────────────┘
```

States: `OPEN` | `LOCKED`. (`anchored` is a derived flag, **per-period**, from that period's snapshot row — see §4 I-fix.)

**Transition allowlist (fail-closed — anything not listed → 409 `ILLEGAL_TRANSITION`):**

| from   | action | to     | guard |
|--------|--------|--------|-------|
| OPEN   | lock   | LOCKED | backend **recomputes** lights; all *blocking* lights green |
| LOCKED | anchor | LOCKED | existing freeze/anchor gate **+** requires status=LOCKED |
| LOCKED | reopen | OPEN   | `restatementReason` non-empty + `reasonCode` + two-step confirm; `reopenCount++` |

`anchor` sets the anchored flag, does not change OPEN/LOCKED. Lock must precede anchor.

**Re-anchor after reopen is NOT a one-click flow.** Reopen → status OPEN → fix data → **re-Lock** (status LOCKED) → re-anchor. The `/snapshot` LOCKED-gate (§4) enforces the re-lock step. See §10-A1 for why restatement *versioning* (supersedes) is descoped in B1.

## 3. The readiness lights

Six lights. **Render order is severity-sorted, not this declaration order** (§5 C2).

| Light | Source | Real? | Status values |
|-------|--------|-------|---------------|
| **classification** | review-queue pending count + `close-readiness.exceptions.blocking` | real | green / red |
| **JE** | every JE balanced (debit=credit) **AND** entity period **trial balance nets to zero** (Σdebits=Σcredits) **AND** run-rules executed for all decided events | real | green / red |
| **recon** | `close-readiness.recon.blocking` | real | green / red |
| **completeness** | events ≠ ∅ AND no pending ingest. **Labeled "ingest presence — no cutoff assurance"** (no expected-source registry, no `period_id` cutoff) | derived | green / red / derived |
| **pricing** | no real pricing-coverage signal (price lives inside run-rules `priceRef`, unsurfaced) | mock | `{status:'mock'}` |
| **export** | Phase 3 C not built | mock | `{status:'mock'}` |

**Honesty rule (project spine):** real lights compute real; derived lights labeled `derived`; mock lights labeled mock and **never render fake-green / never use `--aqua`** (aqua reserved for on-chain). `closeable` = all *blocking* lights green. **Blocking = real + derived** (classification/JE/recon/completeness). Mock lights (pricing/export) carry no signal so they do **not** block — but their mock status is shown so no control is mistaken for passed. **In production this inverts**: pricing/export become real-and-blocking (§9).

The JE light deliberately bundles per-JE balance + aggregate trial-balance tie-out (accountant C2: individual balance ≠ TB balance). "All JEs *posted/approved*" is **not** separately gated — see §9 (posting-state not modeled; blocking-for-production).

## 4. Backend components

New: `services/api/src/periodLock/`
- `state.ts` — transition allowlist + `transition(from, action, guards)` pure fn, fail-closed.
- `store.ts` — `period_lock` table. PK `(entityId, periodId)`. Columns:
  - `status` (`OPEN`|`LOCKED`), `lockedAt`, `lockedBy` (server-const), `lightsSnapshot` (JSON — the lights **as evaluated at lock time**, immutable lock evidence; accountant I3),
  - `reopenedAt`, `reopenCount`, `restatementReason`, `reasonCode` (enum), `affectedAmountEstimate` (nullable), `wasAnchoredAtReopen` (bool snapshot), `requestedBy`/`approvedBy` (server-const).
  - All writes inside a transaction with status **compare-and-set** on `from`-state (race loser → ILLEGAL_TRANSITION).
- `cockpit.ts` — light aggregation (recompute-on-read; reuses `close-readiness`, `/journal` balance + TB sum, review-queue).

New endpoints (`http/routes.ts`):
- `GET /entities/:id/close-cockpit?periodId=` → `{ lights:{...6}, status, anchored, reopenCount, restatementReason, reasonCode, staleAnchor }`. Recompute-on-read; trusts no client input. **`anchored` gated on the specific period's snapshot row** (`getSnapshot(snap-id).status==='ANCHORED'`), NOT the entity-wide `hasAnchoredSnapshot` (architect I2). `staleAnchor` = period was anchored then reopened with no subsequent re-anchor (accountant M2 / architect M2).
- `POST /entities/:id/period/lock` → backend **recomputes** lights; any blocking light not green → 409 `LIGHTS_NOT_GREEN`; status≠OPEN → 409 `ILLEGAL_TRANSITION`. On success: status=LOCKED, persist `lightsSnapshot`, `lockedAt`, `lockedBy`=server-const.
- `POST /entities/:id/period/reopen` → body `{ restatementReason, reasonCode, affectedAmountEstimate? }`. Require status=LOCKED; `restatementReason` trimmed non-empty ≤512 utf8; `reasonCode` in enum (else 400). On success: status=OPEN, `reopenCount++`, `reopenedAt`, capture `wasAnchoredAtReopen`, persist fields append-only, `requestedBy`/`approvedBy` server-const.

Changed: `POST /entities/:id/snapshot` (freeze→anchor) — add `requireStatus==='LOCKED'` else 409 `PERIOD_NOT_LOCKED`. **The LOCKED-status read must happen inside the existing per-entity `deps.mutex.run(entityId,…)`** so it's consistent with the snapshot insert (architect I3), not as a pre-mutex route guard. Keeps existing exceptions/recon close-gate + idempotent return + `ALREADY_ANCHORED`.

## 5. Frontend components

New: `web/src/workspaces/close/` + `close.css` (use `--s-N`/`--r-*` aliases + `--shadow-md`; no raw px, no new color tokens — `--credit`/`--debit`/`--warn`/`--ink-soft` cover all four states).

**`CloseCockpit.tsx`** — landing for `close`. Layout top→down:
1. **Period status ribbon** (full-width band where StepRail sat): PeriodPill + status chip (OPEN=`--brass` chip; LOCKED=`.austere` navy chip) + reopenCount badge + staleAnchor warning if set.
2. **Lights grid** — `display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr))` (3-up ≥1024, 2-up 640–1024, 1-up <640). **Cards severity-sorted: red → derived → mock → green** (not declaration order; frontend C2). An `aria-live` header states the verdict ("2 lights blocking close") so the conclusion doesn't require scanning six cards.
3. **LockPanel / Reopen CTA** (full-width sticky-bottom on <640, reusing ExceptionDetail `position:sticky;bottom:0`).

**`LightCard.tsx`** — four states, two-axis (glyph + label + border, **never color-only**; mirrors ExceptionList `CAT_META`):
| state | glyph | label | color | border |
|-------|-------|-------|-------|--------|
| green | `✓` | "Ready" | `--credit` | — |
| red | `!` | "Blocking" | `--debit` | 3px `--debit` left-border (reuse `.recon-row--material` inset-shadow) |
| derived | `≈` | "Derived" | `--warn` | `sup` footnote glyph → caveat (reuse recon `.brk sup`) |
| mock | `◌` (hollow) | "未接真訊號" | `--ink-soft` | dashed border ("not wired") |
Clicking a non-green real light dispatches to the matching step/workspace (recon→reconciliation, classification→review, JE→journal, completeness→ingest).

**`LockPanel.tsx`** — Lock CTA enabled only when all blocking lights green. **Disabled state renders an inline `role="status"` line naming blockers** ("Locked out by: Recon, Classification"), each name a button dispatching to that light (NOT a tooltip — invisible on touch; frontend I1). **Lock signature moment** = the ribbon transitions `--paper-card`→`--ink` (`.austere`, existing `transition:background 140ms`, respect `prefers-reduced-motion`): the period card "goes to ink." A quiet **brass-seal** glyph, **not** an otter celebration — the mascot Celebration stays reserved for **Anchor** (frontend I2). **Lock zone is mascot-free** (it freezes data; §8.4 governance).

**`ReopenDialog.tsx`** — single dialog, **maker→checker step indicator** (reuse StepRail done/active circles, small): step 1 fill `restatementReason` + `reasonCode` (select) + optional `affectedAmountEstimate` → "request reopen"; step 2 "approve & reopen" (disabled until step-1 reason non-empty, mirroring DecideForm pending-gating, so the ritual *feels* like SoD even while `requestedBy===approvedBy` is mocked). **`mock-until-auth` ribbon at the TOP** of the dialog (before the fields; honest framing first), styled like `.recon-anchored-ribbon` but `--warn` not `--aqua`.

Retained: `IngestStep`…`AnchorStep`, deep-linked from light cards. **StepRail collapses below the cockpit (secondary nav)** — light grid is primary; don't show both at equal weight (frontend M2).

Data hooks: `useCloseCockpit` (stale-request guard, following `useReconciliation`).

## 6. Data flow

```
GET /close-cockpit ──> recompute lights (real|derived|mock) + per-period status + staleAnchor ──> CloseCockpit
  light red ──> click ──> dispatch to step/workspace ──> resolve ──> refetch
  all blocking green ──> Lock (POST /period/lock; backend re-verifies, freezes lightsSnapshot) ──> LOCKED
  LOCKED ──> Anchor (existing freeze→snapshot→wallet-sign→on-chain; gate requires LOCKED) ──> anchored
  LOCKED ──> Reopen (two-step + reason + reasonCode) ──> OPEN, reopenCount++, wasAnchoredAtReopen captured
  reopen of anchored period ──> staleAnchor=true until re-Lock + re-anchor (NOT auto; §10-A1)
```

## 7. Error handling (fail-loud, server-enforced)

- `LIGHTS_NOT_GREEN` (409) — lock with a non-green blocking light. Backend-recomputed, not client-trusted.
- `PERIOD_NOT_LOCKED` (409) — anchor/freeze while OPEN.
- `ILLEGAL_TRANSITION` (409) — any state-machine violation; CAS race loser lands here.
- `VALIDATION` (400) — missing/empty/over-length `restatementReason`; unknown `reasonCode`.
- All lock/reopen writes in a transaction; partial-failure leaves state unchanged.

## 8. Testing (Rule 9 — encode WHY; backend.md Monkey mandatory)

State machine: every legal transition passes; **every illegal transition rejected** (table-driven). Light aggregation: real / derived / mock asserted distinctly; mock never reports green; **JE light fails when individual JEs balance but TB≠0** (encodes accountant C2). `lock` recompute ignores client-sent lights (curl forged green → 409); persists `lightsSnapshot` immutably (reopen+data-change must not alter the locked snapshot — accountant I3). `anchored` flag is per-period (different periodId never shows anchored — architect I2). `anchor`-requires-LOCKED gate inside mutex. `reopen` transaction + CAS race (two concurrent reopens → one wins, one ILLEGAL_TRANSITION). `restatementReason`/`reasonCode` boundaries. `staleAnchor` set after reopen-of-anchored, cleared after re-anchor. Frontend: four states glyph/border, severity sort, Lock-disabled-names-blocker, two-step reopen ritual, RWD 1024/640.

**Monkey (backend):** out-of-order transition spam; concurrent lock+reopen; concurrent lock+anchor interleave (architect I3); curl bypass of lights; over-length reason; reopen on never-locked period; re-freeze after reopen without re-lock (must 409).

## 9. Deferred — split by severity (Rule 12; accountant I1/I5)

### Blocking-for-production (NOT shippable to a real client without these — demo defers *enforcement*, but they are named here as hard requirements, not nice-to-haves)
- **Real SoD enforcement** (maker≠checker identity; schema must forbid `approvedBy==requestedBy` once identities exist). Blocked on auth (A-1/A-2 §9.3). The current two-step ritual is **UX-only** until then.
- **Lock approval / attestation** — Lock currently single-control (`lockedBy` server-const); a real close is a controller-attested event. Asymmetry with dual-controlled Reopen must be resolved: add `lockApprovedBy`. (accountant I2)
- **Cutoff control** — `completeness` is presence, not cutoff. Requires event `period_id` (below). Most common close misstatement; first audit test. (accountant C3)
- **Period attribution** — events have no `period_id` (A-1 §9.1). System currently closes an entity's *entire history*, not a period. Lock/Reopen semantics change materially once periods exist. (accountant I5 / architect I2)
- **Posted/approved-JE gate** — JE light verifies balance+TB, not posting/approval state (not modeled). (accountant C1)
- **FX revaluation / multi-currency** — no period-end reval-to-reporting-currency light. For any entity holding >1 asset, an unrevalued period is materially misstated. State single-reporting-currency assumption or add the light. (accountant I4)
- **pricing / export real signals** — currently mock; in production become real-and-blocking. (accountant M3)

### Nice-to-have
- Reopen count cap / escalation after N (fraud/earnings-management red flag). (accountant M1)
- Period-over-period flux/variance sanity check. (accountant M4)
- Restatement → auto re-anchor (see §10-A1). Current: manual re-lock + re-anchor; `staleAnchor` warns.

## 10. Adjudication notes (review findings resolved here)

- **A1 — restatement versioning descoped in B1, but TRACKED as a required future upgrade (architect C1, CRITICAL).** The earlier draft claimed "reopen of an anchored period surfaces restatement via chain `supersedes_seq`." **False as written:** `/snapshot` builds `new InMemorySnapshotRepo()` per request → always `seq=1, supersedesSeq=null`; re-freezing an ANCHORED period hits `ALREADY_ANCHORED` (409). The Move contract supports `supersedes_seq`, but the API freeze path cannot produce v2. **B1 resolution:** descope honestly — reopen-of-anchored sets `staleAnchor` and the period can be re-locked, but producing a superseding on-chain snapshot is **not functional in B1**.
  - **⏭ TRACKED FUTURE UPGRADE — "restatement → re-anchor v2 (supersede prior on-chain snapshot)".** Real enterprises DO restate closed periods (ASC 250 / IAS 8); this is a genuine product requirement, deferred only because B1 is scoped to the mock-lock layer. Engineering needed when picked up: (1) DB-backed **per-period version counter** in `snapshotStore` (drop the per-request `new InMemorySnapshotRepo()`); (2) snapshot id `snap-{entity}-{period}-{seq}` so v2 gets a distinct id (no `ALREADY_ANCHORED` collision); (3) `buildSnapshot` reads prior `seq` → emits `supersedesSeq = prevSeq`; (4) freeze path accepts `restate:true` post-reopen; (5) re-anchor PTB on-chain (Move `supersedes_seq` already supports it, F3-tested). Estimated 1–2 SDD tasks touching `snapshotRepo`/`routes`/`anchor-svc`. Recorded in `anchor-notes.md`.
- **A2 — accountant C2 folded into JE light** (TB tie-out) rather than a 7th light, to preserve the "six lights" narrative while making the JE gate substantive.
- **A3 — mock lights don't block (demo), invert to blocking (production).** Disclosed in §3 + §9. Anchored manifest/UI must not imply mock controls passed (architect M3).

## 11. Why B2 is deferred (gap inventory result)

A-2 already shipped forward lineage (raw→AI→JE→chain), browser-recomputed inclusion proof, balance/reversal/supersedes, EventCompare matrix, source-tx explorer link, `AnchorDTO.merkleRoot`. B2's remaining asks are either covered or backend-blocked by the same gaps A-2 documented: no `period_id` (no period-balance drill-down / grouping), and rule@version / priceRef / AI-model-version not persisted (no as-of-posting provenance). The only clean net-new — a "digest → reverse-lookup lineage" entry point — is small, a later follow-up. Full B2 = cross-service schema migration (rules-engine/snapshot/anchor), out of Phase 2.

## 12. Implementation order (for writing-plans)

1. Backend `periodLock/state.ts` (pure state machine) + tests.
2. Backend `periodLock/store.ts` (table + transactional CAS writes + lightsSnapshot/restatement columns) + tests.
3. Backend `cockpit.ts` aggregation (incl. JE TB tie-out, per-period anchored, staleAnchor) + tests.
4. Backend endpoints (`GET /close-cockpit`, `POST /period/lock`, `POST /period/reopen`) + `/snapshot` LOCKED-gate-inside-mutex + integration + Monkey.
5. Frontend `useCloseCockpit` hook.
6. Frontend `LightCard` four states + severity sort + dispatch.
7. Frontend `CloseCockpit` + status ribbon + lights grid + RWD (1024/640).
8. Frontend `LockPanel` (inline blocker naming + ink-transition signature) + `ReopenDialog` (two-step ritual + top mock-until-auth ribbon).
9. Wire `close` landing to CloseCockpit; StepRail secondary; deep-link steps.
