# Period Close Cockpit (Phase 2 B1) — Design

**Date:** 2026-06-24
**Scope:** Phase 2 = **B1 only**. B2 (Audit lineage → Sui digest) is explicitly deferred — its net-new surface is thin and backend-blocked (see §10). Fills/upgrades the existing `close` workspace.
**Backend strategy:** read paths compute real signals; demo-hard writes (period lock / reopen) are a mock state machine layered on top of the existing real on-chain anchor flow.

---

## 1. Goal & narrative

Today the `close` workspace is a **linear 5-step flow** (ingest → classify → review → journal → anchor) — the happy-path demo column. B1 upgrades it into an **enterprise period-close cockpit**: a six-light readiness dashboard gating an explicit **Lock** (accounting close), with the existing on-chain **Anchor** layered on top as tamper-evidence, and a **Reopen** path for restatements.

Two distinct concepts, deliberately layered (an ERP user expects both):

- **Lock** = accounting "close the books" — a mock soft-lock state. Freezes exception/recon dispositions for the period.
- **Anchor** = blockchain tamper-evidence — the **existing real** freeze→snapshot→wallet-sign→on-chain flow, now gated to require LOCKED first.

The 5 steps are **not deleted** — they become actions reachable by clicking a light that isn't green.

## 2. Period state machine (net-new, mock)

```
OPEN ──(six lights all green)──> LOCKED ──(anchor: real on-chain)──> LOCKED (+anchored flag)
  ^                                 │                                      │
  └──── REOPEN (restatement reason + maker→checker SoD ritual) ────────────┘
```

States: `OPEN` | `LOCKED`. (`anchored` is a derived flag from existing `hasAnchoredSnapshot`, not a separate state.)

**Transition allowlist (fail-closed — anything not listed → 409 `ILLEGAL_TRANSITION`):**

| from   | action | to     | guard |
|--------|--------|--------|-------|
| OPEN   | lock   | LOCKED | backend **recomputes** six lights, all green |
| LOCKED | anchor | LOCKED | existing freeze/anchor gate (now also requires status=LOCKED) |
| LOCKED | reopen | OPEN   | `restatementReason` non-empty + two-step confirm; `reopenCount++` |

`anchor` does not change the OPEN/LOCKED status — it sets the anchored flag. Lock must precede anchor.

## 3. The six lights

| Light | Source | Status values |
|-------|--------|---------------|
| **classification** | real — review-queue pending count + `close-readiness.exceptions.blocking` | green / red |
| **JE** | real — `/journal` exists (run-rules done) AND every JE balanced (debit=credit) | green / red |
| **recon** | real — `close-readiness.recon.blocking` | green / red |
| **completeness** | **derived** — events ≠ ∅ AND no pending ingest. Labeled `derived` (no canonical "expected sources" definition yet) | green / red / derived |
| **pricing** | **mock** — no real pricing-coverage signal (price lives inside run-rules `priceRef`, not surfaced) | `{status:'mock', label:'未接真訊號'}` |
| **export** | **mock** — Phase 3 C not built | `{status:'mock', label:'未接真訊號'}` |

**Honesty rule (project spine):** real lights compute real; derived lights are labeled `derived`; mock lights are explicitly labeled mock and **never render fake-green**. A mock light does **not** block Lock (it carries no real signal), but its mock status is shown so no one mistakes it for a passed control. `closeable` = all *real + derived* lights green.

## 4. Backend components

New: `services/api/src/periodLock/`
- `state.ts` — transition allowlist + `transition(from, action, guards)` pure fn, fail-closed.
- `store.ts` — `period_lock` table. PK `(entityId, periodId)`. Columns: `status`, `restatementReason`, `requestedBy`, `approvedBy` (server-const), `lockedAt`, `reopenedAt`, `reopenCount`. All writes inside a transaction with status compare-and-set (CAS on `from`-state).
- `cockpit.ts` — six-light aggregation (recompute-on-read; reuses `close-readiness`, `/journal` balance check, review-queue).

New endpoints (in `http/routes.ts`):
- `GET /entities/:id/close-cockpit?periodId=` → `{ lights: {...6}, status, anchored, reopenCount, restatementReason }`. Recompute-on-read; trusts no client input.
- `POST /entities/:id/period/lock` → backend **recomputes** six lights; if any real/derived light not green → 409 `LIGHTS_NOT_GREEN`; if status≠OPEN → 409 `ILLEGAL_TRANSITION`. On success: status=LOCKED, `lockedAt`, `requestedBy`=server-const.
- `POST /entities/:id/period/reopen` → body `{ restatementReason }`. Require status=LOCKED; `restatementReason` trimmed non-empty, ≤512 utf8 (else 400 `VALIDATION`). On success: status=OPEN, `reopenCount++`, `reopenedAt`, `approvedBy`/`requestedBy` server-const, reason persisted append-only.

Changed: `POST /entities/:id/snapshot` (freeze→anchor) gate — add `requireStatus === 'LOCKED'`; OPEN → 409 `PERIOD_NOT_LOCKED` ("lock the period before anchoring"). Keeps existing exceptions/recon close-gate.

## 5. Frontend components

New: `web/src/workspaces/close/`
- `CloseCockpit.tsx` — six-light grid + period-status ribbon + Lock/Reopen CTA. Landing for the `close` workspace.
- `LightCard.tsx` — four visual states (green / red / derived / mock) with **two-axis encoding** (icon + text label, not color-only). Clicking a non-green real light dispatches to the matching step/workspace (e.g. recon → reconciliation workspace).
- `LockPanel.tsx` — Lock CTA enabled only when all real/derived lights green; disabled state explains which light blocks.
- `ReopenDialog.tsx` — **maker→checker two-step ritual**: step 1 fill restatement reason + "request reopen"; step 2 "approve & reopen". `requestedBy`/`approvedBy` shown as server-const with a **`mock-until-auth` ribbon** (SoD enforcement deferred to identity system — same blocker as A-1/A-2 §9.3).

Retained: `IngestStep`…`AnchorStep` — now deep-linked from light cards (StepRail still usable for sequential walk).

Data hooks: `useCloseCockpit` (with stale-request guard, following the `useReconciliation` convention).

## 6. Data flow

```
GET /close-cockpit ──> recompute 6 lights (real|derived|mock) + period status ──> CloseCockpit
  light not green ──> click ──> dispatch to step/workspace ──> user resolves ──> refetch
  all real/derived green ──> Lock (POST /period/lock, backend re-verifies) ──> LOCKED
  LOCKED ──> Anchor (existing freeze→snapshot→wallet-sign→on-chain) ──> anchored
  LOCKED ──> Reopen (two-step + reason) ──> OPEN ──> reopenCount++
```

## 7. Error handling (fail-loud, server-enforced)

- `LIGHTS_NOT_GREEN` (409) — lock attempted with a non-green real/derived light. Backend-recomputed, not client-trusted.
- `PERIOD_NOT_LOCKED` (409) — anchor/freeze attempted while OPEN.
- `ILLEGAL_TRANSITION` (409) — any state-machine violation (e.g. lock when already LOCKED, reopen when OPEN). CAS race loser lands here.
- `VALIDATION` (400) — missing/empty/over-length `restatementReason`.
- All writes (lock/reopen) wrapped in a transaction; partial-failure leaves state unchanged.

## 8. Testing (Rule 9 — encode WHY; backend.md Monkey mandatory)

State machine: every legal transition passes; **every illegal transition is rejected** (table-driven). Six-light aggregation: real / derived / mock each asserted distinctly; a mock light must never report green. `lock` recompute ignores client-sent light values (curl forged green → still 409). `anchor`-requires-LOCKED gate. `reopen` transaction + CAS race (two concurrent reopens → one wins, one ILLEGAL_TRANSITION). `restatementReason` boundaries (empty / whitespace-only / 512+ bytes / injection-ish). Frontend: light-card four states, two-step reopen ritual, Lock-disabled-explains-blocker, RWD.

**Monkey (backend):** out-of-order transition spam; concurrent lock+reopen; curl bypass of six lights; over-length reason; reopen on never-locked period.

## 9. Deferred (recorded, NOT silently skipped — Rule 12)

- **Real SoD enforcement** — maker≠checker identity. Blocked on auth system (A-1/A-2 §9.3). Ritual is UX-only until then; `requestedBy`/`approvedBy` are server-const, labeled.
- **pricing / export real signals** — no pricing-coverage surface; export is Phase 3 C. Lights labeled mock.
- **completeness "expected sources" definition** — no source-coverage registry; light is derived (events present + no pending ingest), labeled.
- **Per-period scoping sharp edge** — events have no `period_id` (A-1 §9.1); lock/anchor remain **entity-scoped**. Single-period demo correct; multi-period needs event period attribution.
- **Restatement → re-anchor automation** — reopen of an anchored period surfaces the restatement path (chain `supersedes_seq` already supports it) but does not auto re-anchor; user re-runs anchor manually.

## 10. Why B2 is deferred (gap inventory result)

A-2 already shipped forward lineage (raw→AI→JE→chain), browser-recomputed inclusion proof, balance/reversal/supersedes, EventCompare matrix, source-tx explorer link, `AnchorDTO.merkleRoot`. B2's remaining asks are either already covered, or backend-blocked by the same gaps A-2 documented: no `period_id` (can't do period-balance drill-down or period grouping), and rule@version / priceRef / AI-model-version not persisted (can't show as-of-posting provenance). The only clean net-new — a "digest → reverse-lookup lineage" entry point — is small and can be a later follow-up. Doing full B2 means a cross-service schema migration (rules-engine/snapshot/anchor), out of Phase 2 scope.

## 11. Implementation order (for writing-plans)

1. Backend `periodLock/state.ts` (pure state machine) + tests.
2. Backend `periodLock/store.ts` (table + transactional CAS writes) + tests.
3. Backend `cockpit.ts` six-light aggregation + tests.
4. Backend endpoints (`GET /close-cockpit`, `POST /period/lock`, `POST /period/reopen`) + `/snapshot` gate change + integration + Monkey.
5. Frontend `useCloseCockpit` hook.
6. Frontend `LightCard` + four states + dispatch.
7. Frontend `CloseCockpit` + `LockPanel` + status ribbon.
8. Frontend `ReopenDialog` two-step ritual + mock-until-auth ribbon.
9. Wire `close` workspace landing to CloseCockpit; deep-link steps; RWD.
