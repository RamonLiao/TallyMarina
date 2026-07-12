# 期末重估雙軌（IFRS/GAAP Dual-Track Period-End Remeasurement）— Design Spec

**日期**：2026-07-12
**狀態**：v2 — 三路 review（sui-architect / CPA / frontend-design）整合完畢，待使用者複審
**上游權威**：`docs/specs/accounting-spec-v1.md`（§4.4.1 行 246–260、§5 行 297–346、§6 行 349–397、§7.3 行 451–463、§9.1 行 514–530、§11.2 行 616–629、§14 行 738–756）
**前置依賴**：PolicySet+CoA 落庫（policyStore active loaders，已 MERGED）
**重對準拆包位置**：子專案 3（1. PolicySet+CoA ✅ → **3. 本案** → 4. Trial balance → 5. Xero+QBO export）
**Review findings**：`tasks/review-remeasurement-{sui,cpa,frontend}.md`（合計 6 blocker / 18 should-fix / 8 nit，全數整合或裁決於本版）

---

## 1. Goals

- 期末重估 JE 可決定性產生、可 preview、手動 Run、進 snapshot/merkle，滿足 §14 步驟 4 的 lock 前置條件。
- 雙軌邏輯完整實作：GAAP ASU 2023-08 FVTPL（§5.1）、GAAP 範圍外 ASC 350-30（§5.1 附註）、IFRS 成本模式＋減損/迴轉（§5.2）。
- **處分已重估/已減損 lot 的口徑正確**（CPA B1，使用者裁決納入）：處分腿吃重估後 carrying，未實現/減損隨處分重分類。
- §4.4.1 負 gas 淨額規則（事件時，決定性）。
- §7.3 ASU 過渡 cumulative-effect JE（雙向，首次 GAAP FV 軌 Run 觸發）。
- 期末價格有落庫來源（手動輸入，LEVEL_2），缺價全鏈 fail-closed；事件時取價（負 gas 新 lot）同樣走價格表 fail-closed。
- Per-lot 重估軌跡落庫（`lot_valuation` + `revaluation_run`），供子專案 4 的 roll-forward/TB 消費。

## 2. Non-Goals

- Oracle 自動拉價（P1；本案只留 `source` 欄位接口）。
- Scenario 換軌並列比較（換軌 = 改 policy + restatement 流程）。
- IAS 38 重估模式（§5.3，OCI/RevaluationSurplus，P1）。
- Trial balance 與 roll-forward **報表**（子專案 4；本案產齊資料，含 realized/unrealized 拆分所需的 per-lot 軌跡）。
- Restatement / reopen 後（post-anchor）重估、POSTED 終態（restatement 子專案）。
- UI 之外的自動化觸發（排程、事件驅動）。
- 多幣別 presentation（MVP 恆 USD，但 schema 不省 `quote_currency` 欄，§1.3）。

## 3. 核心裁決（D1–D14）

| # | 裁決 | 理由 |
|---|------|------|
| D1 | **Preview → 手動 Run**：cockpit 重估區塊，`GET preview`（試算＋缺價清單）→ 人審 → `POST run`。重估成為真 light，取代 mock pricing light | fail-closed 精神：缺價在 preview 可見；lock 語意維持「檢查」不變成「寫帳」 |
| D2 | **計算住 rules-engine 新模組**（純函式 `revalueLots`），api 只做編排 | 與事件 JE 同等的決定性/版本化；JE 自然進 snapshot/merkle；雙軌分支集中一處好測。**本輪 rules-engine 有 diff 是預期** |
| D3 | **成本軌寫入端零改動、處分讀取端擴充**（v2 修訂，原「FIFO 零改動」不成立——CPA B1）：`lot_movement` 寫入路徑與 FIFO 佇列選 lot 順序不變；**處分 JE 的除列金額改吃「重估後 carrying」**（原成本 + 該 lot 累計 valuation delta，按處分數量比例），並把先前未實現/減損重分類（§4.5） | 不改口徑則 GAAP 高估利益、IFRS 灌負 `DigitalAssets`，全數出清後科目不歸零、§14 步驟 6 roll-forward 必不平 |
| D4 | **單軌執行、雙軌實作**：Run 依 active policy `accounting_standard` 只走一軌、只出一份 JE | 帳無兩套並存歧義；換軌交給 restatement 子專案 |
| D5 | **價格表 + 手動輸入**：`price_points` 落庫，UI 手動輸入期末價（§6.2 fallback 即 MVP 主路） | 決定性、可審計、零外部依賴 |
| D6 | **重跑 = 反向沖銷 + 新 JE**：lock 前重跑先對舊**期末重估 JE** 出反向 JE，valuation 走 supersede（不刪不改）。**ASU 過渡 JE（seq-0）不參與沖銷/supersede**（CPA S3） | append-only；與未來 restatement/re-anchor 同構；過渡是一次性 cumulative-effect，性質不同 |
| D7 | **price_points entity-scoped**（與 asset_registry 同慣例） | 跨 entity 改價不互相影響對方的重估燈 |
| D8 | **staleness 用雙指紋**（v2 修訂——CPA B3）：run 記錄 `price_set_hash` **與** `lot_set_hash`，任一與現況不符 → 燈轉 stale，重跑才能 lock | 只追價格抓不到 run 後新增/處分的 lot（同 coin 已有價 → hash 不變 → 綠燈下繞過 §14 步驟 4「所有範圍資產」） |
| D9 | **負 gas 的沖銷上限 = 依事件時間序、截至本事件位置的當期已認列 `GasFeeExpense` 累計餘額**（CPA S6 釘死口徑），由 api 算好組進 RuleInput | rules-engine 保持純函式；§4.4.1 行 259 明訂決定性：同一事件集重跑必得相同拆分 |
| D10 | **新增 `revaluation_run` header 表**（SUI B1）：priceSetHash/lotSetHash/runSeq 的持久化落點 | staleness 與 idempotency 依賴的值必須落庫，否則無法比對也無法重建 key |
| D11 | **`basis` 三值**：`GAAP_FV` / `GAAP_COST` / `IFRS_COST`（CPA B2） | ASC 350-30「no write-up」硬禁令必須由落庫資料驅動；塞成 `IFRS_COST`（可迴轉軌）= 張冠李戴繞過守衛 |
| D12 | **缺價 blocking 的單一權威 = §14 `PRICE_MISSING` blocking exception 通道**；重估燈是它與 run 狀態的 UI 投影，`closeable` 由後端統一判定（SUI S5）。此為對上游 §14「pricing light MVP=mock」的**顯式修訂**（本 spec 留痕） | 避免燈與 exceptions 兩套 blocking 機制分岔（燈綠但 exceptions 擋 / 燈黃但 exceptions=0 放行） |
| D13 | **`LightStatus` 新增 `'stale'` 態**（frontend B1）：glyph `⟳`、字 "Stale — rerun"、色 `--warn`（既有，零新色）；**不復用 `derived`**（其誠實語意已被綁死）。blocker 計數/verdict 文案改由 `closeable` 驅動，stale 視為非綠擋關 | 現有 4-state 無處安放黃燈；「只有 red 擋 lock」（`LockPanel.tsx:10`）與 D8 直接矛盾，必須顯式改判定 |
| D14 | **事件時取價 switchover 納入本案**（SUI S4）：`buildRuleInput` 的硬編假價改為讀 `price_points`，需 FV 的事件（含負 gas 新 lot）缺價 fail-closed | 不切則負 gas 新 lot 用假價 100 入帳，汙染後續處分損益，違反 §6.3「嚴禁默認出帳」 |

## 4. 會計規則（引擎行為，逐軌）

### 4.1 GAAP 軌（§5.1，ASU 2023-08 範圍內資產，`basis='GAAP_FV'`）
- 每期期末按 FV 重估，雙向入 P&L：升值 `Dr DigitalAssets / Cr UnrealizedGainCryptoPnL`；貶值 `Dr UnrealizedLossCryptoPnL / Cr DigitalAssets`（**獨立損失科目，非同科目反向**，§5.1 範例表）。
- 無減損/迴轉概念。per-lot FV 調整記入 `lot_valuation`。
- 範圍判定：policy `asu_2023_08_applies` per-asset 標記。

### 4.1b GAAP 範圍外（ASC 350-30，`basis='GAAP_COST'`）
- 成本減減損：僅減損時 `Dr ImpairmentLoss / Cr DigitalAssets`；**減損一經認列不可迴轉（no write-up）**。
- 迴轉守衛**釘在讀 `basis` 的持久化資料上**（`GAAP_COST` 列一律拒迴轉），不只靠 live policy（CPA B2）。
- 計量基礎註記（CPA N1）：IAS 36 用 recoverable amount、ASC 350-30 用 fair value，概念不同；**MVP 皆以期末 PricePoint 為 proxy，兩軌計量基礎在 MVP 數字上收斂**，spec 措辭不稱「共用計算」而稱「proxy 收斂」。

### 4.2 IFRS 成本軌（§5.2，IAS 38 成本模式，`basis='IFRS_COST'`）
- 期末即觸發減損測試（MVP 簡化：每次 Run 就是一次 indicator assessment——比 spec「有跡象才測」更保守，方向安全）。
- MVP recoverable amount 以期末 PricePoint 為 proxy（≈ 公允價值減出售成本；value in use 不做）。
- 減損：`Dr ImpairmentLoss / Cr DigitalAssets`。
- 迴轉：`Dr DigitalAssets / Cr ImpairmentReversalGain`，上限雙重（CPA S4）：
  1. **原成本上限 = `remaining_qty × unit_cost`，從 `lot_movement` 計**（部分處分後數量下降，上限跟著降；不從 `lot_valuation` 的歷史 carrying fold——那會高估）；
  2. 迴轉額 ≤ 該 lot **按剩餘數量比例**的累計已認列減損（從 `lot_valuation` fold）。

### 4.3 §4.4.1 負 gas（事件時規則，非期末管線）
- 淨額 = computation + storage − rebate；可為負。
- 為負時：① 先沖當期 `GasFeeExpense`（contra，上限 = **依事件時間序、截至本事件位置**的當期已認列 gas 費用累計餘額——D9，同一事件集重跑必得相同拆分）；② 超額入 `GasRebateIncome`（income 科目，不倒沖 expense）；③ 淨流入量建新 lot，basis = 取得日 FV——**取價走 `price_points`（D14），缺價 fail-closed 擋該事件**。
- 兩軌一致（GAAP 以 FV 入帳、IFRS 以取得日 FV 為成本，數字相同）。
- **實作慣例（v2.2 留痕）**：負淨額事件以 `economicPurpose === 'NETWORK_FEE_REBATE'` 標示（`quantityMinor` schema 鎖正數，無法帶符號）。已知耦合風險：`economicPurpose` 可被人工 `finalPurpose` 覆寫（§6.9 分類流程），reviewer 改 finalPurpose 會翻轉會計分支——**follow-up**：對 gas 事件的 finalPurpose 覆寫加守衛或警示（入 minor triage，restatement/UI 批次收）。

### 4.4 §7.3 ASU 過渡（一次性，雙向）
- 觸發：entity 首次以 GAAP FV 軌 Run（該 entity 無任何 `basis='GAAP_FV'` 且 `seq=0` 的 valuation 記錄）。
- 過渡 JE **雙向**（CPA S1）：`opening_fv > 歷史成本` → `Dr DigitalAssets / Cr RetainedEarnings`；`opening_fv < 歷史成本` → `Dr RetainedEarnings / Cr DigitalAssets`。均不進當期 P&L。
- **兩段嚴格分離**（CPA S2）：(a) 過渡段 `cost → opening_fv` 進 RetainedEarnings，每個 open lot 記 `seq=0` 列（`prior_carrying=cost, current_value=opening_fv`）；(b) 首期重估段 **baseline 必須是 seq-0 的 `opening_fv`**（不是原成本），`opening_fv → 期末 FV` 進 P&L。同一次 Run 內按 (a)→(b) 順序執行。
- 冪等：以 `(entity, lot, basis='GAAP_FV', seq=0)` 存在性判定；二次 Run 不得重出過渡 JE。**重跑（D6）只沖期末重估 JE，seq-0 過渡列不 supersede、過渡 JE 不反向**（CPA S3）。
- 歷史成本仍留在 lot_movement（揭露與處分損益追蹤用）。IFRS 軌無過渡。
- 順帶根治 §18.2 item 6/7「`opening_fv_minor` 同名異義」舊 minor。

### 4.5 處分已重估/已減損 lot（CPA B1，v2 新增，本案範圍）
- FIFO **選 lot 順序與 `lot_movement` 寫入端不變**；處分 JE 的金額口徑改為：
  - 除列額 = 處分數量 × per-unit 重估後 carrying（= `unit_cost` + 該 lot 累計 valuation delta ÷ 估值時數量，per-unit 化後按處分量計）。
  - **GAAP FV 軌**：先前未實現損益按處分比例重分類為已實現（`UnrealizedGainCryptoPnL` → realized；處分損益 = 對價 − 重估後 carrying）。驗證不變量：全數出清後累計損益 = 對價 − 原成本，`DigitalAssets` 歸零。
  - **IFRS/GAAP 成本軌**：處分吃減損後 carrying（例：cost 1,000、減損至 700、售 750 → 損益 = +50，不是 −250）；該 lot 按比例的累計減損隨處分出清。
- `lot_valuation` 因處分而失效的部分不改寫歷史列——處分事件在 valuation 軌記一筆按比例的結轉列（`reason='DISPOSAL_RELEASE'`），供 roll-forward 拆 realized/unrealized。

## 5. Schema（皆 append-only，改動走 supersede）

```sql
price_points(
  id, entity_id, coin_type,          -- canonicalized，須存在 asset_registry
  as_of,                             -- 期末日/取得日（驗證見 §6 pricing 小節）
  price_minor,                       -- 法幣 minor（2dp），> 0
  quote_currency,                    -- MVP 恆 'USD'，欄位不省（§1.3 禁硬編散落）
  principal_market,                  -- §6.5 同資產跨期一致性稽核用；手動輸入可為 'manual'
  source,                            -- 'manual'（MVP 唯一）；P1 oracle 接口
  level,                             -- 'LEVEL_2'（手動輸入強制）
  created_at
)  -- 同 (coin_type, as_of) 多筆取最新；舊筆即 change log（UI 須呈現，見 §7）

revaluation_run(                     -- D10：staleness/idempotency 的持久化落點
  id, entity_id, period_id,
  seq,                               -- server 端單調（同 transaction 內 COUNT+1），per (entity, period)
  price_set_hash,                    -- 恰好本次 run 消費的 PricePoint id 集合，排序後 hash（SUI S3：
                                     --   邊界 = 該 entity × 該 period cut-off as_of × run 涵蓋的 coin 集合）
  lot_set_hash,                      -- run 當下 remaining lot 集合指紋（lot_id + remaining_qty 排序後 hash）
  policy_set_version, accounting_standard,
  reversal_of_run_id,                -- 本 run 沖銷的前 run（首跑為 NULL）
  created_at
)

lot_valuation(
  id, entity_id, lot_id, period_id, run_id,
  seq,                               -- 顯式欄（SUI S1）；0 = ASU 過渡 opening_fv，≥1 = 期末重估
  basis,                             -- 'GAAP_FV' | 'GAAP_COST' | 'IFRS_COST'（D11）
  qty_minor,                         -- 估值當下剩餘數量（per-unit 化與部分處分比例的依據）
  prior_carrying_minor, current_value_minor, delta_minor,
  price_point_id,                    -- 稽核連結（CPA S5：§6.1 硬要求價格證據隨 JE 留存）
  je_id,                             -- 對應重估/過渡/處分結轉 JE
  reason,                            -- 'REVALUE' | 'IMPAIR' | 'REVERSE' | 'OPENING_FV' | 'DISPOSAL_RELEASE'
  policy_set_version,
  superseded_by,                     -- 重跑時指向新列（seq-0 列永不 supersede）
  created_at
)
```

## 6. API 面

| Route | 行為 |
|-------|------|
| `GET /entities/:id/revaluation/preview?periodId=` | 試算：per-asset 彙總＋per-lot 明細＋擬出 JE lines＋`PRICE_MISSING` 清單。**不落庫** |
| `POST /entities/:id/revaluation/run` | **重算為準**（不信 preview 快照）。缺價 → 400；period LOCKED → **409 `PERIOD_LOCKED`**（v2.1 修訂：原定 400 `PERIOD_CLOSED` 與既有 locked-write 慣例——routes.ts 三處 409——衝突，向慣例收斂；`PERIOD_CLOSED` 字串保留給 rules-engine exception 域）。已有前次 run → 同 transaction 內先 post 反向 JE（沖期末重估 JE，**過渡 JE 除外**）+ supersede 舊 valuation（seq-0 除外），再 post 新 JE。寫入 `revaluation_run` header |
| `GET/POST /entities/:id/prices` | 手動 PricePoint；POST 強制 `level='LEVEL_2'`、`source='manual'`、`quote_currency='USD'`；zod 驗界 |
| cockpit DTO | 重估 light（`real:true`）：**綠** = 最新 run 存在、未被沖銷、`price_set_hash` 與 `lot_set_hash` 均與現況一致；**stale** = 任一指紋不符（run 後補價/改價/新 lot/處分）；**紅** = 未 run 或現有 `PRICE_MISSING`。blocking 單一權威 = `closeable`（D12），stale 與紅均使 `closeable=false` |

**Idempotency（SUI S2/N3）**：
- 重估 JE key = `reval:` 前綴 + `(entity, period, policy versions, price_set_hash, run seq)`——前綴隔離事件 JE 命名空間，避免撞號誤觸 ledger-corruption 守衛。
- 反向沖銷 JE key = `reval-rev:` 前綴 + f(被沖銷 run 的 id)——決定性，重放冪等。
- `seq` 由 server 於 run transaction 內單調取得（`COUNT(runs for entity,period)+1`），不收 client 值。

**Pricing 對應與驗證（CPA S7）**：
- run 由 `periodId` 推導目標 `as_of` = 該 period 期末日（entity 時區 23:59:59 → UTC，上游 §6.4 cut-off）。
- 手動輸入的 `as_of` 必須**落在某個已知 period 的日期範圍內**（v2.3 放寬：原「僅 cut-off 日」會讓非期末日事件在 D14 fail-closed 下永遠無法過帳——假價 100 移除後暴露）。期末重估不受影響：orchestrate 只讀 `latestPricesAt(cutoff)` 精確日，期中價不會汙染重估基礎（CPA S7 的原始關切保留成立）。
- §6.3 的 24h staleness 門檻**不適用**於手動期末價（月結價天生 >24h）：手動 LEVEL_2 價的有效性由「as_of 精確等於 cut-off」取代 staleness 檢查（本條為對 §6.3 在手動價情境的顯式釐清，留痕）。

**編排（preview/run 共用一條）**：`getActivePolicy`（fail-loud）→ `foldRemainingLots` → 讀 period cut-off prices + prior valuations → `revalueLots()` → preview 回 DTO / run 開 transaction 落 run header + JE + valuation。重估 JE 走 journalStore 同店、**顯式帶 `periodId`**（SUI N1：不帶就不進當期 merkle root、不被 anchor staleness 偵測）；JE lines 保留 `currency`/`fx_rate` 欄（MVP 恆 USD/1.0 亦不省，§1.3，CPA N2）。

**事件時取價 switchover（D14）**：`buildRuleInput.ts` 的硬編 `unitPriceMinor:'100'` 改為查 `price_points`（as_of = eventTime 當日口徑）；需 FV 的事件缺價 → 該事件 fail-closed 成 blocking exception，不出帳。此改動在本案 diff 清單內，會牽動既有以假價為前提的測試 fixture（修 fixture 補價格列，不削弱守衛）。

## 7. Web 面（primitive 綁定為硬需求——frontend review：不綁定就會長出第 5 套 badge/第 4 套 table）

**重估區塊落點與容器**：獨立 `<section className="card">` + `.policy-card-title` eyebrow，置於 lights-grid 與 LockPanel 之間；preview 結果沿 PreviewPanel 摺疊模式（「Recompute 後才展開」）；**禁 inline-style 骨架**。

**試算表**：
- 版式：`.policy-coa-table` + `.policy-coa-scroll`（390px 橫向捲，不發明 stacked card）+ `.num`（右對齊 tabular-nums）。
- Granularity：**per-asset 彙總列，可展開 per-lot 明細**。
- 欄位：asset、basis chip（GAAP_FV/GAAP_COST/IFRS_COST）、prior carrying、current FV、delta、（展開列）lot 層同欄。
- 金額：`fmtMinor` formatter（千分位＋scale＋U+2212）；delta 綁語意色 `.policy-credit`（綠=gain）/`.policy-debit`（紅=loss）。

**缺價警示雙層**（frontend S5）：頂部彙總紅 `.lock-blockers` chip「N assets missing price」＋表內對應資產列行內標記（沿 `light--red` inset-border 手法）。

**按鈕**（frontend S4/N1）：Preview = 次級（`.export-retry-btn` 慣例）；Run = `btn-primary`（寫帳敏感動作，禁裸 button）。Run gated on 本 session 內成功 preview（沿 PreviewPanel「Recompute a preview first」pattern；server 端仍重算為準）。disabled 理由集合 = {`PRICE_MISSING × N`、尚未 preview、period LOCKED、stale 需重跑}，以 `title` tooltip ＋ `.lock-blockers` chip 呈現。

**燈（D13）**：`LightStatus` 加 `'stale'`；glyph `⟳`、字 "Stale — rerun"、色 `--warn`；**不復用 `derived`（`≈`）**。`LockPanel.tsx` blocker 計數與 CloseCockpit verdict 文案改由 `closeable` + 非綠真燈驅動（消除「0 lights blocking 但 lock disabled」鬼打牆）。

**價格輸入**：幣種下拉限 registry 已註冊（PolicyEditForm select pattern）、日期（限 period cut-off）、價格**收法幣 decimal、UI 轉 minor**（frontend N3）；欄位級錯誤走 `.policy-bad`（具體訊息：price > 0、幣種需在 registry、as_of 需為期末日）；成功走 `.policy-applied-badge`「Price saved」；輸入區與 change log 帶 `LEVEL_2` chip（`.policy-chip-deferred` amber 版式）。

**價格 change history（frontend B2）**：唯讀清單，每筆 as_of / price / source / level / created_at，最新在頂、舊筆標 superseded；**複用 `.policy-history-*` 版式**（PolicyHistoryCard 同構）。

## 8. 錯誤處理（全 fail-closed / fail-loud）

- 缺價：preview 列清單；run 400；`closeable=false`（單一權威 D12：`PRICE_MISSING` blocking exception 通道，燈是投影）。
- Policy 缺/壞：`PolicyPersistenceError` → 503（既有模式）。WAC policy → `toResolvedPolicySet` 既有 guard 擋（FIFO-only 繼承，零新 code）。
- 重估 JE 借貸必平：走既有 JE 平衡驗證，不另造。
- 髒 `lot_valuation` / `revaluation_run`（未知 basis/reason、負 qty、孤兒 lot_id/run_id）：讀取端 fail-loud，不靜默跳過。
- 處分遇到 valuation 資料矛盾（如累計 delta 使 per-unit carrying < 0）：擋該處分成 blocking exception，不猜測修復。

## 9. Red Team（≤5 攻擊向量 + 防禦，實作前列舉）

1. **惡意手動價**（負/零/天文數字/未註冊幣種/錯期 as_of）→ zod `price_minor > 0`；coin_type canonicalize 後必須存在 asset_registry；as_of 必須為 period cut-off 日。
2. **Run 與補價/持倉變動的 race** → run 同 transaction 讀價與 lots 並記雙指紋（`price_set_hash` + `lot_set_hash`）；run 後任何補價、新 lot、處分 → stale，`closeable=false`，不會綠燈下繞過 §14 步驟 4。
3. **重放 run / 連點** → server 端單調 seq + 決定性 key（`reval:`/`reval-rev:` 前綴）：同 payload 冪等擋、異 payload 撞 key 走既有 ledger-corruption fail-loud；反向 JE key 綁被沖銷 run id，杜絕雙重沖銷。
4. **迴轉超限**（捏造 prior valuation / 部分處分後 cap 高估 / GAAP_COST 塞 IFRS 迴轉）→ 原成本上限從 `lot_movement`（remaining_qty × unit_cost）計；迴轉 ≤ 按比例累計減損；`GAAP_COST` 列一律拒迴轉（守衛讀 basis 持久化值）；raw-SQLite 髒資料 monkey test。
5. **負 gas 沖銷灌水**（rebate 灌爆 contra）→ clamp 至「事件時間序截至本事件」的已認列費用累計，超額只進 `GasRebateIncome`；邊界值＋亂序重放決定性測試釘死。

## 10. 測試策略與可判定驗收準則

- **TDD**，每個新守衛先紅一次（mutation check）。
- rules-engine 純函式：
  - GAAP 漲/跌（跌走 `UnrealizedLossCryptoPnL` 獨立科目）
  - GAAP_COST（ASC 350-30）減損 + **迴轉必須被拒**（守衛釘在 basis 持久化值上，紅一次）
  - IFRS 減損/迴轉/迴轉頂雙上限（原成本上限在**部分處分後**下降——CPA S4 序列：100 單位 cost 1,000 → 減損 700 → 處分 50 → cap = 500）
  - **處分×重估互動（CPA B1 兩條序列直接入測）**：GAAP cost 1,000 → FV 1,400 → 售 1,500 ⇒ 累計損益恰 500、`DigitalAssets` 歸零；IFRS cost 1,000 → 減損 700 → 售 750 ⇒ 損益 +50、科目不為負
  - 負 gas 三段（未超限/剛好/超限）＋**決定性**（同事件集亂序重跑同拆分）
  - ASU 過渡：雙向（opening_fv 高於/低於成本）、兩段分離（首期重估 baseline = opening_fv 非原成本）、冪等（二次 Run 無過渡 JE）、**重跑不沖過渡 JE**
- api route：preview 不落庫、run 落 header+JE+valuation、rerun 沖銷對（且 seq-0 未動）、三種 400（缺價/LOCKED/policy 壞）、idempotency（連點/重放）、staleness 雙指紋（補價→stale；新 lot 同 coin 不加價→**仍 stale**——B3 序列）。
- Monkey：raw-SQLite 塞髒 price/valuation/run 列（壞 basis、壞 reason、負 qty、孤兒 FK、GAAP_COST 偽裝 IFRS_COST）→ 讀取端全 fail-loud。
- Playwright UI gate：輸價 → preview → run → 燈綠 → lock 成功；補價 → 燈 stale（`⟳`）→ lock 被擋 → 重跑 → 綠 → lock；缺價 → Run disabled ＋理由可見。
- 全域 gate：api/web/rules-engine 測試全綠（報數字）、root `npm run typecheck` 0、web build 0。
- 零 diff 期望（v2 修訂）：anchor-svc / snapshot-svc / ingestion / `.move` 零 diff；**rules-engine、`buildRuleInput.ts`（D14）、處分 JE 路徑（D3）有 diff 是本輪預期**；`lot_movement` 寫入端與 FIFO 選序零 diff（linchpin：既有 lots/tie-out 測試除處分金額口徑外不變）。
- 完成制度：fresh-context verifier → dual-review（外部輪不給 spec）→ Ship as-is 才算完成。

## 11. Revision Log

- 2026-07-12 v2.1：run 對 LOCKED period 的回應由 400 `PERIOD_CLOSED` 改 **409 `PERIOD_LOCKED`**（Task 6 review 發現與既有 locked-write 慣例衝突；Rule 11 conventions win，留痕）。
- 2026-07-12 v2.2：§4.3 補負 gas 的 `NETWORK_FEE_REBATE` 標示慣例與 finalPurpose 翻轉風險（Task 8 review adjudication 2）；D9 累計器語意釘死為「含已 post JE 的 event-time 序 seed」（Task 8 review Critical 修復）。
- 2026-07-12 v2.3：POST /prices 的 `as_of` 驗證由「僅 cut-off 日」放寬為「落在已知 period 範圍內」（Task 9 review Important：D14 後非期末日事件否則永久 PRICE_MISSING；重估讀價仍鎖 cut-off 精確日，不受期中價影響）。
- 2026-07-12 v2.4（final whole-branch review C1，跨 task 縫隙）：**rerun × 處分語意釘死**——重估後發生處分再 rerun 時：① 對**仍有 remaining lots 的 coin 全額反向**舊重估 JE；**已完全出清的 coin 跳過反向**（fix-wave 代數證明：因 ② 使 release 列存活進新 baseline，守恆式 `(1−f)(O+R2) − X − fold = 0` 只在 X=R2 全額反向時成立；先前提案的「按釋放份額 netting」會在部分處分高估 `f·R2`，實測 90000≠80000，已推翻）；② `supersedeValuationsOfRun` **排除 `DISPOSAL_RELEASE` 列**（release 是已入帳的歷史事實，非估值快照，不可作廢）；③ 原 D6 只寫「seq-0 除外」，未覆蓋 release 列——全額反向＋作廢 release 會使 `DigitalAssets` 雙重扣減（出清後 rerun 轉負）。最終語意（兩輪複審收斂）：反向 **decision 為 lot 級**——舊 run 估值過的 lot 至少一個存活才反向，全出清（含同幣買回新 lot）則 skip；反向**金額為 per-lot 重建**——僅存活 lot 的估值列份額（從 lot_valuation 重建 lines，非幣級聚合 JE 全額 swap）。序列 A（部分處分）/B（出清）/C（買回）/D（混合一存一清）四條 GL 守恆測試全數釘死。
- 2026-07-12 v2.5（dual-review 外部輪）：① **basis 欄位鎖**——entity 存在未 superseded 的 GAAP 軌 valuation 列時，PATCH 改 `accountingStandard`/`asu202308Applies` → 400 `POLICY_BASIS_LOCKED`（換軌 = restatement 流程；否則 posting 路徑會 500 誤標 VALUATION_CORRUPT）。等值重送與非 basis 欄位不受影響。② **季度 cutoff 改決定性運算**（`YYYY-Qn` 直接算，硬表移除）——否則非 2026-Q2 的期永久不可 close 且無解釋。
- 2026-07-12 v2.6（子專案 4 前置 follow-up 輪，含新一輪 dual-review）：① **殘差重驗結論：v2.4 之後舊比例拆分已破**——rerun supersede 舊 REVALUE 但 release 存活，release 的 delta 按舊 {opening, R1} 混合比例扣，`rawPnl/(rawPnl+rawOpening)` 用新 REVALUE 和 → 比例級誤差（實測 9000 vs 真值 10000）。**修法**：`lot_valuation` 加 `pnl_delta_minor`（僅 DISPOSAL_RELEASE 非 NULL，寫入值＝引擎 reclass 金額取負、同 trunc 公式同輸入）；讀取端 `pnlBuckets()` 精確和（Σ live REVALUE + Σ live release pnl 份額）取代比例，拆分恆等於 per-lot 未實現 GL 餘額。legacy NULL 列 fallback 舊比例（**非等價**，僅 best-effort；生產遷移需 backfill——目前 dev/demo 重 seed 免疫）。② §4.3 finalPurpose 翻轉守衛落地：decide 端 400 `REBATE_MARKER_IMMUTABLE`（marker 為 normalization 符號編碼，對稱不可增減）。③ **外部輪新發現 fail-closed**：非 swap 處分（payment／正向 gas）無 §4.5 reclass 處理卻會觸發 release writer → GL/明細一步 desync；引擎 `fifoOrEx` 對帶 valuation 狀態的 lot 回 `REVALUED_LOT_NON_SWAP_DISPOSAL` exception（swap-only slice 明示化；未來給 payment/gas 接 §4.5 時解除）。④ minors：asu map per-key merge、periodOfDate 日曆日驗證、gas accumulator merge 比較子對齊 localeCompare。

- 2026-07-12 v1：初版（brainstorming 六裁決 + 三節逐節確認）。self-review 修 2 事實錯誤（GAAP 範圍外 = ASC 350-30 不可迴轉；GAAP 貶值走獨立科目）＋釘死 recoverable amount proxy。
- 2026-07-12 v2：三路 review 整合（`tasks/review-remeasurement-{sui,cpa,frontend}.md`）。
  - **CPA B1（使用者裁決納入本案）**：D3 修訂——處分腿吃重估後 carrying＋損益重分類，新增 §4.5。原「FIFO 零改動」宣稱不成立，收斂為「寫入端零改動、處分讀取端擴充」。
  - **SUI B1 → D10**：新增 `revaluation_run` header 表。**CPA B2 → D11**：basis 三值。**CPA B3 → D8 修訂**：雙指紋 staleness。
  - **SUI S5 → D12**：blocking 單一權威 = exceptions/`closeable`，並留痕「取代 §14 mock pricing light」為顯式修訂。**frontend B1 → D13**：`LightStatus` 加 `'stale'`。**SUI S4 → D14**：事件時取價 switchover 納入。
  - CPA S1–S7、SUI S1–S3、frontend B2/S1–S6/N1–N3、SUI N1/N3、CPA N1/N2 全數落入對應章節。
  - 對軌結論：SUI ON-TRACK（鏈上完整性零破壞成立、無 P1 偷渡）；CPA 三處偏離（B1/B2/B3）本版全數修正。
