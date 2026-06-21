# Rules Engine 骨架 — 設計 spec

**日期**：2026-06-21
**範圍**：Accounting Rules Engine 骨架，vertical slice = `DIGITAL_ASSET_RECEIPT`
**對映規格**：會計規格書 v3 §6（規則引擎）、§3.0/§3.1、§7.8.1 golden fixtures；business-spec-v3 §2.5 capability matrix
**狀態**：approved，待 writing-plans

---

## 0. 決策摘要

- 這個 chat 只做 **Rules Engine 骨架**（不含 Snapshot Svc — 排後續 chat）。
- 骨架深度 = **12-phase 管線 + fail-closed gates 全做真**，打通 **一條** vertical slice（`DIGITAL_ASSET_RECEIPT`）產出平衡 JE。
- 其餘 4 個 pilot event（`PAYMENT`/`INTERNAL_TRANSFER`/`SPOT_TRADE_SWAP`/`GAS_FEE`）真 JE = **B 升級任務**，本 chat 只回明確 stub。
- 依賴（PolicySet / Prices / FX / Lots / COA）以 **in-memory fixture 注入**；不接 PG、不接真 pricing/FX svc、不接 Normalize 層。

## 1. 定位與邊界

- 新 service：`services/rules-engine/`（TS/Node，與 `services/ingestion/` 同 stack、同 vitest）。
- **純函式核心，無 I/O**：`evaluate(input): RuleOutput`。
- 與 ingestion 不耦合：ingestion 產 `RawTransaction`；Rules Engine 吃 `NormalizedEvent`（§6.1 input）。Normalize 層不在本 chat — slice 用手寫 `NormalizedEvent` fixture。
- 金額一律 string / decimal，**禁 JS number**（沿用 ingestion `amount: string` 慣例）。
- **NormalizedEvent type 預留 `event_group_id`**（§3.0.2，綁定 swap/bridge/staking 多腿）：receipt slice 填 `null`，但欄位現在就在 schema 裡 — 避免 B 任務做 swap 時改 schema + 回填所有 fixture（low cost now, high cost later）。

## 2. 12-phase 管線（§6.3）

單一 `runPipeline(ctx)`，依序跑 12 phase。每 phase 是純函式 `(ctx) => ctx | Exception`。任一 phase 回 exception → **立即 short-circuit**，輸出 `decision: REJECTED | REVIEW_REQUIRED`，絕不續跑、絕不零值猜測（§6.1 鐵律）。

| Phase | slice 行為 | 失敗 exception |
|---|---|---|
| 1 Schema validation | zod 驗 NormalizedEvent / input；缺 schema version → reject | （schema error） |
| 2 Ownership/entity boundary | 驗 entity_id 與 run_context 一致 | （boundary mismatch） |
| 3 Event classification | 認 `DIGITAL_ASSET_RECEIPT`；其餘 4 event → `REVIEW_REQUIRED` + `NOT_IMPLEMENTED_IN_SLICE`（non-silent） | — |
| 4 Asset classification/scope | 查 ClassificationAssessment；SUI 未核准 → `SCOPE_UNKNOWN` | `SCOPE_UNKNOWN` |
| 5 Recognition gate | receipt 認列判定 | — |
| 6 Price/FX resolution | 缺價/缺匯率 → fail | `PRICE_MISSING` / `FX_MISSING` |
| 7 Lot allocation | receipt **不消耗** lot，只建 acquisition lot | （不應報 `INSUFFICIENT_LOT`） |
| 8 Measurement | consideration_fv，decimal-only | — |
| 9 MappingRule | COA mapping → 借貸科目 | （mapping missing） |
| 10 JE balancing/rounding | 產 JE，斷言 debit=credit 至 functional ccy 最小單位 | `JE_OUT_OF_BALANCE` |
| 11 DisclosureFact generation | acquisition fact | — |
| 12 Validation/approval routing | 組 output + explanation | — |

規則執行順序：reject/stop rule → specific rule → default rule；衝突回 `RULE_CONFLICT`（§6.3，不得任意順序解決）。

## 3. 關鍵契約（red-team 重點，集中管線層）

- **Decimal-only**：金額用 decimal helper（minor-unit bigint string 或 decimal.js）。禁 binary float（§6.2）。
- **Deterministic idempotency key**：依 §7.8 lineage hash inputs（`raw_payload_hash + tx_digest + event_index + parser_version + normalization_version + policy_set_version + asset_policy_version + event_policy_version + rule_version + price_point_ids + fx_rate_ids + lot_ids + approval_ids + prior_je_id`）算 **sha2-256**（明寫 family，對齊 AuditAnchor 上鏈 hash；禁 sha3/keccak）；不適用欄位以顯式 `null` 參與 canonical serialization。相同 input → 相同 output（§6.6）。
- **Replay/reversal**：`mode: REPLAY` 回傳既有 JE（idempotent）；reversal = 反向 JE + lineage 指回 prior JE。slice 用 in-memory posted-JE map 模擬。
- **每筆 JE**：借貸平衡至 functional ccy 最小單位；保留原幣/數量/價格/匯率；指向 event/lot movement/rule/policy；具 deterministic idempotency key（§6.2）。
- **Fail-closed**：缺政策/價/匯/lot **絕不**用 0 或 misc gain/loss 自動平衡（§6.5）。rounding account 僅處理政策門檻內純小數差。
- **Canonical serialization 單一來源（`core/canonical.ts`）**：idempotency key 與 **JE line → bytes**（Snapshot Svc 算 `merkle_root` 用）共用同一套 canonical encoding（欄位順序、decimal 表示、null 處理）。兩處分叉會讓 auditor inclusion proof 對不上 — 現在就抽成單一 module。
- **Exception 帶 phase**：每個 exception 結構含 `phase: number`（觸發的 12-phase id）+ `code`，auditor 能定位在哪一關 fail，monkey test 能斷言「在正確 phase 擋下」。

## 4. Output 契約（§6.2）

```
{ decision, assessment{event_type,accounting_class,measurement_model},
  measurements[], lot_movements[], journal_entries[], disclosure_facts[],
  exceptions[], explanation{rule_ids,policy_versions,price_refs,fx_refs} }
```

## 5. 測試（§9 + test.md monkey）

- **Golden（acceptance）**：5 個 `GF-RCV-*` fixture，逐一斷言 JE（Dr=Cr）、lot roll-forward、DisclosureFact、exception/replay：
  - `GF-RCV-HAPPY`：Dr SUI asset 300 / Cr AR 300；+lot R1 100u/cost300；acquisition fact；no exception。
  - `GF-RCV-SCOPE`：— ；candidate qty only；`SCOPE_UNKNOWN`。
  - `GF-RCV-MISSING-PXFX`：— ；missing valuation fact；`PRICE_MISSING` 或 `FX_MISSING`。
  - `GF-RCV-INSUFFICIENT-LOT`：同 happy；receipt 不消耗 lot；assert **無** `INSUFFICIENT_LOT`。
  - `GF-RCV-REPLAY-REVERSAL`：replay 回原 JE（`IDEMPOTENT_REPLAY`）；reversal Dr AR 300 / Cr SUI asset 300，lineage 含 prior JE。
- **Phase 單元**：每個 gate 的 reject path。
- **Monkey**：負量、超大 decimal、缺欄位、重複 event、phase 邊界、idempotency key 碰撞、其他 4 event 走 stub path。
- 測試 encode **why**（§9）：「receipt 不消耗 lot」測試在有人誤加 FIFO 消耗時必須 fail。

## 6. 不做（stub / out-of-scope，記 move-notes/progress）

- 其餘 4 event 真 JE（payment disposal / swap disposal-acquisition / internal transfer location move / gas）→ **B 升級任務**。
- Normalize 層、真 pricing/FX svc、PG persistence、approval workflow、ERP export、Snapshot Svc。
- Phase 3 對 4 event 回 `NOT_IMPLEMENTED_IN_SLICE`（non-silent，符合 §12 fail loud）。

## 7. 檔案結構（預估）

```
services/rules-engine/
  package.json, tsconfig.json, vitest.config.ts
  src/domain/{types,schemas}.ts        # NormalizedEvent, RuleInput/Output, ExceptionCode
  src/core/decimal.ts                  # minor-unit decimal helpers
  src/core/canonical.ts                # 單一 canonical encoding (idempotency + JE line bytes 共用)
  src/core/idempotency.ts              # lineage hash (sha2-256, 用 canonical.ts)
  src/pipeline/runPipeline.ts
  src/pipeline/phases/*.ts             # 12 phases
  src/rules/receiptRules.ts            # slice specific/default rules
  src/index.ts                         # evaluate(input)
  test/golden/GF-RCV-*.test.ts
  test/phases/*.test.ts
  test/monkey.test.ts
```

## 8. 升級任務 B（記下，A 完成後做）

5 個 pilot event 全做真 JE：含 FIFO lot allocation、swap disposal+acquisition 雙腿、payment derecognition gain/loss、internal transfer carrying-amount continuity、gas fee。對映 §7.8.1–§7.8.5 全部 golden fixtures。FIFO + 雙軌成本本身值獨立 chat。
