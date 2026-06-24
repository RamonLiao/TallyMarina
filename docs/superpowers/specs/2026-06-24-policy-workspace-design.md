# Policy Workspace — Design (Phase 1 D)

**Date**: 2026-06-24
**Status**: Approved (brainstorm) → pending implementation plan
**Slot**: `web/src/workspaces/policy/` (currently placeholder, status `soon`)

## 1. Goal & Boundary

A **read-only accounting-policy governance panel**. It displays the active
`ResolvedPolicySet` and COA mapping, and runs a **pure-frontend what-if
recompute** over existing journal-entry (JE) samples across two levers
(rounding threshold, COA mapping), emitting a **diff preview**.

It **does not apply, persist, or mutate** anything, and does **not change
rules-engine behavior** — honoring workspace-shell spec §6.9 ("AI 不可改
policy"). `costBasisMethod` and `functionalCurrency` levers are **deferred**
(honestly labeled in UI), same treatment export gave `functionalCurrency`.

### Scope decisions (from brainstorm)
- **Write boundary**: B — viewer + dry-run preview, **no** real CRUD (C
  rejected: violates §6.9 + flagged high-risk in `tasks/notes.md`).
- **Preview levers**: A (`roundingThresholdMinor`) + B (COA mapping). Both are
  deterministic, pure-frontend computable, and produce accountant-meaningful
  diffs without touching the error-prone cost-basis state machine. C
  (`costBasisMethod` FIFO→LIFO/WAC) and D (`functionalCurrency`) deferred.
- **Data source**: A — additive read-only API endpoint exposing the existing
  backend policy constants (mirrors how export exposed `periodId`/`leafCount`).

### Spine (脊椎)
Policy's value is **governance/traceability**, not cryptographic closure. Its
one spine anchor: the preview **baseline = the real backend active policy**
(incl. `policySetVersion`), which **cross-references** the `policySetVersion`
already written into export bundle manifests. Pure fixtures would break this
cross-check, so the active policy is sourced from the backend.

## 2. Architecture & Data Flow

```
Backend (only change = additive read-only exposure of existing constants)
  buildRuleInput.ts policySet / coaMapping constants
    → extracted into an importable source-of-truth module (values UNCHANGED)
    → GET /policy/active → { policySet: ResolvedPolicySet, coaMapping: CoaMapping }

Frontend
  data/usePolicyData.ts    ← fetch /policy/active + existing journal query (sample JEs)
  lib/policyPreview.ts     ← pure recompute engine (A: rounding, B: coa remap)
  workspaces/policy/
    PolicyWorkspace.tsx     ← shell: active-policy view + what-if controls + diff
    PolicySummaryCard.tsx   ← all ResolvedPolicySet fields (with version chips)
    CoaMappingTable.tsx     ← (eventType, leg) → account mapping table
    PreviewPanel.tsx        ← two lever inputs + diff result
```

**Flow**: load → render active (real baseline) → user adjusts lever →
`policyPreview` recomputes over already-loaded JEs → diff (changed-JE list +
before/after trial balance, reusing existing `trialActivity` / `balance`).

## 3. Recompute Engine — `lib/policyPreview.ts`

Core logic. Pure functions, deterministic, immutable inputs (return new
objects; original JEs untouched).

- **Lever A — rounding**:
  `previewRounding(jes, newThresholdMinor) → { changed: JeDiff[], suspenseDelta }`
  Re-applies the minor-unit threshold per JE; residual over threshold → routed
  to the suspense leg. **Does not re-run cost-basis** — only rounding/suspense.
- **Lever B — COA remap**:
  `previewCoaRemap(jes, newMapping) → { changed: JeDiff[], reclassified }`
  Pure lookup remap of (eventType, leg) → account; recomputes trial-balance
  classification.
- Levers compose; unified `PreviewResult` output.

### Red-team (core logic — attack vectors + defenses)
1. **Negative / non-integer threshold** → entry clamp + reject NaN, fall back
   to baseline.
2. **COA remap pointing to a non-existent account** → validate against known
   account set; unknown → mark invalid, never silently swallow.
3. **Unbalanced legs after remap (debit ≠ credit)** → preview runs a balance
   assertion per JE; on break, red-flag that entry.
4. **Empty JE sample / empty mapping** → empty state, no crash.
5. **`BigInt('')` / empty amount** (the bug export hit) → normalize before
   recompute, reuse existing guard.

## 4. UI

Reuses existing workspace visual language. Three regions:
1. Active policy card (read-only, version chip)
2. COA mapping table
3. Preview panel (two lever inputs + "N JEs changed" diff table + side-by-side
   before/after trial balance)

Explicit **"PREVIEW — NOT APPLIED" watermark** (echoing export's UNVERIFIED
draft language) so it is unmistakable nothing took effect. C/D levers greyed
out and labeled "deferred".

## 5. Error Handling & Testing

- **Endpoint missing / failure** → policy card shows "policy unavailable",
  preview disabled (no crash, no fake data).
- **Tests**:
  - `policyPreview` pure-function unit tests (each lever: happy path + 5
    red-team edges).
  - Component render tests.
  - **Monkey testing** (garbage thresholds, huge JE volume, malicious mapping).
  - Backend: additive endpoint + 1 api test asserting exposed values ==
    `buildRuleInput` constants (anti-drift guard).
- Targets: web vitest stays green (366 → +new, all green) + build 0; api green.

## 6. Deferred (honest)
- `costBasisMethod` (C) and `functionalCurrency` (D) preview levers.
- Real policy CRUD / write path / multi-currency per-entity config.
- Auth / audit trail for policy changes (no write path in this slot).
