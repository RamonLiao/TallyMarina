# Canonical Leaf Encoding + Merkle Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze a cross-language BCS merkle-leaf encoding for `JournalEntry` and define the JE merkle tree that produces the 32-byte root anchored on-chain.

**Architecture:** Two new pure-function modules in `services/rules-engine/src/core/`: `leafCodec.ts` (BCS schema + `encodeJeLeaf`) and `merkle.ts` (sorted leaves, RFC 6962 domain-separated sha256 tree, inclusion proofs). `idempotency.ts` / `canonical.ts` are NOT touched. On-chain `audit_anchor` is NOT touched (only consumes the 32-byte root).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), vitest, `@mysten/bcs`, Node `crypto.createHash('sha256')`.

## Global Constraints

- ESM imports use `.js` extension (e.g. `from '../src/core/leafCodec.js'`). Tests live in `services/rules-engine/test/*.test.ts`.
- Run all commands from `services/rules-engine/`. Repo root is the EXISTING git repo — NEVER run `git init`; commit from repo root with `git -C "$(git rev-parse --show-toplevel)"`.
- Amounts/quantities are minor-unit **strings** — never converted to numeric BCS types.
- `lineageHash` is NEVER part of a leaf.
- Hash = `sha256`. Leaf hash = `sha256(0x00 ‖ bytes)`. Node hash = `sha256(0x01 ‖ left ‖ right)`.
- `@mysten/bcs` pinned to an EXACT version (no `^`); record the version in `rules-engine-notes.md`.
- Test comments encode WHY (follow existing `// why:` convention in `test/canonical.test.ts`).
- `JournalEntry` / `JeLine` shapes are defined in `src/domain/types.ts` — do not redefine them.

---

### Task 1: BCS leaf codec

**Files:**
- Modify: `services/rules-engine/package.json` (add `@mysten/bcs` to `dependencies`)
- Create: `services/rules-engine/src/core/leafCodec.ts`
- Test: `services/rules-engine/test/leafCodec.test.ts`

**Interfaces:**
- Consumes: `JournalEntry`, `JeLine` from `../domain/types.js`.
- Produces:
  - `export const JE_LEAF_CODEC_VERSION = 'JE_LEAF_BCS_V1'`
  - `export function encodeJeLeaf(je: JournalEntry): Uint8Array` — BCS bytes, NO domain prefix.

- [ ] **Step 1: Install the pinned dependency**

Run (from `services/rules-engine/`):
```bash
npm install --save-exact @mysten/bcs
```
Then confirm it landed as an exact pin (no `^`):
```bash
node -e "console.log(require('./package.json').dependencies['@mysten/bcs'])"
```
Expected: a bare version string like `1.x.y` with no leading `^`. Record this version in `rules-engine-notes.md`.

- [ ] **Step 2: Write the failing test**

Create `test/leafCodec.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encodeJeLeaf, JE_LEAF_CODEC_VERSION } from '../src/core/leafCodec.js';
import type { JournalEntry } from '../src/domain/types.js';

function je(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    idempotencyKey: 'a'.repeat(64),
    lineageHash: 'b'.repeat(64),
    reversalOf: null,
    lines: [
      {
        account: '1000', side: 'DEBIT', amountMinor: '100',
        origCoinType: '0x2::sui::SUI', origQtyMinor: '5', priceRef: 'p1', fxRef: null, leg: 'MAIN',
      },
      {
        account: '4000', side: 'CREDIT', amountMinor: '100',
        origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN',
      },
    ],
    ...overrides,
  };
}

describe('leafCodec (JE_LEAF_BCS_V1)', () => {
  it('version id is frozen', () => {
    expect(JE_LEAF_CODEC_VERSION).toBe('JE_LEAF_BCS_V1');
  });

  it('encodes deterministically (same JE -> identical bytes)', () => {
    // why: leaf preimage 必須位元級穩定，否則 merkle root 漂移、auditor 對不上
    const a = encodeJeLeaf(je());
    const b = encodeJeLeaf(je());
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });

  it('excludes lineageHash from the preimage', () => {
    // why: lineageHash 是 off-chain sidecar，進 leaf 會讓 root 受審計旁資料污染
    const base = encodeJeLeaf(je({ lineageHash: 'b'.repeat(64) }));
    const diff = encodeJeLeaf(je({ lineageHash: 'c'.repeat(64) }));
    expect(Buffer.from(base).toString('hex')).toBe(Buffer.from(diff).toString('hex'));
  });

  it('is sensitive to line field changes', () => {
    // why: 任一借貸欄位變動都必須改變 leaf，否則竄改不可偵測
    const base = encodeJeLeaf(je());
    const tampered = encodeJeLeaf(je({
      lines: [{ ...je().lines[0], amountMinor: '101' }, je().lines[1]],
    }));
    expect(Buffer.from(base).toString('hex')).not.toBe(Buffer.from(tampered).toString('hex'));
  });

  it('encodes side DEBIT=0 / CREDIT=1 distinctly', () => {
    // why: 借貸方向是會計語義核心，必須在 preimage 中可區分
    const d = encodeJeLeaf(je({ lines: [{ ...je().lines[0], side: 'DEBIT' }] }));
    const c = encodeJeLeaf(je({ lines: [{ ...je().lines[0], side: 'CREDIT' }] }));
    expect(Buffer.from(d).toString('hex')).not.toBe(Buffer.from(c).toString('hex'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/leafCodec.test.ts`
Expected: FAIL — cannot resolve `../src/core/leafCodec.js`.

- [ ] **Step 4: Write minimal implementation**

Create `src/core/leafCodec.ts`:
```ts
import { bcs } from '@mysten/bcs';
import type { JournalEntry, JeLine } from '../domain/types.js';

export const JE_LEAF_CODEC_VERSION = 'JE_LEAF_BCS_V1';

// FROZEN schema — field order/types must not change without bumping the version + golden vectors.
const JeLineBcs = bcs.struct('JeLineBcs', {
  account: bcs.string(),
  side: bcs.u8(),                       // DEBIT = 0, CREDIT = 1
  amountMinor: bcs.string(),            // minor-unit integer string (NOT numeric)
  origCoinType: bcs.option(bcs.string()),
  origQtyMinor: bcs.option(bcs.string()),
  priceRef: bcs.option(bcs.string()),
  fxRef: bcs.option(bcs.string()),
  leg: bcs.string(),
});

const JournalEntryLeaf = bcs.struct('JournalEntryLeaf', {
  idempotencyKey: bcs.string(),
  reversalOf: bcs.option(bcs.string()),
  lines: bcs.vector(JeLineBcs),
});

function sideToU8(side: JeLine['side']): number {
  return side === 'DEBIT' ? 0 : 1;       // exhaustive: JeLine.side is 'DEBIT' | 'CREDIT'
}

export function encodeJeLeaf(je: JournalEntry): Uint8Array {
  return JournalEntryLeaf.serialize({
    idempotencyKey: je.idempotencyKey,
    reversalOf: je.reversalOf,
    lines: je.lines.map((l) => ({
      account: l.account,
      side: sideToU8(l.side),
      amountMinor: l.amountMinor,
      origCoinType: l.origCoinType,
      origQtyMinor: l.origQtyMinor,
      priceRef: l.priceRef,
      fxRef: l.fxRef,
      leg: l.leg,
    })),
  }).toBytes();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/leafCodec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add services/rules-engine/package.json services/rules-engine/package-lock.json services/rules-engine/src/core/leafCodec.ts services/rules-engine/test/leafCodec.test.ts
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(rules-engine): JE_LEAF_BCS_V1 merkle leaf codec"
```

---

### Task 2: Merkle tree build + manifest

**Files:**
- Create: `services/rules-engine/src/core/merkle.ts`
- Test: `services/rules-engine/test/merkle.test.ts`

**Interfaces:**
- Consumes: `encodeJeLeaf`, `JE_LEAF_CODEC_VERSION` from `./leafCodec.js`; `JournalEntry` from `../domain/types.js`.
- Produces:
  - `export interface MerkleManifest { merkleRoot: string; leafCount: number; algo: 'SHA256'; leafDomainPrefix: '0x00'; nodeDomainPrefix: '0x01'; oddNodePolicy: 'PROMOTE'; orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1'; leafCodecVersion: 'JE_LEAF_BCS_V1'; }`
  - `export function leafHash(je: JournalEntry): string` — hex of `sha256(0x00 ‖ encodeJeLeaf(je))`.
  - `export function buildMerkle(jes: JournalEntry[]): { manifest: MerkleManifest; leafHashes: string[] }` — `leafHashes` are in sorted (idempotencyKey asc) order.

- [ ] **Step 1: Write the failing test**

Create `test/merkle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildMerkle, leafHash } from '../src/core/merkle.js';
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import type { JournalEntry } from '../src/domain/types.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key,
    lineageHash: 'b'.repeat(64),
    reversalOf: null,
    lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    ],
  };
}
function h(prefix: number, ...chunks: Buffer[]): string {
  return createHash('sha256').update(Buffer.concat([Buffer.from([prefix]), ...chunks])).digest('hex');
}

describe('merkle tree', () => {
  it('leafHash applies 0x00 domain prefix over BCS bytes', () => {
    // why: domain separation 防 second-preimage（把內部 node 當 leaf 偽造）
    const j = je('a'.repeat(64));
    const expected = h(0x00, Buffer.from(encodeJeLeaf(j)));
    expect(leafHash(j)).toBe(expected);
  });

  it('single leaf: root == that leaf hash', () => {
    const j = je('a'.repeat(64));
    const { manifest } = buildMerkle([j]);
    expect(manifest.merkleRoot).toBe(leafHash(j));
    expect(manifest.leafCount).toBe(1);
  });

  it('two leaves: root == node(0x01, sorted left, right)', () => {
    // why: 排序固定，root 必須與手算一致才可被 auditor 重建
    const j1 = je('1'.repeat(64));
    const j2 = je('2'.repeat(64));
    const l1 = Buffer.from(leafHash(j1), 'hex');
    const l2 = Buffer.from(leafHash(j2), 'hex');
    const expected = h(0x01, l1, l2);
    const { manifest } = buildMerkle([j2, j1]); // input order reversed on purpose
    expect(manifest.merkleRoot).toBe(expected);
  });

  it('three leaves: odd node is promoted, not duplicated', () => {
    // why: 複製尾葉會觸發 CVE-2012-2459 duplicate-leaf forgery
    const j1 = je('1'.repeat(64));
    const j2 = je('2'.repeat(64));
    const j3 = je('3'.repeat(64));
    const l1 = Buffer.from(leafHash(j1), 'hex');
    const l2 = Buffer.from(leafHash(j2), 'hex');
    const l3 = Buffer.from(leafHash(j3), 'hex');
    const n12 = Buffer.from(h(0x01, l1, l2), 'hex');
    const expected = h(0x01, n12, l3); // l3 promoted, paired with n12
    const { manifest } = buildMerkle([j1, j2, j3]);
    expect(manifest.merkleRoot).toBe(expected);
  });

  it('manifest carries frozen policy fields', () => {
    const { manifest } = buildMerkle([je('a'.repeat(64))]);
    expect(manifest).toMatchObject({
      algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01',
      oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1', leafCodecVersion: 'JE_LEAF_BCS_V1',
    });
  });

  it('throws on empty set', () => {
    // why: 空 snapshot 無意義，fail-loud 而非回傳偽 root
    expect(() => buildMerkle([])).toThrow();
  });

  it('throws on duplicate idempotencyKey', () => {
    // why: 同 snapshot 重複 JE 是 invariant 違反，須上游 dedup
    expect(() => buildMerkle([je('a'.repeat(64)), je('a'.repeat(64))])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/merkle.test.ts`
Expected: FAIL — cannot resolve `../src/core/merkle.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/merkle.ts`:
```ts
import { createHash } from 'node:crypto';
import { encodeJeLeaf, JE_LEAF_CODEC_VERSION } from './leafCodec.js';
import type { JournalEntry } from '../domain/types.js';

export interface MerkleManifest {
  merkleRoot: string;
  leafCount: number;
  algo: 'SHA256';
  leafDomainPrefix: '0x00';
  nodeDomainPrefix: '0x01';
  oddNodePolicy: 'PROMOTE';
  orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1';
  leafCodecVersion: 'JE_LEAF_BCS_V1';
}

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

export function leafHash(je: JournalEntry): string {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(encodeJeLeaf(je))])).toString('hex');
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

// sorted leaf hashes (idempotencyKey asc) -> root hex
function rootFromLeaves(leafHexes: string[]): string {
  let level = leafHexes.map((h) => Buffer.from(h, 'hex'));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(nodeHash(level[i], level[i + 1]));
      else next.push(level[i]); // odd node promoted unchanged (RFC 6962)
    }
    level = next;
  }
  return level[0].toString('hex');
}

export function buildMerkle(jes: JournalEntry[]): { manifest: MerkleManifest; leafHashes: string[] } {
  if (jes.length === 0) throw new Error('merkle: empty JE set');
  const keys = new Set<string>();
  for (const je of jes) {
    if (keys.has(je.idempotencyKey)) throw new Error(`merkle: duplicate idempotencyKey ${je.idempotencyKey}`);
    keys.add(je.idempotencyKey);
  }
  const sorted = [...jes].sort((a, b) =>
    a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0);
  const leafHashes = sorted.map(leafHash);
  return {
    manifest: {
      merkleRoot: rootFromLeaves(leafHashes),
      leafCount: sorted.length,
      algo: 'SHA256',
      leafDomainPrefix: '0x00',
      nodeDomainPrefix: '0x01',
      oddNodePolicy: 'PROMOTE',
      orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1',
      leafCodecVersion: JE_LEAF_CODEC_VERSION,
    },
    leafHashes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/merkle.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add services/rules-engine/src/core/merkle.ts services/rules-engine/test/merkle.test.ts
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(rules-engine): merkle tree build + manifest (sha256, RFC6962 domain sep)"
```

---

### Task 3: Inclusion proof + verify

**Files:**
- Modify: `services/rules-engine/src/core/merkle.ts`
- Test: `services/rules-engine/test/merkle.proof.test.ts`

**Interfaces:**
- Consumes: everything from Task 2; `encodeJeLeaf` from `./leafCodec.js`.
- Produces:
  - `export interface InclusionProof { leafIndex: number; siblings: { hash: string; position: 'L' | 'R' }[]; }`
  - `export function inclusionProof(jes: JournalEntry[], idempotencyKey: string): InclusionProof` — throws if key absent.
  - `export function verifyInclusion(leafBytes: Uint8Array, proof: InclusionProof, root: string): boolean` — recomputes the root from raw BCS leaf bytes + siblings; `leafBytes` is the codec output WITHOUT domain prefix.

- [ ] **Step 1: Write the failing test**

Create `test/merkle.proof.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMerkle, inclusionProof, verifyInclusion } from '../src/core/merkle.js';
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import type { JournalEntry } from '../src/domain/types.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key, lineageHash: 'b'.repeat(64), reversalOf: null,
    lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    ],
  };
}

describe('merkle inclusion proof', () => {
  const jes = ['1', '2', '3', '4', '5'].map((d) => je(d.repeat(64)));
  const { manifest } = buildMerkle(jes);

  it('every leaf verifies against the root', () => {
    // why: auditor 必須能對任一 JE 獨立驗 inclusion，否則錨定無審計價值
    for (const j of jes) {
      const proof = inclusionProof(jes, j.idempotencyKey);
      expect(verifyInclusion(encodeJeLeaf(j), proof, manifest.merkleRoot)).toBe(true);
    }
  });

  it('tampered leaf bytes fail verification', () => {
    // why: 竄改任一借貸行必須令 proof 失敗
    const target = jes[2];
    const proof = inclusionProof(jes, target.idempotencyKey);
    const tampered = je(target.idempotencyKey);
    tampered.lines[0].amountMinor = '999';
    expect(verifyInclusion(encodeJeLeaf(tampered), proof, manifest.merkleRoot)).toBe(false);
  });

  it('wrong root fails verification', () => {
    const proof = inclusionProof(jes, jes[0].idempotencyKey);
    expect(verifyInclusion(encodeJeLeaf(jes[0]), proof, 'f'.repeat(64))).toBe(false);
  });

  it('throws for absent key', () => {
    expect(() => inclusionProof(jes, '9'.repeat(64))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/merkle.proof.test.ts`
Expected: FAIL — `inclusionProof` / `verifyInclusion` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/merkle.ts`:
```ts
export interface InclusionProof {
  leafIndex: number;
  siblings: { hash: string; position: 'L' | 'R' }[];
}

// re-derive the sorted leaf hashes (same ordering as buildMerkle) without recomputing the root
function sortedLeafHashes(jes: JournalEntry[]): { sortedKeys: string[]; leafHashes: string[] } {
  const sorted = [...jes].sort((a, b) =>
    a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0);
  return { sortedKeys: sorted.map((j) => j.idempotencyKey), leafHashes: sorted.map(leafHash) };
}

export function inclusionProof(jes: JournalEntry[], idempotencyKey: string): InclusionProof {
  const { sortedKeys, leafHashes } = sortedLeafHashes(jes);
  const leafIndex = sortedKeys.indexOf(idempotencyKey);
  if (leafIndex < 0) throw new Error(`merkle: idempotencyKey not found ${idempotencyKey}`);

  const siblings: { hash: string; position: 'L' | 'R' }[] = [];
  let level = leafHashes.map((h) => Buffer.from(h, 'hex'));
  let idx = leafIndex;
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const pairIdx = isRight ? idx - 1 : idx + 1;
    if (pairIdx < level.length) {
      // sibling sits on the opposite side of the current node
      siblings.push({ hash: level[pairIdx].toString('hex'), position: isRight ? 'L' : 'R' });
    }
    // build next level (mirror buildMerkle)
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(nodeHash(level[i], level[i + 1]));
      else next.push(level[i]);
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return { leafIndex, siblings };
}

export function verifyInclusion(leafBytes: Uint8Array, proof: InclusionProof, root: string): boolean {
  let acc = sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(leafBytes)]));
  for (const sib of proof.siblings) {
    const sibBuf = Buffer.from(sib.hash, 'hex');
    acc = sib.position === 'L' ? nodeHash(sibBuf, acc) : nodeHash(acc, sibBuf);
  }
  return acc.toString('hex') === root;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/merkle.proof.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add services/rules-engine/src/core/merkle.ts services/rules-engine/test/merkle.proof.test.ts
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(rules-engine): merkle inclusion proof + verify"
```

---

### Task 4: Golden vectors freeze + monkey tests

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-canonical-leaf-merkle-design.md` (fill Appendix golden vectors)
- Test: `services/rules-engine/test/merkle.golden.test.ts`
- Modify: `rules-engine-notes.md` (record `@mysten/bcs` version + module summary)

**Interfaces:**
- Consumes: `encodeJeLeaf` from `./leafCodec.js`; `buildMerkle`, `leafHash` from `./merkle.js`.
- Produces: frozen `(leaf bytes hex, leaf hash, root)` triples checked into both the test and the spec appendix.

- [ ] **Step 1: Write a one-shot generator to print the vectors**

Create a throwaway script `test/_genGolden.mts` (deleted in Step 5):
```ts
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import { buildMerkle, leafHash } from '../src/core/merkle.js';
import type { JournalEntry } from '../src/domain/types.js';

const jes: JournalEntry[] = [
  { idempotencyKey: '1'.repeat(64), lineageHash: '0'.repeat(64), reversalOf: null,
    lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10', priceRef: 'P1', fxRef: 'F1', leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '250', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
    ] },
  { idempotencyKey: '2'.repeat(64), lineageHash: '0'.repeat(64), reversalOf: '1'.repeat(64),
    lines: [
      { account: '4000', side: 'DEBIT', amountMinor: '250', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '1000', side: 'CREDIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10', priceRef: 'P1', fxRef: 'F1', leg: 'MAIN' },
    ] },
  { idempotencyKey: '3'.repeat(64), lineageHash: '0'.repeat(64), reversalOf: null,
    lines: [
      { account: '6000', side: 'DEBIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7', priceRef: 'P2', fxRef: null, leg: 'GAS' },
      { account: '1000', side: 'CREDIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7', priceRef: 'P2', fxRef: null, leg: 'GAS' },
    ] },
];
for (const j of jes) {
  console.log(j.idempotencyKey.slice(0, 4), 'leafBytes', Buffer.from(encodeJeLeaf(j)).toString('hex'));
  console.log(j.idempotencyKey.slice(0, 4), 'leafHash ', leafHash(j));
}
console.log('root', buildMerkle(jes).manifest.merkleRoot);
```
Run: `npx tsx test/_genGolden.mts`
Copy the printed values into Step 2 and the spec appendix.

- [ ] **Step 2: Write the golden + monkey test with the captured values**

Create `test/merkle.golden.test.ts` (paste the EXACT hex strings printed in Step 1 into the `expect` calls — do not hand-write them):
```ts
import { describe, it, expect } from 'vitest';
import { encodeJeLeaf } from '../src/core/leafCodec.js';
import { buildMerkle, leafHash } from '../src/core/merkle.js';
import type { JournalEntry } from '../src/domain/types.js';

const jes: JournalEntry[] = [ /* paste the SAME 3 JEs from _genGolden.mts */ ];

describe('golden vectors (cross-language alignment baseline)', () => {
  it('leaf bytes + leaf hash are frozen', () => {
    // why: 這些值是外部 auditor(Python/Go/Rust) 重建的對齊錨點，漂移=破壞承諾
    expect(Buffer.from(encodeJeLeaf(jes[0])).toString('hex')).toBe('<PASTE leafBytes[0]>');
    expect(leafHash(jes[0])).toBe('<PASTE leafHash[0]>');
    expect(leafHash(jes[1])).toBe('<PASTE leafHash[1]>');
    expect(leafHash(jes[2])).toBe('<PASTE leafHash[2]>');
  });
  it('root is frozen', () => {
    expect(buildMerkle(jes).manifest.merkleRoot).toBe('<PASTE root>');
  });
});

describe('monkey: root stability + lineage isolation', () => {
  it('random permutations of the same JE set yield the same root', () => {
    // why: leaf 排序由 idempotencyKey 決定，輸入順序不得影響 root
    const base = buildMerkle(jes).manifest.merkleRoot;
    const perms = [[2, 0, 1], [1, 2, 0], [2, 1, 0]];
    for (const p of perms) {
      expect(buildMerkle(p.map((i) => jes[i])).manifest.merkleRoot).toBe(base);
    }
  });
  it('varying lineageHash does not change the root', () => {
    // why: 再次確認 sidecar 不污染 merkle root（跨整棵樹層級）
    const base = buildMerkle(jes).manifest.merkleRoot;
    const mutated = jes.map((j) => ({ ...j, lineageHash: 'e'.repeat(64) }));
    expect(buildMerkle(mutated).manifest.merkleRoot).toBe(base);
  });
});
```

- [ ] **Step 3: Run the golden + monkey test**

Run: `npx vitest run test/merkle.golden.test.ts`
Expected: PASS (4 tests). If the golden test fails, the captured hex was mis-pasted — re-run Step 1 and re-copy.

- [ ] **Step 4: Fill the spec appendix**

Replace the Appendix placeholder in `docs/superpowers/specs/2026-06-21-canonical-leaf-merkle-design.md` with the 3 JEs' `(idempotencyKey, leaf bytes hex, leaf hash)` and the `root`, plus the recorded `@mysten/bcs` version. Add a one-line module summary + the pinned BCS version to `rules-engine-notes.md`.

- [ ] **Step 5: Delete the throwaway generator and run the full suite**

```bash
rm services/rules-engine/test/_genGolden.mts
```
Run (from `services/rules-engine/`): `npx vitest run && npx tsc --noEmit`
Expected: all suites PASS (prior 86 + new leafCodec/merkle/proof/golden), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add services/rules-engine/test/merkle.golden.test.ts docs/superpowers/specs/2026-06-21-canonical-leaf-merkle-design.md rules-engine-notes.md
git -C "$(git rev-parse --show-toplevel)" commit -m "test(rules-engine): freeze merkle golden vectors + monkey (root stability, lineage isolation)"
```

---

## Post-implementation

- [ ] Run the mandatory `dual-review` (codex generic + project SUI skills) over the branch diff before merge — leaf encoding is part of the audit-anchor evidence path, so external review applies.
- [ ] Update `tasks/progress.md`: mark C1/C2 done, set next task = Snapshot Svc skeleton.
- [ ] Verify no nested `.git`: `find services -name .git` (working-tree files only; commits must be on the main repo branch).
