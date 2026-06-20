# Off-chain Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the off-chain Ingestion service that faithfully pulls an entity's Sui testnet activity into an immutable `RawTransaction` + derived `RawEffect` store, with provider abstraction, three-layer idempotency, and cursor-resumable backfill.

**Architecture:** A pure-functional core (envelope→effects deconstruction, content-hash canonicalization) wrapped by an idempotent ingest orchestrator that talks to Postgres through a `Repository` interface and to Sui through an `IngestionSource` interface. Sources are swappable (`FixtureSource` for CI, `SuiJsonRpcSource` for testnet). All accounting semantics are deferred downstream — ingestion only records facts.

**Tech Stack:** TypeScript (ESM, strict) · Node ≥20 · Vitest · `@mysten/sui` · Postgres via `pg` + hand-written SQL migrations · `decimal.js` not needed yet (amounts stored as strings).

## Global Constraints

- **Source immutable**: `raw_json` / `content_hash` rows are NEVER updated after first insert. Re-fetch with differing content writes an `IngestionAnomaly`, never an UPDATE.
- **No accounting judgment in ingestion**: never decide account/direction/internal-vs-external. Unknown activity → `kind='unknown'`, never dropped, never errored.
- **Amounts are strings of minor-unit integers**; `decimals` stored alongside. JS `number` is BANNED for monetary values anywhere in this service.
- **Determinism**: deconstruction and content-hash are pure functions — no `Date.now()`, no `Math.random()`, no iteration-order dependence.
- **Provider path (spec §4.1)**: pilot uses `SuiJsonRpcSource` (JSON-RPC, marked throwaway). `IngestionSource.kind` enum already includes `'sui-grpc' | 'sui-graphql'` for post-pilot migration. Do NOT build a gRPC source from guessed method names.
- **Idempotency**: `RawTransaction` PK = `digest`, `INSERT ... ON CONFLICT (digest) DO NOTHING`. Cursor advances only after a page's tx+effects commit in one DB transaction.
- **Path root**: all paths below are relative to `services/ingestion/` under the repo root unless stated.
- **TDD**: every task writes the failing test first, watches it fail, then implements. Commit after each task.

---

## File Structure

```
services/ingestion/
  package.json, tsconfig.json, vitest.config.ts, .env.example
  src/
    domain/
      types.ts            # RawTxEnvelope, RawEffect, RawTransaction, FetchPage, FetchResult, anomaly kinds
      schemas.ts          # zod runtime validators for the above
    source/
      IngestionSource.ts  # interface
      FixtureSource.ts     # replays recorded JSON
      SuiJsonRpcSource.ts  # testnet JSON-RPC impl (throwaway)
    core/
      deconstruct.ts       # pure: RawTxEnvelope -> RawEffect[]
      contentHash.ts       # pure: canonicalize + sha256
    repo/
      Repository.ts        # interface
      InMemoryRepository.ts
      PostgresRepository.ts
    ingest/
      ingestEntity.ts      # orchestrator: fetch loop + idempotent persist + cursor + anomaly
    cli/
      run-ingest.ts        # entrypoint
    migrations/
      001_init.sql
  test/
    fixtures/              # recorded testnet responses (committed)
    *.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `services/ingestion/package.json`
- Create: `services/ingestion/tsconfig.json`
- Create: `services/ingestion/vitest.config.ts`
- Create: `services/ingestion/.env.example`
- Create: `services/ingestion/src/index.ts` (empty marker export)
- Test: `services/ingestion/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable `npm test` (Vitest) and `npm run typecheck` (`tsc --noEmit`).

- [ ] **Step 1: Write the failing test**

```ts
// test/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { ingestionVersion } from '../src/index.js';

describe('scaffold', () => {
  it('exposes a version marker', () => {
    expect(ingestionVersion).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && npm test`
Expected: FAIL — cannot resolve `../src/index.js` / `ingestionVersion` undefined.

- [ ] **Step 3: Create config + minimal source**

`package.json`:
```json
{
  "name": "@subledger/ingestion",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "ingest": "node --import tsx src/cli/run-ingest.ts"
  },
  "dependencies": {
    "@mysten/sui": "^1.0.0",
    "pg": "^8.11.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

`tsconfig.json`:
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
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

`.env.example`:
```
DATABASE_URL=postgres://user:pass@localhost:5432/subledger
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
EXPECTED_CHAIN_IDENTIFIER=4btiuiKKaR9P
```

`src/index.ts`:
```ts
export const ingestionVersion = '0.1.0';
```

- [ ] **Step 4: Install and run**

Run: `cd services/ingestion && npm install && npm test`
Expected: PASS (1 test). Then `npm run typecheck` exits 0.

- [ ] **Step 5: Commit**

```bash
git add services/ingestion
git commit -m "chore(ingestion): scaffold TS service with vitest"
```

> NOTE: repo is currently not a git repo. If `git` errors, run `git init` at repo root first (ask user before committing CLAUDE-related files — see user global rules). Subsequent commit steps assume a repo exists.

---

### Task 2: Domain types + zod schemas

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/schemas.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EffectKind = 'coin_balance_change'|'object_transfer'|'gas'|'staking'|'event'|'unknown'`
  - `interface RawEffect { rawIndex: number; kind: EffectKind; coinType?: string; amount?: string; decimals?: number; counterparty?: string; objectId?: string; rawRef?: string }`
  - `interface RawTxEnvelope { digest: string; checkpoint: string; timestampMs: string; status: 'success'|'failure'; rawJson: unknown }`
  - `interface RawTransaction extends RawTxEnvelope { entityRef: string; contentHash: string }`
  - `interface FetchPage { entityRef: string; address: string; cursor: string|null; limit: number }`
  - `interface FetchResult { txs: RawTxEnvelope[]; nextCursor: string|null; hasNextPage: boolean }`
  - `type AnomalyKind = 'content_mismatch'|'retention_gap'|'effect_overflow'`
  - `const rawTxEnvelopeSchema: ZodType<RawTxEnvelope>` and `rawEffectSchema`.

Note: `checkpoint` and `timestampMs` are strings (BigInt-as-string) to avoid JS number precision loss.

- [ ] **Step 1: Write the failing test**

```ts
// test/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { rawTxEnvelopeSchema } from '../src/domain/schemas.js';

describe('rawTxEnvelopeSchema', () => {
  it('accepts a valid envelope', () => {
    const ok = rawTxEnvelopeSchema.parse({
      digest: 'A1', checkpoint: '100', timestampMs: '1700000000000',
      status: 'success', rawJson: { foo: 1 },
    });
    expect(ok.digest).toBe('A1');
  });
  it('rejects numeric checkpoint (must be string to keep precision)', () => {
    expect(() => rawTxEnvelopeSchema.parse({
      digest: 'A1', checkpoint: 100, timestampMs: '1', status: 'success', rawJson: {},
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + schemas**

```ts
// src/domain/types.ts
export type EffectKind =
  | 'coin_balance_change' | 'object_transfer' | 'gas' | 'staking' | 'event' | 'unknown';

export interface RawEffect {
  rawIndex: number;
  kind: EffectKind;
  coinType?: string;
  amount?: string;      // minor-unit integer as string; never a JS number
  decimals?: number;
  counterparty?: string;
  objectId?: string;
  rawRef?: string;      // pointer back into rawJson for re-derive (esp. 'unknown')
}

export interface RawTxEnvelope {
  digest: string;
  checkpoint: string;   // bigint-as-string
  timestampMs: string;  // bigint-as-string; validator checkpoint time
  status: 'success' | 'failure';
  rawJson: unknown;
}

export interface RawTransaction extends RawTxEnvelope {
  entityRef: string;
  contentHash: string;
}

export interface FetchPage { entityRef: string; address: string; cursor: string | null; limit: number; }
export interface FetchResult { txs: RawTxEnvelope[]; nextCursor: string | null; hasNextPage: boolean; }

export type AnomalyKind = 'content_mismatch' | 'retention_gap' | 'effect_overflow';
export interface IngestionAnomaly { digest: string | null; entityRef: string; kind: AnomalyKind; detail: unknown; }
```

```ts
// src/domain/schemas.ts
import { z } from 'zod';

const numericString = z.string().regex(/^\d+$/, 'must be a non-negative integer string');

export const rawTxEnvelopeSchema = z.object({
  digest: z.string().min(1),
  checkpoint: numericString,
  timestampMs: numericString,
  status: z.enum(['success', 'failure']),
  rawJson: z.unknown(),
});

export const rawEffectSchema = z.object({
  rawIndex: z.number().int().nonnegative(),
  kind: z.enum(['coin_balance_change', 'object_transfer', 'gas', 'staking', 'event', 'unknown']),
  coinType: z.string().optional(),
  amount: z.string().regex(/^-?\d+$/).optional(),  // signed minor-unit integer
  decimals: z.number().int().optional(),
  counterparty: z.string().optional(),
  objectId: z.string().optional(),
  rawRef: z.string().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schemas`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain test/schemas.test.ts
git commit -m "feat(ingestion): domain types and zod schemas"
```

---

### Task 3: content_hash (pure, F6)

**Files:**
- Create: `src/core/contentHash.ts`
- Test: `test/contentHash.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function contentHash(rawJson: unknown): string` — sha256 hex of a canonical JSON with object keys sorted and volatile fields stripped. `function canonicalize(v: unknown): unknown` exported for testing.

Determinism requirement (F6): same logical content → same hash regardless of key order; volatile RPC metadata fields excluded so legitimate re-fetch does not false-trigger `content_mismatch`.

- [ ] **Step 1: Write the failing test**

```ts
// test/contentHash.test.ts
import { describe, it, expect } from 'vitest';
import { contentHash } from '../src/core/contentHash.js';

describe('contentHash', () => {
  it('is stable under key reordering', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
  it('differs when effect content differs', () => {
    expect(contentHash({ x: 1 })).not.toBe(contentHash({ x: 2 }));
  });
  it('ignores volatile metadata fields', () => {
    expect(contentHash({ x: 1, _rpcLatencyMs: 5 })).toBe(contentHash({ x: 1, _rpcLatencyMs: 9 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- contentHash`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/contentHash.ts
import { createHash } from 'node:crypto';

// Fields the RPC may add that are not part of the tx's logical content.
const VOLATILE_KEYS = new Set(['_rpcLatencyMs', 'requestId', 'timestampReceived']);

export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

export function contentHash(rawJson: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(rawJson))).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- contentHash`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/contentHash.ts test/contentHash.test.ts
git commit -m "feat(ingestion): deterministic content_hash with volatile-field stripping"
```

---

### Task 4: Effect deconstruction (pure, F4 — the accounting-critical logic)

**Files:**
- Create: `src/core/deconstruct.ts`
- Test: `test/deconstruct.test.ts`

**Interfaces:**
- Consumes: `RawTxEnvelope` (Task 2). Reads `rawJson` shaped like a `SuiTransactionBlockResponse` (`balanceChanges`, `objectChanges`, `effects.gasUsed`, `events`).
- Produces: `function deconstruct(env: RawTxEnvelope, opts?: { maxEffects?: number }): { effects: RawEffect[]; overflow: boolean }`.

Rules (spec §5.1):
- Each `balanceChanges[i]` → one `coin_balance_change` effect (amount = its `amount` string as-is, signed minor units; coinType, owner→counterparty).
- `effects.gasUsed` → ONE `gas` effect. **Do not also subtract it elsewhere** — the `balanceChanges` SUI delta is already gas-inclusive; mark gas effect `rawRef='effects.gasUsed'` so downstream knows not to double-book.
- `objectChanges[i]` with `objectType` containing `StakedSui` → `staking` effect; other transfers → `object_transfer`.
- `events[i]` → `event` effect.
- Anything unrecognized → `unknown` with `rawRef` pointing to its json path (F4-4). Never throw.
- If total effects would exceed `opts.maxEffects` (default 10_000), stop, set `overflow=true` (caller writes `effect_overflow` anomaly — F4 / red-team #4).

- [ ] **Step 1: Write the failing test**

```ts
// test/deconstruct.test.ts
import { describe, it, expect } from 'vitest';
import { deconstruct } from '../src/core/deconstruct.js';
import type { RawTxEnvelope } from '../src/domain/types.js';

const base = (rawJson: unknown): RawTxEnvelope => ({
  digest: 'D1', checkpoint: '1', timestampMs: '1', status: 'success', rawJson,
});

describe('deconstruct', () => {
  it('maps a balanceChange to a coin_balance_change effect with string amount', () => {
    const { effects } = deconstruct(base({
      balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
    }));
    const c = effects.find(e => e.kind === 'coin_balance_change')!;
    expect(c.amount).toBe('-1000');
    expect(c.coinType).toBe('0x2::sui::SUI');
    expect(typeof c.amount).toBe('string');
  });

  it('emits exactly one gas effect tagged so it is not double-booked', () => {
    const { effects } = deconstruct(base({
      balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
      effects: { gasUsed: { computationCost: '700', storageCost: '300', storageRebate: '100', nonRefundableStorageFee: '0' } },
    }));
    const gas = effects.filter(e => e.kind === 'gas');
    expect(gas).toHaveLength(1);
    expect(gas[0].rawRef).toBe('effects.gasUsed');
  });

  it('classifies StakedSui objectChange as staking', () => {
    const { effects } = deconstruct(base({
      objectChanges: [{ type: 'created', objectType: '0x3::staking_pool::StakedSui', objectId: '0xs' }],
    }));
    expect(effects.some(e => e.kind === 'staking' && e.objectId === '0xs')).toBe(true);
  });

  it('never throws on unrecognized shape and yields unknown with rawRef', () => {
    const { effects } = deconstruct(base({ weirdField: [{ z: 1 }] }));
    expect(effects.some(e => e.kind === 'unknown')).toBe(true);
    expect(effects.find(e => e.kind === 'unknown')!.rawRef).toBeDefined();
  });

  it('sets overflow when effect count exceeds the cap', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ coinType: 'c', owner: { AddressOwner: '0x' + i }, amount: '1' }));
    const { overflow } = deconstruct(base({ balanceChanges: many }), { maxEffects: 3 });
    expect(overflow).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- deconstruct`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/deconstruct.ts
import type { RawTxEnvelope, RawEffect } from '../domain/types.js';

const DEFAULT_MAX = 10_000;

function ownerToAddress(owner: unknown): string | undefined {
  if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
    return String((owner as Record<string, unknown>).AddressOwner);
  }
  return undefined;
}

export function deconstruct(
  env: RawTxEnvelope,
  opts: { maxEffects?: number } = {},
): { effects: RawEffect[]; overflow: boolean } {
  const max = opts.maxEffects ?? DEFAULT_MAX;
  const json = (env.rawJson ?? {}) as Record<string, unknown>;
  const effects: RawEffect[] = [];
  let overflow = false;
  let idx = 0;
  const push = (e: Omit<RawEffect, 'rawIndex'>): boolean => {
    if (effects.length >= max) { overflow = true; return false; }
    effects.push({ rawIndex: idx++, ...e });
    return true;
  };

  const balanceChanges = Array.isArray(json.balanceChanges) ? json.balanceChanges : [];
  for (let i = 0; i < balanceChanges.length; i++) {
    const b = balanceChanges[i] as Record<string, unknown>;
    if (!push({
      kind: 'coin_balance_change',
      coinType: b.coinType != null ? String(b.coinType) : undefined,
      amount: b.amount != null ? String(b.amount) : undefined,
      counterparty: ownerToAddress(b.owner),
      rawRef: `balanceChanges.${i}`,
    })) return { effects, overflow };
  }

  const objectChanges = Array.isArray(json.objectChanges) ? json.objectChanges : [];
  for (let i = 0; i < objectChanges.length; i++) {
    const o = objectChanges[i] as Record<string, unknown>;
    const objectType = o.objectType != null ? String(o.objectType) : '';
    const isStake = objectType.includes('StakedSui');
    if (!push({
      kind: isStake ? 'staking' : 'object_transfer',
      objectId: o.objectId != null ? String(o.objectId) : undefined,
      rawRef: `objectChanges.${i}`,
    })) return { effects, overflow };
  }

  const gasUsed = (json.effects as Record<string, unknown> | undefined)?.gasUsed;
  if (gasUsed && typeof gasUsed === 'object') {
    if (!push({ kind: 'gas', coinType: '0x2::sui::SUI', rawRef: 'effects.gasUsed' })) {
      return { effects, overflow };
    }
  }

  const events = Array.isArray(json.events) ? json.events : [];
  for (let i = 0; i < events.length; i++) {
    if (!push({ kind: 'event', rawRef: `events.${i}` })) return { effects, overflow };
  }

  // Exception-first: if we recognized nothing, record an unknown so the tx is never silently empty.
  const known = new Set(['balanceChanges', 'objectChanges', 'effects', 'events']);
  if (effects.length === 0) {
    const otherKey = Object.keys(json).find(k => !known.has(k)) ?? '$root';
    push({ kind: 'unknown', rawRef: otherKey });
  }

  return { effects, overflow };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- deconstruct`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/deconstruct.ts test/deconstruct.test.ts
git commit -m "feat(ingestion): faithful effect deconstruction with gas/staking handling"
```

---

### Task 5: IngestionSource interface + FixtureSource

**Files:**
- Create: `src/source/IngestionSource.ts`
- Create: `src/source/FixtureSource.ts`
- Create: `test/fixtures/page-1.json`, `test/fixtures/page-2.json`
- Test: `test/fixtureSource.test.ts`

**Interfaces:**
- Consumes: `FetchPage`, `FetchResult`, `RawTxEnvelope` (Task 2).
- Produces:
  - `interface IngestionSource { readonly kind: 'sui-jsonrpc'|'sui-grpc'|'sui-graphql'|'fixture'; fetchTransactions(req: FetchPage): Promise<FetchResult>; describe(): Promise<{ chainIdentifier: string; epoch: number }> }`
  - `class FixtureSource implements IngestionSource` constructed from an ordered array of `FetchResult` pages; serves pages by cursor.

- [ ] **Step 1: Write the failing test**

```ts
// test/fixtureSource.test.ts
import { describe, it, expect } from 'vitest';
import { FixtureSource } from '../src/source/FixtureSource.js';
import type { FetchResult } from '../src/domain/types.js';

const env = (digest: string): FetchResult['txs'][number] =>
  ({ digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: {} });

describe('FixtureSource', () => {
  const pages: FetchResult[] = [
    { txs: [env('A'), env('B')], nextCursor: 'c1', hasNextPage: true },
    { txs: [env('C')], nextCursor: null, hasNextPage: false },
  ];
  const src = new FixtureSource('4btiuiKKaR9P', 100, pages);

  it('serves the first page when cursor is null', async () => {
    const r = await src.fetchTransactions({ entityRef: 'e', address: '0xa', cursor: null, limit: 50 });
    expect(r.txs.map(t => t.digest)).toEqual(['A', 'B']);
    expect(r.nextCursor).toBe('c1');
  });
  it('serves the next page by cursor', async () => {
    const r = await src.fetchTransactions({ entityRef: 'e', address: '0xa', cursor: 'c1', limit: 50 });
    expect(r.txs.map(t => t.digest)).toEqual(['C']);
    expect(r.hasNextPage).toBe(false);
  });
  it('describe() returns the configured chain identifier', async () => {
    expect((await src.describe()).chainIdentifier).toBe('4btiuiKKaR9P');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fixtureSource`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/source/IngestionSource.ts
import type { FetchPage, FetchResult } from '../domain/types.js';
export interface IngestionSource {
  readonly kind: 'sui-jsonrpc' | 'sui-grpc' | 'sui-graphql' | 'fixture';
  fetchTransactions(req: FetchPage): Promise<FetchResult>;
  describe(): Promise<{ chainIdentifier: string; epoch: number }>;
}
```

```ts
// src/source/FixtureSource.ts
import type { FetchPage, FetchResult } from '../domain/types.js';
import type { IngestionSource } from './IngestionSource.js';

export class FixtureSource implements IngestionSource {
  readonly kind = 'fixture' as const;
  // pages are consumed in order; first page answers cursor=null, each page's
  // nextCursor is the key to the following page.
  private byCursor = new Map<string | null, FetchResult>();

  constructor(private chainId: string, private epoch: number, pages: FetchResult[]) {
    let key: string | null = null;
    for (const page of pages) {
      this.byCursor.set(key, page);
      key = page.nextCursor;
    }
  }

  async fetchTransactions(req: FetchPage): Promise<FetchResult> {
    return this.byCursor.get(req.cursor)
      ?? { txs: [], nextCursor: null, hasNextPage: false };
  }

  async describe() { return { chainIdentifier: this.chainId, epoch: this.epoch }; }
}
```

(The two fixture JSON files in `test/fixtures/` are optional sample payloads; the unit test above constructs pages inline, so create them only if a later integration test references them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fixtureSource`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/source/IngestionSource.ts src/source/FixtureSource.ts test/fixtureSource.test.ts
git commit -m "feat(ingestion): IngestionSource interface and FixtureSource"
```

---

### Task 6: Repository interface + InMemoryRepository

**Files:**
- Create: `src/repo/Repository.ts`
- Create: `src/repo/InMemoryRepository.ts`
- Test: `test/inMemoryRepository.test.ts`

**Interfaces:**
- Consumes: `RawTransaction`, `RawEffect`, `IngestionAnomaly` (Task 2).
- Produces:
  - `interface Repository { insertTxIfAbsent(tx, effects): Promise<'inserted'|'duplicate'|{ conflict: 'content_mismatch'; existingHash: string }>; getCursor(key): Promise<{ cursor: string|null; lastCheckpoint: string|null }|null>; setCursor(key, cursor, lastCheckpoint): Promise<void>; recordAnomaly(a): Promise<void>; }`
  - `type CursorKey = { entityRef: string; address: string; sourceKind: string }`
  - `class InMemoryRepository implements Repository`.

Semantics (spec §6): `insertTxIfAbsent` is the idempotency primitive. If `digest` absent → insert tx+effects atomically, return `'inserted'`. If present with same `contentHash` → `'duplicate'` (no-op). If present with different `contentHash` → return conflict object, DO NOT overwrite.

- [ ] **Step 1: Write the failing test**

```ts
// test/inMemoryRepository.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { RawTransaction } from '../src/domain/types.js';

const tx = (digest: string, contentHash: string): RawTransaction => ({
  digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: {}, entityRef: 'e', contentHash,
});

describe('InMemoryRepository idempotency', () => {
  it('inserts once, reports duplicate on identical re-insert', async () => {
    const repo = new InMemoryRepository();
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('inserted');
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('duplicate');
  });
  it('flags content_mismatch without overwriting the original', async () => {
    const repo = new InMemoryRepository();
    await repo.insertTxIfAbsent(tx('A', 'h1'), []);
    const r = await repo.insertTxIfAbsent(tx('A', 'h2'), []);
    expect(r).toEqual({ conflict: 'content_mismatch', existingHash: 'h1' });
    expect(repo.dump().get('A')!.contentHash).toBe('h1'); // unchanged
  });
  it('round-trips cursor by key', async () => {
    const repo = new InMemoryRepository();
    const key = { entityRef: 'e', address: '0xa', sourceKind: 'fixture' };
    await repo.setCursor(key, 'c1', '50');
    expect(await repo.getCursor(key)).toEqual({ cursor: 'c1', lastCheckpoint: '50' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- inMemoryRepository`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/repo/Repository.ts
import type { RawTransaction, RawEffect, IngestionAnomaly } from '../domain/types.js';

export type CursorKey = { entityRef: string; address: string; sourceKind: string };
export type InsertResult = 'inserted' | 'duplicate' | { conflict: 'content_mismatch'; existingHash: string };

export interface Repository {
  insertTxIfAbsent(tx: RawTransaction, effects: RawEffect[]): Promise<InsertResult>;
  getCursor(key: CursorKey): Promise<{ cursor: string | null; lastCheckpoint: string | null } | null>;
  setCursor(key: CursorKey, cursor: string | null, lastCheckpoint: string | null): Promise<void>;
  recordAnomaly(a: IngestionAnomaly): Promise<void>;
}
```

```ts
// src/repo/InMemoryRepository.ts
import type { RawTransaction, RawEffect, IngestionAnomaly } from '../domain/types.js';
import type { Repository, CursorKey, InsertResult } from './Repository.js';

const ck = (k: CursorKey) => `${k.entityRef}|${k.address}|${k.sourceKind}`;

export class InMemoryRepository implements Repository {
  private txs = new Map<string, RawTransaction>();
  private effects = new Map<string, RawEffect[]>();
  private cursors = new Map<string, { cursor: string | null; lastCheckpoint: string | null }>();
  readonly anomalies: IngestionAnomaly[] = [];

  async insertTxIfAbsent(tx: RawTransaction, effects: RawEffect[]): Promise<InsertResult> {
    const existing = this.txs.get(tx.digest);
    if (existing) {
      if (existing.contentHash === tx.contentHash) return 'duplicate';
      return { conflict: 'content_mismatch', existingHash: existing.contentHash };
    }
    this.txs.set(tx.digest, tx);
    this.effects.set(tx.digest, effects);
    return 'inserted';
  }
  async getCursor(key: CursorKey) { return this.cursors.get(ck(key)) ?? null; }
  async setCursor(key: CursorKey, cursor: string | null, lastCheckpoint: string | null) {
    this.cursors.set(ck(key), { cursor, lastCheckpoint });
  }
  async recordAnomaly(a: IngestionAnomaly) { this.anomalies.push(a); }
  dump() { return this.txs; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- inMemoryRepository`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/repo/Repository.ts src/repo/InMemoryRepository.ts test/inMemoryRepository.test.ts
git commit -m "feat(ingestion): Repository interface and in-memory idempotent impl"
```

---

### Task 7: ingestEntity orchestrator (idempotency + cursor + anomalies)

**Files:**
- Create: `src/ingest/ingestEntity.ts`
- Test: `test/ingestEntity.test.ts`

**Interfaces:**
- Consumes: `IngestionSource` (Task 5), `Repository` + `CursorKey` (Task 6), `deconstruct` (Task 4), `contentHash` (Task 3), schemas (Task 2).
- Produces: `function ingestEntity(args: { source: IngestionSource; repo: Repository; entityRef: string; address: string; pageLimit?: number }): Promise<{ inserted: number; duplicate: number; anomalies: number; pages: number }>`.

Behavior (spec §6, §10):
- Resume from stored cursor for key `{entityRef, address, source.kind}`.
- For each page: validate each envelope (`rawTxEnvelopeSchema`); compute `contentHash`; `deconstruct`; if `overflow` record `effect_overflow` anomaly; `insertTxIfAbsent`; on `content_mismatch` conflict record `content_mismatch` anomaly (never overwrite); tally.
- Advance cursor only AFTER the page's inserts complete (mirrors the single-DB-transaction rule; InMemory makes this trivially atomic per call).
- Loop until `hasNextPage` is false.

- [ ] **Step 1: Write the failing test**

```ts
// test/ingestEntity.test.ts
import { describe, it, expect } from 'vitest';
import { ingestEntity } from '../src/ingest/ingestEntity.js';
import { FixtureSource } from '../src/source/FixtureSource.js';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { FetchResult } from '../src/domain/types.js';

const env = (digest: string, rawJson: unknown = {}): FetchResult['txs'][number] =>
  ({ digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson });

const twoPages = (): FetchResult[] => ([
  { txs: [env('A'), env('B')], nextCursor: 'c1', hasNextPage: true },
  { txs: [env('C')], nextCursor: null, hasNextPage: false },
]);

describe('ingestEntity', () => {
  it('ingests all pages and persists each tx once', async () => {
    const repo = new InMemoryRepository();
    const src = new FixtureSource('cid', 1, twoPages());
    const r = await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });
    expect(r.inserted).toBe(3);
    expect(r.pages).toBe(2);
  });

  it('is idempotent: a second run inserts nothing new', async () => {
    const repo = new InMemoryRepository();
    const src = new FixtureSource('cid', 1, twoPages());
    await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });
    // reset cursor to force a full re-scan from the start
    await repo.setCursor({ entityRef: 'e', address: '0xa', sourceKind: 'fixture' }, null, null);
    const r2 = await ingestEntity({ source: src, repo, entityRef: 'e', address: '0xa' });
    expect(r2.inserted).toBe(0);
    expect(r2.duplicate).toBe(3);
  });

  it('records content_mismatch anomaly and keeps the original', async () => {
    const repo = new InMemoryRepository();
    const first = new FixtureSource('cid', 1, [{ txs: [env('A', { x: 1 })], nextCursor: null, hasNextPage: false }]);
    const second = new FixtureSource('cid', 1, [{ txs: [env('A', { x: 999 })], nextCursor: null, hasNextPage: false }]);
    await ingestEntity({ source: first, repo, entityRef: 'e', address: '0xa' });
    await repo.setCursor({ entityRef: 'e', address: '0xa', sourceKind: 'fixture' }, null, null);
    const r = await ingestEntity({ source: second, repo, entityRef: 'e', address: '0xa' });
    expect(r.anomalies).toBe(1);
    expect(repo.anomalies[0].kind).toBe('content_mismatch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ingestEntity`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/ingest/ingestEntity.ts
import type { IngestionSource } from '../source/IngestionSource.js';
import type { Repository } from '../repo/Repository.js';
import type { RawTransaction } from '../domain/types.js';
import { rawTxEnvelopeSchema } from '../domain/schemas.js';
import { contentHash } from '../core/contentHash.js';
import { deconstruct } from '../core/deconstruct.js';

export async function ingestEntity(args: {
  source: IngestionSource; repo: Repository; entityRef: string; address: string; pageLimit?: number;
}): Promise<{ inserted: number; duplicate: number; anomalies: number; pages: number }> {
  const { source, repo, entityRef, address } = args;
  const pageLimit = args.pageLimit ?? 50;
  const key = { entityRef, address, sourceKind: source.kind };
  const stored = await repo.getCursor(key);
  let cursor = stored?.cursor ?? null;

  let inserted = 0, duplicate = 0, anomalies = 0, pages = 0;

  for (;;) {
    const page = await source.fetchTransactions({ entityRef, address, cursor, limit: pageLimit });
    pages++;
    for (const env of page.txs) {
      const parsed = rawTxEnvelopeSchema.parse(env);
      const tx: RawTransaction = { ...parsed, entityRef, contentHash: contentHash(parsed.rawJson) };
      const { effects, overflow } = deconstruct(parsed);
      if (overflow) {
        await repo.recordAnomaly({ digest: tx.digest, entityRef, kind: 'effect_overflow', detail: { effects: effects.length } });
        anomalies++;
      }
      const res = await repo.insertTxIfAbsent(tx, effects);
      if (res === 'inserted') inserted++;
      else if (res === 'duplicate') duplicate++;
      else {
        await repo.recordAnomaly({ digest: tx.digest, entityRef, kind: 'content_mismatch', detail: { existingHash: res.existingHash, newHash: tx.contentHash } });
        anomalies++;
      }
    }
    // advance cursor only after the page is fully persisted
    await repo.setCursor(key, page.nextCursor, page.txs.at(-1)?.checkpoint ?? stored?.lastCheckpoint ?? null);
    cursor = page.nextCursor;
    if (!page.hasNextPage) break;
  }
  return { inserted, duplicate, anomalies, pages };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ingestEntity`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/ingestEntity.ts test/ingestEntity.test.ts
git commit -m "feat(ingestion): idempotent ingest orchestrator with cursor + anomalies"
```

---

### Task 8: Postgres schema + PostgresRepository (integration-gated)

**Files:**
- Create: `src/migrations/001_init.sql`
- Create: `src/repo/PostgresRepository.ts`
- Test: `test/postgresRepository.test.ts` (skips when `DATABASE_URL` unset)

**Interfaces:**
- Consumes: `Repository` contract (Task 6).
- Produces: `class PostgresRepository implements Repository` constructed from a `pg` `Pool`; same semantics as `InMemoryRepository`, backed by SQL.

The `insertTxIfAbsent` must do tx+effects in ONE SQL transaction; content-mismatch detected via `ON CONFLICT (digest) DO NOTHING` + a follow-up read of the existing `content_hash`.

- [ ] **Step 1: Write the migration**

```sql
-- src/migrations/001_init.sql
CREATE TABLE IF NOT EXISTS raw_transaction (
  digest        TEXT PRIMARY KEY,
  entity_ref    TEXT NOT NULL,
  checkpoint    BIGINT NOT NULL,
  timestamp_ms  BIGINT NOT NULL,
  status        TEXT NOT NULL,
  raw_json      JSONB NOT NULL,
  content_hash  TEXT NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw_effect (
  digest        TEXT NOT NULL REFERENCES raw_transaction(digest),
  raw_index     INT NOT NULL,
  kind          TEXT NOT NULL,
  coin_type     TEXT, amount TEXT, decimals INT,
  counterparty  TEXT, object_id TEXT, raw_ref TEXT,
  PRIMARY KEY (digest, raw_index)
);
CREATE TABLE IF NOT EXISTS ingestion_checkpoint (
  entity_ref TEXT NOT NULL, address TEXT NOT NULL, source_kind TEXT NOT NULL,
  last_cursor TEXT, last_checkpoint BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_ref, address, source_kind)
);
CREATE TABLE IF NOT EXISTS ingestion_anomaly (
  id BIGSERIAL PRIMARY KEY, digest TEXT, entity_ref TEXT,
  kind TEXT NOT NULL, detail JSONB, detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing (integration-gated) test**

```ts
// test/postgresRepository.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PostgresRepository } from '../src/repo/PostgresRepository.js';
import type { RawTransaction } from '../src/domain/types.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

const tx = (digest: string, h: string): RawTransaction => ({
  digest, checkpoint: '1', timestampMs: '1', status: 'success', rawJson: { a: 1 }, entityRef: 'e', contentHash: h,
});

d('PostgresRepository', () => {
  let repo: PostgresRepository;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await pool.query(readFileSync('src/migrations/001_init.sql', 'utf8'));
    await pool.query('TRUNCATE raw_effect, raw_transaction, ingestion_checkpoint, ingestion_anomaly');
    repo = new PostgresRepository(pool);
  });
  it('insert then duplicate', async () => {
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('inserted');
    expect(await repo.insertTxIfAbsent(tx('A', 'h1'), [])).toBe('duplicate');
  });
  it('content_mismatch does not overwrite', async () => {
    const r = await repo.insertTxIfAbsent(tx('A', 'h2'), []);
    expect(r).toEqual({ conflict: 'content_mismatch', existingHash: 'h1' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails (with DB) or skips (without)**

Run: `npm test -- postgresRepository`
Expected without `DATABASE_URL`: SKIPPED. With a test Postgres: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/repo/PostgresRepository.ts
import type { Pool } from 'pg';
import type { RawTransaction, RawEffect, IngestionAnomaly } from '../domain/types.js';
import type { Repository, CursorKey, InsertResult } from './Repository.js';

export class PostgresRepository implements Repository {
  constructor(private pool: Pool) {}

  async insertTxIfAbsent(tx: RawTransaction, effects: RawEffect[]): Promise<InsertResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO raw_transaction (digest, entity_ref, checkpoint, timestamp_ms, status, raw_json, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (digest) DO NOTHING`,
        [tx.digest, tx.entityRef, tx.checkpoint, tx.timestampMs, tx.status, tx.rawJson, tx.contentHash],
      );
      if (ins.rowCount === 0) {
        const row = await client.query('SELECT content_hash FROM raw_transaction WHERE digest=$1', [tx.digest]);
        const existingHash = row.rows[0].content_hash as string;
        await client.query('COMMIT');
        return existingHash === tx.contentHash ? 'duplicate' : { conflict: 'content_mismatch', existingHash };
      }
      for (const e of effects) {
        await client.query(
          `INSERT INTO raw_effect (digest, raw_index, kind, coin_type, amount, decimals, counterparty, object_id, raw_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (digest, raw_index) DO NOTHING`,
          [tx.digest, e.rawIndex, e.kind, e.coinType ?? null, e.amount ?? null, e.decimals ?? null,
           e.counterparty ?? null, e.objectId ?? null, e.rawRef ?? null],
        );
      }
      await client.query('COMMIT');
      return 'inserted';
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCursor(key: CursorKey) {
    const r = await this.pool.query(
      `SELECT last_cursor, last_checkpoint FROM ingestion_checkpoint
       WHERE entity_ref=$1 AND address=$2 AND source_kind=$3`,
      [key.entityRef, key.address, key.sourceKind],
    );
    if (r.rowCount === 0) return null;
    return { cursor: r.rows[0].last_cursor, lastCheckpoint: r.rows[0].last_checkpoint?.toString() ?? null };
  }

  async setCursor(key: CursorKey, cursor: string | null, lastCheckpoint: string | null) {
    await this.pool.query(
      `INSERT INTO ingestion_checkpoint (entity_ref, address, source_kind, last_cursor, last_checkpoint, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (entity_ref, address, source_kind)
       DO UPDATE SET last_cursor=EXCLUDED.last_cursor, last_checkpoint=EXCLUDED.last_checkpoint, updated_at=now()`,
      [key.entityRef, key.address, key.sourceKind, cursor, lastCheckpoint],
    );
  }

  async recordAnomaly(a: IngestionAnomaly) {
    await this.pool.query(
      `INSERT INTO ingestion_anomaly (digest, entity_ref, kind, detail) VALUES ($1,$2,$3,$4)`,
      [a.digest, a.entityRef, a.kind, a.detail],
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes (with DB)**

Run: `DATABASE_URL=postgres://... npm test -- postgresRepository`
Expected: PASS. Without DB it stays SKIPPED — that's acceptable for CI.

- [ ] **Step 6: Commit**

```bash
git add src/migrations/001_init.sql src/repo/PostgresRepository.ts test/postgresRepository.test.ts
git commit -m "feat(ingestion): Postgres schema and repository with atomic upsert"
```

---

### Task 9: SuiJsonRpcSource (testnet, throwaway per §4.1)

**Files:**
- Create: `src/source/SuiJsonRpcSource.ts`
- Test: `test/suiJsonRpcSource.test.ts` (uses a stubbed client; no network)

**Interfaces:**
- Consumes: `IngestionSource` (Task 5), `@mysten/sui/client` `SuiClient`.
- Produces: `class SuiJsonRpcSource implements IngestionSource` with `kind='sui-jsonrpc'`, constructed from a `SuiClient` and the expected chain identifier. Maps `queryTransactionBlocks` responses into `RawTxEnvelope[]`.

Mapping: for each `SuiTransactionBlockResponse` → `{ digest, checkpoint: r.checkpoint, timestampMs: r.timestampMs, status: r.effects?.status?.status === 'success' ? 'success' : 'failure', rawJson: r }`. `describe()` calls `client.getChainIdentifier()` and asserts it equals the expected id (F3); epoch via `client.getLatestSuiSystemState()`.

To keep the test offline, accept a minimal client interface (structural type) so the test injects a stub.

- [ ] **Step 1: Write the failing test**

```ts
// test/suiJsonRpcSource.test.ts
import { describe, it, expect } from 'vitest';
import { SuiJsonRpcSource } from '../src/source/SuiJsonRpcSource.js';

const stubClient = {
  async getChainIdentifier() { return '4btiuiKKaR9P'; },
  async getLatestSuiSystemState() { return { epoch: '42' }; },
  async queryTransactionBlocks() {
    return {
      data: [{ digest: 'A', checkpoint: '10', timestampMs: '1700', effects: { status: { status: 'success' } } }],
      nextCursor: 'c1', hasNextPage: true,
    };
  },
};

describe('SuiJsonRpcSource', () => {
  it('maps responses to envelopes and preserves rawJson', async () => {
    const src = new SuiJsonRpcSource(stubClient as never, '4btiuiKKaR9P');
    const r = await src.fetchTransactions({ entityRef: 'e', address: '0xa', cursor: null, limit: 50 });
    expect(r.txs[0].digest).toBe('A');
    expect(r.txs[0].status).toBe('success');
    expect(r.nextCursor).toBe('c1');
  });
  it('describe() asserts the expected chain identifier', async () => {
    const src = new SuiJsonRpcSource(stubClient as never, '4btiuiKKaR9P');
    expect((await src.describe()).chainIdentifier).toBe('4btiuiKKaR9P');
  });
  it('describe() throws on chain identifier mismatch (network guard, F3)', async () => {
    const wrong = new SuiJsonRpcSource(stubClient as never, 'MAINNET_ID');
    await expect(src_describe(wrong)).rejects.toThrow();
  });
});
function src_describe(s: { describe: () => Promise<unknown> }) { return s.describe(); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- suiJsonRpcSource`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/source/SuiJsonRpcSource.ts
import type { FetchPage, FetchResult, RawTxEnvelope } from '../domain/types.js';
import type { IngestionSource } from './IngestionSource.js';

// Structural subset of @mysten/sui SuiClient — keeps tests offline and
// insulates us from the throwaway JSON-RPC surface (spec §4.1).
export interface SuiClientLike {
  getChainIdentifier(): Promise<string>;
  getLatestSuiSystemState(): Promise<{ epoch: string }>;
  queryTransactionBlocks(args: unknown): Promise<{ data: any[]; nextCursor: string | null; hasNextPage: boolean }>;
}

export class SuiJsonRpcSource implements IngestionSource {
  readonly kind = 'sui-jsonrpc' as const;
  constructor(private client: SuiClientLike, private expectedChainId: string) {}

  async fetchTransactions(req: FetchPage): Promise<FetchResult> {
    const res = await this.client.queryTransactionBlocks({
      filter: { FromOrToAddress: { addr: req.address } },
      options: { showEffects: true, showBalanceChanges: true, showObjectChanges: true, showEvents: true, showInput: true },
      cursor: req.cursor, limit: req.limit, order: 'ascending',
    });
    const txs: RawTxEnvelope[] = res.data.map((r) => ({
      digest: String(r.digest),
      checkpoint: String(r.checkpoint ?? '0'),
      timestampMs: String(r.timestampMs ?? '0'),
      status: r?.effects?.status?.status === 'success' ? 'success' : 'failure',
      rawJson: r,
    }));
    return { txs, nextCursor: res.nextCursor, hasNextPage: res.hasNextPage };
  }

  async describe() {
    const chainIdentifier = await this.client.getChainIdentifier();
    if (chainIdentifier !== this.expectedChainId) {
      throw new Error(`chain identifier mismatch: got ${chainIdentifier}, expected ${this.expectedChainId}`);
    }
    const state = await this.client.getLatestSuiSystemState();
    return { chainIdentifier, epoch: Number(state.epoch) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- suiJsonRpcSource`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/source/SuiJsonRpcSource.ts test/suiJsonRpcSource.test.ts
git commit -m "feat(ingestion): testnet JSON-RPC source with chain-id network guard"
```

---

### Task 10: CLI entrypoint + end-to-end acceptance test

**Files:**
- Create: `src/cli/run-ingest.ts`
- Create: `test/acceptance.test.ts`
- Create: `test/fixtures/recorded-testnet.json` (a small hand-built array of 2 pages mimicking real responses)

**Interfaces:**
- Consumes: everything above.
- Produces: a CLI that, given env (`DATABASE_URL`, `SUI_RPC_URL`, `EXPECTED_CHAIN_IDENTIFIER`) and an `--address` arg, runs `ingestEntity` against `SuiJsonRpcSource` + `PostgresRepository`, calling `describe()` first as a startup network guard. The acceptance test wires `FixtureSource` + `InMemoryRepository` to prove the whole path offline (spec §10.5).

- [ ] **Step 1: Write the failing acceptance test**

```ts
// test/acceptance.test.ts
import { describe, it, expect } from 'vitest';
import { ingestEntity } from '../src/ingest/ingestEntity.js';
import { FixtureSource } from '../src/source/FixtureSource.js';
import { InMemoryRepository } from '../src/repo/InMemoryRepository.js';
import type { FetchResult } from '../src/domain/types.js';

// One page carries a realistic mix: a coin transfer, gas, and an unknown shape.
const realisticPages = (): FetchResult[] => ([
  { txs: [
      { digest: 'T1', checkpoint: '100', timestampMs: '1700000000000', status: 'success',
        rawJson: { balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
                   effects: { gasUsed: { computationCost: '700', storageCost: '300', storageRebate: '100', nonRefundableStorageFee: '0' } } } },
      { digest: 'T2', checkpoint: '101', timestampMs: '1700000001000', status: 'success',
        rawJson: { weird: [{ z: 1 }] } },
    ], nextCursor: null, hasNextPage: false },
]);

describe('acceptance: full path offline (spec §10)', () => {
  it('ingests, is idempotent on re-run, and never drops unknown activity', async () => {
    const repo = new InMemoryRepository();
    const key = { entityRef: 'pilot', address: '0xa', sourceKind: 'fixture' };

    const r1 = await ingestEntity({ source: new FixtureSource('cid', 1, realisticPages()), repo, entityRef: 'pilot', address: '0xa' });
    expect(r1.inserted).toBe(2);

    await repo.setCursor(key, null, null);
    const r2 = await ingestEntity({ source: new FixtureSource('cid', 1, realisticPages()), repo, entityRef: 'pilot', address: '0xa' });
    expect(r2.inserted).toBe(0);
    expect(r2.duplicate).toBe(2);          // §10.2 idempotency: 0 new rows
    expect(repo.dump().size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- acceptance`
Expected: FAIL — `ingestEntity` re-run assertions fail only if logic is wrong; if all prior tasks pass it should already PASS. If it fails, fix the orchestrator, not the test.

> If the acceptance test passes immediately (because Tasks 4/7 already satisfy it), that is fine — it is a regression guard. Still complete the CLI below.

- [ ] **Step 3: Implement the CLI**

```ts
// src/cli/run-ingest.ts
import { Pool } from 'pg';
import { SuiClient } from '@mysten/sui/client';
import { SuiJsonRpcSource } from '../source/SuiJsonRpcSource.js';
import { PostgresRepository } from '../repo/PostgresRepository.js';
import { ingestEntity } from '../ingest/ingestEntity.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const address = arg('address');
  const entityRef = arg('entity') ?? 'pilot';
  if (!address) throw new Error('usage: ingest --address 0x.. [--entity name]');

  const rpcUrl = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
  const expectedChainId = process.env.EXPECTED_CHAIN_IDENTIFIER;
  if (!expectedChainId) throw new Error('EXPECTED_CHAIN_IDENTIFIER is required (network guard, F3)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const source = new SuiJsonRpcSource(new SuiClient({ url: rpcUrl }) as never, expectedChainId);
  const guard = await source.describe();           // startup network guard
  console.log(`ingesting from chain=${guard.chainIdentifier} epoch=${guard.epoch}`);

  const repo = new PostgresRepository(new Pool({ connectionString: process.env.DATABASE_URL }));
  const result = await ingestEntity({ source, repo, entityRef, address });
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the acceptance test + typecheck**

Run: `npm test -- acceptance && npm run typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Manual smoke against testnet (optional, documented)**

Run (requires a funded/active testnet address with history):
```bash
SUI_RPC_URL=https://fullnode.testnet.sui.io:443 \
EXPECTED_CHAIN_IDENTIFIER=<run `sui client chain-identifier` on testnet> \
DATABASE_URL=postgres://... \
npm run ingest -- --address 0x<entity-address> --entity pilot
```
Expected: prints chain/epoch then a JSON tally `{ inserted, duplicate, anomalies, pages }`. Re-running prints `inserted: 0`.

> The exact `EXPECTED_CHAIN_IDENTIFIER` for testnet must be fetched live (do not hardcode a guessed value). `.env.example` carries a placeholder.

- [ ] **Step 6: Commit**

```bash
git add src/cli/run-ingest.ts test/acceptance.test.ts test/fixtures
git commit -m "feat(ingestion): CLI entrypoint and offline end-to-end acceptance test"
```

---

## Post-implementation: Monkey Testing (project rule .claude/rules/test.md)

After all tasks pass, do adversarial testing — try to break it:
- Feed a tx with 50k balanceChanges → assert `effect_overflow` anomaly, no OOM, no crash.
- Feed two pages where page 2's cursor loops back to page 1's cursor → assert no infinite loop (add a visited-cursor guard if it loops).
- Feed an envelope with `checkpoint: '999999999999999999999'` (beyond BIGINT) → assert it fails loud at PG insert, not silently truncates.
- Feed `rawJson` with deeply nested 100-level objects → assert `contentHash` terminates.
- Feed the same digest from two different `entityRef`s → assert first wins, second is `duplicate`, ownership not reassigned.

Record findings in `move-notes.md` is wrong file — record in a new `tasks/ingestion-notes.md`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1 stack TS → Tasks 1–2. §3 ingest scope/API → Task 9. §4 provider interface → Task 5; §4.1 JSON-RPC throwaway → Task 9; §4.2 describe/getChainIdentifier → Task 9. §5 schema → Tasks 2, 8; §5.1 gas/staking/unknown → Task 4. §6 idempotency three layers → Tasks 6, 7, 8 (layer1 ON CONFLICT=Task 8/6, layer2 content_hash=Tasks 3/7, layer3 effect re-derive=Tasks 4/8, cursor=Tasks 7/8). §7 red-team #4 overflow → Task 4; #1 chain guard → Task 9. §8.1 retention_gap → **GAP: not implemented as live check** (see note). §10 acceptance 1–9 → Task 10 + per-task tests.
- **Known gap (intentional):** §10.7 `retention_gap` completeness assertion requires knowing the node's earliest checkpoint, which depends on the live RPC (F2). Deferred: the `AnomalyKind` includes `'retention_gap'` (Task 2) so the type is ready, but the live detection is a post-pilot task once an archival node is pinned. Flagged here rather than silently dropped (Rule 12).

**Placeholder scan:** no TBD/TODO in code steps; every code step shows full code.

**Type consistency:** `InsertResult`, `CursorKey`, `RawEffect`, `RawTxEnvelope`, `IngestionSource.kind` enum (`'sui-jsonrpc'|'sui-grpc'|'sui-graphql'|'fixture'`) consistent across Tasks 2/5/6/7/8/9. `ingestEntity` return shape consistent between Task 7 and Task 10 assertions.
