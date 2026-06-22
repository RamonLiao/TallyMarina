# TallyMarina Frontend MVP — Design Spec

**Date:** 2026-06-22
**Status:** Approved + dual-reviewed (sui-architect READY-WITH-FIXES applied; frontend-design NEEDS-WORK applied), pending final user spec review → writing-plans
**Track:** Sui Overflow 2026 — Agentic Web

## 1. Goal & Scope

Build a **product-MVP web frontend** plus its supporting backend API for TallyMarina,
demonstrating the full **close-the-period** vertical slice end-to-end, with **real AI**
(Agentic Web theme) and **real on-chain anchoring** via browser wallet.

Deliverable form: a **pre-recorded demo video** driving a real UI. There is currently
**no frontend** in the repo (4 backend TS services + 1 Move package only), and the
services are pure libraries with **no HTTP API, no persistence, no auth**. This MVP adds
the missing API + storage layer and the frontend on top.

### In scope (this spec / first vertical slice)
- Backend API layer (`services/api`) wrapping the 4 existing services as libraries.
- React frontend (`web/`) — 5-step close-the-period flow.
- AI: **(a) classification suggestions** + **(b) review copilot**, **real Gemini API**,
  **zero posting authority**.
- Browser-wallet anchoring (dapp-kit) to the already-deployed testnet `audit_anchor` package.
- Sui client migration to **gRPC** (`SuiGrpcClient`) — see §5.

### Explicitly out of scope (later sub-projects)
- Auth / login / RBAC / multi-user sessions (MVP = single implicit user).
- Multi-entity management UI (seed a single entity `acme:pilot-001`).
- ERP export, reconciliation UI, rule-set editor.
- Natural-language ledger query (AI role "c" — cut).
- Live on-chain ingestion of unknown data (main line uses a fixed fixture; live fetch
  is an optional advanced button only).

### Decisions locked during brainstorming
- **Architecture:** monorepo, single API gateway + React SPA (rejected: browser-imports-services; Next.js full-stack).
- **Vertical slice:** close-the-period main line.
- **AI roles:** (a) classify + (b) review copilot. **Provider: Gemini** (free tier; Claude API costs money). Guardrails are provider-agnostic.
- **AI realness:** real API calls (R1).
- **Anchor signing:** browser wallet (dapp-kit), PTB build/sign split.
- **Sui client:** `SuiGrpcClient` (gRPC), not JSON-RPC. Solves the P126 2026-07-31 JSON-RPC shutdown and yields exact `cleverError.constantName` abort classification.
- **Frontend↔backend transport:** REST/JSON (gRPC-web rejected as needless complexity for a demo).
- **Data source:** fixed fixture CSV/JSON (deterministic, recording-safe).
- **Persistence:** SQLite (`better-sqlite3`).

## 2. System Architecture

```
web/  (Vite + React + @mysten/dapp-kit + @mysten/sui)
  └─ talks to services/api only (REST/JSON).
     Exception: anchor — receives unsigned PTB bytes, signs with browser wallet, submits.
        │ HTTP (REST/JSON)
services/api/  (Fastify + better-sqlite3)            ← NEW
  ├─ routes/   entities, events, reviews, rules, snapshot, anchor
  ├─ ai/       Gemini provider seam (classify + review-copilot); ONLY module with the API key
  ├─ store/    SQLite stores; journalStore write fns NOT importable by ai/
  └─ imports as libraries (zero change): ingestion, rules-engine, snapshot-svc, anchor-svc
        │
   anchor-svc split:
     buildAnchorPtb()        → unsigned tx bytes (API emits)
     browser wallet signs + executes → digest posted back to API
        │ gRPC (SuiGrpcClient) for reads + prepare; wallet submits the signed tx
   Sui testnet — deployed audit_anchor package (unchanged)
```

**Core principles preserved:**
- Deterministic engine unchanged; on-chain stores only hashes.
- **AI has zero posting authority**: writes only `events.ai_*` and returns advice; it is
  structurally unable to import the journal write functions (compile-time guarantee).
- Only Move package = AuditAnchor (zero contract changes).

**Only change to anchor-svc:** split `anchorSnapshot()`'s build-PTB from sign-execute
(`buildAnchorPtb()` emits unsigned tx; frontend wallet signs). The A4 gate (on-chain
`entity_ref` cross-check) stays in the build/prepare step. Plus the JSON-RPC→gRPC swap
(same `CoreClient` interface; adapter consumes `client.core`).

**Note:** `ingestion/src/index.ts` currently only exports a version string; its normalize
logic lives in the CLI. The API needs ingestion to expose a small library entry
(`normalizeFixture(...)`) — added as a plan task.

## 3. API Endpoints (Fastify, REST/JSON)

All writes are fail-closed and state-machine gated to prevent double-posting.

| # | Method + Path | Purpose | Wraps |
|---|---|---|---|
| 1 | `GET /entities` | List demo entities (seed `acme:pilot-001`, mapped to on-chain chain/cap) | store |
| 2 | `POST /entities/:id/ingest` | Load fixture → normalize → write `events` (`INGESTED`) | ingestion |
| 3 | `GET /entities/:id/events` | List events + `ai_*` suggestion + confidence + routing | store |
| 4 | `POST /events/:id/classify` | AI classify (role a) → write suggestion/confidence; `AUTO` if high, else `NEEDS_REVIEW` | ai/ |
| 5 | `GET /entities/:id/review-queue` | List `NEEDS_REVIEW` events | store |
| 6 | `POST /reviews/:eventId/copilot` | AI review copilot (role b): explanation/red-flags/draft entry, **read-only** | ai/ |
| 7 | `POST /reviews/:eventId/decide` | Human approve/override → `APPROVED` | store |
| 8 | `POST /entities/:id/run-rules` | `evaluate()` over `APPROVED`+`AUTO` events → write `journal_entries` | rules-engine |
| 9 | `GET /entities/:id/journal` | List JE (debit/credit, dual-track cost) + merkle leaf preview | store |
| 10 | `POST /entities/:id/snapshot` | `buildSnapshot()` → manifest_hash + merkleRoot + anchorPayload (`FROZEN`) | snapshot-svc |
| 11 | `POST /entities/:id/anchor/prepare` | A4 gate + `buildAnchorPtb()` → unsigned tx bytes + expectedSeq | anchor-svc |
| 12 | `POST /entities/:id/anchor/confirm` | Receive wallet `digest` → `waitForTransaction` + verify → write `anchors` (`ANCHORED`) | anchor-svc |
| 13 | `GET /entities/:id/anchors` | On-chain hash chain (seq/link/digest/explorer URL) + inclusion proof for a JE | rules-engine `buildMerkle` |

**State machines (lifecycle, prevents double-post):**
- `event: INGESTED → (classify) AUTO|NEEDS_REVIEW → (decide) APPROVED → (run-rules) POSTED`
- `snapshot: DRAFT → FROZEN → ANCHORED` (after FROZEN events are locked; restatement = new snapshot + `supersedesSeq`).

**AI boundary (compile-time):** endpoints 4/6 write only `events.ai_*` / return advice.
`journal_entries` is writable only by endpoint 8's deterministic `evaluate()`.

## 4. AI Integration (real Gemini API, zero posting authority)

Location: `services/api/src/ai/`. Only module that can reach the Gemini API; key in
backend env `GEMINI_API_KEY`. SDK: **`@google/genai`**. Provider seam `ai/geminiClient.ts`
(swap to Claude = one file). Structured output via Gemini **`responseSchema`** (JSON mode).

**Models (verified via context7, 2026-06-22 — Gemini 3.x is current, free tier):**
- classify (role a): **`gemini-3.5-flash-lite`** — cheapest, lowest-latency, ample for classification.
- copilot (role b): **`gemini-3.5-flash`** — free tier, quality sufficient. (`gemini-3.5-pro`
  is generally NOT free → avoided to keep the demo zero-cost.)
- Model ids are config constants (`AI_MODEL_CLASSIFY` / `AI_MODEL_COPILOT` env), not hardcoded,
  so a tier swap is one env change. Classic `generateContent` is fine; the newer
  `interactions.create` API is optional and not required for this MVP.

**Role (a) classify** — `classifyEvent(normalizedEvent) → AiSuggestion`
```
{ eventType, economicPurpose, counterparty|null, confidence: 0.0–1.0, reasoning }
```
- **Routing is code, not model** (Rule 5): `confidence >= THRESHOLD` (e.g. 0.85) → `AUTO`,
  else `NEEDS_REVIEW`. Threshold is a constant evaluated in code.
- **Fail-closed:** AI timeout / invalid schema / unparsable confidence → `NEEDS_REVIEW`.
  AI failure can only over-route to human review; it can never auto-post.

**Role (b) review copilot** — `reviewCopilot(event, context) → CopilotAdvice`
```
{ explanation, redFlags: string[], suggestedEntry: {…draft JE…}, citations }
```
- `suggestedEntry` is a screen-only draft. "Adopt" merely pre-fills the human decide form;
  the JE is produced only by deterministic `evaluate()` at endpoint 8.
- Copilot module cannot import journal write functions.

**Agentic narrative (demo pitch):** AI reads an on-chain tx → infers commercial purpose →
emits a confidence score → high-confidence auto-passes, low-confidence raises its hand for
review → during review the AI is a copilot. Autonomous judgment, clamped by deterministic
guardrails, never touching the ledger.

## 5. Anchor Signing Flow (wallet-signed; PTB build/sign split)

> **Critical fix from sui-architect review:** do NOT `tx.build()` to final BCS bytes
> server-side. That freezes the gas payment and the owned `AnchorCap`'s object version,
> so the wallet can only sign stale bytes → near-certain `-32002` stale-version abort on
> back-to-back anchors (the HTTP + human-thinking-time gap makes it worse). Instead the
> backend builds the `Transaction` IR (moveCall + sender + server hashes), `tx.serialize()`s
> the **kind/JSON IR** (not built bytes), and the **wallet** resolves gas + object versions
> at sign time. This is the entire point of moving signing to the browser.

```
[backend] POST /anchor/prepare  { snapshotId, walletAddress }   (per-entity mutex: one in-flight)
  1. resolveChain(entityId)   — gRPC reads on-chain entity_ref cross-check (A4 gate, fail-closed)
  2. cap-owner PRE-FLIGHT: gRPC getObject(capId) → assert owner === walletAddress,
     else fail-closed `CAP_NOT_OWNED_BY_WALLET` (turns an opaque wallet-time abort into a clean error)
  3. read chain head: prev_link = chain.latest_link, expectedSeq = chain.seq + 1  (optimistic UX check only)
  4. buildAnchorArgs(manifestHash, merkleRoot, periodId, supersedesSeq)
     — hashes come from the SERVER snapshot record, NOT from the client (anti-tamper)
  5. buildAnchorPtb(...) → Transaction (moveCall anchor_snapshot, LATEST packageId resolved at runtime),
     tx.setSender(walletAddress); do NOT set gas payment, do NOT pin object versions, do NOT build
  6. tx.serialize()  → { txKind (JSON IR), expectedSeq, chainId, capId }

[frontend] @mysten/dapp-kit-react 2.x
  7. const tx = Transaction.from(txKind)
     useDAppKit().signAndExecuteTransaction({ transaction: tx })   — wallet resolves gas+versions, prompts
     (NOTE: NOT the deprecated useSignAndExecuteTransaction hook)
  8. → { digest }

[backend] POST /anchor/confirm  { snapshotId, digest, expectedSeq }
  9. grpcClient.core.waitForTransaction({ digest })
  10. re-read chain state → assert seq === expectedSeq && link advanced
      (fail-closed: mismatch → error, do NOT write ANCHORED).
      NB: this off-chain check is a UX nicety; the REAL security boundary is the on-chain
      anchor_snapshot link/seq monotonicity assert (ELinkMismatch) — contract unchanged.
  11. write anchors row (seq, link, digest, ANCHORED) + explorer URL
```

**Concurrency:** serialize anchors per `entityId` (explicit backend mutex; the
`snapshot FROZEN→ANCHORED` state machine implies it — make it a real lock). The
`cleverError → ELinkMismatch → re-read & rebuild once` path covers the *shared* chain head;
the *owned* cap version is handled by NOT pinning it server-side (fix above).

**One-time setup (runbook, not code):**
1. Transfer the testnet `AnchorCap` (owned object `0x266e…fba9`) to the demo browser
   wallet address, else the moveCall aborts (cap not owned by sender).
2. **Fund that wallet with testnet SUI** (faucet) — the wallet pays its own gas when it
   signs; without a gas coin the moveCall aborts with `Cannot find gas coin for signer
   address`. (Sponsored/gasless via Enoki is out of scope; just fund the wallet.)

**gRPC parsing gotchas (sui-architect minor findings):** the gRPC `getObject` response
shape differs from JSON-RPC (protobuf-derived; owner/version nest differently) — the
`resolveChain` and cap-owner reads must parse the gRPC shape, not the old `data.owner`
shape. Also `TypeName` now serializes as a plain string (v1.70+), so the A4 gate's
`entity_ref` decode must expect e.g. `"0x2::sui::SUI"`, not `{name: …}`. Verify both in
the gRPC adapter test.

**Abort classification (free win from gRPC):** on a prepare-stage dry-run abort, gRPC
populates `cleverError.constantName` → exact `EStaleCap` / `ELinkMismatch`, replacing
follow-up ①'s re-read workaround. `ELinkMismatch` (concurrent head advance) → backend
re-reads head and rebuilds once before returning to the frontend.

**Anti-tamper:** `/anchor/prepare` accepts only a `snapshotId`; it reads
manifestHash/merkleRoot from the server snapshot record, never from client input.

## 6. Data Model (SQLite, better-sqlite3)

```sql
entities(
  id TEXT PK,                    -- 'acme:pilot-001'
  display_name TEXT,
  chain_object_id TEXT,          -- on-chain EntityAnchorChain (shared)
  cap_object_id TEXT,            -- on-chain AnchorCap (owned, held by demo wallet)
  original_package_id TEXT       -- for buildRegistry (struct type identity is upgrade-invariant)
)
events(
  id TEXT PK, entity_id TEXT FK,
  raw_json TEXT,                 -- normalized event (ingestion output)
  ai_event_type TEXT, ai_purpose TEXT, ai_counterparty TEXT,
  ai_confidence REAL, ai_reasoning TEXT,      -- AI writes these only, never JE
  final_event_type TEXT, final_purpose TEXT,  -- after human decide
  status TEXT                    -- INGESTED|AUTO|NEEDS_REVIEW|APPROVED|POSTED
)
journal_entries(
  id TEXT PK, entity_id TEXT FK, event_id TEXT FK,
  je_json TEXT,                  -- evaluate() RuleOutput JE (debit/credit, dual-track, lot)
  idempotency_key TEXT UNIQUE,   -- prevents double-post
  leaf_hash TEXT                 -- encodeJeLeaf → leafHash (merkle preimage)
)
snapshots(
  id TEXT PK, entity_id TEXT FK,
  period_id TEXT, manifest_json TEXT,
  manifest_hash TEXT, merkle_root TEXT, leaf_count INT,
  supersedes_seq INT, status TEXT  -- DRAFT|FROZEN|ANCHORED
)
anchors(
  id TEXT PK, entity_id TEXT FK, snapshot_id TEXT FK,
  seq INT, link TEXT, digest TEXT, explorer_url TEXT, anchored_at TEXT
)
```

**Structural AI guardrail:** journal write functions live in `store/journalStore.ts`;
`ai/` does not import it. AI writes only via `store/eventStore.ts#setAiSuggestion`.

**State machine enforced:** each write endpoint validates the current status is a legal
predecessor (`run-rules` accepts only `APPROVED`/`AUTO`; `anchor/confirm` accepts only
`FROZEN`). Illegal transitions fail-closed.

**Seed on boot:** insert `acme:pilot-001` entity row (on-chain ids from `anchor-notes.md`)
+ a fixture events JSON.

## 7. Error Handling & Testing

**Error handling (all fail-closed)**
- Unified error envelope `{ error: { code, message } }`; 4xx = user/state-machine, 5xx = upstream (Sui/Gemini).
- **Gemini failure** (timeout/bad schema/quota) → classify falls to `NEEDS_REVIEW`; copilot
  returns "AI unavailable, review manually". Never blocks the main line, never auto-posts.
- **Sui gRPC failure** → prepare/confirm returns explicit code (`CHAIN_UNREACHABLE` /
  `STALE_CAP` / `LINK_MISMATCH`); frontend offers retry; never writes ANCHORED.
- **A4 gate fail** (entityId↔chain entity_ref mismatch) → `ENTITY_CHAIN_MISMATCH`, refuse to sign.
- **Client-supplied hash** → prepare uses only server snapshot record (§5).

**Testing**
- **api unit:** every endpoint state machine (legal/illegal transitions); AI routing
  threshold boundary (0.84→REVIEW / 0.85→AUTO); Gemini fail-closed (mock timeout/bad
  schema → REVIEW); prepare rejects client hash; confirm refuses to write ANCHORED on seq
  mismatch.
- **AI guardrail test (Rule 9 core):** assert `ai/` cannot reach journal writes (import-graph /
  structural test). Must fail if anyone wires AI into posting.
- **Monkey (test.md mandatory):** oversized fixture; confidence NaN/out-of-range; duplicate
  ingest; concurrent anchor; wallet sign abandoned mid-flow; forged digest to confirm.
- **frontend:** smoke (5-step flow with AI/wallet mocked); coverage not chased (demo MVP).
- **Real-chain e2e:** keep `services/api/scripts/demo-e2e.ts` to drive the full line
  (fixture→AI→JE→snapshot→real prepare→test-key sign fallback→confirm); run green before recording.

**Move contract:** zero changes (reuse deployed testnet package). anchor-svc only splits
build/sign + migrates to gRPC; run existing tests + add a gRPC adapter test.

## 8. Visual Design & Branding

Brand: **TallyMarina** — a cute, glasses-wearing, sailor-capped **otter accountant**
mascot (see `docs/logo_1.png`..`logo_3.png`), holding a ledger / calculator, with a Sui
wave motif and `$ ¥ € ₮` symbols. Tone: **cute, lighthearted anime style** that still
reads as a trustworthy enterprise finance tool. The cuteness earns trust by being the
friendly face on a visibly rigorous machine — **contrast is the asset.** (Design system
below incorporates the frontend-design review; verdict was the concept is right but the
execution needed a real system + one hard governance rule.)

**8.1 Color tokens** (logo-derived, contrast-tuned; brass/aqua darkened for load-bearing
use on the light bg, bright originals reserved for the dark navy header/footer):

```
--ink:        #1E2A4A   /* primary body text — higher contrast than #233056 */
--ink-soft:   #3E4A6B   /* secondary text (Otter Slate) — ~7:1 on cream */
--paper:      #F4ECD8   /* app background */
--paper-card: #FBF6EA   /* cards lift OFF bg (cream-on-cream, +4% L) */
--paper-line: #E3D7BC   /* hairline borders, table row dividers */
--brass:      #B68A2E   /* darkened — usable for thin strokes / icons / focus ring (~3.4:1) */
--brass-fill: #C9A24B   /* original — FILLS ONLY (CTA bg w/ navy text, badges) */
--aqua:       #2E9FBC   /* darkened Sui Aqua — on-chain/anchor accent on cream (~3.8:1) */
--aqua-bright:#4FC3DC   /* original — links/glows on DARK navy only */
--credit:     #2F7A5A   /* desaturated forest — credit / pass / approved */
--debit:      #B5532E   /* desaturated terracotta — debit / red-flag (reads on cream) */
--warn:       #C28A1E   /* needs-review amber */
```
Hard rules: **brass is decoration/structure, NEVER text-on-light or thin data figures**
(`#C9A24B` on cream ≈ 1.9:1, invisible + smears on video). Distribution ≈ **70% navy/cream,
15% brass punctuation, aqua reserved exclusively for on-chain/anchor semantics** so aqua
always *means* "blockchain." Everything load-bearing ≥ 4.5:1.

**8.2 Type** (avoid Inter/Roboto/system): **Fraunces** (optical-size serif — warm
ledger/nautical-almanac character) for display/headers/mascot speech; **Mona Sans** (or
Hanken Grotesk) for body/UI; **IBM Plex Mono** with `font-variant-numeric: tabular-nums`
for ALL numbers/hashes (journal, ledger, confidence, digests). The mono tabular choice does
most of the "trustworthy finance" work — columns align, the hash chain looks like a hash chain.

**8.3 Spacing / radius / shadow:** 8px base scale `4·8·12·16·24·32·48·64`; radius `--r-sm 6px`
inputs/badges, `--r-md 12px` cards, `--r-lg 20px` modals/mascot bubbles (tables: square cells,
`--r-md` clip on container only); navy-tinted soft shadow `0 1px 2px rgba(30,42,74,.06),
0 4px 16px rgba(30,42,74,.08)` (never gray — looks dirty on cream); 1px `--paper-line`
borders (never a 2px gold card border — reads as toy). Faint SVG paper-grain (~3% opacity)
on `--paper` + subtle chart-grid behind the hero for the nautical-chart world.

**8.4 Mascot governance — the one hard rule.** A cute mascot next to a financial figure
makes the figure look fake. So:
- **Mascot APPEARS (chrome/warmth zones):** app logo/wordmark (~32px, the sailor-cap
  logo_2/logo_3), empty states, the 5-step progress rail (a small otter "sailing" as the
  you-are-here marker), the AI copilot dock (§8.5), and a one-time earned celebration
  AFTER anchor confirms.
- **Mascot NEVER APPEARS (trust/data zones):** journal/ledger tables, confidence scores,
  red-flag lists, the guardrail banner, the wallet-signing modal, and — **the single most
  important boundary** — the **anchor confirmation / hash-chain view**, which must look like
  an austere block explorer (mono digests, aqua links, navy), not a sticker.

**8.5 Mascot-as-AI-copilot — execute as "agent," not Clippy.** Docked (fixed right-hand
panel), never floating/interruptive, no idle "it looks like you're…" state. Avatar is the
*speaker label*; the substance below is structured (`Explanation · Red Flags · Suggested
Entry (draft) · Confidence`). Make autonomy visible via **three state-tied avatar poses**:
*thinking* (subtle aqua pulse ring while the Gemini call is in flight), *confident* (check,
high-confidence AUTO), *raising-hand* (the literal "human, please" pose → NEEDS_REVIEW;
reuse logo_2's waving paw). Never use a stock sparkle/robot AI icon — **the otter IS the AI
signifier.** The persistent guardrail banner ("AI suggestions only — no posting authority",
small, brass-underlined, lock icon) is attached to the copilot dock — the agent's visible leash.

**8.6 Demo-video polish** (recording compresses + downscales):
- **Confidence bar (classify) = the money shot:** horizontal bar fills ~600ms ease-out
  (staggered per row), with the 0.85 threshold drawn as a vertical brass tick; crossing it
  snaps the row green AUTO, landing short snaps amber + copilot raises hand. Tells the whole
  agentic story in 2s.
- **Hash-chain (anchor) = credibility climax:** seq blocks L→R joined by `prev_link→link`
  arrows (truncated mono digests); on confirm the new block flies in and the aqua link line
  draws (~800ms stroke-dasharray). Austere per §8.4.
- **Wallet sign:** frame it — "Awaiting signature…" navy state with otter *thinking*, then a
  satisfying state change on `{digest}`. Polish the transition, not the wallet popup.
- **Explorer link:** digest becomes a live aqua external link; show hover briefly. Real
  testnet link = real credibility.
- **Legibility:** body ≥16px, table data ≥15px mono (never <14px); slow motion ~20% vs feels-right
  (600–800ms, generous ease — fast micro-anims strobe on video); table rows 44–48px tall;
  hold each beat 1.5–2s for clean editor cut points. No bright `#4FC3DC` text on cream — use
  `#2E9FBC`.

Implementation uses the `frontend-design` skill (avoid generic-AI aesthetics — no
purple/glass/dark-SaaS, no sparkle icons, no evenly-spread timid palette).

## 9. Sub-Project Decomposition

This MVP is the first vertical slice. Later, independent sub-projects (each its own
spec→plan→build): (1) auth/RBAC + multi-user; (2) multi-entity management; (3) ERP export +
reconciliation; (4) rule-set editor; (5) NL ledger query. Not in this spec.

## 10. Environment Variables & Runbook

Two env files (created during implementation; both `.gitignore`d — never commit keys).

**Backend — `services/api/.env`:**
```bash
# --- Sui (gRPC, testnet) ---
SUI_NETWORK=testnet
SUI_GRPC_URL=                        # testnet gRPC fullnode URL (resolve at impl time)
ANCHOR_PACKAGE_ID=0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d
ANCHOR_ORIGINAL_PACKAGE_ID=0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d
ENTITY_ID=acme:pilot-001
ENTITY_CHAIN_ID=0x451114f9db3b6226bc8c3dd79a21796408a75eb983a6701d345e449f25b4162f
ENTITY_CAP_ID=0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9
# Test-key fallback for scripts/demo-e2e.ts only (NOT the wallet-sign path). Optional.
SUI_PK=                              # suiprivkey1...  (leave blank for prod/demo wallet flow)

# --- Gemini AI ---
GEMINI_API_KEY=                      # ← paste your Google AI Studio key here
AI_MODEL_CLASSIFY=gemini-3.5-flash-lite
AI_MODEL_COPILOT=gemini-3.5-flash
AI_CONFIDENCE_THRESHOLD=0.85

# --- Server ---
PORT=8787
DB_PATH=./data/tallymarina.db
```

**Frontend — `web/.env` (Vite, only `VITE_`-prefixed vars reach the browser; NEVER put
keys here):**
```bash
VITE_API_BASE_URL=http://localhost:8787
VITE_SUI_NETWORK=testnet
VITE_EXPLORER_BASE=https://suiscan.xyz/testnet
```

**You provide (the rest is auto / from anchor-notes):**
1. **A new demo browser wallet** — install Sui Wallet, create an address.
2. **Transfer `ENTITY_CAP_ID` to that wallet** (one-time; cap must be owned by signer).
3. **Faucet testnet SUI** into that wallet (gas).
4. **`GEMINI_API_KEY`** from Google AI Studio → paste into `services/api/.env`.
5. `SUI_GRPC_URL` — confirmed at implementation time (sui-docs-query).

> The `ANCHOR_CAP/CHAIN/PACKAGE` ids above are the live testnet deployment from
> `anchor-notes.md`. The new wallet only needs to *own* the cap + hold gas; its private key
> never leaves the wallet (browser-sign flow), so it is NOT placed in any `.env`.
