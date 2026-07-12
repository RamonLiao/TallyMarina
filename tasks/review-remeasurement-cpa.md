# CPA Desk Check — 期末重估雙軌 Design Spec

- **審查對象**：`docs/superpowers/specs/2026-07-12-remeasurement-dual-track-design.md`
- **上游權威**：`docs/specs/accounting-spec-v1.md`（§4.4.1 / §5 / §6 / §7.3 / §9 / §11 / §14）；分期以 `business-spec-v1.md` §7 為準
- **審查人視角**：CPA（US GAAP ASU 2023-08 / ASC 350-30；IFRS IAS 38/36），全新眼光、未參與設計
- **日期**：2026-07-12
- **計數**：Blocker ×3、Should-fix ×7、Nit ×2

> 行號標記：`D#` 指設計 spec §3 裁決表；`§x.y` 前綴 `[設計]` 指被審 spec，無前綴指 accounting-spec-v1。

---

## BLOCKER

### B1 — 處分「已重估/已減損 lot」的口徑完全缺席；D3「FIFO 零改動」在兩軌都出錯帳
**位置**：設計 D3（行 35）、[設計]§4.1–§4.2（行 46–54）、Non-Goals（行 20–27，未列此互動）
**準則對位**：§4.2（行 204–218）、§5.1/§5.2、§11.2（行 616–629）、§14 步驟 5/6（行 748–749）

設計把成本軌（`lot_movement`）與衡量軌（`lot_valuation`）分離，並明文宣稱「現有 FIFO/tie-out 零改動」。但重估 JE（[設計]§4.1/§4.2）**確實貼進真實 GL 的 `DigitalAssets` 科目**（升值 `Dr DigitalAssets`、減損 `Cr DigitalAssets`）。FIFO 處分腿（§4.2）卻仍以 `lot_movement` 的**原始成本**貸出 `DigitalAssets`。兩者對同一個 GL 科目、不同口徑 → 已重估 lot 一旦被處分，重估調整額在 `DigitalAssets` 變成孤兒餘額，且處分損益重複計算。

**GAAP FVTPL 出錯序列**：
1. 買入 lot：cost 1,000 → `Dr DigitalAssets 1,000`。
2. 期末 FV 1,400 → 重估 `Dr DigitalAssets 400 / Cr UnrealizedGain 400`。`DigitalAssets`=1,400，已認列未實現利益 400。`lot_valuation` current=1,400。
3. 次期全數處分，售得現金 1,500。設計 FIFO「零改動」→ `Cr DigitalAssets 1,000`（成本）、`DisposalGain = 1,500 − 1,000 = 500`。
4. **結果**：累計利益 = 400（未實現）+ 500（處分）= 900，但真實經濟利益僅 1,500 − 1,000 = 500，**高估 400**；且 `DigitalAssets` 只被貸 1,000，殘留 +400 對應一個已不存在的 lot。正確處理應是處分時以重估後 carrying 1,400 除列、把 400 未實現重分類為已實現、只認增量 100。

**IFRS 成本+減損 出錯序列**（回答任務問「處分時吃原成本還是減損後 carrying」）：
1. 買入 lot cost 1,000。
2. 期末減損至 recoverable 700 → `Dr ImpairmentLoss 300 / Cr DigitalAssets 300`。`DigitalAssets`=700。
3. 次期全數處分售得 750。設計 FIFO「零改動」→ `Cr DigitalAssets 1,000`、損益 = 750 − 1,000 = −250 loss。
4. **結果**：累計損失 = 300（減損）+ 250 = 550，真實損失僅 1,000 − 750 = 250，**高估 300**；`DigitalAssets` 被貸 1,000 但該 lot 帳上只剩 700，把科目灌成負 300。正確：處分應吃**減損後 carrying 700**，損益 = 750 − 700 = +50。

**下游後果**：所有 lot 最終出清後 `DigitalAssets` 不歸零，殘 = 全歷史重估/減損 delta 之和 → §14 步驟 6 roll-forward「期末 FV 對得起 TB 期末餘額」**必然對不平**，completeness light 紅。個別 JE 仍平（step 5 不擋），錯誤延遲到 step 6 才炸。

**為何不可延到子專案 4**：ASSET_DISPOSAL 與期末重估**同屬 MVP**（business §7 行 101、§3 taxonomy 行 123），MVP 內兩者必然共存。§11.2 只把「realized/unrealized **揭露拆分**」延後（§18.2 item 7），但 `DigitalAssets` GL 餘額正確性、處分損益正確性**不可延後**——設計把「可延後揭露拆分」誤當成「可讓處分吃原成本」。這是兩件事。

**修法方向**：處分腿必須改為吃「重估後 carrying」（= 原成本 + 該 lot 累計 `lot_valuation` delta），並在處分 JE 內把先前未實現/減損 fold 出來重分類（GAAP→realized gain/loss；IFRS→沖回 AccumulatedImpairment 或反向）。D3「FIFO 零改動」的前提不成立，至少須擴充處分腿讀 `lot_valuation`。若團隊堅持本案不做，**必須在 Non-Goals 明列「處分側口徑改動」並標注「在該改動落地前，任何處分已重估 lot 都會出錯帳」**（fail-loud，違反 CLAUDE Rule 12 的靜默略過）。

**分級：Blocker**（沉默的正確性缺口，跨兩軌，MVP 內即觸發）。

---

### B2 — `lot_valuation.basis` 缺 `GAAP_COST`（ASC 350-30），迴轉禁令無法由落庫資料驅動
**位置**：[設計]§5 schema（行 80–88，`basis` 僅 `'GAAP_FV' | 'IFRS_COST'`）、[設計]§4.1（行 48，範圍外 GAAP 走 ASC 350-30「與 IFRS 成本軌共用減損計算，但迴轉分支硬性禁用」）
**準則對位**：§5.1 附註（行 314）、§2.1 accounting_class（`INTANGIBLE_ASSET_ASC350_30`，行 69）、§10.3

設計自己承認 GAAP 有兩種子處理：ASU 2023-08 FVTPL **與** 範圍外 ASC 350-30 成本減減損（不可迴轉）。但 `basis` 枚舉只有兩值。ASC 350-30 減損 lot 的 valuation 只能被塞成 `IFRS_COST`——而 `IFRS_COST` 正是**允許迴轉**的那一軌（[設計]§4.2）。

**出錯序列**：GAAP entity 持有一個範圍外 token（`asu_2023_08_applies=false`）。期末減損 → 寫入一列 `basis='IFRS_COST'`（因無 GAAP_COST 可選）。後續期 recoverable 回升，`revalueLots` 若以 `basis` 欄位判斷是否允許迴轉（[設計]§4.2「上限與累計減損從 `lot_valuation` fold 出來」、[設計]§8「未知 basis fail-loud」），會看到 `IFRS_COST` → **放行迴轉 `Dr DigitalAssets / Cr ImpairmentReversalGain`**，違反 ASC 350-30「no write-up」（§5.1 附註硬禁）。

設計的迴轉禁用若改為「靠 live policy（`accounting_standard=US_GAAP` + `asu_2023_08_applies=false`）判斷、不靠 basis」，則落庫列被**錯誤標記**成 IFRS_COST，任何純讀 `lot_valuation` 的下游（roll-forward、迴轉上限 fold、稽核回溯）都無法分辨這是「GAAP 禁迴轉」還是「IFRS 可迴轉」，且 policy 誤讀/改軌即繞過守衛。[設計]§8 說「未知 basis fail-loud」擋不住這個——`IFRS_COST` 不是未知，是**張冠李戴**。

**修法**：`basis` 增列 `GAAP_COST`（或獨立 `reversal_allowed` 布林），使 ASC 350-30 lot 可被落庫識別、迴轉守衛由持久化資料驅動。[設計]§10 測試「ASC 350-30 迴轉必須被拒」的紅燈必須釘在**讀 basis 的守衛**上，而非只靠 live policy。

**分級：Blocker**（會計硬禁令 no write-up 有被繞過路徑；schema 設計缺陷，落地後改 enum 成本高）。

---

### B3 — staleness 只追 `priceSetHash`，抓不到 run 後新增/處分的 lot；green light 不保證 §14 步驟 4 完整
**位置**：D8（行 40）、[設計]§6 cockpit DTO（行 98）、編排（行 100 `foldRemainingLots` 於 run 時讀當下 lots）
**準則對位**：§14 步驟 4（行 747，「該期**所有**落範圍資產之重估分錄已產生並 posted」）、§14 步驟 6

run 在執行當下 fold 當時的 remaining lots。green 燈條件 = 「最新 run 未 supersede **且** run 的 `priceSetHash == 現價格集 hash`」——**只感測價格集變動，不感測持倉集變動**。

**出錯序列**：
1. 期中已攝取 A、B 兩 lot（同 coin_type，已有價）。run 重估 A、B → 燈綠。
2. Lock 前又攝取同 coin_type 的新 lot C（期末前取得、期末仍持有 → §14 步驟 4 要求須重估）。C 不需新價（coin_type 已有價）→ `priceSetHash` 不變 → **燈續綠**。
3. Lock gate 吃這盞綠燈 → 放行關帳。**C 從未被重估**，違反步驟 4「所有範圍資產」。roll-forward（步驟 6）additions 含 C 成本、但 C 無期末重估 gain/loss → 期末 FV 對不平（延遲爆）。

同理，run 後發生的**處分**也會讓已重估的 `lot_valuation` 與現持倉脫節。

**修法**：staleness 需同時綁「持倉集/事件集」指紋（如該期 max event seq 或 lot-set hash），run 後任何影響持倉的事件都應把燈轉黃逼重跑，不能只看 `priceSetHash`。

**分級：Blocker**（直接破壞 §14 步驟 4 這條被任務點名的 MVP 硬需求；green 不代表完整）。

---

## SHOULD-FIX

### S1 — ASU 過渡 JE 只寫單向（`opening_fv > 成本`），漏 `opening_fv < 成本` 反向
**位置**：[設計]§4.4（行 63，只列 `Dr DigitalAssets / Cr RetainedEarnings`）
**準則**：§7.3（行 462，明列「`opening_fv < 歷史成本` 時借貸反向：`Dr RetainedEarnings / Cr DigitalAssets`」）

導入日 FV 低於歷史成本（熊市 cut-over 常見）時方向相反。設計只給一向，實作者照抄會把貶值過渡調整方向寫反。補上反向分支即可。**分級：Should-fix**。

### S2 — 過渡 run 內「cost→opening_fv 進 RE」與「opening_fv→期末 FV 進 P&L」未明確兩段分離，有把整期 FV 變動灌進 RE 的風險
**位置**：[設計]§4.4（行 62–64，seq-0 記 opening_fv）＋ §4.1（行 46–47）
**準則**：§7.3（行 453，「歷史成本與導入日 FV 之差額屬過渡累積影響…**不進當期損益**」）；ASU 2023-08 過渡＝cumulative-effect 到期初 RE

首次 GAAP run 同時要做：(a) 過渡 JE `cost → opening_fv` 進 **RetainedEarnings**；(b) 首期期末重估 `opening_fv → 期末 FV` 進 **P&L**。設計把兩者都塞進「首次 run」但未明訂「首期重估的 prior_carrying baseline 必須是 seq-0 的 `opening_fv`，而非原成本」。若實作誤用原成本當 baseline，會把 `cost → 期末 FV` 全額進 P&L（過渡調整漏做），或反之全進 RE（整期 P&L 變動被埋進權益）。請明訂執行序與 baseline。**分級：Should-fix**（推測性風險，取決於實作；spec 應釘死）。

### S3 — 重跑（D6 反向沖銷）與一次性過渡 JE 的交互未定義，恐把 cumulative-effect 沖掉
**位置**：D6（行 38）＋ [設計]§4.4 冪等（行 65，「以 seq-0 記錄存在與否判定」）＋ [設計]§6 run（行 96，「先 post 反向 JE + supersede 舊 valuation」）
**準則**：§7.3（過渡＝一次性 cumulative-effect）

Lock 前重跑 = 對舊重估 JE 出反向 + valuation supersede。但過渡 JE 打到 **RetainedEarnings**（權益），是一次性、與期末重估性質不同。spec 未講重跑是否會連過渡 JE 一起反向。若 (a) 反向了過渡 JE，且 (b) 冪等靠「seq-0 存在」判定又阻止重建 → 過渡調整被淨沖掉、RE 錯。反之若 supersede 把 seq-0 標記 superseded 卻仍算「存在」，語意也含糊。請明訂：**重跑只反向期末重估 JE，過渡 JE（seq-0/RE）不參與 supersede**。**分級：Should-fix**（append-only 邊界的真實 edge bug）。

### S4 — 迴轉上限「原始成本」在部分處分後會被高估（cap 來源用錯表）
**位置**：[設計]§4.2（行 54，「per-lot 原始成本為上限——上限與累計減損從 `lot_valuation` fold 出來」）
**準則**：§5.2（行 335，上限＝「若未曾減損原應有 carrying」＝原成本，數位資產無攤銷）；§7.2 `remaining_qty`

原成本上限應是**剩餘數量**的原成本 = `remaining_qty × unit_cost`（來自 `lot_movement`）。但 `lot_valuation` 沒有 qty/unit_cost 欄位，其 carrying 金額混合了不同時點的數量。部分處分後 `remaining_qty` 下降，若上限仍從 `lot_valuation` 的歷史 carrying fold（隱含較大數量），會**高估上限**，允許把剩餘部位迴轉到超過其應有原成本 → 虛增 `ImpairmentReversalGain`。

**出錯序列**：lot 100 單位 @cost 10（原成本 1,000）→ 減損到 700 → 處分 50 單位 → 剩 50 單位（應有原成本上限 = 500）→ 後期迴轉時若 cap 仍取 fold 出的 1,000，可迴轉到 carrying 1,000 而非 500。**修法**：迴轉上限改由 `lot_movement`（`remaining_qty × unit_cost`）計，`lot_valuation` 只 fold「累計已認列減損」以限制迴轉不超過曾認列的損失。**分級：Should-fix**。

### S5 — `price_points` schema 丟失 `quote_currency`（USD 硬編碼）與 `principal_market`；`lot_valuation`/JE 無 `price_point_id` 稽核連結
**位置**：[設計]§5 `price_points`（行 71–78）、`lot_valuation`（行 80–88）
**準則**：§6.1（行 355–368，PricePoint 欄位含 `quote_currency`、`principal_market`、`staleness_seconds`；末段「引用之 `price_point_id` 須隨 JE 留存供審計回溯」）、§6.5、§1.3（禁 USD 硬編碼散落）

三個缺口：
- `price_minor` 直接假設「法幣 minor 2dp」= USD，**無 `quote_currency` 欄**，違反 §1.3「禁 USD 硬編碼散落」（即使 MVP 恆 USD，欄位不得省）。
- 無 `principal_market`：§6.5 要求同資產跨期一致採同一市場、供審計檢視一致性。
- `lot_valuation` 與重估 JE **無 `price_point_id` FK**：§6.1 末段硬性要求價格證據隨 JE 留存以回溯。設計改用 `priceSetHash`（一個聚合 hash）做 staleness，但那不等於「這筆重估用了哪一筆 PricePoint」的稽核連結。

**分級：Should-fix**（§6.1 稽核回溯是硬要求；quote_currency 是 P1 多幣別的地雷）。

### S6 — 負 gas 的「當期已認列 gas 費用餘額」未明訂為「依事件時間序、as-of 本事件位置」，決定性存疑
**位置**：D9（行 41）、[設計]§4.3①（行 58）
**準則**：§4.4.1（行 259，「上限以**該 JE 入帳時點、依事件時間序**已認列之當期 `GasFeeExpense` 累計餘額為準（決定性：同一事件集重跑必得相同拆分）」）

設計說「由 api 算好當期已認列 gas 費用餘額組進 RuleInput」，但沒說是「as-of 本事件在時間序中的位置」的累計，還是「整期總額」。若用整期總額（含本事件之後的 gas），重跑或亂序攝取時 contra/rebate 拆分會漂移，破壞 §4.4.1 明訂的決定性。請明訂 api 計算的是**時間序截至本事件**的累計餘額。**分級：Should-fix**。

### S7 — 期末價 `as_of` 與 period end 的對應無驗證；手動價的 staleness 語意未定
**位置**：[設計]§4.2（行 52，「價格 cut-off 依上游 §6.4，本案不重定義」）、`price_points.as_of`（行 74）、§7 手動輸入 UI（行 105）
**準則**：§6.4（行 394，期末＝entity 時區 23:59:59→UTC，取該時點前最近未 stale PricePoint）、§6.3 staleness

`price_points` 以 `(coin_type, as_of)` 取最新，但 spec 未定義 run 如何由 `periodId` 推導出目標 `as_of`、以及如何驗證使用者手動輸入的 `as_of` 確實對應該 period 的日曆日切。風險：使用者輸入期中價或錯期價，run 照收 → 重估基礎錯。且 §6.3 的 24h staleness 對「月結期末手動價」語意矛盾（月結價天生 >24h）——設計把手動 LEVEL_2 當 MVP 主路，卻未說明手動價如何豁免/適用 staleness 門檻。請明訂 periodId→as_of 目標的推導與 as_of 落在 period 邊界的驗證。**分級：Should-fix**。

---

## NIT

### N1 — GAAP 範圍外「與 IFRS 成本軌共用減損計算」是計量基礎的口徑混用
**位置**：[設計]§4.1（行 48）
IFRS IAS 36 減損測 **recoverable amount = max(FVLCD, VIU)**；US GAAP ASC 350-30 對不定期限無形資產減損測 **fair value**（減記至 FV）。兩者計量基礎不同。MVP 以期末 PricePoint 當 proxy（≈FVLCD≈FV）時數字常相同，故影響低；但「共用減損計算」措辭在概念上不精確，且 ASC 350-30 傳統「按當期最低觀察價減損」被 MVP 簡化為期末單點（可接受但應註明）。建議措辭改為「數字上以期末 FV proxy，兩軌計量基礎在 MVP 收斂」。**分級：Nit**。

### N2 — 重估 JE line 未明述保留 `currency`/`fx_rate`（MVP 恆 USD/1.0 亦不省）
**位置**：[設計]§6 編排（行 100，「走 journalStore 同店」）
**準則**：§1.3（行 42，JE Lines 保留 `currency`/`fx_rate`，MVP 恆 USD/1.0 亦不省略）
推測重估 JE 沿用既有 line schema 即滿足，但 spec 未明述。若 revalueLots 自造 line 而漏欄則違反 §1.3。順手確認即可。**分級：Nit**。

---

## 對軌檢查結論

設計 spec 對**孤立的**重估/減損/負 gas/過渡 JE 模板，大體忠於 accounting-spec-v1 的兩軌定義（§5.1/§5.2/§4.4.1/§7.3 逐項對得上）。但有三處實質偏離/漏做，且非全在 Non-Goals 交代：

1. **偷改口徑（B1）**：D3「FIFO 零改動」與 §4.2 處分成本口徑、§5.1/§5.2 除列口徑衝突 → 處分已重估/已減損 lot 兩軌都出錯帳。屬**靜默偏離**（Non-Goals 未列），違反 fail-loud。
2. **漏 MVP 硬需求（B3）**：staleness 只追價格不追持倉 → §14 步驟 4「所有範圍資產已重估」可在 green 燈下被繞過。
3. **schema 表達力不足 → 準則守衛可繞過（B2）**：`basis` 缺 GAAP_COST，ASC 350-30「no write-up」硬禁令無法由落庫資料驅動。

其餘 Should-fix 多為 spec 欠明確（過渡方向/序、重跑×過渡交互、迴轉上限來源、價格稽核連結、決定性、as_of 對應），實作前補清即可，不涉及推翻設計骨架。

**若只修一項**：B1（處分互動）。它同時決定 §14 步驟 5/6 能否 tie-out、roll-forward 能否成立，是整個雙軌能不能收斂到正確帳的地基。
