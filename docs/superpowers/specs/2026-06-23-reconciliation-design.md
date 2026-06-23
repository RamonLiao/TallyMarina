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

### Row key set — two-directional (book ∪ statement)

Rows are the **union** of book-side keys (assets with opening or JE movements) and
statement-side keys (assets present in the mock statement). A statement-only asset (one
the ledger never recorded) surfaces as a row with `computed = 0` and a nonzero break — so
"missing book item" is visible, not silently dropped. A reconciliation anchored only on
book keys is one-directional and can report "balanced" while genuinely missing items;
unioning the key sets makes it two-directional.

### Three balance sources per row

| Column | Source | How obtained | Provenance |
|---|---|---|---|
| **computed ending (book)** | `opening + Σ movements` | opening from backend fixture; movements recomputed **client-side** from real JE legs via `origMemo(coinType)` | `book` (recomputable) |
| **statement ending** | mock external/custodian statement | backend fixture | `mock` (labeled) |
| **chain ending** | actual on-chain balance | **SUI only**: client `SuiClient.getBalance(realWallet, 0x2::sui::SUI)` read in browser; other assets `n/a` | `live` (explorer-verifiable) |

### Cutoff (period predicate)

Both the movement set and the statement are scoped to the period. Single-period demo: events
carry no `period_id` (known sharp edge — see Exception Queue notes), so the cutoff is
**entity-scoped over `DEFAULT_PERIOD`** — all of the entity's JEs belong to the one period.
Multi-period (date-bounded cutoff, in-transit roll across periods) is deferred (§8) and the
predicate is stated explicitly so the single-period gate doesn't silently drift when
multi-period lands.

### Breaks — signed, with direction

- **primary break** = `computed − statement` (deterministic). Drives materiality + close gate.
  The break is carried and displayed **signed**, with an explicit direction label:
  `computed > statement` → "book over statement" (book over-stated / statement missing a
  credit); `computed < statement` → "statement over book" (unrecorded book item /
  statement-only entry). Direction is the most diagnostic field for root-causing a break —
  the UI must never reduce it to a bare magnitude.
- **chain break** = `computed − chain` (SUI only, **informational**). Live balance drifts
  between read and freeze, so it must NOT enter the close gate. "Informational" ≠ ignorable:
  if `|chainBreak| ≥ threshold` it is **flagged for investigation** (book or statement is
  wrong) — surfaced, just not gated.

### Movement control totals

The detail shows, alongside the net movement, a control total: `Σ debits`, `Σ credits`,
and JE leg count for the period. An auditor cannot accept `opening + net = computed` as
evidence without seeing the net tie to a count/control total — if `origMemo` drops or
double-counts a leg, the roll-forward still balances internally and the break gets
misattributed to the statement.

### Materiality

Each row carries a `thresholdMinor` (asset minor units) from the recon fixture (curated).
- `|primaryBreak| ≥ threshold` → **material (blocking)**
- `0 < |primaryBreak| < threshold` → immaterial (shown, not blocking)
- `primaryBreak == 0` → balanced ✅

Boundary: `== threshold` counts as material (≥, not >). `threshold == 0` means zero-tolerance
(every nonzero break is material) — a valid, documented setting.

Per-asset absolute minor-unit threshold is a deliberate simplification; its accounting
limitations (no functional-currency aggregation, absolute not % of balance, no cumulative
uncorrected-misstatement carryforward) are disclosed in §8.

## 3. Data / Fixtures

New backend fixture `services/api/src/fixtures/acme-pilot-001.recon.json`: per
`(wallet, coinType)` provides `{ openingMinor, statementMinor, thresholdMinor, decimals }`.

Demo data design (covers each model branch):
- **SUI**: `opening ≠ 0` + real JE movements + statement with a small curated diff
  (controlled material break) + chain live read (the liveness beat).
- **USDC**: opening from fixture, book movement `= 0` (no JEs), statement crafted to produce
  a controlled **material error** break, chain `n/a`.
- **An in-transit asset** (e.g. WETH): a break classified `in-transit` — a legitimate
  reconciling item expected to clear next period, demonstrating "reconciling item" vs "true
  break" (resolved-and-tracked, **not** dismissed as noise).
- **A statement-only asset**: present in the statement, no book row (`computed = 0`) →
  surfaces a break via the key union (§2), proving the two-directional check.

Sign convention: opening/statement/movements all use **asset-positive** convention. The
fixture schema asserts `openingMinor ≥ 0`, `statementMinor ≥ 0`, `thresholdMinor ≥ 0`
(a credits-negative statement would silently invert breaks).

`realWallet` (for live read): the fixture wallet `0xacmeTreasury` is fictional, so the
real testnet address is supplied via config/env `RECON_LIVE_WALLET` (default: the
connected demo treasury). If unset/unreadable → chain column shows `unavailable`
(fail-loud), never a silent `0`.

Fixture loading is schema-validated: bad/missing rows, non-numeric minors, duplicate
coinTypes, or decimal mismatches **throw** (no silent coercion). All arithmetic is
BigInt (minor-unit strings, never float).

## 4. Backend

New module `services/api/src/reconciliation/` (mirrors `exceptions/`):

- `types.ts` — `ReconRow`, `ReconBreak`, provenance enum, `RECON_REASON_CODES`.
- `movement.ts` — `netByCoinType(jes): Record<string, bigint>` (debit qty − credit qty per
  coinType, BigInt). This is the **canonical netting**, ported from `web/src/lib/balance.ts`
  `origMemo`. ⚠ **This is a re-implementation, not a shared import** — `web` and
  `services/api` are separate packages and `origMemo` is web-only over `je_json` blobs. Since
  the backend copy IS the close-gate enforcement, divergence (sign, missing-leg skip, BigInt
  edge) would silently make the gate disagree with the operator's screen. **Mitigation
  (mandatory merge gate)**: a parity test feeds identical JE fixtures to both `origMemo` and
  `netByCoinType` and asserts byte-identical `Record<string,bigint>`. The hybrid's
  anti-forgery integrity rests entirely on byte-identical recompute (§9).
- `collect.ts` — `collectBreaks(db, entityId, periodId)`: recompute-on-read (same pattern
  as `collectExceptions`). Reads recon fixture (opening/statement/threshold) + recomputes
  movements via `netByCoinType` over `listJournal` (entity-scoped cutoff, §2). Row keys =
  **union** of fixture keys and book keys (§2). Per row → `computed = opening + Σmovements`
  → `primaryBreak = computed − statement` (signed) → control totals (Σdebit/Σcredit/legCount)
  → `material = |break| ≥ threshold`. **Does not include chain** (live never enters backend
  judgement / the deterministic gate).
- `disposition.ts` — reuse is **scoped to pure logic only**: `assertDispositionTransition`
  (already pure + exported), the `DispositionState` type, and the transition graph (open →
  resolved/dismissed/deferred, fail-closed). The Exception store/`applyDisposition` is keyed
  `(category, eventId)` and **cannot** be reused for recon's 4-tuple key — `reconBreakStore`
  + `applyReconDisposition` are net-new. `RECON_REASON_CODES` is a **recon-specific**
  taxonomy (NOT the Exception codes verbatim): `timing` / `error` / `fee` / `fx` /
  `in-transit` / `unidentified` / `OTHER` — this is the break *classification* and drives
  treatment (timing/in-transit are self-clearing reconciling items; error needs a correcting
  JE; unidentified is a red flag). `in-transit` resolves a break as a tracked reconciling
  item, NOT a dismissal.

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
   - **strict parse**: URL-decode first, then require `count('|') === 1` (reject 0 or ≥2
     `|`); split on the single `|` → `[wallet, coinType]`. Reject otherwise → 400.
   - re-validate against live `collectBreaks` → forged/stale breakId 404 (the real backstop);
   - **anchored period → 409 `ANCHORED_READ_ONLY`** (backend-enforced, not UI-only);
   - `decidedBy` fixed server constant (never from client — anti-impersonation);
   - `reasonCode` validated against `RECON_REASON_CODES`; illegal transition → 409
     `ILLEGAL_TRANSITION`; missing state/reasonCode → 400; unknown reasonCode → 400;
     `OTHER` requires reasonNote.

3. **Close gate** (snapshot freeze handler): the recon check runs **before `buildSnapshot`**
   (cheap-fail first), reading `collectBreaks` with the **same `periodId` passed to snapshot**
   (`req.body.periodId`, not `DEFAULT_PERIOD`) — count rows where
   `material && isOpen(disposition)`; if `> 0` → `409 RECON_BREAKS_BLOCKING` (lists blocking
   `wallet|coinType`). The exceptions gate and recon gate run independently with distinct
   error codes; both must pass before the snapshot is built.

4. `GET /entities/:id/close-readiness` — **restructured to remove the silent-regression
   trap**. The current flat `{ blocking, blockers }` would, if `recon` were merely appended,
   make top-level `blocking` ambiguously mean "exceptions only" — a consumer reading it as
   "is the period closeable" would miss recon blockers. New shape:
   `{ exceptions: { blocking, blockers }, recon: { blocking, blockers }, closeable: boolean }`
   where `closeable = exceptions.blocking === 0 && recon.blocking === 0`. Consumers must be
   verified in the PR (grep found only `routes.ts` + tests; no web consumer — low blast radius).

## 5. Frontend

New `web/src/workspaces/ReconciliationWorkspace.tsx` (registry: `reconciliation` status
`soon` → `ready`). Reuses shell, tokens, mascot governance.

### 5.0 Layout — table-first, NOT the two-pane mirror

Recon is **table-first**, not queue-first. An 8-column numeric grid needs ~900px and would
overflow even the existing 320px desktop list pane — so it does **not** reuse the
Exceptions/Audit `flex 0 0 320px` two-pane shell. Instead: **full-width roll-forward table on
top, detail as a drawer/panel below (overlay/stack on narrow)**. The outer two-pane RWD only
solved the *outer* stack; the *inner* grid is the real RWD problem, solved per breakpoint below.

### 5.1 ReconTable — responsive roll-forward grid

Full 8 columns: `Wallet·Asset | Opening | +Movements | =Computed(book) | Statement | Break | Chain(live) | Status`.
Movements/Computed recomputed client-side from `useJournal` JE legs via `origMemo` (reuse
`lib/balance.ts`, no new math).

- **Desktop ≥1024px** — full 8-col grid, full width, row click → detail.
- **Tablet 640–1024px** — collapse the 3 derivation cols (Opening/+Movements) into one
  expandable `roll-fwd ▸` cell; keep the load-bearing `=Computed | Statement | Break | Status`.
- **Phone <640px** — **card-ify, do NOT horizontal-scroll** (a scrolling 8-col grid pushes
  the Break column — the whole point — off-screen). One card per row, stacked
  `label : value : provenance` rows, Break on its own emphasized row, status badge top-right,
  tap = detail. CSS-only via container queries (the pane width ≠ viewport) + `display:block`
  `tr`/`td` + `::before` labels, matching the codebase's CSS-driven RWD ethos.

Column-priority on shrink: drop Opening/+Movements first (derivable), never Break/Status.

### 5.2 Visual encoding — material breaks must dominate, no badge-soup

- **Provenance** (`book`/`mock`/`live`/`n/a`) = quiet **monochrome superscript glyph** next to
  the number (`1,540.00ᴮ` `1,538.00ᴹ`), NOT a filled pill — with a legend + `aria-label`.
  Provenance is metadata, kept ink-soft. **Exception: `live` is the only provenance using
  `--aqua`** (token rule: aqua = on-chain semantics exclusively) — `1,540.0ᴸ` in aqua +
  explorer ↗. Three redundant channels (glyph + legend label + aqua-for-live), colorblind-safe.
- **Break tri-state** with inverted emphasis (the happy path recedes):
  - `balanced` → de-emphasized: muted `0.00` in `--credit` + small check, **no badge**.
  - `immaterial` ⚠ → `--warn` **outlined** badge, signed value shown, calm.
  - `material` ⛔ → the only **filled** treatment: `--debit` chip, signed value mono-bold,
    + left **row accent** (`box-shadow: inset 3px 0 var(--debit)`) so the whole row reads as
    blocking. Use the existing warm `--debit` (terracotta), not a new pure red — alarms
    without screaming. Break is always **signed with direction** (§2): `−2.00 (statement over book)`.
- **Chain** three distinct states (fail-loud): `live value`+aqua+↗ / `n/a` muted em-dash
  (expected absence, non-SUI) / `unavailable` `--warn` outline chip + ↻ retry + `title` reason
  (loud, anomalous — must NOT look like `n/a` or a silent 0). SUI chain-break shown as
  informational tag; if `|chainBreak| ≥ threshold`, a "flag for investigation" marker (§2).

### 5.3 ReconDetail — accountant's T-equation

Render the roll-forward as a right-aligned, decimal-aligned, signed ledger footing (not prose):
```
            SUI · 0xacme…Treasury              period DEFAULT_PERIOD
  Opening balance (book)              1,200.000000 ᴮ
  + Movements (Σ 3 JEs)               +340.000000        ← each JE links to Audit lineage ↗
      JE-0042  deposit                +500.000000 ↗
      JE-0048  fee                      −8.000000 ↗
      JE-0051  transfer out          −152.000000 ↗
  ──────────────────────────────────────────────────    ← footing rule (brass hairline)
  = Computed ending (book)           1,540.000000 ᴮ
    Statement ending (mock)          1,538.000000 ᴹ
  ──────────────────────────────────────────────────
  Break (computed − statement)          −2.000000 ⛔  (statement over book)
    threshold ±1.000000 · |break| ≥ threshold → blocking   ← why, in words
    control: Σdebit 500.00 · Σcredit 160.00 · 3 legs       ← movement control total (§2)
  Chain ending (live ↗)              1,540.000000 ᴸ
    chain break (informational)         −2.000000
```
- **DispositionControls** (reuses Exception component/ritual): only material breaks require
  disposition; user picks a `RECON_REASON_CODES` classification (+ note when `OTHER`),
  state-machine buttons. `in-transit` framed as "tracked reconciling item" not a dismissal.
- **Anchored read-only** must be a **visible state, not silently-missing controls**: a calm
  ribbon "Period anchored — reconciliation read-only ⚓" in `--aqua`; controls hidden +
  backend 409 (double-guard).

### 5.4 Number typography contract

`font-variant-numeric: tabular-nums` on all numeric cells (reuse `.td--mono`); right/decimal
alignment; minor→major via asset `decimals` with thousands separators and trailing-zero
padding to full precision (`1,540.000000`, columns line up); negative breaks use U+2212 `−`
(not hyphen) + color (sign + color = two channels, never parentheses-only). coinType: show
**symbol** (SUI/USDC/WETH) primary, full coinType in `title` + copy; wallet mid-truncated
`0xacme…2f9` — reuse the existing journal/EventList truncation helper, no new one.

### 5.5 States & interaction

- **Empty / celebration**: all balanced → reuse `EmptyState` via a `variant`/`caption` prop
  (not a fork): "All accounts reconciled — books tie to statements ⚖".
- **Header summary**: `material breaks: N` pill reuses the §5.2 material treatment when N>0;
  when N=0 collapse to a quiet "all reconciled" (no green badge competing for attention),
  consistent with the Exceptions `{open}·{blocking}` summary line.
- **Close gate visual**: open material breaks surface the "blocks close" hint; the shell-level
  GuardrailBanner also carries recon blockers.
- **Mobile**: card tap → detail uses the same `has-selection` stack-push + `‹ Back` brass
  button pattern (<768px), copy parallel `‹ Accounts · N`.
- entity switch → reset selected row (selection-leak guard, **genuine** test — Audit lesson).
- per-row JE balance throw → isolate to that row's error cell, do not blank the page.
- chain read via dapp-kit `SuiClient` (already in provider tree); in-flight → loading.

## 6. Error Handling / Boundaries (red-team)

| Vector | Defense |
|---|---|
| Bypass UI, POST disposition on anchored period | backend `hasAnchoredSnapshot` → 409 |
| Forged / stale breakId pollutes store | URL-decode then `count('\|')===1` strict parse (reject 0 or ≥2); re-validate against live `collectBreaks` → 404 |
| Statement-only item silently dropped (one-directional recon) | row keys = book ∪ statement union (§2); statement-only → `computed=0` break |
| Fixture authored with inverted sign convention | schema asserts opening/statement/threshold `≥ 0` (asset-positive) |
| origMemo (client) drifts from netByCoinType (backend gate) | mandatory parity test as merge gate — byte-identical recompute (§4, §9) |
| Impersonate operator, pollute append-only trail | `decidedBy` fixed server constant, never from client |
| Concurrent disposition overwrites terminal state / log-main inconsistency | `applyReconDisposition` atomic transaction |
| Client forges small break to slip past close | gate distrusts client; backend `collectBreaks` independently recomputes material breaks |
| Fixture missing row / non-numeric opening / dup coinType / decimal mismatch | schema-validated load, bad data throws; BigInt throughout, non-numeric throws |
| Chain live read fail / timeout / wallet unset | chain column `unavailable` fail-loud; **never fallback to 0** (would fake balanced) |

## 7. Testing

Rule 9 (test WHY not just WHAT) + test.md (Unit + Integration then Monkey).

**Backend** (`services/api`):
- **parity test (merge gate)**: identical JE fixtures → `origMemo` (web) and `netByCoinType`
  (api) must return byte-identical `Record<string,bigint>` — the hybrid's integrity depends
  on this (§4 C1).
- `collectBreaks` unit: opening+movements=computed correctness; **signed break + direction**;
  **key union** (statement-only asset → `computed=0` break row); materiality boundary
  (`== threshold` is material, `threshold==0` zero-tolerance); zero-JE asset movement = 0;
  control totals (Σdebit/Σcredit/legCount) tie to net; disposition join correctness.
- disposition integration: state transitions; **recon reasonCode taxonomy** validated
  (`in-transit` resolves-as-tracked not dismiss); anchored → 409; forged breakId → 404;
  illegal transition → 409; atomicity (log and main table consistent, prior→new state +
  prior break value recorded).
- close gate integration: open material break → freeze 409 `RECON_BREAKS_BLOCKING` (runs
  **before** buildSnapshot, uses `req.body.periodId`); all resolved/immaterial → pass;
  exception gate and recon gate coexist without swallowing each other; `close-readiness`
  returns `{ exceptions, recon, closeable }`.
- **wire-value test** (anti "verified-by-types-only"): assert the JSON response literally
  contains `provenance:'mock'`/`'live'` etc. for a known fixture row, and `realWallet` is the
  configured value or the literal `unavailable` sentinel (never empty-string coerced falsy).
- **Monkey**: negative opening (schema reject); huge BigInt; coinType with odd chars; breakId
  injection `|`/`::` (multi-`|` reject); concurrent double disposition; fixture missing row /
  dup coinType / decimal mismatch; threshold = 0; statement-only with zero book.

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

## 8. Deferred / Disclosed simplifications

These are deliberate scope cuts. Disclosed (not hidden) because an auditor would flag them —
the demo is a credible *controls/governance* reconciliation with these stated limits.

**Deferred (YAGNI)**
- Multi-period roll-forward (opening from prior-period ending join, date-bounded cutoff) —
  single-period demo; opening from fixture; cutoff entity-scoped (§2).
- Live chain read for non-SUI assets (requires real holdings) — `n/a` for now.
- Multi-wallet entity-level aggregation / rollup control total — fixture-driven single set.
- Reconciliation status as a Period Close Dashboard light (B1) — separate sub-project.

**Disclosed control simplifications (named, would be auditor findings)**
- **No maker-checker / SoD on break clearance** — the most control-sensitive action
  (clearing a material break) is single-actor with reasonCode + note; no preparer≠approver
  second-person approval, no evidence attachment. `append-only log` records *that* it
  happened, not that it was *reviewed*. Real subledger needs dual approval before a material
  break leaves `open` (tied to deferred RBAC).
- **Materiality is per-asset absolute minor-units** — no functional-currency aggregation (an
  aggregate-immaterial set could be material in total; FX would be mocked), not %-of-balance
  (a fixed threshold mis-scales across wallet sizes), no cumulative uncorrected-misstatement
  carryforward.
- **Statement source is mock** — labeled `mock` in the UI; this phase does **not** embed the
  recon result (or statement source/hash) into the anchored snapshot, so the close artifact
  carries the close gate's pass/fail but not the reconciliation evidence itself. A later
  reviewer of the frozen close cannot re-derive the recon from chain alone.
- **Recompute not input-pinned to the frozen JE set** — client "recomputable evidence" reads
  current JEs; if JEs changed after freeze, the client could recompute a different number than
  the close used. Single-period demo freezes then read-only, so divergence is bounded, but the
  evidence claim is "recomputable against current state," not "pinned to the close input hash."
- **Disposition not bound to the break value/version** — a recon-break disposition is keyed by
  `(entity, period, wallet, coinType)` only. If a JE change after a `dismissed`/`resolved`
  disposition alters the break amount, the stale disposition still applies and a newly-material
  break would not re-block the close. Real subledger would version/value-bind the disposition
  (store the break value at decision time and re-open on change). Single-period demo freezes
  JEs at close, so this is bounded; disclosed (cf. the accountant review's N4).
- **No request-time authorization / cross-tenant isolation** — the API has no auth system
  (RBAC/zkLogin deferred project-wide). `POST /recon-breaks/:breakId/disposition` resolves the
  entity from the wallet and does not verify caller ownership, so in a multi-tenant deployment
  it would be an IDOR. The demo is single-entity and unauthenticated by design; `decidedBy` is a
  fixed server constant (anti-impersonation until real auth lands), matching the Exception Queue.

## 9. Reuse Inventory (honest — reuse vs port vs net-new)

**True reuse (import as-is)**
- `lib/balance.ts` `origMemo` — client-side movement recompute (web only).
- Exception `assertDispositionTransition` + `DispositionState` type + transition graph — pure
  disposition logic (already exported, framework-agnostic).
- Exception `DispositionControls` + `EmptyState` (via `variant`/`caption`) — UI/ritual.
- `hasAnchoredSnapshot` — anchored read-only gate.
- Audit event-lineage drill-down — JE contribution links.
- Shell `GuardrailBanner` — recon blocker surfacing.
- Journal/EventList address-truncation helper — coinType/wallet display.

**Port + parity-test (NOT a shared import — see §4 C1)**
- `netByCoinType` (backend) ported from `origMemo` (web): separate packages, JE blob on
  backend. **Mandatory parity test** as merge gate — the close gate's anti-forgery integrity
  rests on byte-identical recompute.

**Net-new (Exception store cannot be reused — 4-tuple key vs `(category,eventId)`)**
- `reconBreakStore` + tables `recon_break_dispositions` / `recon_break_disposition_log`.
- `applyReconDisposition` (atomic txn, server `decidedBy`).
- `collectBreaks` (recompute-on-read, key union, control totals, signed break).
- `RECON_REASON_CODES` recon-specific taxonomy.
- close-gate recon branch + `close-readiness` restructure (`{exceptions, recon, closeable}`).
