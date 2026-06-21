# Rules Engine B 升級 — Design Spec

**日期**：2026-06-21
**服務**：`services/rules-engine/`（TS/Node, ESM, zod, vitest）
**前置**：A 骨架（receipt vertical slice, 37 tests）已 merge。
**對映規格**：accounting-spec-v3 §6（引擎）、§7.8.1–§7.8.5（5 event golden）、§9（原則）、附錄 A/B。
**Review**：`sui-architect`（2026-06-21）findings 已整合（S1/S3/S4/N3 採納；C1/C2 切為獨立前置任務，見文末）。

## 目標

把 A 的 receipt-only 管線泛化為 **5 個 paid-pilot event** 全做真 JE：
`DIGITAL_ASSET_RECEIPT`（已有）、`DIGITAL_ASSET_PAYMENT`、`INTERNAL_TRANSFER`、`SPOT_TRADE_SWAP`、`GAS_FEE`。
含 FIFO lot allocation、雙軌成本（carrying + FV，realized gain/loss）、idempotency 兩層 key 修正、泛化 reversal。

**非目標（defer）**：三軌完整（tax basis）、重估 waterfall、多幣別深度路徑、approval workflow、C1/C2 canonical leaf 編碼凍結（獨立任務）。

## 架構

### 1. Event-strategy registry
`src/rules/registry.ts`：`eventType → EventStrategy`
```ts
interface EventStrategy {
  ruleIds: string[];
  requiresValuation: boolean;            // INTERNAL_TRANSFER = false（valuation-independent）
  buildLotPlan(ctx): LotPlan;            // p07
  buildMeasurements(ctx): Measurement[]; // p08
  buildJeLines(ctx): JeLine[];           // p10
  buildDisclosure(ctx): DisclosureFact[];// p11
}
```
Modules：`receiptRules`(refactor 現有)、`paymentRules`、`internalTransferRules`、`swapRules`、`gasRules`。
phases p06–p11 變薄 dispatcher（`registry[ctx.input.event.eventType].buildXxx(ctx)`）。
- p06：依 `requiresValuation` 決定是否要 price/fx；false 時跳過，滿足 `GF-ITX-MISSING-PXFX` 不報缺價。
- index.ts：`assessment.eventType`、`explanation.ruleIds` 改從 input/strategy 取，移除 hardcode `'DIGITAL_ASSET_RECEIPT'` 與 `RECEIPT_RULE_IDS`。

### 2. FIFO allocator `core/fifo.ts`（純函式）
```ts
allocateFifo(lots, coinType, wallet, qtyNeededMinor)
  → { consumed: { lotId, qtyMinor, costMinor }[], totalCarryingMinor }
  | { insufficient: true, availableQtyMinor }   // → INSUFFICIENT_LOT
```
- **排序（採納 S4）**：`PositionLot` 新增 `seq: number`（單調遞增，上游 lot store 賦值）。`allocateFifo` 過濾 coinType+wallet 後**斷言已按 seq 排序**，未排序即 **fail-closed throw**（不信隱性契約）。理由：錯序產生的錯誤 JE 會永久上鏈不可改。
- 部分消耗：`takenCost = costMinor × qtyTaken / remainingQtyMinor`（`decimal.ts` 整除），餘額留原 lot；該 coin 最後一筆消耗吸收 rounding 尾差，避免漏錢。
- `consumed` refs（含逐筆 `lotId/qtyMinor/costMinor`）供 reverse() 逐字還原。

### 3. 雙軌成本（介面三軌、實作雙軌）
```ts
interface Measurement {
  name: string;                          // consideration_fv | disposal_carrying | realized_gain
  amountMinor: string; currency: string;
  track: 'FV' | 'CARRYING' | 'GAIN' | 'TAX_BASIS' | 'REVAL_RESERVE';  // 後二者介面留好、本期不實作
}
```
`realized_gain = consideration_fv − disposal_carrying`；正→`disposal_gain` leg，負→`disposal_loss` leg。

### 4. JE 形狀（對映 §7.8 golden）
| Event | JE |
|---|---|
| RECEIPT | Dr asset FV / Cr AR FV（不動） |
| PAYMENT | Dr expense FV / Cr asset carrying / Cr disposal_gain(FV−carrying) |
| SWAP | Dr acquired-asset FV / Cr disposed-asset carrying / Cr disposal_gain |
| GAS | Dr network_fee_expense FV / Cr asset carrying / Cr disposal_gain |
| INTERNAL_TRANSFER | Dr asset-walletB carrying / Cr asset-walletA carrying；無 gain、不需 price/fx；lot location A→B、qty/cost 不變。GL 不分 wallet → zero-value subledger movement、無 JE |

**N3（採納）**：所有 event 的 JeLine 須 canonical-complete——不適用欄位顯式 `null`，跨 event **leaf shape 一致**，未來 auditor 驗證統一。

### 5. idempotency 兩層 key
- `idempotencyKey` = `sha256(canonical(event identity「rawPayloadHash/txDigest/eventIndex」+ 全部 policy versions))`。**移除** price/fx/lot id 陣列 → 修掉 codex #4（無關 price 改 key → double-post），且 replay 不必重跑 FIFO 即可用穩定 key 查 `priorJournalEntries`。
- 新增 `JournalEntry.lineageHash` = `sha256(canonical(resolved priceRef/fxRef/consumed lotIds/approvalIds))`，供 audit + 未來 Snapshot sidecar。
- **S1（採納，釘死契約）**：未來 merkle **leaf = canonical JE-line + `idempotencyKey`**；`lineageHash` **不進 leaf**，為 off-chain sidecar。Snapshot Svc 對 canonical JE-line bytes 做 merkle，**絕不**對 key/lineageHash 單獨 hash。

### 6. reversal（採納 S3）
`reverse()` 泛化：
- 借貸對調、金額皆正。
- 對消耗型 event：用 stored `consumed.costMinor` **逐字**還原（不重算），additive 對**當前** lot 狀態加回 qty/cost，lineage 指回原 lotId。
- 自身 idempotent（重放 reverse 兩次 = 一次還原）。
- replay：回原 JE、0 movement、`IDEMPOTENT_REPLAY`。

## 測試（對映附錄 B）
- 20 golden：`GF-{PAY,ITX,SWP,GAS}-{HAPPY,SCOPE,MISSING-PXFX,INSUFFICIENT-LOT,REPLAY-REVERSAL}`，逐列斷言 JE 平衡 / lot movement / DisclosureFact / lineage；exception fixture 不建正式 lot、不改 JE/state；reversal 不覆寫原 JE。
- FIFO 單元：部分消耗、尾差、多 lot 跨筆、不足回 INSUFFICIENT_LOT、未排序 fail-closed。
- monkey：carrying>FV 走 loss、replay 後 lot 不重消耗、reverse idempotent、INTERNAL_TRANSFER 無 price 不報缺價、leaf shape 跨 event 一致。
- 跑：`cd services/rules-engine && npm test && npm run typecheck`

## 接受標準
- 5 event 全 happy/exception/replay golden pass，舊 37 receipt 測試不回歸。
- typecheck clean。
- 新增 event 不需動 phase（只加 rules module + registry 註冊）。
- 不需改動 AuditAnchor Move 合約（N2 確認）。
- dual-review（codex + sui skills）通過。

## 切出的前置任務（非 B，排 Snapshot Svc 前）
**「Freeze canonical leaf encoding + merkle spec」**（sui-architect C1/C2）：
- C1：`canonical.ts` leaf preimage 由 `JSON.stringify` 換成跨語言穩定編碼（RFC 8785 JCS 或 length-prefixed BCS）。現狀僅供 idempotency dedup（同 Node binary）正確；變 merkle leaf 且被外部 auditor 跨語言重建時才失效。
- C2：merkle tree spec——leaf/node domain separation（防 second-preimage）、tree arity、odd-node 規則、entity-epoch 內 JE-line ordering。
- Gate：Snapshot Svc 動工前凍結。
