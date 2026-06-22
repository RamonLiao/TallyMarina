# Anchor Svc follow-up ④ — Registry Builder (design)

**Date**: 2026-06-22
**Service**: `services/anchor-svc`
**Status**: design — pending user review → writing-plans
**Supersedes**: the manual `EntityRegistry` fill referenced in `progress.md` TODO follow-up ④

## Problem

`EntityRegistry` (entityId → `{chainObjectId, capObjectId}`) is currently filled by
hand. follow-up ④ was scoped in `progress.md` as "接 indexer 自動發現（獨立大工程，需
indexer 先存在）". Investigation showed that estimate is too large for the actual need.

Two facts collapse the scope:

1. **`create_chain` emits no event.** There is no `ChainCreated` on-chain record, so
   event-subscription discovery is impossible without a Move package upgrade. (Out of
   scope — we do not change Move.)
2. **`entity_ref = sha256(entityId)` is one-way** (`core/entityRef.ts`). On-chain data
   alone can never reverse to an `entityId`.

Therefore "auto-discovery" is **not** "scan the chain for entities". It is: **given a
known set of `entityId`s (the off-chain source of truth, supplied by the caller),
automatically resolve each to its on-chain chain/cap object ids** — replacing the manual
table. This needs **no separate indexer service, no Sui Indexer GA, no Move upgrade**.
Pure JSON-RPC `getOwnedObjects` (AnchorCap) + reading each chain's `entity_ref`.

## Scope

**In**: a pure function `buildRegistry(entityIds, owner, originalPackageId, port)` →
`EntityRegistry`, plus one new adapter method `listOwnedAnchorCaps`.

**Out**: separate indexer service, shared-object type enumeration (needs GraphQL/indexer),
Move changes, gRPC transport migration (tracked separately — see Project Risk).

## Algorithm

```
buildRegistry(entityIds: string[], owner: string, originalPackageId: string, port: RegistryPort):
  1. caps = await port.listOwnedAnchorCaps(owner, originalPackageId)   // [{capObjectId, chainId}], all pages
  2. byRef = Map<entityRefHex, {chainObjectId, capObjectId}>
     for each cap in caps:
       state = await port.getChainState(cap.chainId)         // existing method; returns entityRef
       refHex = hex(state.entityRef)
       if byRef.has(refHex): throw AMBIGUOUS_ENTITY_CHAIN     // same entity_ref on ≥2 chains
       byRef.set(refHex, { chainObjectId: cap.chainId, capObjectId: cap.capObjectId })
  3. registry = {}
     for each entityId in entityIds:
       refHex = hex(deriveEntityRef(entityId))               // single source of truth (sha256)
       hit = byRef.get(refHex)
       if !hit: throw ENTITY_CHAIN_NOT_FOUND
       registry[entityId] = hit
  4. return registry
```

Discovery is driven **only** through owned AnchorCaps. A chain whose cap was rotated away
from `owner` is invisible and falls into `ENTITY_CHAIN_NOT_FOUND` (see error handling).

## Port

A new interface, kept separate from `SuiChainPort` so the builder is unit-testable with a
fake and doesn't widen the anchor write path:

```ts
interface OwnedCap { capObjectId: string; chainId: string; }
interface RegistryPort {
  listOwnedAnchorCaps(owner: string, originalPackageId: string): Promise<OwnedCap[]>; // new
  getChainState(chainObjectId: string): Promise<ChainState>;                          // reuse SuiChainPort
}
```

`SuiChainAdapter` implements `listOwnedAnchorCaps`:
- `client` owned-objects API, `StructType` filter = `${originalPackageId}::audit_anchor::AnchorCap`.
- **Paginate the full cursor loop — never truncate.** If a page read fails, propagate.
- Parse each returned object's `chain_id` field. If the field is absent / unexpected shape,
  **throw — never skip** (a silently dropped cap becomes a false `ENTITY_CHAIN_NOT_FOUND`).
- Exact SDK method name verified against the **pinned `@mysten/sui` 2.19 source** at
  implementation time (per lessons: don't rely on possibly-stale docs).

## SUI architecture findings (sui-architect review, 2026-06-22)

### 🔴 Type filter MUST use the original package id

In Sui a struct type's identity is bound to the **package that defined it**; a package
upgrade does **not** change type identity. If the AnchorCap type filter uses the *latest
upgraded* package id, **zero caps match** → every `entityId` then throws
`ENTITY_CHAIN_NOT_FOUND` (a false total failure).

Consequence — the builder takes `originalPackageId` (the first-published id), which is a
**different config field** from the per-call `packageId` used by `anchorSnapshot`'s
moveCall target (which must be the **latest** id). These two ids have different sources and
must not be conflated:

| Use site | Which package id |
|----------|------------------|
| `listOwnedAnchorCaps` StructType filter | **original** (`originalPackageId`) |
| `execAnchor` moveCall target (`anchorSnapshot.ts`) | **latest** (`packageId`, existing) |
| `anchorAbortMessage` location match (existing) | latest (runtime call package) — unchanged |

Before any package upgrade these are equal, so today's testnet deploy works with one value;
the design keeps them as separate fields so an upgrade does not silently break discovery.

### 🔴 Owned-object discovery must fail loud on unexpected shape

`getOwnedObjects` returns only directly-owned objects. The current bootstrap uses
`transfer::transfer(cap, sender)` (plain owned), so caps are discoverable. But if a cap
parse yields no `chain_id`, the adapter throws (covered above) — never silently drops.

### 🟡 Project risk (not introduced here, must be recorded in `anchor-notes.md`)

**P126: JSON-RPC is deprecated; permanent deactivation 2026-07-31** (~6 weeks out as of
2026-06-22). The entire anchor-svc — including this builder's `getOwnedObjects` — rides
JSON-RPC. This follow-up does **not** widen scope to migrate, but the whole service should
migrate to `SuiGrpcClient` before the deadline (gRPC also populates `cleverError.constantName`,
which would let follow-up ① drop its state-reconstruction workaround — do both together).

## Error handling

New `AnchorErrorCode`s (on the existing `AnchorError` class):

- `ENTITY_CHAIN_NOT_FOUND` — entityId has no owned cap. Message states **both** possible
  causes: *chain not bootstrapped*, or *cap rotated away from owner*. (These two cannot be
  distinguished without shared-object enumeration, which is out of scope — see below.)
- `AMBIGUOUS_ENTITY_CHAIN` — the same `entity_ref` appears on ≥2 chains (duplicate
  bootstrap of one entityId). Fail-closed; do not guess.
- Network / pagination / `getChainState` failures → propagate unchanged (never swallowed,
  matching the existing adapter discipline).

**Resolved design conflict (Rule 1/7):** the user asked for a *distinct* error for
"chain exists but cap not owned by signer". This is **not achievable** within the zero-indexer
scope: discovery is via owned caps only, so a rotated-away cap is indistinguishable from a
never-bootstrapped chain (both yield no owned cap). Distinguishing them requires a second
discovery path — type-enumerating shared `EntityAnchorChain` objects — which JSON-RPC cannot
do (needs GraphQL/indexer). Decision: **all three cases throw (fail-closed holds)**;
cap-rotated folds into `ENTITY_CHAIN_NOT_FOUND` with an explanatory message.

## Testing (vitest; unit + monkey)

`core/buildRegistry.test.ts` — pure function, fake `RegistryPort`, no chain:

- happy: 3 entityIds ↔ 3 caps all resolve
- entityId with no matching cap → `ENTITY_CHAIN_NOT_FOUND`
- same `entity_ref` on two chains → `AMBIGUOUS_ENTITY_CHAIN`
- cap rotated away (list omits that cap) → `ENTITY_CHAIN_NOT_FOUND`, message asserts the
  "rotated away" wording
- empty `entityIds` → empty registry (not an error)
- **Rule 9**: a test that encodes *why* matching uses `deriveEntityRef(entity_ref)` rather
  than trusting list order — feed caps in a different order than entityIds and an entityId
  whose ref matches the 2nd cap; passes only if matching is hash-based, not positional.
- cap object missing `chain_id` field → throws (no silent skip)
- monkey: cap count spanning pagination boundary; a port that throws mid-scan must bubble;
  duplicate cap entries pointing at the *same* chainId.

Real-chain verification (per follow-up ① discipline — avoid "verified-by-types only"):
`scripts/verify-registry-builder.ts` runs `buildRegistry` once against the existing testnet
chain/cap from `anchor-notes.md` and asserts the resolved ids match.

## Files

- `services/anchor-svc/src/core/buildRegistry.ts` (new)
- `services/anchor-svc/src/domain/types.ts` (add `RegistryPort`, `OwnedCap`,
  `ENTITY_CHAIN_NOT_FOUND`, `AMBIGUOUS_ENTITY_CHAIN` codes)
- `services/anchor-svc/src/adapter/suiChainAdapter.ts` (add `listOwnedAnchorCaps`,
  implement `RegistryPort`)
- `services/anchor-svc/src/index.ts` (export `buildRegistry`)
- `services/anchor-svc/test/buildRegistry.test.ts` (new)
- `services/anchor-svc/scripts/verify-registry-builder.ts` (new)
- `anchor-notes.md` (local) — record JSON-RPC deactivation deadline as high-priority follow-up
```
