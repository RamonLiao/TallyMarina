# Reconciliation Workspace (Phase 1 A-3) — Design

**Date**: 2026-06-23
**Status**: Approved (brainstorming)
**Slot**: fills `'reconciliation'` ⚖ workspace (`soon` → `ready`)
**Umbrella**: `docs/superpowers/specs/2026-06-23-workspace-shell-design.md` §A3 (§4.6, §6.6)

## 1. Purpose

Three-way balance reconciliation per `(wallet, coinType)` for a single period:
`opening + movements = computed(book)`, compared against an external statement
(mock) and, for SUI only, against live on-chain balance. Material unresolved
breaks block the period close (freeze).

This is a control surface (audit/treasury), so the spine principle applies:
**evidence must be client-recomputable or explicitly labeled as a backend/mock
assertion — a backend green check is not evidence.**

## 2. Reconciliation Model

Granularity: one row per `(wallet, coinType)`, period = `DEFAULT_PERIOD` (single-period demo).

Three balance sources per row:

| Column | Source | How obtained | Provenance |
|---|---|---|---|
| **computed ending (book)** | `opening + Σ movements` | opening from backend fixture; movements recomputed **client-side** from real JE legs via `origMemo(coinType)` | `book` (recomputable) |
| **statement ending** | mock external/custodian statement | backend fixture | `mock` (labeled) |
| **chain ending** | actual on-chain balance | **SUI only**: client `SuiClient.getBalance(realWallet, 0x2::sui::SUI)` read in browser; other assets `n/a` | `live` (explorer-verifiable) |

### Breaks

- **primary break** = `computed − statement` (deterministic). Drives materiality + close gate.
- **chain break** = `computed − chain` (SUI only, **informational**). Live balance drifts
  between read and freeze, so it must NOT enter the close gate.

### Materiality

Each row carries a `thresholdMinor` (asset minor units) from the recon fixture (curated).
- `|primaryBreak| ≥ threshold` → **material (blocking)**
- `0 < |primaryBreak| < threshold` → immaterial (shown, not blocking)
- `primaryBreak == 0` → balanced ✅

Boundary: `== threshold` counts as material (≥, not >).

## 3. Data / Fixtures

New backend fixture `services/api/src/fixtures/acme-pilot-001.recon.json`: per
`(wallet, coinType)` provides `{ openingMinor, statementMinor, thresholdMinor, decimals }`.

Demo data design:
- **SUI**: `opening ≠ 0` + real JE movements + statement with a small curated diff
  (controlled material break) + chain live read (the liveness beat).
- **USDC / WETH (1–2 assets)**: opening from fixture, book movement `= 0` (no JEs),
  statement crafted to produce a controlled break, chain `n/a`.

`realWallet` (for live read): the fixture wallet `0xacmeTreasury` is fictional, so the
real testnet address is supplied via config/env `RECON_LIVE_WALLET` (default: the
connected demo treasury). If unset/unreadable → chain column shows `unavailable`
(fail-loud), never a silent `0`.

Fixture loading is schema-validated: bad/missing rows, non-numeric minors, duplicate
coinTypes, or decimal mismatches **throw** (no silent coercion). All arithmetic is
BigInt (minor-unit strings, never float).

## 4. Backend

New module `services/api/src/reconciliation/` (mirrors `exceptions/`):

- `types.ts` — `ReconRow`, `ReconBreak`, provenance enum.
- `collect.ts` — `collectBreaks(db, entityId, periodId)`: recompute-on-read (same pattern
  as `collectExceptions`). Reads recon fixture (opening/statement/threshold) + recomputes
  movements server-side using the **same** `origMemo` logic over `listJournal` →
  `computed = opening + Σmovements` → `primaryBreak = computed − statement` →
  flags `material = |break| ≥ threshold`. **Does not include chain** (live never enters
  backend judgement).
- `disposition.ts` — **reuses** the Exception disposition state machine
  (`DispositionState` / `REASON_CODES` / transitions: open → resolved/dismissed/deferred,
  fail-closed), writing to a dedicated store.

New store `store/reconBreakStore.ts` + tables:
- `recon_break_dispositions` (PK `entity_id, period_id, wallet, coin_type`)
- `recon_break_disposition_log` (append-only)

`applyReconDisposition` wraps read + upsert + log append in an **atomic transaction**
(concurrency / partial-write would corrupt the audit trail).

### Endpoints (`http/routes.ts`)

1. `GET /entities/:id/reconciliation?periodId=` →
   `{ rows: [{ wallet, coinType, decimals, openingMinor, statementMinor, thresholdMinor, provenance, disposition }], realWallet, summary: { material, openMaterial, balanced } }`.
   Movements/book/chain are **not** computed here — the client recomputes book from
   `/journal` and reads chain in-browser (spine: backend does not pre-compute what is
   client-recomputable).

2. `POST /recon-breaks/:breakId/disposition`, `breakId = ${wallet}|${coinType}`
   (`|` does not appear in addresses/coinTypes; URL-encoded in path; **not `:`** because
   coinType contains `::`). Body `{ state, reasonCode, reasonNote, periodId }`. Guards:
   - re-validate against live `collectBreaks` → forged/stale breakId 404;
   - **anchored period → 409 `ANCHORED_READ_ONLY`** (backend-enforced, not UI-only);
   - `decidedBy` fixed server constant (never from client — anti-impersonation);
   - illegal transition → 409 `ILLEGAL_TRANSITION`;
   - missing state/reasonCode → 400; unknown reasonCode → 400; `OTHER` requires reasonNote.

3. **Close gate** (snapshot freeze handler): after the existing exceptions check, append a
   recon check — count `collectBreaks` rows where `material && isOpen(disposition)`; if
   `> 0` → `409 RECON_BREAKS_BLOCKING` (lists blocking `wallet|coinType`). The two gates
   have independent error codes and do not merge.

4. `GET /entities/:id/close-readiness` — **backward-compatible** extension: add
   `recon: { blocking, blockers }` alongside the existing exceptions fields (existing
   shape unchanged to avoid breaking current consumers).

## 5. Frontend

New `web/src/workspaces/ReconciliationWorkspace.tsx` (registry: `reconciliation` status
`soon` → `ready`). Reuses the existing workspace shell, tokens, RWD.

Layout = list + detail (mirrors Exceptions/Audit two-pane):

**① ReconTable (roll-forward grid)** — one row per `(wallet, coinType)`:
```
Wallet · Asset | Opening | + Movements | = Computed(book) | Statement | Break | Chain(live) | Status
```
- Movements / Computed recomputed client-side from `useJournal` JE legs via
  `origMemo` (reuse `lib/balance.ts`, no new math).
- Each source cell carries a **provenance badge**: `book` / `mock` / `live` (with explorer
  link) / `n/a` (non-SUI chain). Two-axis encoding (icon + label), not color alone
  (colorblind-safe, matches Exception severity encoding).
- `Break` two-axis: ✅ balanced / ⚠ immaterial (shown, not blocking) / ⛔ material
  (blocking) + value.
- `Chain` column: SUI shows live balance + chain-break (informational tag); other assets
  `n/a`; read failure shows `unavailable` (fail-loud, never silent `0`).

**② ReconDetail (drill-down on a selected row)**:
- roll-forward expanded: `opening + Σmovements = computed`, listing the contributing JEs
  (links back to Audit event lineage, reusing existing drill-down).
- three-way comparison card: book vs statement vs chain, differences shown explicitly.
- **DispositionControls** (**reuses** the Exception component/ritual): only material breaks
  require disposition; user selects `reasonCode` (+ note when `OTHER`), state-machine
  buttons; **anchored period → whole workspace read-only** (reads `hasAnchoredSnapshot`:
  controls hidden + backend 409, double-guard).

**③ Empty / celebration state**: all balanced → reuse Exception "clear-seas" celebration.

**④ Close gate visual**: header summary pill `material breaks: N`; when open material
breaks exist, surface the "blocks close" hint consistent with Exceptions (the shell-level
GuardrailBanner also carries recon blockers).

Interaction details (from Audit/Exception lessons):
- entity switch → reset selected row (selection-leak guard).
- per-row JE balance throw → isolate to that row's error cell, do not blank the whole page
  (fail-loud but not page-crash).
- chain read via dapp-kit `SuiClient` (already in provider tree); in-flight → loading,
  error → unavailable.

## 6. Error Handling / Boundaries (red-team)

| Vector | Defense |
|---|---|
| Bypass UI, POST disposition on anchored period | backend `hasAnchoredSnapshot` → 409 |
| Forged / stale breakId pollutes store | re-validate against live `collectBreaks` → 404; strict `wallet\|coinType` parse |
| Impersonate operator, pollute append-only trail | `decidedBy` fixed server constant, never from client |
| Concurrent disposition overwrites terminal state / log-main inconsistency | `applyReconDisposition` atomic transaction |
| Client forges small break to slip past close | gate distrusts client; backend `collectBreaks` independently recomputes material breaks |
| Fixture missing row / non-numeric opening / dup coinType / decimal mismatch | schema-validated load, bad data throws; BigInt throughout, non-numeric throws |
| Chain live read fail / timeout / wallet unset | chain column `unavailable` fail-loud; **never fallback to 0** (would fake balanced) |

## 7. Testing

Rule 9 (test WHY not just WHAT) + test.md (Unit + Integration then Monkey).

**Backend** (`services/api`):
- `collectBreaks` unit: opening+movements=computed correctness; materiality boundary
  (`== threshold` is material); zero-JE asset movement = 0; disposition join correctness.
- disposition integration: state transitions; anchored → 409; forged breakId → 404; illegal
  transition → 409; atomicity (log and main table consistent).
- close gate integration: open material break → freeze 409 `RECON_BREAKS_BLOCKING`;
  all resolved/immaterial → pass; exception gate and recon gate coexist without
  swallowing each other.
- **Monkey**: negative opening; huge BigInt; coinType with odd chars; breakId injection
  `|`/`::`; concurrent double disposition; fixture missing row; threshold = 0.

**Frontend** (`web`):
- ReconTable: book recompute correctness (`origMemo` integration); provenance badges;
  break three-state encoding; chain n/a vs live vs unavailable.
- DispositionControls: appears only for material; reasonCode required; anchored read-only.
- entity switch resets selection (**genuine** test, not hollow — Audit lesson).
- per-row JE throw isolation does not crash page.
- **Monkey**: chain read reject; very long coinType; break value overflow display; empty recon.

**Gates**: tsc clean + `npm run build` exit 0 (build catches vite tsc errors `--noEmit`
misses) + all tests green. SDD per-task dual-verdict review + final opus whole-branch +
**dev-rules dual-review (codex --multi; core financial path mandates external review)**.

## 8. Deferred (YAGNI / §9-style)

- Multi-period roll-forward (opening from prior-period ending join) — single-period demo;
  opening from fixture.
- Live chain read for non-SUI assets (requires real holdings) — `n/a` for now.
- Materiality in functional currency (cross-asset comparable) — per-asset minor-unit
  threshold for now.
- Multi-wallet per entity beyond the demo set — fixture-driven.
- Reconciliation status as a Period Close Dashboard light (B1) — separate sub-project.

## 9. Reuse Inventory (no new where existing fits)

- `lib/balance.ts` `origMemo` — movement recompute (client + backend port).
- Exception `DispositionState` / `REASON_CODES` / state machine — disposition logic.
- Exception `DispositionControls`, "clear-seas" empty state — UI/ritual.
- `hasAnchoredSnapshot` — anchored read-only gate.
- Audit event lineage drill-down — JE contribution links.
- Shell `GuardrailBanner` — recon blocker surfacing.
- Existing snapshot freeze close-gate structure — append recon check.
