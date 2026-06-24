# Policy Workspace — Design (Phase 1 D)

**Date**: 2026-06-24
**Status**: Approved (brainstorm, post tri-review revision) → pending implementation plan
**Slot**: `web/src/workspaces/policy/` (currently placeholder, status `soon`)
**Reviews folded in**: sui-architect (architecture), CPA (accounting requirements), frontend-design (layout/aesthetics).

## 1. Goal & Boundary

A **read-only presentation-&-rounding governance panel**. It displays the active
`ResolvedPolicySet` and COA mapping, and runs a **pure-frontend what-if
recompute** over existing journal-entry (JE) samples across two levers
(rounding threshold, COA mapping), emitting a **diff preview**.

It **does not apply, persist, or mutate** anything, and does **not change
rules-engine behavior** — honoring workspace-shell spec §6.9 ("AI 不可改 policy").

### Honest value framing (CPA review)
This is **not** a full "accounting policy" panel. The two material policy
levers a CPA cares about most — **cost-basis method** (FIFO/LIFO/WAC) and
**functional currency** — are **deferred** and shown read-only as
**"method locked — preview not supported"**. `functionalCurrency` is further
labeled **"fixed system assumption, not a configured policy"** (it is a
hardcoded `'USD'` demo constant with empty `fxRates`). The panel's honest value
prop is **presentation (COA reclassification) & rounding what-if**, plus
governance display — not measurement-policy simulation.

### Scope decisions (from brainstorm)
- **Write boundary**: viewer + dry-run preview, **no** real CRUD (violates §6.9
  + flagged high-risk in `tasks/notes.md`).
- **Preview levers**: A (`roundingThresholdMinor`) + B (COA mapping). Both
  deterministic and pure-frontend computable. C (`costBasisMethod`) and D
  (`functionalCurrency`) deferred (error-prone cost-basis state machine / no FX
  infra).
- **Data source**: additive read-only API endpoint exposing existing backend
  policy constants (mirrors how export exposed `periodId`/`leafCount`).
- **Period applicability (D1=a)**: preview acts **only** on JEs of the
  **current open period under the current policy version**. Closed-period JEs
  are visually fenced and excluded from recompute — recomputing current policy
  over historical/closed-period entries is a category error (restatement) and a
  CPA must-fix. **Deferred (future upgrade, D1=b)**: full effective-dated policy
  version history (`effectiveFrom`/`effectiveTo`, per-JE posting version).

### Spine (脊椎)
Policy's value is **governance/traceability display**, not cryptographic
closure. Spine anchor (D2=a — wired this slot): the preview baseline
`policySetVersion` from `GET /policy/active` is **cross-checked for equality**
against the `policySetVersion` embedded in export bundle manifests. This
requires first **wiring `policySetVersion` into the export `manifestObj`** (see
§2), sourced from the same shared constant the endpoint reads.

### Governance honesty (architect I4 / CPA §5)
Policy is purely off-chain hardcoded constants; `policySetVersion` is **not**
part of any merkle leaf preimage. The on-chain anchor commits to **journal
entries, not to the policy version that produced them** — a verifier cannot
cryptographically prove which policy set generated anchored JEs. The panel is a
**display/preview**, not an attested-governance proof. **Deferred (§6)**:
on-chain provenance binding of `policySetVersion` (hash of `ResolvedPolicySet`
into the anchored leaf/snapshot).

## 2. Architecture & Data Flow

```
Backend
  1. Extract policySet + COA mapping from buildRuleInput.ts into a shared,
     IMPORTABLE source-of-truth module. Values UNCHANGED; SHAPE changes for COA:
     CoaMapping.resolve() (a closure) is NOT serializable, so the mapping is
     represented as a serializable TABLE (data); the runtime resolve() is
     REBUILT from that table → single source of truth (architect I2).
  2. buildRuleInput.ts now IMPORTS from that module (no copied literals).
  3. GET /policy/active → { policySet: ResolvedPolicySet, coaMappingTable, periodId }
  4. Wire policySetVersion into export buildBundle manifestObj, sourced from the
     SAME shared constant (architect C1 / D2=a).

Frontend
  data/usePolicyData.ts    ← fetch /policy/active + existing journal query (current-period JEs)
  lib/policyPreview.ts     ← pure recompute engine (A: rounding, B: coa remap)
  workspaces/policy/
    PolicyWorkspace.tsx     ← single-column shell (NOT 3-up grid); preview panel = centerpiece
    PolicySummaryCard.tsx   ← active policy, grouped: governance cluster + config cluster
    CoaMappingTable.tsx     ← (eventType, leg) → account, the LIVE mapping
    PreviewPanel.tsx        ← dashed panel: lever inputs + diff table + before/after trial balance
```

**Flow**: load → render active (real baseline) → user adjusts lever →
`policyPreview` recomputes over **current-period** loaded JEs → diff
(changed-JE list + before/after trial balance, reusing existing
`trialActivity`/`balance`).

## 3. Recompute Engine — `lib/policyPreview.ts`

Pure functions, deterministic, immutable inputs (return new objects; originals
untouched). React/fetch-free so unit tests stay pure (architect N5). Reuse
`trialActivity`/`balance`/existing guards rather than reimplement.

### Lever A — rounding (CPA §3 — corrected treatment)
`previewRounding(jes, newThresholdMinor) → { absorbed: JeDiff[], flagged: JeReview[], roundingDiffDelta }`
- Residual **below** threshold = deemed immaterial → absorbed into a dedicated
  **Rounding-Difference account (P&L)**, NOT suspense. (Suspense is for
  unclassified items pending investigation; routine rounding does not belong
  there.)
- Residual **at/above** threshold = material → **red-flag as a review
  exception** (reuse engine's `JE_OUT_OF_BALANCE` / `REVIEW_REQUIRED`
  semantics), **never auto-route**. A large unexplained difference signals a
  real error (price/FX/lot math), not rounding.

### Lever B — COA remap (CPA §4 — with controls)
`previewCoaRemap(jes, newMappingTable) → { changed: JeDiff[], coverage, conservation, warnings }`
- Pure lookup remap of (eventType, leg) → account; recompute trial-balance
  classification.
- **Coverage report**: count legs mapped explicitly vs. fell to the `Suspense`
  catch-all default; **list the defaulted legs** (never silently dump into
  Suspense).
- **Grand-total conservation assertion**: total debits and total credits across
  the trial balance are identical before/after; only line distribution changes.
  Per-account net-zero reconciliation (every account that lost balance has
  offsetting gains elsewhere).
- **Orphaned-balance flag**: an account present in *before* but absent in
  *after* is flagged (confirm balance landed somewhere).
- **Account-type sanity**: show account type (asset/liability/equity/income/
  expense); flag remaps that cross statement boundaries (e.g. revenue→asset).
- **`reversalOf` consistency**: an entry and its reversal must remap
  identically; flag divergence.

### Red-team (core logic — attack vectors + defenses)
1. **Negative / non-integer threshold** → entry clamp + reject NaN, fall back
   to baseline.
2. **COA remap to non-existent account** → validate against known account set;
   unknown → mark invalid, never silently swallow.
3. **Unbalanced legs after remap** → per-JE balance assertion (reuse existing
   balance util); on break, red-flag.
4. **Empty JE sample / empty mapping** → empty state, no crash.
5. **`BigInt('')` / empty amount** (the bug export hit) → normalize before
   recompute, reuse existing guard.

## 4. UI (frontend-design review folded in)

**Single-column flow** mirroring `ExportWorkspace` (`export.css` shell,
`max-width:1200px`, vertical flex, `gap: var(--space-4)`) — NOT a 3-up grid.
Read order: header → active-policy card → COA table → **preview panel
(centerpiece, carries visual weight)**.

### Region 1 — active-policy card (grouped, no flat dump)
Use the `.export-period-display` definition-row idiom (uppercase letter-spaced
label + mono value). Two clusters:
- **Governance**: `policySetVersion` as a brass `.status-chip`; `periodOpen` via
  `.status-chip` (open=brass / locked=navy, per `close.css`); applicable
  `periodId`.
- **Accounting config**: costBasis, functionalCurrency, rounding as mono
  definition-rows. costBasis + functionalCurrency rendered read-only with a
  **"method locked — preview not supported"** chip; functionalCurrency tagged
  **"fixed system assumption"**.

### Region 2 — live COA mapping table
The real, live mapping. Must be visually distinct from the preview's what-if
mapping so users never confuse them.

### Region 3 — preview panel (centerpiece)
- **Safe-state signal (corrected — no watermark exists in code)**: reuse the
  **DRAFT badge** (`.export-status-badge--draft`, `export.css:104-108`:
  transparent bg, `--warn`, 1.5px border, uppercase pill) labeled **"PREVIEW —
  NOT APPLIED"**, plus a **dashed border on the whole panel**
  (`.export-draft-card` `border-style: dashed`, `export.css:153-155`). This is
  the codebase's actual "not committed" vocabulary; do NOT invent a diagonal
  watermark.
- **Lever inputs**: trigger via a **ghost-pill "Recompute preview"**
  (`.export-retry-btn`, `export.css:216-234`) — explicitly NOT `.btn-primary`
  (brass primary = real actions like Lock/Download). Ghost = safe/secondary, so
  controls don't read as mutating.
- **Diff table** (resolve the two colliding diff conventions):
  - "Changed" rows use **brass-Δ + left-border** (the `EventCompare` idiom,
    `EventCompare.tsx:50-56`) — deliberately not red/green, since changed≠bad.
  - Added = `--credit` left-border + "+"; removed = `--debit` left-border +
    strikethrough + "−".
  - Red/green (`--debit`/`--credit`) reserved **only** for trial-balance
    debit/credit columns (`JournalTable.tsx:59`).
  - Numbers: `className="mono"` + `tabular-nums` + right-aligned; render
    `amountMinor` as raw BigInt string, never parsed to float
    (`JournalTable.tsx:33,40,66`). Before/after columns align digit-for-digit.
  - **Cleanup flag**: the brass-Δ vs red/green diff conventions should
    eventually be unified into one shared diff primitive (out of scope here).
- **Before/after trial balance**: side-by-side using Audit's `flex` split
  (`AuditWorkspace.tsx:37-39`), two equal columns `flex: 1 1 0`.

### Deferred levers (C/D)
Read-only with a **"deferred" chip** (reuse `.lock-blockers` caption-chip idiom,
`close.css:143-154`) stating the reason; use the **scoped disabled override**
(`close.css:129-140`), NOT raw `opacity:0.45` (which muddies brass illegibly);
add `aria-disabled`.

### Color-discipline guardrails
- **`--aqua` is on-chain/anchor-only** (`base.css:76`) — do NOT use it anywhere
  in this workspace (policy has no chain semantics).
- Mascot-free (all three regions are data surfaces).
- No new color values; everything resolves from `tokens.css`.

## 5. Error Handling & Testing

- **Endpoint missing / failure** → policy card shows "policy unavailable",
  preview disabled (no crash, no fake data).
- **Closed-period guard** → JEs outside the current open period are fenced and
  excluded from recompute; surfaced, not silently dropped.
- **Tests**:
  - `policyPreview` pure-function unit tests — each lever: happy path + 5
    red-team edges + Lever A above/below threshold split + Lever B coverage/
    conservation/orphaned/account-type/reversal assertions.
  - Component render tests.
  - **Monkey testing** (garbage thresholds, huge JE volume, malicious mapping,
    closed-period JEs in sample).
  - Backend anti-drift (architect I3): assert endpoint response **equals the
    imported shared constant** AND that `buildRuleInput` consumes that same
    import (no duplicated literals / snapshot drift).
  - Backend: export manifest now includes `policySetVersion`; add a test
    asserting export manifest value == `/policy/active` value (the spine
    cross-check).
- Targets: web vitest stays green (366 → +new, all green) + build 0; api green.

## 6. Deferred (honest)
- **D1=b**: full effective-dated policy version history (`effectiveFrom`/`To`,
  per-JE posting version, prior-version diff).
- **C/D levers**: `costBasisMethod` and `functionalCurrency` preview.
- **On-chain provenance binding** of `policySetVersion` (hash of
  `ResolvedPolicySet` into the anchored leaf) — current version is an off-chain
  label, not cryptographically attested (architect I4).
- **Governance metadata**: change attribution (who/when/why approved),
  segregation-of-duties evidence, full audit trail (CPA §1) — no write path in
  this slot.
- **Materiality framing** of the rounding threshold (vs % of activity/assets,
  aggregate YTD residual) (CPA §1 should-have).
- **IAS 38 disclosure**: impairment policy/trigger, measurement model
  (cost vs revaluation), fair-value/FVTPL (ASU 2023-08) scope limitation — the
  panel currently shows hardcoded `INTANGIBLE_IAS38_COST` only (CPA §5).
- Real policy CRUD / write path / multi-currency per-entity config.
