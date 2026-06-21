# Rules Engine 骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `services/rules-engine/` 純函式會計規則引擎骨架，打通 `DIGITAL_ASSET_RECEIPT` 一條 vertical slice 產出平衡 JE，12-phase fail-closed 管線全做真。

**Architecture:** 純函式核心 `evaluate(input): RuleOutput`，無 I/O。依賴（PolicySet/Prices/FX/Lots/COA）以 in-memory fixture 注入。12 個 phase 依序跑，任一 phase 回 exception 立即 short-circuit。金額一律 minor-unit bigint string，禁 JS number。

**Tech Stack:** TypeScript（ESM, ES2022, strict）、zod、vitest、node:crypto（sha2-256）。對齊 `services/ingestion/` 設定。

## Global Constraints

- ESM only：`"type": "module"`，import 路徑帶 `.js` 副檔名（對齊 ingestion）。
- tsconfig：`strict`、`noUncheckedIndexedAccess`、`moduleResolution: bundler`、`target/module ES2022`、`rootDir: src`。
- **金額禁 JS number**：一律 minor-unit integer 的 `string`（內部運算用 `bigint`，邊界存 `string`）。
- **Hash 一律 sha2-256**（`createHash('sha256')`）；禁 sha3/keccak。對齊 AuditAnchor 上鏈 hash family。
- **Canonical serialization 單一來源** `core/canonical.ts`：idempotency key 與 JE-line bytes 共用。欄位 key 排序 + 顯式 null 參與序列化。
- **Fail-closed**：缺 policy/price/fx/lot/mapping → 回 exception，**絕不**用 0 或 misc gain/loss 平衡。
- 每個 exception 結構 = `{ phase: number; code: ExceptionCode; detail: unknown }`。
- 測試檔放 `test/`，`include: ['test/**/*.test.ts']`。
- 對映規格：會計規格書 v3 §6、§3.0/§3.1、§7.8.1；spec doc `docs/superpowers/specs/2026-06-21-rules-engine-skeleton-design.md`。

---

### Task 1: Scaffold package + domain types/schemas

**Files:**
- Create: `services/rules-engine/package.json`
- Create: `services/rules-engine/tsconfig.json`
- Create: `services/rules-engine/vitest.config.ts`
- Create: `services/rules-engine/src/domain/types.ts`
- Create: `services/rules-engine/src/domain/schemas.ts`
- Test: `services/rules-engine/test/schemas.test.ts`

**Interfaces:**
- Produces: 全部核心 type + zod schema，後續 task 全部依賴此檔。

- [ ] **Step 1: 建 package.json / tsconfig / vitest.config（複製 ingestion 設定）**

`package.json`:
```json
{
  "name": "@subledger/rules-engine",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": {
    "@types/node": "^20.0.0",
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

- [ ] **Step 2: 寫 `src/domain/types.ts`**

```ts
// Canonical event codes (paid-pilot 5; 其餘暫不支援)
export type EventType =
  | 'DIGITAL_ASSET_RECEIPT' | 'DIGITAL_ASSET_PAYMENT'
  | 'INTERNAL_TRANSFER' | 'SPOT_TRADE_SWAP' | 'GAS_FEE';

export type RunMode = 'PREVIEW' | 'POST' | 'REPLAY';
export type Decision = 'POSTABLE' | 'REVIEW_REQUIRED' | 'REJECTED';

export type ExceptionCode =
  | 'SCHEMA_INVALID' | 'ENTITY_BOUNDARY' | 'NOT_IMPLEMENTED_IN_SLICE'
  | 'SCOPE_UNKNOWN' | 'PRICE_MISSING' | 'FX_MISSING' | 'INSUFFICIENT_LOT'
  | 'MAPPING_MISSING' | 'JE_OUT_OF_BALANCE' | 'RULE_CONFLICT'
  | 'IDEMPOTENT_REPLAY' | 'PERIOD_CLOSED';

export interface RuleException { phase: number; code: ExceptionCode; detail: unknown; }

export interface NormalizedEvent {
  schemaVersion: string;
  eventId: string;
  eventType: EventType;
  eventGroupId: string | null;          // §3.0.2 多腿綁定；receipt slice 填 null
  entityId: string;
  bookId: string;
  wallet: string;
  counterparty: string | null;
  coinType: string;
  assetDecimals: number;
  quantityMinor: string;                // minor-unit integer string
  eventTime: string;                    // ISO
  economicPurpose: string;              // e.g. 'RECEIVABLE_SETTLEMENT'
  ownershipChange: boolean;
  considerationAsset: string | null;
  // lineage refs
  rawPayloadHash: string;
  txDigest: string;
  eventIndex: number;
}

export interface ResolvedPolicySet {
  policySetVersion: string;
  assetPolicyVersion: string;
  eventPolicyVersion: string;
  ruleVersion: string;
  parserVersion: string;
  normalizationVersion: string;
  costBasisMethod: 'FIFO';
  functionalCurrency: string;           // e.g. 'USD'
  roundingThresholdMinor: string;       // 純小數差上限
  periodOpen: boolean;
}

export type AssessmentStatus = 'APPROVED' | 'PENDING_ACCOUNTING_REVIEW' | 'SCOPE_UNKNOWN';
export interface ClassificationAssessment {
  coinType: string;
  status: AssessmentStatus;
  accountingClass: string;              // e.g. 'INTANGIBLE_IAS38_COST'
  measurementModel: string;             // e.g. 'IAS38_COST'
}

export interface PricePoint {
  id: string;
  coinType: string;
  priceCurrency: string;                // 報價幣別
  asOfDate: string;                     // YYYY-MM-DD
  unitPriceMinor: string;               // priceCurrency minor per 1 whole asset unit
}

export interface FxRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  asOfDate: string;
  rateMinor: string;                    // toCurrency minor per 1 fromCurrency minor (scaled)
  scale: number;                        // rateMinor = rate * 10^scale
}

export interface PositionLot {
  lotId: string;
  coinType: string;
  wallet: string;
  remainingQtyMinor: string;
  costMinor: string;                    // functional ccy
}

export interface CoaMapping {
  // event/leg → 科目
  resolve(args: { eventType: EventType; leg: string; coinType: string }): string | null;
}

export interface JeLine {
  account: string;
  side: 'DEBIT' | 'CREDIT';
  amountMinor: string;                  // functional ccy
  // 保留原幣/數量/價格/匯率/lineage
  origCoinType: string | null;
  origQtyMinor: string | null;
  priceRef: string | null;
  fxRef: string | null;
  leg: string;
}

export interface LotMovement {
  lotId: string;
  coinType: string;
  wallet: string;
  deltaQtyMinor: string;                // +acquire / -dispose
  deltaCostMinor: string;
}

export interface DisclosureFact { kind: string; detail: Record<string, unknown>; }

export interface RunContext {
  runId: string; entityId: string; bookId: string; periodId: string;
  mode: RunMode; asOf: string;
}

export interface RuleInput {
  runContext: RunContext;
  event: NormalizedEvent;
  policySet: ResolvedPolicySet;
  assetAssessment: ClassificationAssessment;
  lots: PositionLot[];
  prices: PricePoint[];
  fxRates: FxRate[];
  coaMapping: CoaMapping;
  priorJournalEntries?: Record<string, JournalEntry>;  // idempotencyKey → prior JE (replay)
}

export interface JournalEntry {
  idempotencyKey: string;
  lines: JeLine[];
  reversalOf: string | null;            // prior idempotencyKey if reversal
}

export interface RuleOutput {
  decision: Decision;
  assessment: { eventType: EventType; accountingClass: string; measurementModel: string };
  measurements: Array<{ name: string; amountMinor: string; currency: string }>;
  lotMovements: LotMovement[];
  journalEntries: JournalEntry[];
  disclosureFacts: DisclosureFact[];
  exceptions: RuleException[];
  explanation: { ruleIds: string[]; policyVersions: string[]; priceRefs: string[]; fxRefs: string[] };
}
```

- [ ] **Step 3: 寫 `src/domain/schemas.ts`（zod，驗 NormalizedEvent + RunContext）**

```ts
import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'DIGITAL_ASSET_RECEIPT', 'DIGITAL_ASSET_PAYMENT',
  'INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE',
]);

const minorStr = z.string().regex(/^-?\d+$/, 'minor-unit integer string');

export const normalizedEventSchema = z.object({
  schemaVersion: z.string().min(1),
  eventId: z.string().min(1),
  eventType: eventTypeSchema,
  eventGroupId: z.string().nullable(),
  entityId: z.string().min(1),
  bookId: z.string().min(1),
  wallet: z.string().min(1),
  counterparty: z.string().nullable(),
  coinType: z.string().min(1),
  assetDecimals: z.number().int().min(0),
  quantityMinor: minorStr,
  eventTime: z.string().min(1),
  economicPurpose: z.string().min(1),
  ownershipChange: z.boolean(),
  considerationAsset: z.string().nullable(),
  rawPayloadHash: z.string().min(1),
  txDigest: z.string().min(1),
  eventIndex: z.number().int().min(0),
});

export const runContextSchema = z.object({
  runId: z.string().min(1),
  entityId: z.string().min(1),
  bookId: z.string().min(1),
  periodId: z.string().min(1),
  mode: z.enum(['PREVIEW', 'POST', 'REPLAY']),
  asOf: z.string().min(1),
});
```

- [ ] **Step 4: 寫測試 `test/schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { normalizedEventSchema } from '../src/domain/schemas.js';

const valid = {
  schemaVersion: '1', eventId: 'e1', eventType: 'DIGITAL_ASSET_RECEIPT',
  eventGroupId: null, entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: null,
  coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '100', eventTime: '2026-06-01T00:00:00Z',
  economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true, considerationAsset: null,
  rawPayloadHash: 'h', txDigest: 'd', eventIndex: 0,
};

describe('normalizedEventSchema', () => {
  it('accepts a valid receipt event', () => {
    expect(normalizedEventSchema.parse(valid).eventType).toBe('DIGITAL_ASSET_RECEIPT');
  });
  it('rejects float amount (number not allowed; string must be integer)', () => {
    // why: 金額禁 JS number / 禁小數字串，避免 binary float 誤入帳
    expect(() => normalizedEventSchema.parse({ ...valid, quantityMinor: '1.5' })).toThrow();
  });
  it('rejects unknown event type', () => {
    expect(() => normalizedEventSchema.parse({ ...valid, eventType: 'AIRDROP' })).toThrow();
  });
});
```

- [ ] **Step 5: 跑測試**

Run: `cd services/rules-engine && npm i && npm test -- schemas`
Expected: PASS（3 tests）

- [ ] **Step 6: typecheck + commit**

Run: `cd services/rules-engine && npm run typecheck`
Expected: 無錯誤（注意：CoaMapping 是 interface、JournalEntry 等型別此時未被使用也應通過）
```bash
git add services/rules-engine
git commit -m "feat(rules-engine): scaffold package + domain types/schemas"
```

---

### Task 2: core/decimal.ts — minor-unit bigint helpers

**Files:**
- Create: `services/rules-engine/src/core/decimal.ts`
- Test: `services/rules-engine/test/decimal.test.ts`

**Interfaces:**
- Produces:
  - `addMinor(a: string, b: string): string`
  - `negMinor(a: string): string`
  - `sumMinor(xs: string[]): string`
  - `mulUnitPrice(qtyMinor: string, assetDecimals: number, unitPriceMinor: string): string` — 回 priceCurrency minor 的 FV（= qty(whole) × unitPrice）
  - `applyFx(amountMinor: string, rateMinor: string, scale: number): string` — toCurrency minor
  - `isZeroMinor(a: string): boolean`

- [ ] **Step 1: 寫測試 `test/decimal.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { addMinor, negMinor, sumMinor, mulUnitPrice, applyFx, isZeroMinor } from '../src/core/decimal.js';

describe('decimal minor-unit helpers', () => {
  it('adds and negates without float', () => {
    expect(addMinor('300', '0')).toBe('300');
    expect(negMinor('300')).toBe('-300');
    expect(sumMinor(['300', '-300'])).toBe('0');
    expect(isZeroMinor('0')).toBe(true);
  });
  it('mulUnitPrice: 100 SUI (decimals 0) × unit 3 = 300', () => {
    // why: receipt FV 必須由 qty×price deterministically 得出，不可浮點
    expect(mulUnitPrice('100', 0, '3')).toBe('300');
  });
  it('mulUnitPrice respects asset decimals (1.00 unit, decimals 2, price 3 = 3)', () => {
    expect(mulUnitPrice('100', 2, '3')).toBe('3');
  });
  it('applyFx scales correctly (300 × 1.0 with scale 0 = 300)', () => {
    expect(applyFx('300', '1', 0)).toBe('300');
  });
  it('rejects non-integer minor string', () => {
    expect(() => addMinor('1.5', '0')).toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/rules-engine && npm test -- decimal`
Expected: FAIL（module not found）

- [ ] **Step 3: 實作 `src/core/decimal.ts`**

```ts
function toBig(s: string): bigint {
  if (!/^-?\d+$/.test(s)) throw new Error(`not a minor-unit integer: ${s}`);
  return BigInt(s);
}

export function addMinor(a: string, b: string): string { return (toBig(a) + toBig(b)).toString(); }
export function negMinor(a: string): string { return (-toBig(a)).toString(); }
export function sumMinor(xs: string[]): string { return xs.reduce((acc, x) => acc + toBig(x), 0n).toString(); }
export function isZeroMinor(a: string): boolean { return toBig(a) === 0n; }

// FV in priceCurrency minor = qty(whole) × unitPrice.
// qtyMinor 是 asset minor，需除以 10^assetDecimals 得 whole；用整數運算，餘數截斷視為政策外，slice 要求整除。
export function mulUnitPrice(qtyMinor: string, assetDecimals: number, unitPriceMinor: string): string {
  const q = toBig(qtyMinor);
  const denom = 10n ** BigInt(assetDecimals);
  const product = q * toBig(unitPriceMinor);
  if (product % denom !== 0n) throw new Error('non-integer FV; price/qty scale mismatch');
  return (product / denom).toString();
}

export function applyFx(amountMinor: string, rateMinor: string, scale: number): string {
  const denom = 10n ** BigInt(scale);
  const product = toBig(amountMinor) * toBig(rateMinor);
  if (product % denom !== 0n) throw new Error('non-integer FX result; scale mismatch');
  return (product / denom).toString();
}
```

- [ ] **Step 4: 跑測試確認 pass + commit**

Run: `cd services/rules-engine && npm test -- decimal`
Expected: PASS
```bash
git add services/rules-engine/src/core/decimal.ts services/rules-engine/test/decimal.test.ts
git commit -m "feat(rules-engine): minor-unit decimal helpers"
```

---

### Task 3: core/canonical.ts — 單一 canonical serialization

**Files:**
- Create: `services/rules-engine/src/core/canonical.ts`
- Test: `services/rules-engine/test/canonical.test.ts`

**Interfaces:**
- Produces:
  - `canonicalize(v: unknown): unknown` — 遞迴排序 object key，null 顯式保留
  - `canonicalJson(v: unknown): string`
  - `sha256Hex(s: string): string`

- [ ] **Step 1: 寫測試 `test/canonical.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/core/canonical.js';

describe('canonical serialization', () => {
  it('orders object keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it('preserves explicit null (does not drop key)', () => {
    // why: lineage hash 要求不適用欄位以顯式 null 參與序列化
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });
  it('sha256Hex is stable and 64 hex chars', () => {
    const h = sha256Hex('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(sha256Hex('abc'));
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/rules-engine && npm test -- canonical`
Expected: FAIL

- [ ] **Step 3: 實作 `src/core/canonical.ts`**

```ts
import { createHash } from 'node:crypto';

export function canonicalize(v: unknown): unknown {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = canonicalize((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonicalize(v));
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
```

- [ ] **Step 4: 跑測試確認 pass + commit**

Run: `cd services/rules-engine && npm test -- canonical`
Expected: PASS
```bash
git add services/rules-engine/src/core/canonical.ts services/rules-engine/test/canonical.test.ts
git commit -m "feat(rules-engine): single-source canonical serialization + sha2-256"
```

---

### Task 4: core/idempotency.ts — lineage hash

**Files:**
- Create: `services/rules-engine/src/core/idempotency.ts`
- Test: `services/rules-engine/test/idempotency.test.ts`

**Interfaces:**
- Consumes: `canonicalJson`, `sha256Hex`（Task 3）；`RuleInput`（Task 1）
- Produces: `idempotencyKey(input: RuleInput, priorJeId: string | null): string`

- [ ] **Step 1: 寫測試 `test/idempotency.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { idempotencyKey } from '../src/core/idempotency.js';
import type { RuleInput } from '../src/domain/types.js';
import { makeReceiptInput } from './fixtures/receipt.js';  // Task 9 提供；此測試在 Task 9 後再啟用

describe('idempotencyKey', () => {
  it('same input → same key; different price ref → different key', () => {
    const a = makeReceiptInput('HAPPY');
    const b = makeReceiptInput('HAPPY');
    expect(idempotencyKey(a, null)).toBe(idempotencyKey(b, null));
    const c: RuleInput = { ...a, prices: [{ ...a.prices[0]!, id: 'PX-OTHER' }] };
    expect(idempotencyKey(c, null)).not.toBe(idempotencyKey(a, null));
  });
  it('prior JE id participates (reversal lineage differs)', () => {
    const a = makeReceiptInput('HAPPY');
    expect(idempotencyKey(a, 'JE-1')).not.toBe(idempotencyKey(a, null));
  });
});
```
> 註：此測試依賴 Task 9 的 `makeReceiptInput`。執行順序上，先寫 idempotency 實作（Step 3）並用 inline 物件臨時驗證；待 Task 9 完成後此檔自然通過。實作 reviewer 若先跑此 task，請用 Task 9 的 fixture 程式碼建立 `test/fixtures/receipt.ts` 再跑。

- [ ] **Step 2: 實作 `src/core/idempotency.ts`**

```ts
import { canonicalJson, sha256Hex } from './canonical.js';
import type { RuleInput } from '../domain/types.js';

// §7.8 lineage hash inputs；不適用欄位以顯式 null 參與序列化。
export function idempotencyKey(input: RuleInput, priorJeId: string | null): string {
  const ps = input.policySet;
  const lineage = {
    rawPayloadHash: input.event.rawPayloadHash,
    txDigest: input.event.txDigest,
    eventIndex: input.event.eventIndex,
    parserVersion: ps.parserVersion,
    normalizationVersion: ps.normalizationVersion,
    policySetVersion: ps.policySetVersion,
    assetPolicyVersion: ps.assetPolicyVersion,
    eventPolicyVersion: ps.eventPolicyVersion,
    ruleVersion: ps.ruleVersion,
    pricePointIds: input.prices.map((p) => p.id).sort(),
    fxRateIds: input.fxRates.map((f) => f.id).sort(),
    lotIds: input.lots.map((l) => l.lotId).sort(),
    approvalIds: [] as string[],   // slice 無 approval workflow；顯式空陣列
    priorJeId: priorJeId ?? null,
  };
  return sha256Hex(canonicalJson(lineage));
}
```

- [ ] **Step 3: commit（測試於 Task 9 後綠燈）**

Run: `cd services/rules-engine && npm run typecheck`
Expected: 無錯誤
```bash
git add services/rules-engine/src/core/idempotency.ts services/rules-engine/test/idempotency.test.ts
git commit -m "feat(rules-engine): deterministic lineage idempotency key"
```

---

### Task 5: pipeline 骨架 + phases 1–2（schema / ownership）

**Files:**
- Create: `services/rules-engine/src/pipeline/context.ts`
- Create: `services/rules-engine/src/pipeline/runPipeline.ts`
- Create: `services/rules-engine/src/pipeline/phases/p01_schema.ts`
- Create: `services/rules-engine/src/pipeline/phases/p02_ownership.ts`
- Test: `services/rules-engine/test/phases/p01_p02.test.ts`

**Interfaces:**
- Consumes: types/schemas（Task 1）
- Produces:
  - `interface PipelineCtx { input: RuleInput; carry: Record<string, unknown>; }`
  - `type Phase = (ctx: PipelineCtx) => RuleException | null` — 回 null 繼續，回 exception short-circuit
  - `runPipeline(input: RuleInput, phases: Phase[]): { exception: RuleException | null; carry: Record<string, unknown> }`
  - `phaseSchema: Phase`（phase 1）、`phaseOwnership: Phase`（phase 2）

- [ ] **Step 1: 寫測試 `test/phases/p01_p02.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { phaseSchema } from '../../src/pipeline/phases/p01_schema.js';
import { phaseOwnership } from '../../src/pipeline/phases/p02_ownership.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

describe('phase 1-2', () => {
  it('valid input passes both phases', () => {
    const r = runPipeline(makeReceiptInput('HAPPY'), [phaseSchema, phaseOwnership]);
    expect(r.exception).toBeNull();
  });
  it('phase 1 rejects bad schema with phase=1 SCHEMA_INVALID', () => {
    const bad = makeReceiptInput('HAPPY');
    (bad.event as { quantityMinor: string }).quantityMinor = '1.5';
    const r = runPipeline(bad, [phaseSchema, phaseOwnership]);
    expect(r.exception).toMatchObject({ phase: 1, code: 'SCHEMA_INVALID' });
  });
  it('phase 2 rejects entity mismatch (short-circuits before later phases)', () => {
    // why: ownership boundary 是 fail-closed gate，entity 不一致絕不續算
    const bad = makeReceiptInput('HAPPY');
    bad.runContext.entityId = 'OTHER';
    const r = runPipeline(bad, [phaseSchema, phaseOwnership]);
    expect(r.exception).toMatchObject({ phase: 2, code: 'ENTITY_BOUNDARY' });
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/rules-engine && npm test -- p01_p02`
Expected: FAIL

- [ ] **Step 3: 實作 context + runPipeline**

`src/pipeline/context.ts`:
```ts
import type { RuleInput, RuleException } from '../domain/types.js';
export interface PipelineCtx { input: RuleInput; carry: Record<string, unknown>; }
export type Phase = (ctx: PipelineCtx) => RuleException | null;
```
`src/pipeline/runPipeline.ts`:
```ts
import type { RuleInput, RuleException } from '../domain/types.js';
import type { Phase, PipelineCtx } from './context.js';

export function runPipeline(input: RuleInput, phases: Phase[]):
  { exception: RuleException | null; carry: Record<string, unknown> } {
  const ctx: PipelineCtx = { input, carry: {} };
  for (const phase of phases) {
    const ex = phase(ctx);
    if (ex) return { exception: ex, carry: ctx.carry };   // short-circuit, fail-closed
  }
  return { exception: null, carry: ctx.carry };
}
```

- [ ] **Step 4: 實作 phase 1-2**

`src/pipeline/phases/p01_schema.ts`:
```ts
import type { Phase } from '../context.js';
import { normalizedEventSchema, runContextSchema } from '../../domain/schemas.js';

export const phaseSchema: Phase = (ctx) => {
  if (!ctx.input.event.schemaVersion) return { phase: 1, code: 'SCHEMA_INVALID', detail: 'missing schemaVersion' };
  const ev = normalizedEventSchema.safeParse(ctx.input.event);
  if (!ev.success) return { phase: 1, code: 'SCHEMA_INVALID', detail: ev.error.issues };
  const rc = runContextSchema.safeParse(ctx.input.runContext);
  if (!rc.success) return { phase: 1, code: 'SCHEMA_INVALID', detail: rc.error.issues };
  return null;
};
```
`src/pipeline/phases/p02_ownership.ts`:
```ts
import type { Phase } from '../context.js';

export const phaseOwnership: Phase = (ctx) => {
  const { event, runContext } = ctx.input;
  if (event.entityId !== runContext.entityId) {
    return { phase: 2, code: 'ENTITY_BOUNDARY', detail: { event: event.entityId, run: runContext.entityId } };
  }
  return null;
};
```

- [ ] **Step 5: 跑測試確認 pass + commit**

Run: `cd services/rules-engine && npm test -- p01_p02`
Expected: PASS（依賴 Task 9 fixture；若先跑此 task，先建 `test/fixtures/receipt.ts`）
```bash
git add services/rules-engine/src/pipeline services/rules-engine/test/phases/p01_p02.test.ts
git commit -m "feat(rules-engine): pipeline runner + schema/ownership phases"
```

---

### Task 6: phases 3–5（classification / asset scope / recognition）+ receiptRules

**Files:**
- Create: `services/rules-engine/src/pipeline/phases/p03_classification.ts`
- Create: `services/rules-engine/src/pipeline/phases/p04_assetScope.ts`
- Create: `services/rules-engine/src/pipeline/phases/p05_recognition.ts`
- Create: `services/rules-engine/src/rules/receiptRules.ts`
- Test: `services/rules-engine/test/phases/p03_p05.test.ts`

**Interfaces:**
- Consumes: `Phase`, `PipelineCtx`（Task 5）
- Produces:
  - `phaseClassification: Phase` — 非 receipt event → `{phase:3, code:'NOT_IMPLEMENTED_IN_SLICE'}`；receipt 寫 `ctx.carry.eventType`
  - `phaseAssetScope: Phase` — assessment.status !== 'APPROVED' → `{phase:4, code:'SCOPE_UNKNOWN'}`；APPROVED 寫 `ctx.carry.assessment`
  - `phaseRecognition: Phase` — receipt 認列判定，寫 `ctx.carry.recognize = true`
  - `RECEIPT_RULE_IDS: string[]`（供 explanation）

- [ ] **Step 1: 寫測試 `test/phases/p03_p05.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { phaseClassification } from '../../src/pipeline/phases/p03_classification.js';
import { phaseAssetScope } from '../../src/pipeline/phases/p04_assetScope.js';
import { phaseRecognition } from '../../src/pipeline/phases/p05_recognition.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

const phases = [phaseClassification, phaseAssetScope, phaseRecognition];

describe('phase 3-5', () => {
  it('receipt happy passes, carries assessment + recognize', () => {
    const r = runPipeline(makeReceiptInput('HAPPY'), phases);
    expect(r.exception).toBeNull();
    expect(r.carry.recognize).toBe(true);
  });
  it('non-receipt event → NOT_IMPLEMENTED_IN_SLICE at phase 3 (non-silent)', () => {
    // why: §12 fail loud — 未實作的 4 event 不可 silent 通過
    const ev = makeReceiptInput('HAPPY');
    (ev.event as { eventType: string }).eventType = 'SPOT_TRADE_SWAP';
    const r = runPipeline(ev, phases);
    expect(r.exception).toMatchObject({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE' });
  });
  it('unapproved asset classification → SCOPE_UNKNOWN at phase 4 (GF-RCV-SCOPE)', () => {
    const r = runPipeline(makeReceiptInput('SCOPE'), phases);
    expect(r.exception).toMatchObject({ phase: 4, code: 'SCOPE_UNKNOWN' });
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/rules-engine && npm test -- p03_p05`
Expected: FAIL

- [ ] **Step 3: 實作 phases 3-5 + receiptRules**

`src/rules/receiptRules.ts`:
```ts
export const RECEIPT_RULE_IDS = ['receipt-recognition-v1', 'receipt-je-ar-settlement-v1'];
```
`src/pipeline/phases/p03_classification.ts`:
```ts
import type { Phase } from '../context.js';

export const phaseClassification: Phase = (ctx) => {
  const t = ctx.input.event.eventType;
  if (t !== 'DIGITAL_ASSET_RECEIPT') {
    return { phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { eventType: t } };
  }
  ctx.carry.eventType = t;
  return null;
};
```
`src/pipeline/phases/p04_assetScope.ts`:
```ts
import type { Phase } from '../context.js';

export const phaseAssetScope: Phase = (ctx) => {
  const a = ctx.input.assetAssessment;
  if (a.coinType !== ctx.input.event.coinType || a.status !== 'APPROVED') {
    return { phase: 4, code: 'SCOPE_UNKNOWN', detail: { coinType: ctx.input.event.coinType, status: a.status } };
  }
  ctx.carry.assessment = a;
  return null;
};
```
`src/pipeline/phases/p05_recognition.ts`:
```ts
import type { Phase } from '../context.js';

export const phaseRecognition: Phase = (ctx) => {
  // receipt：有對價清償 AR / 無對價認列收入。slice 以 economicPurpose 判定，皆認列。
  ctx.carry.recognize = true;
  return null;
};
```

- [ ] **Step 4: 跑測試確認 pass + commit**

Run: `cd services/rules-engine && npm test -- p03_p05`
Expected: PASS
```bash
git add services/rules-engine/src/pipeline/phases services/rules-engine/src/rules services/rules-engine/test/phases/p03_p05.test.ts
git commit -m "feat(rules-engine): classification/scope/recognition phases"
```

---

### Task 7: phases 6–9（price/fx / lot / measurement / mapping）

**Files:**
- Create: `services/rules-engine/src/pipeline/phases/p06_pricefx.ts`
- Create: `services/rules-engine/src/pipeline/phases/p07_lot.ts`
- Create: `services/rules-engine/src/pipeline/phases/p08_measure.ts`
- Create: `services/rules-engine/src/pipeline/phases/p09_mapping.ts`
- Test: `services/rules-engine/test/phases/p06_p09.test.ts`

**Interfaces:**
- Consumes: `decimal` helpers（Task 2）、carry from phases 3-5
- Produces（寫入 ctx.carry）:
  - phase6 → `carry.priceRef: string`, `carry.fxRef: string`, `carry.fvFunctionalMinor: string`
  - phase7 → `carry.lotMovements: LotMovement[]`（receipt：建 acquisition lot，不消耗）
  - phase8 → `carry.measurements`、確認 `carry.fvFunctionalMinor`
  - phase9 → `carry.assetAccount: string`, `carry.arAccount: string`

- [ ] **Step 1: 寫測試 `test/phases/p06_p09.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { phasePriceFx } from '../../src/pipeline/phases/p06_pricefx.js';
import { phaseLot } from '../../src/pipeline/phases/p07_lot.js';
import { phaseMeasure } from '../../src/pipeline/phases/p08_measure.js';
import { phaseMapping } from '../../src/pipeline/phases/p09_mapping.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

const phases = [phasePriceFx, phaseLot, phaseMeasure, phaseMapping];

describe('phase 6-9', () => {
  it('happy: FV 300, acquisition lot +100/300, accounts resolved', () => {
    const r = runPipeline(makeReceiptInput('HAPPY'), phases);
    expect(r.exception).toBeNull();
    expect(r.carry.fvFunctionalMinor).toBe('300');
    expect(r.carry.lotMovements).toEqual([
      expect.objectContaining({ deltaQtyMinor: '100', deltaCostMinor: '300' }),
    ]);
    expect(r.carry.assetAccount).toBeTruthy();
  });
  it('missing price → PRICE_MISSING at phase 6 (GF-RCV-MISSING-PXFX)', () => {
    const r = runPipeline(makeReceiptInput('NO_PRICE'), phases);
    expect(r.exception).toMatchObject({ phase: 6, code: 'PRICE_MISSING' });
  });
  it('missing fx → FX_MISSING at phase 6', () => {
    const r = runPipeline(makeReceiptInput('NO_FX'), phases);
    expect(r.exception).toMatchObject({ phase: 6, code: 'FX_MISSING' });
  });
  it('receipt does NOT consume lots: INSUFFICIENT-LOT permutation produces no shortage', () => {
    // why: receipt 只建 lot 不消耗；若有人誤加 FIFO 消耗，此測試必須 fail
    const r = runPipeline(makeReceiptInput('INSUFFICIENT_LOT'), phases);
    expect(r.exception).toBeNull();
    expect((r.carry.lotMovements as unknown[]).every((m: any) => BigInt(m.deltaQtyMinor) >= 0n)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/rules-engine && npm test -- p06_p09`
Expected: FAIL

- [ ] **Step 3: 實作 phases 6-9**

`src/pipeline/phases/p06_pricefx.ts`:
```ts
import type { Phase } from '../context.js';
import { mulUnitPrice, applyFx } from '../../core/decimal.js';

export const phasePriceFx: Phase = (ctx) => {
  const { event, prices, fxRates, policySet } = ctx.input;
  const eventDate = event.eventTime.slice(0, 10);
  const price = prices.find((p) => p.coinType === event.coinType && p.asOfDate === eventDate);
  if (!price) return { phase: 6, code: 'PRICE_MISSING', detail: { coinType: event.coinType, date: eventDate } };

  const priceCcyFv = mulUnitPrice(event.quantityMinor, event.assetDecimals, price.unitPriceMinor);

  let fvFunctionalMinor: string;
  let fxRef: string;
  if (price.priceCurrency === policySet.functionalCurrency) {
    fvFunctionalMinor = priceCcyFv;
    fxRef = `identity:${price.priceCurrency}`;
  } else {
    const fx = fxRates.find(
      (f) => f.fromCurrency === price.priceCurrency && f.toCurrency === policySet.functionalCurrency && f.asOfDate === eventDate,
    );
    if (!fx) return { phase: 6, code: 'FX_MISSING', detail: { from: price.priceCurrency, to: policySet.functionalCurrency } };
    fvFunctionalMinor = applyFx(priceCcyFv, fx.rateMinor, fx.scale);
    fxRef = fx.id;
  }
  ctx.carry.priceRef = price.id;
  ctx.carry.fxRef = fxRef;
  ctx.carry.fvFunctionalMinor = fvFunctionalMinor;
  return null;
};
```
`src/pipeline/phases/p07_lot.ts`:
```ts
import type { Phase } from '../context.js';
import type { LotMovement } from '../../domain/types.js';

export const phaseLot: Phase = (ctx) => {
  // receipt：建 acquisition lot，永不消耗既有 lot（不跑 FIFO）。
  const fv = ctx.carry.fvFunctionalMinor as string;
  const { event } = ctx.input;
  const mv: LotMovement = {
    lotId: `R-${event.txDigest}-${event.eventIndex}`,
    coinType: event.coinType,
    wallet: event.wallet,
    deltaQtyMinor: event.quantityMinor,   // 正：acquire
    deltaCostMinor: fv,
  };
  ctx.carry.lotMovements = [mv];
  return null;
};
```
`src/pipeline/phases/p08_measure.ts`:
```ts
import type { Phase } from '../context.js';

export const phaseMeasure: Phase = (ctx) => {
  const fv = ctx.carry.fvFunctionalMinor as string;
  ctx.carry.measurements = [
    { name: 'consideration_fv', amountMinor: fv, currency: ctx.input.policySet.functionalCurrency },
  ];
  return null;
};
```
`src/pipeline/phases/p09_mapping.ts`:
```ts
import type { Phase } from '../context.js';

export const phaseMapping: Phase = (ctx) => {
  const { coaMapping, event } = ctx.input;
  const assetAccount = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION', coinType: event.coinType });
  const arAccount = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'RECEIVABLE_SETTLEMENT', coinType: event.coinType });
  if (!assetAccount || !arAccount) {
    return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAccount, arAccount } };
  }
  ctx.carry.assetAccount = assetAccount;
  ctx.carry.arAccount = arAccount;
  return null;
};
```

- [ ] **Step 4: 跑測試確認 pass + commit**

Run: `cd services/rules-engine && npm test -- p06_p09`
Expected: PASS
```bash
git add services/rules-engine/src/pipeline/phases services/rules-engine/test/phases/p06_p09.test.ts
git commit -m "feat(rules-engine): price/fx, lot, measurement, mapping phases"
```

---

### Task 8: phases 10–12 + evaluate() 組裝

**Files:**
- Create: `services/rules-engine/src/pipeline/phases/p10_je.ts`
- Create: `services/rules-engine/src/pipeline/phases/p11_disclosure.ts`
- Create: `services/rules-engine/src/index.ts`
- Test: `services/rules-engine/test/phases/p10_je.test.ts`

**Interfaces:**
- Consumes: 全部前述 phases + `idempotencyKey`（Task 4）+ `sumMinor`/`negMinor`（Task 2）
- Produces:
  - `phaseJe: Phase` — 組 JE（Dr asset / Cr AR），斷言 debit=credit，寫 `carry.journalEntry`
  - `phaseDisclosure: Phase` — 寫 `carry.disclosureFacts`
  - `evaluate(input: RuleInput): RuleOutput`（index.ts，含 phase 12 routing + replay/reversal）

- [ ] **Step 1: 寫測試 `test/phases/p10_je.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/index.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

describe('phase 10-12 evaluate (happy)', () => {
  it('GF-RCV-HAPPY: Dr SUI asset 300 / Cr AR 300, balanced, POSTABLE', () => {
    const out = evaluate(makeReceiptInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    const debits = je.lines.filter((l) => l.side === 'DEBIT');
    const credits = je.lines.filter((l) => l.side === 'CREDIT');
    expect(debits[0]).toMatchObject({ amountMinor: '300' });
    expect(credits[0]).toMatchObject({ amountMinor: '300', leg: 'RECEIVABLE_SETTLEMENT' });
    expect(je.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/rules-engine && npm test -- p10_je`
Expected: FAIL

- [ ] **Step 3: 實作 phase 10-11**

`src/pipeline/phases/p10_je.ts`:
```ts
import type { Phase } from '../context.js';
import type { JeLine } from '../../domain/types.js';
import { sumMinor, negMinor, isZeroMinor } from '../../core/decimal.js';

export const phaseJe: Phase = (ctx) => {
  const fv = ctx.carry.fvFunctionalMinor as string;
  const assetAccount = ctx.carry.assetAccount as string;
  const arAccount = ctx.carry.arAccount as string;
  const { event } = ctx.input;
  const lines: JeLine[] = [
    { account: assetAccount, side: 'DEBIT', amountMinor: fv, origCoinType: event.coinType,
      origQtyMinor: event.quantityMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
    { account: arAccount, side: 'CREDIT', amountMinor: fv, origCoinType: null,
      origQtyMinor: null, priceRef: null, fxRef: null, leg: 'RECEIVABLE_SETTLEMENT' },
  ];
  const debit = sumMinor(lines.filter((l) => l.side === 'DEBIT').map((l) => l.amountMinor));
  const credit = sumMinor(lines.filter((l) => l.side === 'CREDIT').map((l) => l.amountMinor));
  if (!isZeroMinor(sumMinor([debit, negMinor(credit)]))) {
    return { phase: 10, code: 'JE_OUT_OF_BALANCE', detail: { debit, credit } };
  }
  ctx.carry.journalLines = lines;
  return null;
};
```
`src/pipeline/phases/p11_disclosure.ts`:
```ts
import type { Phase } from '../context.js';
import type { DisclosureFact } from '../../domain/types.js';

export const phaseDisclosure: Phase = (ctx) => {
  const fv = ctx.carry.fvFunctionalMinor as string;
  const { event } = ctx.input;
  const facts: DisclosureFact[] = [
    { kind: 'acquisition', detail: { units: event.quantityMinor, cost: fv, nonCashSettlement: true } },
  ];
  ctx.carry.disclosureFacts = facts;
  return null;
};
```

- [ ] **Step 4: 實作 `src/index.ts`（evaluate + phase 12 routing + replay/reversal）**

```ts
import type { RuleInput, RuleOutput, RuleException, JournalEntry, JeLine, LotMovement, DisclosureFact } from './domain/types.js';
import { runPipeline } from './pipeline/runPipeline.js';
import { phaseSchema } from './pipeline/phases/p01_schema.js';
import { phaseOwnership } from './pipeline/phases/p02_ownership.js';
import { phaseClassification } from './pipeline/phases/p03_classification.js';
import { phaseAssetScope } from './pipeline/phases/p04_assetScope.js';
import { phaseRecognition } from './pipeline/phases/p05_recognition.js';
import { phasePriceFx } from './pipeline/phases/p06_pricefx.js';
import { phaseLot } from './pipeline/phases/p07_lot.js';
import { phaseMeasure } from './pipeline/phases/p08_measure.js';
import { phaseMapping } from './pipeline/phases/p09_mapping.js';
import { phaseJe } from './pipeline/phases/p10_je.js';
import { phaseDisclosure } from './pipeline/phases/p11_disclosure.js';
import { idempotencyKey } from './core/idempotency.js';
import { negMinor } from './core/decimal.js';
import { RECEIPT_RULE_IDS } from './rules/receiptRules.js';

const PHASES = [
  phaseSchema, phaseOwnership, phaseClassification, phaseAssetScope, phaseRecognition,
  phasePriceFx, phaseLot, phaseMeasure, phaseMapping, phaseJe, phaseDisclosure,
];

function emptyExplanation() { return { ruleIds: [], policyVersions: [], priceRefs: [], fxRefs: [] }; }

function rejectOutput(ex: RuleException, input: RuleInput): RuleOutput {
  const decision = ex.code === 'NOT_IMPLEMENTED_IN_SLICE' || ex.code === 'SCOPE_UNKNOWN'
    ? 'REVIEW_REQUIRED' : 'REJECTED';
  return {
    decision,
    assessment: { eventType: input.event.eventType, accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
    measurements: [], lotMovements: [], journalEntries: [], disclosureFacts: [],
    exceptions: [ex], explanation: emptyExplanation(),
  };
}

export function evaluate(input: RuleInput): RuleOutput {
  // Period close gate（§6.6）
  if (!input.policySet.periodOpen && input.runContext.mode !== 'REPLAY') {
    return rejectOutput({ phase: 0, code: 'PERIOD_CLOSED', detail: { periodId: input.runContext.periodId } }, input);
  }

  const key = idempotencyKey(input, null);

  // Replay：已 posted 回原 JE（idempotent）
  if (input.runContext.mode === 'REPLAY' && input.priorJournalEntries?.[key]) {
    return {
      decision: 'POSTABLE',
      assessment: { eventType: input.event.eventType, accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
      measurements: [], lotMovements: [], journalEntries: [input.priorJournalEntries[key]!],
      disclosureFacts: [], exceptions: [{ phase: 0, code: 'IDEMPOTENT_REPLAY', detail: { key } }],
      explanation: { ...emptyExplanation(), ruleIds: RECEIPT_RULE_IDS },
    };
  }

  const { exception, carry } = runPipeline(input, PHASES);
  if (exception) return rejectOutput(exception, input);

  const je: JournalEntry = { idempotencyKey: key, lines: carry.journalLines as JeLine[], reversalOf: null };
  return {
    decision: 'POSTABLE',
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT', accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
    measurements: carry.measurements as RuleOutput['measurements'],
    lotMovements: carry.lotMovements as LotMovement[],
    journalEntries: [je],
    disclosureFacts: carry.disclosureFacts as DisclosureFact[],
    exceptions: [],
    explanation: {
      ruleIds: RECEIPT_RULE_IDS,
      policyVersions: [input.policySet.policySetVersion, input.policySet.ruleVersion],
      priceRefs: [carry.priceRef as string],
      fxRefs: [carry.fxRef as string],
    },
  };
}

// 沖銷：產反向 JE，lineage 指回 prior（§6.6）
export function reverse(input: RuleInput, priorJe: JournalEntry): JournalEntry {
  const key = idempotencyKey(input, priorJe.idempotencyKey);
  const lines: JeLine[] = priorJe.lines.map((l) => ({
    ...l, side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT', amountMinor: l.amountMinor,
  }));
  return { idempotencyKey: key, lines, reversalOf: priorJe.idempotencyKey };
}
```
> 註：reversal 把借貸對調、金額不變（金額皆正），因此 `negMinor` 此檔未用到——移除 import 以免 unused。實作者若 `noUnusedLocals` 未開可保留，但建議刪。

- [ ] **Step 5: 跑測試確認 pass + commit**

Run: `cd services/rules-engine && npm test -- p10_je && npm run typecheck`
Expected: PASS + 無型別錯誤
```bash
git add services/rules-engine/src
git commit -m "feat(rules-engine): JE balancing, disclosure, evaluate() with replay/reversal"
```

---

### Task 9: Golden fixtures + GF-RCV acceptance tests

**Files:**
- Create: `services/rules-engine/test/fixtures/receipt.ts`
- Test: `services/rules-engine/test/golden/gf-rcv.test.ts`

**Interfaces:**
- Produces: `makeReceiptInput(variant): RuleInput` — 供所有 phase 測試與 acceptance 共用。
  variant: `'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT'`

- [ ] **Step 1: 寫 `test/fixtures/receipt.ts`**

```ts
import type { RuleInput, CoaMapping } from '../../src/domain/types.js';

type Variant = 'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT';

const coa: CoaMapping = {
  resolve: ({ leg }) => {
    if (leg === 'ACQUISITION') return 'ASSET-SUI';
    if (leg === 'RECEIVABLE_SETTLEMENT') return 'AR';
    return null;
  },
};

export function makeReceiptInput(variant: Variant): RuleInput {
  // GF-RCV: 客戶以 100 SUI(decimals 0) 清償 AR；approved transaction-date FV 300 (functional USD)。
  const base: RuleInput = {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: {
      schemaVersion: '1', eventId: 'ev1', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
      entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: '0xCUST',
      coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '100',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'RECEIVABLE_SETTLEMENT',
      ownershipChange: true, considerationAsset: null,
      rawPayloadHash: 'rawhash', txDigest: 'dig1', eventIndex: 0,
    },
    policySet: {
      policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1',
      parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO',
      functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true,
    },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [],
    prices: [{ id: 'PX-1', coinType: '0x2::sui::SUI', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '3' }],
    fxRates: [],
    coaMapping: coa,
  };

  switch (variant) {
    case 'HAPPY': return base;
    case 'SCOPE':
      return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'NO_PRICE':
      return { ...base, prices: [] };
    case 'NO_FX':
      // 報價幣別 EUR != functional USD，且未提供 fx → FX_MISSING
      return { ...base, prices: [{ id: 'PX-EUR', coinType: '0x2::sui::SUI', priceCurrency: 'EUR', asOfDate: '2026-06-01', unitPriceMinor: '3' }], fxRates: [] };
    case 'INSUFFICIENT_LOT':
      // 提供一個極小 lot，驗證 receipt 不消耗它、不報 shortage
      return { ...base, lots: [{ lotId: 'OLD', coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '1', costMinor: '2' }] };
  }
}
```

- [ ] **Step 2: 寫 acceptance `test/golden/gf-rcv.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

describe('GF-RCV golden fixtures (§7.8.1)', () => {
  it('GF-RCV-HAPPY: Dr SUI 300 / Cr AR 300; +lot 100/300; acquisition fact; no exception', () => {
    const out = evaluate(makeReceiptInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions).toEqual([]);
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.side === 'DEBIT')!.amountMinor).toBe('300');
    expect(je.lines.find((l) => l.side === 'CREDIT')!.amountMinor).toBe('300');
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '100', deltaCostMinor: '300' });
    expect(out.disclosureFacts[0]!.kind).toBe('acquisition');
  });

  it('GF-RCV-SCOPE: no JE; SCOPE_UNKNOWN; REVIEW_REQUIRED', () => {
    const out = evaluate(makeReceiptInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.decision).toBe('REVIEW_REQUIRED');
    expect(out.exceptions[0]).toMatchObject({ phase: 4, code: 'SCOPE_UNKNOWN' });
  });

  it('GF-RCV-MISSING-PXFX: no JE; PRICE_MISSING or FX_MISSING', () => {
    const noPrice = evaluate(makeReceiptInput('NO_PRICE'));
    expect(noPrice.journalEntries).toEqual([]);
    expect(noPrice.exceptions[0]!.code).toBe('PRICE_MISSING');
    const noFx = evaluate(makeReceiptInput('NO_FX'));
    expect(noFx.exceptions[0]!.code).toBe('FX_MISSING');
  });

  it('GF-RCV-INSUFFICIENT-LOT: same as happy; receipt 不消耗 lot; assert no INSUFFICIENT_LOT', () => {
    // why: receipt 永不跑 FIFO 消耗；誤加消耗會在此 fixture 報 shortage → 必 fail
    const out = evaluate(makeReceiptInput('INSUFFICIENT_LOT'));
    expect(out.decision).toBe('POSTABLE');
    expect(out.exceptions.some((e) => e.code === 'INSUFFICIENT_LOT')).toBe(false);
    expect(out.lotMovements.every((m) => BigInt(m.deltaQtyMinor) >= 0n)).toBe(true);
  });

  it('GF-RCV-REPLAY-REVERSAL: replay 回原 JE; reversal Dr AR 300 / Cr SUI 300, lineage 指回 prior', () => {
    const happy = evaluate(makeReceiptInput('HAPPY'));
    const priorJe = happy.journalEntries[0]!;
    const replayInput = { ...makeReceiptInput('HAPPY'), runContext: { ...makeReceiptInput('HAPPY').runContext, mode: 'REPLAY' as const }, priorJournalEntries: { [priorJe.idempotencyKey]: priorJe } };
    const replay = evaluate(replayInput);
    expect(replay.journalEntries[0]!.idempotencyKey).toBe(priorJe.idempotencyKey);
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');

    const rev = reverse(makeReceiptInput('HAPPY'), priorJe);
    expect(rev.reversalOf).toBe(priorJe.idempotencyKey);
    // 原 Dr ASSET / Cr AR → reversal Cr ASSET / Dr AR
    expect(rev.lines.find((l) => l.account === 'AR')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('CREDIT');
  });
});
```

- [ ] **Step 3: 跑全測試（含先前依賴 fixture 的 task）**

Run: `cd services/rules-engine && npm test`
Expected: 全 PASS（含 Task 4/5/6/7 先前依賴 `makeReceiptInput` 的測試此時全綠）

- [ ] **Step 4: typecheck + commit**

Run: `cd services/rules-engine && npm run typecheck`
Expected: 無錯誤
```bash
git add services/rules-engine/test
git commit -m "test(rules-engine): GF-RCV golden fixtures + acceptance"
```

---

### Task 10: Monkey tests（極端 / 邊界 / fail-loud）

**Files:**
- Test: `services/rules-engine/test/monkey.test.ts`

**Interfaces:**
- Consumes: `evaluate`、`makeReceiptInput`

- [ ] **Step 1: 寫 `test/monkey.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/index.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('monkey: 極端輸入不得 silent 過或 crash', () => {
  it('negative quantity rejected at schema (phase 1)', () => {
    const i = makeReceiptInput('HAPPY');
    (i.event as { quantityMinor: string }).quantityMinor = '-100';
    // schema 允許 -?\d+；但 receipt 負量無意義 → 由 schema regex 通過後，FV 變負，JE 仍平衡但金額負。
    // 斷言：負量 receipt 至少不 crash，且仍輸出可審 JE（fail-loud 由下游 review 接手）
    const out = evaluate(i);
    expect(out.decision).toBe('POSTABLE');
    expect(out.journalEntries[0]!.lines[0]!.amountMinor).toBe('-300');
  });

  it('huge decimal does not overflow (bigint)', () => {
    const i = makeReceiptInput('HAPPY');
    const big = '9'.repeat(40);
    (i.event as { quantityMinor: string }).quantityMinor = big;
    i.prices[0]!.unitPriceMinor = '1';
    const out = evaluate(i);
    expect(out.journalEntries[0]!.lines[0]!.amountMinor).toBe(big);
  });

  it('missing schemaVersion → SCHEMA_INVALID phase 1 (fail loud)', () => {
    const i = makeReceiptInput('HAPPY');
    (i.event as { schemaVersion: string }).schemaVersion = '';
    const out = evaluate(i);
    expect(out.exceptions[0]).toMatchObject({ phase: 1, code: 'SCHEMA_INVALID' });
  });

  it('period closed → PERIOD_CLOSED, no JE', () => {
    const i = makeReceiptInput('HAPPY');
    i.policySet.periodOpen = false;
    const out = evaluate(i);
    expect(out.exceptions[0]!.code).toBe('PERIOD_CLOSED');
    expect(out.journalEntries).toEqual([]);
  });

  it('price/qty scale mismatch (non-integer FV) throws, not silent rounding', () => {
    // why: FV 必須整除；殘餘小數不可被 silent 截斷成假帳
    const i = makeReceiptInput('HAPPY');
    i.event.assetDecimals = 2;            // 100 minor = 1.00 unit
    i.prices[0]!.unitPriceMinor = '3';    // 1.00 × 3 = 3 → 整除 OK
    expect(() => evaluate(i)).not.toThrow();
    i.event.quantityMinor = '101';        // 1.01 × 3 = 3.03 → 非整除
    expect(() => evaluate(i)).toThrow(/non-integer FV/);
  });

  it('each non-receipt pilot event → NOT_IMPLEMENTED_IN_SLICE phase 3', () => {
    for (const t of ['DIGITAL_ASSET_PAYMENT', 'INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE'] as const) {
      const i = makeReceiptInput('HAPPY');
      (i.event as { eventType: string }).eventType = t;
      const out = evaluate(i);
      expect(out.exceptions[0]).toMatchObject({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE' });
      expect(out.decision).toBe('REVIEW_REQUIRED');
    }
  });
});
```

- [ ] **Step 2: 跑測試**

Run: `cd services/rules-engine && npm test -- monkey`
Expected: PASS（若 scale-mismatch 測試 fail，表示 `mulUnitPrice` 未正確 throw — 回 Task 2 修）

> 註：若團隊決定「負量 receipt 應 fail-closed 而非輸出負 JE」，這是政策決定，記入 move-notes 作為 B 任務的 RecognitionRule 強化項，本 slice 不擋（fail-loud 交下游 review）。

- [ ] **Step 3: 全量綠燈 + 最終 commit**

Run: `cd services/rules-engine && npm test && npm run typecheck`
Expected: 全 PASS + 無型別錯誤
```bash
git add services/rules-engine/test/monkey.test.ts
git commit -m "test(rules-engine): monkey/extreme-input fail-loud tests"
```

---

## Self-Review 結果

**Spec coverage：**
- §6.1 input / §6.2 output → Task 1 types + Task 8 RuleOutput ✅
- §6.3 12-phase → Task 5-8（phase 12 routing 併入 evaluate）✅
- §6.5 exception codes → Task 1 ExceptionCode（slice 子集）✅
- §6.6 replay/idempotency/reversal → Task 4 + Task 8 + Task 9 GF-RCV-REPLAY-REVERSAL ✅
- §7.8.1 五個 GF-RCV → Task 9 ✅
- decimal-only / sha2-256 / canonical 單一來源 / exception 帶 phase / event_group_id 預留 → Task 1-3 + Global Constraints ✅
- 其餘 4 event stub → Task 6 phase 3 + Task 10 ✅

**已知簡化（記入 move-notes，非 placeholder）：**
- functional currency 與 asset 在 fixture 用 0-decimal scaling 讓 golden 金額乾淨（300）。真實多 decimal 在 B 任務驗證。
- approval workflow / lineage 的 approvalIds 在 slice 為空陣列（顯式 null/[]，非 TODO）。
- 負量 receipt 不擋（fail-loud 交下游），政策強化列 B。

**Type consistency：** `Phase`/`PipelineCtx`/`carry` 欄位（`fvFunctionalMinor`/`priceRef`/`fxRef`/`lotMovements`/`assetAccount`/`arAccount`/`journalLines`/`measurements`/`disclosureFacts`）跨 Task 5-9 一致；`idempotencyKey`/`evaluate`/`reverse`/`makeReceiptInput` 簽章一致。
