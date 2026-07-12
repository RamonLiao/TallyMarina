# 期末重估雙軌（IFRS/GAAP Dual-Track Period-End Remeasurement）— Design Spec

**日期**：2026-07-12
**狀態**：Approved（brainstorming 三節逐節確認）
**上游權威**：`docs/specs/accounting-spec-v1.md`（§5 行 297–346、§4.4.1 行 246–260、§6.2–6.3 行 371–388、§7.3 行 451–463、§9.1 行 514–530、§14 行 738–756）
**前置依賴**：PolicySet+CoA 落庫（policyStore active loaders，已 MERGED）
**重對準拆包位置**：子專案 3（1. PolicySet+CoA ✅ → **3. 本案** → 4. Trial balance → 5. Xero+QBO export）

---

## 1. Goals

- 期末重估 JE 可決定性產生、可 preview、手動 Run、進 snapshot/merkle，滿足 §14 步驟 4 的 lock 前置條件。
- 雙軌邏輯完整實作：GAAP ASU 2023-08 FVTPL（§5.1）與 IFRS 成本模式＋減損/迴轉（§5.2）。
- §4.4.1 負 gas 淨額規則（事件時）。
- §7.3 ASU 過渡 cumulative-effect JE（首次 GAAP FV 軌 Run 觸發）。
- 期末價格有落庫來源（手動輸入，LEVEL_2），缺價全鏈 fail-closed。
- Per-lot 重估軌跡落庫（`lot_valuation`），供子專案 4 的 roll-forward/TB 消費。

## 2. Non-Goals

- Oracle 自動拉價（P1；本案只留 `source` 欄位接口）。
- Scenario 換軌並列比較（§9.2 重跑機制不在本案；換軌 = 改 policy + restatement 流程）。
- IAS 38 重估模式（§5.3，OCI/RevaluationSurplus，P1）。
- Trial balance 與 roll-forward 報表（子專案 4；本案只產資料）。
- Restatement / reopen 後重估的深度互動、POSTED 終態（restatement 子專案）。
- UI 之外的自動化觸發（排程、事件驅動）。

## 3. 核心裁決（D1–D9，brainstorming 逐題定案）

| # | 裁決 | 理由 |
|---|------|------|
| D1 | **Preview → 手動 Run**：cockpit 重估區塊，`GET preview`（試算＋缺價清單）→ 人審 → `POST run`。重估成為真 light，取代 mock pricing light | fail-closed 精神：缺價在 preview 可見，不會 run 到一半炸；lock 語意維持「檢查」不變成「寫帳」 |
| D2 | **計算住 rules-engine 新模組**（純函式 `revalueLots`），api 只做編排 | 與事件 JE 同等的決定性/版本化；JE 自然進 snapshot/merkle；雙軌分支集中一處好測。**本輪 rules-engine 有 diff 是預期**（上輪零 diff 保證明確解除） |
| D3 | **新表 `lot_valuation`**，成本軌（lot_movement）與衡量軌分離 | 現有 FIFO/tie-out 零改動；IFRS 迴轉上限與 GAAP roll-forward 共用（`basis` 欄區分）；避免 δcost 記法讓雙軌語意在同一欄位分岔 |
| D4 | **單軌執行、雙軌實作**：Run 依 active policy `accounting_standard` 只走一軌、只出一份 JE | 帳無兩套並存歧義；換軌交給 restatement 子專案 |
| D5 | **價格表 + 手動輸入**：`price_points` 落庫，UI 手動輸入期末價（§6.2 fallback 即 MVP 主路） | 決定性、可審計、零外部依賴 |
| D6 | **重跑 = 反向沖銷 + 新 JE**：lock 前重跑先對舊重估 JE 出反向 JE，valuation 走 supersede（不刪不改） | append-only；與未來 restatement/re-anchor 同構 |
| D7 | **price_points entity-scoped**（與 asset_registry 同慣例） | 跨 entity 改價不互相影響對方的重估燈 |
| D8 | **staleness 用 priceSetHash**：run 記錄當時價格集 hash，補價/改價後燈轉黃，重跑才能 lock | run 後進來的價不會被靜默漏掉 |
| D9 | **負 gas 的「當期已認列 gas 費用餘額」由 api 算好組進 RuleInput** | rules-engine 保持純函式，不碰 DB |

## 4. 會計規則（引擎行為，逐軌）

### 4.1 GAAP 軌（§5.1，ASU 2023-08 範圍內資產）
- 每期期末按 FV 重估，雙向入 P&L：升值 `Dr DigitalAssets / Cr UnrealizedGainCryptoPnL`；貶值 `Dr UnrealizedLossCryptoPnL / Cr DigitalAssets`（**獨立損失科目，非同科目反向**，§5.1 範例表）。
- 無減損/迴轉概念。per-lot FV 調整累計記入 `lot_valuation`。
- 範圍判定：policy `asu_2023_08_applies` per-asset 標記；**範圍外之 GAAP 資產走 ASC 350-30 成本減減損：僅減損時 `Dr ImpairmentLoss`，減損一經認列不可迴轉（no write-up）**——與 IFRS 成本軌共用減損計算，但迴轉分支硬性禁用（§5.1 附註，「GAAP 禁止迴轉」即指此模型）。

### 4.2 IFRS 成本軌（§5.2，IAS 38 成本模式）
- 期末即觸發減損測試（MVP 簡化：每次 Run 就是一次 indicator assessment，不另做月中判斷——比 spec「有跡象才測」更保守，方向安全）。
- MVP 的 recoverable amount 以期末 PricePoint 為 proxy（≈ 公允價值減出售成本，活絡市場口徑 §5.2；value in use 不做）。價格 cut-off 時點依上游 §6.4，本案不重定義。
- 減損：`Dr ImpairmentLoss / Cr DigitalAssets`。
- 迴轉：`Dr DigitalAssets / Cr ImpairmentReversalGain`，**per-lot 原始成本為上限**——上限與累計減損從 `lot_valuation` fold 出來，不信任單筆輸入。

### 4.3 §4.4.1 負 gas（事件時規則，非期末管線）
- 淨額 = computation + storage − rebate；可為負。
- 為負時：① 先沖當期 `GasFeeExpense`（contra，上限 = 該期已認列 gas 費用餘額，由 api 組進 RuleInput）；② 超額入 `GasRebateIncome`（income 科目，不倒沖 expense）；③ 淨流入量建新 lot，basis = 取得日 FV（缺價 fail-closed，同重估）。
- 兩軌一致（GAAP 以 FV 入帳、IFRS 以取得日 FV 為成本，數字相同）。

### 4.4 §7.3 ASU 過渡（一次性）
- 觸發：entity 首次以 GAAP FV 軌 Run（該 entity 無任何 `basis='GAAP_FV'` 的 valuation 記錄）。
- 過渡 JE：`Dr DigitalAssets / Cr RetainedEarnings`（cumulative-effect，不進當期 P&L）。
- 每個 open lot 記 `opening_fv` 為 `lot_valuation` 第 0 筆（seq 0）——順帶根治 §18.2 item 6/7「`opening_fv_minor` 同名異義」舊 minor。
- 冪等：第二次 Run 不得重出過渡 JE（以 seq-0 記錄存在與否判定）。
- 歷史成本仍留在 lot_movement（揭露與處分損益追蹤用）。IFRS 軌無過渡。

## 5. Schema（皆 append-only，改動走 supersede）

```sql
price_points(
  id, entity_id, coin_type,          -- canonicalized，須存在 asset_registry
  as_of,                             -- 期末日/取得日
  price_minor,                       -- 法幣 minor（2dp），> 0
  source,                            -- 'manual'（MVP 唯一）；P1 oracle 接口
  level,                             -- 'LEVEL_2'（手動輸入強制）
  created_at
)  -- 同 (coin_type, as_of) 多筆取最新；舊筆即 change log

lot_valuation(
  id, entity_id, lot_id, period_id,
  basis,                             -- 'GAAP_FV' | 'IFRS_COST'
  prior_carrying_minor, current_value_minor, delta_minor,
  je_id,                             -- 對應重估/過渡 JE
  policy_set_version,
  superseded_by,                     -- 重跑時指向新列
  created_at
)  -- ASU opening_fv = 該 lot 的 seq-0 列
```

## 6. API 面

| Route | 行為 |
|-------|------|
| `GET /entities/:id/revaluation/preview?periodId=` | 試算：per-lot/per-asset 列＋擬出 JE lines＋`PRICE_MISSING` 清單。**不落庫** |
| `POST /entities/:id/revaluation/run` | **重算為準**（不信 preview 快照）。缺價 → 400；period LOCKED → 400 `PERIOD_CLOSED`。已有前次 run → 同 transaction 內先 post 反向 JE + supersede 舊 valuation，再 post 新 JE。idempotency key 含 `(entity, period, policy versions, priceSetHash, supersedeSeq)` |
| `GET/POST /entities/:id/prices` | 手動 PricePoint；POST 強制 `level='LEVEL_2'`、`source='manual'`；zod 驗界 |
| cockpit DTO | 重估 light 取代 mock pricing light：**綠** = 最新 run 未 supersede 且 run 的 priceSetHash == 現價格集 hash；**黃** = run 後價格集變動（stale，逼重跑）；**紅** = 未 run 或有 `PRICE_MISSING`。lock gate 吃這盞燈 |

**編排（preview/run 共用一條）**：`getActivePolicy`（fail-loud）→ `foldRemainingLots` → 讀 period-end prices + prior valuations → `revalueLots()` → preview 回 DTO / run 開 transaction 落 JE + valuation。重估 JE 走 journalStore 同店 → 自然進 snapshot leaf/merkle，零特例。

## 7. Web 面

- CloseCockpit 新增重估區塊：試算表（asset、prior carrying、current FV、delta、缺價警示）、`[Preview]`/`[Run]` 按鈕（缺價時 Run disabled）、燈色與原因文案。
- 期末價格輸入 UI（幣種下拉限 registry 已註冊、日期、價格；送出後燈即時反映 staleness）。

## 8. 錯誤處理（全 fail-closed / fail-loud）

- 缺價：preview 列清單；run 400；lock 被燈擋（§14 步驟 4）。
- Policy 缺/壞：`PolicyPersistenceError` → 503（既有模式）。WAC policy → `toResolvedPolicySet` 既有 guard 擋（FIFO-only 繼承，零新 code）。
- 重估 JE 借貸必平：走既有 JE 平衡驗證，不另造。
- 髒 `lot_valuation`（未知 basis、負值異常、孤兒 lot_id）：讀取端 fail-loud，不靜默跳過。

## 9. Red Team（≤5 攻擊向量 + 防禦，實作前列舉）

1. **惡意手動價**（負/零/天文數字/未註冊幣種）→ zod `price_minor > 0`；coin_type canonicalize 後必須存在 asset_registry。
2. **Run 與補價 race** → run 同 transaction 讀價並記 priceSetHash；run 後新價由 staleness 燈抓，不靜默用半套價格集。
3. **重放 run / 連點** → idempotency key（含 supersedeSeq）：同 payload 冪等擋、異 payload 撞 key 走既有 ledger-corruption fail-loud。
4. **IFRS 迴轉超限**（捏造 prior valuation）→ 上限在純函式強制 + raw-SQLite 髒資料 monkey test。
5. **負 gas 沖銷灌水**（rebate 灌爆 contra）→ clamp 至當期已認列費用，超額只進 `GasRebateIncome`；邊界值測試釘死。

## 10. 測試策略與可判定驗收準則

- **TDD**，每個新守衛先紅一次（mutation check）。
- rules-engine 純函式：GAAP 漲/跌（跌走 `UnrealizedLossCryptoPnL` 獨立科目）、GAAP 範圍外 ASC 350-30 減損 + **迴轉必須被拒**（no write-up 紅一次）、IFRS 減損/迴轉/迴轉頂上限、負 gas 三段（未超限/剛好/超限）、ASU 過渡首跑 + 冪等（二次 Run 無過渡 JE）。
- api route：preview 不落庫、run 落庫、rerun 沖銷對、三種 400（缺價/LOCKED/policy 壞）、idempotency。
- Monkey：raw-SQLite 塞髒 price/valuation 列（壞 basis、負價、孤兒 lot）→ 讀取端全 fail-loud。
- Playwright UI gate：輸價 → preview → run → 燈綠 → lock 成功；補價 → 燈黃 → lock 被擋。
- 全域 gate：api/web/rules-engine 測試全綠（報數字）、root `npm run typecheck` 0、web build 0。
- 零 diff 期望：anchor-svc / snapshot-svc / ingestion / `.move` 零 diff；**rules-engine 有 diff 是本輪預期**。
- 完成制度：fresh-context verifier → dual-review（外部輪不給 spec）→ Ship as-is 才算完成。

## 11. Revision Log

- 2026-07-12 v1：初版（brainstorming 六裁決 + 三節逐節確認）。
