# Anchor Svc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/anchor-svc/` — an off-chain TS module that takes `buildSnapshot()`'s `anchorPayload`/`auditSnapshot` and anchors it on testnet via `audit_anchor::anchor_snapshot`, with an A4 trusted-mapping gate and fail-closed validation.

**Architecture:** Pure-logic core (entityRef derivation, registry lookup, A4 resolveChain gate, fail-closed arg validation, orchestrator with retry-once) is fully unit-tested against a `SuiChainPort` interface. A single thin SDK adapter (`@mysten/sui`) implements the port and is exercised only in the manual testnet e2e — this isolates the P126 transport risk (F1) and keeps all logic SDK-free.

**Tech Stack:** TypeScript (ESM, strict), vitest, `node:crypto` (sha256), `@mysten/sui` (latest — adapter + e2e only).

## Global Constraints

- ESM only (`"type": "module"`); all intra-package imports use `.js` extension. (matches snapshot-svc)
- vitest (`vitest run`); tests live in `test/`, named `*.test.ts`.
- tsconfig mirrors snapshot-svc: `strict`, `noUncheckedIndexedAccess`, `target/module ES2022`, `moduleResolution bundler`.
- Error pattern mirrors `SnapshotError`: a single `AnchorError` class carrying a `code: AnchorErrorCode` union. All rejections are typed codes — never bare `throw new Error`.
- `deriveEntityRef(entityId) = sha2_256(utf8(entityId))` → exactly 32 bytes. Single source of truth; bootstrap and verify both call it.
- Hash length `HASH_LEN = 32`; `MAX_REF_LEN = 64`; `U64_MAX = 2n**64n - 1n`.
- SDK: `@mysten/sui` (NOT `.js`), `Transaction` (NOT `TransactionBlock`). Pin latest in `package.json`, NOT `^1.0.0`.
- **Task 0 is a hard gate.** No execution-layer code (Task 7 adapter, e2e) until the P126 transport spike passes.
- NEVER run `git init` inside `services/anchor-svc/`. This is the EXISTING repo rooted at the project root; commit from root via `git -C <root>` or plain `git add` with repo-relative paths.

---

### Task 0: P126 SDK transport spike (HARD GATE)

**Files:**
- Create: `services/anchor-svc/package.json` (minimal, just `@mysten/sui` latest + tsx)
- Create: `anchor-notes.md` (project root) — record findings
- Create: `services/anchor-svc/scripts/spike-tx.ts` (throwaway probe)

**Interfaces:**
- Produces: confirmed resolved `@mysten/sui` version string + working execution transport, recorded in `anchor-notes.md`. Later tasks pin this version.

- [ ] **Step 1: Scaffold minimal package.json**

```json
{
  "name": "@subledger/anchor-svc",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "spike": "tsx scripts/spike-tx.ts"
  },
  "dependencies": {
    "@mysten/sui": "latest"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Install and capture the resolved version**

Run: `cd services/anchor-svc && npm install`
Then: `npm ls @mysten/sui`
Expected: a concrete version (e.g. `@mysten/sui@1.x.y`). Record it in `anchor-notes.md`.

- [ ] **Step 3: Write the spike probe** (`scripts/spike-tx.ts`)

A throwaway script that: builds `SuiClient` for testnet, loads the active keypair from `~/.sui/sui_config/sui.keystore` (or reads `SUI_PRIVATE_KEY` env), constructs a trivial `Transaction` (e.g. `tx.transferObjects` of a tiny split coin back to self, or a `moveCall` to `0x2::clock` read via devInspect), and calls `client.signAndExecuteTransaction`. Print the digest or the full error.

```ts
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
// NOTE: keypair loading is environment-specific. Simplest: export a base64
// secret to SUI_PRIVATE_KEY and use Ed25519Keypair.fromSecretKey.
const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!);
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [1]);
tx.transferObjects([coin], kp.toSuiAddress());
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } });
console.log('digest', res.digest, 'status', res.effects?.status);
```

- [ ] **Step 4: Run the spike against testnet**

Run: `cd services/anchor-svc && SUI_PRIVATE_KEY=<...> npm run spike`
Expected: a real digest with `status: { status: 'success' }`.
**If it fails with a Quorum Driver / JSON-RPC execution error (F1 confirmed):** switch the client to the gRPC transport per the resolved SDK's docs (query via context7 / sui-docs-query for the exact client constructor), re-run until a digest lands. Record the working client construction in `anchor-notes.md`.

- [ ] **Step 5: Record the verdict and commit**

In `anchor-notes.md`: resolved version, which transport works, exact `SuiClient`/transport construction snippet that lands a tx. Delete or keep `spike-tx.ts` (keep, it documents the path).

```bash
git add services/anchor-svc/package.json services/anchor-svc/package-lock.json services/anchor-svc/scripts/spike-tx.ts anchor-notes.md
git commit -m "chore(anchor-svc): P126 transport spike — confirm working testnet execution path"
```

**GATE:** Do not start Task 7 or the e2e (Task 9) until this digest landed and the construction is recorded.

---

### Task 1: Package scaffold + domain types

**Files:**
- Create: `services/anchor-svc/tsconfig.json`
- Create: `services/anchor-svc/src/domain/types.ts`
- Create: `services/anchor-svc/src/index.ts`
- Test: `services/anchor-svc/test/scaffold.test.ts`

**Interfaces:**
- Produces:
  - `class AnchorError extends Error { readonly code: AnchorErrorCode }`
  - `type AnchorErrorCode = 'ENTITY_NOT_REGISTERED' | 'ENTITY_REF_MISMATCH' | 'STALE_CAP' | 'BAD_HASH_LEN' | 'PERIOD_TOO_LONG' | 'SEQ_OUT_OF_RANGE' | 'LINK_MISMATCH_AFTER_RETRY'`
  - `class LinkMismatchError extends Error` (distinct; thrown by the port on on-chain `ELinkMismatch`, caught by orchestrator)
  - `interface ChainState { entityRef: Uint8Array; latestLink: Uint8Array; seq: bigint; capEpoch: bigint }`
  - `interface EntityRegistryEntry { chainObjectId: string; capObjectId: string }`
  - `type EntityRegistry = Record<string, EntityRegistryEntry>`
  - `interface AnchorCallArgs { manifestHash: Uint8Array; merkleRoot: Uint8Array; periodId: Uint8Array; supersedesSeq: bigint }`
  - `interface AnchorResult { digest: string; seq: bigint; link: Uint8Array }`
  - `interface SuiChainPort { getChainState(chainObjectId: string): Promise<ChainState>; getCapEpoch(capObjectId: string): Promise<bigint>; execAnchor(input: ExecAnchorInput): Promise<AnchorResult> }`
  - `interface ExecAnchorInput { packageId: string; chainObjectId: string; capObjectId: string; prevLink: Uint8Array; args: AnchorCallArgs }`
  - constants `HASH_LEN = 32`, `MAX_REF_LEN = 64`, `U64_MAX = 2n ** 64n - 1n`

- [ ] **Step 1: Write the failing test** (`test/scaffold.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { AnchorError, LinkMismatchError, HASH_LEN, MAX_REF_LEN, U64_MAX } from '../src/domain/types.js';

describe('anchor-svc scaffold', () => {
  it('AnchorError carries a typed code', () => {
    const e = new AnchorError('STALE_CAP');
    expect(e.code).toBe('STALE_CAP');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AnchorError');
  });
  it('LinkMismatchError is a distinct error type', () => {
    expect(new LinkMismatchError('x')).toBeInstanceOf(Error);
    expect(new LinkMismatchError('x')).not.toBeInstanceOf(AnchorError);
  });
  it('exposes Move-aligned constants', () => {
    expect(HASH_LEN).toBe(32);
    expect(MAX_REF_LEN).toBe(64);
    expect(U64_MAX).toBe(2n ** 64n - 1n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/scaffold.test.ts`
Expected: FAIL — cannot resolve `../src/domain/types.js`.

- [ ] **Step 3: Create tsconfig.json** (copy snapshot-svc's verbatim)

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
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Write `src/domain/types.ts`**

```ts
export const HASH_LEN = 32;
export const MAX_REF_LEN = 64;
export const U64_MAX = 2n ** 64n - 1n;

export type AnchorErrorCode =
  | 'ENTITY_NOT_REGISTERED'
  | 'ENTITY_REF_MISMATCH'
  | 'STALE_CAP'
  | 'BAD_HASH_LEN'
  | 'PERIOD_TOO_LONG'
  | 'SEQ_OUT_OF_RANGE'
  | 'LINK_MISMATCH_AFTER_RETRY';

export class AnchorError extends Error {
  constructor(public readonly code: AnchorErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AnchorError';
  }
}

/** Thrown by SuiChainPort.execAnchor when the chain rejects prev_link (on-chain ELinkMismatch). */
export class LinkMismatchError extends Error {
  constructor(message?: string) {
    super(message ?? 'on-chain prev_link mismatch');
    this.name = 'LinkMismatchError';
  }
}

export interface ChainState {
  entityRef: Uint8Array;
  latestLink: Uint8Array;
  seq: bigint;
  capEpoch: bigint;
}

export interface EntityRegistryEntry {
  chainObjectId: string;
  capObjectId: string;
}
export type EntityRegistry = Record<string, EntityRegistryEntry>;

export interface AnchorCallArgs {
  manifestHash: Uint8Array; // 32B
  merkleRoot: Uint8Array;   // 32B
  periodId: Uint8Array;     // <=64B
  supersedesSeq: bigint;    // 0 = no prior
}

export interface AnchorResult {
  digest: string;
  seq: bigint;
  link: Uint8Array;
}

export interface ExecAnchorInput {
  packageId: string;
  chainObjectId: string;
  capObjectId: string;
  prevLink: Uint8Array;
  args: AnchorCallArgs;
}

export interface SuiChainPort {
  getChainState(chainObjectId: string): Promise<ChainState>;
  getCapEpoch(capObjectId: string): Promise<bigint>;
  execAnchor(input: ExecAnchorInput): Promise<AnchorResult>;
}
```

- [ ] **Step 5: Write `src/index.ts`**

```ts
export * from './domain/types.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/scaffold.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add services/anchor-svc/tsconfig.json services/anchor-svc/src/domain/types.ts services/anchor-svc/src/index.ts services/anchor-svc/test/scaffold.test.ts
git commit -m "feat(anchor-svc): scaffold package + domain types/errors/port interface"
```

---

### Task 2: `deriveEntityRef`

**Files:**
- Create: `services/anchor-svc/src/core/entityRef.ts`
- Test: `services/anchor-svc/test/entityRef.test.ts`

**Interfaces:**
- Produces: `deriveEntityRef(entityId: string): Uint8Array` — `sha2_256(utf8(entityId))`, always 32 bytes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { deriveEntityRef } from '../src/core/entityRef.js';

describe('deriveEntityRef', () => {
  it('is sha2-256 of utf8(entityId), 32 bytes', () => {
    const id = 'acme-corp:entity-001';
    const expected = new Uint8Array(createHash('sha256').update(Buffer.from(id, 'utf8')).digest());
    const got = deriveEntityRef(id);
    expect(got).toEqual(expected);
    expect(got.length).toBe(32);
  });
  it('stays 32 bytes for very long / unicode ids', () => {
    expect(deriveEntityRef('長'.repeat(10000)).length).toBe(32);
    expect(deriveEntityRef('日本語-entity-🚀').length).toBe(32);
  });
  it('is deterministic and distinct per id', () => {
    expect(deriveEntityRef('a')).toEqual(deriveEntityRef('a'));
    expect(deriveEntityRef('a')).not.toEqual(deriveEntityRef('b'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/entityRef.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/core/entityRef.ts`**

```ts
import { createHash } from 'node:crypto';

/**
 * Canonical entity reference: sha2-256 over UTF-8 bytes of entityId.
 * SINGLE SOURCE OF TRUTH — bootstrap (create_chain) and resolveChain's
 * cross-verification MUST both call this. Always 32 bytes.
 */
export function deriveEntityRef(entityId: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(Buffer.from(entityId, 'utf8')).digest());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/entityRef.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/anchor-svc/src/core/entityRef.ts services/anchor-svc/test/entityRef.test.ts
git commit -m "feat(anchor-svc): deriveEntityRef = sha2_256(utf8(entityId))"
```

---

### Task 3: Registry lookup

**Files:**
- Create: `services/anchor-svc/src/core/registry.ts`
- Test: `services/anchor-svc/test/registry.test.ts`

**Interfaces:**
- Consumes: `EntityRegistry`, `EntityRegistryEntry`, `AnchorError` from `domain/types.js`.
- Produces: `lookupEntity(registry: EntityRegistry, entityId: string): EntityRegistryEntry` — throws `AnchorError('ENTITY_NOT_REGISTERED')` if absent.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { lookupEntity } from '../src/core/registry.js';
import { AnchorError } from '../src/domain/types.js';

const reg = { 'e1': { chainObjectId: '0xchain', capObjectId: '0xcap' } };

describe('lookupEntity', () => {
  it('returns the entry for a registered entity', () => {
    expect(lookupEntity(reg, 'e1')).toEqual({ chainObjectId: '0xchain', capObjectId: '0xcap' });
  });
  it('fails closed for an unregistered entity', () => {
    expect(() => lookupEntity(reg, 'nope')).toThrowError(AnchorError);
    try { lookupEntity(reg, 'nope'); } catch (e) { expect((e as AnchorError).code).toBe('ENTITY_NOT_REGISTERED'); }
  });
  it('does not treat inherited Object props as entries', () => {
    expect(() => lookupEntity(reg, 'toString')).toThrowError(AnchorError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/core/registry.ts`**

```ts
import { AnchorError, type EntityRegistry, type EntityRegistryEntry } from '../domain/types.js';

export function lookupEntity(registry: EntityRegistry, entityId: string): EntityRegistryEntry {
  if (!Object.prototype.hasOwnProperty.call(registry, entityId)) {
    throw new AnchorError('ENTITY_NOT_REGISTERED', `no registry entry for entityId=${entityId}`);
  }
  return registry[entityId]!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/anchor-svc/src/core/registry.ts services/anchor-svc/test/registry.test.ts
git commit -m "feat(anchor-svc): registry lookup with fail-closed miss + prototype guard"
```

---

### Task 4: `resolveChain` (A4 gate)

**Files:**
- Create: `services/anchor-svc/src/core/resolveChain.ts`
- Test: `services/anchor-svc/test/resolveChain.test.ts`

**Interfaces:**
- Consumes: `lookupEntity`, `deriveEntityRef`, `SuiChainPort`, `EntityRegistry`, `AnchorError` from prior tasks.
- Produces: `resolveChain(entityId: string, registry: EntityRegistry, port: SuiChainPort): Promise<ResolvedChain>` where `interface ResolvedChain { chainObjectId: string; capObjectId: string; latestLink: Uint8Array; seq: bigint }`. Throws `ENTITY_NOT_REGISTERED` / `ENTITY_REF_MISMATCH` / `STALE_CAP`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveChain } from '../src/core/resolveChain.js';
import { deriveEntityRef, AnchorError, type SuiChainPort, type ChainState } from '../src/domain/types.js';

function fakePort(state: Partial<ChainState>, capEpoch = 0n): SuiChainPort {
  return {
    getChainState: async () => ({ entityRef: deriveEntityRef('e1'), latestLink: new Uint8Array(32), seq: 0n, capEpoch: 0n, ...state }),
    getCapEpoch: async () => capEpoch,
    execAnchor: async () => { throw new Error('not used'); },
  };
}
const reg = { 'e1': { chainObjectId: '0xchain', capObjectId: '0xcap' } };

describe('resolveChain (A4 gate)', () => {
  it('passes when on-chain entity_ref matches derived ref and cap epoch matches', async () => {
    const r = await resolveChain('e1', reg, fakePort({ seq: 3n, capEpoch: 5n }, 5n));
    expect(r.chainObjectId).toBe('0xchain');
    expect(r.seq).toBe(3n);
  });
  it('fails closed when on-chain entity_ref does not match (registry tampered/wrong)', async () => {
    const bad = fakePort({ entityRef: deriveEntityRef('OTHER') });
    await expect(resolveChain('e1', reg, bad)).rejects.toMatchObject({ code: 'ENTITY_REF_MISMATCH' });
  });
  it('fails closed when cap epoch is stale (cap rotated, registry not updated)', async () => {
    const stale = fakePort({ capEpoch: 2n }, 1n); // chain at epoch 2, cap still epoch 1
    await expect(resolveChain('e1', reg, stale)).rejects.toMatchObject({ code: 'STALE_CAP' });
  });
  it('fails closed for unregistered entity before any chain read', async () => {
    await expect(resolveChain('nope', reg, fakePort({}))).rejects.toMatchObject({ code: 'ENTITY_NOT_REGISTERED' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/resolveChain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/core/resolveChain.ts`**

```ts
import { AnchorError, type EntityRegistry, type SuiChainPort } from '../domain/types.js';
import { lookupEntity } from './registry.js';
import { deriveEntityRef } from './entityRef.js';

export interface ResolvedChain {
  chainObjectId: string;
  capObjectId: string;
  latestLink: Uint8Array;
  seq: bigint;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function resolveChain(
  entityId: string,
  registry: EntityRegistry,
  port: SuiChainPort,
): Promise<ResolvedChain> {
  const entry = lookupEntity(registry, entityId); // ENTITY_NOT_REGISTERED
  const state = await port.getChainState(entry.chainObjectId);

  // A4: cross-verify on-chain entity_ref against the derived ref.
  if (!bytesEqual(state.entityRef, deriveEntityRef(entityId))) {
    throw new AnchorError('ENTITY_REF_MISMATCH',
      `chain ${entry.chainObjectId} entity_ref does not match derived ref for entityId=${entityId}`);
  }

  // F2: early cap-epoch check (fail-closed, saves gas vs on-chain EStaleCap abort).
  const capEpoch = await port.getCapEpoch(entry.capObjectId);
  if (capEpoch !== state.capEpoch) {
    throw new AnchorError('STALE_CAP',
      `cap ${entry.capObjectId} epoch=${capEpoch} != chain cap_epoch=${state.capEpoch}`);
  }

  return { chainObjectId: entry.chainObjectId, capObjectId: entry.capObjectId, latestLink: state.latestLink, seq: state.seq };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/resolveChain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/anchor-svc/src/core/resolveChain.ts services/anchor-svc/test/resolveChain.test.ts
git commit -m "feat(anchor-svc): resolveChain A4 gate (entity_ref cross-verify + cap_epoch early check)"
```

---

### Task 5: `buildAnchorArgs` (fail-closed validation)

**Files:**
- Create: `services/anchor-svc/src/core/buildAnchorArgs.ts`
- Test: `services/anchor-svc/test/buildAnchorArgs.test.ts`

**Interfaces:**
- Consumes: `AnchorPayload` shape `{ manifestHash: string; merkleRoot: string; periodId: string; supersedesSeq: number }` (from snapshot-svc; redeclared locally to avoid a hard dep — see note), `AnchorCallArgs`, constants, `AnchorError`.
- Produces: `buildAnchorArgs(payload: AnchorPayloadInput): AnchorCallArgs`. Validates and converts: hex→32B hashes, utf8 periodId ≤64B, supersedesSeq→bigint in [0, U64_MAX]. Throws `BAD_HASH_LEN` / `PERIOD_TOO_LONG` / `SEQ_OUT_OF_RANGE`.
- Also produces helper `hexToBytes(hex: string): Uint8Array` (strips optional `0x`, rejects odd length / non-hex by throwing `BAD_HASH_LEN` — used only for fixed-len hashes here).

> Note: `AnchorPayloadInput` is structurally `AnchorPayload` from snapshot-svc. We redeclare the interface locally (4 fields) rather than add a cross-package import, matching snapshot-svc's deps-chokepoint defer policy. Wiring the real import is a packaging-stage concern.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildAnchorArgs } from '../src/core/buildAnchorArgs.js';

const h32 = 'ab'.repeat(32); // 64 hex chars = 32 bytes
const base = { manifestHash: h32, merkleRoot: h32, periodId: '2026-Q2', supersedesSeq: 0 };

describe('buildAnchorArgs (fail-closed)', () => {
  it('converts a valid payload', () => {
    const a = buildAnchorArgs(base);
    expect(a.manifestHash.length).toBe(32);
    expect(a.merkleRoot.length).toBe(32);
    expect(a.periodId).toEqual(new Uint8Array(Buffer.from('2026-Q2', 'utf8')));
    expect(a.supersedesSeq).toBe(0n);
  });
  it('accepts 0x-prefixed hashes', () => {
    expect(buildAnchorArgs({ ...base, manifestHash: '0x' + h32 }).manifestHash.length).toBe(32);
  });
  it('rejects a non-32-byte hash', () => {
    expect(() => buildAnchorArgs({ ...base, merkleRoot: 'abcd' })).toThrowError(/BAD_HASH_LEN/);
  });
  it('rejects odd-length / non-hex hash', () => {
    expect(() => buildAnchorArgs({ ...base, manifestHash: 'abc' })).toThrowError(/BAD_HASH_LEN/);
    expect(() => buildAnchorArgs({ ...base, manifestHash: 'zz'.repeat(32) })).toThrowError(/BAD_HASH_LEN/);
  });
  it('accepts periodId at exactly 64 bytes but rejects 65', () => {
    expect(buildAnchorArgs({ ...base, periodId: 'p'.repeat(64) }).periodId.length).toBe(64);
    expect(() => buildAnchorArgs({ ...base, periodId: 'p'.repeat(65) })).toThrowError(/PERIOD_TOO_LONG/);
  });
  it('counts periodId length in UTF-8 bytes, not code points', () => {
    // '長' is 3 UTF-8 bytes; 22 of them = 66 bytes > 64.
    expect(() => buildAnchorArgs({ ...base, periodId: '長'.repeat(22) })).toThrowError(/PERIOD_TOO_LONG/);
  });
  it('rejects negative / non-integer / oversize seq', () => {
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: -1 })).toThrowError(/SEQ_OUT_OF_RANGE/);
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: 1.5 })).toThrowError(/SEQ_OUT_OF_RANGE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/buildAnchorArgs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/core/buildAnchorArgs.ts`**

```ts
import { AnchorError, HASH_LEN, MAX_REF_LEN, U64_MAX, type AnchorCallArgs } from '../domain/types.js';

export interface AnchorPayloadInput {
  manifestHash: string;  // hex, 32B
  merkleRoot: string;    // hex, 32B
  periodId: string;
  supersedesSeq: number; // >=0, 0 = no prior
}

/** Strict fixed-length hex → bytes. Rejects bad hex or wrong length as BAD_HASH_LEN. */
function hexToHash(hex: string, field: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (s.length !== HASH_LEN * 2 || !/^[0-9a-fA-F]+$/.test(s)) {
    throw new AnchorError('BAD_HASH_LEN', `${field} must be ${HASH_LEN}-byte hex, got "${hex}"`);
  }
  const out = new Uint8Array(HASH_LEN);
  for (let i = 0; i < HASH_LEN; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function buildAnchorArgs(payload: AnchorPayloadInput): AnchorCallArgs {
  const manifestHash = hexToHash(payload.manifestHash, 'manifestHash');
  const merkleRoot = hexToHash(payload.merkleRoot, 'merkleRoot');

  const periodId = new Uint8Array(Buffer.from(payload.periodId, 'utf8'));
  if (periodId.length > MAX_REF_LEN) {
    throw new AnchorError('PERIOD_TOO_LONG', `period_id is ${periodId.length} bytes (max ${MAX_REF_LEN})`);
  }

  if (!Number.isInteger(payload.supersedesSeq) || payload.supersedesSeq < 0) {
    throw new AnchorError('SEQ_OUT_OF_RANGE', `supersedesSeq must be a non-negative integer, got ${payload.supersedesSeq}`);
  }
  const supersedesSeq = BigInt(payload.supersedesSeq);
  if (supersedesSeq > U64_MAX) {
    throw new AnchorError('SEQ_OUT_OF_RANGE', `supersedesSeq exceeds u64 max`);
  }

  return { manifestHash, merkleRoot, periodId, supersedesSeq };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/buildAnchorArgs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/anchor-svc/src/core/buildAnchorArgs.ts services/anchor-svc/test/buildAnchorArgs.test.ts
git commit -m "feat(anchor-svc): buildAnchorArgs fail-closed validation (hash/period/seq)"
```

---

### Task 6: `anchorSnapshot` orchestrator + retry-once

**Files:**
- Create: `services/anchor-svc/src/anchorSnapshot.ts`
- Modify: `services/anchor-svc/src/index.ts` (add export)
- Test: `services/anchor-svc/test/anchorSnapshot.test.ts`

**Interfaces:**
- Consumes: `resolveChain`, `buildAnchorArgs`/`AnchorPayloadInput`, `SuiChainPort`, `LinkMismatchError`, `AnchorError`, `AnchorResult`, `EntityRegistry`.
- Produces: `anchorSnapshot(entityId: string, payload: AnchorPayloadInput, deps: AnchorDeps): Promise<AnchorResult>` where `interface AnchorDeps { port: SuiChainPort; registry: EntityRegistry; packageId: string }`. On `LinkMismatchError`: re-read latest_link via `resolveChain` and retry `execAnchor` exactly once; second `LinkMismatchError` → throw `AnchorError('LINK_MISMATCH_AFTER_RETRY')`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { anchorSnapshot } from '../src/anchorSnapshot.js';
import { deriveEntityRef, LinkMismatchError, type SuiChainPort, type ChainState, type AnchorResult, type ExecAnchorInput } from '../src/domain/types.js';

const h32 = 'ab'.repeat(32);
const payload = { manifestHash: h32, merkleRoot: h32, periodId: '2026-Q2', supersedesSeq: 0 };
const reg = { 'e1': { chainObjectId: '0xchain', capObjectId: '0xcap' } };

function makePort(opts: { link?: Uint8Array; execImpl?: (i: ExecAnchorInput) => Promise<AnchorResult> } = {}): { port: SuiChainPort; calls: ExecAnchorInput[]; setLink: (l: Uint8Array) => void } {
  let link = opts.link ?? new Uint8Array(32).fill(1);
  const calls: ExecAnchorInput[] = [];
  const state = (): ChainState => ({ entityRef: deriveEntityRef('e1'), latestLink: link, seq: 0n, capEpoch: 0n });
  const port: SuiChainPort = {
    getChainState: async () => state(),
    getCapEpoch: async () => 0n,
    execAnchor: async (i) => {
      calls.push(i);
      if (opts.execImpl) return opts.execImpl(i);
      return { digest: 'D', seq: 1n, link: new Uint8Array(32).fill(9) };
    },
  };
  return { port, calls, setLink: (l) => { link = l; } };
}

describe('anchorSnapshot', () => {
  it('resolves, passes current latest_link as prev_link, returns result', async () => {
    const { port, calls } = makePort({ link: new Uint8Array(32).fill(7) });
    const r = await anchorSnapshot('e1', payload, { port, registry: reg, packageId: '0xpkg' });
    expect(r.seq).toBe(1n);
    expect(calls).toHaveLength(1);
    expect(calls[0].prevLink).toEqual(new Uint8Array(32).fill(7));
    expect(calls[0].packageId).toBe('0xpkg');
  });

  it('on ELinkMismatch re-reads latest_link and retries once with the fresh link', async () => {
    const h = makePort();
    h.setLink(new Uint8Array(32).fill(1));
    let first = true;
    h.port.execAnchor = async (i) => {
      h.calls.push(i);
      if (first) { first = false; h.setLink(new Uint8Array(32).fill(2)); throw new LinkMismatchError(); }
      return { digest: 'D2', seq: 2n, link: new Uint8Array(32).fill(9) };
    };
    const r = await anchorSnapshot('e1', payload, { port: h.port, registry: reg, packageId: '0xpkg' });
    expect(r.digest).toBe('D2');
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].prevLink).toEqual(new Uint8Array(32).fill(1)); // stale
    expect(h.calls[1].prevLink).toEqual(new Uint8Array(32).fill(2)); // refreshed
  });

  it('throws LINK_MISMATCH_AFTER_RETRY when mismatch persists', async () => {
    const h = makePort();
    h.port.execAnchor = async (i) => { h.calls.push(i); throw new LinkMismatchError(); };
    await expect(anchorSnapshot('e1', payload, { port: h.port, registry: reg, packageId: '0xpkg' }))
      .rejects.toMatchObject({ code: 'LINK_MISMATCH_AFTER_RETRY' });
    expect(h.calls).toHaveLength(2); // exactly one retry
  });

  it('does not retry on a validation error (fails closed before exec)', async () => {
    const h = makePort();
    await expect(anchorSnapshot('e1', { ...payload, periodId: 'p'.repeat(65) }, { port: h.port, registry: reg, packageId: '0xpkg' }))
      .rejects.toMatchObject({ code: 'PERIOD_TOO_LONG' });
    expect(h.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/anchorSnapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/anchorSnapshot.ts`**

```ts
import { AnchorError, LinkMismatchError, type AnchorResult, type EntityRegistry, type SuiChainPort } from './domain/types.js';
import { resolveChain } from './core/resolveChain.js';
import { buildAnchorArgs, type AnchorPayloadInput } from './core/buildAnchorArgs.js';

export interface AnchorDeps {
  port: SuiChainPort;
  registry: EntityRegistry;
  packageId: string;
}

export async function anchorSnapshot(
  entityId: string,
  payload: AnchorPayloadInput,
  deps: AnchorDeps,
): Promise<AnchorResult> {
  const { port, registry, packageId } = deps;

  // Validate args up front (fail-closed, no on-chain round trip on bad input).
  const args = buildAnchorArgs(payload);

  // Resolve + A4 gate; latestLink becomes prev_link.
  const resolved = await resolveChain(entityId, registry, port);

  const exec = (prevLink: Uint8Array) => port.execAnchor({
    packageId,
    chainObjectId: resolved.chainObjectId,
    capObjectId: resolved.capObjectId,
    prevLink,
    args,
  });

  try {
    return await exec(resolved.latestLink);
  } catch (e) {
    if (!(e instanceof LinkMismatchError)) throw e;
    // Concurrent writer / stale read: re-read head and retry exactly once.
    const fresh = await resolveChain(entityId, registry, port);
    try {
      return await exec(fresh.latestLink);
    } catch (e2) {
      if (e2 instanceof LinkMismatchError) {
        throw new AnchorError('LINK_MISMATCH_AFTER_RETRY',
          `prev_link still mismatched after one retry for entityId=${entityId}`);
      }
      throw e2;
    }
  }
}
```

- [ ] **Step 4: Add export to `src/index.ts`**

```ts
export * from './domain/types.js';
export { deriveEntityRef } from './core/entityRef.js';
export { lookupEntity } from './core/registry.js';
export { resolveChain, type ResolvedChain } from './core/resolveChain.js';
export { buildAnchorArgs, type AnchorPayloadInput } from './core/buildAnchorArgs.js';
export { anchorSnapshot, type AnchorDeps } from './anchorSnapshot.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/anchorSnapshot.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add services/anchor-svc/src/anchorSnapshot.ts services/anchor-svc/src/index.ts services/anchor-svc/test/anchorSnapshot.test.ts
git commit -m "feat(anchor-svc): anchorSnapshot orchestrator with retry-once on ELinkMismatch"
```

---

### Task 7: SDK adapter (`SuiChainAdapter`) — GATE: Task 0 must have passed

**Files:**
- Create: `services/anchor-svc/src/adapter/suiChainAdapter.ts`
- Test: `services/anchor-svc/test/adapter.typecheck.test.ts` (shape/typecheck only — no network in CI)

**Interfaces:**
- Consumes: `SuiChainPort`, `ChainState`, `ExecAnchorInput`, `AnchorResult`, `LinkMismatchError`.
- Produces: `class SuiChainAdapter implements SuiChainPort` constructed from `{ client: SuiClient; signer: Signer }` (types from `@mysten/sui`). Uses the transport construction confirmed in Task 0. `getChainState`/`getCapEpoch` parse object fields; `execAnchor` builds the `Transaction` moveCall, signs, executes (`showEvents: true`), parses `SnapshotAnchored`, and maps an on-chain `ELinkMismatch` abort to `LinkMismatchError`.

- [ ] **Step 1: Write the adapter** (`src/adapter/suiChainAdapter.ts`)

```ts
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import type { SuiClient } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import {
  LinkMismatchError,
  type AnchorResult, type ChainState, type ExecAnchorInput, type SuiChainPort,
} from '../domain/types.js';

const MODULE = 'audit_anchor';

export class SuiChainAdapter implements SuiChainPort {
  constructor(private readonly client: SuiClient, private readonly signer: Signer) {}

  async getChainState(chainObjectId: string): Promise<ChainState> {
    const res = await this.client.getObject({ id: chainObjectId, options: { showContent: true } });
    const c = res.data?.content;
    if (!c || c.dataType !== 'moveObject') throw new Error(`chain object ${chainObjectId} not found`);
    const f = (c.fields as Record<string, unknown>);
    return {
      entityRef: Uint8Array.from(f.entity_ref as number[]),
      latestLink: Uint8Array.from(f.latest_link as number[]),
      seq: BigInt(f.seq as string),
      capEpoch: BigInt(f.cap_epoch as string),
    };
  }

  async getCapEpoch(capObjectId: string): Promise<bigint> {
    const res = await this.client.getObject({ id: capObjectId, options: { showContent: true } });
    const c = res.data?.content;
    if (!c || c.dataType !== 'moveObject') throw new Error(`cap object ${capObjectId} not found`);
    return BigInt((c.fields as Record<string, unknown>).epoch as string);
  }

  async execAnchor(input: ExecAnchorInput): Promise<AnchorResult> {
    const { packageId, chainObjectId, capObjectId, prevLink, args } = input;
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::${MODULE}::anchor_snapshot`,
      arguments: [
        tx.object(chainObjectId),
        tx.object(capObjectId),
        tx.pure(bcs.vector(bcs.u8()).serialize(args.manifestHash)),
        tx.pure(bcs.vector(bcs.u8()).serialize(args.merkleRoot)),
        tx.pure(bcs.vector(bcs.u8()).serialize(args.periodId)),
        tx.pure(bcs.vector(bcs.u8()).serialize(prevLink)),
        tx.pure(bcs.u64().serialize(args.supersedesSeq)),
      ],
    });

    let res;
    try {
      res = await this.client.signAndExecuteTransaction({
        signer: this.signer, transaction: tx,
        options: { showEvents: true, showEffects: true },
      });
    } catch (e) {
      if (String((e as Error).message).includes('ELinkMismatch') || isLinkMismatchAbort(e)) {
        throw new LinkMismatchError(String((e as Error).message));
      }
      throw e;
    }

    if (res.effects?.status?.status !== 'success') {
      const err = res.effects?.status?.error ?? 'unknown';
      if (err.includes('ELinkMismatch') || isLinkMismatchAbort(err)) throw new LinkMismatchError(err);
      throw new Error(`anchor tx failed: ${err}`);
    }

    const ev = res.events?.find((e) => e.type.endsWith(`::${MODULE}::SnapshotAnchored`));
    if (!ev) throw new Error('SnapshotAnchored event missing');
    const pj = ev.parsedJson as Record<string, unknown>;
    return {
      digest: res.digest,
      seq: BigInt(pj.seq as string),
      link: Uint8Array.from(pj.link as number[]),
    };
  }
}

// ELinkMismatch is abort code in audit_anchor; match its MoveAbort string form
// (e.g. "MoveAbort(...audit_anchor..., <code>)"). Confirm the exact abort-code
// number/string from the failing-tx output during the e2e and tighten this.
function isLinkMismatchAbort(e: unknown): boolean {
  const s = typeof e === 'string' ? e : String((e as Error)?.message ?? '');
  return /MoveAbort/.test(s) && /audit_anchor/.test(s);
}
```

- [ ] **Step 2: Write the typecheck test** (`test/adapter.typecheck.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';

describe('SuiChainAdapter', () => {
  it('is constructible and satisfies the SuiChainPort shape', () => {
    expect(typeof SuiChainAdapter).toBe('function');
    // structural check only; real behavior is covered by the testnet e2e (Task 9).
    expect(SuiChainAdapter.prototype.execAnchor).toBeTypeOf('function');
    expect(SuiChainAdapter.prototype.getChainState).toBeTypeOf('function');
  });
});
```

- [ ] **Step 3: Run typecheck + test**

Run: `cd services/anchor-svc && npx tsc --noEmit && npx vitest run test/adapter.typecheck.test.ts`
Expected: PASS. (If `tx.pure`/`bcs` signatures differ in the Task-0 resolved SDK version, adjust to that version's API — confirm via context7/sui-docs-query; do NOT guess.)

- [ ] **Step 4: Commit**

```bash
git add services/anchor-svc/src/adapter/suiChainAdapter.ts services/anchor-svc/test/adapter.typecheck.test.ts
git commit -m "feat(anchor-svc): SuiChainAdapter implementing SuiChainPort (Task 0 transport)"
```

---

### Task 8: Monkey tests

**Files:**
- Create: `services/anchor-svc/test/monkey.test.ts`

**Interfaces:**
- Consumes: all public functions (`deriveEntityRef`, `resolveChain`, `buildAnchorArgs`, `anchorSnapshot`) + fake port.

- [ ] **Step 1: Write the monkey test**

```ts
import { describe, it, expect } from 'vitest';
import { deriveEntityRef, buildAnchorArgs, resolveChain, AnchorError, type SuiChainPort } from '../src/index.js';

const h32 = 'cd'.repeat(32);
const base = { manifestHash: h32, merkleRoot: h32, periodId: '2026-Q2', supersedesSeq: 0 };

describe('anchor-svc monkey', () => {
  it('huge unicode entityId still derives a 32-byte ref', () => {
    expect(deriveEntityRef('🚀'.repeat(50000)).length).toBe(32);
  });
  it('period exactly at 64 utf8 bytes passes, one byte over fails', () => {
    expect(buildAnchorArgs({ ...base, periodId: 'x'.repeat(64) }).periodId.length).toBe(64);
    expect(() => buildAnchorArgs({ ...base, periodId: 'x'.repeat(65) })).toThrowError(/PERIOD_TOO_LONG/);
  });
  it('supersedesSeq = U64_MAX value (as Number boundary) — non-integer huge rejected', () => {
    // Number.MAX_SAFE_INTEGER is integer & < u64 max → accepted.
    expect(buildAnchorArgs({ ...base, supersedesSeq: Number.MAX_SAFE_INTEGER }).supersedesSeq)
      .toBe(BigInt(Number.MAX_SAFE_INTEGER));
    // Infinity / NaN rejected.
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: Number.POSITIVE_INFINITY })).toThrowError(/SEQ_OUT_OF_RANGE/);
    expect(() => buildAnchorArgs({ ...base, supersedesSeq: Number.NaN })).toThrowError(/SEQ_OUT_OF_RANGE/);
  });
  it('tampered on-chain entity_ref is rejected even if registry id is right', async () => {
    const reg = { 'e1': { chainObjectId: '0xc', capObjectId: '0xk' } };
    const port: SuiChainPort = {
      getChainState: async () => ({ entityRef: deriveEntityRef('ATTACKER'), latestLink: new Uint8Array(32), seq: 0n, capEpoch: 0n }),
      getCapEpoch: async () => 0n,
      execAnchor: async () => { throw new Error('should not reach'); },
    };
    await expect(resolveChain('e1', reg, port)).rejects.toMatchObject({ code: 'ENTITY_REF_MISMATCH' });
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `cd services/anchor-svc && npx vitest run && npx tsc --noEmit`
Expected: all green, typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add services/anchor-svc/test/monkey.test.ts
git commit -m "test(anchor-svc): monkey — unicode ids, period byte-boundary, seq edges, entity_ref tamper"
```

---

### Task 9: Bootstrap script + testnet e2e runbook (GATE: Task 0 passed)

**Files:**
- Create: `services/anchor-svc/scripts/bootstrap.ts`
- Modify: `move/audit_anchor/Move.toml` (set `published-at` after publish)
- Modify: `anchor-notes.md` (record packageId, UpgradeCap id, per-entity chain/cap ids, e2e results)
- Create: `services/anchor-svc/scripts/e2e.ts` (manual end-to-end)

**Interfaces:**
- Consumes: `SuiChainAdapter`, `anchorSnapshot`, `deriveEntityRef`, the Task-0 transport construction.

- [ ] **Step 1: Publish the package to testnet**

Run: `sui client publish --gas-budget 200000000 move/audit_anchor`
Record: `packageId`, the `UpgradeCap` object id. Set `move/audit_anchor/Move.toml` `[package] published-at = "<packageId>"` and note the `0x0 → packageId` mapping in `anchor-notes.md`.

- [ ] **Step 2: Write `scripts/bootstrap.ts`** (create one chain per entity)

```ts
// Usage: SUI_PRIVATE_KEY=... PACKAGE_ID=0x... ENTITY_ID=acme:001 tsx scripts/bootstrap.ts
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
// client/signer construction: use the exact form confirmed working in Task 0 (anchor-notes.md).
import { /* SuiClient + transport */ } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { deriveEntityRef } from '../src/core/entityRef.js';

// const client = <Task-0 construction>;
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!);
const pkg = process.env.PACKAGE_ID!;
const entityId = process.env.ENTITY_ID!;
const ref = deriveEntityRef(entityId);

const tx = new Transaction();
tx.moveCall({
  target: `${pkg}::audit_anchor::create_chain`,
  arguments: [tx.pure(bcs.vector(bcs.u8()).serialize(ref))],
});
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showObjectChanges: true } });
// Print created EntityAnchorChain (shared) id and AnchorCap (owned) id from objectChanges.
console.log(JSON.stringify(res.objectChanges, null, 2));
```

Run it, then write the resulting `chainObjectId` / `capObjectId` into a registry JSON and into `anchor-notes.md`.

- [ ] **Step 2b: Verify no nested git repo got created**

Run: `find services/anchor-svc -name .git`
Expected: no output. (If a subagent created one, delete the nested `.git` and re-commit from repo root.)

- [ ] **Step 3: Write `scripts/e2e.ts`** (real anchor + restatement)

```ts
// Usage: SUI_PRIVATE_KEY=... PACKAGE_ID=... CHAIN_ID=... CAP_ID=... ENTITY_ID=acme:001 tsx scripts/e2e.ts
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';
import { anchorSnapshot } from '../src/anchorSnapshot.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
// const client = <Task-0 construction>;
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!);
const adapter = new SuiChainAdapter(client, kp);
const registry = { [process.env.ENTITY_ID!]: { chainObjectId: process.env.CHAIN_ID!, capObjectId: process.env.CAP_ID! } };
const deps = { port: adapter, registry, packageId: process.env.PACKAGE_ID! };
const h32 = (b: number) => Array(32).fill(b).map((x) => x.toString(16).padStart(2, '0')).join('');

// First anchor → expect seq=1, link != genesis.
const r1 = await anchorSnapshot(process.env.ENTITY_ID!, { manifestHash: h32(1), merkleRoot: h32(2), periodId: '2026-Q2', supersedesSeq: 0 }, deps);
console.log('anchor#1', r1.digest, 'seq', r1.seq);
if (r1.seq !== 1n) throw new Error(`expected seq 1, got ${r1.seq}`);

// Restatement of same period → expect seq=2, supersedes_seq=1 emitted.
const r2 = await anchorSnapshot(process.env.ENTITY_ID!, { manifestHash: h32(3), merkleRoot: h32(4), periodId: '2026-Q2', supersedesSeq: 1 }, deps);
console.log('anchor#2 (restate)', r2.digest, 'seq', r2.seq);
if (r2.seq !== 2n) throw new Error(`expected seq 2, got ${r2.seq}`);
console.log('E2E OK');
```

- [ ] **Step 4: Run the e2e against testnet**

Run: `cd services/anchor-svc && SUI_PRIVATE_KEY=... PACKAGE_ID=... CHAIN_ID=... CAP_ID=... ENTITY_ID=acme:001 tsx scripts/e2e.ts`
Expected: prints `anchor#1 ... seq 1`, `anchor#2 (restate) ... seq 2`, `E2E OK`. If `execAnchor`'s `ELinkMismatch` string-match needs tightening, capture the real abort string here and update `isLinkMismatchAbort` in `suiChainAdapter.ts`.

- [ ] **Step 5: Record results and commit**

In `anchor-notes.md`: packageId, UpgradeCap id, per-entity chain/cap ids, both digests, confirmed abort string. Add a `move-notes.md` line noting the package is now published on testnet.

```bash
git add move/audit_anchor/Move.toml services/anchor-svc/scripts/bootstrap.ts services/anchor-svc/scripts/e2e.ts anchor-notes.md move-notes.md
git commit -m "feat(anchor-svc): bootstrap + testnet e2e — publish, create_chain, real anchor + restatement"
```

---

## Self-Review

**Spec coverage:**
- §2.1 EntityRegistry → Task 1 (types) + Task 3 (lookup). ✅
- §2.2 resolveChain A4 gate + cap_epoch (F2) → Task 4. ✅
- §2.3 deriveEntityRef → Task 2. ✅
- §2.4 buildAnchorTx asserts → Task 5 (as `buildAnchorArgs`; renamed since it returns validated args, not a `Transaction` — the actual moveCall lives in the adapter, Task 7). ✅
- §2.5 anchorSnapshot + retry-once → Task 6. ✅
- §2.6 bootstrap + UpgradeCap (F3) → Task 9. ✅
- §2.7 / §7 P126 transport gate (F1) → Task 0. ✅
- §4 error table (all 6 codes + StaleCap) → covered across Tasks 1/4/5/6. ✅
- §5.1 unit/integration (fake client) → Tasks 4/5/6. ✅
- §5.2 monkey → Task 8. ✅
- §5.3 testnet e2e → Task 9. ✅
- SDK adapter (isolates F1) → Task 7. ✅

**Placeholder scan:** No TBD/TODO. The two intentional "confirm against Task-0 SDK version" notes (adapter `tx.pure`/`bcs` API, abort-string tightening) are genuine version-dependent unknowns, gated behind Task 0 + e2e, not lazy placeholders.

**Type consistency:** `SuiChainPort` (getChainState/getCapEpoch/execAnchor), `AnchorCallArgs`, `ChainState`, `ExecAnchorInput`, `AnchorResult`, `EntityRegistry` defined in Task 1 and used unchanged in Tasks 4/6/7. `buildAnchorArgs` name consistent Tasks 5/6/8. `deriveEntityRef` consistent Tasks 2/4/8/9. Error codes match the spec §4 table.

**Design deviation flagged:** spec §2.4 named `buildAnchorTx` returning a `Transaction`; the plan splits this into pure `buildAnchorArgs` (validated bytes, unit-tested) + the SDK `moveCall` inside `SuiChainAdapter.execAnchor` (Task 7). This keeps validation SDK-free and concentrates the P126 transport risk in one adapter. Functionally equivalent, better isolation.
