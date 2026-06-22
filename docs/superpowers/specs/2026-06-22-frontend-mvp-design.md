# TallyMarina Frontend MVP — Design Spec

**Date:** 2026-06-22
**Status:** Approved (brainstorming complete, pending user spec review)
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
backend env `GEMINI_API_KEY`. Provider seam `ai/geminiClient.ts` (swap to Claude = one file).
Model ids verified at implementation time (initial pick: a `gemini-flash` for classify,
a `gemini-pro` for copilot). Structured output via Gemini **`responseSchema`** (JSON mode).

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

```
[backend] POST /anchor/prepare
  1. resolveChain(entityId)   — gRPC reads on-chain entity_ref cross-check (A4 gate, fail-closed)
  2. read chain head: prev_link = chain.latest_link, expectedSeq = chain.seq + 1
  3. buildAnchorArgs(manifestHash, merkleRoot, periodId, supersedesSeq)
     — hashes come from the SERVER snapshot record, NOT from the client (anti-tamper)
  4. buildAnchorPtb(...) → Transaction (moveCall anchor_snapshot, latest packageId),
     sender = connected wallet address (passed from frontend), unsigned
  5. tx.build({ client: grpcClient }) → { txBytes(base64), expectedSeq, chainId, capId }

[frontend] dapp-kit
  6. useSignAndExecuteTransaction({ transaction: txBytes })  — wallet prompt
  7. → { digest }

[backend] POST /anchor/confirm { snapshotId, digest, expectedSeq }
  8. grpcClient.core.waitForTransaction({ digest })
  9. re-read chain state → assert seq === expectedSeq && link advanced
     (fail-closed: mismatch → error, do NOT write ANCHORED)
  10. write anchors row (seq, link, digest, ANCHORED) + explorer URL
```

**One-time setup (runbook, not code):** the testnet `AnchorCap` (owned object
`0x266e…fba9`) must be transferred to the browser wallet address used in the demo,
else the moveCall aborts (cap not owned by sender).

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
reads as a trustworthy enterprise finance tool.

**Palette (extracted from the logos):**

| Role | Hex | Use |
|---|---|---|
| Deep Navy | `#233056` / `#1E2A4A` | primary, header, text |
| Brass Gold | `#C9A24B` / `#D4AF6A` | accent, CTA, outline strokes |
| Parchment Cream | `#F4ECD8` / `#EDE3CC` | background, paper-feel cards |
| Sui Aqua | `#4FC3DC` | wave / on-chain element accents |
| Otter Slate | `#3E4A6B` | secondary, mascot shadow |

**Style direction:** rounded corners, soft shadows, paper-textured cards, the otter mascot
woven in (step guide, empty-state illustrations, and — narratively important — the
**AI copilot avatar**, making the Agentic assistant tangible). Lighthearted/anime but
data-dense and credible; not flashy web3. Logos may be inserted freely into the frontend.

**Guardrail banner:** a persistent banner — "AI suggestions only — no posting authority" —
pins the guardrail narrative throughout.

Implementation uses the `frontend-design` skill (avoid generic-AI aesthetics).

## 9. Sub-Project Decomposition

This MVP is the first vertical slice. Later, independent sub-projects (each its own
spec→plan→build): (1) auth/RBAC + multi-user; (2) multi-entity management; (3) ERP export +
reconciliation; (4) rule-set editor; (5) NL ledger query. Not in this spec.
