# TallyMarina Frontend MVP — Plan A: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/api` (Fastify + better-sqlite3) that wraps the 4 existing TS services as libraries, exposes 13 REST endpoints with state-machine-gated fail-closed writes, real Gemini AI (classify + copilot, zero posting authority, structural guardrail), and a wallet-signed gRPC anchor flow (PTB build/sign split), plus the anchor-svc gRPC + build/sign refactor.

**Architecture:** A single Fastify gateway over a SQLite store layer. Deterministic engines (rules-engine, snapshot-svc) are unchanged libraries; the API only orchestrates and persists hashes. AI writes ONLY `events.ai_*` (structurally cannot import journal writes). Anchoring builds an unsigned `Transaction` IR server-side (`tx.serialize()`, sender set, NO `tx.build`/gas/version pinning); the browser wallet resolves gas + object versions and signs; the API confirms via `SuiGrpcClient.core.waitForTransaction`.

**Tech Stack:** Node 20+, TypeScript 5.4 (ESM, `"type":"module"`, `.js` import suffixes, `moduleResolution: bundler`), Fastify 4.x, better-sqlite3, vitest 1.6, `@google/genai`, `@mysten/sui` 2.19 (`SuiGrpcClient` from `@mysten/sui/grpc`), `file:../` workspace deps (no root workspace manager — each service is standalone, matching existing `snapshot-svc` importing `@subledger/rules-engine`).

## Global Constraints

- **Repo root** (all commits target the EXISTING repo; NEVER `git init`; always commit via `git -C <repo-root>`): `/Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger`. Referred to below as `<root>`.
- **Module system:** every package is ESM (`"type":"module"`); all relative imports use the `.js` suffix even from `.ts` sources (matches existing services). tsconfig: `target/module ES2022`, `moduleResolution: "bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`, `esModuleInterop: true`, `skipLibCheck: true`.
- **Workspace deps:** intra-repo deps use `"file:../<svc>"` (e.g. `"@subledger/rules-engine": "file:../rules-engine"`). There is NO root `package.json`/pnpm-workspace; run `npm install` inside `services/api` after adding `file:` deps.
- **Scripts in every package.json:** `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. Run BOTH green before each commit.
- **On-chain ids (live testnet, from `anchor-notes.md` — verbatim, do not invent):**
  - `ANCHOR_PACKAGE_ID` / `ANCHOR_ORIGINAL_PACKAGE_ID` = `0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d`
  - `ENTITY_ID` = `acme:pilot-001`
  - `ENTITY_CHAIN_ID` (EntityAnchorChain, shared) = `0x451114f9db3b6226bc8c3dd79a21796408a75eb983a6701d345e449f25b4162f`
  - `ENTITY_CAP_ID` (AnchorCap, owned) = `0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9`
- **AI routing is CODE not model:** `confidence >= AI_CONFIDENCE_THRESHOLD` (default `0.85`) → `AUTO`, else `NEEDS_REVIEW`. Model ids + threshold come from env (`AI_MODEL_CLASSIFY=gemini-3.5-flash-lite`, `AI_MODEL_COPILOT=gemini-3.5-flash`, `AI_CONFIDENCE_THRESHOLD=0.85`).
- **Fail-closed everywhere:** AI timeout / bad schema / NaN / out-of-range confidence → `NEEDS_REVIEW` (never AUTO). Illegal state transitions → 4xx error, no write. Anchor seq/link mismatch → no `ANCHORED` write.
- **Unified error envelope:** every error response body is exactly `{ "error": { "code": string, "message": string } }`. 4xx = user/state-machine; 5xx = upstream (Sui/Gemini).
- **Structural AI guardrail (compile-time):** journal writes live ONLY in `store/journalStore.ts`; nothing under `src/ai/` may import it. AI persists ONLY through `store/eventStore.ts#setAiSuggestion`.
- **Anti-tamper:** `/anchor/prepare` reads `manifestHash`/`merkleRoot` from the SERVER snapshot row, never from client input. Client may supply only `snapshotId` + `walletAddress`.
- **Per-entity anchor mutex:** at most one in-flight prepare→confirm per `entityId`.

---

## Task Map / File Structure

- **Task 1** — `services/ingestion` library export `normalizeFixture` (+ index export).
- **Task 2** — `services/api` scaffold (package.json with `file:../` deps, tsconfig, vitest, `.env` template, `.gitignore`, `deps/` chokepoints, config loader).
- **Task 3** — SQLite store: schema + `db.ts` + `entityStore`/`eventStore`/`journalStore`/`snapshotStore`/`anchorStore`, seed, structural guardrail.
- **Task 4** — State machine module (`store/stateMachine.ts`) — legal-transition tables, fail-closed.
- **Task 5** — `ai/geminiClient.ts` provider seam + `ai/classify.ts` (`classifyEvent`) + `ai/copilot.ts` (`reviewCopilot`), code-based routing, fail-closed.
- **Task 6** — anchor-svc refactor: `buildAnchorPtb` (unsigned IR), `confirmAnchor`, gRPC adapter (`SuiGrpcChainAdapter`), cap-owner preflight, per-entity mutex helper.
- **Task 7** — Fastify server + 13 routes + unified error envelope + `services/api/src/server.ts`.
- **Task 8** — `services/api/scripts/demo-e2e.ts` (test-key sign fallback) + `scripts/gen-assets.ts` stub is OUT OF SCOPE (frontend plan) — only demo-e2e here.
- **Task 9** — Monkey tests (oversized fixture, NaN/out-of-range confidence, duplicate ingest, concurrent anchor, forged digest).

> Tasks 1 and 6 modify EXISTING services (`ingestion`, `anchor-svc`); Tasks 2–5, 7–9 create `services/api`. Rules-engine and snapshot-svc are consumed unchanged EXCEPT Task 1 (ingestion) and a rules-engine export addition folded into Task 7 (export `leafHash`, `inclusionProof`, `verifyInclusion`, `NormalizedEvent`, `RunContext`, `ResolvedPolicySet`, `ClassificationAssessment`, `AnchorPayload`-consumers) — see Task 7 step 0.

---

### Task 1: ingestion `normalizeFixture` library export

**Files:**
- Create: `<root>/services/ingestion/src/normalize/normalizeFixture.ts`
- Modify: `<root>/services/ingestion/src/index.ts`
- Test: `<root>/services/ingestion/test/normalizeFixture.test.ts`

**Interfaces:**
- Consumes (from `src/core/deconstruct.js`): `deconstruct(env: RawTxEnvelope, opts?) => { effects: RawEffect[]; overflow: boolean }`; types `RawTxEnvelope`, `RawEffect` from `src/domain/types.js`.
- Consumes (from `@subledger/rules-engine`): type `NormalizedEvent` — but ingestion does NOT yet depend on rules-engine. To avoid widening ingestion's dep graph, define the output type LOCALLY as `NormalizedFixtureEvent` (structurally identical to rules-engine `NormalizedEvent`) and re-map in the API. Exact shape below.
- Produces: `export function normalizeFixture(fixture: FixtureBundle): NormalizedFixtureEvent[]` and `export interface FixtureBundle`, `export interface NormalizedFixtureEvent`. Re-exported from `services/ingestion/src/index.ts`.

```ts
// NormalizedFixtureEvent — field-for-field compatible with rules-engine NormalizedEvent.
export interface NormalizedFixtureEvent {
  schemaVersion: string;
  eventId: string;
  eventType: 'DIGITAL_ASSET_RECEIPT' | 'DIGITAL_ASSET_PAYMENT' | 'INTERNAL_TRANSFER' | 'SPOT_TRADE_SWAP' | 'GAS_FEE';
  eventGroupId: string | null;
  entityId: string;
  bookId: string;
  wallet: string;
  counterparty: string | null;
  coinType: string;
  assetDecimals: number;
  quantityMinor: string;
  eventTime: string;
  economicPurpose: string;
  ownershipChange: boolean;
  considerationAsset: string | null;
  considerationQtyMinor: string | null;
  considerationDecimals: number | null;
  rawPayloadHash: string;
  txDigest: string;
  eventIndex: number;
}

// FixtureBundle — the deterministic recording-safe fixture the API loads from disk.
// Each row already carries the accounting-relevant fields (the demo fixture is hand-curated;
// deconstruct() supplies lineage + a sanity overflow guard, not full normalization).
export interface FixtureBundle {
  chainId: string;
  epoch: number;
  events: Array<{
    raw: RawTxEnvelope;            // fed to deconstruct() for overflow guard + lineage
    normalized: Omit<NormalizedFixtureEvent, 'rawPayloadHash' | 'txDigest' | 'eventIndex'>;
  }>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// services/ingestion/test/normalizeFixture.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeFixture, type FixtureBundle } from '../src/normalize/normalizeFixture.js';

const baseRaw = {
  digest: 'DIG1', checkpoint: '100', timestampMs: '1700000000000',
  status: 'success' as const,
  rawJson: { balanceChanges: [{ coinType: '0x2::sui::SUI', amount: '5000000000', owner: { AddressOwner: '0xcp' } }] },
};
const bundle: FixtureBundle = {
  chainId: 'testnet', epoch: 1,
  events: [{
    raw: baseRaw,
    normalized: {
      schemaVersion: 'v1', eventId: 'e1', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
      entityId: 'acme:pilot-001', bookId: 'main', wallet: '0xself', counterparty: '0xcp',
      coinType: '0x2::sui::SUI', assetDecimals: 9, quantityMinor: '5000000000',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'RECEIVABLE_SETTLEMENT',
      ownershipChange: true, considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    },
  }],
};

describe('normalizeFixture', () => {
  it('maps each fixture row to a NormalizedFixtureEvent with lineage from deconstruct', () => {
    const out = normalizeFixture(bundle);
    expect(out).toHaveLength(1);
    expect(out[0]!.eventId).toBe('e1');
    expect(out[0]!.txDigest).toBe('DIG1');       // lineage from raw.digest
    expect(out[0]!.eventIndex).toBe(0);
    expect(out[0]!.rawPayloadHash).toMatch(/^[0-9a-f]{64}$/); // contentHash of rawJson
    expect(out[0]!.quantityMinor).toBe('5000000000');
  });

  it('throws FIXTURE_OVERFLOW when a raw tx produces more effects than the guard allows', () => {
    const many = { ...baseRaw, rawJson: { balanceChanges: Array.from({ length: 3 }, (_, i) => ({ coinType: 'c', amount: String(i), owner: { AddressOwner: 'o' } })) } };
    const over: FixtureBundle = { chainId: 'testnet', epoch: 1, events: [{ raw: many, normalized: bundle.events[0]!.normalized }] };
    expect(() => normalizeFixture(over, { maxEffects: 2 })).toThrowError(/FIXTURE_OVERFLOW/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <root>/services/ingestion && npx vitest run test/normalizeFixture.test.ts`
Expected: FAIL — `Cannot find module '../src/normalize/normalizeFixture.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// services/ingestion/src/normalize/normalizeFixture.ts
import { deconstruct } from '../core/deconstruct.js';
import { contentHash } from '../core/contentHash.js';
import type { RawTxEnvelope } from '../domain/types.js';

export interface NormalizedFixtureEvent {
  schemaVersion: string;
  eventId: string;
  eventType: 'DIGITAL_ASSET_RECEIPT' | 'DIGITAL_ASSET_PAYMENT' | 'INTERNAL_TRANSFER' | 'SPOT_TRADE_SWAP' | 'GAS_FEE';
  eventGroupId: string | null;
  entityId: string;
  bookId: string;
  wallet: string;
  counterparty: string | null;
  coinType: string;
  assetDecimals: number;
  quantityMinor: string;
  eventTime: string;
  economicPurpose: string;
  ownershipChange: boolean;
  considerationAsset: string | null;
  considerationQtyMinor: string | null;
  considerationDecimals: number | null;
  rawPayloadHash: string;
  txDigest: string;
  eventIndex: number;
}

export interface FixtureBundle {
  chainId: string;
  epoch: number;
  events: Array<{
    raw: RawTxEnvelope;
    normalized: Omit<NormalizedFixtureEvent, 'rawPayloadHash' | 'txDigest' | 'eventIndex'>;
  }>;
}

/**
 * Turn a hand-curated, recording-safe fixture into NormalizedFixtureEvent[].
 * deconstruct() is run over each raw envelope purely as an OVERFLOW GUARD + to keep
 * the raw→effect path exercised; the accounting fields come from the curated `normalized`
 * block (the demo does not infer them). Lineage (txDigest, eventIndex, rawPayloadHash)
 * is derived deterministically here so two ingests of the same fixture are identical.
 */
export function normalizeFixture(
  fixture: FixtureBundle,
  opts: { maxEffects?: number } = {},
): NormalizedFixtureEvent[] {
  const out: NormalizedFixtureEvent[] = [];
  for (let i = 0; i < fixture.events.length; i++) {
    const row = fixture.events[i]!;
    const { overflow } = deconstruct(row.raw, opts);
    if (overflow) {
      throw new Error(`FIXTURE_OVERFLOW: event index ${i} (digest=${row.raw.digest}) exceeded maxEffects`);
    }
    out.push({
      ...row.normalized,
      rawPayloadHash: contentHash(row.raw.rawJson),
      txDigest: row.raw.digest,
      eventIndex: i,
    });
  }
  return out;
}
```

- [ ] **Step 4: Add the index export**

```ts
// services/ingestion/src/index.ts
export const ingestionVersion = '0.1.0';
export { normalizeFixture } from './normalize/normalizeFixture.js';
export type { NormalizedFixtureEvent, FixtureBundle } from './normalize/normalizeFixture.js';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd <root>/services/ingestion && npx vitest run test/normalizeFixture.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests), no type errors.
(If `contentHash` signature differs, read `src/core/contentHash.ts` and adapt the call — it takes the `rawJson` value and returns a 64-hex string.)

- [ ] **Step 6: Commit**

```bash
git -C <root> add services/ingestion/src/normalize/normalizeFixture.ts services/ingestion/src/index.ts services/ingestion/test/normalizeFixture.test.ts
git -C <root> commit -m "feat(ingestion): add normalizeFixture library export for API"
```

---

### Task 2: `services/api` scaffold

**Files:**
- Create: `<root>/services/api/package.json`
- Create: `<root>/services/api/tsconfig.json`
- Create: `<root>/services/api/vitest.config.ts`
- Create: `<root>/services/api/.gitignore`
- Create: `<root>/services/api/.env.example`
- Create: `<root>/services/api/src/config.ts`
- Create: `<root>/services/api/src/deps/rulesEngine.ts`
- Create: `<root>/services/api/src/deps/snapshotSvc.ts`
- Create: `<root>/services/api/src/deps/anchorSvc.ts`
- Create: `<root>/services/api/src/deps/ingestion.ts`
- Test: `<root>/services/api/test/scaffold.test.ts`

**Interfaces:**
- Produces (config): `export interface ApiConfig { port: number; dbPath: string; suiNetwork: string; suiGrpcUrl: string; anchorPackageId: string; anchorOriginalPackageId: string; entityId: string; entityChainId: string; entityCapId: string; suiPk?: string; geminiApiKey: string; aiModelClassify: string; aiModelCopilot: string; aiConfidenceThreshold: number; explorerBase: string }` and `export function loadConfig(env?: NodeJS.ProcessEnv): ApiConfig`.
- Produces (`deps/*`): single chokepoints re-exporting the 4 services (mirrors snapshot-svc's `deps/rulesEngine.ts` convention).

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@subledger/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "demo:e2e": "tsx scripts/demo-e2e.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^0.3.0",
    "@mysten/sui": "2.19.0",
    "@subledger/anchor-svc": "file:../anchor-svc",
    "@subledger/ingestion": "file:../ingestion",
    "@subledger/rules-engine": "file:../rules-engine",
    "@subledger/snapshot-svc": "file:../snapshot-svc",
    "better-sqlite3": "^11.0.0",
    "fastify": "^4.28.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

> NOTE: confirm the actual published `@google/genai` and `better-sqlite3`/`fastify` versions at install time (`npm view <pkg> version`); pin to whatever installs cleanly on Node 20. `ingestion`/`rules-engine`/`anchor-svc` package names: `ingestion`'s `name` field may be `@subledger/ingestion` — verify each `services/*/package.json` `name` and match the `file:` key to it. (rules-engine = `@subledger/rules-engine`, snapshot-svc = `@subledger/snapshot-svc`, anchor-svc = `@subledger/anchor-svc` confirmed; check ingestion and align both its `name` and this dep key.)

- [ ] **Step 2: Create tsconfig.json** (identical to other services)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "baseUrl": "."
  },
  "include": ["src", "test", "scripts"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 4: Create .gitignore** (the .env and the sqlite db MUST be ignored)

```gitignore
node_modules
dist
.env
data/
*.db
*.db-journal
*.db-wal
src/assets/generated/
```

- [ ] **Step 5: Create .env.example** (template; the real `.env` is git-ignored and filled by the user)

```bash
SUI_NETWORK=testnet
SUI_GRPC_URL=
ANCHOR_PACKAGE_ID=0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d
ANCHOR_ORIGINAL_PACKAGE_ID=0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d
ENTITY_ID=acme:pilot-001
ENTITY_CHAIN_ID=0x451114f9db3b6226bc8c3dd79a21796408a75eb983a6701d345e449f25b4162f
ENTITY_CAP_ID=0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9
SUI_PK=
GEMINI_API_KEY=
AI_MODEL_CLASSIFY=gemini-3.5-flash-lite
AI_MODEL_COPILOT=gemini-3.5-flash
AI_CONFIDENCE_THRESHOLD=0.85
PORT=8787
DB_PATH=./data/tallymarina.db
EXPLORER_BASE=https://suiscan.xyz/testnet
```

- [ ] **Step 6: Write the failing scaffold test**

```ts
// services/api/test/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc',
  ANCHOR_PACKAGE_ID: '0xpkg', ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg',
  ENTITY_ID: 'acme:pilot-001', ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
};

describe('loadConfig', () => {
  it('parses env into typed config with numeric threshold + port', () => {
    const c = loadConfig(baseEnv);
    expect(c.port).toBe(8787);
    expect(c.aiConfidenceThreshold).toBeCloseTo(0.85);
    expect(c.entityId).toBe('acme:pilot-001');
  });
  it('throws when a required key is missing', () => {
    const { GEMINI_API_KEY, ...rest } = baseEnv;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrowError(/GEMINI_API_KEY/);
  });
  it('throws when threshold is out of [0,1]', () => {
    expect(() => loadConfig({ ...baseEnv, AI_CONFIDENCE_THRESHOLD: '1.5' })).toThrowError(/AI_CONFIDENCE_THRESHOLD/);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd <root>/services/api && npm install && npx vitest run test/scaffold.test.ts`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 8: Implement config.ts**

```ts
// services/api/src/config.ts
export interface ApiConfig {
  port: number;
  dbPath: string;
  suiNetwork: string;
  suiGrpcUrl: string;
  anchorPackageId: string;
  anchorOriginalPackageId: string;
  entityId: string;
  entityChainId: string;
  entityCapId: string;
  suiPk?: string;
  geminiApiKey: string;
  aiModelClassify: string;
  aiModelCopilot: string;
  aiConfidenceThreshold: number;
  explorerBase: string;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (v === undefined || v === '') throw new Error(`missing required env: ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const threshold = Number(req(env, 'AI_CONFIDENCE_THRESHOLD'));
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`AI_CONFIDENCE_THRESHOLD must be a number in [0,1], got ${env.AI_CONFIDENCE_THRESHOLD}`);
  }
  const port = Number(req(env, 'PORT'));
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT must be a positive integer, got ${env.PORT}`);
  return {
    port,
    dbPath: req(env, 'DB_PATH'),
    suiNetwork: req(env, 'SUI_NETWORK'),
    suiGrpcUrl: req(env, 'SUI_GRPC_URL'),
    anchorPackageId: req(env, 'ANCHOR_PACKAGE_ID'),
    anchorOriginalPackageId: req(env, 'ANCHOR_ORIGINAL_PACKAGE_ID'),
    entityId: req(env, 'ENTITY_ID'),
    entityChainId: req(env, 'ENTITY_CHAIN_ID'),
    entityCapId: req(env, 'ENTITY_CAP_ID'),
    suiPk: env.SUI_PK && env.SUI_PK !== '' ? env.SUI_PK : undefined,
    geminiApiKey: req(env, 'GEMINI_API_KEY'),
    aiModelClassify: req(env, 'AI_MODEL_CLASSIFY'),
    aiModelCopilot: req(env, 'AI_MODEL_COPILOT'),
    aiConfidenceThreshold: threshold,
    explorerBase: req(env, 'EXPLORER_BASE'),
  };
}
```

- [ ] **Step 9: Implement the 4 deps chokepoints**

```ts
// services/api/src/deps/rulesEngine.ts
export { evaluate, buildMerkle } from '@subledger/rules-engine';
export type { RuleInput, RuleOutput, JournalEntry, JeLine, MerkleManifest, InclusionProof } from '@subledger/rules-engine';
```
```ts
// services/api/src/deps/snapshotSvc.ts
export { buildSnapshot, InMemorySnapshotRepo } from '@subledger/snapshot-svc';
export type { SnapshotMeta, AuditSnapshot, AnchorPayload, AuditSnapshotRepo, FreezeInput, FreezeResult } from '@subledger/snapshot-svc';
```
```ts
// services/api/src/deps/anchorSvc.ts
export { buildAnchorArgs, deriveEntityRef, AnchorError } from '@subledger/anchor-svc';
export type { AnchorPayloadInput, EntityRegistry, ChainState, AnchorResult } from '@subledger/anchor-svc';
```
```ts
// services/api/src/deps/ingestion.ts
export { normalizeFixture } from '@subledger/ingestion';
export type { NormalizedFixtureEvent, FixtureBundle } from '@subledger/ingestion';
```

> If `@subledger/rules-engine` does not yet re-export `leafHash`/`inclusionProof`/`verifyInclusion`, Task 7 step 0 adds them; this chokepoint will re-export them then.

- [ ] **Step 10: Run tests + typecheck**

Run: `cd <root>/services/api && npx vitest run test/scaffold.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests). If `tsc` errors on a deps export not yet present, comment that single line and restore it in the task that introduces it.

- [ ] **Step 11: Commit**

```bash
git -C <root> add services/api/package.json services/api/tsconfig.json services/api/vitest.config.ts services/api/.gitignore services/api/.env.example services/api/src/config.ts services/api/src/deps services/api/test/scaffold.test.ts
git -C <root> commit -m "feat(api): scaffold Fastify api service (config, deps chokepoints, env template)"
```

---

### Task 4: State machine module (do BEFORE the stores so they can call it)

**Files:**
- Create: `<root>/services/api/src/store/stateMachine.ts`
- Test: `<root>/services/api/test/stateMachine.test.ts`

**Interfaces:**
- Produces:
  - `export type EventStatus = 'INGESTED' | 'AUTO' | 'NEEDS_REVIEW' | 'APPROVED' | 'POSTED'`
  - `export type SnapshotStatus = 'DRAFT' | 'FROZEN' | 'ANCHORED'`
  - `export class StateError extends Error { code: 'ILLEGAL_TRANSITION'; from: string; to: string }`
  - `export function assertEventTransition(from: EventStatus, to: EventStatus): void`
  - `export function assertSnapshotTransition(from: SnapshotStatus, to: SnapshotStatus): void`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/stateMachine.test.ts
import { describe, it, expect } from 'vitest';
import { assertEventTransition, assertSnapshotTransition, StateError } from '../src/store/stateMachine.js';

describe('event state machine', () => {
  it('allows legal transitions', () => {
    expect(() => assertEventTransition('INGESTED', 'AUTO')).not.toThrow();
    expect(() => assertEventTransition('INGESTED', 'NEEDS_REVIEW')).not.toThrow();
    expect(() => assertEventTransition('NEEDS_REVIEW', 'APPROVED')).not.toThrow();
    expect(() => assertEventTransition('APPROVED', 'POSTED')).not.toThrow();
    expect(() => assertEventTransition('AUTO', 'POSTED')).not.toThrow();
  });
  it('fails closed on illegal transitions', () => {
    expect(() => assertEventTransition('POSTED', 'AUTO')).toThrowError(StateError);
    expect(() => assertEventTransition('INGESTED', 'POSTED')).toThrowError(/ILLEGAL_TRANSITION/);
    expect(() => assertEventTransition('NEEDS_REVIEW', 'POSTED')).toThrowError(StateError);
  });
});

describe('snapshot state machine', () => {
  it('allows DRAFT->FROZEN->ANCHORED', () => {
    expect(() => assertSnapshotTransition('DRAFT', 'FROZEN')).not.toThrow();
    expect(() => assertSnapshotTransition('FROZEN', 'ANCHORED')).not.toThrow();
  });
  it('fails closed: cannot re-anchor or skip', () => {
    expect(() => assertSnapshotTransition('ANCHORED', 'ANCHORED')).toThrowError(StateError);
    expect(() => assertSnapshotTransition('DRAFT', 'ANCHORED')).toThrowError(StateError);
    expect(() => assertSnapshotTransition('FROZEN', 'DRAFT')).toThrowError(StateError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <root>/services/api && npx vitest run test/stateMachine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement stateMachine.ts**

```ts
// services/api/src/store/stateMachine.ts
export type EventStatus = 'INGESTED' | 'AUTO' | 'NEEDS_REVIEW' | 'APPROVED' | 'POSTED';
export type SnapshotStatus = 'DRAFT' | 'FROZEN' | 'ANCHORED';

export class StateError extends Error {
  readonly code = 'ILLEGAL_TRANSITION' as const;
  constructor(public readonly from: string, public readonly to: string) {
    super(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
    this.name = 'StateError';
  }
}

// classify writes AUTO|NEEDS_REVIEW from INGESTED; decide -> APPROVED; run-rules -> POSTED.
const EVENT_LEGAL: Record<EventStatus, EventStatus[]> = {
  INGESTED: ['AUTO', 'NEEDS_REVIEW'],
  AUTO: ['POSTED'],
  NEEDS_REVIEW: ['APPROVED'],
  APPROVED: ['POSTED'],
  POSTED: [],
};

const SNAPSHOT_LEGAL: Record<SnapshotStatus, SnapshotStatus[]> = {
  DRAFT: ['FROZEN'],
  FROZEN: ['ANCHORED'],
  ANCHORED: [],
};

export function assertEventTransition(from: EventStatus, to: EventStatus): void {
  if (!EVENT_LEGAL[from].includes(to)) throw new StateError(from, to);
}

export function assertSnapshotTransition(from: SnapshotStatus, to: SnapshotStatus): void {
  if (!SNAPSHOT_LEGAL[from].includes(to)) throw new StateError(from, to);
}
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `cd <root>/services/api && npx vitest run test/stateMachine.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <root> add services/api/src/store/stateMachine.ts services/api/test/stateMachine.test.ts
git -C <root> commit -m "feat(api): fail-closed event + snapshot state machines"
```

---

### Task 3: SQLite store layer + seed + structural AI guardrail

**Files:**
- Create: `<root>/services/api/src/store/db.ts` (open connection + run schema)
- Create: `<root>/services/api/src/store/schema.sql`
- Create: `<root>/services/api/src/store/entityStore.ts`
- Create: `<root>/services/api/src/store/eventStore.ts`  (AI's ONLY write path: `setAiSuggestion`)
- Create: `<root>/services/api/src/store/journalStore.ts` (NOT importable by `ai/`)
- Create: `<root>/services/api/src/store/snapshotStore.ts`
- Create: `<root>/services/api/src/store/anchorStore.ts`
- Create: `<root>/services/api/src/store/seed.ts`
- Create: `<root>/services/api/src/fixtures/acme-pilot-001.events.json`
- Test: `<root>/services/api/test/store.test.ts`
- Test (guardrail): `<root>/services/api/test/aiGuardrail.test.ts`

**Interfaces:**
- Produces (`db.ts`): `export type Db = import('better-sqlite3').Database;` `export function openDb(path: string): Db` (runs `schema.sql`, sets `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`).
- Produces (`entityStore.ts`):
  - `export interface EntityRow { id: string; displayName: string; chainObjectId: string; capObjectId: string; originalPackageId: string }`
  - `export function listEntities(db: Db): EntityRow[]`
  - `export function getEntity(db: Db, id: string): EntityRow | null`
  - `export function insertEntity(db: Db, e: EntityRow): void`
- Produces (`eventStore.ts`):
  - `export interface EventRow { id: string; entityId: string; rawJson: string; aiEventType: string|null; aiPurpose: string|null; aiCounterparty: string|null; aiConfidence: number|null; aiReasoning: string|null; finalEventType: string|null; finalPurpose: string|null; status: EventStatus }`
  - `export function insertEvent(db: Db, e: { id: string; entityId: string; rawJson: string }): void` (status forced `'INGESTED'`)
  - `export function listEvents(db: Db, entityId: string): EventRow[]`
  - `export function getEvent(db: Db, id: string): EventRow | null`
  - `export function listByStatus(db: Db, entityId: string, status: EventStatus): EventRow[]`
  - `export function setAiSuggestion(db: Db, eventId: string, s: { aiEventType: string; aiPurpose: string; aiCounterparty: string|null; aiConfidence: number; aiReasoning: string; nextStatus: 'AUTO'|'NEEDS_REVIEW' }): void` — validates `INGESTED -> nextStatus` via `assertEventTransition`. **This is the ONLY write the `ai/` layer may call.**
  - `export function setDecision(db: Db, eventId: string, d: { finalEventType: string; finalPurpose: string }): void` — validates `NEEDS_REVIEW|AUTO -> APPROVED`.
  - `export function markPosted(db: Db, eventId: string): void` — validates `APPROVED|AUTO -> POSTED`.
- Produces (`journalStore.ts`) — **NOT imported anywhere under `src/ai/`**:
  - `export interface JournalRow { id: string; entityId: string; eventId: string; jeJson: string; idempotencyKey: string; leafHash: string }`
  - `export function insertJournalEntry(db: Db, r: JournalRow): 'inserted'|'duplicate'` (UNIQUE on idempotency_key → duplicate is swallowed idempotently)
  - `export function listJournal(db: Db, entityId: string): JournalRow[]`
- Produces (`snapshotStore.ts`):
  - `export interface SnapshotRow { id: string; entityId: string; periodId: string; manifestJson: string; manifestHash: string; merkleRoot: string; leafCount: number; supersedesSeq: number|null; status: SnapshotStatus }`
  - `export function insertSnapshot(db: Db, r: Omit<SnapshotRow,'status'> & { status?: SnapshotStatus }): void` (default `'FROZEN'`)
  - `export function getSnapshot(db: Db, id: string): SnapshotRow | null`
  - `export function setSnapshotStatus(db: Db, id: string, to: SnapshotStatus): void` (validates via `assertSnapshotTransition` against current row)
- Produces (`anchorStore.ts`):
  - `export interface AnchorRow { id: string; entityId: string; snapshotId: string; seq: number; link: string; digest: string; explorerUrl: string; anchoredAt: string }`
  - `export function insertAnchor(db: Db, r: AnchorRow): void`
  - `export function listAnchors(db: Db, entityId: string): AnchorRow[]`
- Produces (`seed.ts`): `export function seed(db: Db, cfg: { entityId: string; entityChainId: string; entityCapId: string; originalPackageId: string }, fixture: import('../deps/ingestion.js').FixtureBundle): void` — inserts the entity row + ingests the fixture events (idempotent: skip if entity already present).

- [ ] **Step 1: Write schema.sql**

```sql
-- services/api/src/store/schema.sql
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  chain_object_id TEXT NOT NULL,
  cap_object_id TEXT NOT NULL,
  original_package_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  raw_json TEXT NOT NULL,
  ai_event_type TEXT, ai_purpose TEXT, ai_counterparty TEXT,
  ai_confidence REAL, ai_reasoning TEXT,
  final_event_type TEXT, final_purpose TEXT,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  je_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  leaf_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  period_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  leaf_count INTEGER NOT NULL,
  supersedes_seq INTEGER,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  seq INTEGER NOT NULL,
  link TEXT NOT NULL,
  digest TEXT NOT NULL,
  explorer_url TEXT NOT NULL,
  anchored_at TEXT NOT NULL
);
```

- [ ] **Step 2: Write the failing store test**

```ts
// services/api/test/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity, listEntities, getEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, getEvent, listByStatus, setDecision, markPosted } from '../src/store/eventStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { StateError } from '../src/store/stateMachine.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
});

describe('entityStore', () => {
  it('inserts and lists entities', () => {
    expect(listEntities(db)).toHaveLength(1);
    expect(getEntity(db, 'acme:pilot-001')?.displayName).toBe('Acme');
  });
});

describe('eventStore state-gated writes', () => {
  it('setAiSuggestion routes INGESTED -> AUTO and persists ai_* fields', () => {
    insertEvent(db, { id: 'e1', entityId: 'acme:pilot-001', rawJson: '{}' });
    setAiSuggestion(db, 'e1', { aiEventType: 'DIGITAL_ASSET_RECEIPT', aiPurpose: 'X', aiCounterparty: null, aiConfidence: 0.91, aiReasoning: 'r', nextStatus: 'AUTO' });
    const ev = getEvent(db, 'e1')!;
    expect(ev.status).toBe('AUTO');
    expect(ev.aiConfidence).toBeCloseTo(0.91);
    expect(listByStatus(db, 'acme:pilot-001', 'AUTO')).toHaveLength(1);
  });
  it('decide then post follows the legal chain', () => {
    insertEvent(db, { id: 'e2', entityId: 'acme:pilot-001', rawJson: '{}' });
    setAiSuggestion(db, 'e2', { aiEventType: 'X', aiPurpose: 'Y', aiCounterparty: null, aiConfidence: 0.5, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW' });
    setDecision(db, 'e2', { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'Z' });
    expect(getEvent(db, 'e2')!.status).toBe('APPROVED');
    markPosted(db, 'e2');
    expect(getEvent(db, 'e2')!.status).toBe('POSTED');
  });
  it('rejects illegal: cannot decide an INGESTED event', () => {
    insertEvent(db, { id: 'e3', entityId: 'acme:pilot-001', rawJson: '{}' });
    expect(() => setDecision(db, 'e3', { finalEventType: 'X', finalPurpose: 'Y' })).toThrowError(StateError);
  });
});

describe('journalStore idempotency', () => {
  it('second insert with same idempotency_key is a no-op duplicate', () => {
    insertEvent(db, { id: 'e4', entityId: 'acme:pilot-001', rawJson: '{}' });
    const row = { id: 'j1', entityId: 'acme:pilot-001', eventId: 'e4', jeJson: '{}', idempotencyKey: 'K1', leafHash: 'abcd' };
    expect(insertJournalEntry(db, row)).toBe('inserted');
    expect(insertJournalEntry(db, { ...row, id: 'j2' })).toBe('duplicate');
    expect(listJournal(db, 'acme:pilot-001')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd <root>/services/api && npx vitest run test/store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement db.ts**

```ts
// services/api/src/store/db.ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type Db = Database.Database;

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

> NOTE: `schema.sql` is read relative to the compiled file. Since we run via `tsx` (no build), `import.meta.url` points at the `.ts` source dir, so `schema.sql` sitting beside `db.ts` resolves correctly. If a build step is ever added, copy `schema.sql` to `dist/store/`.

- [ ] **Step 5: Implement entityStore.ts**

```ts
// services/api/src/store/entityStore.ts
import type { Db } from './db.js';

export interface EntityRow {
  id: string; displayName: string; chainObjectId: string; capObjectId: string; originalPackageId: string;
}

export function insertEntity(db: Db, e: EntityRow): void {
  db.prepare(
    'INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES (?, ?, ?, ?, ?)',
  ).run(e.id, e.displayName, e.chainObjectId, e.capObjectId, e.originalPackageId);
}

function map(r: Record<string, unknown>): EntityRow {
  return {
    id: r.id as string, displayName: r.display_name as string,
    chainObjectId: r.chain_object_id as string, capObjectId: r.cap_object_id as string,
    originalPackageId: r.original_package_id as string,
  };
}

export function listEntities(db: Db): EntityRow[] {
  return (db.prepare('SELECT * FROM entities ORDER BY id').all() as Record<string, unknown>[]).map(map);
}

export function getEntity(db: Db, id: string): EntityRow | null {
  const r = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}
```

- [ ] **Step 6: Implement eventStore.ts** (the AI write chokepoint — it imports `stateMachine`, NOT `journalStore`)

```ts
// services/api/src/store/eventStore.ts
import type { Db } from './db.js';
import { assertEventTransition, type EventStatus } from './stateMachine.js';

export interface EventRow {
  id: string; entityId: string; rawJson: string;
  aiEventType: string | null; aiPurpose: string | null; aiCounterparty: string | null;
  aiConfidence: number | null; aiReasoning: string | null;
  finalEventType: string | null; finalPurpose: string | null;
  status: EventStatus;
}

function map(r: Record<string, unknown>): EventRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, rawJson: r.raw_json as string,
    aiEventType: (r.ai_event_type as string | null) ?? null,
    aiPurpose: (r.ai_purpose as string | null) ?? null,
    aiCounterparty: (r.ai_counterparty as string | null) ?? null,
    aiConfidence: (r.ai_confidence as number | null) ?? null,
    aiReasoning: (r.ai_reasoning as string | null) ?? null,
    finalEventType: (r.final_event_type as string | null) ?? null,
    finalPurpose: (r.final_purpose as string | null) ?? null,
    status: r.status as EventStatus,
  };
}

export function insertEvent(db: Db, e: { id: string; entityId: string; rawJson: string }): void {
  db.prepare('INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, ?, ?)')
    .run(e.id, e.entityId, e.rawJson, 'INGESTED');
}

export function getEvent(db: Db, id: string): EventRow | null {
  const r = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listEvents(db: Db, entityId: string): EventRow[] {
  return (db.prepare('SELECT * FROM events WHERE entity_id = ? ORDER BY id').all(entityId) as Record<string, unknown>[]).map(map);
}

export function listByStatus(db: Db, entityId: string, status: EventStatus): EventRow[] {
  return (db.prepare('SELECT * FROM events WHERE entity_id = ? AND status = ? ORDER BY id').all(entityId, status) as Record<string, unknown>[]).map(map);
}

function current(db: Db, eventId: string): EventRow {
  const ev = getEvent(db, eventId);
  if (!ev) throw new Error(`EVENT_NOT_FOUND: ${eventId}`);
  return ev;
}

/** The ONLY write the ai/ layer is permitted to call. */
export function setAiSuggestion(
  db: Db, eventId: string,
  s: { aiEventType: string; aiPurpose: string; aiCounterparty: string | null; aiConfidence: number; aiReasoning: string; nextStatus: 'AUTO' | 'NEEDS_REVIEW' },
): void {
  const ev = current(db, eventId);
  assertEventTransition(ev.status, s.nextStatus);
  db.prepare(
    'UPDATE events SET ai_event_type=?, ai_purpose=?, ai_counterparty=?, ai_confidence=?, ai_reasoning=?, status=? WHERE id=?',
  ).run(s.aiEventType, s.aiPurpose, s.aiCounterparty, s.aiConfidence, s.aiReasoning, s.nextStatus, eventId);
}

export function setDecision(db: Db, eventId: string, d: { finalEventType: string; finalPurpose: string }): void {
  const ev = current(db, eventId);
  assertEventTransition(ev.status, 'APPROVED');
  db.prepare('UPDATE events SET final_event_type=?, final_purpose=?, status=? WHERE id=?')
    .run(d.finalEventType, d.finalPurpose, 'APPROVED', eventId);
}

export function markPosted(db: Db, eventId: string): void {
  const ev = current(db, eventId);
  assertEventTransition(ev.status, 'POSTED');
  db.prepare('UPDATE events SET status=? WHERE id=?').run('POSTED', eventId);
}
```

- [ ] **Step 7: Implement journalStore.ts** (the forbidden-to-AI module)

```ts
// services/api/src/store/journalStore.ts
// GUARDRAIL: nothing under src/ai/ may import this module. Enforced by test/aiGuardrail.test.ts.
import type { Db } from './db.js';

export interface JournalRow {
  id: string; entityId: string; eventId: string; jeJson: string; idempotencyKey: string; leafHash: string;
}

export function insertJournalEntry(db: Db, r: JournalRow): 'inserted' | 'duplicate' {
  const exists = db.prepare('SELECT 1 FROM journal_entries WHERE idempotency_key = ?').get(r.idempotencyKey);
  if (exists) return 'duplicate';
  db.prepare('INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(r.id, r.entityId, r.eventId, r.jeJson, r.idempotencyKey, r.leafHash);
  return 'inserted';
}

export function listJournal(db: Db, entityId: string): JournalRow[] {
  return (db.prepare('SELECT * FROM journal_entries WHERE entity_id = ? ORDER BY idempotency_key').all(entityId) as Record<string, unknown>[])
    .map((r) => ({
      id: r.id as string, entityId: r.entity_id as string, eventId: r.event_id as string,
      jeJson: r.je_json as string, idempotencyKey: r.idempotency_key as string, leafHash: r.leaf_hash as string,
    }));
}
```

- [ ] **Step 8: Implement snapshotStore.ts**

```ts
// services/api/src/store/snapshotStore.ts
import type { Db } from './db.js';
import { assertSnapshotTransition, type SnapshotStatus } from './stateMachine.js';

export interface SnapshotRow {
  id: string; entityId: string; periodId: string; manifestJson: string;
  manifestHash: string; merkleRoot: string; leafCount: number; supersedesSeq: number | null; status: SnapshotStatus;
}

function map(r: Record<string, unknown>): SnapshotRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, periodId: r.period_id as string,
    manifestJson: r.manifest_json as string, manifestHash: r.manifest_hash as string,
    merkleRoot: r.merkle_root as string, leafCount: r.leaf_count as number,
    supersedesSeq: (r.supersedes_seq as number | null) ?? null, status: r.status as SnapshotStatus,
  };
}

export function insertSnapshot(db: Db, r: Omit<SnapshotRow, 'status'> & { status?: SnapshotStatus }): void {
  db.prepare(
    'INSERT INTO snapshots (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, supersedes_seq, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(r.id, r.entityId, r.periodId, r.manifestJson, r.manifestHash, r.merkleRoot, r.leafCount, r.supersedesSeq, r.status ?? 'FROZEN');
}

export function getSnapshot(db: Db, id: string): SnapshotRow | null {
  const r = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function setSnapshotStatus(db: Db, id: string, to: SnapshotStatus): void {
  const cur = getSnapshot(db, id);
  if (!cur) throw new Error(`SNAPSHOT_NOT_FOUND: ${id}`);
  assertSnapshotTransition(cur.status, to);
  db.prepare('UPDATE snapshots SET status=? WHERE id=?').run(to, id);
}
```

- [ ] **Step 9: Implement anchorStore.ts**

```ts
// services/api/src/store/anchorStore.ts
import type { Db } from './db.js';

export interface AnchorRow {
  id: string; entityId: string; snapshotId: string; seq: number; link: string; digest: string; explorerUrl: string; anchoredAt: string;
}

export function insertAnchor(db: Db, r: AnchorRow): void {
  db.prepare('INSERT INTO anchors (id, entity_id, snapshot_id, seq, link, digest, explorer_url, anchored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.entityId, r.snapshotId, r.seq, r.link, r.digest, r.explorerUrl, r.anchoredAt);
}

export function listAnchors(db: Db, entityId: string): AnchorRow[] {
  return (db.prepare('SELECT * FROM anchors WHERE entity_id = ? ORDER BY seq').all(entityId) as Record<string, unknown>[])
    .map((r) => ({
      id: r.id as string, entityId: r.entity_id as string, snapshotId: r.snapshot_id as string,
      seq: r.seq as number, link: r.link as string, digest: r.digest as string,
      explorerUrl: r.explorer_url as string, anchoredAt: r.anchored_at as string,
    }));
}
```

- [ ] **Step 10: Implement seed.ts + fixture JSON**

```ts
// services/api/src/store/seed.ts
import type { Db } from './db.js';
import { getEntity, insertEntity } from './entityStore.js';
import { insertEvent } from './eventStore.js';
import { normalizeFixture, type FixtureBundle } from '../deps/ingestion.js';

export function seed(
  db: Db,
  cfg: { entityId: string; entityChainId: string; entityCapId: string; originalPackageId: string },
  fixture: FixtureBundle,
): void {
  if (getEntity(db, cfg.entityId)) return; // idempotent
  insertEntity(db, {
    id: cfg.entityId, displayName: 'Acme Pilot 001',
    chainObjectId: cfg.entityChainId, capObjectId: cfg.entityCapId, originalPackageId: cfg.originalPackageId,
  });
  const events = normalizeFixture(fixture);
  for (const ev of events) {
    insertEvent(db, { id: ev.eventId, entityId: cfg.entityId, rawJson: JSON.stringify(ev) });
  }
}
```

```json
// services/api/src/fixtures/acme-pilot-001.events.json
{
  "chainId": "testnet",
  "epoch": 1,
  "events": [
    {
      "raw": {
        "digest": "DEMOReceipt001",
        "checkpoint": "100",
        "timestampMs": "1717200000000",
        "status": "success",
        "rawJson": { "balanceChanges": [{ "coinType": "0x2::sui::SUI", "amount": "5000000000", "owner": { "AddressOwner": "0xcustomerA" } }] }
      },
      "normalized": {
        "schemaVersion": "v1", "eventId": "evt-001", "eventType": "DIGITAL_ASSET_RECEIPT", "eventGroupId": null,
        "entityId": "acme:pilot-001", "bookId": "main", "wallet": "0xacmeTreasury", "counterparty": "0xcustomerA",
        "coinType": "0x2::sui::SUI", "assetDecimals": 9, "quantityMinor": "5000000000",
        "eventTime": "2026-06-01T09:00:00Z", "economicPurpose": "RECEIVABLE_SETTLEMENT",
        "ownershipChange": true, "considerationAsset": null, "considerationQtyMinor": null, "considerationDecimals": null
      }
    },
    {
      "raw": {
        "digest": "DEMOPayment002",
        "checkpoint": "101",
        "timestampMs": "1717286400000",
        "status": "success",
        "rawJson": { "balanceChanges": [{ "coinType": "0x2::sui::SUI", "amount": "-1200000000", "owner": { "AddressOwner": "0xvendorB" } }] }
      },
      "normalized": {
        "schemaVersion": "v1", "eventId": "evt-002", "eventType": "DIGITAL_ASSET_PAYMENT", "eventGroupId": null,
        "entityId": "acme:pilot-001", "bookId": "main", "wallet": "0xacmeTreasury", "counterparty": "0xvendorB",
        "coinType": "0x2::sui::SUI", "assetDecimals": 9, "quantityMinor": "1200000000",
        "eventTime": "2026-06-02T09:00:00Z", "economicPurpose": "VENDOR_PAYMENT",
        "ownershipChange": true, "considerationAsset": null, "considerationQtyMinor": null, "considerationDecimals": null
      }
    }
  ]
}
```

> The fixture is HAND-CURATED to be recording-safe and to satisfy whatever `evaluate()` needs for `DIGITAL_ASSET_RECEIPT`/`DIGITAL_ASSET_PAYMENT`. At Task 7 (run-rules) you build the full `RuleInput` around these `NormalizedEvent`s; if `evaluate()` returns `REVIEW_REQUIRED`/`REJECTED` for a fixture row because of a missing price/fx/lot, ADD the needed `prices`/`fxRates`/`lots`/`coaMapping` entries to the run-rules `RuleInput` builder (Task 7), NOT to this fixture — keep the fixture limited to the normalized event shape.

- [ ] **Step 11: Run store test + typecheck**

Run: `cd <root>/services/api && npx vitest run test/store.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 12: Write the structural AI-guardrail test** (Rule 9 core — must fail if anyone wires AI into journal writes)

```ts
// services/api/test/aiGuardrail.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AI_DIR = new URL('../src/ai/', import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('AI structural guardrail (zero posting authority)', () => {
  it('no file under src/ai/ imports journalStore (directly or transitively via store barrel)', () => {
    const files = walk(AI_DIR);
    expect(files.length).toBeGreaterThan(0); // guard: ai/ must exist (created in Task 5)
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not import journalStore`).not.toMatch(/journalStore/);
      expect(src, `${f} must not import insertJournalEntry`).not.toMatch(/insertJournalEntry/);
    }
  });

  it('the only event write the ai/ layer references is setAiSuggestion', () => {
    for (const f of walk(AI_DIR)) {
      const src = readFileSync(f, 'utf8');
      // ai/ may import eventStore ONLY for setAiSuggestion; forbid the posting writers.
      expect(src, `${f} must not call markPosted`).not.toMatch(/markPosted/);
      expect(src, `${f} must not call setDecision`).not.toMatch(/setDecision/);
    }
  });
});
```

> This test is ordered to FAIL now (no `src/ai/` dir yet → `walk` throws). That is intentional: keep it RED until Task 5 creates `src/ai/`. To avoid a red suite between tasks, gate it: wrap the body in a `try { readdirSync(AI_DIR) } catch { it.skip }` ONLY if your runner aborts the whole file — otherwise leave it failing and let Task 5 turn it green. RECOMMENDED: move this test's COMMIT into Task 5 step (after `ai/` exists). Here, just author the file.

- [ ] **Step 13: Commit (store only; guardrail test lands green in Task 5)**

```bash
git -C <root> add services/api/src/store services/api/src/fixtures services/api/test/store.test.ts
git -C <root> commit -m "feat(api): sqlite store layer (entity/event/journal/snapshot/anchor) + seed + AI write chokepoint"
```

---

### Task 5: AI layer — Gemini provider seam, classify, copilot (code-routed, fail-closed)

**Files:**
- Create: `<root>/services/api/src/ai/geminiClient.ts` (provider seam — the ONLY module touching `@google/genai`)
- Create: `<root>/services/api/src/ai/types.ts`
- Create: `<root>/services/api/src/ai/classify.ts`  (`classifyEvent`)
- Create: `<root>/services/api/src/ai/copilot.ts`   (`reviewCopilot`)
- Test: `<root>/services/api/test/ai.classify.test.ts`
- Test: `<root>/services/api/test/ai.copilot.test.ts`
- (move) commit the guardrail test authored in Task 3 step 12 now that `src/ai/` exists.

**Interfaces:**
- Produces (`ai/types.ts`):
  - `export interface AiSuggestion { eventType: string; economicPurpose: string; counterparty: string | null; confidence: number; reasoning: string }`
  - `export interface CopilotAdvice { explanation: string; redFlags: string[]; suggestedEntry: { lines: Array<{ account: string; side: 'DEBIT'|'CREDIT'; amountMinor: string }> } | null; citations: string[] }`
  - `export type ClassifyRouting = 'AUTO' | 'NEEDS_REVIEW'`
  - `export interface ClassifyResult { suggestion: AiSuggestion; routing: ClassifyRouting; degraded: boolean }` (`degraded=true` when fail-closed fallback fired)
- Produces (`ai/geminiClient.ts`):
  - `export interface GeminiClient { generateJson<T>(args: { model: string; prompt: string; responseSchema: unknown; timeoutMs?: number }): Promise<T> }`
  - `export function makeGeminiClient(apiKey: string): GeminiClient`
- Produces (`ai/classify.ts`):
  - `export function classifyEvent(event: { rawJson: string }, deps: { client: GeminiClient; model: string; threshold: number }): Promise<ClassifyResult>`
- Produces (`ai/copilot.ts`):
  - `export function reviewCopilot(event: { rawJson: string }, context: { priorJournalSummary?: string }, deps: { client: GeminiClient; model: string }): Promise<CopilotAdvice>`
- **Guardrail:** these files import `ai/types.js` and `ai/geminiClient.js` only. They DO NOT import any `store/*`. Persisting the suggestion (calling `eventStore.setAiSuggestion`) happens in the ROUTE handler (Task 7), not here — so even `eventStore` is not imported by `ai/`, tightening the guardrail.

- [ ] **Step 1: Write failing classify test** (routing boundary + fail-closed)

```ts
// services/api/test/ai.classify.test.ts
import { describe, it, expect } from 'vitest';
import { classifyEvent } from '../src/ai/classify.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

function fakeClient(resp: unknown, opts: { throws?: boolean } = {}): GeminiClient {
  return {
    async generateJson() {
      if (opts.throws) throw new Error('gemini timeout');
      return resp as never;
    },
  };
}
const ev = { rawJson: '{"eventType":"DIGITAL_ASSET_RECEIPT"}' };
const base = { model: 'm', threshold: 0.85 };

describe('classifyEvent routing (code, not model)', () => {
  it('0.85 confidence routes AUTO (>= threshold)', async () => {
    const r = await classifyEvent(ev, { ...base, client: fakeClient({ eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'X', counterparty: null, confidence: 0.85, reasoning: 'r' }) });
    expect(r.routing).toBe('AUTO');
    expect(r.degraded).toBe(false);
  });
  it('0.84 confidence routes NEEDS_REVIEW (< threshold)', async () => {
    const r = await classifyEvent(ev, { ...base, client: fakeClient({ eventType: 'X', economicPurpose: 'Y', counterparty: null, confidence: 0.84, reasoning: 'r' }) });
    expect(r.routing).toBe('NEEDS_REVIEW');
  });
});

describe('classifyEvent fail-closed', () => {
  it('timeout/throw → NEEDS_REVIEW, degraded, confidence 0', async () => {
    const r = await classifyEvent(ev, { ...base, client: fakeClient(null, { throws: true }) });
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
    expect(r.suggestion.confidence).toBe(0);
  });
  it('NaN confidence → NEEDS_REVIEW + degraded', async () => {
    const r = await classifyEvent(ev, { ...base, client: fakeClient({ eventType: 'X', economicPurpose: 'Y', counterparty: null, confidence: Number.NaN, reasoning: 'r' }) });
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });
  it('out-of-range confidence (1.7) → NEEDS_REVIEW + degraded', async () => {
    const r = await classifyEvent(ev, { ...base, client: fakeClient({ eventType: 'X', economicPurpose: 'Y', counterparty: null, confidence: 1.7, reasoning: 'r' }) });
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });
  it('missing required field (bad schema) → NEEDS_REVIEW + degraded', async () => {
    const r = await classifyEvent(ev, { ...base, client: fakeClient({ confidence: 0.99 }) });
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <root>/services/api && npx vitest run test/ai.classify.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement ai/types.ts**

```ts
// services/api/src/ai/types.ts
export interface AiSuggestion {
  eventType: string;
  economicPurpose: string;
  counterparty: string | null;
  confidence: number;
  reasoning: string;
}
export interface CopilotAdvice {
  explanation: string;
  redFlags: string[];
  suggestedEntry: { lines: Array<{ account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }> } | null;
  citations: string[];
}
export type ClassifyRouting = 'AUTO' | 'NEEDS_REVIEW';
export interface ClassifyResult {
  suggestion: AiSuggestion;
  routing: ClassifyRouting;
  degraded: boolean;
}
```

- [ ] **Step 4: Implement ai/geminiClient.ts** (provider seam — swap to Claude = this one file)

```ts
// services/api/src/ai/geminiClient.ts
import { GoogleGenAI } from '@google/genai';

export interface GeminiClient {
  generateJson<T>(args: { model: string; prompt: string; responseSchema: unknown; timeoutMs?: number }): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 12_000;

export function makeGeminiClient(apiKey: string): GeminiClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generateJson<T>(args: { model: string; prompt: string; responseSchema: unknown; timeoutMs?: number }): Promise<T> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const res = await ai.models.generateContent({
          model: args.model,
          contents: args.prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: args.responseSchema as never,
            abortSignal: ctrl.signal,
          },
        });
        const text = res.text;
        if (typeof text !== 'string' || text.length === 0) throw new Error('empty model response');
        return JSON.parse(text) as T;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
```

> NOTE: `@google/genai` surface (constructor `GoogleGenAI({apiKey})`, `ai.models.generateContent`, `config.responseSchema`, `res.text`) — VERIFY against the installed version via context7 / `node -e` at impl time; if `abortSignal` is unsupported, wrap the call in `Promise.race([call, timeout])` instead. The seam contract (`generateJson<T>`) stays identical regardless.

- [ ] **Step 5: Implement ai/classify.ts** (routing + fail-closed live in CODE here)

```ts
// services/api/src/ai/classify.ts
import type { GeminiClient } from './geminiClient.js';
import type { AiSuggestion, ClassifyResult } from './types.js';

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    eventType: { type: 'string' },
    economicPurpose: { type: 'string' },
    counterparty: { type: 'string', nullable: true },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['eventType', 'economicPurpose', 'confidence', 'reasoning'],
};

function fallback(reason: string): ClassifyResult {
  return {
    suggestion: { eventType: 'UNKNOWN', economicPurpose: 'UNKNOWN', counterparty: null, confidence: 0, reasoning: `AI unavailable: ${reason}` },
    routing: 'NEEDS_REVIEW',
    degraded: true,
  };
}

function isValidSuggestion(x: unknown): x is AiSuggestion {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.eventType !== 'string' || typeof o.economicPurpose !== 'string' || typeof o.reasoning !== 'string') return false;
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) return false;
  if (o.counterparty !== null && o.counterparty !== undefined && typeof o.counterparty !== 'string') return false;
  return true;
}

export async function classifyEvent(
  event: { rawJson: string },
  deps: { client: GeminiClient; model: string; threshold: number },
): Promise<ClassifyResult> {
  let raw: unknown;
  try {
    raw = await deps.client.generateJson({
      model: deps.model,
      prompt: `You are an accounting event classifier. Given this normalized on-chain event JSON, classify it.\nReturn eventType, economicPurpose, counterparty (or null), confidence in [0,1], and reasoning.\nEVENT:\n${event.rawJson}`,
      responseSchema: CLASSIFY_SCHEMA,
    });
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
  if (!isValidSuggestion(raw)) return fallback('invalid schema / unparsable confidence');
  const suggestion: AiSuggestion = {
    eventType: raw.eventType, economicPurpose: raw.economicPurpose,
    counterparty: raw.counterparty ?? null, confidence: raw.confidence, reasoning: raw.reasoning,
  };
  // ROUTING IS CODE, NOT MODEL.
  const routing = suggestion.confidence >= deps.threshold ? 'AUTO' : 'NEEDS_REVIEW';
  return { suggestion, routing, degraded: false };
}
```

- [ ] **Step 6: Run classify test to verify pass**

Run: `cd <root>/services/api && npx vitest run test/ai.classify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Write failing copilot test**

```ts
// services/api/test/ai.copilot.test.ts
import { describe, it, expect } from 'vitest';
import { reviewCopilot } from '../src/ai/copilot.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

const ok: GeminiClient = { async generateJson() { return { explanation: 'looks like a receipt', redFlags: ['rounding'], suggestedEntry: { lines: [{ account: 'Cash', side: 'DEBIT', amountMinor: '100' }] }, citations: ['IAS38'] } as never; } };
const boom: GeminiClient = { async generateJson() { throw new Error('quota exceeded'); } };
const ev = { rawJson: '{}' };

describe('reviewCopilot', () => {
  it('returns structured advice on success', async () => {
    const a = await reviewCopilot(ev, {}, { client: ok, model: 'm' });
    expect(a.explanation).toContain('receipt');
    expect(a.redFlags).toContain('rounding');
    expect(a.suggestedEntry?.lines[0]!.account).toBe('Cash');
  });
  it('fail-closed: upstream error → "AI unavailable" advice, never throws', async () => {
    const a = await reviewCopilot(ev, {}, { client: boom, model: 'm' });
    expect(a.explanation).toMatch(/AI unavailable/i);
    expect(a.suggestedEntry).toBeNull();
    expect(a.redFlags).toEqual([]);
  });
});
```

- [ ] **Step 8: Implement ai/copilot.ts**

```ts
// services/api/src/ai/copilot.ts
import type { GeminiClient } from './geminiClient.js';
import type { CopilotAdvice } from './types.js';

const COPILOT_SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    redFlags: { type: 'array', items: { type: 'string' } },
    suggestedEntry: {
      type: 'object', nullable: true,
      properties: {
        lines: { type: 'array', items: { type: 'object', properties: { account: { type: 'string' }, side: { type: 'string' }, amountMinor: { type: 'string' } }, required: ['account', 'side', 'amountMinor'] } },
      },
      required: ['lines'],
    },
    citations: { type: 'array', items: { type: 'string' } },
  },
  required: ['explanation', 'redFlags', 'citations'],
};

function unavailable(reason: string): CopilotAdvice {
  return { explanation: `AI unavailable, review manually (${reason}).`, redFlags: [], suggestedEntry: null, citations: [] };
}

function coerce(x: unknown): CopilotAdvice | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.explanation !== 'string') return null;
  const redFlags = Array.isArray(o.redFlags) ? o.redFlags.filter((s): s is string => typeof s === 'string') : [];
  const citations = Array.isArray(o.citations) ? o.citations.filter((s): s is string => typeof s === 'string') : [];
  let suggestedEntry: CopilotAdvice['suggestedEntry'] = null;
  const se = o.suggestedEntry as Record<string, unknown> | null | undefined;
  if (se && Array.isArray(se.lines)) {
    const lines = (se.lines as unknown[])
      .map((l) => l as Record<string, unknown>)
      .filter((l) => typeof l.account === 'string' && (l.side === 'DEBIT' || l.side === 'CREDIT') && typeof l.amountMinor === 'string')
      .map((l) => ({ account: l.account as string, side: l.side as 'DEBIT' | 'CREDIT', amountMinor: l.amountMinor as string }));
    suggestedEntry = { lines };
  }
  return { explanation: o.explanation, redFlags, suggestedEntry, citations };
}

export async function reviewCopilot(
  event: { rawJson: string },
  context: { priorJournalSummary?: string },
  deps: { client: GeminiClient; model: string },
): Promise<CopilotAdvice> {
  try {
    const raw = await deps.client.generateJson({
      model: deps.model,
      prompt: `You are a review copilot for an accountant. READ-ONLY: you produce advice, never post.\nGiven the event JSON and prior-journal context, return explanation, redFlags[], a DRAFT suggestedEntry (or null), and citations[].\nEVENT:\n${event.rawJson}\nCONTEXT:\n${context.priorJournalSummary ?? '(none)'}`,
      responseSchema: COPILOT_SCHEMA,
    });
    return coerce(raw) ?? unavailable('invalid schema');
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 9: Run copilot + classify + guardrail tests + typecheck**

Run: `cd <root>/services/api && npx vitest run test/ai.classify.test.ts test/ai.copilot.test.ts test/aiGuardrail.test.ts && npx tsc --noEmit`
Expected: PASS (classify 6, copilot 2, guardrail 2).

- [ ] **Step 10: Commit (AI layer + the now-green guardrail test)**

```bash
git -C <root> add services/api/src/ai services/api/test/ai.classify.test.ts services/api/test/ai.copilot.test.ts services/api/test/aiGuardrail.test.ts
git -C <root> commit -m "feat(api): Gemini AI seam (classify+copilot), code routing, fail-closed + structural guardrail test"
```

---

### Task 6: anchor-svc refactor — split build/sign, gRPC client, cap-owner preflight, mutex

**Files:**
- Create: `<root>/services/anchor-svc/src/core/buildAnchorPtb.ts`
- Create: `<root>/services/anchor-svc/src/adapter/grpcChainAdapter.ts`  (`SuiGrpcChainAdapter`)
- Create: `<root>/services/anchor-svc/src/core/entityMutex.ts`
- Modify: `<root>/services/anchor-svc/src/index.ts` (export new symbols; KEEP existing `anchorSnapshot` for the test-key sign path)
- Test: `<root>/services/anchor-svc/test/buildAnchorPtb.test.ts`
- Test: `<root>/services/anchor-svc/test/grpcChainAdapter.test.ts`
- Test: `<root>/services/anchor-svc/test/entityMutex.test.ts`

**Interfaces:**
- Produces (`buildAnchorPtb.ts`):
  - `export interface BuildAnchorPtbInput { packageId: string; chainObjectId: string; capObjectId: string; prevLink: Uint8Array; walletAddress: string; args: import('./buildAnchorArgs.js').AnchorPayloadInput }`
  - `export interface AnchorPtb { txKind: string; capId: string }` where `txKind` is `tx.serialize()` output (JSON IR string).
  - `export function buildAnchorPtb(input: BuildAnchorPtbInput): AnchorPtb` — builds `Transaction`, `moveCall` anchor_snapshot, `tx.setSender(walletAddress)`, **NO `tx.setGasPayment`, NO object-version pinning, NO `tx.build()`**; returns `tx.serialize()`.
- Produces (`grpcChainAdapter.ts`):
  - `export interface CapOwner { owner: string }`
  - `export class SuiGrpcChainAdapter implements SuiChainPort` with extra read methods:
    - `getChainState(chainObjectId): Promise<ChainState>` (parses gRPC getObject shape; entity_ref/latest_link as `number[]`, seq/cap_epoch as `string`)
    - `getCapEpoch(capObjectId): Promise<bigint>`
    - `getCapOwner(capObjectId): Promise<string>` (gRPC owner address, for preflight)
    - `execAnchor(input): Promise<AnchorResult>` (test-key path: signs with provided `Signer`; uses `client.core.waitForTransaction` between cap-touching txs)
    - `waitForTransaction(digest): Promise<void>`
    - `getAnchorEvent(digest): Promise<{ seq: bigint; link: Uint8Array }>` (reads SnapshotAnchored event from a confirmed tx)
  - `constructor(client: SuiGrpcClient, signer?: Signer)` — signer optional (only needed for execAnchor test-key path).
- Produces (`entityMutex.ts`):
  - `export function makeEntityMutex(): { run<T>(key: string, fn: () => Promise<T>): Promise<T> }` — serializes by key; one in-flight per key.
- Produces (index additions):
  - `export { buildAnchorPtb, type BuildAnchorPtbInput, type AnchorPtb } from './core/buildAnchorPtb.js';`
  - `export { SuiGrpcChainAdapter } from './adapter/grpcChainAdapter.js';`
  - `export { makeEntityMutex } from './core/entityMutex.js';`

- [ ] **Step 0: Add @mysten/sui/grpc availability check**

Run: `cd <root>/services/anchor-svc && node -e "import('@mysten/sui/grpc').then(m=>console.log(Object.keys(m)))"`
Expected: prints exports incl. `SuiGrpcClient`. If the subpath differs in 2.19.0, find it: `node -e "import('@mysten/sui/client').then(m=>console.log(Object.keys(m).filter(k=>/grpc/i.test(k))))"` and adapt imports. Pin `SUI_GRPC_URL` via sui-docs-query (`/sui-dev-agents:sui-docs-query` "testnet gRPC fullnode url").

- [ ] **Step 1: Write failing buildAnchorPtb test** (asserts NO build, sender set, IR round-trips)

```ts
// services/anchor-svc/test/buildAnchorPtb.test.ts
import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { buildAnchorPtb } from '../src/core/buildAnchorPtb.js';

const input = {
  packageId: '0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d',
  chainObjectId: '0x451114f9db3b6226bc8c3dd79a21796408a75eb983a6701d345e449f25b4162f',
  capObjectId: '0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9',
  prevLink: new Uint8Array(32),
  walletAddress: '0x' + '11'.repeat(32),
  args: { manifestHash: 'ab'.repeat(32), merkleRoot: 'cd'.repeat(32), periodId: '2026-Q2', supersedesSeq: 0 },
};

describe('buildAnchorPtb', () => {
  it('returns serialized tx IR with sender set and no gas payment pinned', () => {
    const out = buildAnchorPtb(input);
    expect(out.capId).toBe(input.capObjectId);
    const tx = Transaction.from(out.txKind);          // IR must round-trip
    const data = JSON.parse(tx.serialize());
    expect(data.sender).toBe(input.walletAddress);
    expect(data.gasConfig?.payment ?? data.gasData?.payment ?? null).toBeNull(); // gas NOT pinned
  });
  it('rejects a bad-length hash (delegates to buildAnchorArgs validation)', () => {
    expect(() => buildAnchorPtb({ ...input, args: { ...input.args, manifestHash: 'zz' } })).toThrowError(/BAD_HASH_LEN/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd <root>/services/anchor-svc && npx vitest run test/buildAnchorPtb.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement buildAnchorPtb.ts**

```ts
// services/anchor-svc/src/core/buildAnchorPtb.ts
import { Transaction } from '@mysten/sui/transactions';
import { buildAnchorArgs, type AnchorPayloadInput } from './buildAnchorArgs.js';

const MODULE = 'audit_anchor';
const ANCHOR_FN = 'anchor_snapshot';

export interface BuildAnchorPtbInput {
  packageId: string;
  chainObjectId: string;
  capObjectId: string;
  prevLink: Uint8Array;
  walletAddress: string;
  args: AnchorPayloadInput;
}

export interface AnchorPtb {
  txKind: string; // tx.serialize() JSON IR — NOT built BCS bytes
  capId: string;
}

/**
 * Build the unsigned anchor Transaction IR. The WALLET resolves gas + owned-object
 * versions at sign time, so we deliberately do NOT setGasPayment, do NOT pin versions,
 * and do NOT tx.build(). Pinning here freezes the AnchorCap version → -32002 stale-version
 * abort on back-to-back anchors (see spec §5).
 */
export function buildAnchorPtb(input: BuildAnchorPtbInput): AnchorPtb {
  const args = buildAnchorArgs(input.args); // validates hashes/period/seq (fail-closed)
  const tx = new Transaction();
  tx.moveCall({
    target: `${input.packageId}::${MODULE}::${ANCHOR_FN}`,
    arguments: [
      tx.object(input.chainObjectId),
      tx.object(input.capObjectId),
      tx.pure.vector('u8', Array.from(args.manifestHash)),
      tx.pure.vector('u8', Array.from(args.merkleRoot)),
      tx.pure.vector('u8', Array.from(args.periodId)),
      tx.pure.vector('u8', Array.from(input.prevLink)),
      tx.pure.u64(args.supersedesSeq),
    ],
  });
  tx.setSender(input.walletAddress);
  return { txKind: tx.serialize(), capId: input.capObjectId };
}
```

- [ ] **Step 4: Run buildAnchorPtb test**

Run: `cd <root>/services/anchor-svc && npx vitest run test/buildAnchorPtb.test.ts`
Expected: PASS. (If `data.gasData` key differs in 2.19 IR JSON, adjust the assertion to whichever key holds payment; the load-bearing assertion is "payment is null/absent".)

- [ ] **Step 5: Write failing entityMutex test**

```ts
// services/anchor-svc/test/entityMutex.test.ts
import { describe, it, expect } from 'vitest';
import { makeEntityMutex } from '../src/core/entityMutex.js';

describe('entityMutex', () => {
  it('serializes same-key runs (no overlap)', async () => {
    const m = makeEntityMutex();
    const order: string[] = [];
    const slow = (tag: string) => m.run('e1', async () => {
      order.push(`${tag}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`${tag}-end`);
    });
    await Promise.all([slow('a'), slow('b')]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
  it('different keys run concurrently', async () => {
    const m = makeEntityMutex();
    const order: string[] = [];
    const t = (key: string, tag: string) => m.run(key, async () => { order.push(`${tag}-start`); await new Promise((r) => setTimeout(r, 20)); order.push(`${tag}-end`); });
    await Promise.all([t('e1', 'a'), t('e2', 'b')]);
    expect(order.slice(0, 2).sort()).toEqual(['a-start', 'b-start']); // both started before either ended
  });
  it('a throwing run releases the lock for the next', async () => {
    const m = makeEntityMutex();
    await expect(m.run('e1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(m.run('e1', async () => 42)).resolves.toBe(42);
  });
});
```

- [ ] **Step 6: Implement entityMutex.ts**

```ts
// services/anchor-svc/src/core/entityMutex.ts
export function makeEntityMutex(): { run<T>(key: string, fn: () => Promise<T>): Promise<T> } {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prev = tails.get(key) ?? Promise.resolve();
      const next = prev.then(fn, fn); // run fn whether prev resolved or rejected
      // keep the chain alive but swallow the stored tail's rejection so it never goes unhandled
      tails.set(key, next.catch(() => undefined));
      void next.finally(() => { if (tails.get(key) === next || true) { /* chain advances via stored .catch */ } });
      return next;
    },
  };
}
```

> Simplify if your reviewer flags the `void next.finally`: the essential behavior is `tails.set(key, next.catch(()=>{}))` so the next caller chains after this one regardless of outcome, and the returned `next` preserves the real result/rejection. Verify against the 3 tests.

- [ ] **Step 7: Run entityMutex test**

Run: `cd <root>/services/anchor-svc && npx vitest run test/entityMutex.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Write failing gRPC adapter test** (parse gRPC shape + TypeName-as-string)

```ts
// services/anchor-svc/test/grpcChainAdapter.test.ts
import { describe, it, expect } from 'vitest';
import { SuiGrpcChainAdapter } from '../src/adapter/grpcChainAdapter.js';

// Fake gRPC client modeling the protobuf-derived getObject shape.
function fakeGrpc(objects: Record<string, unknown>) {
  return {
    core: {
      async getObject({ objectId }: { objectId: string }) {
        const o = objects[objectId];
        if (!o) throw new Error('not found');
        return o;
      },
      async waitForTransaction() { return; },
    },
  };
}

describe('SuiGrpcChainAdapter parsing', () => {
  it('parses chain state from gRPC getObject shape (entity_ref/latest_link number[], seq/cap_epoch string)', async () => {
    const chainId = '0xchain';
    const client = fakeGrpc({
      [chainId]: { object: { json: { entity_ref: [1, 2, 3], latest_link: [9, 9], seq: '4', cap_epoch: '7' } } },
    });
    const a = new SuiGrpcChainAdapter(client as never);
    const s = await a.getChainState(chainId);
    expect(Array.from(s.entityRef)).toEqual([1, 2, 3]);
    expect(Array.from(s.latestLink)).toEqual([9, 9]);
    expect(s.seq).toBe(4n);
    expect(s.capEpoch).toBe(7n);
  });

  it('reads cap owner address for preflight', async () => {
    const capId = '0xcap';
    const client = fakeGrpc({ [capId]: { object: { owner: { address: '0xowner' }, json: { epoch: '7' } } } });
    const a = new SuiGrpcChainAdapter(client as never);
    expect(await a.getCapOwner(capId)).toBe('0xowner');
    expect(await a.getCapEpoch(capId)).toBe(7n);
  });
});
```

- [ ] **Step 9: Implement grpcChainAdapter.ts**

```ts
// services/anchor-svc/src/adapter/grpcChainAdapter.ts
import { Transaction } from '@mysten/sui/transactions';
import type { Signer } from '@mysten/sui/cryptography';
import {
  LinkMismatchError,
  type AnchorResult, type ChainState, type ExecAnchorInput, type SuiChainPort,
} from '../domain/types.js';

const MODULE = 'audit_anchor';

/**
 * gRPC getObject returns a protobuf-derived shape that differs from JSON-RPC:
 * owner/version nest differently and TypeName serializes as a plain string (v1.70+).
 * This adapter reads `res.object.json` for Move fields and `res.object.owner.address`
 * for ownership. Parse defensively; throw on missing fields (fail-closed).
 */
export class SuiGrpcChainAdapter implements SuiChainPort {
  // `client` is a SuiGrpcClient; we only touch `client.core`.
  constructor(private readonly client: { core: GrpcCore }, private readonly signer?: Signer) {}

  private async fields(objectId: string): Promise<Record<string, unknown>> {
    const res = await this.client.core.getObject({ objectId });
    const f = res?.object?.json as Record<string, unknown> | undefined | null;
    if (!f) throw new Error(`object ${objectId} not found or json unavailable (gRPC)`);
    return f;
  }

  async getChainState(chainObjectId: string): Promise<ChainState> {
    const f = await this.fields(chainObjectId);
    return {
      entityRef: Uint8Array.from(f.entity_ref as number[]),
      latestLink: Uint8Array.from(f.latest_link as number[]),
      seq: BigInt(f.seq as string),
      capEpoch: BigInt(f.cap_epoch as string),
    };
  }

  async getCapEpoch(capObjectId: string): Promise<bigint> {
    const f = await this.fields(capObjectId);
    return BigInt(f.epoch as string);
  }

  async getCapOwner(capObjectId: string): Promise<string> {
    const res = await this.client.core.getObject({ objectId: capObjectId });
    const owner = res?.object?.owner as { address?: string; AddressOwner?: string } | undefined;
    const addr = owner?.address ?? owner?.AddressOwner;
    if (!addr) throw new Error(`cap ${capObjectId} owner address unavailable (gRPC shape)`);
    return addr;
  }

  async waitForTransaction(digest: string): Promise<void> {
    await this.client.core.waitForTransaction({ digest });
  }

  async getAnchorEvent(digest: string): Promise<{ seq: bigint; link: Uint8Array }> {
    const res = await this.client.core.getTransaction({ digest });
    const events = (res?.events ?? res?.transaction?.events) as Array<{ eventType?: string; type?: string; json?: Record<string, unknown> | null }> | undefined;
    const ev = events?.find((e) => (e.eventType ?? e.type ?? '').endsWith(`::${MODULE}::SnapshotAnchored`));
    if (!ev || !ev.json) throw new Error('SnapshotAnchored event missing in tx ' + digest);
    return { seq: BigInt(ev.json.seq as string), link: Uint8Array.from(ev.json.link as number[]) };
  }

  /** Test-key sign path (demo-e2e only). Browser flow does NOT call this. */
  async execAnchor(input: ExecAnchorInput): Promise<AnchorResult> {
    if (!this.signer) throw new Error('execAnchor requires a signer (test-key path only)');
    const tx = new Transaction();
    tx.moveCall({
      target: `${input.packageId}::${MODULE}::anchor_snapshot`,
      arguments: [
        tx.object(input.chainObjectId),
        tx.object(input.capObjectId),
        tx.pure.vector('u8', Array.from(input.args.manifestHash)),
        tx.pure.vector('u8', Array.from(input.args.merkleRoot)),
        tx.pure.vector('u8', Array.from(input.args.periodId)),
        tx.pure.vector('u8', Array.from(input.prevLink)),
        tx.pure.u64(input.args.supersedesSeq),
      ],
    });
    tx.setSender(await this.signer.toSuiAddress());
    const res = await this.client.core.signAndExecuteTransaction({ transaction: tx, signer: this.signer });
    const digest = (res?.digest ?? res?.transaction?.digest) as string | undefined;
    if (!digest) throw new Error('no digest from signAndExecuteTransaction');
    await this.waitForTransaction(digest); // back-to-back cap txs need this (anchor-notes)
    const ev = await this.getAnchorEvent(digest);
    return { digest, seq: ev.seq, link: ev.link };
  }
}

// Minimal structural type of the SuiGrpcClient.core surface we use. The real client
// satisfies it; at impl time replace with the actual import type from @mysten/sui/grpc.
interface GrpcCore {
  getObject(args: { objectId: string }): Promise<{ object?: { json?: Record<string, unknown> | null; owner?: unknown } }>;
  getTransaction(args: { digest: string }): Promise<unknown>;
  waitForTransaction(args: { digest: string }): Promise<unknown>;
  signAndExecuteTransaction(args: { transaction: Transaction; signer: Signer }): Promise<unknown>;
}
```

> NOTE: the exact gRPC `getObject`/`getTransaction` response shape (`object.json`, `object.owner.address`, event location) MUST be verified at impl time against `@mysten/sui/grpc` 2.19 — the fake in the test encodes the ASSUMED shape; if reality differs, fix BOTH the adapter parse and the fake together (spec §5 "verify both in the gRPC adapter test"). Cross-check against `anchor-notes.md` line 50 (entity_ref/latest_link = number[]; seq/cap_epoch = string).

- [ ] **Step 10: Run gRPC adapter test**

Run: `cd <root>/services/anchor-svc && npx vitest run test/grpcChainAdapter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 11: Update index.ts exports**

```ts
// services/anchor-svc/src/index.ts
export * from './domain/types.js';
export { deriveEntityRef } from './core/entityRef.js';
export { lookupEntity } from './core/registry.js';
export { resolveChain, type ResolvedChain } from './core/resolveChain.js';
export { buildAnchorArgs, type AnchorPayloadInput } from './core/buildAnchorArgs.js';
export { anchorSnapshot, type AnchorDeps } from './anchorSnapshot.js';
export { buildRegistry } from './core/buildRegistry.js';
export { buildAnchorPtb, type BuildAnchorPtbInput, type AnchorPtb } from './core/buildAnchorPtb.js';
export { SuiGrpcChainAdapter } from './adapter/grpcChainAdapter.js';
export { makeEntityMutex } from './core/entityMutex.js';
```

- [ ] **Step 12: Run full anchor-svc suite + typecheck** (existing tests must still pass)

Run: `cd <root>/services/anchor-svc && npx vitest run && npx tsc --noEmit`
Expected: all existing + 3 new test files PASS.

- [ ] **Step 13: Commit**

```bash
git -C <root> add services/anchor-svc/src/core/buildAnchorPtb.ts services/anchor-svc/src/adapter/grpcChainAdapter.ts services/anchor-svc/src/core/entityMutex.ts services/anchor-svc/src/index.ts services/anchor-svc/test/buildAnchorPtb.test.ts services/anchor-svc/test/grpcChainAdapter.test.ts services/anchor-svc/test/entityMutex.test.ts
git -C <root> commit -m "feat(anchor-svc): split buildAnchorPtb (unsigned IR) + gRPC adapter + per-entity mutex"
```

---

### Task 7: Fastify server + 13 REST routes + unified error envelope

**Files:**
- Modify: `<root>/services/rules-engine/src/index.ts` (step 0: add public exports the API needs)
- Create: `<root>/services/api/src/deps/rulesEngine.ts` (extend with the new exports)
- Create: `<root>/services/api/src/http/errors.ts` (unified envelope + `ApiError`)
- Create: `<root>/services/api/src/http/buildRuleInput.ts` (assemble `RuleInput` from a stored event)
- Create: `<root>/services/api/src/http/anchorService.ts` (prepare/confirm orchestration over anchor-svc + stores + mutex)
- Create: `<root>/services/api/src/http/routes.ts` (registers all 13 routes)
- Create: `<root>/services/api/src/server.ts` (boot: loadConfig → openDb → seed → build deps → listen)
- Test: `<root>/services/api/test/routes.test.ts`
- Test: `<root>/services/api/test/anchorService.test.ts`

**Interfaces — REST contract (FRONTEND DEPENDS ON THESE VERBATIM).**
Base URL `http://localhost:8787`. All bodies JSON. Error body ALWAYS `{ "error": { "code": string, "message": string } }`.

> **DTO shapes** (response objects reused across endpoints):
> - `EntityDTO` = `{ id: string, displayName: string, chainObjectId: string, capObjectId: string, originalPackageId: string }`
> - `EventDTO` = `{ id: string, entityId: string, status: "INGESTED"|"AUTO"|"NEEDS_REVIEW"|"APPROVED"|"POSTED", normalized: object, ai: { eventType: string|null, purpose: string|null, counterparty: string|null, confidence: number|null, reasoning: string|null } | null, final: { eventType: string|null, purpose: string|null } | null, routing: "AUTO"|"NEEDS_REVIEW"|null }` — `normalized` is the parsed `raw_json`; `routing` mirrors status after classify.
> - `JournalDTO` = `{ id: string, eventId: string, idempotencyKey: string, leafHash: string, je: { idempotencyKey: string, lineageHash: string, reversalOf: string|null, lines: Array<{ account: string, side: "DEBIT"|"CREDIT", amountMinor: string, origCoinType: string|null, origQtyMinor: string|null, priceRef: string|null, fxRef: string|null, leg: string }> } }`
> - `AnchorDTO` = `{ id: string, snapshotId: string, seq: number, link: string, digest: string, explorerUrl: string, anchoredAt: string }`

| # | Method + Path | Request body | Success status + response body |
|---|---|---|---|
| 1 | `GET /entities` | — | `200 { "entities": EntityDTO[] }` |
| 2 | `POST /entities/:id/ingest` | `{}` (none) | `200 { "ingested": number, "events": EventDTO[] }` — re-ingest is idempotent (returns existing events, `ingested` = count inserted this call) |
| 3 | `GET /entities/:id/events` | — | `200 { "events": EventDTO[] }` |
| 4 | `POST /events/:id/classify` | `{}` | `200 { "event": EventDTO, "degraded": boolean }` — `event.status` is now `AUTO` or `NEEDS_REVIEW`; `degraded=true` if AI fell back |
| 5 | `GET /entities/:id/review-queue` | — | `200 { "events": EventDTO[] }` (only `status==="NEEDS_REVIEW"`) |
| 6 | `POST /reviews/:eventId/copilot` | `{}` | `200 { "advice": { "explanation": string, "redFlags": string[], "suggestedEntry": { "lines": Array<{account:string,side:"DEBIT"\|"CREDIT",amountMinor:string}> } \| null, "citations": string[] } }` |
| 7 | `POST /reviews/:eventId/decide` | `{ "finalEventType": string, "finalPurpose": string }` | `200 { "event": EventDTO }` (status now `APPROVED`) |
| 8 | `POST /entities/:id/run-rules` | `{ "periodId": string }` | `200 { "posted": number, "skipped": number, "journal": JournalDTO[] }` — runs `evaluate()` over `APPROVED`+`AUTO`, writes JEs, marks events `POSTED` |
| 9 | `GET /entities/:id/journal` | — | `200 { "journal": JournalDTO[] }` |
| 10 | `POST /entities/:id/snapshot` | `{ "periodId": string }` | `200 { "snapshot": { "id": string, "periodId": string, "manifestHash": string, "merkleRoot": string, "leafCount": number, "supersedesSeq": number\|null, "status": "FROZEN" } }` |
| 11 | `POST /entities/:id/anchor/prepare` | `{ "snapshotId": string, "walletAddress": string }` | `200 { "txKind": string, "expectedSeq": number, "chainId": string, "capId": string }` — `txKind` is the serialized unsigned tx IR for `Transaction.from()` |
| 12 | `POST /entities/:id/anchor/confirm` | `{ "snapshotId": string, "digest": string, "expectedSeq": number }` | `200 { "anchor": AnchorDTO }` (snapshot now `ANCHORED`) |
| 13 | `GET /entities/:id/anchors` | optional query `?idempotencyKey=<k>` | `200 { "anchors": AnchorDTO[], "inclusionProof": { "idempotencyKey": string, "leafIndex": number, "siblings": Array<{hash:string,position:"L"\|"R"}>, "merkleRoot": string } \| null }` — proof present only when `idempotencyKey` given and found in latest snapshot |

**Error codes (in `error.code`):** `ENTITY_NOT_FOUND` (404), `EVENT_NOT_FOUND` (404), `SNAPSHOT_NOT_FOUND` (404), `ILLEGAL_TRANSITION` (409), `VALIDATION` (400), `ENTITY_CHAIN_MISMATCH` (409, A4 gate), `CAP_NOT_OWNED_BY_WALLET` (409), `CLIENT_HASH_REJECTED` (400), `SEQ_MISMATCH` (409, confirm), `CHAIN_UNREACHABLE` (502), `STALE_CAP` (409), `LINK_MISMATCH` (409), `AI_UPSTREAM` (502, only if a hard AI error must surface — classify itself never surfaces, it degrades), `INTERNAL` (500).

**Interfaces — internal helpers:**
- `errors.ts`: `export class ApiError extends Error { constructor(public statusCode: number, public code: string, message: string) }`; `export function toEnvelope(code: string, message: string): { error: { code: string; message: string } }`.
- `buildRuleInput.ts`: `export function buildRuleInput(event: EventRow, opts: { periodId: string }): RuleInput` — wraps the stored normalized event in a full `RuleInput` (synthesizes `runContext`, a `periodOpen:true` `policySet`, an `APPROVED` `assetAssessment`, and demo `prices`/`fxRates`/`lots`/`coaMapping` sufficient for the fixture event types). Built deterministically; see step note.
- `anchorService.ts`:
  - `export interface AnchorDeps { db: Db; adapter: SuiGrpcChainAdapter; mutex: ReturnType<typeof makeEntityMutex>; cfg: ApiConfig }`
  - `export function prepareAnchor(deps, p: { entityId: string; snapshotId: string; walletAddress: string }): Promise<{ txKind: string; expectedSeq: number; chainId: string; capId: string }>`
  - `export function confirmAnchor(deps, p: { entityId: string; snapshotId: string; digest: string; expectedSeq: number }): Promise<AnchorDTO>`

- [ ] **Step 0: rules-engine public exports** (the API needs leaf/proof + the input types)

Edit `services/rules-engine/src/index.ts` — append:
```ts
export { leafHash, inclusionProof, verifyInclusion } from './core/merkle.js';
export type {
  NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate, CoaMapping, EventType,
} from './domain/types.js';
```
Run: `cd <root>/services/rules-engine && npx tsc --noEmit && npx vitest run` (Expected: still green — additive only.)
Commit: `git -C <root> add services/rules-engine/src/index.ts && git -C <root> commit -m "feat(rules-engine): export leafHash/inclusionProof + input types for api"`

Then extend `services/api/src/deps/rulesEngine.ts`:
```ts
export { evaluate, buildMerkle, leafHash, inclusionProof, verifyInclusion } from '@subledger/rules-engine';
export type {
  RuleInput, RuleOutput, JournalEntry, JeLine, MerkleManifest, InclusionProof,
  NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate, CoaMapping, EventType,
} from '@subledger/rules-engine';
```

- [ ] **Step 1: Implement errors.ts**

```ts
// services/api/src/http/errors.ts
export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
export function toEnvelope(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}
```

- [ ] **Step 2: Implement buildRuleInput.ts** (deterministic demo RuleInput assembler)

```ts
// services/api/src/http/buildRuleInput.ts
import type { EventRow } from '../store/eventStore.js';
import type {
  RuleInput, NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate, CoaMapping,
} from '../deps/rulesEngine.js';

// Demo CoA: deterministic account resolution for the fixture event types.
const coaMapping: CoaMapping = {
  resolve({ eventType, leg }) {
    if (eventType === 'DIGITAL_ASSET_RECEIPT') return leg === 'L1' ? 'DigitalAssets' : 'AccountsReceivable';
    if (eventType === 'DIGITAL_ASSET_PAYMENT') return leg === 'L1' ? 'AccountsPayable' : 'DigitalAssets';
    return 'Suspense';
  },
};

export function buildRuleInput(event: EventRow, opts: { periodId: string }): RuleInput {
  const ne = JSON.parse(event.rawJson) as NormalizedEvent;
  const runContext: RunContext = {
    runId: `run-${event.id}`, entityId: event.entityId, bookId: ne.bookId,
    periodId: opts.periodId, mode: 'POST', asOf: ne.eventTime,
  };
  const policySet: ResolvedPolicySet = {
    policySetVersion: 'demo-ps-1', assetPolicyVersion: 'demo-ap-1', eventPolicyVersion: 'demo-ep-1',
    ruleVersion: 'demo-rule-1', parserVersion: 'demo-parse-1', normalizationVersion: 'demo-norm-1',
    costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true,
  };
  const assetAssessment: ClassificationAssessment = {
    coinType: ne.coinType, status: 'APPROVED',
    accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST',
  };
  // Demo market data sufficient for the fixture; expand here (NOT in the fixture) if evaluate() needs more.
  const prices: PricePoint[] = [{
    id: 'px-1', coinType: ne.coinType, priceCurrency: 'USD',
    asOfDate: ne.eventTime.slice(0, 10), unitPriceMinor: '100',
  }];
  const fxRates: FxRate[] = [];
  const lots: PositionLot[] = [{
    lotId: 'lot-1', seq: 1, coinType: ne.coinType, wallet: ne.wallet,
    remainingQtyMinor: '1000000000000', costMinor: '1000000',
  }];
  return { runContext, event: ne, policySet, assetAssessment, lots, prices, fxRates, coaMapping };
}
```

> NOTE: this is DEMO scaffolding. When you run Task 8's demo-e2e, if `evaluate()` returns `REVIEW_REQUIRED`/`REJECTED` for a fixture row, inspect `output.exceptions[0].code` and add the missing `prices`/`fxRates`/`lots` here until both fixture rows reach `decision === 'POSTABLE'`. Do NOT loosen the rules engine.

- [ ] **Step 3: Write the failing routes test** (uses Fastify `inject`, AI + chain mocked via deps injection)

```ts
// services/api/test/routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { seed } from '../src/store/seed.js';
import { registerRoutes } from '../src/http/routes.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import fixture from '../src/fixtures/acme-pilot-001.events.json' assert { type: 'json' };
import { loadConfig } from '../src/config.js';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg', ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg',
  ENTITY_ID: 'acme:pilot-001', ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2', AI_CONFIDENCE_THRESHOLD: '0.85',
  PORT: '8787', DB_PATH: ':memory:', EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});

const classifyClient: GeminiClient = { async generateJson() { return { eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'X', counterparty: null, confidence: 0.92, reasoning: 'r' } as never; } };

let app: FastifyInstance; let db: Db;
beforeEach(async () => {
  db = openDb(':memory:');
  seed(db, { entityId: cfg.entityId, entityChainId: cfg.entityChainId, entityCapId: cfg.entityCapId, originalPackageId: cfg.anchorOriginalPackageId }, fixture as never);
  app = Fastify();
  // anchorAdapter stubbed: prepare/confirm tested separately in anchorService.test.ts
  registerRoutes(app, { db, cfg, classifyClient, copilotClient: classifyClient, anchorAdapter: null as never, mutex: { run: (_k, fn) => fn() } as never });
  await app.ready();
});

describe('REST contract', () => {
  it('GET /entities returns the seeded entity in EntityDTO shape', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.entities[0].id).toBe('acme:pilot-001');
    expect(body.entities[0]).toHaveProperty('capObjectId');
  });

  it('GET /entities/:id/events lists ingested events with status INGESTED', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/events' });
    const body = r.json();
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.events[0].status).toBe('INGESTED');
    expect(body.events[0]).toHaveProperty('normalized');
  });

  it('POST /events/:id/classify routes AUTO at confidence 0.92', async () => {
    const r = await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.event.status).toBe('AUTO');
    expect(body.degraded).toBe(false);
    expect(body.event.ai.confidence).toBeCloseTo(0.92);
  });

  it('decide on a non-review event fails closed with 409 ILLEGAL_TRANSITION', async () => {
    const r = await app.inject({ method: 'POST', url: '/reviews/evt-001/decide', payload: { finalEventType: 'X', finalPurpose: 'Y' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('unknown entity → 404 ENTITY_NOT_FOUND envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/nope/events' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('full main line: classify both → run-rules posts JEs → snapshot FROZEN', async () => {
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
    const rr = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: { periodId: '2026-Q2' } });
    expect(rr.statusCode).toBe(200);
    expect(rr.json().posted).toBeGreaterThanOrEqual(1);
    const snap = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    expect(snap.statusCode).toBe(200);
    expect(snap.json().snapshot.status).toBe('FROZEN');
    expect(snap.json().snapshot.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd <root>/services/api && npx vitest run test/routes.test.ts`
Expected: FAIL — `registerRoutes` not found.

- [ ] **Step 5: Implement anchorService.ts**

```ts
// services/api/src/http/anchorService.ts
import type { Db } from '../store/db.js';
import type { ApiConfig } from '../config.js';
import { ApiError } from './errors.js';
import { getEntity } from '../store/entityStore.js';
import { getSnapshot, setSnapshotStatus } from '../store/snapshotStore.js';
import { insertAnchor, type AnchorRow } from '../store/anchorStore.js';
import { deriveEntityRef } from '../deps/anchorSvc.js';
import type { SuiGrpcChainAdapter } from '@subledger/anchor-svc';
import { buildAnchorPtb } from '@subledger/anchor-svc';

export interface AnchorServiceDeps {
  db: Db;
  adapter: SuiGrpcChainAdapter;
  mutex: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
  cfg: ApiConfig;
}
export interface AnchorDTO { id: string; snapshotId: string; seq: number; link: string; digest: string; explorerUrl: string; anchoredAt: string; }

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function prepareAnchor(
  deps: AnchorServiceDeps,
  p: { entityId: string; snapshotId: string; walletAddress: string },
): Promise<{ txKind: string; expectedSeq: number; chainId: string; capId: string }> {
  return deps.mutex.run(p.entityId, async () => {
    const ent = getEntity(deps.db, p.entityId);
    if (!ent) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${p.entityId}`);
    const snap = getSnapshot(deps.db, p.snapshotId);
    if (!snap) throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', `no snapshot ${p.snapshotId}`);
    if (snap.status !== 'FROZEN') throw new ApiError(409, 'ILLEGAL_TRANSITION', `snapshot ${snap.status}, expected FROZEN`);

    let chain;
    try {
      chain = await deps.adapter.getChainState(ent.chainObjectId);
    } catch (e) {
      throw new ApiError(502, 'CHAIN_UNREACHABLE', e instanceof Error ? e.message : String(e));
    }
    // A4 gate: on-chain entity_ref must match derived ref.
    if (!bytesEqual(chain.entityRef, deriveEntityRef(p.entityId))) {
      throw new ApiError(409, 'ENTITY_CHAIN_MISMATCH', `entity_ref mismatch for ${p.entityId}`);
    }
    // Cap-owner preflight.
    let owner: string;
    try { owner = await deps.adapter.getCapOwner(ent.capObjectId); }
    catch (e) { throw new ApiError(502, 'CHAIN_UNREACHABLE', e instanceof Error ? e.message : String(e)); }
    if (owner !== p.walletAddress) {
      throw new ApiError(409, 'CAP_NOT_OWNED_BY_WALLET', `cap owned by ${owner}, not ${p.walletAddress}`);
    }
    const expectedSeq = Number(chain.seq) + 1;
    // hashes come from the SERVER snapshot row — never client input (anti-tamper).
    const ptb = buildAnchorPtb({
      packageId: deps.cfg.anchorPackageId,
      chainObjectId: ent.chainObjectId,
      capObjectId: ent.capObjectId,
      prevLink: chain.latestLink,
      walletAddress: p.walletAddress,
      args: { manifestHash: snap.manifestHash, merkleRoot: snap.merkleRoot, periodId: snap.periodId, supersedesSeq: snap.supersedesSeq ?? 0 },
    });
    return { txKind: ptb.txKind, expectedSeq, chainId: ent.chainObjectId, capId: ent.capObjectId };
  });
}

export async function confirmAnchor(
  deps: AnchorServiceDeps,
  p: { entityId: string; snapshotId: string; digest: string; expectedSeq: number },
): Promise<AnchorDTO> {
  return deps.mutex.run(p.entityId, async () => {
    const ent = getEntity(deps.db, p.entityId);
    if (!ent) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${p.entityId}`);
    const snap = getSnapshot(deps.db, p.snapshotId);
    if (!snap) throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', `no snapshot ${p.snapshotId}`);

    try { await deps.adapter.waitForTransaction(p.digest); }
    catch (e) { throw new ApiError(502, 'CHAIN_UNREACHABLE', e instanceof Error ? e.message : String(e)); }

    const chain = await deps.adapter.getChainState(ent.chainObjectId);
    // fail-closed: confirmed head seq must equal expectedSeq, link must have advanced.
    if (Number(chain.seq) !== p.expectedSeq) {
      throw new ApiError(409, 'SEQ_MISMATCH', `head seq ${chain.seq} != expected ${p.expectedSeq}`);
    }
    const ev = await deps.adapter.getAnchorEvent(p.digest);
    const linkHex = Buffer.from(ev.link).toString('hex');
    // setSnapshotStatus validates FROZEN -> ANCHORED (fails closed if already ANCHORED).
    setSnapshotStatus(deps.db, p.snapshotId, 'ANCHORED');
    const row: AnchorRow = {
      id: `anchor-${p.entityId}-${Number(ev.seq)}`, entityId: p.entityId, snapshotId: p.snapshotId,
      seq: Number(ev.seq), link: linkHex, digest: p.digest,
      explorerUrl: `${deps.cfg.explorerBase}/tx/${p.digest}`, anchoredAt: new Date().toISOString(),
    };
    insertAnchor(deps.db, row);
    return row;
  });
}
```

- [ ] **Step 6: Implement routes.ts** (all 13 routes + error envelope hook)

```ts
// services/api/src/http/routes.ts
import type { FastifyInstance } from 'fastify';
import type { Db } from '../store/db.js';
import type { ApiConfig } from '../config.js';
import type { GeminiClient } from '../ai/geminiClient.js';
import type { SuiGrpcChainAdapter } from '@subledger/anchor-svc';
import { ApiError, toEnvelope } from './errors.js';
import { StateError } from '../store/stateMachine.js';
import { AnchorError } from '../deps/anchorSvc.js';
import { listEntities, getEntity } from '../store/entityStore.js';
import {
  listEvents, getEvent, listByStatus, setAiSuggestion, setDecision, markPosted, type EventRow,
} from '../store/eventStore.js';
import { insertJournalEntry, listJournal } from '../store/journalStore.js';
import { insertSnapshot, getSnapshot } from '../store/snapshotStore.js';
import { listAnchors } from '../store/anchorStore.js';
import { classifyEvent } from '../ai/classify.js';
import { reviewCopilot } from '../ai/copilot.js';
import { buildRuleInput } from './buildRuleInput.js';
import { evaluate, buildMerkle, leafHash, inclusionProof, type JournalEntry } from '../deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../deps/snapshotSvc.js';
import { prepareAnchor, confirmAnchor, type AnchorServiceDeps } from './anchorService.js';

export interface RouteDeps {
  db: Db;
  cfg: ApiConfig;
  classifyClient: GeminiClient;
  copilotClient: GeminiClient;
  anchorAdapter: SuiGrpcChainAdapter;
  mutex: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
}

function eventDTO(e: EventRow) {
  const hasAi = e.aiEventType !== null || e.aiConfidence !== null;
  return {
    id: e.id, entityId: e.entityId, status: e.status,
    normalized: JSON.parse(e.rawJson),
    ai: hasAi ? { eventType: e.aiEventType, purpose: e.aiPurpose, counterparty: e.aiCounterparty, confidence: e.aiConfidence, reasoning: e.aiReasoning } : null,
    final: e.finalEventType !== null || e.finalPurpose !== null ? { eventType: e.finalEventType, purpose: e.finalPurpose } : null,
    routing: e.status === 'AUTO' || e.status === 'NEEDS_REVIEW' ? e.status : null,
  };
}
function journalDTO(db: Db, entityId: string) {
  return listJournal(db, entityId).map((r) => ({
    id: r.id, eventId: r.eventId, idempotencyKey: r.idempotencyKey, leafHash: r.leafHash, je: JSON.parse(r.jeJson),
  }));
}
function requireEntity(db: Db, id: string) {
  const e = getEntity(db, id);
  if (!e) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${id}`);
  return e;
}
function requireEvent(db: Db, id: string): EventRow {
  const e = getEvent(db, id);
  if (!e) throw new ApiError(404, 'EVENT_NOT_FOUND', `no event ${id}`);
  return e;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, cfg } = deps;

  // Unified error envelope.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.statusCode).send(toEnvelope(err.code, err.message));
    if (err instanceof StateError) return reply.code(409).send(toEnvelope('ILLEGAL_TRANSITION', err.message));
    if (err instanceof AnchorError) {
      const map: Record<string, number> = { ENTITY_REF_MISMATCH: 409, STALE_CAP: 409, BAD_HASH_LEN: 400, PERIOD_TOO_LONG: 400, SEQ_OUT_OF_RANGE: 400 };
      return reply.code(map[err.code] ?? 409).send(toEnvelope(err.code, err.message));
    }
    if ((err as { validation?: unknown }).validation) return reply.code(400).send(toEnvelope('VALIDATION', err.message));
    return reply.code(500).send(toEnvelope('INTERNAL', err.message));
  });

  // 1
  app.get('/entities', async () => ({ entities: listEntities(db) }));

  // 2
  app.post<{ Params: { id: string } }>('/entities/:id/ingest', async (req) => {
    requireEntity(db, req.params.id);
    // Fixture is already seeded on boot; "ingest" returns the current events (idempotent demo).
    const events = listEvents(db, req.params.id);
    return { ingested: events.length, events: events.map(eventDTO) };
  });

  // 3
  app.get<{ Params: { id: string } }>('/entities/:id/events', async (req) => {
    requireEntity(db, req.params.id);
    return { events: listEvents(db, req.params.id).map(eventDTO) };
  });

  // 4
  app.post<{ Params: { id: string } }>('/events/:id/classify', async (req) => {
    const ev = requireEvent(db, req.params.id);
    const res = await classifyEvent({ rawJson: ev.rawJson }, { client: deps.classifyClient, model: cfg.aiModelClassify, threshold: cfg.aiConfidenceThreshold });
    setAiSuggestion(db, ev.id, {
      aiEventType: res.suggestion.eventType, aiPurpose: res.suggestion.economicPurpose,
      aiCounterparty: res.suggestion.counterparty, aiConfidence: res.suggestion.confidence,
      aiReasoning: res.suggestion.reasoning, nextStatus: res.routing,
    });
    return { event: eventDTO(getEvent(db, ev.id)!), degraded: res.degraded };
  });

  // 5
  app.get<{ Params: { id: string } }>('/entities/:id/review-queue', async (req) => {
    requireEntity(db, req.params.id);
    return { events: listByStatus(db, req.params.id, 'NEEDS_REVIEW').map(eventDTO) };
  });

  // 6
  app.post<{ Params: { eventId: string } }>('/reviews/:eventId/copilot', async (req) => {
    const ev = requireEvent(db, req.params.eventId);
    const advice = await reviewCopilot({ rawJson: ev.rawJson }, {}, { client: deps.copilotClient, model: cfg.aiModelCopilot });
    return { advice };
  });

  // 7
  app.post<{ Params: { eventId: string }; Body: { finalEventType: string; finalPurpose: string } }>('/reviews/:eventId/decide', async (req) => {
    const ev = requireEvent(db, req.params.eventId);
    const b = req.body ?? ({} as { finalEventType?: string; finalPurpose?: string });
    if (!b.finalEventType || !b.finalPurpose) throw new ApiError(400, 'VALIDATION', 'finalEventType and finalPurpose are required');
    setDecision(db, ev.id, { finalEventType: b.finalEventType, finalPurpose: b.finalPurpose });
    return { event: eventDTO(getEvent(db, ev.id)!) };
  });

  // 8
  app.post<{ Params: { id: string }; Body: { periodId: string } }>('/entities/:id/run-rules', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    const candidates = [...listByStatus(db, req.params.id, 'APPROVED'), ...listByStatus(db, req.params.id, 'AUTO')];
    let posted = 0, skipped = 0;
    for (const ev of candidates) {
      const output = evaluate(buildRuleInput(ev, { periodId }));
      if (output.decision !== 'POSTABLE' || output.journalEntries.length === 0) { skipped++; continue; }
      for (const je of output.journalEntries) {
        const res = insertJournalEntry(db, {
          id: `je-${ev.id}-${je.idempotencyKey}`, entityId: req.params.id, eventId: ev.id,
          jeJson: JSON.stringify(je), idempotencyKey: je.idempotencyKey, leafHash: leafHash(je),
        });
        if (res === 'inserted') posted++; else skipped++;
      }
      markPosted(db, ev.id);
    }
    return { posted, skipped, journal: journalDTO(db, req.params.id) };
  });

  // 9
  app.get<{ Params: { id: string } }>('/entities/:id/journal', async (req) => {
    requireEntity(db, req.params.id);
    return { journal: journalDTO(db, req.params.id) };
  });

  // 10
  app.post<{ Params: { id: string }; Body: { periodId: string } }>('/entities/:id/snapshot', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    const jes: JournalEntry[] = listJournal(db, req.params.id).map((r) => JSON.parse(r.jeJson) as JournalEntry);
    const outputs = jes.map((je) => ({
      decision: 'POSTABLE' as const,
      assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as const, accountingClass: '', measurementModel: '' },
      measurements: [], lotMovements: [], journalEntries: [je], disclosureFacts: [], exceptions: [],
      explanation: { ruleIds: [], policyVersions: ['demo-ps-1', 'demo-rule-1'], priceRefs: [], fxRefs: [] },
    }));
    const repo = new InMemorySnapshotRepo();
    const { auditSnapshot } = buildSnapshot(outputs, { entityId: req.params.id, periodId, createdAtLogical: Date.now() }, repo);
    const id = `snap-${req.params.id}-${periodId}-${auditSnapshot.seq}`;
    insertSnapshot(db, {
      id, entityId: req.params.id, periodId, manifestJson: JSON.stringify(auditSnapshot.manifest),
      manifestHash: auditSnapshot.manifestHash, merkleRoot: auditSnapshot.merkleRoot,
      leafCount: auditSnapshot.leafCount, supersedesSeq: auditSnapshot.supersedesSeq,
    });
    return { snapshot: { id, periodId, manifestHash: auditSnapshot.manifestHash, merkleRoot: auditSnapshot.merkleRoot, leafCount: auditSnapshot.leafCount, supersedesSeq: auditSnapshot.supersedesSeq, status: 'FROZEN' } };
  });

  // 11
  app.post<{ Params: { id: string }; Body: { snapshotId: string; walletAddress: string } }>('/entities/:id/anchor/prepare', async (req) => {
    const b = req.body ?? ({} as { snapshotId?: string; walletAddress?: string });
    if (!b.snapshotId || !b.walletAddress) throw new ApiError(400, 'VALIDATION', 'snapshotId and walletAddress are required');
    const ad: AnchorServiceDeps = { db, adapter: deps.anchorAdapter, mutex: deps.mutex, cfg };
    return prepareAnchor(ad, { entityId: req.params.id, snapshotId: b.snapshotId, walletAddress: b.walletAddress });
  });

  // 12
  app.post<{ Params: { id: string }; Body: { snapshotId: string; digest: string; expectedSeq: number } }>('/entities/:id/anchor/confirm', async (req) => {
    const b = req.body ?? ({} as { snapshotId?: string; digest?: string; expectedSeq?: number });
    if (!b.snapshotId || !b.digest || typeof b.expectedSeq !== 'number') throw new ApiError(400, 'VALIDATION', 'snapshotId, digest, expectedSeq are required');
    const ad: AnchorServiceDeps = { db, adapter: deps.anchorAdapter, mutex: deps.mutex, cfg };
    const anchor = await confirmAnchor(ad, { entityId: req.params.id, snapshotId: b.snapshotId, digest: b.digest, expectedSeq: b.expectedSeq });
    return { anchor };
  });

  // 13
  app.get<{ Params: { id: string }; Querystring: { idempotencyKey?: string } }>('/entities/:id/anchors', async (req) => {
    requireEntity(db, req.params.id);
    const anchors = listAnchors(db, req.params.id).map((r) => ({ id: r.id, snapshotId: r.snapshotId, seq: r.seq, link: r.link, digest: r.digest, explorerUrl: r.explorerUrl, anchoredAt: r.anchoredAt }));
    let proof = null;
    const key = req.query.idempotencyKey;
    if (key) {
      const jes = listJournal(db, req.params.id).map((r) => JSON.parse(r.jeJson) as JournalEntry);
      if (jes.some((j) => j.idempotencyKey === key)) {
        const p = inclusionProof(jes, key);
        const { manifest } = buildMerkle(jes);
        proof = { idempotencyKey: key, leafIndex: p.leafIndex, siblings: p.siblings, merkleRoot: manifest.merkleRoot };
      }
    }
    return { anchors, inclusionProof: proof };
  });
}
```

- [ ] **Step 7: Implement server.ts**

```ts
// services/api/src/server.ts
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { seed } from './store/seed.js';
import { registerRoutes } from './http/routes.js';
import { makeGeminiClient } from './ai/geminiClient.js';
import { SuiGrpcChainAdapter, makeEntityMutex } from '@subledger/anchor-svc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { FixtureBundle } from './deps/ingestion.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acme-pilot-001.events.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureBundle;
seed(db, { entityId: cfg.entityId, entityChainId: cfg.entityChainId, entityCapId: cfg.entityCapId, originalPackageId: cfg.anchorOriginalPackageId }, fixture);

const grpc = new SuiGrpcClient({ network: cfg.suiNetwork as never, transport: undefined as never, baseUrl: cfg.suiGrpcUrl } as never);
const adapter = new SuiGrpcChainAdapter(grpc as never);
const ai = makeGeminiClient(cfg.geminiApiKey);

const app = Fastify({ logger: true });
app.addHook('onRequest', async (_req, reply) => { reply.header('access-control-allow-origin', '*'); reply.header('access-control-allow-headers', 'content-type'); });
app.options('/*', async (_req, reply) => reply.code(204).send());
registerRoutes(app, { db, cfg, classifyClient: ai, copilotClient: ai, anchorAdapter: adapter, mutex: makeEntityMutex() });

app.listen({ port: cfg.port, host: '0.0.0.0' }).then(() => app.log.info(`api on :${cfg.port}`)).catch((e) => { app.log.error(e); process.exit(1); });
```

> NOTE: `SuiGrpcClient` constructor signature in 2.19 — verify at impl time (`/sui-dev-agents:sui-docs-query`). The adapter only touches `client.core`, so however the client is constructed, pass it to `SuiGrpcChainAdapter`. CORS is hand-rolled here; swap to `@fastify/cors` if preferred.

- [ ] **Step 8: Write anchorService.test.ts** (A4 gate, cap preflight, client-hash anti-tamper, seq mismatch)

```ts
// services/api/test/anchorService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertSnapshot, getSnapshot } from '../src/store/snapshotStore.js';
import { prepareAnchor, confirmAnchor } from '../src/http/anchorService.js';
import { deriveEntityRef } from '../src/deps/anchorSvc.js';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'g', ANCHOR_PACKAGE_ID: '0x' + 'af'.repeat(32), ANCHOR_ORIGINAL_PACKAGE_ID: '0xp',
  ENTITY_ID: 'acme:pilot-001', ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm', AI_CONFIDENCE_THRESHOLD: '0.85',
  PORT: '8787', DB_PATH: ':memory:', EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});
const ENTITY = 'acme:pilot-001';
const passthroughMutex = { run: <T>(_k: string, fn: () => Promise<T>) => fn() };

function fakeAdapter(over: Partial<{ entityRef: Uint8Array; owner: string; seq: bigint; link: Uint8Array }> = {}) {
  const ref = over.entityRef ?? deriveEntityRef(ENTITY);
  return {
    async getChainState() { return { entityRef: ref, latestLink: over.link ?? new Uint8Array(32), seq: over.seq ?? 0n, capEpoch: 0n }; },
    async getCapOwner() { return over.owner ?? '0xwallet'; },
    async waitForTransaction() { return; },
    async getAnchorEvent() { return { seq: (over.seq ?? 0n) + 1n, link: new Uint8Array([7]) }; },
  } as never;
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: ENTITY, displayName: 'A', chainObjectId: '0xchain', capObjectId: '0xcap', originalPackageId: '0xp' });
  insertSnapshot(db, { id: 's1', entityId: ENTITY, periodId: '2026-Q2', manifestJson: '{}', manifestHash: 'ab'.repeat(32), merkleRoot: 'cd'.repeat(32), leafCount: 1, supersedesSeq: 0 });
});

describe('prepareAnchor', () => {
  it('returns unsigned txKind + expectedSeq from SERVER snapshot hashes', async () => {
    const out = await prepareAnchor({ db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg }, { entityId: ENTITY, snapshotId: 's1', walletAddress: '0xwallet' });
    expect(out.expectedSeq).toBe(1);
    expect(typeof out.txKind).toBe('string');
    expect(out.capId).toBe('0xcap');
  });
  it('A4 gate: entity_ref mismatch → ENTITY_CHAIN_MISMATCH', async () => {
    await expect(prepareAnchor({ db, adapter: fakeAdapter({ entityRef: new Uint8Array(32) }), mutex: passthroughMutex, cfg }, { entityId: ENTITY, snapshotId: 's1', walletAddress: '0xwallet' }))
      .rejects.toMatchObject({ code: 'ENTITY_CHAIN_MISMATCH' });
  });
  it('cap preflight: owner != wallet → CAP_NOT_OWNED_BY_WALLET', async () => {
    await expect(prepareAnchor({ db, adapter: fakeAdapter({ owner: '0xother' }), mutex: passthroughMutex, cfg }, { entityId: ENTITY, snapshotId: 's1', walletAddress: '0xwallet' }))
      .rejects.toMatchObject({ code: 'CAP_NOT_OWNED_BY_WALLET' });
  });
});

describe('confirmAnchor', () => {
  it('refuses to write ANCHORED on seq mismatch (head=0, expected=1)', async () => {
    await expect(confirmAnchor({ db, adapter: fakeAdapter({ seq: 0n }), mutex: passthroughMutex, cfg }, { entityId: ENTITY, snapshotId: 's1', digest: 'D', expectedSeq: 1 }))
      .rejects.toMatchObject({ code: 'SEQ_MISMATCH' });
    expect(getSnapshot(db, 's1')!.status).toBe('FROZEN'); // NOT advanced
  });
  it('writes anchor + ANCHORED when seq matches', async () => {
    const a = await confirmAnchor({ db, adapter: fakeAdapter({ seq: 1n }), mutex: passthroughMutex, cfg }, { entityId: ENTITY, snapshotId: 's1', digest: 'DIGESTX', expectedSeq: 1 });
    expect(a.digest).toBe('DIGESTX');
    expect(a.explorerUrl).toContain('/tx/DIGESTX');
    expect(getSnapshot(db, 's1')!.status).toBe('ANCHORED');
  });
});
```

- [ ] **Step 9: Run routes + anchorService tests + typecheck**

Run: `cd <root>/services/api && npx vitest run test/routes.test.ts test/anchorService.test.ts && npx tsc --noEmit`
Expected: PASS. If `evaluate()` yields no POSTABLE for a fixture row, fix `buildRuleInput.ts` demo market data (Task 7 step 2 note) until the "full main line" route test posts ≥1 JE.

- [ ] **Step 10: Commit**

```bash
git -C <root> add services/api/src/http services/api/src/server.ts services/api/src/deps/rulesEngine.ts services/api/test/routes.test.ts services/api/test/anchorService.test.ts
git -C <root> commit -m "feat(api): 13 REST routes + anchor prepare/confirm + unified error envelope"
```

---

### Task 8: `scripts/demo-e2e.ts` (real-chain, test-key sign fallback)

**Files:**
- Create: `<root>/services/api/scripts/demo-e2e.ts`

**Interfaces:**
- Consumes: `loadConfig`, `openDb`, `seed`, the AI clients, `evaluate`/`buildSnapshot`/`leafHash`, `SuiGrpcChainAdapter` (with a `Signer` from `SUI_PK`), `prepareAnchor`/`confirmAnchor`. Drives the FULL line in-process: fixture → classify → decide → run-rules → snapshot → prepare → **sign with test key** → confirm.
- Produces: no exports; a runnable script (`npm run demo:e2e`) that exits 0 on a green full line, printing the anchor digest + explorer URL.

- [ ] **Step 1: Implement demo-e2e.ts**

```ts
// services/api/scripts/demo-e2e.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { seed } from '../src/store/seed.js';
import { listEvents, getEvent, setAiSuggestion, setDecision, markPosted, listByStatus } from '../src/store/eventStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { insertSnapshot } from '../src/store/snapshotStore.js';
import { buildRuleInput } from '../src/http/buildRuleInput.js';
import { evaluate, leafHash, type JournalEntry } from '../src/deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../src/deps/snapshotSvc.js';
import { prepareAnchor, confirmAnchor } from '../src/http/anchorService.js';
import { makeGeminiClient } from '../src/ai/geminiClient.js';
import { classifyEvent } from '../src/ai/classify.js';
import { SuiGrpcChainAdapter, makeEntityMutex } from '@subledger/anchor-svc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { FixtureBundle } from '../src/deps/ingestion.js';

async function main() {
  const cfg = loadConfig();
  if (!cfg.suiPk) throw new Error('demo-e2e requires SUI_PK (test-key sign fallback) in .env');
  const db = openDb(':memory:');
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fixtures', 'acme-pilot-001.events.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureBundle;
  seed(db, { entityId: cfg.entityId, entityChainId: cfg.entityChainId, entityCapId: cfg.entityCapId, originalPackageId: cfg.anchorOriginalPackageId }, fixture);

  const ai = makeGeminiClient(cfg.geminiApiKey);
  const periodId = '2026-Q2';

  // 1) classify every event
  for (const ev of listEvents(db, cfg.entityId)) {
    const r = await classifyEvent({ rawJson: ev.rawJson }, { client: ai, model: cfg.aiModelClassify, threshold: cfg.aiConfidenceThreshold });
    setAiSuggestion(db, ev.id, { aiEventType: r.suggestion.eventType, aiPurpose: r.suggestion.economicPurpose, aiCounterparty: r.suggestion.counterparty, aiConfidence: r.suggestion.confidence, aiReasoning: r.suggestion.reasoning, nextStatus: r.routing });
    console.log(`classify ${ev.id}: conf=${r.suggestion.confidence} → ${r.routing}${r.degraded ? ' (degraded)' : ''}`);
  }
  // 2) decide any NEEDS_REVIEW
  for (const ev of listByStatus(db, cfg.entityId, 'NEEDS_REVIEW')) {
    const ne = JSON.parse(ev.rawJson) as { eventType: string; economicPurpose: string };
    setDecision(db, ev.id, { finalEventType: ne.eventType, finalPurpose: ne.economicPurpose });
  }
  // 3) run-rules
  for (const ev of [...listByStatus(db, cfg.entityId, 'APPROVED'), ...listByStatus(db, cfg.entityId, 'AUTO')]) {
    const out = evaluate(buildRuleInput(ev, { periodId }));
    if (out.decision !== 'POSTABLE') { console.warn(`SKIP ${ev.id}: ${out.decision} ${JSON.stringify(out.exceptions)}`); continue; }
    for (const je of out.journalEntries) {
      insertJournalEntry(db, { id: `je-${ev.id}-${je.idempotencyKey}`, entityId: cfg.entityId, eventId: ev.id, jeJson: JSON.stringify(je), idempotencyKey: je.idempotencyKey, leafHash: leafHash(je) });
    }
    markPosted(db, ev.id);
  }
  const jes: JournalEntry[] = listJournal(db, cfg.entityId).map((r) => JSON.parse(r.jeJson));
  if (jes.length === 0) throw new Error('no journal entries posted — fix buildRuleInput demo data');
  // 4) snapshot
  const outputs = jes.map((je) => ({ decision: 'POSTABLE' as const, assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as const, accountingClass: '', measurementModel: '' }, measurements: [], lotMovements: [], journalEntries: [je], disclosureFacts: [], exceptions: [], explanation: { ruleIds: [], policyVersions: ['demo-ps-1', 'demo-rule-1'], priceRefs: [], fxRefs: [] } }));
  const { auditSnapshot } = buildSnapshot(outputs, { entityId: cfg.entityId, periodId, createdAtLogical: Date.now() }, new InMemorySnapshotRepo());
  const snapId = `snap-${cfg.entityId}-${periodId}-${auditSnapshot.seq}`;
  insertSnapshot(db, { id: snapId, entityId: cfg.entityId, periodId, manifestJson: JSON.stringify(auditSnapshot.manifest), manifestHash: auditSnapshot.manifestHash, merkleRoot: auditSnapshot.merkleRoot, leafCount: auditSnapshot.leafCount, supersedesSeq: auditSnapshot.supersedesSeq });

  // 5) real chain prepare → test-key sign → confirm
  const grpc = new SuiGrpcClient({ network: cfg.suiNetwork as never, baseUrl: cfg.suiGrpcUrl } as never);
  const { secretKey } = decodeSuiPrivateKey(cfg.suiPk);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const walletAddress = keypair.toSuiAddress();
  const adapter = new SuiGrpcChainAdapter(grpc as never, keypair);
  const ad = { db, adapter, mutex: makeEntityMutex(), cfg };

  const prep = await prepareAnchor(ad, { entityId: cfg.entityId, snapshotId: snapId, walletAddress });
  console.log(`prepared: expectedSeq=${prep.expectedSeq}`);
  const tx = Transaction.from(prep.txKind);
  const signed = await (grpc as never as { core: { signAndExecuteTransaction(a: unknown): Promise<{ digest: string }> } }).core.signAndExecuteTransaction({ transaction: tx, signer: keypair });
  console.log(`signed digest=${signed.digest}`);
  const anchor = await confirmAnchor(ad, { entityId: cfg.entityId, snapshotId: snapId, digest: signed.digest, expectedSeq: prep.expectedSeq });
  console.log(`ANCHORED seq=${anchor.seq} link=${anchor.link}\nexplorer: ${anchor.explorerUrl}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck (no auto-run — needs real key + funded wallet)**

Run: `cd <root>/services/api && npx tsc --noEmit`
Expected: no type errors. (Running the script requires `SUI_PK` + funded wallet + cap ownership; run manually before recording: `npm run demo:e2e`.)

> NOTE: `decodeSuiPrivateKey`/`Ed25519Keypair`/`signAndExecuteTransaction` over gRPC — verify exact import paths against `@mysten/sui` 2.19 at impl time. The script is the test-key FALLBACK only; the demo proper uses the browser wallet (frontend plan).

- [ ] **Step 3: Commit**

```bash
git -C <root> add services/api/scripts/demo-e2e.ts
git -C <root> commit -m "feat(api): demo-e2e script (test-key sign fallback) drives full close-the-period line"
```

---

### Task 9: Monkey tests (test.md mandatory — break the program)

**Files:**
- Test: `<root>/services/api/test/monkey.test.ts`

**Interfaces:** Consumes everything built above; adds no new production code (if a monkey test reveals a real hole, fix the offending store/route/ai module and note it).

- [ ] **Step 1: Write the monkey tests**

```ts
// services/api/test/monkey.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, getEvent } from '../src/store/eventStore.js';
import { insertSnapshot, getSnapshot } from '../src/store/snapshotStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { classifyEvent } from '../src/ai/classify.js';
import { confirmAnchor } from '../src/http/anchorService.js';
import { deriveEntityRef } from '../src/deps/anchorSvc.js';
import { normalizeFixture } from '../src/deps/ingestion.js';
import { makeEntityMutex } from '@subledger/anchor-svc';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { loadConfig } from '../src/config.js';
import { StateError } from '../src/store/stateMachine.js';

const cfg = loadConfig({ SUI_NETWORK: 't', SUI_GRPC_URL: 'g', ANCHOR_PACKAGE_ID: '0xp', ANCHOR_ORIGINAL_PACKAGE_ID: '0xp', ENTITY_ID: 'acme:pilot-001', ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap', GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm', AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:', EXPLORER_BASE: 'https://x' });
const ENTITY = 'acme:pilot-001';
const fakeClient = (resp: unknown): GeminiClient => ({ async generateJson() { return resp as never; } });

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: ENTITY, displayName: 'A', chainObjectId: '0xchain', capObjectId: '0xcap', originalPackageId: '0xp' });
});

describe('MONKEY: oversized fixture', () => {
  it('normalizeFixture throws FIXTURE_OVERFLOW for a tx exceeding maxEffects', () => {
    const raw = { digest: 'D', checkpoint: '1', timestampMs: '1', status: 'success' as const, rawJson: { balanceChanges: Array.from({ length: 50 }, (_, i) => ({ coinType: 'c', amount: String(i), owner: { AddressOwner: 'o' } })) } };
    const normalized = { schemaVersion: 'v1', eventId: 'e', eventType: 'DIGITAL_ASSET_RECEIPT' as const, eventGroupId: null, entityId: ENTITY, bookId: 'm', wallet: '0xw', counterparty: null, coinType: 'c', assetDecimals: 9, quantityMinor: '1', eventTime: '2026-01-01T00:00:00Z', economicPurpose: 'X', ownershipChange: true, considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null };
    expect(() => normalizeFixture({ chainId: 't', epoch: 1, events: [{ raw, normalized }] }, { maxEffects: 5 })).toThrowError(/FIXTURE_OVERFLOW/);
  });
});

describe('MONKEY: confidence NaN / out-of-range never auto-posts', () => {
  it.each([Number.NaN, Infinity, -1, 2, 'high' as unknown as number])('confidence=%s → NEEDS_REVIEW, degraded', async (c) => {
    const r = await classifyEvent({ rawJson: '{}' }, { client: fakeClient({ eventType: 'X', economicPurpose: 'Y', counterparty: null, confidence: c, reasoning: 'r' }), model: 'm', threshold: 0.85 });
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });
});

describe('MONKEY: duplicate ingest / double-post', () => {
  it('inserting the same idempotency_key twice never doubles the ledger', () => {
    insertEvent(db, { id: 'e1', entityId: ENTITY, rawJson: '{}' });
    const row = { id: 'j', entityId: ENTITY, eventId: 'e1', jeJson: '{}', idempotencyKey: 'DUP', leafHash: 'h' };
    insertJournalEntry(db, row);
    insertJournalEntry(db, { ...row, id: 'j2' });
    insertJournalEntry(db, { ...row, id: 'j3' });
    expect(listJournal(db, ENTITY)).toHaveLength(1);
  });
  it('re-classifying an already-AUTO event fails closed (no AUTO→AUTO)', () => {
    insertEvent(db, { id: 'e2', entityId: ENTITY, rawJson: '{}' });
    setAiSuggestion(db, 'e2', { aiEventType: 'X', aiPurpose: 'Y', aiCounterparty: null, aiConfidence: 0.9, aiReasoning: 'r', nextStatus: 'AUTO' });
    expect(() => setAiSuggestion(db, 'e2', { aiEventType: 'X', aiPurpose: 'Y', aiCounterparty: null, aiConfidence: 0.9, aiReasoning: 'r', nextStatus: 'AUTO' })).toThrowError(StateError);
  });
});

describe('MONKEY: concurrent anchor confirm serialized by mutex', () => {
  it('two confirms on one entity do not interleave; second sees ANCHORED and fails closed', async () => {
    insertSnapshot(db, { id: 's1', entityId: ENTITY, periodId: 'P', manifestJson: '{}', manifestHash: 'a', merkleRoot: 'b', leafCount: 1, supersedesSeq: 0 });
    const adapter = {
      async getChainState() { return { entityRef: deriveEntityRef(ENTITY), latestLink: new Uint8Array(32), seq: 1n, capEpoch: 0n }; },
      async waitForTransaction() { await new Promise((r) => setTimeout(r, 10)); },
      async getAnchorEvent() { return { seq: 1n, link: new Uint8Array([1]) }; },
      async getCapOwner() { return '0xw'; },
    } as never;
    const mutex = makeEntityMutex();
    const deps = { db, adapter, mutex, cfg };
    const results = await Promise.allSettled([
      confirmAnchor(deps, { entityId: ENTITY, snapshotId: 's1', digest: 'D1', expectedSeq: 1 }),
      confirmAnchor(deps, { entityId: ENTITY, snapshotId: 's1', digest: 'D2', expectedSeq: 1 }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);            // exactly one ANCHORED write
    expect(rejected).toHaveLength(1);             // the other fails closed (FROZEN→ANCHORED illegal twice)
    expect(getSnapshot(db, 's1')!.status).toBe('ANCHORED');
  });
});

describe('MONKEY: forged digest to confirm with seq mismatch', () => {
  it('a digest whose chain head seq != expectedSeq is refused, snapshot stays FROZEN', async () => {
    insertSnapshot(db, { id: 's2', entityId: ENTITY, periodId: 'P', manifestJson: '{}', manifestHash: 'a', merkleRoot: 'b', leafCount: 1, supersedesSeq: 0 });
    const adapter = {
      async getChainState() { return { entityRef: deriveEntityRef(ENTITY), latestLink: new Uint8Array(32), seq: 5n, capEpoch: 0n }; },
      async waitForTransaction() { return; },
      async getAnchorEvent() { return { seq: 5n, link: new Uint8Array([9]) }; },
      async getCapOwner() { return '0xw'; },
    } as never;
    await expect(confirmAnchor({ db, adapter, mutex: makeEntityMutex(), cfg }, { entityId: ENTITY, snapshotId: 's2', digest: 'FORGED', expectedSeq: 1 }))
      .rejects.toMatchObject({ code: 'SEQ_MISMATCH' });
    expect(getSnapshot(db, 's2')!.status).toBe('FROZEN');
  });
});
```

- [ ] **Step 2: Run the monkey suite + the FULL api suite + typecheck**

Run: `cd <root>/services/api && npx vitest run && npx tsc --noEmit`
Expected: ALL green. If any monkey test reveals a real hole (e.g. duplicate ingest doubles the ledger), FIX the production module, re-run, and note the fix in the commit.

- [ ] **Step 3: Run the whole repo's affected suites once**

Run: `cd <root>/services/ingestion && npx vitest run && cd <root>/services/anchor-svc && npx vitest run && cd <root>/services/api && npx vitest run`
Expected: all green across the three touched services.

- [ ] **Step 4: Commit**

```bash
git -C <root> add services/api/test/monkey.test.ts
git -C <root> commit -m "test(api): monkey tests (oversized fixture, NaN/out-of-range confidence, dup ingest, concurrent anchor, forged digest)"
```

---

## Self-Review (run after authoring; fix inline)

**Spec coverage map:**
- §3 13 endpoints → Task 7 (all 13, shapes pinned). ✓
- §4 AI (classify+copilot, @google/genai, responseSchema, code routing 0.85, fail-closed, provider seam) → Task 5. ✓
- §5 anchor build/sign split (no tx.build, sender set, serialize IR), cap preflight, gRPC, mutex, A4 gate, anti-tamper, seq re-check → Tasks 6 + 7 (prepare/confirm). ✓
- §6 SQLite schema (entities/events/journal_entries/snapshots/anchors), structural guardrail, state machine, seed → Tasks 2/3/4. ✓
- §7 unified error envelope, fail-closed, AI guardrail import test, monkey tests, demo-e2e → Tasks 7/5/8/9. ✓
- §10 env template + .gitignore → Task 2. ✓
- ingestion normalizeFixture → Task 1. ✓
- OUT OF SCOPE (this plan): frontend `web/`, §8 visual/branding, §8.7 gen-assets script — deferred to the separate frontend plan.

**Verify before executing each task:** the `@google/genai`, `@mysten/sui/grpc` SuiGrpcClient, and `better-sqlite3`/`fastify` API surfaces are pinned to ASSUMED shapes; each task with a `> NOTE:` flags exactly which call to verify against the installed version (use context7 / `node -e` / `/sui-dev-agents:sui-docs-query`). Adapt the call, keep the seam/DTO contracts identical.

**Move contract:** zero changes (reuse deployed testnet package). Only anchor-svc TS is touched.
