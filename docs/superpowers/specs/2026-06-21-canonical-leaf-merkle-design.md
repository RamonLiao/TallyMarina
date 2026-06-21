# C1/C2 — Canonical Leaf Encoding Freeze + Merkle Spec

**Date**: 2026-06-21
**Status**: Design approved, pending spec review
**Scope**: `services/rules-engine` — freeze the merkle-leaf serialization and define the JE merkle tree. Hard prerequisite for the Snapshot Service.

## Problem

`core/canonical.ts` is currently `sort-keys + JSON.stringify`, used only for `idempotencyKey` / `lineageHash` (off-chain dedup, computed by the same Node binary → byte-stable in practice). The moment a JE serialization becomes a **merkle leaf preimage** reconstructed by an **external auditor in another language** (Python/Go/Rust), `JSON.stringify` is no longer a safe cross-language contract. We must freeze a deterministic, cross-language leaf encoding and define the merkle tree that produces the 32-byte root anchored on-chain by `audit_anchor`.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| C1-enc | Leaf preimage = **BCS** (Sui-native), not JCS | Compact, unambiguous, Sui/Move-native; keeps a future "recompute leaf in Move" path open. Cross-language cost accepted (auditor needs a BCS lib + the frozen schema). |
| C1-iso | **Do NOT touch** `canonicalJson` / `idempotencyKey` / `lineageHash` | They are internal same-binary dedup. Changing them risks drifting `idempotencyKey`, which would break all replay dedup. Merkle leaf gets its own codec. |
| C2-gran | Leaf granularity = **per `JournalEntry`** | One leaf = whole JE (idempotencyKey + all lines, BCS). Line order frozen inside the preimage → completeness guaranteed natively. Auditor proves inclusion of a single JE. |
| C2-ord | Leaf ordering = **idempotencyKey lexical (hex)** | Pure function, no external state; auditor with the same JE set MUST derive the same root. idempotencyKey is content-addressed and unique. |
| C2-ord-future | Reserve versioned `orderingPolicy` for a future **business-order** index | Preserving business sequence matters; a future Snapshot Svc may assign a snapshot-local order index. Switching policy value is non-breaking (leaf preimage/hash rules unchanged); manifest records which policy was used. **V2 caveat below.** |
| C2-hash | `sha256`, RFC 6962-style domain separation | Matches the on-chain 32-byte hash store. Leaf/node prefixes prevent second-preimage & CVE-2012-2459 duplicate-leaf forgery. |

## C1 — `core/leafCodec.ts` (new)

Sole serializer for merkle leaves. Adds runtime dep `@mysten/bcs` (pin version at install).

### Frozen BCS schema — `JE_LEAF_BCS_V1`

Field order and types are FROZEN. Any change ⇒ new version id + new golden vectors.

```
JournalEntryLeaf {
  idempotencyKey: string
  reversalOf:     Option<string>
  lines:          vector<JeLineBcs>
}

JeLineBcs {
  account:      string
  side:         u8            // DEBIT = 0, CREDIT = 1
  amountMinor:  string        // minor-unit integer string (NOT u64/u128)
  origCoinType: Option<string>
  origQtyMinor: Option<string>
  priceRef:     Option<string>
  fxRef:        Option<string>
  leg:          string
}
```

### BCS ↔ Move type mapping (FROZEN — for future on-chain leaf recompute)

The auditor's BCS lib and any future Move recompute MUST agree on this mapping.
`@mysten/bcs` `bcs.string()` = ULEB128 length + UTF-8 bytes, byte-identical to Move
`std::string::String` (which is `vector<u8>` of valid UTF-8). `Option` = 1 tag byte
(`0x00` none / `0x01` some) then the inner value.

| BCS field type | `@mysten/bcs` | Move type |
|----------------|---------------|-----------|
| `string`         | `bcs.string()`              | `std::string::String` |
| `Option<string>` | `bcs.option(bcs.string())`  | `std::option::Option<std::string::String>` |
| `u8`             | `bcs.u8()`                  | `u8` |
| `vector<JeLineBcs>` | `bcs.vector(JeLineBcs)`   | `vector<JeLineBcs>` |

- `lineageHash` is **excluded** from the leaf (off-chain sidecar).
- `lines` order = the JE's existing production order, frozen inside the preimage.
- Amounts/quantities stay **strings** — no integer conversion (avoids overflow / precision disputes; cross-language compare is byte-equality on strings).
- `side` encoded as `u8` to keep BCS compact and unambiguous.

### API
```ts
export const JE_LEAF_CODEC_VERSION = 'JE_LEAF_BCS_V1';
export function encodeJeLeaf(je: JournalEntry): Uint8Array;   // BCS bytes (no domain prefix)
```

## C2 — `core/merkle.ts` (new)

Pure functions over `JournalEntry[]`.

### Tree rules
- **Hash**: `sha256`.
- **Domain separation**:
  - leaf hash = `sha256(0x00 ‖ encodeJeLeaf(je))`
  - node hash = `sha256(0x01 ‖ left ‖ right)`
- **Ordering**: sort leaves by `idempotencyKey` ascending (hex string compare).
- **Duplicate idempotencyKey**: invariant violation → **throw** (fail-closed; replay must dedup upstream).
- **Odd node**: RFC 6962 promotion — a lone node is carried up unchanged (NOT duplicated).
- **Empty set**: **throw** (empty snapshot is meaningless; fail-loud; no empty-root defined).
- **Single leaf**: root = that leaf hash.

### API
```ts
export interface MerkleManifest {
  merkleRoot: string;        // hex, 32 bytes
  leafCount: number;
  algo: 'SHA256';
  leafDomainPrefix: '0x00';
  nodeDomainPrefix: '0x01';
  oddNodePolicy: 'PROMOTE';
  orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1';   // reserved future: 'SNAPSHOT_BUSINESS_ORDER_V2'
  leafCodecVersion: 'JE_LEAF_BCS_V1';
}
export interface InclusionProof {
  leafIndex: number;
  siblings: { hash: string; position: 'L' | 'R' }[];
}
export function buildMerkle(jes: JournalEntry[]): { manifest: MerkleManifest; leafHashes: string[] };
export function inclusionProof(jes: JournalEntry[], idempotencyKey: string): InclusionProof;
export function verifyInclusion(leafBytes: Uint8Array, proof: InclusionProof, root: string): boolean;
```

- `manifest_hash` algorithm is **NOT** frozen here — that is the Snapshot Service's job. C2 only emits `merkleRoot` + manifest fields.

### orderingPolicy reconstruction contract

- **`IDEMPOTENCY_KEY_LEX_V1` (current)**: ordering is derivable from the JE set alone — the auditor sorts by `idempotencyKey` and reproduces the tree without external state. Self-contained.
- **`SNAPSHOT_BUSINESS_ORDER_V2` (reserved)**: the business-order index is **NOT** in the leaf preimage, so the JE set alone is insufficient to reconstruct leaf positions. Under V2 the snapshot manifest MUST carry the **ordered list of idempotencyKeys**; the auditor reconstructs the tree from that list, not from a sort. Inclusion-proof verification is unaffected (it only walks sibling hashes), but tree/root reconstruction depends on the manifest's ordered key list. This is why the switch is non-breaking for leaf/hash rules yet requires the manifest to grow a field.

## Scope boundaries

**In scope**: `leafCodec.ts`, `merkle.ts`, the frozen BCS schema doc + golden vectors, tests, add `@mysten/bcs` dep.

**Out of scope (explicit)**:
- Snapshot Service body (which JEs per snapshot, period boundaries, anchor call) — next task.
- Any change to `idempotency.ts` / `lineageHash` behavior.
- Move `audit_anchor` (interface already stable; only receives the 32-byte root).
- `manifest_hash` algorithm.

## Testing (Rule 9 — encode WHY)

- **BCS determinism**: same JE encodes byte-identical across calls; field-order sensitivity (swapping fields ⇒ different bytes).
- **Cross-language golden vectors**: freeze ≥3 known JEs' `(leaf bytes hex, leaf hash, root)` in this spec's appendix as the alignment baseline for external auditors (Python/Go/Rust). This is the verifiable anchor backing the "cross-language reconstruction" promise.
- **Merkle correctness**: 1/2/3(odd)/4-leaf roots hand-checked; inclusion proof verifies for every leaf; tampering any leaf changes the root.
- **Fail-closed**: empty set throws; duplicate idempotencyKey throws.
- **Second-preimage**: leaf/node domain prefixes make "forge an internal node as a leaf" infeasible.
- **Monkey**: random JE permutations ⇒ identical root (stable sort); varying `lineageHash` ⇒ root unchanged (confirms it is not in the leaf).

## Appendix — Golden vectors

**Frozen 2026-06-21. `@mysten/bcs` version: 2.1.0. `leafCodecVersion: JE_LEAF_BCS_V1`.**

Any change to the BCS schema, field order, or hash algorithm MUST produce different values here — drift = broken audit promise.

### JE 1 (`idempotencyKey = '1'.repeat(64)`, `reversalOf = null`)

Lines: DEBIT 1000 / 250 / SUI / qty=10 / P1 / F1 / MAIN; CREDIT 4000 / 250 / null / MAIN

```
leaf bytes hex:
4031313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131000204313030300003323530010d3078323a3a7375693a3a535549010231300102503101024631044d41494e0434303030010332353000000000044d41494e

leaf hash (sha256(0x00 ‖ leaf bytes)):
f916c77e8b200b7ab060bf0a0bf5a2c9e2d34f36940ec4c809909473d9dec2c6
```

### JE 2 (`idempotencyKey = '2'.repeat(64)`, `reversalOf = '1'.repeat(64)`)

Lines: DEBIT 4000 / 250 / null / MAIN; CREDIT 1000 / 250 / SUI / qty=10 / P1 / F1 / MAIN

```
leaf bytes hex:
4032323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232014031313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131313131020434303030000332353000000000044d41494e04313030300103323530010d3078323a3a7375693a3a535549010231300102503101024631044d41494e

leaf hash:
6807bb4eb29f367c5f50ec25f3d4f4d9f05880af9e57501d166582be63b4f281
```

### JE 3 (`idempotencyKey = '3'.repeat(64)`, `reversalOf = null`)

Lines: DEBIT 6000 / 7 / SUI / qty=7 / P2 / GAS; CREDIT 1000 / 7 / SUI / qty=7 / P2 / GAS

```
leaf bytes hex:
403333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333300020436303030000137010d3078323a3a7375693a3a5355490101370102503200034741530431303030010137010d3078323a3a7375693a3a535549010137010250320003474153

leaf hash:
bc9a0139e1d50cf30b943b1d27a2cf75dba9d22b55b24f618cf6e5485d5cb649
```

### Merkle root (3 leaves, `IDEMPOTENCY_KEY_LEX_V1` ordering, RFC 6962 `PROMOTE`)

```
root: a79a7f0a941714960aa3efd16f3a1bbadbd2f8e040362e805e3f14e97aff9072
```
