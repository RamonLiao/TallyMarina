# Export Workspace — Design Spec

**Date**: 2026-06-24
**Phase**: 1 C (first of three soon slots: export / policy / onboarding)
**Status**: Design revised after 3-review integration (sui-architect / senior accountant / frontend-design), pending user spec review
**Brainstorm decisions (with rejected alternatives)**: `tasks/notes.md` → "2026-06-24 — Phase 1 C：先做 Export"

---

## 1. Purpose

Give an entity's books a **verifiable, portable export**: one download that serves both
(a) feeding the journal into existing accounting/ERP software, and
(b) handing an auditor a tamper-evident bundle they can **independently verify, end to end**, against the on-chain anchor — CSV → leaf → Merkle root → chain.

This is the spine pay-off of the whole project: exported numbers are **client-recomputable** (no backend assertion in the trust path) and an **anchored merkleRoot** is the tamper-evidence. The browser produces and self-verifies the bundle; the backend never assembles it.

## 2. Scope

In scope:
- New `export` workspace (registry `soon` → `ready`).
- One additive backend change: expose `periodId` + `leafCount` on the existing `AnchorDTO` snapshot join (read-only; no bundle assembly — see §3). Everything else is pure frontend.
- A single ZIP download (see §5).
- ERP-import CSV: **one generic General Journal format only**.
- Verifiable audit bundle: canonical journal (CSV + JSON), per-account period activity, by-coinType quantity reconciliation, manifest with file hashes + on-chain anchor reference + **completeness assertion**, per-JE inclusion proofs, and a **client-recomputable leaf binding** (CSV/JSON → leafHash → root).
- Three verification layers (§6): L1 internal arithmetic, L2 leaf binding (NEW, closes the spine), L3 on-chain tamper-evidence + completeness.
- Verified vs UNVERIFIED-draft distinction driven by anchor state, surfaced as a full status-card treatment (§7) + a pre-download self-verification summary (§8).

Out of scope (deferred, stated honestly in UI/bundle — see §11):
- Named ERP formats (QuickBooks IIF / Xero / NetSuite). Generic CSV only.
- Opening/closing **balances** (this export ships period *activity*, not a balance-sheet trial balance — see §5.B, §11 D5).
- Backend trial-balance/parity endpoint (activity totals enforce no gate — §10 D1).
- Auth / per-user export permissions (global no-auth system; mock-until-auth, same as prior workspaces).
- Multi-period / multi-entity bundles in one ZIP. One entity + one period per export.
- Full resolved price/FX sidecar values (only the `priceRef`/`fxRef` **pointers** ship; resolved PricePoint/FxRate values deferred — §11 D6).

## 3. Architecture

**Frontend assembles & verifies; backend never assembles the bundle.** Reuses existing read endpoints, with **one additive change** (not a new endpoint, no assembly — see note):
- `GET /entities/:id/journal` → `JournalDTO[]` (each has `je: JournalEntryBody` (already parsed), `idempotencyKey`, `leafHash`, `eventId`).
- `GET /entities/:id/events` → `EventDTO[]`. **No `date` field** — date is read from `normalized.eventTime` (ISO; present in fixtures), else derived from `normalized.timestampMs`, else **fail-loud** (never blank).
- `GET /entities/:id/anchors?idempotencyKey=k` → `{ anchors: AnchorDTO[], inclusionProof: InclusionProof | null }` per call (per-JE; **no** bulk/period-filtered proof endpoint — see §6, §9).

**Additive backend change (the only backend touch):** `AnchorDTO` already joins `merkleRoot` from the anchored snapshot. Extend that same join to also expose **`periodId`** and **`leafCount`** (both already on `SnapshotDTO`). This is required because the completeness assertion (§6.L3) needs the chain-committed `leafCount`, and period→anchor resolution needs `periodId` — neither is otherwise reachable via a read path (the only other source, `POST /snapshot`, freezes as a side effect and must not be called from a read-only export). The backend still does zero bundle assembly; it merely surfaces two already-joined fields. Spine intact: every number in the trust path is still client-recomputed.

```
ExportWorkspace (landing)
  ├─ fetch journal + events + anchors            ← existing endpoints
  ├─ resolve the period's canonical anchor       ← snapshot.periodId join, latest non-superseded FROZEN (§6.L3)
  ├─ trialActivity(journal)  → per-account DR/CR totals + debits==credits invariant (fail-loud)
  ├─ quantityRecon(journal)  → per-coinType acquired/disposed/net
  ├─ encodeJeLeaf(JE) mirror → recompute leafHash, assert == JournalDTO.leafHash (L2, fail-loud)
  ├─ per-JE inclusion proof  → recomputeRoot == anchor.merkleRoot (L3, reuse proofVerify)
  ├─ self-verification summary → rendered BEFORE download (§8)
  └─ buildBundle → zipSync → download            ← fflate
```

Rationale for frontend assembly: maximally spine-pure — the browser independently produces the artifact and self-verifies it CSV→leaf→root→chain; the backend touches none of the bundle. (Rejected backend `GET /export` returning a zip — weakens spine to "trust the file the backend produced.")

## 4. Components

| File | Responsibility | Depends on |
|------|----------------|-----------|
| `web/src/workspaces/export/ExportWorkspace.tsx` | Landing: period select → status card (verified/draft, §7) → self-verification summary (§8) → download. Defined hierarchy: status card is the visual anchor, CTA subordinate, filename preview shown pre-click. | data hook, buildBundle, summary |
| `web/src/workspaces/export/buildBundle.ts` | Pure fn → `{ files: {name,content}[], verified, manifest, summary }`. **Returns `summary` display values (counts, totals, match flags), not just throws** — the UI renders them pre-download. No side effects. | trialActivity, quantityRecon, csv, leafEncode, proofVerify |
| `web/src/lib/trialActivity.ts` | `trialActivity(legs)` → per-account functional-currency (`amountMinor`) DR/CR totals + **debits==credits invariant (throws on imbalance, returns figures for the error UI)** + **amountMinor ≥ 0 invariant (throws on negative)**. | — |
| `web/src/lib/quantityRecon.ts` | `quantityRecon(legs)` → per-`origCoinType` acquired / disposed / net `origQtyMinor` (BigInt). | — |
| `web/src/lib/leafEncode.ts` | **Mirror of `services/rules-engine/src/core/leafCodec.ts`** — BCS-encode a JE to leaf bytes + hash to `leafHash`. **Byte-identical, pinned by a parity test (merge gate), exactly like the recon `netByCoinType` parity.** | `@mysten/bcs`, WebCrypto |
| `web/src/lib/csv.ts` | rows → CSV string. Escaping: values with `,`/`"`/newline quoted; CSV-injection prefixes (`= + - @`) prefixed with `'`. Numbers emitted raw (`1234.00`, no thousands separator, fixed scale). | — |
| `web/src/data/useExportData.ts` | Fetch journal + events + anchors; render-gate by entityId (store `{entityId, value}`, expose only on key match — per 2026-06-24 PCC stale lesson, not a post-commit effect). | existing fetch util |
| reuse `web/src/lib/proofVerify.ts` | Inclusion proof verify (existing): `resolveProofState` over `{leafHash, proof, anchors}`. | — |

New dependency: `fflate` (~8KB, `zipSync`). `@mysten/bcs` already present (dapp-kit transitive). Rejected hand-rolled ZIP/BCS.

### 4.1 JE data shape (verified against source)

`services/rules-engine/src/domain/types.ts`:
```ts
JeLine { account; side:'DEBIT'|'CREDIT'; amountMinor /*functional ccy, minor-unit string*/;
         origCoinType|null; origQtyMinor|null; priceRef|null; fxRef|null; leg }
JournalEntry { idempotencyKey; lineageHash; lines: JeLine[]; reversalOf: string|null }
```
- `/journal` rows = `{ id, entityId, eventId, jeJson, idempotencyKey, leafHash }`; `jeJson` parses to a `JournalEntry`. **No date on the JE** — joined via `eventId` → event. `functionalCurrency` + scale come from the policy set, passed into the export.
- **Leaf preimage** (`services/rules-engine/src/core/leafCodec.ts`, `JE_LEAF_BCS_V1`, FROZEN): BCS struct `{ idempotencyKey, reversalOf, lines:[{account, side:u8(DEBIT=0/CREDIT=1), amountMinor, origCoinType, origQtyMinor, priceRef, fxRef, leg}] }`. **Every one of these fields is leaf-load-bearing** → the bundle's canonical `journal.json` must carry them verbatim so the recipient can recompute the leaf. (This also satisfies the auditor's `reversalOf`/`priceRef`/`fxRef` traceability asks.)
- Reversal entries (`reversalOf != null`) are real legs, appear in both CSVs, and net out in activity totals — correct.

## 5. Bundle contents

A single `.zip`. Filename:
- verified: `export-{entityId}-{periodId}.zip`
- draft: `export-{entityId}-{periodId}-UNVERIFIED-DRAFT.zip`

Every CSV opens with a **book-header block** (commented lines): entityId, periodId, functionalCurrency, reporting basis (IAS38 cost), policySetVersion (if available), generatedAt — so a CSV opened outside the ZIP keeps its context.

Files:

**A. `journal.csv`** — ERP-import General Journal, one row per leg. Columns:
`date, reference, reversalOf, account, leg, debit, credit, currency, origCoinType, origQtyMinor, priceRef, fxRef`.
- `date` from the event (`eventId` join). **Missing event → fail-loud** (abort bundle; never blank a date silently).
- `reference` = JE `idempotencyKey`; `reversalOf` = the reversed JE's reference (blank on normal rows).
- `debit`/`credit`: `amountMinor` formatted at the functional-currency scale, placed by `side`. **`amountMinor` ≥ 0 invariant** — direction is carried only by side; a negative figure is fail-loud (would corrupt ERP import).
- `leg`/`origCoinType`/`origQtyMinor`/`priceRef`/`fxRef`: provenance; null-origin legs (e.g. receivable settlement) leave coin columns blank.

**B. `account-activity.csv`** — per-`account` totals of functional-currency `amountMinor` (debit column / credit column), computed client-side. **This is period *activity* (movement totals), NOT a balance-sheet trial balance** — it has no opening/closing balances. Header and §6.L1 say so explicitly. Debits total == credits total is the L1 invariant.

**C. `quantity-recon.csv`** — per-`origCoinType`: acquired (Σ debit origQty), disposed (Σ credit origQty), net. Lets the auditor tie asset *quantities* (the crypto-subledger existence/completeness starting point) to on-chain wallet balances; a USD-balanced journal can still hide a missing disposal in quantity terms.

**D. `journal.json`** — the canonical `JournalEntry[]` exactly as fetched (BCS leaf preimage source). The recipient recomputes each `leafHash` from this (L2). CSV is for humans/ERP; JSON is for cryptographic recompute.

**E. `manifest.json`**:
```jsonc
{
  "entityId": "...", "periodId": "...", "generatedAt": "<ISO, client clock — see M-note>",
  "leafCodecVersion": "JE_LEAF_BCS_V1",
  "files": [{ "name": "journal.csv", "sha256": "..." }, ...],   // EXCLUDES manifest.json itself
  "completeness": { "bundledJeCount": N, "anchoredLeafCount": M },  // verified: N must equal M
  "verified": true,
  "anchor": {                       // present iff verified-onchain
    "merkleRoot": "0x...", "snapshotId": "...",
    "digest": "...", "explorerUrl": "..."     // real AnchorDTO field names
  },
  "inclusionProofs": [              // present iff verified; real InclusionProof shape:
    { "idempotencyKey": "...", "leafIndex": 0, "siblings": [{ "hash": "0x..", "position": "L|R" }], "merkleRoot": "0x.." }
  ]
}
```
Unverified (draft): `"verified": false`, `"reason": "period not anchored"`, **`"anchor": null`**, no `inclusionProofs`, `completeness.anchoredLeafCount: null` (no placeholder — fail-loud).

**F. `VERIFY.md`** — recipient guide, written for a **non-technical auditor**, three numbered steps with a "you don't need to understand Merkle trees" framing:
1. Recompute `account-activity.csv` from `journal.csv` → debits == credits.
2. Recompute each leaf from `journal.json` (recipe + the frozen BCS field order) → compare to the proof's leaf → fold siblings to `merkleRoot` → confirm `merkleRoot` equals the value on-chain (paste the `digest` into the linked explorer). A self-contained verifier (static HTML/script) ships or is linked so the auditor need not run TypeScript.
3. Confirm completeness: `bundledJeCount` == `anchoredLeafCount` (the bundle is the *whole* period, not a subset). **States plainly: inclusion proofs prove existence + integrity, leaf count proves completeness; the client recompute means none of this trusts the exporter.** Draft bundles open with an UPPERCASE warning: not anchored, not tamper-evidence.

## 6. Verification spine (three layers)

- **L1 — internal arithmetic**: `account-activity.csv` recomputed from `journal.csv`; debits total == credits total (movement balance). Imbalance / negative amount → fail-loud, no bundle.
- **L2 — leaf binding (NEW; closes the CSV↔chain gap)**: for each JE, `leafEncode` recomputes `leafHash` from `journal.json` content and asserts it equals the `leafHash` the proof folds from. Without this, journal content and the anchored leaves are connected only by backend assertion. The web encoder is **byte-identical to `leafCodec.ts`, pinned by a parity test (merge gate)**.
- **L3 — on-chain tamper-evidence + completeness**: each inclusion proof folds to a root; assert `proof.merkleRoot == anchor.merkleRoot` (proofVerify only checks proof-internal consistency + membership in `anchors[]`, so this cross-check is explicit). The period's anchor is resolved by joining `snapshot.periodId` and picking the **latest non-superseded FROZEN** snapshot (`AnchorDTO` has no `periodId`; `getAnchors` returns all entity anchors). Ambiguous/superseded → fail-loud, never silently bind to a stale root. **Completeness**: `bundledJeCount` must equal the anchored snapshot's leaf count (`anchoredLeafCount`); inclusion proofs prove existence, only the count proves nothing was dropped.

Only **`verified-onchain`** (root present in `anchors[]`) earns a verified bundle. `verified-pending` (proof valid but anchor not yet confirmed on-chain) folds into **draft** — we cannot populate `digest`/`explorerUrl`, so we do not claim verified.

## 7. Verified vs Draft — full status-card treatment (anchor-state driven)

Export is **always allowed** (read-only, writes nothing, enforces no gate; a LOCKED-only gate adds no integrity benefit and blocks the legitimate "peek mid-period" case). The distinction is a **full-surface, multi-axis, non-color** treatment of the status card (reusing existing `close.css` / `base.css` vocabulary — NOT a button-side badge, which is too weak for the page's most consequential fact):

- **Verified** → austere navy card (`.austere`, `--ink` bg, `--austere-mono`), merkleRoot in `--font-mono` with an `.aqua-link` to the explorer (the project's established "on-chain provenance = austere navy + aqua" language). Reads as a sealed, signed object. Glyph: seal/lock.
- **Draft** → cream `.card` with **dashed border** (`.light--mock` "not real" convention) + `.light--red` inset severity border + an explicit mono "NOT TAMPER-EVIDENT" line. Glyph: unlock.

Distinction survives grayscale / B&W print / screenshots via three non-color axes (texture: solid-navy vs dashed-cream; structural: inset border; content: merkleRoot present vs absent). Bundle-side watermarks (the artifact leaves the system) live in **four** places: filename suffix, `manifest.verified=false`, `VERIFY.md` warning, and the UI card treatment.

## 8. Pre-download self-verification summary (required)

`buildBundle` returns a `summary`; the UI renders it **inside/under the status card before the user clicks download** — this is the product's entire differentiation made visible (and it's free; every value is already computed). Non-color pass glyphs + mono tabular-nums:
- `N journal entries · K legs`
- `Debits = Credits ✓  (12,340.00 USD)` — both totals shown equal.
- verified only: `merkleRoot 0x1a2b… matches on-chain anchor ✓` (aqua-link).
- verified only: `N leaves recomputed & bound ✓` (L2) · `N inclusion proofs verified in-browser ✓` (L3) · `bundledJeCount N = anchoredLeafCount N ✓` (completeness).

## 9. Error handling / fail-loud

- L1 imbalance or negative amount → **designed error state**, not a generic toast: replace the status card with a `.light--red` card "Cannot export — books do not balance," show actual debit vs credit figures side by side in mono with the delta, CTA disabled (`.btn-primary:disabled`). Fail-loud made legible.
- L2 leaf mismatch / L3 root mismatch / ambiguous-or-superseded anchor / missing event date → fail-loud, no bundle emitted (a half-built evidence bundle is worse than none).
- Per-JE proofs are **N sequential fetches** (no bulk endpoint). Any proof fetch failing/`null` in a would-be-verified bundle → **fail the whole verified bundle** (no partial proof set); fall back to draft only if the period is genuinely unanchored, not on transient fetch error (surface the error instead). This N-fetch cost is the real perf risk for the large-journal monkey test (§12), above ZIP size.
- Unanchored → draft path (§7), `merkleRoot`/`anchor` null, never a placeholder.
- **Empty period**: an empty journal in a valid period is a legitimate **nil return**, not an error — show the mascot empty state (§ below), offer a header-only "nil" bundle or a clear "nothing to export" message; distinguish from the imbalance error.
- Entity switch → render-gate by entityId (§4 data hook), per the PCC stale-data lesson.
- merkleRoot/hash strings in the UI: `overflow-wrap:anywhere` / horizontal scroll, **never truncate** (truncating a hash is an integrity lie).

Empty/landing chrome may use the otter mascot (sanctioned in empty states, `base.css` §8.4) — never on data surfaces.

## 10. Decisions & rejected alternatives (rationale preserved)

- **D1 — activity totals are frontend-only, no backend parity test.** The recon parity test earns its keep because the backend number **enforces a gate** (blocks freeze); divergence would mean "user sees one number, gate uses another." Activity totals enforce no gate; integrity comes from the debits==credits self-check + recipient recompute. Enforcement-grade parity for a non-enforcement artifact is overengineering (Rule 2). (Note: the *leaf encoder* `leafEncode.ts` DOES get a parity test — because it must be byte-identical to the on-chain leaf, which is a correctness boundary, unlike activity totals.)
- **D2 — generic CSV only.** Vendor schemas are a maintenance trap; demo overkill. (YAGNI.)
- **D3 — frontend assembly, not backend `GET /export`** (spine purity, §3).
- **D4 — export not gated on LOCKED** (read-only; verified/draft flag already communicates evidentiary status).

## 11. Deferred (honestly labeled in UI/bundle)

- **D5 — opening/closing balances**: ships period activity only; a true balance trial balance needs prior-period anchored balances or genesis. VERIFY.md + `account-activity.csv` header state this.
- **D6 — resolved price/FX values**: only `priceRef`/`fxRef` pointers ship (they're leaf fields); resolved PricePoint/FxRate sidecar values deferred.
- Account **name** (only the single `account` identifier ships; code↔name mapping deferred — labeled).
- Full IAS38 measurement/track disclosure (amortisation/impairment/reval breakout beyond the `leg` label).
- Named ERP formats; auth/permissions; multi-period/multi-entity; self-contained offline verifier polish.

## 12. Testing

- Pure-fn unit tests (encode WHY, per Rule 9): `trialActivity` (imbalance → throws with figures; negative amount → throws), `quantityRecon`, `csv` (injection escaping, raw number format), `buildBundle` (verified vs draft manifest differs: anchor present/null, proofs present/absent, completeness count; draft filename carries UNVERIFIED).
- **`leafEncode` parity test (merge gate)**: web encoder bytes == `leafCodec.ts` bytes over shared golden JEs — byte-identical, mirrors recon `recon.parity.test.ts`.
- Inclusion proof: reuse existing `proofVerify` tests; add the `proof.merkleRoot == anchor.merkleRoot` cross-check and the period→anchor resolution (superseded/ambiguous → fail-loud).
- **Monkey** (test.md): empty period (nil vs error), single-legged/imbalanced JE, negative amount, memo/account with `,"`\n` + `=cmd` injection, unanchored period, missing event, missing/`null` proof (transient vs unanchored), superseded snapshot, very large journal (N-fetch perf + no silent truncation), leaf-preimage field tampering (recompute must catch).

## 13. Verification criteria (definition of done)

- web test suite green + `npm run build` exit 0; `leafEncode` parity test green.
- A verified bundle: activity recomputes balanced; every leaf recomputes and binds (L2); every proof folds to `anchor.merkleRoot` (L3); `bundledJeCount == anchoredLeafCount`; a sample verified in-browser; self-verification summary matches manifest.
- A draft bundle (unanchored): four watermarks present, `anchor:null`, no false claims.
- Dual-review (dev-rules): codex round 1 + project-rules round 2, integrated. Core artifact (evidence bundle) → external review mandatory.
