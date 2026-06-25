# Real-User-Scenario E2E — Design

**Date**: 2026-06-25
**Status**: Approved (brainstorm), pending spec review
**Scope**: Add e2e test assets that exercise the close-the-period product across four personas, in three layers. **No production code changes** — this adds test assets only. If a scenario surfaces a real bug, that is handled as a separate task.

## Goal

Today the repo has unit/jsdom tests + one in-process driver (`services/api/scripts/demo-e2e.ts`) + a mocked UI smoke test (`web/src/test/flow.smoke.test.tsx`). There is **no browser-driven e2e and no multi-scenario coverage of the control surfaces** (exceptions / reconciliation / close cockpit / onboarding). This adds real-user-journey coverage so the demo paths are proven, not assumed.

## Three Layers (priority order)

1. **Layer 2 — API scenario harness (in-process TS)** — *build first*. Real routes, real Gemini classify, **real chain anchor** (SUI_PK-gated). Highest signal-per-effort; extends the proven `demo-e2e.ts` pattern.
2. **Layer 1 — Playwright browser e2e** — *build second*. Real Vite + real API server; wallet via Wallet Standard mock injection. New infra.
3. **Layer 3 — demo dry-run markdown** — *build last*. Human-followed script that covers the one thing automation can't: **real testnet wallet signing + confirm on-chain**.

All three reference **one shared scenario catalog** (below) so the storyline doesn't drift across layers.

## Scenario Catalog (4 personas)

| # | Persona | Storyline | Type |
|---|---------|-----------|------|
| **S1** | Accountant — close happy path | ingest → classify → review-queue human decide → run-rules → journal → snapshot → anchor (prepare → **sign + confirm on real testnet** when SUI_PK set) | happy / write |
| **S2** | Controller — exceptions | induce a blocking exception → freeze attempt blocked (`409 EXCEPTIONS_BLOCKING`) → disposition resolve → freeze proceeds | gate |
| **S3** | Controller — reconciliation | recon break appears → material break blocks freeze (`409 RECON_BREAKS_BLOCKING`) → disposition → proceeds | gate |
| **S4** | Controller — close cockpit | six readiness lights → `lock` (OPEN→LOCKED) → `reopen` (maker→checker + reason code) state machine | state machine |
| **S5** | Auditor | audit lineage raw→AI→JE→chain; browser-recompute inclusion proof (4 states); event compare Δ | forensic read-only |
| **S6** | Onboarding | challenge → sign → verify → attestation (mock wallet); error states: connected-wallet≠source mismatch / bad-signature / replay | auth + edge |

### Per-scenario accounting & control assertions (the "why", not just "it ran")

These are mandatory accounting/control assertions, layered on top of the storyline. Asserting these — not "the step returned 200" — is what makes coverage credible (CPA review).

- **S1**: every ingested event is dispositioned at freeze (no orphan OPEN events); **every JE balances (debits == credits)**; **trial balance nets to zero**; review-queue drains to empty. Assert structural invariants, not exact Gemini labels (AI output is non-deterministic).
- **S2 / S3**: after disposition, assert **both** that the blocking count → 0 **and** that the underlying number changed correctly (TB delta / recon-break residual reflects the resolution). "Freeze proceeds" alone can pass on a buggy disposition that unblocks without correcting.
- **S2**: `dismissed`/`deferred` exception must **re-appear on re-run** (dismiss → re-run rules/ingest → still surfaced, carried as dismissed, not silently absent). Exercises the implemented state machine; a vanishing exception is a control hole.
- **S4**: assert the **rejection** paths, not just the happy transition — reopen with same actor as maker → rejected (SoD); reopen with missing/invalid reason code → rejected. Reopen of an **anchored** period → sets `staleAnchor`, re-lock allowed, **no v2 anchor** (B1 cannot supersede on-chain — documented deferred, assert exactly that).
- **S5**: include one **negative** — feed a mutated leaf/JE and assert recompute → mismatch state (a proof that only validates happy input proves nothing detective).
- **Idempotency / double-action** (S2/S3/S4): double-disposition same id, double-lock (LOCKED→lock) → clean no-op or 409, never double-count.

### Honestly out-of-scope (product explicitly deferred — do NOT test)

Confirmed against the prior workspace specs: reopen→restatement→re-anchor **v2** (cockpit can't supersede; only `staleAnchor`); maker-checker SoD on onboarding verify + four-eyes on exception disposition (approver half deferred); ownership-gating of downstream posting on unverified sources; duplicate-event/completeness detection (needs deferred sync-cursor); policy effective-dating / closed-period fencing (no `periodId` on JournalDTO); materiality-driven escalation; disposition-log anchoring; re-attestation/revocation. The S4 reopen SoD **is** implemented and **is** tested (above); the others are not.

## Layer 2 — API scenario harness

**Location**: `services/api/scripts/scenarios/`
- `harness.ts` — shared helpers: fresh in-memory DB + seed, in-process route invocation (reuse `demo-e2e.ts` wiring), `assert`/`expect409` helpers, fail-loud reporter.
- `s1-close-happy.ts` … `s6-onboarding.ts` — one file per scenario, each a self-contained async `run(harness)`.
- `index.ts` — runs all, or one by id.

**Run**:
- `npm run e2e:scenarios` (all)
- `npm run e2e:scenario -- S2` (one)

**Chain strategy (per user decision — real, not mock)** — corrected against `anchorService.ts` / `demo-e2e.ts` / `anchor-notes.md` (SUI review):
- **Transport**: the harness inherits `demo-e2e.ts`'s wiring, which uses the **gRPC adapter** (`makeGrpcAdapter`) for chain reads (cap owner, chain head/seq) and sign+execute — not JSON-RPC. Pinned explicitly because JSON-RPC deactivates 2026-07-31 and reviewers must know which path is exercised.
- S1 anchor performs the **real on-chain sign + confirm when `SUI_PK` is set** (same gating as `demo-e2e.ts`). When `SUI_PK` is absent (CI without a key), it runs through `anchor/prepare` and logs a clear **skip** (a skip, not a mock — no fake adapter).
- **The repeat-anchor failure mode is NOT `ALREADY_ANCHORED` in this harness.** `ALREADY_ANCHORED` originates from the deterministic `snap-{entity}-{period}-1` snapshot-id collision **on a persistent DB**; the harness uses a fresh `:memory:` DB per run so that path never fires. On a real re-anchor the live confirm re-asserts `chain.seq === expectedSeq` and throws **`409 SEQ_MISMATCH`** when the on-chain head has advanced. Each layer asserts its real failure: **harness (fresh `:memory:`) → seq simply advances, no `ALREADY_ANCHORED`**; **Layer 3 (persistent DB) → `ALREADY_ANCHORED` on id collision** (see §Layer 3).
- **Serialization is mandatory.** `expectedSeq = chain.seq + 1` is read live at prepare and re-asserted at confirm against the **one shared `EntityAnchorChain` object on testnet**. Concurrent or interleaved S1 runs (or S1 + a manual Layer-3 run) against the same chain object will `SEQ_MISMATCH`. Rule: **one anchor per process, single funded wallet, never run S1 in parallel**. Rely on `confirmAnchor`'s built-in `waitForTransaction(digest)` for owned-`AnchorCap` version freshness; do not rapid re-anchor in one process.
- **Package-id pitfall** (current single-version testnet deploy is fine): the PTB uses `cfg.anchorPackageId` (latest) while `seed()` stores `anchorOriginalPackageId` (original, for type/entity_ref identity). A package **upgrade between runs** invalidates seeded fixtures — re-seed after any upgrade.
- Gemini classify hits the **real API** (needs `GEMINI_API_KEY`); output is non-deterministic, so S1 asserts on structural invariants (per §Per-scenario assertions) rather than exact AI labels.

**Assertions**: each scenario fail-loud asserts the accounting/control invariants in §Per-scenario assertions plus the specific 409 codes (`EXCEPTIONS_BLOCKING`, `RECON_BREAKS_BLOCKING`, `SEQ_MISMATCH`, `CAP_NOT_OWNED_BY_WALLET`). Reuse existing store/service functions; do not reach into private internals.

> **S1 is not a CI gate.** Real anchor mutates testnet state and costs gas; a partial run can leave a period half-anchored. S1's chain-write segment runs only on demand (SUI_PK present); CI runs the prepare-only path.

## Layer 1 — Playwright browser e2e

**Location**: `web/playwright.config.ts` + `web/e2e/` (one spec per scenario).
- `webServer`: launch real Vite dev (`:5173`) **and** real API server (`:8787`) with a seeded DB.
- **Wallet**: Wallet Standard mock injection — `browser.evaluate` dispatches `wallet-standard:register-wallet` exposing a controllable `signPersonalMessage` (the technique recorded in `lessons.md`, already proven to drive all gated render states without a real wallet).
- S6 fully driven (incl. error states). S1 anchor is driven toward the sign button **and asserts the real preflight outcome**: the mock wallet's address ≠ the real `AnchorCap` owner (`0x266e…dfba9`), so `anchor/prepare` will return **`409 CAP_NOT_OWNED_BY_WALLET`** — Layer 1 asserts the UI surfaces that error correctly (or points at a fixture whose cap owner equals the mock address). The "prepare/sign-ready" assertion's scope is *"snapshot FROZEN + entity_ref match + a chain read succeeded + UI rendered sign-ready"*, **not** "anchor is valid" — there is no real submit.
- S2–S5 driven as read/disposition/lights flows against the real API.

**Visual assertions are the point of this layer (frontend review).** jsdom already proves DOM presence (`flow.smoke.test.tsx`); Playwright that only re-checks presence adds zero signal and would go green while buttons render as unstyled native squares (the recurring `.btn-primary` regression). Therefore every UI-driving scenario MUST assert **computed style / class / color**, not just element presence:
- **Buttons**: `toHaveClass('btn-primary')` + computed-style check (brass pill, border-radius ≠ 0), not just "button exists" — and the class must be one CSS actually defines (used-vs-defined audit).
- **S5 proof badge (4 states)**: assert the badge class per state — pending / VERIFIED (`--credit` green) / UNVERIFIED (`--ink-soft`) / not-anchored — and that color is **not aqua** (aqua reserved for on-chain).
- **S6 onboarding**: VERIFIED badge green, error span has the mismatch/bad-sig error class (e.g. `.ob-bad`), not merely "some text present".
- **S4 cockpit**: assert the six readiness-light colors (state-machine semantics), not just that lights render.
- **Responsive**: run S1 (cockpit) and S6 (onboarding) at **375px** via `page.setViewportSize` to catch the mobile column-stacking / inline-style-precedence regression class (jsdom can't compute layout).
- **Screenshots**: `playwright.config.ts` sets `screenshot: 'only-on-failure'`; optionally commit per-scenario baselines under `web/e2e/__screenshots__/` so art regressions show as diffs.

**Run**: `cd web && npm run e2e` (Playwright).

## Layer 3 — demo dry-run markdown

**Location**: `docs/demo/dry-run-script.md`.
- Step-by-step human script covering the full S1 path **including real testnet wallet signing + `anchor/confirm`** — the single gap automation leaves.
- Includes: prerequisites (wallet owns the real `AnchorCap` + gas), DB reset command (`rm services/api/data/*.db` — **persistent-DB path only; the harness `:memory:` DB needs no rm**), and the `409 ALREADY_ANCHORED` = "this period already anchored on a persistent DB → reset DB" note (this is the persistent-DB id-collision path, distinct from the harness's `SEQ_MISMATCH`).
- **Each step has both an "expected functional result" AND an "expected visual landmark"** (frontend review), in a table, so a demo runner can tell "flow works but styling broke" from "flow broke": e.g. button = *brass pill, not native grey square*; VERIFIED badge = *green fill*; BAD_SIGNATURE error = *red inline text*. A human catching an art regression by eye is exactly the gap automation misses.

## Out of Scope (YAGNI)

- CI wiring (local-runnable first; CI is a follow-up).
- Any production code change. Scenarios are read-only consumers of existing routes; a surfaced bug is a separate task.
- Driving a real wallet in headless Playwright (impossible; that's why Layer 3 exists).

## To verify during planning (conditional)

- **Single-period cutoff boundary** (CPA should-add): if `buildSnapshot`/leaf-set has any period-date filter, S1 asserts an event timestamped at/after period-end does **not** land in this period's leaf set. If the snapshot has no period-date semantics (likely — `JournalDTO` has no `periodId`), this is **explicitly deferred**, not a gap. The plan step must check the code and pick one.

## Review Adjudication (2026-06-25, three-reviewer)

- **SUI architect (READY-WITH-FIXES)** — all accepted: corrected `ALREADY_ANCHORED`→`SEQ_MISMATCH` per-layer failure semantics; mandated serialization (one anchor/process, shared chain object); pinned gRPC transport; flagged `CAP_NOT_OWNED_BY_WALLET` for the mock-wallet Playwright path; noted package-id and `waitForTransaction` constraints.
- **CPA (controls coverage)** — all must-adds folded into §Per-scenario assertions (TB tie-out + debits=credits + no orphan events; post-disposition invariant; dismissed-reappears; reopen SoD/reason-code rejection); should-adds added (double-action idempotency, S5 tamper-negative, conditional cutoff above); deferred bucket confirmed honestly scoped-out.
- **Frontend (visual gap)** — all accepted: Layer 1 now mandates computed-style/class/color assertions (not DOM presence), named badge/button/light assertions, 375px RWD, failure screenshots; Layer 3 markdown gets a visual-landmark column.

## Success Criteria

- `npm run e2e:scenarios` runs S1–S6 in-process; all pass with `GEMINI_API_KEY` set; S1 anchors on real testnet when `SUI_PK` set (serialized, on demand), else cleanly skips at prepare. Control assertions in §Per-scenario hold, not just HTTP 200s.
- `cd web && npm run e2e` runs the Playwright suite green against real Vite+API with mock wallet, asserting **computed styles / classes / colors** (not just DOM presence) and ≥1 mobile-viewport check.
- `docs/demo/dry-run-script.md` is followable end-to-end by a human with a funded testnet wallet, producing a confirmed on-chain anchor, with visual landmarks at each step.
