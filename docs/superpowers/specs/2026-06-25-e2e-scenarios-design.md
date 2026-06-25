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

## Layer 2 — API scenario harness

**Location**: `services/api/scripts/scenarios/`
- `harness.ts` — shared helpers: fresh in-memory DB + seed, in-process route invocation (reuse `demo-e2e.ts` wiring), `assert`/`expect409` helpers, fail-loud reporter.
- `s1-close-happy.ts` … `s6-onboarding.ts` — one file per scenario, each a self-contained async `run(harness)`.
- `index.ts` — runs all, or one by id.

**Run**:
- `npm run e2e:scenarios` (all)
- `npm run e2e:scenario -- S2` (one)

**Chain strategy (per user decision — real, not mock)**:
- S1 anchor performs the **real on-chain sign + confirm when `SUI_PK` is set** (same gating as `demo-e2e.ts`). When `SUI_PK` is absent (e.g. CI without a key), it runs through `anchor/prepare` and logs a clear **skip** (this is a skip, not a mock — no fake chain adapter).
- **Non-deterministic / non-idempotent caveat (must be honored)**: a real anchor advances on-chain seq, costs gas, and a repeat on an already-anchored period returns `409 ALREADY_ANCHORED` (per `anchor-notes.md`). Therefore S1's real-anchor path requires a fresh DB + a period not yet anchored each run, or it accepts seq advance. The harness uses a fresh `:memory:` DB per run; the on-chain seq still advances across runs — documented, not worked around.
- Gemini classify hits the **real API** (needs `GEMINI_API_KEY`); output is non-deterministic, so S1 asserts on structural invariants (every event classified, review-queue drains, journal balances, TB ties) rather than exact AI labels.

**Assertions**: each scenario fail-loud asserts state-machine transitions and the specific 409s. Reuse existing store/service functions; do not reach into private internals.

## Layer 1 — Playwright browser e2e

**Location**: `web/playwright.config.ts` + `web/e2e/` (one spec per scenario).
- `webServer`: launch real Vite dev (`:5173`) **and** real API server (`:8787`) with a seeded DB.
- **Wallet**: Wallet Standard mock injection — `browser.evaluate` dispatches `wallet-standard:register-wallet` exposing a controllable `signPersonalMessage` (the technique recorded in `lessons.md`, already proven to drive all gated render states without a real wallet).
- S6 fully driven (incl. error states). S1 anchor is driven **up to the sign button, then stops** — assert UI reaches the prepare/sign-ready state; no real signing (headless can't drive a real wallet).
- S2–S5 driven as read/disposition/lights flows against the real API.

**Run**: `cd web && npm run e2e` (Playwright).

## Layer 3 — demo dry-run markdown

**Location**: `docs/demo/dry-run-script.md`.
- Step-by-step human script covering the full S1 path **including real testnet wallet signing + `anchor/confirm`** — the single gap automation leaves.
- Includes: prerequisites (wallet owns AnchorCap + gas), DB reset command (`rm services/api/data/*.db`), per-step expected screen/result, and the `409 ALREADY_ANCHORED` = "already anchored, reset DB" note.

## Out of Scope (YAGNI)

- CI wiring (local-runnable first; CI is a follow-up).
- Any production code change. Scenarios are read-only consumers of existing routes; a surfaced bug is a separate task.
- Driving a real wallet in headless Playwright (impossible; that's why Layer 3 exists).

## Success Criteria

- `npm run e2e:scenarios` runs S1–S6 in-process; all pass with `GEMINI_API_KEY` set; S1 anchors on real testnet when `SUI_PK` set, else cleanly skips at prepare.
- `cd web && npm run e2e` runs the Playwright suite green against real Vite+API with mock wallet.
- `docs/demo/dry-run-script.md` is followable end-to-end by a human with a funded testnet wallet, producing a confirmed on-chain anchor.
