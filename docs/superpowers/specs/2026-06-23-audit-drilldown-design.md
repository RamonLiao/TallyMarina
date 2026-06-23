# Audit Workspace — Event 並列下鑽 (Phase 1 A-2) Design

**Date:** 2026-06-23
**Status:** Design (3-review integrated: sui-architect / 資深加密會計師 / frontend-design)
**Fills:** Workspace Shell `'audit'` 🔍 slot (Phase 1 A workspace tier)
**Depends on:** Phase 0 Workspace Shell, Phase 1 A-1 Exception Queue (component reuse), existing rules-engine + snapshot + anchor read paths.

---

## 1. Overview & Scope

A **read-only forensic walkthrough** workspace. An auditor/accountant picks an event and sees its full lifecycle — raw on-chain data → AI classification → journal entry → on-chain anchor proof — laid out so each stage's *why* is inspectable. Multi-select switches the right pane to a side-by-side **Compare** mode for control-consistency sampling.

This is **not** an exception triage tool (that is A-1 Exception Queue) and does **no** dispositions/writes. Its bar is deliberately *higher* than triage: a triage tool may trust the backend; a forensic walkthrough, by definition, must not.

### 1.1 The spine principle (drives every evidence decision)

> **Anything presented as audit evidence must be independently recomputable / inspectable in the client, or explicitly labeled as a backend assertion.** A green check the auditee's own backend produces is not evidence.

Concretely: the inclusion proof is **recomputed in the browser**, not rendered from a backend boolean (§6). Pointers (`priceRef`/`fxRef`/`leg`) are resolved to values where possible, else labeled "unresolved pointer" — never shown as if authoritative.

### 1.2 Backend claim (corrected by sui-architect C-1)

Original "0 new backend" is **false** and downgraded to:

> **0 new endpoints, 1 enriched DTO field.**

`AnchorDTO` gains a `merkleRoot` field (`anchor.snapshotId → snapshot.merkleRoot`, a 1-line join in the existing `GET /entities/:id/anchors` map). This single field unlocks BOTH honest seq-pinning AND client-side proof↔on-chain matching (§6). No new endpoint, table, or migration. The alternative (a snapshot GET endpoint) is strictly more invasive and **rejected**.

---

## 2. Architecture & Data Joins

### 2.1 Read paths (all exist except the one DTO field)

| Data | Source | Hook |
|---|---|---|
| Events (normalized / ai / final / status / routing) | `GET /entities/:id/events` | `useEvents(entityId)` |
| Journal entries (eventId, idempotencyKey, leafHash, je{lines,lineageHash,reversalOf}) | `GET /entities/:id/journal` | `useJournal(entityId)` |
| Anchors + inclusion proof | `GET /entities/:id/anchors?idempotencyKey=` | `useAnchors(entityId, idempotencyKey?)` |

### 2.2 Join chain

```
event ──(journal.eventId === event.id)──▶ JE[] ──(je.idempotencyKey)──▶ inclusionProof + anchor
```

- **JE↔event is 1:N** (sui-architect I-2): `run-rules` can emit multiple JEs per event, each with its own `idempotencyKey`/`leafHash`. Lineage column ③ renders **N JE rows**, and proof/anchor lookup is **per-idempotencyKey, not per-event**.
- **Anchor binding** (sui-architect C-1): match `inclusionProof.merkleRoot === anchor.merkleRoot` (new field) → `anchor.seq`. Never show `anchors[0].seq` / "latest anchor" next to a JE — that is the fail-open lie.

### 2.3 Three proof states (sui-architect I-1, accountant 1.3) — MUST be distinct

1. **Verified & on-chain** — proof recomputes to `merkleRoot` AND some `anchor.merkleRoot === merkleRoot` → show seq/digest/explorer.
2. **Verified, pending anchor** — proof recomputes but no anchor matches the root yet (frozen/proven, not on-chain).
3. **Not in current journal** — `inclusionProof === null` (the API already returns null when the idempotencyKey isn't in the live journal, e.g. JE was reversed). Distinct from "pending anchor"; do **not** collapse.
4. (failure) **Mismatch** — proof does not recompute to the claimed root → loud error.

### 2.4 Read/write boundary (sui-architect M-2, confirmed clean)

Workspace imports **only** the three query hooks; never `usePrepareAnchor`/`useConfirmAnchor`/`useSnapshot`/`useDisposition`. No PTB, no wallet, no cap/owned-object construction. Cap/chain object ids appear only as display strings. Architecturally zero write/upgrade risk.

### 2.5 Perf note (sui-architect I-3, non-blocking)

`useAnchors(entityId, key)` re-fetches the full anchor list + recomputes the full server-side merkle tree per call. In Compare (N events × M JEs) this fans out. MVP-acceptable; mitigate by fetching the anchor list once (`useAnchors(entityId)` no key) and proofs separately if it bites. Documented, not silently ignored.

---

## 3. Components & State Machine

```
AuditWorkspace
├── selection state: { mode: 'lineage' | 'compare', selectedId, compareIds[] }
├── EventList (left rail)         — filter status/type, single-click=lineage, checkbox=compare
└── right pane (one space, two modes):
    ├── EventLineage   (single)   — 4-stage walkthrough
    └── EventCompare   (2..4)     — dimension matrix
```

**Mode derivation (pure, code not model — Rule 5):**
- `compareIds.length >= 2` → `compare`
- else if `selectedId` → `lineage`
- else → pick-one EmptyState
- deselect compare down to 1 → flips to `lineage` on that one.

`AuditWorkspace` owns selection; children are presentational. Reuses `ExceptionsWorkspace` list/detail skeleton near-verbatim (frontend M, I-4).

---

## 4. EventLineage — the 4 stages

Reading order = causal order. Each stage is a `--paper-card` EXCEPT stage ④ (austere navy — see §8). Per accountant review, each stage carries more than the naïve proposal:

### ① Raw Event (`normalized`)
- Normalized payload key/values; **event/transaction timestamp** surfaced (accountant 1.4 — needed to compare against rate timestamps).
- If `normalized` carries the source tx digest → link to explorer (accountant 3.3) — the *source* tx, distinct from the *anchor* tx in ④.

### ② AI Classification (`ai`)
- `eventType` / `purpose` / `confidence` (via `ConfidenceBar`, **compact variant** — frontend C-2) / `reasoning`.
- Labeled as **AI opinion / backend assertion** (spine principle) — confidence is not evidence.
- AI model/prompt version → **deferred** (§11, schema add).

### ③ Journal Entry (`je`) — reuse `JournalTable`
- N JE rows (1:N). Per JE: lines (account/side/amountMinor/origCoinType/origQty/priceRef/fxRef).
- **1.1 Balance footer (MVP must):** per JE `Σ DR / Σ CR / Δ` in **functional currency**, red if Δ≠0. `origCoinType` subtotals shown separately, labeled **memo** (won't net).
- **1.5 Reversal/restatement (MVP must):** header badges `REVERSAL OF → JE-X` (from `reversalOf`) and reverse index `REVERSED BY ← JE-Y` (computed by scanning journal for `reversalOf === this.id`). Both navigable.
- **1.2 Rule id@version (Plan-stage investigate):** the rule that mapped this event, **as-of-posting**. Plan stage checks whether `je.leg` / rules-engine output retains it. Readable → show; not retained → UI labels "rule version as-of-posting not retained" (never show *current* rule as authoritative — the A-1 §2.1 trap). Deferred if absent.
- **1.4 priceRef/fxRef resolution (Plan-stage investigate):** resolve refs to `rate · as-of <ts> · source`. Plan stage checks if values live in `leg`/`normalized` (client-resolvable) or need backend. Resolvable → show; else label "unresolved pointer" + defer.

### ④ On-chain Anchor (austere) — reuse `HashChain` idiom
- `leafHash`, `idempotencyKey`, and **1.6 `lineageHash` (MVP must)** — the cryptographic binding of ①②③; shown prominently with a note on what it commits.
- **§6 client-verified inclusion proof** + three-state badge (§2.3).
- Matched `anchor.seq` / `digest` / `explorerUrl` only in state-1; states 2/3/mismatch render their own copy (no fake seq).

---

## 5. EventCompare — control-consistency matrix

Triggered by multi-select (2..4). Dimensions are **rows** (sticky left header), events are **columns**. A differing cell lights up across its row.

**Compare dimensions (accountant 3.1 — reframed from cosmetic to audit-useful):**
- AI eventType / confidence band
- **account-set** (did same-type events map to the same accounts?)
- **rule id@version** applied (control consistency) — subject to 1.2 availability
- **balanced?** (Δ=0 per JE)
- **anchor-status** (verified-on-chain / pending / not-in-journal)
- ~~JE leg count~~ (dropped — near-meaningless)

**Diff encoding (frontend I-2, non-color dual-axis, zero new token):**
1. `1.5px solid var(--brass)` left-border on differing cell (NOT red fill — red `--debit` is semantically "debit side" here).
2. `Δ` mono glyph prefix + SR-only `differs from event 1`.
3. optional `font-weight:600` on the differing value.

**Cap = 4, legible (frontend I-3, Rule 12):** 5+ selected → header caption `Comparing 4 of 7 selected · +3 more not shown`. No silent truncation of audit data.

**Column header → lineage (frontend M-2):** real `<button aria-label="Open lineage for event X">`, brass hover (not `.aqua-link` — reserved for on-chain §8.1). Whole column NOT clickable.

---

## 6. Client-side Inclusion Proof Verification (the spine, accountant 1.3)

The product's tamper-evidence claim. The data is all present: `InclusionProof{leafHash via JE, leafIndex, siblings[], merkleRoot}` + `AnchorDTO.merkleRoot` (new) + `digest`.

**In the browser:**
1. Recompute root from `leafHash` + `siblings` (RFC6962 domain-sep, odd-promote — reuse the existing `merkle.ts` verify logic from rules-engine; do NOT trust a backend boolean).
2. Assert `recomputed === inclusionProof.merkleRoot`.
3. Assert some `anchor.merkleRoot === inclusionProof.merkleRoot` → that anchor's on-chain `digest`/`seq`.
4. Render each step's hashes (inspectable) + "copy proof JSON" for independent re-verification (seeds the future workpaper export, §11).

Map result to the three states (§2.3) + mismatch. **No single green check** collapsing these.

---

## 7. Responsive Strategy (frontend C-1)

4 horizontal columns die below ~1100px (JournalTable + ConfidenceBar floor). Tiered, additive to the existing `base.css` `@media(max-width:768px)` stack-push machinery (same `!important`-over-inline-flex caveat the file documents):

| Width | List rail | Lineage | Compare |
|---|---|---|---|
| **≥1280** | 320px fixed | 4-col weighted grid `minmax(220,1fr) minmax(280,1.1fr) minmax(300,1.4fr) minmax(260,1.2fr)`, `→` arrows, brass spine | up to 4 cols, sticky row-headers |
| **960–1280** | 320px fixed | **2×2 grid** (raw→AI top, JE→chain bottom), arrows on row breaks | 2–3 cols + cap notice |
| **<960** | collapses; selecting pushes pane full-width + `‹ Events · N` back-btn (reuse `.exceptions-back-btn`) | **vertical stacked accordion** raw→AI→JE→chain, `↓` arrows, collapsible stage headers (default expanded) | dimension-major; each event a labeled sub-block |

JE column keeps its internal `overflow-x:auto`; the lineage container itself never relies on horizontal scroll (a11y/discoverability trap).

---

## 8. Visual Design & Mascot Governance

- **§8.4 HARD RULE — DATA zone, zero mascot** across ALL Lineage + Compare surfaces. Every new Lineage/Compare file carries the banner comment `// DATA ZONE (spec §8.4) — NEVER import Mascot here.` Read-only ⇒ no copilot/suggestion zone ⇒ no mascot anywhere in the right pane. (Confidence display ≠ copilot dock.)
- **Only mascot-allowed spot:** empty-entity `EmptyState` (chrome). Reuse it (`variant="pick-one"` for select-an-event; sailing variant for empty entity) — it gates the mascot internally.
- **The signature moment (frontend I-1):** ①②③ are warm `--paper-card` with **Fraunces/display** stage headers (mono only for digest contexts); ④ is navy `.austere`. The cream→navy jump *is* the "paper ledger becoming permanent record" signal — **do not soften** it by tinting earlier columns toward navy.
- **Brass = the audit thread** (coherent through-line): list rail "in compare basket" border, lineage brass spine, ConfidenceBar threshold tick, Compare `Δ` markers.
- **`--aqua`/`.aqua-link` strictly on-chain semantics (§8.1)** — never decorative in ①②③.
- **Flow arrows:** reuse HashChain's exact `→` mono arrow (rotate `↓` on stacked), `aria-hidden` (DOM order encodes causality for SR).
- **Filter controls (frontend M-4):** status/type chips on the `Badge` primitive + `aria-pressed` brass active — NOT a native `<select>` (reads generic-admin).
- **Reduced motion:** any staggered column reveal via CSS transitions only (global `@media(prefers-reduced-motion)` kill-switch covers it).
- **Maritime/ledger copy register:** "awaiting classification", "not yet posted", "not yet anchored", "‹ Events", "Clear seas" — terse maritime-bookkeeping voice, free differentiation.

### Generic-AI risk lifts
cream→navy on-chain boundary (no crypto app looks like aged paper) · brass `Δ` = auditor's margin annotation (not Excel conditional formatting) · HashChain arrow rhyme makes lineage read as one continuous chain to block.

---

## 9. Edge / Pending / Error States (frontend I-5, fail-loud Rule 12)

- **Unclassified** (`ai === null`) → AI stage: dim `◌` + mono `awaiting classification` (`--ink-soft`).
- **Unposted** (no JE for event) → JE stage: `not yet posted`.
- **Unanchored** (proof state 2) → chain stage: `not yet anchored` (`--austere-dim`, mirror HashChain's "No anchors yet.").
- **Reversed / not-in-journal** (proof state 3) → chain stage: distinct copy, link to the JE that lives.
- **Proof mismatch** (state 4) → loud red error, never silent.
- **Pending rows in list** → dim `◌` glyph + trailing `pending` mono tag; selectable, NOT disabled-looking.
- **Empty entity** (no events) → EmptyState (chrome, mascot OK).
- **Compare >4** → legible cap notice (§5).

---

## 10. Testing (test.md mandatory: unit + integration + **monkey**)

- **Unit:** mode derivation (single/multi/deselect-to-1); list filter (status/type); join (event→JE[] 1:N; per-idempotencyKey proof lookup); **balance computation** (Δ in functional ccy, origQty as memo); reversal reverse-index scan; **client merkle recompute** (verify/mismatch) — tests encode WHY (Rule 9): a proof that recomputes wrong MUST fail the test.
- **Integration:** single-select renders 4 stages incl. balanced JE + verified proof + seq; multi-select renders matrix + brass/Δ diff on the right cells; column-header → lineage; three proof states render distinctly.
- **Monkey (test.md):** events missing ai/je/anchor (all pending permutations); 1:N many JEs per event; huge event count (list virtualization/perf); rapid select/deselect/compare toggling; Compare cap (5,6,…); malformed `normalized` payload; proof with tampered sibling (must show mismatch, not green); JE with `reversalOf` pointing at missing id; multi-currency JE that balances in functional but not origQty.

---

## 11. §9 Deferred (recorded, NOT silently skipped — Rule 12 / A-1 §9 style)

**Plan-stage investigations (do-if-readable, else defer):**
- **1.2 rule id@version (as-of-posting):** check `je.leg` / rules-engine output retention. Absent → label + defer.
- **1.4 priceRef/fxRef → rate/ts/source:** check `leg`/`normalized`. Backend-resolution-required → defer.

**Deferred (accountant Tier-2 / Tier-3):**
- **Authorization/approval trail** (maker/checker on posting; `decidedBy`/`approvedBy` + ts) — blocked on identity system (same blocker as A-1 §9.3).
- **Period attribution** — events have no `period_id` (A-1 §9.1 root cause); Compare/lineage can't group/filter by period yet.
- **Anchor finality / confirmation depth** — settled-vs-pending beyond the 3-state model.
- **AI model/prompt version provenance** — `EventAi` schema add.
- **Workpaper export** (signed/timestamped PDF/JSON of 4 columns + proof) — seeded by §6 copy-proof-JSON.
- **3.2 idempotency-collision visibility** / **3.3 already covered as MVP source-link**.

**Recorded product decision (deferred consolidation):** A-2 fills the `'audit'` slot now; the Phase-2 "Audit lineage → Sui digest" reverse entry-point *extends this same workspace*, not a new slot. No `'events'`/`'drilldown'` workspace id added (YAGNI). If a genuine need later arises to split "browse events" from "reverse-lookup a digest", split then.

---

## 12. Implementation order (for writing-plans)

1. **Backend (tiny):** add `merkleRoot` to `AnchorDTO` + the `listAnchors` join + type. Test.
2. **Client proof verify util** (reuse merkle.ts) + three-state model + tests.
3. **AuditWorkspace + EventList** (reuse Exceptions skeleton, multi-select, filters, pending).
4. **EventLineage** stages ①②③④ (reuse JournalTable/HashChain/ConfidenceBar-compact; balance footer; reversal/lineageHash; 1.2/1.4 per investigation).
5. **EventCompare** matrix + diff encoding + cap.
6. **RWD** tiers + register `'audit'` workspace as `ready`.
7. Monkey suite.

Each task: unit+integration+monkey, dual-review gate per dev-rules.
