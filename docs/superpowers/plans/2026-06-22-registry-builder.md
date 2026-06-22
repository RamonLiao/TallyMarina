# Registry Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual `EntityRegistry` fill with a pure function that auto-resolves known `entityId`s to their on-chain chain/cap object ids via owned-AnchorCap discovery.

**Architecture:** A pure `buildRegistry(entityIds, owner, originalPackageId, port)` enumerates the owner's AnchorCaps, reads each cap's chain `entity_ref`, and matches `sha256(entityId)` against it. Discovery rides JSON-RPC `getOwnedObjects` only — zero indexer, zero Move upgrade. A new `RegistryPort` interface keeps the builder unit-testable; `SuiChainAdapter` gains a `listOwnedAnchorCaps` method.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, `@mysten/sui` 2.19 (`CoreClient`), Node `crypto`.

## Global Constraints

- TypeScript strict; all imports use `.js` extension (NodeNext resolution) — match existing `services/anchor-svc/src`.
- `@mysten/sui` pinned at 2.19.0; adapter is the ONLY SDK seam. Verify exact owned-objects method name against installed SDK source before use — do NOT trust possibly-stale docs.
- Fail-closed: any unexpected on-chain shape or missing field throws; never silently skip a cap. Network/pagination errors propagate unchanged.
- Type filter for AnchorCap MUST use the **original** (first-published) package id, NOT the latest upgraded id. This is a distinct config field from the per-call `packageId` used by `anchorSnapshot`'s moveCall target.
- Errors use the existing `AnchorError` class with codes added to `AnchorErrorCode`.
- All on-chain byte fields compared as lowercase hex strings.
- Run all commands from `services/anchor-svc/`. NEVER run `git init`; commit from the existing repo root with `git -C <repo-root>` (repo root = the directory containing `move/`, `services/`, `docs/`).

---

### Task 1: Domain types — RegistryPort, OwnedCap, error codes

**Files:**
- Modify: `services/anchor-svc/src/domain/types.ts`
- Test: none (type-only change; covered by Task 2 compilation + tests)

**Interfaces:**
- Consumes: existing `AnchorErrorCode`, `ChainState`, `SuiChainPort` in this file.
- Produces:
  - `OwnedCap { capObjectId: string; chainId: string }`
  - `RegistryPort { listOwnedAnchorCaps(owner: string, originalPackageId: string): Promise<OwnedCap[]>; getChainState(chainObjectId: string): Promise<ChainState> }`
  - Two new `AnchorErrorCode` members: `'ENTITY_CHAIN_NOT_FOUND'`, `'AMBIGUOUS_ENTITY_CHAIN'`.

- [ ] **Step 1: Add the two error codes to the `AnchorErrorCode` union**

In `services/anchor-svc/src/domain/types.ts`, extend the existing union:

```ts
export type AnchorErrorCode =
  | 'ENTITY_NOT_REGISTERED'
  | 'ENTITY_REF_MISMATCH'
  | 'STALE_CAP'
  | 'BAD_HASH_LEN'
  | 'PERIOD_TOO_LONG'
  | 'SEQ_OUT_OF_RANGE'
  | 'LINK_MISMATCH_AFTER_RETRY'
  | 'ENTITY_CHAIN_NOT_FOUND'
  | 'AMBIGUOUS_ENTITY_CHAIN';
```

- [ ] **Step 2: Add `OwnedCap` and `RegistryPort` at the end of the file**

Append to `services/anchor-svc/src/domain/types.ts`:

```ts
/** One discovered AnchorCap owned by the signer, with the chain it writes to. */
export interface OwnedCap {
  capObjectId: string;
  chainId: string;
}

/**
 * Discovery port for buildRegistry. Separate from SuiChainPort so the builder
 * is unit-testable with a fake and the write path is not widened.
 * `originalPackageId` is the FIRST-published package id — Sui struct types keep
 * the identity of their defining package across upgrades, so the AnchorCap
 * StructType filter must use the original id, not the latest upgraded id.
 */
export interface RegistryPort {
  listOwnedAnchorCaps(owner: string, originalPackageId: string): Promise<OwnedCap[]>;
  getChainState(chainObjectId: string): Promise<ChainState>;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd services/anchor-svc && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C <repo-root> add services/anchor-svc/src/domain/types.ts
git -C <repo-root> commit -m "feat(anchor-svc): add RegistryPort, OwnedCap, registry error codes"
```

---

### Task 2: Pure buildRegistry function

**Files:**
- Create: `services/anchor-svc/src/core/buildRegistry.ts`
- Test: `services/anchor-svc/test/buildRegistry.test.ts`

**Interfaces:**
- Consumes: `RegistryPort`, `OwnedCap`, `AnchorError`, `EntityRegistry`, `ChainState` from `domain/types.js`; `deriveEntityRef` from `core/entityRef.js`.
- Produces: `buildRegistry(entityIds: string[], owner: string, originalPackageId: string, port: RegistryPort): Promise<EntityRegistry>`.

- [ ] **Step 1: Write the failing test**

Create `services/anchor-svc/test/buildRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../src/core/buildRegistry.js';
import { deriveEntityRef } from '../src/core/entityRef.js';
import { AnchorError, type ChainState, type OwnedCap, type RegistryPort } from '../src/domain/types.js';

const OWNER = '0xowner';
const ORIG_PKG = '0xpkg';

function chainState(entityId: string): ChainState {
  return {
    entityRef: deriveEntityRef(entityId),
    latestLink: new Uint8Array(32),
    seq: 0n,
    capEpoch: 0n,
  };
}

/** Fake port: caps list + a chainId→entityId map for entity_ref synthesis. */
function fakePort(caps: OwnedCap[], chainEntity: Record<string, string>): RegistryPort {
  return {
    async listOwnedAnchorCaps() {
      return caps;
    },
    async getChainState(chainObjectId: string): Promise<ChainState> {
      const entityId = chainEntity[chainObjectId];
      if (entityId === undefined) throw new Error(`fake: no chain ${chainObjectId}`);
      return chainState(entityId);
    },
  };
}

describe('buildRegistry', () => {
  it('resolves all entityIds to their chain/cap ids', async () => {
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapA', chainId: '0xchainA' },
      { capObjectId: '0xcapB', chainId: '0xchainB' },
    ];
    const port = fakePort(caps, { '0xchainA': 'entA', '0xchainB': 'entB' });
    const reg = await buildRegistry(['entA', 'entB'], OWNER, ORIG_PKG, port);
    expect(reg).toEqual({
      entA: { chainObjectId: '0xchainA', capObjectId: '0xcapA' },
      entB: { chainObjectId: '0xchainB', capObjectId: '0xcapB' },
    });
  });

  it('matches by entity_ref hash, not by list position', async () => {
    // caps order is REVERSED vs entityIds; only hash matching can resolve correctly.
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapB', chainId: '0xchainB' },
      { capObjectId: '0xcapA', chainId: '0xchainA' },
    ];
    const port = fakePort(caps, { '0xchainA': 'entA', '0xchainB': 'entB' });
    const reg = await buildRegistry(['entA', 'entB'], OWNER, ORIG_PKG, port);
    expect(reg.entA).toEqual({ chainObjectId: '0xchainA', capObjectId: '0xcapA' });
    expect(reg.entB).toEqual({ chainObjectId: '0xchainB', capObjectId: '0xcapB' });
  });

  it('empty entityIds yields empty registry', async () => {
    const port = fakePort([{ capObjectId: '0xcapA', chainId: '0xchainA' }], { '0xchainA': 'entA' });
    const reg = await buildRegistry([], OWNER, ORIG_PKG, port);
    expect(reg).toEqual({});
  });

  it('throws ENTITY_CHAIN_NOT_FOUND when no owned cap matches (rotated away or unbootstrapped)', async () => {
    const port = fakePort([{ capObjectId: '0xcapA', chainId: '0xchainA' }], { '0xchainA': 'entA' });
    await expect(buildRegistry(['entMissing'], OWNER, ORIG_PKG, port)).rejects.toMatchObject({
      code: 'ENTITY_CHAIN_NOT_FOUND',
    });
    await expect(buildRegistry(['entMissing'], OWNER, ORIG_PKG, port)).rejects.toThrow(/rotated away|not bootstrapped/i);
  });

  it('throws AMBIGUOUS_ENTITY_CHAIN when two chains share an entity_ref', async () => {
    const caps: OwnedCap[] = [
      { capObjectId: '0xcap1', chainId: '0xchain1' },
      { capObjectId: '0xcap2', chainId: '0xchain2' },
    ];
    // both chains report the SAME entityId → same entity_ref
    const port = fakePort(caps, { '0xchain1': 'dup', '0xchain2': 'dup' });
    await expect(buildRegistry(['dup'], OWNER, ORIG_PKG, port)).rejects.toMatchObject({
      code: 'AMBIGUOUS_ENTITY_CHAIN',
    });
  });

  it('propagates a port error mid-scan (never swallowed)', async () => {
    const port: RegistryPort = {
      async listOwnedAnchorCaps() {
        return [{ capObjectId: '0xcapA', chainId: '0xchainBOOM' }];
      },
      async getChainState() {
        throw new Error('network down');
      },
    };
    await expect(buildRegistry(['entA'], OWNER, ORIG_PKG, port)).rejects.toThrow('network down');
  });

  it('duplicate cap entries pointing at the SAME chain trigger AMBIGUOUS_ENTITY_CHAIN', async () => {
    // Two caps, same chainId → same entity_ref seen twice → ambiguous (fail-closed).
    const caps: OwnedCap[] = [
      { capObjectId: '0xcapX', chainId: '0xchainA' },
      { capObjectId: '0xcapY', chainId: '0xchainA' },
    ];
    const port = fakePort(caps, { '0xchainA': 'entA' });
    await expect(buildRegistry(['entA'], OWNER, ORIG_PKG, port)).rejects.toMatchObject({
      code: 'AMBIGUOUS_ENTITY_CHAIN',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/anchor-svc && npx vitest run test/buildRegistry.test.ts`
Expected: FAIL — cannot find module `../src/core/buildRegistry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `services/anchor-svc/src/core/buildRegistry.ts`:

```ts
import { AnchorError, type EntityRegistry, type RegistryPort } from '../domain/types.js';
import { deriveEntityRef } from './entityRef.js';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Resolve each known entityId to its on-chain { chainObjectId, capObjectId } by
 * discovering the owner's AnchorCaps and matching sha256(entityId) against each
 * chain's entity_ref.
 *
 * Fail-closed:
 *  - entityId with no owned cap → ENTITY_CHAIN_NOT_FOUND (chain not bootstrapped,
 *    or cap rotated away from owner — these are indistinguishable without
 *    shared-object enumeration, which is out of scope).
 *  - same entity_ref on >=2 discovered chains → AMBIGUOUS_ENTITY_CHAIN.
 *  - any port/network error propagates unchanged.
 */
export async function buildRegistry(
  entityIds: string[],
  owner: string,
  originalPackageId: string,
  port: RegistryPort,
): Promise<EntityRegistry> {
  const caps = await port.listOwnedAnchorCaps(owner, originalPackageId);

  const byRef = new Map<string, { chainObjectId: string; capObjectId: string }>();
  for (const cap of caps) {
    const state = await port.getChainState(cap.chainId);
    const refHex = hex(state.entityRef);
    if (byRef.has(refHex)) {
      throw new AnchorError('AMBIGUOUS_ENTITY_CHAIN',
        `entity_ref ${refHex} maps to multiple chains (e.g. ${byRef.get(refHex)!.chainObjectId} and ${cap.chainId})`);
    }
    byRef.set(refHex, { chainObjectId: cap.chainId, capObjectId: cap.capObjectId });
  }

  const registry: EntityRegistry = {};
  for (const entityId of entityIds) {
    const refHex = hex(deriveEntityRef(entityId));
    const hit = byRef.get(refHex);
    if (!hit) {
      throw new AnchorError('ENTITY_CHAIN_NOT_FOUND',
        `no owned AnchorCap for entityId=${entityId} (chain not bootstrapped, or cap rotated away from owner ${owner})`);
    }
    registry[entityId] = hit;
  }
  return registry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/anchor-svc && npx vitest run test/buildRegistry.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `cd services/anchor-svc && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo-root> add services/anchor-svc/src/core/buildRegistry.ts services/anchor-svc/test/buildRegistry.test.ts
git -C <repo-root> commit -m "feat(anchor-svc): buildRegistry — owned-cap discovery, fail-closed"
```

---

### Task 3: Adapter — listOwnedAnchorCaps (SDK seam)

**Files:**
- Modify: `services/anchor-svc/src/adapter/suiChainAdapter.ts`
- Test: covered by Task 4 real-chain script (the SDK seam is not unit-mocked — `getChainState` is already exercised by existing tests; this method is verified live).

**Interfaces:**
- Consumes: existing `CoreClient` (`this.client`); `OwnedCap`, `RegistryPort` from `domain/types.js`.
- Produces: `SuiChainAdapter.listOwnedAnchorCaps(owner: string, originalPackageId: string): Promise<OwnedCap[]>`; the class now also satisfies `RegistryPort` (it already has `getChainState`).

- [ ] **Step 1: Confirm the SDK owned-objects API against installed source**

Run: `cd services/anchor-svc && grep -rn "getOwnedObjects\|ownedObjects" node_modules/@mysten/sui/dist/ | grep -i "core\|client" | head` and read the matching `.d.ts` for the exact parameter/return shape.
Expected: identify the method name + its parameter/return shape (page object with `data` + `cursor`/`hasNextPage`, and the per-object filter option for StructType). Read the `.d.ts` for the exact field names. Record what you find — the code in Step 2 uses it.

> If the CoreClient method differs from the shape assumed in Step 2 (filter key, page field names), adjust Step 2's code to match the installed 2.19 source. The contract that MUST hold regardless: full pagination, StructType filter on the original package id, json/content included so `chain_id` is readable, throw on missing `chain_id`.

- [ ] **Step 2: Implement `listOwnedAnchorCaps`**

In `services/anchor-svc/src/adapter/suiChainAdapter.ts`, add the import and method. Update the imports line to include `OwnedCap` and `RegistryPort`:

```ts
import {
  LinkMismatchError,
  type AnchorResult, type ChainState, type ExecAnchorInput, type SuiChainPort,
  type OwnedCap, type RegistryPort,
} from '../domain/types.js';
```

Change the class declaration to also implement `RegistryPort`:

```ts
export class SuiChainAdapter implements SuiChainPort, RegistryPort {
```

Add this method to the class (constant near the top alongside `MODULE`):

```ts
const CAP_TYPE = 'AnchorCap';
```

```ts
  /**
   * Discover every AnchorCap owned by `owner`, paging the full cursor loop.
   * StructType filter uses `originalPackageId` (NOT the latest upgraded id) —
   * Sui struct types keep their defining package's identity across upgrades.
   * Throws on any cap whose `chain_id` field is missing/malformed (fail-closed:
   * a silently dropped cap would surface later as a false ENTITY_CHAIN_NOT_FOUND).
   */
  async listOwnedAnchorCaps(owner: string, originalPackageId: string): Promise<OwnedCap[]> {
    const structType = `${originalPackageId}::${MODULE}::${CAP_TYPE}`;
    const out: OwnedCap[] = [];
    let cursor: string | null | undefined = undefined;
    do {
      const page = await this.client.getOwnedObjects({
        owner,
        cursor,
        filter: { StructType: structType },
        include: { json: true },
      });
      for (const item of page.objects) {
        const capObjectId = item.id;
        const f = item.json as Record<string, unknown> | null | undefined;
        const chainId = f?.chain_id;
        if (typeof chainId !== 'string' || chainId.length === 0) {
          throw new Error(`AnchorCap ${capObjectId} has missing/invalid chain_id field`);
        }
        out.push({ capObjectId, chainId });
      }
      cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);
    return out;
  }
```

> NOTE: the exact property names (`page.objects` vs `page.data`, `item.id` vs `item.objectId`, `item.json` vs `item.content`, `filter` vs `options.filter`) come from Step 1. Use the verified names; the structure above is the template.

- [ ] **Step 3: Typecheck**

Run: `cd services/anchor-svc && npx tsc --noEmit`
Expected: no errors. (If the SDK types reject the call shape, reconcile against Step 1's findings.)

- [ ] **Step 4: Run the full existing test suite (no regressions)**

Run: `cd services/anchor-svc && npx vitest run`
Expected: all prior tests + the 7 buildRegistry tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/anchor-svc/src/adapter/suiChainAdapter.ts
git -C <repo-root> commit -m "feat(anchor-svc): SuiChainAdapter.listOwnedAnchorCaps (RegistryPort impl)"
```

---

### Task 4: Export + real-chain verification

**Files:**
- Modify: `services/anchor-svc/src/index.ts`
- Create: `services/anchor-svc/scripts/verify-registry-builder.ts`
- Modify: `anchor-notes.md` (local, repo root) — record JSON-RPC deactivation deadline

**Interfaces:**
- Consumes: `buildRegistry` from `core/buildRegistry.js`; `SuiChainAdapter` from `adapter/suiChainAdapter.js`; the existing testnet ids in `anchor-notes.md`.
- Produces: public export of `buildRegistry`; an executable verification script.

- [ ] **Step 1: Export `buildRegistry`**

In `services/anchor-svc/src/index.ts`, add after the `resolveChain` export line:

```ts
export { buildRegistry } from './core/buildRegistry.js';
```

- [ ] **Step 2: Typecheck the export**

Run: `cd services/anchor-svc && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Write the real-chain verification script**

Read `anchor-notes.md` (repo root) for the live testnet values: `originalPackageId` (first-published audit_anchor package id), the signer/owner address, and the known `entityId` whose chain/cap were created in the e2e. Create `services/anchor-svc/scripts/verify-registry-builder.ts`:

```ts
/**
 * Real-chain check (per follow-up ① discipline — no "verified-by-types only").
 * Runs buildRegistry once against the live testnet chain/cap from anchor-notes.md
 * and asserts the resolved ids match the known values.
 *
 * Fill the CONSTANTS below from anchor-notes.md before running.
 * Run: cd services/anchor-svc && npx tsx scripts/verify-registry-builder.ts
 */
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { buildRegistry } from '../src/core/buildRegistry.js';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// === Fill from anchor-notes.md ===
const ORIGINAL_PACKAGE_ID = '<original audit_anchor package id>';
const OWNER = '<signer address that holds the AnchorCap>';
const ENTITY_ID = '<entityId used in the e2e>';
const EXPECTED_CHAIN = '<chain object id>';
const EXPECTED_CAP = '<cap object id>';
// =================================

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('testnet') });
  // The verification only reads; a throwaway keypair satisfies the adapter ctor.
  const adapter = new SuiChainAdapter(client.core, Ed25519Keypair.generate());

  const reg = await buildRegistry([ENTITY_ID], OWNER, ORIGINAL_PACKAGE_ID, adapter);
  const entry = reg[ENTITY_ID];
  if (!entry) throw new Error('entityId not resolved');
  if (entry.chainObjectId !== EXPECTED_CHAIN) {
    throw new Error(`chain mismatch: got ${entry.chainObjectId}, want ${EXPECTED_CHAIN}`);
  }
  if (entry.capObjectId !== EXPECTED_CAP) {
    throw new Error(`cap mismatch: got ${entry.capObjectId}, want ${EXPECTED_CAP}`);
  }
  console.log('OK: buildRegistry resolved', ENTITY_ID, '→', entry);
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
```

> The `client.core` accessor and adapter ctor signature mirror the existing e2e script in `services/anchor-svc/scripts/`. If the existing scripts construct the adapter differently (e.g. a different client/keypair wiring), match that wiring instead.

- [ ] **Step 4: Run the verification script against testnet**

Run: `cd services/anchor-svc && npx tsx scripts/verify-registry-builder.ts`
Expected: `OK: buildRegistry resolved ... → { chainObjectId: ..., capObjectId: ... }`.

> If it fails with `ENTITY_CHAIN_NOT_FOUND`, the most likely cause is the StructType filter using a wrong package id — confirm `ORIGINAL_PACKAGE_ID` is the FIRST-published id, not an upgraded one.

- [ ] **Step 5: Record the JSON-RPC deactivation deadline in `anchor-notes.md`**

Append a "High-priority follow-up" note to `anchor-notes.md` (repo root, local/gitignored): "P126: JSON-RPC deprecated, permanent deactivation 2026-07-31. Entire anchor-svc (incl. buildRegistry getOwnedObjects) rides JSON-RPC → migrate whole svc to SuiGrpcClient before deadline; gRPC also populates cleverError.constantName, letting follow-up ① drop its state-reconstruction workaround — do both together."

- [ ] **Step 6: Commit**

```bash
git -C <repo-root> add services/anchor-svc/src/index.ts services/anchor-svc/scripts/verify-registry-builder.ts
git -C <repo-root> commit -m "feat(anchor-svc): export buildRegistry + real-chain verify script"
```

> `anchor-notes.md` is local/gitignored — do not add it to the commit.

---

## Post-implementation (outside this plan)

After all tasks pass, run the mandatory dual-review (`/dual-review`): round 1 codex generic review, round 2 SUI skills (`move-code-quality` not applicable — no Move change; use `sui-security-guard` lens on the TS adapter discovery path + `sui-architect` on the package-id split). Core path is discovery/resolution, not money flow, but the fail-closed semantics warrant the external codex pass per dev-rules.
