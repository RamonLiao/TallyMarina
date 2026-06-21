# Snapshot Service 骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把一個會計期間的 Rules Engine 輸出（`RuleOutput[]`）凍結成 auditor 可跨語言重算的 `AuditSnapshot` manifest，並產出鏈下 anchor payload（`manifest_hash` / `merkle_root` / `period_id` / `supersedes_seq`）。

**Architecture:** 純 off-chain deterministic TS library（mirror `services/rules-engine` 風格）。複用 rules-engine 的 `buildMerkle`/`encodeJeLeaf`/型別（Task 1 先擴 index 公開面）。新增 manifest BCS codec（`SNAPSHOT_MANIFEST_BCS_V1`，domain prefix `0x02`）+ sha256 manifest hash + fail-closed 驗證 + in-memory repo（idempotency/restatement）。**不**碰 Sui SDK、不算 prev_link、不送交易。

**Tech Stack:** TypeScript (ES2022, strict, `noUncheckedIndexedAccess`), `@mysten/bcs` 2.1.0 (pinned), `node:crypto` sha256, vitest 1.6, tsx.

## Global Constraints

- 序列化版本固定字串：manifest `'SNAPSHOT_MANIFEST_BCS_V1'`，leaf `'JE_LEAF_BCS_V1'`（複用 rules-engine 常數，勿硬編）。
- `@mysten/bcs` 鎖 `2.1.0`（與 rules-engine 一致，跨包 BCS 必須同版本，否則序列化漂移）。
- Domain prefix 三層：leaf `0x00`、node `0x01`、**manifest `0x02`**。manifest_hash = `sha256(0x02 || BCS(manifest))`，hex 輸出。
- 金額/數字決定性：BCS `u64` 欄位（leafCount/createdAtLogical）以整數傳入；`createdAtLogical` 由 caller 傳，library 不呼 `Date.now()`。
- period_id 長度限制 = UTF-8 **byte** 長度 ≤ 64（`Buffer.byteLength(periodId,'utf8')`，**非** `.length`），對齊 Move `vector<u8>` ≤64 bytes。
- 所有 Move `String` 對應欄位必須 valid UTF-8（fail-closed `INVALID_ENCODING`）。
- TDD：每 task 先寫 failing test → 跑驗 fail → 最小實作 → 跑驗 pass → commit。
- subagent dispatch 注意：repo 根在專案 root，**禁止** `git init`；用 `git -C <root>` commit。

## File Structure

```
services/snapshot-svc/
├── package.json                  name @subledger/snapshot-svc
├── tsconfig.json                 mirror rules-engine
├── vitest.config.ts              include test/**/*.test.ts
├── src/
│   ├── index.ts                  export buildSnapshot, InMemorySnapshotRepo, types
│   ├── deps/rulesEngine.ts       single chokepoint re-export from rules-engine index
│   ├── domain/types.ts           SnapshotMeta / AuditSnapshot / AnchorPayload / SnapshotError
│   ├── core/validate.ts          fail-closed input validation
│   ├── core/manifestCodec.ts     SNAPSHOT_MANIFEST_BCS_V1 BCS struct + encode
│   ├── core/manifestHash.ts      sha256(0x02 || BCS)
│   ├── core/buildSnapshot.ts     主流程
│   └── repo/snapshotRepo.ts      AuditSnapshotRepo interface + InMemorySnapshotRepo
└── test/
    ├── manifestCodec.test.ts
    ├── manifestHash.test.ts
    ├── validate.test.ts
    ├── buildSnapshot.test.ts
    ├── repo.test.ts
    └── monkey.test.ts
```

Also modifies: `services/rules-engine/src/index.ts`（Task 1，surgical re-exports）。

---

### Task 1: 擴 rules-engine index 公開面（re-exports）

snapshot-svc 只能從 rules-engine 的單一 index 入口 import（不深挖 `core/`）。目前 index 只 export `evaluate`/`reverse`。新增 `buildMerkle`、`MerkleManifest` 型別、`RuleOutput`/`JournalEntry`/`JeLine` 型別 re-export。

**Files:**
- Modify: `services/rules-engine/src/index.ts`（檔尾追加 export）
- Test: `services/rules-engine/test/publicSurface.test.ts`

**Interfaces:**
- Produces: `buildMerkle(jes: JournalEntry[]): { manifest: MerkleManifest; leafHashes: string[] }`、型別 `MerkleManifest`、`RuleOutput`、`JournalEntry`、`JeLine` 從 `@subledger/rules-engine` index 可取得。

- [ ] **Step 1: Write the failing test**

`services/rules-engine/test/publicSurface.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { buildMerkle, evaluate, reverse } from '../src/index.js';
import type { MerkleManifest, RuleOutput, JournalEntry, JeLine } from '../src/index.js';

describe('rules-engine public surface', () => {
  it('re-exports buildMerkle + existing fns', () => {
    expect(typeof buildMerkle).toBe('function');
    expect(typeof evaluate).toBe('function');
    expect(typeof reverse).toBe('function');
  });
  it('buildMerkle returns manifest+leafHashes for one JE', () => {
    const je: JournalEntry = {
      idempotencyKey: 'k1', lineageHash: 'lh', reversalOf: null,
      lines: [
        { account: 'a', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L1' },
        { account: 'b', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L2' },
      ],
    };
    const { manifest, leafHashes }: { manifest: MerkleManifest; leafHashes: string[] } = buildMerkle([je]);
    expect(manifest.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.leafCount).toBe(1);
    expect(leafHashes).toHaveLength(1);
  });
  // 型別 import 編譯通過即證 RuleOutput/JeLine 已 re-export
  const _t: (o: RuleOutput, l: JeLine) => void = () => {};
  it('type re-exports compile', () => expect(typeof _t).toBe('function'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/rules-engine && npx vitest run test/publicSurface.test.ts`
Expected: FAIL（`buildMerkle` is not exported / import error）。

- [ ] **Step 3: 在 index.ts 檔尾追加 re-exports**

`services/rules-engine/src/index.ts`（追加，不動既有）
```ts
// Public surface for downstream services (snapshot-svc 等)。型別/函式集中由 index 暴露，避免深 import core/。
export { buildMerkle } from './core/merkle.js';
export type { MerkleManifest, InclusionProof } from './core/merkle.js';
export type { RuleInput, RuleOutput, JournalEntry, JeLine, LotMovement, DisclosureFact, RuleException } from './domain/types.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/rules-engine && npx vitest run test/publicSurface.test.ts && npx tsc --noEmit`
Expected: PASS + typecheck clean。也跑全量確認無回歸：`npx vitest run`（應仍 108 pass + 新檔）。

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/rules-engine/src/index.ts services/rules-engine/test/publicSurface.test.ts
git -C <repo-root> commit -m "feat(rules-engine): widen index public surface (buildMerkle + types) for snapshot-svc"
```

---

### Task 2: snapshot-svc 腳手架 + deps chokepoint + domain types

**Files:**
- Create: `services/snapshot-svc/package.json`、`tsconfig.json`、`vitest.config.ts`
- Create: `services/snapshot-svc/src/deps/rulesEngine.ts`
- Create: `services/snapshot-svc/src/domain/types.ts`
- Test: `services/snapshot-svc/test/scaffold.test.ts`

**Interfaces:**
- Produces:
  - `deps/rulesEngine.ts` re-exports `buildMerkle`, `MerkleManifest`, `RuleOutput`, `JournalEntry`, `JeLine`（單一相對路徑 chokepoint）。
  - `SnapshotMeta = { entityId: string; periodId: string; createdAtLogical: number }`
  - `MerkleParamsFrozen = { algo: string; leafDomainPrefix: string; nodeDomainPrefix: string; oddNodePolicy: string; orderingPolicy: string }`
  - `SnapshotManifestStruct = { manifestVersion: string; entityId: string; periodId: string; merkleRoot: string; leafCount: number; leafCodecVersion: string; merkleParams: MerkleParamsFrozen; policyVersions: string[]; createdAtLogical: number }`（merkleRoot 為 hex string）
  - `AuditSnapshot = { entityId: string; periodId: string; seq: number; manifest: SnapshotManifestStruct; manifestHash: string; merkleRoot: string; leafCount: number; supersedesSeq: number | null }`
  - `AnchorPayload = { manifestHash: string; merkleRoot: string; periodId: string; supersedesSeq: number }`
  - `class SnapshotError extends Error { code: SnapshotErrorCode }`，`SnapshotErrorCode = 'EMPTY_SNAPSHOT' | 'DUPLICATE_IDEMPOTENCY_KEY' | 'PERIOD_ID_TOO_LONG' | 'INVALID_ENCODING' | 'INVALID_META' | 'SNAPSHOT_EXISTS'`

- [ ] **Step 1: 建 package.json**

`services/snapshot-svc/package.json`
```json
{
  "name": "@subledger/snapshot-svc",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mysten/bcs": "2.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 建 tsconfig.json + vitest.config.ts**

`services/snapshot-svc/tsconfig.json`
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
    "rootDir": "."
  },
  "include": ["src", "test"]
}
```
（注意 `rootDir: "."` + include test/，因跨包 import rules-engine `../../rules-engine/src` 在 src 之外；vitest/tsx 用 bundler resolution 解析相對 `.js`→`.ts`。）

`services/snapshot-svc/vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 3: deps chokepoint**

`services/snapshot-svc/src/deps/rulesEngine.ts`
```ts
// 單一跨包 import chokepoint：全 snapshot-svc 只在此引用 rules-engine。
// 路徑變動或未來改 package alias 只需改這一檔。
export { buildMerkle } from '../../../rules-engine/src/index.js';
export type { MerkleManifest, RuleOutput, JournalEntry, JeLine } from '../../../rules-engine/src/index.js';
```

- [ ] **Step 4: domain types**

`services/snapshot-svc/src/domain/types.ts`
```ts
export interface SnapshotMeta {
  entityId: string;
  periodId: string;
  createdAtLogical: number; // 邏輯序（period close marker），非 wall clock
}

export interface MerkleParamsFrozen {
  algo: string;
  leafDomainPrefix: string;
  nodeDomainPrefix: string;
  oddNodePolicy: string;
  orderingPolicy: string;
}

export interface SnapshotManifestStruct {
  manifestVersion: string;
  entityId: string;
  periodId: string;
  merkleRoot: string; // hex (32B)
  leafCount: number;
  leafCodecVersion: string;
  merkleParams: MerkleParamsFrozen;
  policyVersions: string[];
  createdAtLogical: number;
}

export interface AuditSnapshot {
  entityId: string;
  periodId: string;
  seq: number;
  manifest: SnapshotManifestStruct;
  manifestHash: string; // hex
  merkleRoot: string;   // hex
  leafCount: number;
  supersedesSeq: number | null;
}

export interface AnchorPayload {
  manifestHash: string; // hex 32B
  merkleRoot: string;   // hex 32B
  periodId: string;
  supersedesSeq: number; // 0 = 無前版（對齊 Move u64；首版用 0）
}

export type SnapshotErrorCode =
  | 'EMPTY_SNAPSHOT'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'PERIOD_ID_TOO_LONG'
  | 'INVALID_ENCODING'
  | 'INVALID_META'
  | 'SNAPSHOT_EXISTS';

export class SnapshotError extends Error {
  constructor(public readonly code: SnapshotErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SnapshotError';
  }
}
```

- [ ] **Step 5: scaffold smoke test**

`services/snapshot-svc/test/scaffold.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { buildMerkle } from '../src/deps/rulesEngine.js';
import { SnapshotError } from '../src/domain/types.js';

describe('snapshot-svc scaffold', () => {
  it('can reach rules-engine buildMerkle through deps chokepoint', () => {
    expect(typeof buildMerkle).toBe('function');
  });
  it('SnapshotError carries code', () => {
    const e = new SnapshotError('EMPTY_SNAPSHOT');
    expect(e.code).toBe('EMPTY_SNAPSHOT');
    expect(e).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 6: Run + Commit**

Run: `cd services/snapshot-svc && npm install && npx vitest run && npx tsc --noEmit`
Expected: 2 pass, typecheck clean。
```bash
git -C <repo-root> add services/snapshot-svc/package.json services/snapshot-svc/tsconfig.json services/snapshot-svc/vitest.config.ts services/snapshot-svc/src/deps services/snapshot-svc/src/domain services/snapshot-svc/test/scaffold.test.ts
git -C <repo-root> commit -m "feat(snapshot-svc): scaffold package + deps chokepoint + domain types"
```

---

### Task 3: validate.ts — fail-closed 輸入驗證

**Files:**
- Create: `services/snapshot-svc/src/core/validate.ts`
- Test: `services/snapshot-svc/test/validate.test.ts`

**Interfaces:**
- Consumes: `SnapshotMeta`, `SnapshotError`
- Produces: `validateMeta(meta: SnapshotMeta): void`（違規 throw `SnapshotError`）。檢查 entityId 非空且 valid UTF-8；periodId valid UTF-8 且 byte≤64；createdAtLogical 為 ≥0 安全整數。

- [ ] **Step 1: Write the failing test**

`services/snapshot-svc/test/validate.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { validateMeta } from '../src/core/validate.js';
import { SnapshotError } from '../src/domain/types.js';

const ok = { entityId: 'entity-1', periodId: '2026-Q2', createdAtLogical: 1 };

function code(fn: () => void): string {
  try { fn(); return 'NO_THROW'; }
  catch (e) { return e instanceof SnapshotError ? e.code : 'WRONG_ERROR'; }
}

describe('validateMeta fail-closed', () => {
  it('passes valid meta', () => expect(code(() => validateMeta(ok))).toBe('NO_THROW'));
  it('empty entityId → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, entityId: '' }))).toBe('INVALID_META'));
  it('non-integer createdAtLogical → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, createdAtLogical: 1.5 }))).toBe('INVALID_META'));
  it('negative createdAtLogical → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, createdAtLogical: -1 }))).toBe('INVALID_META'));
  it('NaN createdAtLogical → INVALID_META', () =>
    expect(code(() => validateMeta({ ...ok, createdAtLogical: NaN }))).toBe('INVALID_META'));
  it('periodId > 64 bytes → PERIOD_ID_TOO_LONG', () =>
    expect(code(() => validateMeta({ ...ok, periodId: 'x'.repeat(65) }))).toBe('PERIOD_ID_TOO_LONG'));
  it('multibyte periodId counted by bytes not chars', () => {
    // '€' = 3 bytes; 22 chars = 66 bytes > 64
    expect(code(() => validateMeta({ ...ok, periodId: '€'.repeat(22) }))).toBe('PERIOD_ID_TOO_LONG');
  });
  it('lone surrogate entityId → INVALID_ENCODING', () =>
    expect(code(() => validateMeta({ ...ok, entityId: '\uD800' }))).toBe('INVALID_ENCODING'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/snapshot-svc && npx vitest run test/validate.test.ts`
Expected: FAIL（`validateMeta` not defined）。

- [ ] **Step 3: 實作 validate.ts**

`services/snapshot-svc/src/core/validate.ts`
```ts
import { SnapshotMeta, SnapshotError } from '../domain/types.js';

// valid UTF-8 = round-trip 不產生 U+FFFD（lone surrogate 會被 TextEncoder 替換）。
function isValidUtf8(s: string): boolean {
  return !s.includes('�') && !/[\uD800-\uDFFF]/.test(
    Buffer.from(s, 'utf8').toString('utf8') === s ? '' : '\uD800',
  );
}

function assertUtf8(s: string, label: string): void {
  // lone surrogate / 非法序列：encode→decode 不還原 = 非法
  const roundTrip = Buffer.from(s, 'utf8').toString('utf8');
  if (roundTrip !== s) {
    throw new SnapshotError('INVALID_ENCODING', `${label} is not valid UTF-8`);
  }
}

export function validateMeta(meta: SnapshotMeta): void {
  if (typeof meta.entityId !== 'string' || meta.entityId.length === 0) {
    throw new SnapshotError('INVALID_META', 'entityId must be non-empty string');
  }
  if (!Number.isSafeInteger(meta.createdAtLogical) || meta.createdAtLogical < 0) {
    throw new SnapshotError('INVALID_META', 'createdAtLogical must be a non-negative safe integer');
  }
  assertUtf8(meta.entityId, 'entityId');
  if (typeof meta.periodId !== 'string') {
    throw new SnapshotError('INVALID_META', 'periodId must be string');
  }
  assertUtf8(meta.periodId, 'periodId');
  if (Buffer.byteLength(meta.periodId, 'utf8') > 64) {
    throw new SnapshotError('PERIOD_ID_TOO_LONG', 'periodId exceeds 64 UTF-8 bytes');
  }
}
```
（注意：`isValidUtf8` helper 上面那段是誤導性死碼，**不要**寫進去；只用 `assertUtf8` 的 round-trip 法。實作只含 `assertUtf8` + `validateMeta`。）

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/snapshot-svc && npx vitest run test/validate.test.ts && npx tsc --noEmit`
Expected: PASS + clean。

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/snapshot-svc/src/core/validate.ts services/snapshot-svc/test/validate.test.ts
git -C <repo-root> commit -m "feat(snapshot-svc): fail-closed meta validation (UTF-8 + byte-length period_id)"
```

---

### Task 4: manifestCodec.ts — SNAPSHOT_MANIFEST_BCS_V1 BCS encode

**Files:**
- Create: `services/snapshot-svc/src/core/manifestCodec.ts`
- Test: `services/snapshot-svc/test/manifestCodec.test.ts`

**Interfaces:**
- Consumes: `SnapshotManifestStruct`, `@mysten/bcs`
- Produces:
  - `MANIFEST_CODEC_VERSION = 'SNAPSHOT_MANIFEST_BCS_V1'`
  - `encodeManifest(m: SnapshotManifestStruct): Uint8Array`（FROZEN BCS，欄位順序見 spec §10；merkleRoot hex→fixedArray(32,u8)）

- [ ] **Step 1: Write the failing test**

`services/snapshot-svc/test/manifestCodec.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { encodeManifest, MANIFEST_CODEC_VERSION } from '../src/core/manifestCodec.js';
import type { SnapshotManifestStruct } from '../src/domain/types.js';

const m: SnapshotManifestStruct = {
  manifestVersion: MANIFEST_CODEC_VERSION,
  entityId: 'entity-1',
  periodId: '2026-Q2',
  merkleRoot: 'aa'.repeat(32),
  leafCount: 3,
  leafCodecVersion: 'JE_LEAF_BCS_V1',
  merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
  policyVersions: ['ps-1', 'rule-1'],
  createdAtLogical: 42,
};

describe('encodeManifest (SNAPSHOT_MANIFEST_BCS_V1)', () => {
  it('is deterministic — same input twice → identical bytes', () => {
    expect(Buffer.from(encodeManifest(m)).toString('hex')).toBe(Buffer.from(encodeManifest(m)).toString('hex'));
  });
  it('GOLDEN: frozen byte vector (detects serialization drift)', () => {
    const hex = Buffer.from(encodeManifest(m)).toString('hex');
    // GOLDEN: 由實作首次跑出後凍結貼回此處（implementer 跑一次填入，之後不可改動除非 bump version）
    expect(hex).toMatch(/^[0-9a-f]+$/);
    expect(hex.length).toBeGreaterThan(0);
    // <FREEZE_GOLDEN_HEX_HERE>: implementer 第一次跑出值後，改成 expect(hex).toBe('<value>')
  });
  it('field change flips bytes (merkleRoot)', () => {
    const a = Buffer.from(encodeManifest(m)).toString('hex');
    const b = Buffer.from(encodeManifest({ ...m, merkleRoot: 'bb'.repeat(32) })).toString('hex');
    expect(a).not.toBe(b);
  });
  it('rejects merkleRoot != 32 bytes', () => {
    expect(() => encodeManifest({ ...m, merkleRoot: 'aa'.repeat(16) })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/snapshot-svc && npx vitest run test/manifestCodec.test.ts`
Expected: FAIL（`encodeManifest` not defined）。

- [ ] **Step 3: 實作 manifestCodec.ts**

`services/snapshot-svc/src/core/manifestCodec.ts`
```ts
import { bcs } from '@mysten/bcs';
import type { SnapshotManifestStruct } from '../domain/types.js';

export const MANIFEST_CODEC_VERSION = 'SNAPSHOT_MANIFEST_BCS_V1';

// FROZEN schema — 欄位順序/型別不可改，除非 bump version + 重凍 golden。順序見 spec §10 附錄。
const MerkleParamsBcs = bcs.struct('MerkleParamsBcs', {
  algo: bcs.string(),
  leafDomainPrefix: bcs.string(),
  nodeDomainPrefix: bcs.string(),
  oddNodePolicy: bcs.string(),
  orderingPolicy: bcs.string(),
});

const SnapshotManifestBcs = bcs.struct('SnapshotManifestBcs', {
  manifestVersion: bcs.string(),
  entityId: bcs.string(),
  periodId: bcs.string(),
  merkleRoot: bcs.fixedArray(32, bcs.u8()),
  leafCount: bcs.u64(),
  leafCodecVersion: bcs.string(),
  merkleParams: MerkleParamsBcs,
  policyVersions: bcs.vector(bcs.string()),
  createdAtLogical: bcs.u64(),
});

function hexTo32Bytes(hex: string): number[] {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`manifestCodec: merkleRoot must be 32-byte lowercase hex, got len ${hex.length}`);
  }
  return Array.from(Buffer.from(hex, 'hex'));
}

export function encodeManifest(m: SnapshotManifestStruct): Uint8Array {
  return SnapshotManifestBcs.serialize({
    manifestVersion: m.manifestVersion,
    entityId: m.entityId,
    periodId: m.periodId,
    merkleRoot: hexTo32Bytes(m.merkleRoot),
    leafCount: m.leafCount,
    leafCodecVersion: m.leafCodecVersion,
    merkleParams: m.merkleParams,
    policyVersions: m.policyVersions,
    createdAtLogical: m.createdAtLogical,
  }).toBytes();
}
```

- [ ] **Step 4: Run, freeze golden, re-run**

Run: `cd services/snapshot-svc && npx vitest run test/manifestCodec.test.ts`
首次跑會印出 golden hex（GOLDEN test 目前寬鬆通過）。把實際 hex 值填回測試的 `<FREEZE_GOLDEN_HEX_HERE>`，改成 `expect(hex).toBe('<actual>')`，再跑一次：
Run: `npx vitest run test/manifestCodec.test.ts && npx tsc --noEmit`
Expected: 全 PASS + clean。

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/snapshot-svc/src/core/manifestCodec.ts services/snapshot-svc/test/manifestCodec.test.ts
git -C <repo-root> commit -m "feat(snapshot-svc): SNAPSHOT_MANIFEST_BCS_V1 codec + frozen golden bytes"
```

---

### Task 5: manifestHash.ts — sha256(0x02 || BCS)

**Files:**
- Create: `services/snapshot-svc/src/core/manifestHash.ts`
- Test: `services/snapshot-svc/test/manifestHash.test.ts`

**Interfaces:**
- Consumes: `encodeManifest`, `SnapshotManifestStruct`, `node:crypto`
- Produces: `MANIFEST_DOMAIN_PREFIX = 0x02`、`manifestHash(m: SnapshotManifestStruct): string`（hex，`sha256(0x02 || encodeManifest(m))`）

- [ ] **Step 1: Write the failing test**

`services/snapshot-svc/test/manifestHash.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { manifestHash, MANIFEST_DOMAIN_PREFIX } from '../src/core/manifestHash.js';
import { encodeManifest } from '../src/core/manifestCodec.js';
import type { SnapshotManifestStruct } from '../src/domain/types.js';

const m: SnapshotManifestStruct = {
  manifestVersion: 'SNAPSHOT_MANIFEST_BCS_V1', entityId: 'e', periodId: 'p',
  merkleRoot: 'cc'.repeat(32), leafCount: 1, leafCodecVersion: 'JE_LEAF_BCS_V1',
  merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
  policyVersions: ['a'], createdAtLogical: 0,
};

describe('manifestHash', () => {
  it('prefix is 0x02', () => expect(MANIFEST_DOMAIN_PREFIX).toBe(0x02));
  it('equals sha256(0x02 || BCS) hex', () => {
    const expected = createHash('sha256')
      .update(Buffer.concat([Buffer.from([0x02]), Buffer.from(encodeManifest(m))]))
      .digest('hex');
    expect(manifestHash(m)).toBe(expected);
  });
  it('is 32-byte hex', () => expect(manifestHash(m)).toMatch(/^[0-9a-f]{64}$/));
  it('differs from a leaf-prefixed hash of same bytes (domain separation)', () => {
    const leafLike = createHash('sha256')
      .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(encodeManifest(m))]))
      .digest('hex');
    expect(manifestHash(m)).not.toBe(leafLike);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/snapshot-svc && npx vitest run test/manifestHash.test.ts`
Expected: FAIL（`manifestHash` not defined）。

- [ ] **Step 3: 實作 manifestHash.ts**

`services/snapshot-svc/src/core/manifestHash.ts`
```ts
import { createHash } from 'node:crypto';
import { encodeManifest } from './manifestCodec.js';
import type { SnapshotManifestStruct } from '../domain/types.js';

// Domain prefix 第三層：leaf 0x00 / node 0x01 / manifest 0x02。防三種 preimage 互撞。
export const MANIFEST_DOMAIN_PREFIX = 0x02;

export function manifestHash(m: SnapshotManifestStruct): string {
  const body = encodeManifest(m);
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([MANIFEST_DOMAIN_PREFIX]), Buffer.from(body)]))
    .digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/snapshot-svc && npx vitest run test/manifestHash.test.ts && npx tsc --noEmit`
Expected: PASS + clean。

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/snapshot-svc/src/core/manifestHash.ts services/snapshot-svc/test/manifestHash.test.ts
git -C <repo-root> commit -m "feat(snapshot-svc): manifest_hash = sha256(0x02 || BCS) with domain separation"
```

---

### Task 6: snapshotRepo.ts — AuditSnapshotRepo + InMemorySnapshotRepo

**Files:**
- Create: `services/snapshot-svc/src/repo/snapshotRepo.ts`
- Test: `services/snapshot-svc/test/repo.test.ts`

**Interfaces:**
- Consumes: `AuditSnapshot`, `SnapshotError`
- Produces:
  - `interface FreezeResult { snapshot: AuditSnapshot; created: boolean }`
  - `interface AuditSnapshotRepo { freeze(snapshot: Omit<AuditSnapshot,'seq'|'supersedesSeq'>, opts?: { restate?: boolean }): FreezeResult; get(entityId: string, periodId: string): AuditSnapshot | null; }`
  - `class InMemorySnapshotRepo implements AuditSnapshotRepo`
- 語義：key = `entityId|periodId`。首 freeze → seq=0, supersedesSeq=null。同 key 再 freeze 無 `restate` → throw `SNAPSHOT_EXISTS`。`restate:true` → 新版 seq=prev.seq+1, supersedesSeq=prev.seq。`get` 回最新版。

- [ ] **Step 1: Write the failing test**

`services/snapshot-svc/test/repo.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { AuditSnapshot } from '../src/domain/types.js';

function base(): Omit<AuditSnapshot, 'seq' | 'supersedesSeq'> {
  return {
    entityId: 'e1', periodId: '2026-Q2',
    manifest: {
      manifestVersion: 'SNAPSHOT_MANIFEST_BCS_V1', entityId: 'e1', periodId: '2026-Q2',
      merkleRoot: 'aa'.repeat(32), leafCount: 1, leafCodecVersion: 'JE_LEAF_BCS_V1',
      merkleParams: { algo: 'SHA256', leafDomainPrefix: '0x00', nodeDomainPrefix: '0x01', oddNodePolicy: 'PROMOTE', orderingPolicy: 'IDEMPOTENCY_KEY_LEX_V1' },
      policyVersions: ['a'], createdAtLogical: 0,
    },
    manifestHash: 'bb'.repeat(32), merkleRoot: 'aa'.repeat(32), leafCount: 1,
  };
}

describe('InMemorySnapshotRepo', () => {
  it('first freeze → seq 0, supersedesSeq null, created true', () => {
    const r = new InMemorySnapshotRepo();
    const res = r.freeze(base());
    expect(res.created).toBe(true);
    expect(res.snapshot.seq).toBe(0);
    expect(res.snapshot.supersedesSeq).toBeNull();
  });
  it('re-freeze same period without restate → SNAPSHOT_EXISTS', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    let code = 'NO_THROW';
    try { r.freeze(base()); } catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('SNAPSHOT_EXISTS');
  });
  it('restate → seq increments, supersedesSeq points to prev', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    const res = r.freeze(base(), { restate: true });
    expect(res.snapshot.seq).toBe(1);
    expect(res.snapshot.supersedesSeq).toBe(0);
    expect(r.get('e1', '2026-Q2')?.seq).toBe(1);
  });
  it('get on unknown key → null', () => {
    expect(new InMemorySnapshotRepo().get('x', 'y')).toBeNull();
  });
  it('distinct periods isolated', () => {
    const r = new InMemorySnapshotRepo();
    r.freeze(base());
    const res = r.freeze({ ...base(), periodId: '2026-Q3', manifest: { ...base().manifest, periodId: '2026-Q3' } });
    expect(res.snapshot.seq).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/snapshot-svc && npx vitest run test/repo.test.ts`
Expected: FAIL（`InMemorySnapshotRepo` not defined）。

- [ ] **Step 3: 實作 snapshotRepo.ts**

`services/snapshot-svc/src/repo/snapshotRepo.ts`
```ts
import { AuditSnapshot, SnapshotError } from '../domain/types.js';

export interface FreezeResult {
  snapshot: AuditSnapshot;
  created: boolean;
}

export interface AuditSnapshotRepo {
  freeze(snapshot: Omit<AuditSnapshot, 'seq' | 'supersedesSeq'>, opts?: { restate?: boolean }): FreezeResult;
  get(entityId: string, periodId: string): AuditSnapshot | null;
}

function keyOf(entityId: string, periodId: string): string {
  // entityId/periodId 已過 validate（UTF-8、periodId≤64B）。用   分隔避免歧義碰撞。
  return `${entityId} ${periodId}`;
}

export class InMemorySnapshotRepo implements AuditSnapshotRepo {
  private readonly versions = new Map<string, AuditSnapshot[]>();

  freeze(snapshot: Omit<AuditSnapshot, 'seq' | 'supersedesSeq'>, opts?: { restate?: boolean }): FreezeResult {
    const k = keyOf(snapshot.entityId, snapshot.periodId);
    const chain = this.versions.get(k);
    if (!chain || chain.length === 0) {
      const frozen: AuditSnapshot = { ...snapshot, seq: 0, supersedesSeq: null };
      this.versions.set(k, [frozen]);
      return { snapshot: frozen, created: true };
    }
    if (!opts?.restate) {
      throw new SnapshotError('SNAPSHOT_EXISTS', `snapshot exists for ${snapshot.entityId}/${snapshot.periodId}; pass restate:true to supersede`);
    }
    const prev = chain[chain.length - 1] as AuditSnapshot;
    const frozen: AuditSnapshot = { ...snapshot, seq: prev.seq + 1, supersedesSeq: prev.seq };
    chain.push(frozen);
    return { snapshot: frozen, created: true };
  }

  get(entityId: string, periodId: string): AuditSnapshot | null {
    const chain = this.versions.get(keyOf(entityId, periodId));
    if (!chain || chain.length === 0) return null;
    return chain[chain.length - 1] as AuditSnapshot;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/snapshot-svc && npx vitest run test/repo.test.ts && npx tsc --noEmit`
Expected: PASS + clean。

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/snapshot-svc/src/repo/snapshotRepo.ts services/snapshot-svc/test/repo.test.ts
git -C <repo-root> commit -m "feat(snapshot-svc): in-memory repo with idempotency + restatement (supersedesSeq)"
```

---

### Task 7: buildSnapshot.ts — 主流程 + index export

**Files:**
- Create: `services/snapshot-svc/src/core/buildSnapshot.ts`
- Create: `services/snapshot-svc/src/index.ts`
- Test: `services/snapshot-svc/test/buildSnapshot.test.ts`

**Interfaces:**
- Consumes: `buildMerkle`, `RuleOutput`, `JournalEntry`（via deps）；`validateMeta`, `manifestHash`, `AuditSnapshotRepo`, 全 domain types
- Produces:
  - `buildSnapshot(outputs: RuleOutput[], meta: SnapshotMeta, repo: AuditSnapshotRepo, opts?: { restate?: boolean }): { auditSnapshot: AuditSnapshot; anchorPayload: AnchorPayload }`
  - `index.ts` re-export `buildSnapshot`, `InMemorySnapshotRepo`, 全 domain types, `MANIFEST_CODEC_VERSION`

主流程（spec §6）：
1. `validateMeta(meta)`
2. 過濾 `decision==='POSTABLE'` 的 outputs，flatten `journalEntries` → `JournalEntry[]`
3. 空 → throw `EMPTY_SNAPSHOT`
4. `buildMerkle(jes)`（dup key → 內部 throw，包成 `DUPLICATE_IDEMPOTENCY_KEY`）→ manifest fields
5. policyVersions = dedupe+sort(只取 POSTABLE outputs 的 `explanation.policyVersions`)
6. 組 `SnapshotManifestStruct` → `manifestHash`
7. `repo.freeze(...)` → AuditSnapshot
8. 回 `{ auditSnapshot, anchorPayload }`，anchorPayload.supersedesSeq = `auditSnapshot.supersedesSeq ?? 0`

- [ ] **Step 1: Write the failing test**

`services/snapshot-svc/test/buildSnapshot.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/core/buildSnapshot.js';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { RuleOutput, JournalEntry } from '../src/deps/rulesEngine.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key, lineageHash: 'lh', reversalOf: null,
    lines: [
      { account: 'a', side: 'DEBIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L1' },
      { account: 'b', side: 'CREDIT', amountMinor: '100', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L2' },
    ],
  };
}
function out(decision: RuleOutput['decision'], jes: JournalEntry[], policyVersions: string[]): RuleOutput {
  return {
    decision,
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as RuleOutput['assessment']['eventType'], accountingClass: '', measurementModel: '' },
    measurements: [], lotMovements: [], journalEntries: jes, disclosureFacts: [], exceptions: [],
    explanation: { ruleIds: [], policyVersions, priceRefs: [], fxRefs: [] },
  };
}
const meta = { entityId: 'e1', periodId: '2026-Q2', createdAtLogical: 7 };

describe('buildSnapshot', () => {
  it('happy path: 2 POSTABLE outputs → snapshot + anchorPayload', () => {
    const repo = new InMemorySnapshotRepo();
    const { auditSnapshot, anchorPayload } = buildSnapshot(
      [out('POSTABLE', [je('k1')], ['ps-1', 'rule-1']), out('POSTABLE', [je('k2')], ['ps-1', 'rule-2'])],
      meta, repo,
    );
    expect(auditSnapshot.leafCount).toBe(2);
    expect(auditSnapshot.manifest.policyVersions).toEqual(['ps-1', 'rule-1', 'rule-2']); // dedupe+sort
    expect(anchorPayload.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(anchorPayload.merkleRoot).toBe(auditSnapshot.merkleRoot);
    expect(anchorPayload.supersedesSeq).toBe(0);
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(0);
  });
  it('filters out non-POSTABLE outputs (not in merkle / policyVersions)', () => {
    const repo = new InMemorySnapshotRepo();
    const { auditSnapshot } = buildSnapshot(
      [out('POSTABLE', [je('k1')], ['ps-1']), out('REJECTED', [je('zz')], ['leak']), out('REVIEW_REQUIRED', [je('yy')], ['leak2'])],
      meta, repo,
    );
    expect(auditSnapshot.leafCount).toBe(1);
    expect(auditSnapshot.manifest.policyVersions).toEqual(['ps-1']);
  });
  it('no POSTABLE JE → EMPTY_SNAPSHOT', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try { buildSnapshot([out('REJECTED', [je('k')], [])], meta, repo); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('EMPTY_SNAPSHOT');
  });
  it('POSTABLE output with empty journalEntries (zero-value ITX) → EMPTY_SNAPSHOT when alone', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try { buildSnapshot([out('POSTABLE', [], ['ps'])], meta, repo); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('EMPTY_SNAPSHOT');
  });
  it('duplicate idempotencyKey across outputs → DUPLICATE_IDEMPOTENCY_KEY', () => {
    const repo = new InMemorySnapshotRepo();
    let code = 'NO_THROW';
    try { buildSnapshot([out('POSTABLE', [je('dup')], ['a']), out('POSTABLE', [je('dup')], ['b'])], meta, repo); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
  });
  it('deterministic: JE order shuffled → identical manifestHash', () => {
    const repo1 = new InMemorySnapshotRepo();
    const repo2 = new InMemorySnapshotRepo();
    const a = buildSnapshot([out('POSTABLE', [je('k1'), je('k2')], ['p'])], meta, repo1).auditSnapshot.manifestHash;
    const b = buildSnapshot([out('POSTABLE', [je('k2'), je('k1')], ['p'])], meta, repo2).auditSnapshot.manifestHash;
    expect(a).toBe(b);
  });
  it('field-binding: different entityId → different manifestHash', () => {
    const a = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], { ...meta, entityId: 'e2' }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).not.toBe(b);
  });
  it('field-binding: different createdAtLogical → different manifestHash', () => {
    const a = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], { ...meta, createdAtLogical: 8 }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).not.toBe(b);
  });
  it('restate path: second freeze with restate → supersedesSeq 0', () => {
    const repo = new InMemorySnapshotRepo();
    buildSnapshot([out('POSTABLE', [je('k1')], ['p'])], meta, repo);
    const { anchorPayload } = buildSnapshot([out('POSTABLE', [je('k1'), je('k2')], ['p'])], meta, repo, { restate: true });
    expect(anchorPayload.supersedesSeq).toBe(0);
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/snapshot-svc && npx vitest run test/buildSnapshot.test.ts`
Expected: FAIL（`buildSnapshot` not defined）。

- [ ] **Step 3: 實作 buildSnapshot.ts + index.ts**

`services/snapshot-svc/src/core/buildSnapshot.ts`
```ts
import { buildMerkle } from '../deps/rulesEngine.js';
import type { RuleOutput, JournalEntry } from '../deps/rulesEngine.js';
import { validateMeta } from './validate.js';
import { manifestHash } from './manifestHash.js';
import { MANIFEST_CODEC_VERSION } from './manifestCodec.js';
import { AuditSnapshotRepo } from '../repo/snapshotRepo.js';
import {
  SnapshotMeta, SnapshotError, AuditSnapshot, AnchorPayload, SnapshotManifestStruct,
} from '../domain/types.js';

function dedupeSort(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildSnapshot(
  outputs: RuleOutput[],
  meta: SnapshotMeta,
  repo: AuditSnapshotRepo,
  opts?: { restate?: boolean },
): { auditSnapshot: AuditSnapshot; anchorPayload: AnchorPayload } {
  validateMeta(meta);

  const postable = outputs.filter((o) => o.decision === 'POSTABLE');
  const jes: JournalEntry[] = postable.flatMap((o) => o.journalEntries);
  if (jes.length === 0) {
    throw new SnapshotError('EMPTY_SNAPSHOT', 'no POSTABLE journal entries to snapshot');
  }

  let merkle;
  try {
    merkle = buildMerkle(jes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate idempotencyKey')) {
      throw new SnapshotError('DUPLICATE_IDEMPOTENCY_KEY', msg);
    }
    throw e; // 未知 buildMerkle 錯誤照常冒泡，不吞
  }
  const { manifest: mm } = merkle;

  const policyVersions = dedupeSort(postable.flatMap((o) => o.explanation.policyVersions));

  const manifest: SnapshotManifestStruct = {
    manifestVersion: MANIFEST_CODEC_VERSION,
    entityId: meta.entityId,
    periodId: meta.periodId,
    merkleRoot: mm.merkleRoot,
    leafCount: mm.leafCount,
    leafCodecVersion: mm.leafCodecVersion,
    merkleParams: {
      algo: mm.algo,
      leafDomainPrefix: mm.leafDomainPrefix,
      nodeDomainPrefix: mm.nodeDomainPrefix,
      oddNodePolicy: mm.oddNodePolicy,
      orderingPolicy: mm.orderingPolicy,
    },
    policyVersions,
    createdAtLogical: meta.createdAtLogical,
  };

  const mh = manifestHash(manifest);

  const { snapshot } = repo.freeze(
    {
      entityId: meta.entityId,
      periodId: meta.periodId,
      manifest,
      manifestHash: mh,
      merkleRoot: mm.merkleRoot,
      leafCount: mm.leafCount,
    },
    opts,
  );

  const anchorPayload: AnchorPayload = {
    manifestHash: snapshot.manifestHash,
    merkleRoot: snapshot.merkleRoot,
    periodId: snapshot.periodId,
    supersedesSeq: snapshot.supersedesSeq ?? 0,
  };

  return { auditSnapshot: snapshot, anchorPayload };
}
```

`services/snapshot-svc/src/index.ts`
```ts
export { buildSnapshot } from './core/buildSnapshot.js';
export { InMemorySnapshotRepo } from './repo/snapshotRepo.js';
export type { AuditSnapshotRepo, FreezeResult } from './repo/snapshotRepo.js';
export { MANIFEST_CODEC_VERSION } from './core/manifestCodec.js';
export { MANIFEST_DOMAIN_PREFIX } from './core/manifestHash.js';
export type {
  SnapshotMeta, AuditSnapshot, AnchorPayload, SnapshotManifestStruct,
  MerkleParamsFrozen, SnapshotErrorCode,
} from './domain/types.js';
export { SnapshotError } from './domain/types.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/snapshot-svc && npx vitest run test/buildSnapshot.test.ts && npx tsc --noEmit`
Expected: 全 PASS + clean。

- [ ] **Step 5: Commit**

```bash
git -C <repo-root> add services/snapshot-svc/src/core/buildSnapshot.ts services/snapshot-svc/src/index.ts services/snapshot-svc/test/buildSnapshot.test.ts
git -C <repo-root> commit -m "feat(snapshot-svc): buildSnapshot main flow (POSTABLE filter + manifest_hash + anchor payload)"
```

---

### Task 8: Monkey testing — 極端輸入

依專案 `rules/test.md`：unit/integration 後必做 monkey testing。

**Files:**
- Test: `services/snapshot-svc/test/monkey.test.ts`

**Interfaces:**
- Consumes: `buildSnapshot`, `InMemorySnapshotRepo`, `SnapshotError`, deps types

- [ ] **Step 1: Write monkey tests**

`services/snapshot-svc/test/monkey.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/core/buildSnapshot.js';
import { InMemorySnapshotRepo } from '../src/repo/snapshotRepo.js';
import { SnapshotError } from '../src/domain/types.js';
import type { RuleOutput, JournalEntry } from '../src/deps/rulesEngine.js';

function je(key: string): JournalEntry {
  return {
    idempotencyKey: key, lineageHash: 'lh', reversalOf: null,
    lines: [
      { account: 'a', side: 'DEBIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L1' },
      { account: 'b', side: 'CREDIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'L2' },
    ],
  };
}
function out(jes: JournalEntry[], pv: string[] = ['p']): RuleOutput {
  return {
    decision: 'POSTABLE',
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as RuleOutput['assessment']['eventType'], accountingClass: '', measurementModel: '' },
    measurements: [], lotMovements: [], journalEntries: jes, disclosureFacts: [], exceptions: [],
    explanation: { ruleIds: [], policyVersions: pv, priceRefs: [], fxRefs: [] },
  };
}
const meta = { entityId: 'e1', periodId: '2026-Q2', createdAtLogical: 1 };

describe('snapshot-svc monkey', () => {
  it('large set: 5000 JE → stable root + deterministic across reorder', () => {
    const outs = Array.from({ length: 5000 }, (_, i) => out([je(`k-${String(i).padStart(5, '0')}`)]));
    const a = buildSnapshot(outs, meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([...outs].reverse(), meta, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).toBe(b);
  });
  it('very long policyVersions list → dedupes massively', () => {
    const pv = Array.from({ length: 10000 }, (_, i) => `pv-${i % 3}`); // only 3 distinct
    const { auditSnapshot } = buildSnapshot([out([je('k')], pv)], meta, new InMemorySnapshotRepo());
    expect(auditSnapshot.manifest.policyVersions).toEqual(['pv-0', 'pv-1', 'pv-2']);
  });
  it('unicode entityId (valid UTF-8) → succeeds + binds into hash', () => {
    const a = buildSnapshot([out([je('k')])], { ...meta, entityId: '實體-🚀' }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    const b = buildSnapshot([out([je('k')])], { ...meta, entityId: '實體-🛸' }, new InMemorySnapshotRepo()).auditSnapshot.manifestHash;
    expect(a).not.toBe(b);
  });
  it('periodId exactly 64 bytes passes; 65 fails', () => {
    const ok = buildSnapshot([out([je('k')])], { ...meta, periodId: 'x'.repeat(64) }, new InMemorySnapshotRepo());
    expect(ok.auditSnapshot.periodId.length).toBe(64);
    let code = 'NO_THROW';
    try { buildSnapshot([out([je('k')])], { ...meta, periodId: 'x'.repeat(65) }, new InMemorySnapshotRepo()); }
    catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
    expect(code).toBe('PERIOD_ID_TOO_LONG');
  });
  it('repeated freeze same repo without restate stays fail-closed across many attempts', () => {
    const repo = new InMemorySnapshotRepo();
    buildSnapshot([out([je('k')])], meta, repo);
    for (let i = 0; i < 50; i++) {
      let code = 'NO_THROW';
      try { buildSnapshot([out([je('k')])], meta, repo); }
      catch (e) { code = e instanceof SnapshotError ? e.code : 'WRONG'; }
      expect(code).toBe('SNAPSHOT_EXISTS');
    }
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(0); // 未被污染
  });
  it('many restatements → monotonic seq + supersedesSeq chain', () => {
    const repo = new InMemorySnapshotRepo();
    buildSnapshot([out([je('k')])], meta, repo);
    for (let i = 1; i <= 10; i++) {
      const { anchorPayload } = buildSnapshot([out([je('k')], [`p${i}`])], meta, repo, { restate: true });
      expect(anchorPayload.supersedesSeq).toBe(i - 1);
    }
    expect(repo.get('e1', '2026-Q2')?.seq).toBe(10);
  });
});
```

- [ ] **Step 2: Run all tests + typecheck**

Run: `cd services/snapshot-svc && npx vitest run && npx tsc --noEmit`
Expected: 全 PASS + clean。也回跑 rules-engine 確認 Task 1 無回歸：`cd ../rules-engine && npx vitest run`。

- [ ] **Step 3: Commit**

```bash
git -C <repo-root> add services/snapshot-svc/test/monkey.test.ts
git -C <repo-root> commit -m "test(snapshot-svc): monkey — large sets, unicode, byte-boundary, restatement chain"
```

---

## Self-Review

**Spec coverage:**
- §2 範圍邊界（不碰 Sui/prev_link/DB/Walrus）→ 全 task 無 Sui import；anchorPayload 不含 prev_link ✓
- §3 BCS + domain prefix 0x02 → Task 4/5 ✓
- §4 manifest 欄位集（9 欄 + merkleParams 5 欄）→ Task 2 types + Task 4 codec + Task 7 組裝 ✓
- §5 輸入 RuleOutput[] → Task 7 ✓
- §6 資料流 7 步 → Task 7 ✓
- §7 錯誤碼（EMPTY_SNAPSHOT/DUPLICATE_IDEMPOTENCY_KEY/PERIOD_ID_TOO_LONG/INVALID_ENCODING/INVALID_META/SNAPSHOT_EXISTS）→ Task 3(3碼) + Task 6(1碼) + Task 7(2碼) ✓
- §8 in-memory repo + restatement/supersedesSeq → Task 6 ✓
- §9 測試（golden/決定性/fail-closed/欄位綁定/POSTABLE 過濾/restatement/monkey）→ Task 4(golden)+Task 7(決定性/綁定/過濾)+Task 8(monkey) ✓
- §10 附錄 type map + UTF-8 約束 → Task 3(UTF-8)+Task 4(欄位順序) ✓

**Placeholder scan:** Task 4 GOLDEN hex 為「implementer 首跑後凍結」— 已明確標註填值流程，非懸置 placeholder。Task 3 有一段刻意標記為「死碼勿寫」的反例提示，實作者只寫 assertUtf8 版本。其餘無 TBD/TODO。

**Type consistency:** `buildSnapshot`/`encodeManifest`/`manifestHash`/`InMemorySnapshotRepo.freeze`/`AuditSnapshot`/`AnchorPayload`/`SnapshotManifestStruct` 在各 task 簽名一致；`supersedesSeq: number|null`（snapshot）vs anchorPayload `number`（`?? 0`）轉換已在 Task 7 顯式處理 ✓

**已知 follow-up（非本骨架 scope，留聯調）：** entityId↔chain object id 可信映射 gate（spec §2 註記）、prev_link 計算、真 DB、Sui PTB 送交易。
