# Trial Balance + ASU Roll-forward（子專案 4）設計

日期：2026-07-13
狀態：v1.0（brainstorming 定稿，含 GTM review 11 條整合）
權威上游：`docs/specs/accounting-spec-v1.md` §11 / §14 步驟 5–7 / §18.2 item 6–7；`docs/specs/business-spec-v1.md` §7（MVP「揭露視圖 = trial balance + roll-forward」）
前置已收：realized/unrealized 精確拆分（`pnl_delta_minor` + `pnlBuckets()`，commit `592be8a`）

## 1. Goals

- §11.1 Trial Balance：period × account 餘額彙總視圖（opening / debit_movement / credit_movement / closing），含整表 tie-out（`∑Dr=∑Cr` 且帶號 `∑closing=0`）。
- §11.2 ASU 2023-08 roll-forward：逐資產期間變動表（期初 FV / additions / disposals / gains / losses / 期末 FV），MVP 總額行（§18.2 item 7 明定逐 lot 拆分 deferred）。
- §14 步驟 5/6 lights real 化：je light 升級為完整 TB tie-out；completeness light 由 mock 轉 real+blocking（roll-forward 兩道恆等式）。
- Web 端新 `reports` workspace：TB + roll-forward 完整視圖，證據呈現導向（複核用，非數字堆）。

## 2. Non-goals

- 不做逐 lot realized/unrealized 拆分視圖（§18.2 item 7 deferred；總額行的拆分由 `pnlBuckets()` 支撐）。
- 不做 §11.3 揭露加厚（P1）。
- 不動 export bundle（子專案 5 收斂，見 §8 follow-ups）。
- 不做 §15 執行落差修復批次（子專案 6）。
- 不做同 entity 雙軌並行報告（見 §3 裁決 2）。
- 不做月度期間（period 仍為季度；TB 以 period 抽象實作，不加深 quarter 假設）。

## 3. 關鍵裁決（GTM review 整合，留痕）

1. **OPENING_LOT 歸屬 opening 欄，不入 movement**。與 recon 既有裁決一致（`services/api/src/reconciliation/movement.ts:38-48`：OPENING_LOT declares pre-history holdings, not period activity）。OPENING_LOT 來源 JE 的兩腿（Dr DigitalAssets / Cr OpeningEquity）都折入其所屬期的 `opening_balance`；`debit_movement`/`credit_movement` 只含 period activity。落實 §11.1「首期由 opening balance JE 建立」。tie-out：帶號 `∑closing=0` 恆成立；`∑Dr=∑Cr` 驗 period activity（OPENING_LOT JE 本身平衡，兩腿同折 opening 不破等式）。
2. **TB 為單軌產出**。現有 JE 層是單 active policy + basis lock（`routes.ts` `POLICY_BASIS_LOCKED`），JE 只在 active standard 下產生；§11.1「兩軌各出一份」需雙軌 JE 產生，屬 P1（同 entity 雙報告）。每份 TB 帶 `accountingStandard` + `policySetVersion` 溯源標記。此為對 §11.1 之落地裁決，非沉默偏離。
3. **compute-on-read，零新 TB table**。TB 與 roll-forward 均由既有落庫資料現算（與 recon「recompute-on-read + 覆蓋層落庫」哲學一致，§18.1 ReconciliationRecord 前例）。lock 時 tie-out / 恆等式結果凍入既有 `lightsSnapshot`（滿足 §11.1「納入 lightsSnapshot 作為關帳證據」），零新機制。
4. **LOCKED 期間 drift fail-loud**。對 LOCKED/FROZEN 期間查 TB：重算並與 `lightsSnapshot` 凍結的 tie-out 結果比對，不一致 → response 帶結構化 drift 警示（沿用 lots DTO persisted-vs-recompute drift 模式）。
5. **unknown-class fail-closed**。JE line 的 account 不在 CoA（`accounts` 表查無 class）→ 該列 `class: null`、closing 無法算方向 → tie-out 判 FAIL、je light 紅。寧紅不猜。
6. **IFRS 軌 roll-forward = notApplicable，可稽核**。ASU 2023-08 是 US GAAP 揭露；IFRS entity 產出 `{ notApplicable: true, reason: 'IFRS' }`，completeness light 綠但 lightsSnapshot 記錄 N/A 原因與非顏色線索，非假綠。
7. **VOIDED 防禦性預留**。manual JE 子專案未做、現庫無 VOIDED；TB fold 依 §11.1「以最終狀態呈現」預留 filter（VOIDED JE 不入金額）+ 測試釘住，未來 manual JE 落地不回改 TB。

## 4. 後端設計（`services/api/src/reports/`，新目錄）

### 4.1 `trialBalance.ts`

純函式 `buildTrialBalance(db, entityId, periodId)`：

- 資料源：`journal_entries.je_json` lines（append-only + idempotency key，rerun 安全）；期間歸屬用既有 `period_id`；期序比較用既有 computed cutoff（spec v2.5 裁決，不做 quarter 字串假設）。
- `opening_balance` = fold（period < 目標期之全部 JE）＋ fold（period = 目標期之 OPENING_LOT JE）（裁決 1；period > 目標期一律不入）。首期無前期 → opening 僅含該期 OPENING_LOT。
- 每列：`{ account, class, openingMinor, debitMinor, creditMinor, closingMinor }`；closing 方向由 `accounts.class` 推導（asset/expense 借餘；liability/equity/income 貸餘）。
- 回傳 `{ rows, tieOut: { sumDebit, sumCredit, sumSignedClosing, balanced, failures[] }, meta }`；`failures` 列出可判定原因（unknown-class account 名單、不平差額）。
- `meta`：`{ accountingStandard, policySetVersion, periodStatus, generatedAt }`（裁決 2/4；審計脈絡）。

### 4.2 `rollForward.ts`

`buildRollForward(db, entityId, periodId)`，逐資產總額行（限 `asu_2023_08_applies=true` 之 coin）：

- 期初 FV：`lot_valuation` 上期期末 live 值 / OPENING_FV（seq=0）列。
- additions / disposals：`lot_movement` fold（取得成本 / 依成本基礎釋放，§4.1/§4.2）。
- gains / losses：`pnlBuckets()`（realized 處分 + unrealized 期末重估，正負分列，§5.1）。
- 期末 FV：live unsuperseded `lot_valuation` 現值。
- 兩道恆等式：① `期初 + additions − disposals + gains − losses = 期末`（逐資產）；② 期末 FV 合計 tie 回同期 TB 的 DigitalAssets closing（§14 步驟 6「對得起 TB」）。
- IFRS 軌回 `notApplicable`（裁決 6）。

### 4.3 Lights（`periodLock/cockpit.ts`）

- **je light**：由現行「個別 JE 平衡＋總 Dr=Cr」升級為引用 `buildTrialBalance().tieOut`（新增帶號 `∑closing=0` 與 unknown-class fail-closed）。個別 JE 平衡檢查保留（§14 步驟 5：二者皆須綠）。
- **completeness light**：mock → real+blocking：roll-forward 兩道恆等式全過才綠；IFRS 軌 N/A 綠（裁決 6）。
- lock 凍結沿用既有 `lightsSnapshot` 機制，快照內含 tie-out / 恆等式結果與 N/A 原因。
- ⚠️ 行為改變：completeness real 化後，GAAP FV 軌缺期末重估的期由「可 lock」變「擋 lock」（§14 步驟 4/6 本意）；demo seed 與既有 lock 測試需先跑重估——plan 中列為獨立遷移 task，不得為了讓舊測試通過而削弱 gate。

### 4.4 API（唯讀）

- `GET /entities/:id/trial-balance?periodId=` → §4.1 全量 + drift 警示（LOCKED 期間，裁決 4）。
- `GET /entities/:id/roll-forward?periodId=` → §4.2 全量。

## 5. Web：新 workspace `reports`

- TB 區 + roll-forward 區，期間切換沿用既有模式。
- 證據呈現導向：tie-out 狀態橫幅（FAIL 列出 account 與差額）、period lock 狀態、standard/policySetVersion 標籤、roll-forward 兩道恆等式各自 PASS/FAIL 行、LOCKED drift 警示。
- §15 條文遵循：金額必經統一 formatter（千分位 + scale + U+2212）、`tabular-nums` 右對齊、data-surface 禁 mascot（沿用 `mascot-governance.test.tsx` 斷言模式）、複用既有 table primitive 不另建一套、token-only styling。
- 不順帶修 §15 執行落差批次（non-goal）。

## 6. 測試與驗證（可判定驗收準則）

1. 單元：方向推導（五類 class）、跨期 opening fold、首期（僅 OPENING_LOT）、空期、unknown-class fail-closed、VOIDED filter、OPENING_LOT 不入 movement（與 recon `movement.ts` 語意一致性斷言）。
2. **Mutation（每個新守衛先紅一次）**：弄壞一條 JE 金額 → tie-out 紅；弄壞 pnl 拆分 → 恆等式①紅；DigitalAssets 挪帳 → 恆等式②紅；unknown account 注入 → je light 紅。
3. **Property-based**：隨機平衡 JE 集 → tie-out 永真；隨機弄壞任一條 → 必紅。
4. **三視圖一致性**：TB DigitalAssets closing == recon computed == roll-forward 期末 FV（GAAP FV 軌，同 seed）。
5. Monkey：CoA 空表、account 怪字元、非法 amountMinor 字串、period 格式錯、LOCKED 期間注入 drift。
6. Playwright 實點擊 reports 頁（UI gate）。
7. Gates：api / rules-engine / web 全綠（數字回報）、root typecheck 0、零 `.move` diff（`sui move test` 不適用則實證揭露）。

## 7. Red Team（實作前於 plan 補齊 ≤5 攻擊向量，先列已知）

1. unknown account 繞 tie-out（→ 裁決 5 fail-closed）。
2. IFRS N/A 誤放行 GAAP entity（→ N/A 判定只依 active policy standard，測試釘住兩軌）。
3. lock 後改帳（→ 裁決 4 drift fail-loud）。
4. OPENING_LOT reclass 進出造成 opening/movement 雙算（→ 與 recon 同語意 fold + 一致性測試）。
5. supersede 後殘留 valuation 進期末 FV（→ 只讀 unsuperseded live 列，mutation 釘）。

## 8. Follow-ups（記錄，不在本子專案做）

- 子專案 5（Xero/QBO export）：export bundle 的 `account-activity.csv`（web 端 `trialActivity()`）收斂到後端 TB 單一真相源（Rule 7 分叉留痕）。
- 同 entity 雙軌並行 TB（P1，依賴雙軌 JE 產生）。
- 月度期間化（TB 以 period 抽象實作，屆時零改動）。

## Revision log

- v1.0（2026-07-13）：brainstorming 定稿。方案 A（compute-on-read）；GTM review 11 條全收（OPENING_LOT 歸屬修正、單軌裁決、LOCKED drift、審計 meta、N/A 可稽核、export 分叉留痕、證據呈現 UI、property/三視圖一致性測試）。
- v1.1（2026-07-13）：Task 2 executable derivation 定案 roll-forward 恆等式（`docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md`，`reports.rollforward.derivation.test.ts` 逐期零殘差）。**偏離 §4.2 字面**：disposals 依 **carrying**（成本 + 已釋放估值）減除，非「依成本基礎」；gains/losses = 當期未實現重估 delta（含 OPENING_FV 轉換），realized 處分損益不入資產 roll-forward（走恆等式② tie 回 TB）。理由：**成本基礎公式（disposals 依 cost、gains 淨 releaseRemoved）代數上與 carrying 版本恆等，兩者皆逐期零殘差**（`candidateAWithReclass`，memo §0/§3 executable 證明）——採 carrying 是**呈現層 / 欄位配置**裁決，非數學必要：§11.2 固定六欄無獨立 reclass 欄，releaseRemoved 折入 disposals 最不失真（塞進 losses 會誤呈已認列估值移轉為新虧損）。**此裁決已於 2026-07-13 由使用者確認採用 carrying（B）版本。** 缺 reclassOffset 的 naive 版本（disposals 依 cost + realized reclass 硬加回，未 net releaseRemoved）才是逐期高估的錯誤版本（Q2+10000/Q3+45000，雙算已釋放估值），非「成本基礎不可行」。additions 含 OPENING_LOT（純期界 Choice X，保 openingFV(P)=closingFV(P−1) 連續）。Task 3 依 memo 實作，不採 §4.2 字面。
