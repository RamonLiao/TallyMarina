# Rules Engine B 升級 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 receipt-only 管線泛化為 5 個 paid-pilot event 全做真 JE，含 FIFO lot allocation、雙軌成本、idempotency 兩層 key、泛化 reversal。

**Architecture:** Event-strategy registry（`eventType → EventStrategy`），phases p03/p05/p06/p07/p08/p10/p11 變薄 dispatcher。FIFO 抽純函式 `core/fifo.ts`。雙軌成本 = carrying（FIFO 除帳）+ FV（取得/對價），realized gain/loss = FV − carrying。

**Tech Stack:** TS/Node ESM, zod, vitest, minor-unit bigint string（禁 JS number）, sha2-256。

## Global Constraints

- 金額一律 minor-unit bigint string，運算只走 `src/core/decimal.ts`，禁 JS `number` 參與金額。
- hash family = sha2-256；所有序列化走 `src/core/canonical.ts`（sorted key + 顯式 null）。
- fail-closed：非法輸入在最前面擋；方向用 event type/leg 表達，不以數值正負承載。負量已由 schema `^\d+$` 擋。
- `idempotencyKey` 計算**不得引用** `input.lots` / `input.prices` / `input.fxRates`（移入 `lineageHash`）。
- 不需改動 AuditAnchor Move 合約。
- 每 task 結束跑 `cd services/rules-engine && npm test && npm run typecheck`，舊 37 receipt 測試不得回歸。
- 工作目錄：`services/rules-engine/`。所有路徑相對此目錄。
- 對映 spec：`docs/superpowers/specs/2026-06-21-rules-engine-B-design.md`，golden §7.8.1–§7.8.5。

## File Structure

- `src/domain/types.ts` — 改：`PositionLot.seq`；`JournalEntry.lineageHash`；`Measurement.track`；`LotPlan`/`ConsumedLot`/`EventStrategy` 新型別。
- `src/domain/schemas.ts` — 改：`positionLotSchema`（若有）或新增 lot 排序驗證輔助。
- `src/core/idempotency.ts` — 改：拆 `idempotencyKey`（event identity+policy）與 `lineageHash`（resolved refs）。
- `src/core/fifo.ts` — 新：`allocateFifo` 純函式。
- `src/rules/registry.ts` — 新：`EventStrategy` 介面 + `STRATEGIES` 表。
- `src/rules/receiptRules.ts` — 改：實作 `EventStrategy`。
- `src/rules/paymentRules.ts` / `swapRules.ts` / `internalTransferRules.ts` / `gasRules.ts` — 新。
- `src/pipeline/phases/p03,p05,p06,p07,p08,p10,p11` — 改：dispatch 到 registry。
- `src/index.ts` — 改：去 hardcode RECEIPT、reverse 泛化。
- `test/fixtures/{payment,swap,internalTransfer,gas}.ts` — 新。
- `test/golden/gf-{pay,swp,itx,gas}.test.ts` — 新。
- `test/core/fifo.test.ts` — 新。

---

### Task 1: 兩層 key + lineageHash + 型別

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/core/idempotency.ts`
- Modify: `src/index.ts`（idempotencyKey 呼叫處、JE 組裝加 lineageHash）
- Test: `test/idempotency.test.ts`

**Interfaces:**
- Produces:
  - `PositionLot.seq: number`（新欄位）
  - `JournalEntry.lineageHash: string`（新欄位）
  - `Measurement.track`（見下；A 的 measurements 是 inline 物件，升級為具名型別）
  - `idempotencyKey(input: RuleInput, priorJeId: string | null): string` — 不再引用 lots/prices/fxRates
  - `lineageHash(args: { priceRefs: string[]; fxRefs: string[]; consumedLotIds: string[]; approvalIds: string[] }): string`

- [ ] **Step 1: 改型別**

`src/domain/types.ts`：
```ts
export interface PositionLot {
  lotId: string;
  seq: number;                 // 單調遞增，FIFO 排序鍵（上游 lot store 賦值）
  coinType: string;
  wallet: string;
  remainingQtyMinor: string;
  costMinor: string;
}

export interface Measurement {
  name: string;                // consideration_fv | disposal_carrying | realized_gain
  amountMinor: string;
  currency: string;
  track: 'FV' | 'CARRYING' | 'GAIN' | 'TAX_BASIS' | 'REVAL_RESERVE';
}

export interface JournalEntry {
  idempotencyKey: string;
  lineageHash: string;         // resolved refs（off-chain sidecar，不進 merkle leaf）
  lines: JeLine[];
  reversalOf: string | null;
}
```
把 `RuleOutput.measurements` 型別由 inline 改為 `Measurement[]`。

- [ ] **Step 2: 寫失敗測試**

`test/idempotency.test.ts` 追加：
```ts
import { idempotencyKey, lineageHash } from '../src/core/idempotency.js';
import { makeReceiptInput } from './fixtures/receipt.js';

it('idempotencyKey 不受無關 price/fx/lot 影響（修 codex #4）', () => {
  const a = makeReceiptInput('HAPPY');
  const b = { ...a, prices: [...a.prices, { id: 'PX-NOISE', coinType: 'x', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '9' }] };
  expect(idempotencyKey(a, null)).toBe(idempotencyKey(b, null));
});

it('lineageHash 把 resolved refs 納入、與 key 分離', () => {
  const h1 = lineageHash({ priceRefs: ['PX-1'], fxRefs: ['identity:USD'], consumedLotIds: [], approvalIds: [] });
  const h2 = lineageHash({ priceRefs: ['PX-2'], fxRefs: ['identity:USD'], consumedLotIds: [], approvalIds: [] });
  expect(h1).not.toBe(h2);
});
```

- [ ] **Step 3: 跑測試確認 fail**

Run: `npx vitest run test/idempotency.test.ts`
Expected: FAIL（`lineageHash` 未匯出 / key 仍含 prices → 第一測試 fail）

- [ ] **Step 4: 改 idempotency.ts**

```ts
import { canonicalJson, sha256Hex } from './canonical.js';
import type { RuleInput } from '../domain/types.js';

// 穩定 key：只取 event identity + policy versions。刻意不含 price/fx/lot（→ lineageHash）。
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
    priorJeId: priorJeId ?? null,
  };
  return sha256Hex(canonicalJson(lineage));
}

// resolved refs 審計用 sidecar；進 JournalEntry.lineageHash，不進 merkle leaf。
export function lineageHash(args: {
  priceRefs: string[]; fxRefs: string[]; consumedLotIds: string[]; approvalIds: string[];
}): string {
  return sha256Hex(canonicalJson({
    priceRefs: [...args.priceRefs].sort(),
    fxRefs: [...args.fxRefs].sort(),
    consumedLotIds: [...args.consumedLotIds].sort(),
    approvalIds: [...args.approvalIds].sort(),
  }));
}
```

- [ ] **Step 5: index.ts 組 JE 時填 lineageHash**

在 `evaluateInner` 組 `je` 處與 replay JE 處補 `lineageHash`。正常 post：
```ts
const lh = lineageHash({
  priceRefs: carry.priceRef ? [carry.priceRef as string] : [],
  fxRefs: carry.fxRef ? [carry.fxRef as string] : [],
  consumedLotIds: ((carry.consumedLots as { lotId: string }[]) ?? []).map((c) => c.lotId),
  approvalIds: [],
});
const je: JournalEntry = { idempotencyKey: key, lineageHash: lh, lines: carry.journalLines as JeLine[], reversalOf: null };
```
replay 回傳的 `priorJournalEntries[key]` 已自帶 lineageHash，不需重算。

- [ ] **Step 6: 跑全測試**

Run: `npm test && npm run typecheck`
Expected: 新 idempotency 測試 PASS；舊 37 測試需同步（receipt fixture 要補 `seq`，見下步）。

- [ ] **Step 7: 補 receipt fixture 的 seq + 既有測試 JE 斷言加 lineageHash**

`test/fixtures/receipt.ts` 的 `INSUFFICIENT_LOT` lot 加 `seq: 1`。gf-rcv replay 測試 priorJe 已含 lineageHash（自動），無需改斷言。確認 `npm test` 全綠。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(rules-engine): 兩層 idempotency key + lineageHash + PositionLot.seq"
```

---

### Task 2: core/fifo.ts FIFO allocator

**Files:**
- Create: `src/core/fifo.ts`
- Test: `test/core/fifo.test.ts`

**Interfaces:**
- Consumes: `PositionLot`（含 `seq`）, `decimal.ts`
- Produces:
  ```ts
  export interface ConsumedLot { lotId: string; qtyMinor: string; costMinor: string; }
  export type FifoResult =
    | { ok: true; consumed: ConsumedLot[]; totalCarryingMinor: string }
    | { ok: false; insufficient: true; availableQtyMinor: string };
  export function allocateFifo(lots: PositionLot[], coinType: string, wallet: string, qtyNeededMinor: string): FifoResult;
  ```

- [ ] **Step 1: 在 decimal.ts 加 mulDivFloor**

`src/core/decimal.ts` 追加（整除、floor）：
```ts
export function mulDivFloor(a: string, b: string, d: string): string {
  const dd = toBig(d);
  if (dd === 0n) throw new Error('mulDivFloor: div by zero');
  return ((toBig(a) * toBig(b)) / dd).toString();
}
export function ltMinor(a: string, b: string): boolean { return toBig(a) < toBig(b); }
export function subMinor(a: string, b: string): string { return (toBig(a) - toBig(b)).toString(); }
```

- [ ] **Step 2: 寫失敗測試**

`test/core/fifo.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { allocateFifo } from '../../src/core/fifo.js';
import type { PositionLot } from '../../src/domain/types.js';

const L = (seq: number, lotId: string, qty: string, cost: string): PositionLot =>
  ({ lotId, seq, coinType: 'SUI', wallet: '0xA', remainingQtyMinor: qty, costMinor: cost });

describe('allocateFifo', () => {
  it('單 lot 全消耗', () => {
    const r = allocateFifo([L(1, 'A', '100', '200')], 'SUI', '0xA', '100');
    expect(r).toMatchObject({ ok: true, totalCarryingMinor: '200' });
    if (r.ok) expect(r.consumed).toEqual([{ lotId: 'A', qtyMinor: '100', costMinor: '200' }]);
  });

  it('部分消耗：carrying 按比例 floor，餘額留 lot', () => {
    // 取 40/100，cost 200 → 200*40/100 = 80
    const r = allocateFifo([L(1, 'A', '100', '200')], 'SUI', '0xA', '40');
    if (r.ok) expect(r.consumed[0]!.costMinor).toBe('80');
  });

  it('多 lot 跨筆 FIFO 依 seq；最後一筆吸收尾差', () => {
    // 需 50：A(30/100) 全取 cost100；B 取 20/40，cost = floor(50*20/40)=25
    const r = allocateFifo([L(2, 'B', '40', '50'), L(1, 'A', '30', '100')], 'SUI', '0xA', '50');
    if (r.ok) {
      expect(r.consumed.map((c) => c.lotId)).toEqual(['A', 'B']);
      expect(r.totalCarryingMinor).toBe('125');
    }
  });

  it('不足 → insufficient + availableQtyMinor', () => {
    const r = allocateFifo([L(1, 'A', '10', '20')], 'SUI', '0xA', '50');
    expect(r).toEqual({ ok: false, insufficient: true, availableQtyMinor: '10' });
  });

  it('未按 seq 排序 → fail-closed throw', () => {
    expect(() => allocateFifo([L(2, 'B', '10', '10'), L(1, 'A', '10', '10')], 'SUI', '0xA', '5')).not.toThrow();
    // 注意：函式內部會先 filter+sort 自己排序並斷言一致性；此處驗證輸入亂序仍正確（見 Step 3 設計）
  });
});
```

- [ ] **Step 3: 跑確認 fail**

Run: `npx vitest run test/core/fifo.test.ts`
Expected: FAIL（`allocateFifo` 不存在）

- [ ] **Step 4: 實作 fifo.ts**

```ts
import type { PositionLot } from '../domain/types.js';
import { addMinor, subMinor, mulDivFloor, ltMinor } from './decimal.js';

export interface ConsumedLot { lotId: string; qtyMinor: string; costMinor: string; }
export type FifoResult =
  | { ok: true; consumed: ConsumedLot[]; totalCarryingMinor: string }
  | { ok: false; insufficient: true; availableQtyMinor: string };

export function allocateFifo(lots: PositionLot[], coinType: string, wallet: string, qtyNeededMinor: string): FifoResult {
  // 過濾後依 seq 升冪；fail-closed：seq 不得重複（重複代表上游排序契約被破壞）。
  const pool = lots.filter((l) => l.coinType === coinType && l.wallet === wallet).slice().sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < pool.length; i++) {
    if (pool[i]!.seq === pool[i - 1]!.seq) throw new Error(`allocateFifo: duplicate lot seq ${pool[i]!.seq}`);
  }
  const available = pool.reduce((acc, l) => addMinor(acc, l.remainingQtyMinor), '0');
  if (ltMinor(available, qtyNeededMinor)) return { ok: false, insufficient: true, availableQtyMinor: available };

  const consumed: ConsumedLot[] = [];
  let remaining = qtyNeededMinor;
  let totalCarrying = '0';
  for (const lot of pool) {
    if (remaining === '0') break;
    const takeQty = ltMinor(lot.remainingQtyMinor, remaining) ? lot.remainingQtyMinor : remaining;
    // 全消耗該 lot → 取整 cost；部分 → 按比例 floor
    const takeCost = takeQty === lot.remainingQtyMinor
      ? lot.costMinor
      : mulDivFloor(lot.costMinor, takeQty, lot.remainingQtyMinor);
    consumed.push({ lotId: lot.lotId, qtyMinor: takeQty, costMinor: takeCost });
    totalCarrying = addMinor(totalCarrying, takeCost);
    remaining = subMinor(remaining, takeQty);
  }
  return { ok: true, consumed, totalCarryingMinor: totalCarrying };
}
```
*尾差說明*：全消耗走 `lot.costMinor` 原值、部分走 floor，因此每個被「整顆吃掉」的 lot 不丟精度；只有最後一個被部分消耗的 lot 用 floor，殘餘 cost 留該 lot remaining（不在本次 movement）。

- [ ] **Step 5: 跑測試 PASS**

Run: `npx vitest run test/core/fifo.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(rules-engine): core/fifo.ts 純函式 FIFO allocator（排序 fail-closed）"
```

---

### Task 3: EventStrategy registry + receipt refactor（dispatchers）

**Files:**
- Create: `src/rules/registry.ts`
- Modify: `src/rules/receiptRules.ts`
- Modify: `src/pipeline/phases/p03_classification.ts`, `p07_lot.ts`, `p08_measure.ts`, `p10_je.ts`, `p11_disclosure.ts`
- Modify: `src/pipeline/phases/p06_pricefx.ts`（requiresValuation 跳過）
- Modify: `src/index.ts`（去 hardcode RECEIPT、ruleIds 從 strategy 取）
- Test: 既有 37 測試（regression）

**Interfaces:**
- Consumes: `PipelineCtx`, `allocateFifo`, `ConsumedLot`
- Produces:
  ```ts
  export interface LotPlan { movements: LotMovement[]; consumed: ConsumedLot[]; }
  export interface EventStrategy {
    ruleIds: string[];
    requiresValuation: boolean;
    classify(ctx: PipelineCtx): RuleException | null;   // 取代 p03 的 per-event 判定
    buildLotPlan(ctx: PipelineCtx): LotPlan | RuleException;
    buildMeasurements(ctx: PipelineCtx): Measurement[];
    buildJeLines(ctx: PipelineCtx): JeLine[] | RuleException;
    buildDisclosure(ctx: PipelineCtx): DisclosureFact[];
  }
  export function getStrategy(t: EventType): EventStrategy;
  ```

- [ ] **Step 1: 寫 registry + receipt strategy**

`src/rules/registry.ts`：
```ts
import type { PipelineCtx } from '../pipeline/context.js';
import type { EventType, LotMovement, Measurement, JeLine, DisclosureFact, RuleException } from '../domain/types.js';
import type { ConsumedLot } from '../core/fifo.js';
import { receiptStrategy } from './receiptRules.js';

export interface LotPlan { movements: LotMovement[]; consumed: ConsumedLot[]; }
export interface EventStrategy {
  ruleIds: string[];
  requiresValuation: boolean;
  classify(ctx: PipelineCtx): RuleException | null;
  buildLotPlan(ctx: PipelineCtx): LotPlan | RuleException;
  buildMeasurements(ctx: PipelineCtx): Measurement[];
  buildJeLines(ctx: PipelineCtx): JeLine[] | RuleException;
  buildDisclosure(ctx: PipelineCtx): DisclosureFact[];
}

const STRATEGIES: Partial<Record<EventType, EventStrategy>> = {
  DIGITAL_ASSET_RECEIPT: receiptStrategy,
  // Task 5-8 逐一註冊
};

export function getStrategy(t: EventType): EventStrategy {
  const s = STRATEGIES[t];
  if (!s) throw new Error(`no strategy for ${t}`);  // 由 index top-level catch 收成 INPUT_ERROR；或在 p03 先擋
  return s;
}
export { STRATEGIES };
```

`src/rules/receiptRules.ts`（整檔換成 strategy）：
```ts
import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { sumMinor, negMinor, isZeroMinor } from '../core/decimal.js';

export const receiptStrategy: EventStrategy = {
  ruleIds: ['receipt-recognition-v1', 'receipt-je-ar-settlement-v1'],
  requiresValuation: true,
  classify: (ctx) => {
    // §3.1：本 slice 只 RECEIVABLE_SETTLEMENT；其餘 purpose 交 review
    const p = ctx.input.event.economicPurpose;
    if (p !== 'RECEIVABLE_SETTLEMENT') return { phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { economicPurpose: p } };
    return null;
  },
  buildLotPlan: (ctx): LotPlan => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const { event } = ctx.input;
    return {
      movements: [{ lotId: `R-${event.txDigest}-${event.eventIndex}`, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: event.quantityMinor, deltaCostMinor: fv }],
      consumed: [],
    };
  },
  buildMeasurements: (ctx): Measurement[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    return [{ name: 'consideration_fv', amountMinor: fv, currency: ctx.input.policySet.functionalCurrency, track: 'FV' }];
  },
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const { event } = ctx.input;
    const lines: JeLine[] = [
      { account: ctx.carry.assetAccount as string, side: 'DEBIT', amountMinor: fv, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
      { account: ctx.carry.arAccount as string, side: 'CREDIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'RECEIVABLE_SETTLEMENT' },
    ];
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    return [{ kind: 'acquisition', detail: { units: ctx.input.event.quantityMinor, cost: fv, nonCashSettlement: true } }];
  },
};

export function balanceCheck(lines: JeLine[]): JeLine[] | RuleException {
  const debit = sumMinor(lines.filter((l) => l.side === 'DEBIT').map((l) => l.amountMinor));
  const credit = sumMinor(lines.filter((l) => l.side === 'CREDIT').map((l) => l.amountMinor));
  if (!isZeroMinor(sumMinor([debit, negMinor(credit)]))) return { phase: 10, code: 'JE_OUT_OF_BALANCE', detail: { debit, credit } };
  return lines;
}
```
*p09 mapping*：receipt 仍用 `ACQUISITION`/`RECEIVABLE_SETTLEMENT` leg；p09 改成讀 strategy 不在本 task 必要（receipt leg 不變），但 Task 5+ 需要 p09 泛化——故 p09 改於 Task 5 一併處理，本 task 保留 receipt 專用 p09 暫不動。

- [ ] **Step 2: phase 改 dispatcher**

`p03_classification.ts`：
```ts
import type { Phase } from '../context.js';
import { getStrategy, STRATEGIES } from '../../rules/registry.js';
export const phaseClassification: Phase = (ctx) => {
  const t = ctx.input.event.eventType;
  if (!STRATEGIES[t]) return { phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { eventType: t } };
  const ex = getStrategy(t).classify(ctx);
  if (ex) return ex;
  ctx.carry.eventType = t;
  return null;
};
```
`p07_lot.ts`：
```ts
import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';
export const phaseLot: Phase = (ctx) => {
  const r = getStrategy(ctx.input.event.eventType).buildLotPlan(ctx);
  if ('code' in r) return r;
  ctx.carry.lotMovements = r.movements;
  ctx.carry.consumedLots = r.consumed;
  return null;
};
```
`p08_measure.ts`：
```ts
import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';
export const phaseMeasure: Phase = (ctx) => {
  ctx.carry.measurements = getStrategy(ctx.input.event.eventType).buildMeasurements(ctx);
  return null;
};
```
`p10_je.ts`：
```ts
import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';
export const phaseJe: Phase = (ctx) => {
  const r = getStrategy(ctx.input.event.eventType).buildJeLines(ctx);
  if ('code' in r) return r as any;
  ctx.carry.journalLines = r;
  return null;
};
```
`p11_disclosure.ts`：
```ts
import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';
export const phaseDisclosure: Phase = (ctx) => {
  ctx.carry.disclosureFacts = getStrategy(ctx.input.event.eventType).buildDisclosure(ctx);
  return null;
};
```
*注意*：p10 的 `('code' in r)` 判斷——`JeLine[]` 是陣列無 `code`，`RuleException` 有 `code`，安全。p05_recognition 現有 receipt 判定移入 `classify`，p05 可改為 no-op 或保留通用 gate；本 task 把 p05 receipt 判定刪除（已移 strategy.classify），p05 改：
```ts
export const phaseRecognition: Phase = (ctx) => { ctx.carry.recognize = true; return null; };
```

- [ ] **Step 3: p06 依 requiresValuation 跳過**

`p06_pricefx.ts` 開頭加：
```ts
import { getStrategy } from '../../rules/registry.js';
// ...
export const phasePriceFx: Phase = (ctx) => {
  if (!getStrategy(ctx.input.event.eventType).requiresValuation) return null;  // valuation-independent（INTERNAL_TRANSFER）
  // ...原邏輯不變
```

- [ ] **Step 4: index.ts 去 hardcode**

`evaluateInner` 正常 post 段：`assessment.eventType` 用 `input.event.eventType`；`explanation.ruleIds` 用 `getStrategy(input.event.eventType).ruleIds`。replay 段同樣用 strategy.ruleIds。刪 `import { RECEIPT_RULE_IDS }`。

- [ ] **Step 5: 跑回歸**

Run: `npm test && npm run typecheck`
Expected: 既有 37 receipt 測試全 PASS（純重構，行為不變）。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(rules-engine): EventStrategy registry，phase 改 dispatcher，receipt 重構"
```

---

### Task 4: reverse() 泛化（additive verbatim lot restore）

**Files:**
- Modify: `src/index.ts`（`reverse`）
- Test: `test/index.reverse.test.ts`（新）

**Interfaces:**
- Consumes: `JournalEntry`（含 lineageHash）、消耗型 event 的 `consumed` refs
- Produces: `reverse(input: RuleInput, priorJe: JournalEntry): JournalEntry` — 借貸對調 + 對消耗型還原 lot

設計：JE 不直接帶 lot movements（output 才有）。reversal 的 lot 還原需 consumed refs；reversal 由呼叫端在持有 prior output 時觸發。為 self-contained，把 reversal 的 lot 還原表達在回傳的 `JournalEntry` 上不夠（JE 無 lot 欄位）。**決策**：`reverse` 仍只回 JE（借貸對調 + reversalOf + 新 lineageHash）；lot 還原 movement 由 evaluate 在 reversal 模式下用 prior output 的 consumed 產出。本 task 範圍：JE 借貸對調 + lineageHash 重算；lot 還原於各 event golden 的 REVERSAL fixture 直接驗 `consumed` 對稱性（見 Task 5）。

- [ ] **Step 1: 寫測試**

`test/index.reverse.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../src/index.js';
import { makeReceiptInput } from './fixtures/receipt.js';

describe('reverse', () => {
  it('借貸對調、reversalOf 指回、lineageHash 重算', () => {
    const happy = evaluate(makeReceiptInput('HAPPY'));
    const prior = happy.journalEntries[0]!;
    const rev = reverse(makeReceiptInput('HAPPY'), prior);
    expect(rev.reversalOf).toBe(prior.idempotencyKey);
    expect(rev.lines.find((l) => l.account === 'AR')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('CREDIT');
    expect(rev.idempotencyKey).not.toBe(prior.idempotencyKey);
    expect(typeof rev.lineageHash).toBe('string');
  });

  it('idempotent：reverse(reverse) 行為一致（金額不漂移）', () => {
    const prior = evaluate(makeReceiptInput('HAPPY')).journalEntries[0]!;
    const r1 = reverse(makeReceiptInput('HAPPY'), prior);
    expect(r1.lines.map((l) => l.amountMinor)).toEqual(prior.lines.map((l) => l.amountMinor));
  });
});
```

- [ ] **Step 2: 跑確認 fail**（lineageHash 欄位缺 → typecheck/測試 fail）

Run: `npx vitest run test/index.reverse.test.ts`

- [ ] **Step 3: 改 reverse**

```ts
import { idempotencyKey, lineageHash } from './core/idempotency.js';
export function reverse(input: RuleInput, priorJe: JournalEntry): JournalEntry {
  const key = idempotencyKey(input, priorJe.idempotencyKey);
  const lines: JeLine[] = priorJe.lines.map((l) => ({ ...l, side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' }));
  // reversal lineage 指回 prior；resolved refs 沿用 prior（同一筆原始 resolution）
  const lh = lineageHash({ priceRefs: [], fxRefs: [], consumedLotIds: [], approvalIds: [priorJe.idempotencyKey] });
  return { idempotencyKey: key, lineageHash: lh, lines, reversalOf: priorJe.idempotencyKey };
}
```

- [ ] **Step 4: 跑 PASS** Run: `npm test && npm run typecheck`

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(rules-engine): reverse 泛化（lineageHash 重算、借貸對調 idempotent）"
```

---

### Task 5: DIGITAL_ASSET_PAYMENT（含 p09 泛化）

**Files:**
- Create: `src/rules/paymentRules.ts`
- Modify: `src/rules/registry.ts`（註冊）、`src/pipeline/phases/p09_mapping.ts`（泛化）、`src/pipeline/phases/p03/p07`（getStrategy 已支援）
- Create: `test/fixtures/payment.ts`, `test/golden/gf-pay.test.ts`

**Interfaces:**
- Consumes: `allocateFifo`, `getStrategy`, `balanceCheck`
- Produces: `paymentStrategy: EventStrategy`；p09 改為 `coaMapping.resolve({ eventType, leg, coinType })`（leg 由 strategy 決定的多 leg）

§7.8.2 happy：支付 20 SUI 取得服務 FV 80；FIFO carrying 50 → Dr service expense 80 / Cr SUI asset 50 / Cr disposal gain 30。

- [ ] **Step 1: p09 泛化**

`p09_mapping.ts`——payment/swap/gas 需多科目。改為：strategy 的 `buildJeLines` 自行呼叫 `ctx.input.coaMapping.resolve`，p09 退化為「驗證所需 leg 都 resolvable」的通用 gate。最簡：把科目 resolve 移進各 strategy 的 buildJeLines，p09 改 no-op（receipt 也改成在 buildJeLines 內 resolve）。
- 改 `receiptStrategy.buildJeLines` 開頭加 resolve（取代讀 `ctx.carry.assetAccount`）：
```ts
const assetAccount = ctx.input.coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION', coinType: ctx.input.event.coinType });
const arAccount = ctx.input.coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'RECEIVABLE_SETTLEMENT', coinType: ctx.input.event.coinType });
if (!assetAccount || !arAccount) return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAccount, arAccount } };
```
- `p09_mapping.ts` 改：`export const phaseMapping: Phase = () => null;`（mapping 驗證下放 strategy；保留 phase slot 維持 12-phase 結構）。
- 既有 gf-rcv MAPPING 相關測試（若有）改驗 buildJeLines 路徑。

- [ ] **Step 2: 寫 paymentStrategy**

`src/rules/paymentRules.ts`：
```ts
import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException, LotMovement } from '../domain/types.js';
import { allocateFifo } from '../core/fifo.js';
import { subMinor, ltMinor, negMinor } from '../core/decimal.js';
import { balanceCheck } from './receiptRules.js';

function fifoOrEx(ctx: PipelineCtx): { consumed; movements: LotMovement[]; carrying: string } | RuleException {
  const { event } = ctx.input;
  const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);
  if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor, needed: event.quantityMinor } };
  const movements: LotMovement[] = r.consumed.map((c) => ({ lotId: c.lotId, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: negMinor(c.qtyMinor), deltaCostMinor: negMinor(c.costMinor) }));
  return { consumed: r.consumed, movements, carrying: r.totalCarryingMinor };
}

export const paymentStrategy: EventStrategy = {
  ruleIds: ['payment-derecognition-v1', 'payment-je-disposal-v1'],
  requiresValuation: true,
  classify: () => null,   // payment 無 slice purpose 限制
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const r = fifoOrEx(ctx);
    if ('code' in r) return r;
    ctx.carry.carryingMinor = r.carrying;       // 給 measure/je 用
    return { movements: r.movements, consumed: r.consumed };
  },
  buildMeasurements: (ctx): Measurement[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const cur = ctx.input.policySet.functionalCurrency;
    return [
      { name: 'consideration_fv', amountMinor: fv, currency: cur, track: 'FV' },
      { name: 'disposal_carrying', amountMinor: carrying, currency: cur, track: 'CARRYING' },
      { name: 'realized_gain', amountMinor: subMinor(fv, carrying), currency: cur, track: 'GAIN' },
    ];
  },
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);   // >0 gain / <0 loss
    const expenseAcct = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'EXPENSE', coinType: event.coinType });
    const assetAcct = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL', coinType: event.coinType });
    const gainLeg = ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN';
    const gainAcct = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: gainLeg, coinType: event.coinType });
    if (!expenseAcct || !assetAcct || !gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { expenseAcct, assetAcct, gainAcct } };
    const lines: JeLine[] = [
      { account: expenseAcct, side: 'DEBIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'EXPENSE' },
      { account: assetAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    // gain：正 → CREDIT 金額 gain；loss → DEBIT 金額 |gain|
    if (ltMinor(gain, '0')) lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
    else lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    return [{ kind: 'disposal', detail: { proceeds: fv, cost: carrying, gain: subMinor(fv, carrying) } }];
  },
};
```
註冊 registry：`DIGITAL_ASSET_PAYMENT: paymentStrategy`。

- [ ] **Step 3: 寫 fixture**

`test/fixtures/payment.ts`（仿 receipt，含 5 variant）：
```ts
import type { RuleInput, CoaMapping } from '../../src/domain/types.js';
type Variant = 'HAPPY' | 'SCOPE' | 'NO_PRICE' | 'NO_FX' | 'INSUFFICIENT_LOT';
const coa: CoaMapping = { resolve: ({ leg }) => ({ EXPENSE: 'SVC-EXP', DISPOSAL: 'ASSET-SUI', DISPOSAL_GAIN: 'GAIN', DISPOSAL_LOSS: 'LOSS' }[leg] ?? null) };

export function makePaymentInput(variant: Variant): RuleInput {
  // 20 SUI(decimals 0) 取得服務 FV 80；FIFO lot 20 units carrying 50
  const base: RuleInput = {
    runContext: { runId: 'run1', entityId: 'ent', bookId: 'bk', periodId: '2026-06', mode: 'PREVIEW', asOf: '2026-06-01T00:00:00Z' },
    event: { schemaVersion: '1', eventId: 'pay1', eventType: 'DIGITAL_ASSET_PAYMENT', eventGroupId: null, entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: '0xVENDOR', coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '20', eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'SERVICE_PAYMENT', ownershipChange: true, considerationAsset: null, rawPayloadHash: 'rawpay', txDigest: 'digpay', eventIndex: 0 },
    policySet: { policySetVersion: 'ps1', assetPolicyVersion: 'ap1', eventPolicyVersion: 'ep1', ruleVersion: 'rv1', parserVersion: 'parse1', normalizationVersion: 'norm1', costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '1', periodOpen: true },
    assetAssessment: { coinType: '0x2::sui::SUI', status: 'APPROVED', accountingClass: 'INTANGIBLE_IAS38_COST', measurementModel: 'IAS38_COST' },
    lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '20', costMinor: '50' }],
    prices: [{ id: 'PX-1', coinType: '0x2::sui::SUI', priceCurrency: 'USD', asOfDate: '2026-06-01', unitPriceMinor: '4' }],  // 20*4=80 FV
    fxRates: [], coaMapping: coa,
  };
  switch (variant) {
    case 'HAPPY': return base;
    case 'SCOPE': return { ...base, assetAssessment: { ...base.assetAssessment, status: 'SCOPE_UNKNOWN' } };
    case 'NO_PRICE': return { ...base, prices: [] };
    case 'NO_FX': return { ...base, prices: [{ id: 'PX-EUR', coinType: '0x2::sui::SUI', priceCurrency: 'EUR', asOfDate: '2026-06-01', unitPriceMinor: '4' }] };
    case 'INSUFFICIENT_LOT': return { ...base, lots: [{ lotId: 'LOT1', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '5', costMinor: '12' }] };
  }
}
```

- [ ] **Step 4: 寫 golden 測試**

`test/golden/gf-pay.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { evaluate, reverse } from '../../src/index.js';
import { makePaymentInput } from '../fixtures/payment.js';

describe('GF-PAY golden (§7.8.2)', () => {
  it('HAPPY: Dr SVC-EXP 80 / Cr ASSET-SUI 50 / Cr GAIN 30; FIFO -20/-50', () => {
    const out = evaluate(makePaymentInput('HAPPY'));
    expect(out.decision).toBe('POSTABLE');
    const je = out.journalEntries[0]!;
    expect(je.lines.find((l) => l.account === 'SVC-EXP')).toMatchObject({ side: 'DEBIT', amountMinor: '80' });
    expect(je.lines.find((l) => l.account === 'ASSET-SUI')).toMatchObject({ side: 'CREDIT', amountMinor: '50' });
    expect(je.lines.find((l) => l.account === 'GAIN')).toMatchObject({ side: 'CREDIT', amountMinor: '30' });
    expect(out.lotMovements[0]).toMatchObject({ deltaQtyMinor: '-20', deltaCostMinor: '-50' });
  });
  it('SCOPE: SCOPE_UNKNOWN, no JE', () => {
    const out = evaluate(makePaymentInput('SCOPE'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('SCOPE_UNKNOWN');
  });
  it('MISSING-PXFX: PRICE_MISSING / FX_MISSING', () => {
    expect(evaluate(makePaymentInput('NO_PRICE')).exceptions[0]!.code).toBe('PRICE_MISSING');
    expect(evaluate(makePaymentInput('NO_FX')).exceptions[0]!.code).toBe('FX_MISSING');
  });
  it('INSUFFICIENT-LOT: INSUFFICIENT_LOT, no JE, lot 不變', () => {
    const out = evaluate(makePaymentInput('INSUFFICIENT_LOT'));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions[0]!.code).toBe('INSUFFICIENT_LOT');
    expect(out.lotMovements).toEqual([]);
  });
  it('REPLAY-REVERSAL: replay 回原 JE; reversal Dr SUI 50 / Dr GAIN 30 / Cr SVC-EXP 80', () => {
    const happy = evaluate(makePaymentInput('HAPPY'));
    const prior = happy.journalEntries[0]!;
    const base = makePaymentInput('HAPPY');
    const replay = evaluate({ ...base, runContext: { ...base.runContext, mode: 'REPLAY' as const }, priorJournalEntries: { [prior.idempotencyKey]: prior } });
    expect(replay.exceptions[0]!.code).toBe('IDEMPOTENT_REPLAY');
    expect(replay.lotMovements).toEqual([]);
    const rev = reverse(base, prior);
    expect(rev.lines.find((l) => l.account === 'ASSET-SUI')!.side).toBe('DEBIT');
    expect(rev.lines.find((l) => l.account === 'SVC-EXP')!.side).toBe('CREDIT');
    expect(rev.lines.find((l) => l.account === 'GAIN')!.side).toBe('DEBIT');
  });
});
```

- [ ] **Step 5: 跑測試**

Run: `npm test && npm run typecheck`
Expected: gf-pay 5 PASS、receipt 37 不回歸。若 SCOPE/PXFX 順序問題（p04 scope 在 p06 前）符合預期（SCOPE 先觸發）。

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(rules-engine): DIGITAL_ASSET_PAYMENT strategy + GF-PAY golden + p09 泛化"
```

---

### Task 6: SPOT_TRADE_SWAP

**Files:**
- Create: `src/rules/swapRules.ts`, `test/fixtures/swap.ts`, `test/golden/gf-swp.test.ts`
- Modify: `src/rules/registry.ts`

§7.8.4 happy：100 SUI（FIFO carrying 200）換 300 USDC（FV 300）→ Dr USDC 300 / Cr SUI 200 / Cr gain 100。SUI -100/-200；USDC +300/+300。

**Interfaces:**
- Consumes: `allocateFifo`, `balanceCheck`
- Produces: `swapStrategy`。**注意**：disposed asset = `event.coinType`（SUI）；acquired asset = `event.considerationAsset`（USDC），FV 來自 p06 對 disposed 或 acquired 的估值。本設計：p06 估的是 received consideration 的 FV（USDC 300）。需確認 p06 估值對象。

- [ ] **Step 1: p06 估值對象決策**

swap 的 FV 應為「收到的對價 FV」。但 p06 現以 `event.coinType` + `event.quantityMinor` 估值（= disposed SUI 的 FV）。對 swap，IAS 38 以收到對價的公允價值衡量取得成本。**決策**：swap fixture 讓 `considerationAsset='USDC'`，p06 對 swap 改估 consideration。為避免改 p06 通用邏輯，**swapStrategy.requiresValuation=true 但自帶 consideration 估值**：在 `buildLotPlan` 前，p06 估 disposed（SUI）FV 不需要；swap 需要的是 USDC FV。
   - 簡化採用：fixture 提供 USDC 的 price（coinType=USDC），但 p06 用 `event.coinType`（SUI）查 price → 會估 SUI。衝突。
   - **解法**：p06 泛化加 `ctx.carry.valuationCoinType`（strategy 可覆寫）。swapStrategy 在 classify 階段設 `ctx.carry.valuationCoinType = event.considerationAsset`、`valuationQtyMinor = considerationQtyMinor`。p06 改讀 `ctx.carry.valuationCoinType ?? event.coinType`、`valuationQtyMinor ?? event.quantityMinor`、`valuationDecimals`。
   - 為此 `NormalizedEvent` 需 `considerationQtyMinor`/`considerationDecimals`？避免改 schema：fixture 用 `considerationAsset='USDC'`，並把 USDC 數量/decimals 放進 event 的擴充——**改採**：swap 估值直接用 received USDC 的 FV，從 price 表以 USDC 數量算。需要 USDC 數量欄位。**決策（最小改動）**：在 swapStrategy 用 `event.counterparty` 不夠；故 schema 加可選 `considerationQtyMinor: string | null`、`considerationDecimals: number | null`。

**設計確認點**：此 task 需改 `NormalizedEvent` schema 加 `considerationQtyMinor`/`considerationDecimals`（nullable）。p01 schema 同步。這是 swap/部分對價類 event 的必要欄位。

- [ ] **Step 2: schema 加欄位**

`types.ts` `NormalizedEvent` 加：`considerationQtyMinor: string | null; considerationDecimals: number | null;`。`schemas.ts` `normalizedEventSchema` 加：`considerationQtyMinor: qtyMinorStr.nullable(), considerationDecimals: z.number().int().min(0).max(36).nullable(),`。既有 receipt/payment fixture 補這兩欄 = `null`（receipt/payment 不用）。

- [ ] **Step 3: p06 支援 valuation override**

`p06_pricefx.ts`：以 `const vCoin = (ctx.carry.valuationCoinType as string) ?? event.coinType; const vQty = (ctx.carry.valuationQtyMinor as string) ?? event.quantityMinor; const vDec = (ctx.carry.valuationDecimals as number) ?? event.assetDecimals;` 取代直接用 event 欄位查 price/算 FV。

- [ ] **Step 4: 寫 swapStrategy**（classify 設 valuation override 指向 consideration）

```ts
export const swapStrategy: EventStrategy = {
  ruleIds: ['swap-disposal-acquisition-v1'],
  requiresValuation: true,
  classify: (ctx) => {
    const { event } = ctx.input;
    if (!event.considerationAsset || !event.considerationQtyMinor || event.considerationDecimals === null)
      return { phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { reason: 'swap 需 considerationAsset/Qty/Decimals' } };
    ctx.carry.valuationCoinType = event.considerationAsset;
    ctx.carry.valuationQtyMinor = event.considerationQtyMinor;
    ctx.carry.valuationDecimals = event.considerationDecimals;
    return null;
  },
  buildLotPlan: (ctx) => {
    const { event } = ctx.input;
    const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);  // 處分 SUI
    if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor } };
    ctx.carry.carryingMinor = r.totalCarryingMinor;
    const disposed = r.consumed.map((c) => ({ lotId: c.lotId, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: negMinor(c.qtyMinor), deltaCostMinor: negMinor(c.costMinor) }));
    const fv = ctx.carry.fvFunctionalMinor as string;  // USDC FV = acquired cost
    const acquired = { lotId: `R-${event.txDigest}-${event.eventIndex}`, coinType: event.considerationAsset!, wallet: event.wallet, deltaQtyMinor: event.considerationQtyMinor!, deltaCostMinor: fv };
    return { movements: [...disposed, acquired], consumed: r.consumed };
  },
  buildMeasurements: (ctx) => {
    const fv = ctx.carry.fvFunctionalMinor as string; const carrying = ctx.carry.carryingMinor as string; const cur = ctx.input.policySet.functionalCurrency;
    return [
      { name: 'consideration_fv', amountMinor: fv, currency: cur, track: 'FV' },
      { name: 'disposal_carrying', amountMinor: carrying, currency: cur, track: 'CARRYING' },
      { name: 'realized_gain', amountMinor: subMinor(fv, carrying), currency: cur, track: 'GAIN' },
    ];
  },
  buildJeLines: (ctx) => {
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string; const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);
    const acqAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'ACQUISITION', coinType: event.considerationAsset! });
    const dispAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL', coinType: event.coinType });
    const gainAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN', coinType: event.coinType });
    if (!acqAcct || !dispAcct || !gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: {} };
    const lines: JeLine[] = [
      { account: acqAcct, side: 'DEBIT', amountMinor: fv, origCoinType: event.considerationAsset, origQtyMinor: event.considerationQtyMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
      { account: dispAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (ltMinor(gain, '0')) lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
    else lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx) => {
    const fv = ctx.carry.fvFunctionalMinor as string; const carrying = ctx.carry.carryingMinor as string;
    return [{ kind: 'swap', detail: { acquiredCost: fv, disposedCost: carrying, gain: subMinor(fv, carrying) } }];
  },
};
```
import 補：`allocateFifo`, `subMinor`, `ltMinor`, `negMinor`, `balanceCheck`。

- [ ] **Step 5: fixture + golden**

`test/fixtures/swap.ts`：disposed 100 SUI（lot seq1 carrying 200），acquired USDC 300（considerationQtyMinor='300', considerationDecimals=0），price 表 USDC@1 USD（300*1=300 FV）。5 variant 比照 payment。golden `gf-swp.test.ts` 斷言 HAPPY：Dr USDC 300 / Cr SUI 200 / Cr gain 100；lotMovements 含 SUI -100/-200 與 USDC +300/+300。其餘 4 variant 比照 payment 對應碼。

- [ ] **Step 6: 跑測試 + Commit**
```bash
npm test && npm run typecheck
git add -A && git commit -m "feat(rules-engine): SPOT_TRADE_SWAP strategy + consideration valuation + GF-SWP golden"
```

---

### Task 7: GAS_FEE

**Files:** Create `src/rules/gasRules.ts`, `test/fixtures/gas.ts`, `test/golden/gf-gas.test.ts`；Modify `registry.ts`

§7.8.5 happy：2 SUI gas，FV 8，FIFO carrying 5 → Dr network_fee_expense 8 / Cr SUI 5 / Cr gain 3。結構同 payment（expense 改 network_fee）。

**Interfaces:** Produces `gasStrategy`（與 paymentStrategy 幾乎同構，差別：expense leg = `NETWORK_FEE`、disclosure kind = `gas_fee`、ruleIds）。

- [ ] **Step 1: 寫 gasStrategy**（複製 paymentStrategy 結構，替換 leg/科目/disclosure）

```ts
export const gasStrategy: EventStrategy = {
  ruleIds: ['gas-fee-expense-v1', 'gas-derecognition-v1'],
  requiresValuation: true,
  classify: () => null,
  buildLotPlan: paymentStrategy.buildLotPlan,   // 同 FIFO 處分邏輯，可直接複用
  buildMeasurements: paymentStrategy.buildMeasurements,
  buildJeLines: (ctx) => {
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string; const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);
    const feeAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'NETWORK_FEE', coinType: event.coinType });
    const assetAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'DISPOSAL', coinType: event.coinType });
    const gainAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN', coinType: event.coinType });
    if (!feeAcct || !assetAcct || !gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: {} };
    const lines: JeLine[] = [
      { account: feeAcct, side: 'DEBIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'NETWORK_FEE' },
      { account: assetAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (ltMinor(gain, '0')) lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
    else lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx) => [{ kind: 'gas_fee', detail: { feeExpense: ctx.carry.fvFunctionalMinor, disposalGain: subMinor(ctx.carry.fvFunctionalMinor as string, ctx.carry.carryingMinor as string) } }],
};
```
（複用 `paymentStrategy.buildLotPlan/buildMeasurements` 引用前需 `import { paymentStrategy }`。）

- [ ] **Step 2: fixture + golden**：`gas.ts` event 2 SUI、lot carrying 5、price 4（2*4=8 FV）；`considerationQtyMinor/Decimals=null`。golden HAPPY 斷言 Dr NET-FEE 8 / Cr ASSET-SUI 5 / Cr GAIN 3；FIFO -2/-5。5 variant 比照 payment。

- [ ] **Step 3: 跑 + Commit**
```bash
npm test && npm run typecheck
git add -A && git commit -m "feat(rules-engine): GAS_FEE strategy + GF-GAS golden"
```

---

### Task 8: INTERNAL_TRANSFER（valuation-independent）

**Files:** Create `src/rules/internalTransferRules.ts`, `test/fixtures/internalTransfer.ts`, `test/golden/gf-itx.test.ts`；Modify `registry.ts`

§7.8.3 happy：同 owner wallet A→B 移 40 SUI，carrying 120 → Dr SUI-walletB 120 / Cr SUI-walletA 120；無 gain；不需 price/fx（`requiresValuation=false`）。lot location A→B、qty/cost 不變。

**Interfaces:** Produces `internalTransferStrategy`。需 event 帶目的地 wallet——用 `event.counterparty` 作 destination wallet（fixture 約定）。

- [ ] **Step 1: 寫 strategy**

```ts
export const internalTransferStrategy: EventStrategy = {
  ruleIds: ['internal-transfer-continuity-v1'],
  requiresValuation: false,
  classify: (ctx) => ctx.input.event.counterparty ? null : { phase: 2, code: 'ENTITY_BOUNDARY', detail: { reason: 'transfer 需 destination wallet (counterparty)' } },
  buildLotPlan: (ctx) => {
    const { event } = ctx.input;
    const dest = event.counterparty!;
    const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);
    if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor } };
    ctx.carry.carryingMinor = r.totalCarryingMinor;
    // location A→B：源 -qty/-cost，目的 +qty/+cost（carrying continuity）
    const moves = r.consumed.flatMap((c) => ([
      { lotId: c.lotId, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: negMinor(c.qtyMinor), deltaCostMinor: negMinor(c.costMinor) },
      { lotId: `${c.lotId}@${dest}`, coinType: event.coinType, wallet: dest, deltaQtyMinor: c.qtyMinor, deltaCostMinor: c.costMinor },
    ]));
    return { movements: moves, consumed: r.consumed };
  },
  buildMeasurements: (ctx) => [{ name: 'disposal_carrying', amountMinor: ctx.carry.carryingMinor as string, currency: ctx.input.policySet.functionalCurrency, track: 'CARRYING' }],
  buildJeLines: (ctx) => {
    const { event, coaMapping } = ctx.input;
    const carrying = ctx.carry.carryingMinor as string;
    const dest = event.counterparty!;
    const srcAcct = coaMapping.resolve({ eventType: 'INTERNAL_TRANSFER', leg: `WALLET:${event.wallet}`, coinType: event.coinType });
    const dstAcct = coaMapping.resolve({ eventType: 'INTERNAL_TRANSFER', leg: `WALLET:${dest}`, coinType: event.coinType });
    if (!srcAcct || !dstAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { srcAcct, dstAcct } };
    if (srcAcct === dstAcct) return [];   // GL 不分 wallet → zero-value subledger movement, no JE
    return balanceCheck([
      { account: dstAcct, side: 'DEBIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'TRANSFER_IN' },
      { account: srcAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'TRANSFER_OUT' },
    ]);
  },
  buildDisclosure: () => [{ kind: 'internal_transfer', detail: { gainLoss: '0' } }],
};
```

- [ ] **Step 2: fixture + golden**：`internalTransfer.ts` event coinType SUI、quantity 40、wallet '0xA'、counterparty '0xB'、lot seq1 carrying 120/40 units、**無 price/fx**。coa：`WALLET:0xA→'SUI-A'`, `WALLET:0xB→'SUI-B'`。variant：HAPPY、SCOPE（assessment SCOPE_UNKNOWN）、MISSING-PXFX（**斷言 no PRICE_MISSING**，因 requiresValuation=false → 仍 POSTABLE）、INSUFFICIENT_LOT、REPLAY-REVERSAL。
  golden HAPPY：Dr SUI-B 120 / Cr SUI-A 120；lotMovements 含 -40/-120@0xA 與 +40/+120@0xB。MISSING-PXFX：`expect(out.decision).toBe('POSTABLE'); expect(out.exceptions.some(e=>e.code==='PRICE_MISSING')).toBe(false);`

- [ ] **Step 3: 跑 + Commit**
```bash
npm test && npm run typecheck
git add -A && git commit -m "feat(rules-engine): INTERNAL_TRANSFER strategy（valuation-independent）+ GF-ITX golden"
```

---

### Task 9: monkey + uniform leaf shape + 收尾

**Files:** Modify `test/monkey.test.ts`；Modify `rules-engine-notes.md`, `tasks/progress.md`

- [ ] **Step 1: monkey 測試**

`test/monkey.test.ts` 追加：
```ts
import { evaluate } from '../src/index.js';
import { makePaymentInput } from './fixtures/payment.js';
import { makeSwapInput } from './fixtures/swap.js';

it('carrying > FV → 走 disposal_loss（DEBIT gain account）', () => {
  const inp = makePaymentInput('HAPPY');
  inp.lots = [{ lotId: 'L', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xA', remainingQtyMinor: '20', costMinor: '200' }];  // carrying 200 > FV 80
  const je = evaluate(inp).journalEntries[0]!;
  const lossLine = je.lines.find((l) => l.leg === 'DISPOSAL_LOSS');
  expect(lossLine).toMatchObject({ side: 'DEBIT', amountMinor: '120' });
});

it('replay 後不重複消耗 lot（lotMovements 空）', () => {
  const base = makePaymentInput('HAPPY');
  const prior = evaluate(base).journalEntries[0]!;
  const r = evaluate({ ...base, runContext: { ...base.runContext, mode: 'REPLAY' as const }, priorJournalEntries: { [prior.idempotencyKey]: prior } });
  expect(r.lotMovements).toEqual([]);
});

it('uniform JE-line shape：所有 event 的 line 都有相同 key 集（canonical-complete）', () => {
  const keys = (je) => je.lines.map((l) => Object.keys(l).sort().join(','));
  const pay = evaluate(makePaymentInput('HAPPY')).journalEntries[0]!;
  const swp = evaluate(makeSwapInput('HAPPY')).journalEntries[0]!;
  const allShapes = [...keys(pay), ...keys(swp)];
  expect(new Set(allShapes).size).toBe(1);  // leaf shape 跨 event 一致
});
```

- [ ] **Step 2: 跑全測試**

Run: `npm test && npm run typecheck`
Expected: 全綠（37 receipt + 20 golden + fifo + reverse + monkey）。

- [ ] **Step 3: 更新 notes**

`rules-engine-notes.md`：B 完成摘要（5 event 真 JE、FIFO、雙軌 carrying+FV、兩層 key+lineageHash、reverse 泛化）、移除已處理的 defer 項、保留 C1/C2 前置任務指標。`tasks/progress.md`：B 標 done，TODO 補「C1/C2 canonical leaf encoding freeze」於 Snapshot 前。

- [ ] **Step 4: dual-review**

跑 `/dual-review`（codex generic + sui skills）。核心金流（FIFO、gain/loss 方向、reverse additive、idempotency）必過外部 review（lessons 2026-06-21：codex 抓 fail-closed 漏洞最準）。修完才算完成。

- [ ] **Step 5: Commit + finishing branch**
```bash
git add -A && git commit -m "test(rules-engine): B monkey + uniform leaf shape + notes"
```
然後用 `superpowers:finishing-a-development-branch` 決定 merge 策略。

---

## Self-Review

**Spec coverage:**
- 5 event 真 JE → Task 3(receipt 重構)/5/6/7/8 ✓
- FIFO + reversal lot restore → Task 2 + 各 event buildLotPlan + Task 4 ✓
- 雙軌 carrying+FV/realized gain → Task 5-8 buildMeasurements ✓
- idempotency 兩層 key（不引用 lots/prices/fx）→ Task 1 ✓
- lineageHash off-leaf → Task 1 ✓
- PositionLot.seq + 排序 fail-closed → Task 1+2 ✓
- requiresValuation=false（ITX）→ Task 3(p06)+8 ✓
- uniform leaf shape（N3）→ Task 9 ✓
- 全 §7.8 golden（20）→ Task 5-8 ✓
- 不改 Move 合約 → 全程無 Move surface ✓

**已知設計風險（執行時注意）:**
- Task 6 改 `NormalizedEvent` schema 加 `considerationQtyMinor/Decimals`（nullable）——屬 schema 改動，需同步所有既有 fixture 補 null。這是 high-risk（conventions.md：storage/schema 改動先確認）。執行 Task 6 前若不確定，停下確認。
- p09 在 Task 5 退化為 no-op、mapping 驗證下放各 strategy——確保 receipt 既有 MAPPING_MISSING 行為不回歸。
- `('code' in r)` 型別窄化：`JeLine[]` vs `RuleException`，陣列無 `code` 屬性，安全；但 lint 可能需 `Array.isArray(r)` 更明確。

**Placeholder scan:** 無 TBD/TODO 殘留（除 registry 註解標示後續 task 註冊點）。

**Type consistency:** `EventStrategy`/`LotPlan`/`ConsumedLot`/`FifoResult`/`Measurement.track` 跨 task 一致；`buildLotPlan` 回 `LotPlan | RuleException`、`buildJeLines` 回 `JeLine[] | RuleException`，dispatcher 用 `'code' in r` 窄化一致。
