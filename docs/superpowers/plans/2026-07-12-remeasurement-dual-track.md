# 期末重估雙軌（Dual-Track Period-End Remeasurement）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 期末重估 JE 可 preview、手動 Run、進 snapshot/merkle；GAAP FVTPL / GAAP ASC 350-30 / IFRS 成本+減損三種 basis；處分吃重估後 carrying；負 gas；ASU 過渡；價格表手動輸入全鏈 fail-closed。

**Architecture:** 純函式重估模組住 `services/rules-engine/src/revaluation/`（api 只編排）；新表 `price_points` / `revaluation_run` / `lot_valuation`（append-only、supersede）；cockpit 新增 `'stale'` light 態，blocking 單一權威 = `closeable`。

**Tech Stack:** TypeScript、Fastify + zod、better-sqlite3、vitest、React、Playwright MCP。

**Spec:** `docs/superpowers/specs/2026-07-12-remeasurement-dual-track-design.md`（v2）。任務中 D1–D14 指 spec §3 裁決表。

## Global Constraints

- 金額一律 BigInt-on-string，禁 float；法幣 minor 2dp、代幣 minor 依 registry decimals。
- 所有新表 append-only：不 UPDATE 業務欄、不 DELETE；改動走 supersede 欄。
- git 只准 `git add <明確檔名>`，禁 `-A`/`.`。
- 每個新守衛必須先紅一次（mutation check），修測試不得削弱閘門。
- 測試報數字（如 621/621）。root typecheck 用 `npm run typecheck`（**不是** root `npx tsc --noEmit`，root 無 tsconfig 會靜默通過）。
- 零 diff 期望：`services/anchor-svc`、`services/snapshot-svc`、`services/ingestion`、所有 `.move` 檔。rules-engine / `buildRuleInput.ts` / 處分路徑有 diff 是預期。
- 科目名（已在 `policyStore.ts` ACCOUNT_SEED，缺的要加）：`UnrealizedGainCryptoPnL`、`UnrealizedLossCryptoPnL`、`ImpairmentLoss`、`ImpairmentReversalGain`、`GasRebateIncome`、`RetainedEarnings`、`DigitalAssets`、`GasFeeExpense`、`DisposalGain`、`DisposalLoss`。
- JE lines 必帶 `priceRef`（= price_point id）與既有欄位；MVP 恆 USD 不省 currency 概念欄（沿 `JeLine` 現有欄，不新增 currency 欄——`priceCurrency` 在 PricePoint 上）。

---

## File Structure（總覽）

```
services/rules-engine/src/revaluation/
  types.ts        # RevalueInput/RevalueOutput/ValuationState/LotValuationDraft
  value.ts        # valueOfQty 純算術
  revalue.ts      # revalueLots()：三 basis 分派 + ASU 過渡
services/rules-engine/test/
  revalue.gaapfv.test.ts / revalue.impair.test.ts / revalue.transition.test.ts
services/api/src/store/
  pricePointStore.ts / revaluationStore.ts   # 新
  schema.sql                                  # 加 3 CREATE TABLE
services/api/src/revaluation/
  orchestrate.ts   # loadRevaluationContext / executeRun（preview 與 run 共用）
services/api/src/http/
  routes.ts        # +4 routes；run-rules 段落改動（gas context、DISPOSAL_RELEASE）
  buildRuleInput.ts # 取價 switchover
services/api/src/periodLock/cockpit.ts        # revaluation light
web/src/api/{types,endpoints}.ts              # +stale、+prices/reval endpoints
web/src/data/useRevaluation.ts                # 新 hook
web/src/workspaces/close/
  RevaluationCard.tsx / PriceEntryForm.tsx / PriceHistoryCard.tsx  # 新
  CloseCockpit.tsx / LockPanel.tsx / lightMeta.ts / close.css      # 改
```

---

### Task 1: rules-engine 重估核心型別 + GAAP_FV 軌

**Files:**
- Create: `services/rules-engine/src/revaluation/types.ts`
- Create: `services/rules-engine/src/revaluation/value.ts`
- Create: `services/rules-engine/src/revaluation/revalue.ts`
- Modify: `services/rules-engine/src/index.ts`（export）
- Test: `services/rules-engine/test/revalue.gaapfv.test.ts`

**Interfaces:**
- Consumes: `PositionLot`、`PricePoint`、`JournalEntry`、`JeLine`、`RuleException`（`src/domain/types.ts`）。
- Produces（後續 task 依賴，逐字）:

```typescript
// types.ts
export type ValuationBasis = 'GAAP_FV' | 'GAAP_COST' | 'IFRS_COST';
export interface ValuationState {          // api 從 lot_valuation fold 後餵入（per lot）
  lotId: string;
  cumulativeDeltaMinor: string;            // 未被 supersede 的 delta 總和（法幣 minor，可負）
  cumulativeImpairmentMinor: string;       // 累計已認列減損（正數；IFRS/GAAP_COST 用）
  qtyAtLastValuationMinor: string;         // 最近一次估值當下數量（per-unit 化分母）
  hasOpeningSeq0: boolean;                 // ASU 過渡列是否已存在
}
export interface LotValuationDraft {
  lotId: string;
  seq: number;                             // 0 = OPENING_FV；run 時由 api 以 runSeq 覆寫 ≥1
  basis: ValuationBasis;
  qtyMinor: string;
  priorCarryingMinor: string;
  currentValueMinor: string;
  deltaMinor: string;
  pricePointId: string;
  reason: 'REVALUE' | 'IMPAIR' | 'REVERSE' | 'OPENING_FV';
}
export interface RevalueInput {
  basis: ValuationBasis;
  entityId: string;
  periodId: string;
  keyBase: string;                         // api 給：`${entityId}:${periodId}:${runSeq}`
  lots: PositionLot[];                     // remaining（foldRemainingLots 輸出）
  valuations: Record<string, ValuationState>;  // by lotId；無列 = zero-state
  prices: PricePoint[];                    // 該 period cut-off 的 as_of 價
  decimalsByCoin: Record<string, number>;  // asset_registry 提供
  policySetVersion: string;
}
export interface RevalueOutput {
  journalEntries: JournalEntry[];          // per coinType 一張；idempotencyKey 已帶 `reval:` 前綴
  valuations: LotValuationDraft[];
  exceptions: RuleException[];             // 缺價 → {phase:12, code:'PRICE_MISSING', detail:{coinType}}
}
// revalue.ts
export function revalueLots(input: RevalueInput): RevalueOutput
// value.ts
export function valueOfQty(qtyMinor: string, unitPriceMinor: string, decimals: number): string
```

- [ ] **Step 1: 讀既有慣例**：`services/rules-engine/src/domain/types.ts`（JournalEntry/JeLine/RuleException 精確欄位）、`src/core/fifo.ts`（BigInt 算術與 `mulDivFloor` 慣例）、`src/index.ts`（export style）、任一 `test/*.test.ts`（測試慣例）。

- [ ] **Step 2: failing test**（`test/revalue.gaapfv.test.ts`）：

```typescript
import { describe, it, expect } from 'vitest';
import { revalueLots } from '../src/revaluation/revalue.js';
import type { RevalueInput } from '../src/revaluation/types.js';

const SUI = '0x2::sui::SUI';
const base = (over: Partial<RevalueInput> = {}): RevalueInput => ({
  basis: 'GAAP_FV', entityId: 'e1', periodId: '2026-Q2', keyBase: 'e1:2026-Q2:1',
  lots: [{ lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '1000000000', costMinor: '100000' }], // 1 SUI @ $1,000.00
  valuations: {},
  prices: [{ id: 'px-q2-sui', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '140000' }], // $1,400/SUI
  decimalsByCoin: { [SUI]: 9 },
  policySetVersion: 'ps-v1', ...over,
});

describe('revalueLots GAAP_FV', () => {
  it('升值：Dr DigitalAssets / Cr UnrealizedGainCryptoPnL，delta=+400', () => {
    const out = revalueLots(base());
    expect(out.exceptions).toEqual([]);
    expect(out.valuations).toEqual([expect.objectContaining({
      lotId: 'L1', basis: 'GAAP_FV', qtyMinor: '1000000000',
      priorCarryingMinor: '100000', currentValueMinor: '140000', deltaMinor: '40000',
      pricePointId: 'px-q2-sui', reason: 'REVALUE',
    })]);
    expect(out.journalEntries).toHaveLength(1);
    const je = out.journalEntries[0];
    expect(je.idempotencyKey).toBe(`reval:e1:2026-Q2:1:${SUI}`);
    expect(je.lines).toEqual([
      expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '40000', priceRef: 'px-q2-sui' }),
      expect.objectContaining({ account: 'UnrealizedGainCryptoPnL', side: 'CREDIT', amountMinor: '40000' }),
    ]);
  });
  it('貶值：Dr UnrealizedLossCryptoPnL / Cr DigitalAssets（獨立損失科目）', () => {
    const out = revalueLots(base({ prices: [{ id: 'px', coinType: SUI, priceCurrency: 'USD', asOfDate: '2026-06-30', unitPriceMinor: '70000' }] }));
    expect(out.journalEntries[0].lines.map(l => [l.account, l.side, l.amountMinor])).toEqual([
      ['UnrealizedLossCryptoPnL', 'DEBIT', '30000'], ['DigitalAssets', 'CREDIT', '30000'],
    ]);
  });
  it('prior valuation 存在時 baseline = cost + cumulativeDelta（不重複認列）', () => {
    const out = revalueLots(base({ valuations: { L1: { lotId: 'L1', cumulativeDeltaMinor: '40000', cumulativeImpairmentMinor: '0', qtyAtLastValuationMinor: '1000000000', hasOpeningSeq0: false } } }));
    // carrying 已 140000，價仍 1400 → delta 0 → 無 JE、無 valuation 列
    expect(out.journalEntries).toEqual([]);
    expect(out.valuations).toEqual([]);
  });
  it('缺價 → PRICE_MISSING exception，該 coin 不出 JE，其他 coin 照出（per-coin fail-closed，run 端全有全無由 api 把關）', () => {
    const out = revalueLots(base({ prices: [] }));
    expect(out.journalEntries).toEqual([]);
    expect(out.exceptions).toEqual([expect.objectContaining({ code: 'PRICE_MISSING', detail: expect.objectContaining({ coinType: SUI }) })]);
  });
  it('同 coin 多 lot 併一張 JE，per-lot valuation 各一列', () => {
    const out = revalueLots(base({ lots: [
      { lotId: 'L1', seq: 1, coinType: SUI, wallet: 'w1', remainingQtyMinor: '1000000000', costMinor: '100000' },
      { lotId: 'L2', seq: 2, coinType: SUI, wallet: 'w1', remainingQtyMinor: '2000000000', costMinor: '300000' },
    ] }));
    expect(out.valuations).toHaveLength(2);
    expect(out.journalEntries).toHaveLength(1);
    // L1: 140000-100000=+40000；L2: 280000-300000=−20000；淨 +20000 → gain 20000
    expect(out.journalEntries[0].lines[0]).toEqual(expect.objectContaining({ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '20000' }));
  });
});
```

- [ ] **Step 3: 跑測試確認紅**：`cd services/rules-engine && npx vitest run test/revalue.gaapfv.test.ts` → FAIL（module not found）。

- [ ] **Step 4: 實作**。`value.ts`：

```typescript
// 代幣 minor × 單價（法幣 minor / whole coin）→ 法幣 minor，floor。
export function valueOfQty(qtyMinor: string, unitPriceMinor: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`valueOfQty: bad decimals ${decimals}`);
  return (BigInt(qtyMinor) * BigInt(unitPriceMinor) / 10n ** BigInt(decimals)).toString();
}
```

`revalue.ts` 骨架（GAAP_FV 分支本 task；IMPAIR 分支 Task 2；過渡 Task 3）：

```typescript
import { valueOfQty } from './value.js';
import type { RevalueInput, RevalueOutput, LotValuationDraft } from './types.js';
// JournalEntry/JeLine/RuleException 從 ../domain/types.js import；lineageHash 沿既有 JE 產生慣例
// （讀 pipeline 裡事件 JE 怎麼填 lineageHash——同法計算；reversalOf 填 null）

export function revalueLots(input: RevalueInput): RevalueOutput {
  const out: RevalueOutput = { journalEntries: [], valuations: [], exceptions: [] };
  const byCoin = groupBy(input.lots, l => l.coinType);
  for (const [coinType, lots] of byCoin) {
    const px = input.prices.find(p => p.coinType === coinType);
    if (!px) { out.exceptions.push(priceMissing(coinType)); continue; }
    const decimals = input.decimalsByCoin[coinType];
    if (decimals === undefined) { out.exceptions.push(priceMissing(coinType)); continue; } // registry 缺 → 同 fail-closed
    let netDelta = 0n;
    for (const lot of lots) {
      const v = input.valuations[lot.lotId];
      const prior = BigInt(lot.costMinor) + BigInt(v?.cumulativeDeltaMinor ?? '0');
      const current = BigInt(valueOfQty(lot.remainingQtyMinor, px.unitPriceMinor, decimals));
      const delta = current - prior;
      if (delta === 0n) continue;
      out.valuations.push(draft(lot, prior, current, delta, px.id, input.basis));
      netDelta += delta;
    }
    if (netDelta !== 0n) out.journalEntries.push(gaapFvJe(input, coinType, netDelta, px.id));
  }
  return out;
}
// gaapFvJe：netDelta>0 → [DigitalAssets DEBIT, UnrealizedGainCryptoPnL CREDIT]
//           netDelta<0 → [UnrealizedLossCryptoPnL DEBIT, DigitalAssets CREDIT]（abs 值）
// idempotencyKey = `reval:${input.keyBase}:${coinType}`；lines 帶 priceRef=px.id、leg='REVALUE'、
// origCoinType=coinType、origQtyMinor=null（金額列非數量列）。
```

- [ ] **Step 5: 跑綠**：`npx vitest run test/revalue.gaapfv.test.ts` → 5 passed。
- [ ] **Step 6: export**：`src/index.ts` 加 `export { revalueLots } from './revaluation/revalue.js'; export * from './revaluation/types.js';`。全套件：`npx vitest run` 全綠、`npx tsc --noEmit` 0。
- [ ] **Step 7: Commit**：`git add services/rules-engine/src/revaluation/*.ts services/rules-engine/src/index.ts services/rules-engine/test/revalue.gaapfv.test.ts && git commit -m "feat(rules-engine): revalueLots GAAP_FV track — pure period-end remeasurement"`。

---

### Task 2: IFRS_COST 減損/迴轉（雙上限）+ GAAP_COST no-write-up

**Files:**
- Modify: `services/rules-engine/src/revaluation/revalue.ts`
- Test: `services/rules-engine/test/revalue.impair.test.ts`

**Interfaces:**
- Consumes: Task 1 全部。
- Produces: `revalueLots` 對 `basis: 'IFRS_COST' | 'GAAP_COST'` 的行為（無新簽名）。

行為規格（spec §4.1b/§4.2）：
- carrying = `cost − cumulativeImpairment(按剩餘數量比例)`。價 < carrying → 減損 `Dr ImpairmentLoss / Cr DigitalAssets`，reason `IMPAIR`。
- 價 > carrying：
  - `IFRS_COST` → 迴轉 `Dr DigitalAssets / Cr ImpairmentReversalGain`，reason `REVERSE`，迴轉額 = min(價值回升額, **cap1**, **cap2**)。**cap1（原成本上限）**：迴轉後 carrying ≤ `remainingQty × unit_cost`，unit_cost 從 `lot.costMinor / remainingQty` 而來（lot_movement 軌，per-unit 已由 FIFO 比例消費維持）——即迴轉後 carrying ≤ `lot.costMinor`。**cap2**：迴轉總額 ≤ 按剩餘數量比例的 `cumulativeImpairmentMinor`（比例 = remainingQty / qtyAtLastValuation，floor）。
  - `GAAP_COST` → **一律不迴轉**（無 JE、無 valuation 列）。
- 減損軌不認列升值超過原成本的部分（cost model）。

- [ ] **Step 1: failing tests**（`test/revalue.impair.test.ts`；`base()` helper 同 Task 1，改 `basis`）：

```typescript
// 序列 A（IFRS 減損）：cost 100000（$1,000），價跌至 $700 → IMPAIR 30000
it('IFRS 減損：Dr ImpairmentLoss 30000 / Cr DigitalAssets 30000', ...);
// 序列 B（迴轉雙上限，CPA S4 序列）：qtyAtLastValuation=100 單位、cumImpair=30000、
// 現 remainingQty=50 單位（處分過半）、cost(剩餘)=50000。價回 $1,200/100單位。
// 比例 cap2 = 30000 × 50/100 = 15000；cap1 = 迴轉後 carrying ≤ 50000。
// carrying = 50000 − 15000 = 35000；價值 = 60000 → 回升 25000 → min(25000, 15000, 50000−35000=15000) = 15000。
it('IFRS 迴轉：部分處分後 cap 按比例下降，迴轉恰 15000', ...);
// 序列 C：GAAP_COST 同序列 B → 零 JE 零 valuation（no write-up）
it('GAAP_COST：價回升不迴轉', (/* expect(out.journalEntries).toEqual([]) */));
// 序列 D：迴轉不得使 carrying 超過原成本（價暴漲仍 clamp）
it('IFRS 迴轉頂到原成本上限即停', ...);
```

（每條 it 內以 Task 1 的 expect 風格寫完整斷言：科目、side、金額、valuation reason。）

- [ ] **Step 2: 跑紅** → FAIL。
- [ ] **Step 3: 實作** `revalue.ts` 內 `impairmentTrack(input, coinType, lots, px, decimals)` 分支，per-lot 計算（減損/迴轉是 per-lot 的，不像 GAAP_FV 可 net——迴轉 cap 是 per-lot 屬性），同 coin 各 lot 的 IMPAIR 與 REVERSE 金額分別彙總成同一張 JE 的兩組 lines（IMPAIR lines 與 REVERSE lines 不互抵）。
- [ ] **Step 4: 跑綠** + **mutation check**：把 GAAP_COST 的 no-write-up 分支暫時改成放行 → 序列 C 轉紅 → 還原綠。把 cap2 比例移除 → 序列 B 轉紅 → 還原。
- [ ] **Step 5: Commit**：`git add services/rules-engine/src/revaluation/revalue.ts services/rules-engine/test/revalue.impair.test.ts && git commit -m "feat(rules-engine): impairment tracks — IFRS dual-cap reversal, GAAP_COST no-write-up"`。

---

### Task 3: ASU 2023-08 過渡（seq-0、雙向、兩段分離）

**Files:**
- Modify: `services/rules-engine/src/revaluation/revalue.ts`、`types.ts`
- Test: `services/rules-engine/test/revalue.transition.test.ts`

**Interfaces:**
- Produces（`types.ts` 增欄）：

```typescript
export interface RevalueInput { /* 既有欄 + */ transitionMode?: boolean }  // api 判定「首次 GAAP_FV run」時 true
// RevalueOutput.journalEntries 內過渡 JE 的 idempotencyKey = `reval-open:${entityId}:${coinType}`
// 過渡 valuation draft: seq=0, reason='OPENING_FV', priorCarrying=cost, currentValue=opening_fv
```

行為（spec §4.4）：`transitionMode && basis==='GAAP_FV'` 時，對每個 `!valuations[lotId]?.hasOpeningSeq0` 的 lot：
1. 過渡段：`opening_fv = valueOfQty(remainingQty, px, decimals)`；`opening_fv > cost` → `Dr DigitalAssets / Cr RetainedEarnings`；反向則 `Dr RetainedEarnings / Cr DigitalAssets`（CPA S1）。seq-0 draft。
2. 首期重估段 baseline = opening_fv（**不是 cost**；CPA S2）——本 run 內過渡後 cumulativeDelta 視為 `opening_fv − cost` 再走一般 GAAP_FV 分支（同一價下首期 delta = 0，測試釘死「不重複認列」）。

- [ ] **Step 1: failing tests**：
  - 雙向：cost 100000 / opening_fv 140000 → `Cr RetainedEarnings 40000`；cost 100000 / opening_fv 70000 → `Dr RetainedEarnings 30000`。
  - 兩段分離：transition run 中期末價 = opening 價 → 過渡 JE 有、重估 JE **無**（baseline 已是 opening_fv）；期末價再漲 → 過渡 JE + 重估 JE 各一張、重估 delta 只含 `期末 − opening_fv`。
  - 冪等：`hasOpeningSeq0: true` 的 lot 不再出過渡 JE/draft（transitionMode true 也一樣）。
- [ ] **Step 2: 紅** → **Step 3: 實作** → **Step 4: 綠 + mutation**（把 baseline 誤用 cost → 兩段分離測試轉紅 → 還原）。
- [ ] **Step 5: Commit**：`git commit -m "feat(rules-engine): ASU 2023-08 transition — seq-0 opening_fv, both directions, two-segment baseline"`（明確列檔）。

---

### Task 4: api `price_points` store + `/prices` routes

**Files:**
- Modify: `services/api/src/store/schema.sql`（CREATE TABLE price_points，照 spec §5 欄位；索引 `(entity_id, coin_type, as_of, created_at)`）
- Create: `services/api/src/store/pricePointStore.ts`
- Modify: `services/api/src/http/routes.ts`（GET/POST `/entities/:id/prices`）
- Test: `services/api/test/pricePoints.test.ts`、`services/api/test/prices.routes.test.ts`

**Interfaces:**
- Produces:

```typescript
// pricePointStore.ts
export interface PricePointRow { id: string; entityId: string; coinType: string; asOf: string;
  priceMinor: string; quoteCurrency: string; principalMarket: string; source: string; level: string; createdAt: string }
export function insertPricePoint(db: Db, r: Omit<PricePointRow, 'id' | 'createdAt'>): PricePointRow  // id = `px-${entityId}-${coinType 短 hash}-${asOf}-${n}`
export function latestPricesAt(db: Db, entityId: string, asOf: string): PricePointRow[]  // 每 coin 取 created_at 最新
export function listPriceHistory(db: Db, entityId: string, coinType?: string): PricePointRow[]  // 全列含被蓋舊列，desc
export function priceSetHash(rows: PricePointRow[]): string  // sha256(sorted ids joined)——SUI S3 輸入域 = 恰好消費的列
```

- [ ] **Step 1: failing store test**：insert → latestPricesAt 取到；同 (coin,as_of) 再 insert → latest 取新列、history 兩列都在（append-only：**無 UPDATE/DELETE 任何路徑**）；`priceSetHash` 對同集合不同順序輸入相同（排序後 hash）。
- [ ] **Step 2: 紅 → 實作 → 綠**。schema 加表後跑既有全套（`npx vitest run`）確認零回歸。
- [ ] **Step 3: failing route test**（沿 `test/helpers/app.ts` 的 `buildTestApp()` + `app.inject`）：
  - `POST /entities/:id/prices` body `{ coinType, asOf, price: '1400.00' }`（**收法幣 decimal 字串，server 轉 minor**）→ 201，強制寫入 `level='LEVEL_2'`、`source='manual'`、`quoteCurrency='USD'`。
  - 400 集（zod + ApiError）：price ≤ 0、price 非法字串、coinType 不在 asset_registry（canonicalize 後查）、`asOf` 非該 entity 任一 period cut-off 日（MVP：period `2026-Q2` → cut-off `2026-06-30`；寫死對照表函式 `periodCutoff(periodId)` 於 store，含反查 `cutoffPeriod(asOf)`）。
  - `GET /entities/:id/prices?coinType=` → history desc、舊列帶 `superseded: true`（同 coin+as_of 非最新者）。
- [ ] **Step 4: 紅 → 實作 route → 綠**。monkey：raw SQL 塞 `price_minor='-5'` 髒列 → `latestPricesAt` fail-loud throw（讀取端驗界）。mutation：把 registry 檢查拿掉 → 對應測試紅 → 還原。
- [ ] **Step 5: 全套 + typecheck + Commit**：`git commit -m "feat(api): price_points store + manual price entry routes — LEVEL_2, fail-closed validation"`。

---

### Task 5: api `revaluation_run` + `lot_valuation` stores

**Files:**
- Modify: `services/api/src/store/schema.sql`（兩張表，照 spec §5；`lot_valuation.superseded_by TEXT`、UNIQUE `(entity_id, lot_id, basis, seq)` on seq=0 由 partial index `CREATE UNIQUE INDEX ... WHERE seq = 0`）
- Create: `services/api/src/store/revaluationStore.ts`
- Test: `services/api/test/revaluationStore.test.ts`

**Interfaces:**
- Produces:

```typescript
export interface RevaluationRunRow { id: string; entityId: string; periodId: string; seq: number;
  priceSetHash: string; lotSetHash: string; policySetVersion: string; accountingStandard: string;
  reversalOfRunId: string | null; createdAt: string }
export interface LotValuationRow { id: string; entityId: string; lotId: string; periodId: string; runId: string;
  seq: number; basis: string; qtyMinor: string; priorCarryingMinor: string; currentValueMinor: string;
  deltaMinor: string; pricePointId: string | null; jeId: string | null; reason: string;
  policySetVersion: string; supersededBy: string | null; createdAt: string }
export function insertRun(db: Db, r: Omit<RevaluationRunRow, 'id' | 'seq' | 'createdAt'>): RevaluationRunRow // seq = COUNT(entity,period)+1，同 tx 單調（SUI S2）
export function latestRun(db: Db, entityId: string, periodId: string): RevaluationRunRow | null
export function insertValuation(db: Db, r: Omit<LotValuationRow, 'id' | 'createdAt'>): LotValuationRow
export function supersedeValuationsOfRun(db: Db, runId: string, byRunId: string): number // 只動 seq>0 列（seq-0 永不 supersede——D6）
export function foldValuationStates(db: Db, entityId: string, lotIds: string[]): Record<string, ValuationState> // 只算 superseded_by IS NULL 列
export function lotSetHash(lots: PositionLot[]): string  // sha256(sorted `${lotId}:${remainingQtyMinor}`)
export class RevaluationDataError extends Error { code: 'VALUATION_CORRUPT' }
```

- [ ] **Step 1: failing tests**：insertRun seq 單調（兩次 → 1,2）；foldValuationStates 彙總 delta/impairment（IMPAIR reason 累加進 cumulativeImpairment、REVERSE 減回）、忽略 superseded 列、seq-0 設 hasOpeningSeq0；supersede 只動 seq>0（seq-0 留 NULL——**mutation：把 WHERE seq>0 拿掉 → 測試紅**）。
- [ ] **Step 2: monkey tests**（raw SQL 塞髒列後讀取全 fail-loud）：未知 `basis='LIFO'`、未知 `reason=''`、負 `qty_minor`、孤兒 `run_id`、**GAAP_COST 列被讀進 IFRS 迴轉 fold 時 basis 混軌 → throw `VALUATION_CORRUPT`**（fold 收 `expectedBasis` 參數，混軌即炸——CPA B2 的持久化守衛）。
- [ ] **Step 3: 紅 → 實作 → 綠 → 全套 + typecheck**。
- [ ] **Step 4: Commit**：`git commit -m "feat(api): revaluation_run + lot_valuation stores — monotonic seq, supersede excludes seq-0, fail-loud readers"`。

---

### Task 6: api 重估編排 — preview / run routes

**Files:**
- Create: `services/api/src/revaluation/orchestrate.ts`
- Modify: `services/api/src/http/routes.ts`（`GET /entities/:id/revaluation/preview`、`POST /entities/:id/revaluation/run`）
- Test: `services/api/test/revaluation.routes.test.ts`

**Interfaces:**
- Consumes: Task 1-5 全部 + `getActivePolicy`/`toResolvedPolicySet`（policyStore）、`foldRemainingLots`/`listLotMovements`（lotMovementStore）、`insertJournalEntry`（journalStore）、rules-engine `leafHash`。
- Produces:

```typescript
// orchestrate.ts
export interface RevaluationContext { basis: ValuationBasis; lots: PositionLot[]; prices: PricePointRow[];
  valuations: Record<string, ValuationState>; decimalsByCoin: Record<string, number>;
  priceSetHash: string; lotSetHash: string; policyVersion: number; doc: PolicyDoc; transitionMode: boolean }
export function loadRevaluationContext(db: Db, entityId: string, periodId: string): RevaluationContext
// basis 分派：doc.accountingStandard==='IFRS' → 'IFRS_COST'；'US_GAAP' → per-coin 依 doc.asu202308Applies[coin] ? 'GAAP_FV' : 'GAAP_COST'
// （實作為 per-coin 呼叫 revalueLots 分組；transitionMode = GAAP_FV 組存在且該組任一 lot 無 seq-0）
export function executeRun(db: Db, entityId: string, periodId: string): { runId: string; jeIds: string[]; reversedRunId: string | null }
```

關鍵實作點（照 spec §6）：
- **DB FK**：`journal_entries.event_id NOT NULL REFERENCES events(id)` → run 開頭在同 transaction 插入一筆 system 事件列 `id='evt-reval-${runId}'`（`events` 表必填欄照 schema.sql 填：eventType `REVALUATION_RUN`、rawJson = run header JSON、wallet/coinType 用哨兵 `'system'`）。所有重估 JE 的 `eventId` 指向它——審計錨點兼 FK 滿足。實作前先讀 `schema.sql` events 表確認必填欄。
- run 流程（單一 `db.transaction`）：context → 若 `PRICE_MISSING` exceptions 非空 → **整個 run 400**（全有全無，CPA 要求的語意釘死）→ 若 `latestRun` 存在且未被沖銷 → 先產反向 JE（對每張舊 run JE 出 Dr/Cr 對調版，`idempotencyKey='reval-rev:${oldRunId}:${coinType}'`、`reversalOf=舊 key`）+ `supersedeValuationsOfRun` → insertRun（記雙指紋）→ revalueLots 輸出落 JE（`leafHash(je)`、`periodId` 顯式帶——SUI N1）與 valuation（`seq=run.seq`、seq-0 保持 0、`runId`/`jeId` 回填）。
- period LOCKED → 400 `PERIOD_CLOSED`（讀 period_lock）。

- [ ] **Step 1: failing route tests**（`buildTestApp` + 先以 Task 4 route POST 期末價、跑 run-rules 種 lots——沿既有 lots.route.test.ts 的事件 seed 模式）：
  - preview：200、回 per-asset/per-lot 列 + 擬 JE + `priceMissing: []`；**DB 零寫入**（前後 `journal_entries`/`lot_valuation` count 不變）。
  - run：201 回 `{ runId, jeIds }`；`journal_entries` 有 `reval:` key 列、`lot_valuation` 有列、`revaluation_run` 雙指紋非空。
  - 缺價 run → 400（一顆 coin 缺就全擋）；LOCKED → 400。
  - rerun：改價 → 再 run → 舊 JE 每張有對應 `reval-rev:` 反向、舊 valuation `superseded_by` 非 NULL、**seq-0 列（若 GAAP）superseded_by 仍 NULL**、新 run `reversalOfRunId` = 舊 runId。
  - idempotency：同 payload 重放 run（連點）→ 第二次 409 或冪等回同 runId（實作定 409 `REVAL_ALREADY_CURRENT`：雙指紋與 latestRun 相同即拒）。
  - IFRS entity（seed policy 預設 IFRS）走 IFRS_COST；PATCH policy 成 US_GAAP + `asu202308Applies` 後 run → GAAP_FV + 首跑出 `reval-open:` 過渡 JE、二跑不再出。
- [ ] **Step 2: 紅 → 實作 → 綠**。mutation：把「全有全無」改成跳過缺價 coin → 缺價測試紅；把反向 JE 的 key 綁 runId 改成隨機 → 重放測試紅。還原。
- [ ] **Step 3: 全套 + typecheck + Commit**：`git commit -m "feat(api): revaluation preview/run orchestration — dual fingerprints, reversal rerun, ASU transition wiring"`。

---

### Task 7: cockpit 重估 light（`'stale'`）+ 取代 mock pricing light

**Files:**
- Modify: `services/api/src/periodLock/cockpit.ts`（`LightStatus` 加 `'stale'`；`revaluationLight()`；移除 `MOCK('pricing')`；`closeable` 條件）
- Modify: `services/api/src/http/routes.ts`（cockpit DTO 若有型別引用處同步）
- Test: `services/api/test/cockpit.revaluation.test.ts`

**Interfaces:**
- Produces: `Light.status` 值域 `'green' | 'red' | 'stale' | 'mock'`；`closeable = lights.filter(l => l.status !== 'mock').every(l => l.status === 'green')`（stale 自然非綠 → 擋，D12/D13）。

`revaluationLight(db, entityId, periodId)`：
- 無 run 或存在 blocking `PRICE_MISSING` → `red`（血緣：**blocking 事實權威是 exceptions/closeable，燈是投影**——D12）。
- 有 run 且 `priceSetHash`/`lotSetHash` 任一與現況不符 → `stale`。
- 否則 `green`。`real: true`、label `'Revaluation'`。

- [ ] **Step 1: failing tests**：未 run → red + `closeable=false`；run 後 → green；**補價（新 price_point）→ stale**；**新 lot 同 coin 不加價 → 仍 stale（CPA B3 序列，lot_set_hash 變）**；stale 時 lock route 400。mutation：把 lotSetHash 比對拿掉 → B3 測試紅 → 還原（**這條紅是 spec §10 點名的 linchpin**）。
- [ ] **Step 2: 紅 → 實作 → 綠**。既有 cockpit 測試若釘 7 燈含 mock pricing → 更新為新燈集（不削弱：pricing mock 消失、revaluation real 出現）。
- [ ] **Step 3: 全套 + typecheck + Commit**：`git commit -m "feat(api): revaluation cockpit light — stale state via dual fingerprints, replaces mock pricing light"`。

---

### Task 8: §4.4.1 負 gas（事件時）

**Files:**
- Modify: `services/rules-engine/src/rules/`（gas 規則所在檔——實作前 grep `GasFeeExpense` 定位）+ `src/domain/types.ts`（RunContext 或 RuleInput 增 `gasExpenseToDateMinor: string`）
- Modify: `services/api/src/http/routes.ts` run-rules 段（依事件時間序累計當期 gas expense，逐事件遞增後餵入）
- Test: `services/rules-engine/test/gas.negative.test.ts`、`services/api/test/runRules.negGas.test.ts`

**Interfaces:**
- Produces: RuleInput 增欄 `gasExpenseToDateMinor`（api 算「事件時間序截至本事件」的當期已認列 GasFeeExpense 累計——D9）。負 gas 事件輸出：contra 線 `{account:'GasFeeExpense', side:'CREDIT', amountMinor: min(|net|, gasExpenseToDate)}` + 超額 `{account:'GasRebateIncome', side:'CREDIT'}` + 新 lot movement（`deltaQtyMinor` 正、`deltaCostMinor` = 取得日 FV——**取價走 prices，缺價 → PRICE_MISSING exception 擋該事件**）。

- [ ] **Step 1: engine failing tests** 三段（D9）：淨 −30、當期已認列 100 → contra 30、無 income；淨 −100、已認列 100 → contra 100；淨 −130、已認列 100 → contra 100 + income 30。加**決定性**測試：同事件集重跑（api 端測試）逐事件 gasExpenseToDate 相同 → 同拆分。加缺價 → exception 測試。
- [ ] **Step 2: 紅 → 實作（engine 分支 + api 累計器）→ 綠 + mutation**（clamp 拿掉 → 超限測試紅）。
- [ ] **Step 3: 全套（兩 package）+ typecheck + Commit**：`git commit -m "feat: negative gas net inflow — clamped GasFeeExpense contra, GasRebateIncome excess, FV lot (spec 4.4.1)"`。

---

### Task 9: `buildRuleInput` 取價 switchover（D14）

**Files:**
- Modify: `services/api/src/http/buildRuleInput.ts:35-38`（硬編 `unitPriceMinor:'100'` → 查 `latestPricesAt(db, entityId, eventDate)`；查無 → 回空 prices，engine phase 6 自然出 `PRICE_MISSING` fail-closed）
- Modify: `services/api/src/http/routes.ts:693` 附近（把 db/entityId 傳入 buildRuleInput——簽名加 `deps: { db: Db }` 或 prices 由 caller 先查好傳入，**選 caller 傳入**保持函式純）
- Test: `services/api/test/buildRuleInput.prices.test.ts` + 既有測試修復

**Interfaces:**
- Produces: `buildRuleInput(event, opts)` 的 `opts` 增 `prices: PricePoint[]`（caller 用 `latestPricesAt` 查好、map 成 engine `PricePoint` 形狀傳入）。

- [ ] **Step 1: failing test**：opts.prices 給列 → RuleInput.prices 用它；不給/空 → RuleInput.prices 空（不再有假價 100）。
- [ ] **Step 2: 修既有測試**——run-rules 系列測試原依賴假價 100：test seed 補 `insertPricePoint`（同值 100 保持既有金額斷言不變，**修 fixture 不削弱守衛**）。跑 `npx vitest run` 列出紅名單、逐檔補價格 seed。
- [ ] **Step 3: 綠（報數字，前後總數一致 + 本 task 新增數）+ typecheck + Commit**：`git commit -m "feat(api): event-time pricing from price_points — fail-closed, no more hardcoded 100 (D14)"`。

---

### Task 10: 處分吃重估後 carrying（§4.5，CPA B1）

**Files:**
- Modify: `services/rules-engine/src/domain/types.ts`（`PositionLot` 增 optional `valuationDeltaMinor?: string`、`valuationImpairMinor?: string`——api fold 後按剩餘量比例攤好餵入）
- Modify: `services/rules-engine/src/rules/swapRules.ts`（處分腿金額 = FIFO cost + 攤入 delta；GAAP_FV 加重分類 lines）
- Modify: `services/api/src/http/routes.ts` run-rules 段（餵 valuation 欄；處分後寫 `DISPOSAL_RELEASE` valuation 列）
- Test: `services/rules-engine/test/disposal.revalued.test.ts`、`services/api/test/runRules.disposalRevalued.test.ts`

**Interfaces:**
- Produces: 處分 JE 對已重估 lot 的行為：
  - 除列額（Cr DigitalAssets）= 處分量比例 ×（cost + cumulativeDelta）。
  - GAAP_FV：重分類 line 組 `Dr UnrealizedGainCryptoPnL / Cr DisposalGain`（先前 gain 轉 realized；loss 反向對稱）；處分損益 = 對價 − 重估後 carrying。
  - IFRS/GAAP_COST：除列額 = 減損後 carrying；無重分類 line（減損已在 P&L）。
  - api 在 insertLotMovement 後對每個被消費且有 valuation 的 lot 寫 `reason='DISPOSAL_RELEASE'` 的 lot_valuation 列（qty=消費量、delta=攤出的累計額負向、je_id=處分 JE）。

- [ ] **Step 1: engine failing tests**——**CPA B1 兩條序列逐字入測**（spec §10）：
  - GAAP：cost 100000、delta +40000（carrying 140000）、售 150000 ⇒ `Cr DigitalAssets 140000`、`DisposalGain` 淨含重分類後累計損益恰 **50000**、無殘留（斷言各 line）。
  - IFRS：cost 100000、impair 30000（carrying 70000）、售 75000 ⇒ 損益 **+5000**（不是 −25000）、`Cr DigitalAssets 70000`（科目不為負）。
  - 部分處分：50% 消費 → 攤 50% delta。
  - 無 valuation 的 lot → 行為與現狀 byte-identical（**回歸鎖**：既有 lots 系列測試不動即證）。
- [ ] **Step 2: 紅 → 實作 → 綠 + mutation**（重分類 line 拿掉 → GAAP 序列「累計損益 500」斷言紅）。
- [ ] **Step 3: api 端測試**：run 重估 → 處分事件 → run-rules → 斷言 JE 金額 + `DISPOSAL_RELEASE` 列存在且 fold 後該 lot cumulativeDelta 歸零。
- [ ] **Step 4: 全套兩 package + typecheck + Commit**：`git commit -m "feat: disposal consumes revalued carrying — reclass to realized, DISPOSAL_RELEASE valuation rows (spec 4.5)"`。

---

### Task 11: web 資料層 — types / endpoints / hooks + stale 判定接線

**Files:**
- Modify: `web/src/api/types.ts`（`LightStatus` 加 `'stale'`；`PricePointDTO`、`RevaluationPreviewDTO`、`RevaluationRunResultDTO`）
- Modify: `web/src/api/endpoints.ts`（`getPrices`、`postPrice`、`getRevaluationPreview`、`postRevaluationRun`——沿 `fetchJson` 模式）
- Create: `web/src/data/useRevaluation.ts`（沿 `usePolicyData` 模式：preview state + run mutate + refetch cockpit）
- Modify: `web/src/workspaces/close/LockPanel.tsx`（blockers 計算改 `l.status === 'red' || l.status === 'stale'`；canLock 維持 `data.closeable`）
- Modify: `web/src/workspaces/close/CloseCockpit.tsx`（verdict 計數同步含 stale：文案 "N lights blocking"）
- Modify: `web/src/workspaces/close/lightMeta.ts` + `close.css`（`.light--stale`：glyph `⟳`、word "Stale — rerun"、色 `var(--warn)`；沿 `.light--derived` 版式抄結構、換色與 glyph）
- Test: `web/src/workspaces/close/CloseCockpit.stale.test.tsx`

**Interfaces:**
- Produces:

```typescript
export interface RevaluationPreviewDTO {
  rows: Array<{ coinType: string; basis: 'GAAP_FV'|'GAAP_COST'|'IFRS_COST'; priorCarryingMinor: string;
    currentValueMinor: string; deltaMinor: string; missingPrice: boolean;
    lots: Array<{ lotId: string; qtyMinor: string; priorCarryingMinor: string; currentValueMinor: string; deltaMinor: string }> }>;
  journalDraft: Array<{ account: string; side: 'DEBIT'|'CREDIT'; amountMinor: string }>;
  priceMissing: string[];  // coinTypes
}
export function useRevaluation(entityId: string | null, periodId: string): {
  preview?: RevaluationPreviewDTO; previewLoading: boolean; error?: string;
  recompute: () => Promise<void>; run: () => Promise<void>; runPending: boolean }
```

- [ ] **Step 1: failing test**（RTL + `vi.spyOn(endpoints, ...)` 模式，沿 `hooks.test.tsx`）：mock cockpit 回 stale 重估燈 → verdict 計入 blocking、LockPanel blockers 列出 `revaluation`、lock 按鈕 disabled（`closeable:false`）。
- [ ] **Step 2: 紅 → 實作 → 綠**。`npm run test` 全綠 + `npm run build` 0。
- [ ] **Step 3: Commit**：`git commit -m "feat(web): revaluation data layer + stale light state — blockers driven by closeable"`。

---

### Task 12: web 重估區塊 UI + 價格輸入/歷史

**Files:**
- Create: `web/src/workspaces/close/RevaluationCard.tsx`（獨立 `<section className="card">`，置於 lights-grid 與 LockPanel 之間；`.policy-card-title` eyebrow）
- Create: `web/src/workspaces/close/PriceEntryForm.tsx`、`web/src/workspaces/close/PriceHistoryCard.tsx`
- Modify: `web/src/workspaces/close/CloseCockpit.tsx`（掛載）、`close.css`（僅新增 class，禁 inline-style 骨架）
- Test: `web/src/workspaces/close/RevaluationCard.test.tsx`

**UI 規格（spec §7 逐字，primitive 綁定為硬需求）:**
- 試算表：`.policy-coa-table` + `.policy-coa-scroll`（390px 橫向捲）+ `.num`；per-asset 彙總列可展開 per-lot；basis chip（`.policy-chip-deferred` 版式）；delta 用 `fmtMinor`（從 `web/src/workspaces/recon/ReconTable.tsx:11` 抽到共用 `web/src/lib/fmtMinor.ts` 再兩處 import——DRY，法幣 decimals=2）+ 正負綁 `.policy-credit`/`.policy-debit`。
- 缺價雙層：頂部 `.lock-blockers` chip「N assets missing price」＋表內該列行內紅標（沿 `light--red` inset-border）。
- 按鈕：Preview = `.export-retry-btn`；Run = `btn-primary`；Run gated on 本 session 成功 preview（沿 PreviewPanel「Recompute a preview first」）；disabled 理由集合 {missing price × N、尚未 preview、LOCKED、stale 需重跑} 走 `title` tooltip + chip。
- PriceEntryForm：幣種下拉限 registry（沿 PolicyEditForm select）、日期限 period cut-off、**輸入收法幣 decimal → client 送字串、server 轉 minor**；欄位錯誤 `.policy-bad`（具體文案）、成功 `.policy-applied-badge`「Price saved」+ 觸發 cockpit refetch（燈即時反映）；`LEVEL_2` chip。
- PriceHistoryCard：複用 `.policy-history-*` 版式（照 `PolicyHistoryCard.tsx` props 模式 `{entityId, refreshKey}`），每筆 as_of/price/source/level/created_at，最新在頂、舊筆標 superseded。

- [ ] **Step 1: failing component tests**：缺價 → Run disabled 且 title 含理由；preview 成功 → 表格 render 彙總列、展開 per-lot；run 成功 → applied badge + `refetch` 被呼叫。
- [ ] **Step 2: 紅 → 實作 → 綠**。`npm run test` 全綠、`npm run build` 0。
- [ ] **Step 3: Playwright UI gate**（沿 tasks/progress.md 交接 note 啟服務：api `set -a && . ./.env && set +a && npm start`、web `npm run dev`）真點擊全流程：輸價 → preview → run → 重估燈綠 → lock 成功；補價 → 燈 `⟳` stale → lock 擋 → 重跑 → 綠；390px 截圖確認橫向捲。console 0 errors。
- [ ] **Step 4: Commit**：`git commit -m "feat(web): revaluation cockpit card — preview table, run gating, price entry + history"`。

---

### Task 13: 終驗（fresh-context verifier gate）

- [ ] 全域 gate 實跑並報數字：`services/api`、`web`、`services/rules-engine` 各 `npx vitest run`；root `npm run typecheck`；`web npm run build`。
- [ ] 零 diff 驗證：`git diff --stat main -- services/anchor-svc services/snapshot-svc services/ingestion '*.move'` 必空。
- [ ] Seed/linchpin：既有 snapshot/tie-out 測試未被削弱（lots 系列對無 valuation lot byte-identical）。
- [ ] 派 fresh-context `verifier` read-back spec §10 驗收清單逐項 PASS/FAIL。
- [ ] 完成後走 dual-review（外部輪不給 spec）→ Ship as-is 才收工。

---

## Self-Review 紀錄

- Spec 覆蓋：D1(T6/T12)、D2(T1-3)、D3+§4.5(T10)、D4(T6 basis 分派)、D5(T4)、D6(T6 rerun/seq-0)、D7(T4 entity-scoped)、D8(T5 lotSetHash+T7)、D9(T8)、D10(T5)、D11(T2/T5 monkey)、D12/D13(T7/T11)、D14(T9)；§4.4 過渡(T3/T6)；§7 UI 綁定(T11/T12)；§9 五攻擊向量各有對應 mutation/monkey（T4-T8/T10）；§10 驗收(各 task + T13)。
- 型別一致性：`ValuationState`/`LotValuationDraft`/`RevalueInput` 在 T1 定義、T5/T6/T10 逐字引用；`PricePointRow`（T4）與 engine `PricePoint` 之間由 T6/T9 caller map（欄名 asOf→asOfDate、priceMinor→unitPriceMinor，T6 實作點明列）。
- 已知不確定點（實作者需現場確認，非 placeholder）：events 表必填欄（T6 system 事件列）、gas 規則所在檔名（T8 grep 定位）、rules-engine lineageHash 產生慣例（T1 讀 pipeline 對齊）。三者都有「先讀 X」步驟。
