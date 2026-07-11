# 三路 Review Findings（2026-07-11，設計文件 rev2 的依據；規格書撰寫素材）

受審對象：`docs/superpowers/specs/2026-07-11-gtm-spec-v1-design.md` rev1。
已整合為 rev2/rev3 的 D13–D19 與章節變更；本檔保留完整 findings 供規格書撰寫時展開細節。

## 一、sui-architect review

1. **D7 需改（已整合）**：JSON-RPC 2026-07-31 永久停用。正確架構分兩條 workload：
   增量攝取 = gRPC checkpoint streaming（`SubscribeCheckpoints`）；歷史 backfill +
   逐期餘額重建 = custom indexer（tail checkpoint 落自有 DB），gRPC 只是 transport。
   GraphQL 仍 beta，只當 backfill 輔助，不當主查詢層。
2. **餘額 API**：即時餘額用 gRPC `addressBalance`（全類型；`coinBalance` 只有同質幣，
   會計期末要 addressBalance）。「過去某 checkpoint 的餘額」無法 live 查，必須從
   indexed 歷史重建 → custom indexer。
3. **D5 OK**：audit_anchor 合約是 Sui best-practice 範本（shared 常數大小 chain head、
   歷史存 event、hash-only、cap-based 授權防 sponsored 偽造、PAT-VM-1 version gate、
   Merkle inclusion proof）。過渡語意要明寫：Walrus P1 前 manifest 只存自有 DB。
4. **Taxonomy 缺 Sui 交易分解層（已整合為會計冊 §13）**，易漏接形態：
   (a) PTB 多指令原子分解（1 digest → N events，否則 swap+transfer+gas 同筆誤帳）；
   (b) gas = computation + storage − rebate，淨額可負；
   (c) sponsored tx 的 gas payer ≠ entity，gas 事件需 payer 欄位；
   (d) 有價 object（NFT/Kiosk/StakedSui/LP position）以物件移動，只讀 balanceChanges 會漏；
   (e) coin split/merge 內部 churn 要過濾，否則產生假事件；
   (f) accumulator / native-balance 直接借貸不產生 coin object，讀 objectChanges 會漏。
5. **配置錯置（已整合）**：Seal 應與 Walrus 審計包綁 P1（審計包=JE 明細，公開 blob=洩漏）；
   價格來源是 MVP 硬依賴（重估需要），Nautilus/Pyth 是 Sui-native 解；
   anchoring 需 SUI gas → sponsored tx（Enoki）/gasless 值得評估（附錄 C）。

## 二、會計師視角 review（16 findings）

MVP-blocker（6）：
1. **Manual JE / Adjustment / Reversal 完全缺席**：分類更正、應計、審計調整、
   已匯出 JE 的反向沖銷（Xero/QBO 匯入後不可改）。→ 會計冊 §8 + §12 沖銷約定。
2. **期初餘額 / cut-over 導入未規格化**：opening lot（cost basis、取得日）；
   處分量超過已知 lot 的例外流程。code 已有 `opening_lot` 但規格沒收。→ §7。
3. **定價規格缺章**：價格來源與 fallback、期末 cut-off 時點（會計日 vs block
   timestamp）、stale/缺價處理、principal market。→ §6。
4. **Functional currency / FX**：已裁定 D15 = MVP USD-only + 可插拔接口，
   明文入非目標；IAS 21/ASC 830 P1（TW/JP/HK/KR 市場）。
5. **月結流程章缺席**：關帳順序與 blocking 條件（事件全分類 → recon 乾淨 →
   重估過帳 → TB → roll-forward → lock → snapshot/anchor → export）。→ §14。
6. **CEX 存提分期矛盾**：CSV import 進 MVP 但 CEX 事件類型在 P1 → 拉進 MVP
   （transfer 子型，F4 §3.4，成本極低）。

P1-should（7）：
7. 減損子節：IFRS 迴轉允許（原成本上限）vs GAAP 禁止；跡象/頻率/recoverable amount。
8. ASU 2023-08 揭露不只 roll-forward：significant holdings 逐資產、出售限制、
   FV 變動損益表單行淨額、cost basis method；realized/unrealized 拆分需 per-lot
   累計 FV 調整追蹤（資料模型需求 → §18）。
9. IFRS revaluation model 機制：OCI/revaluation surplus 科目、減值先沖 surplus、
   IAS 38.75 active market 警示、CoA seed 含權益科目。
10. Stablecoin IFRS 9 分類後續衡量：amortized cost vs FVTPL、de-peg 處理、
    CASH_EQUIVALENT 的口徑後果。
11. 期間重開程序：lock 後調整 vs 入次期；對已 anchor Merkle root 的處理。
12. 尾差/rounding：9-decimal × 價格 → 2-decimal 的平衡容差與 rounding 科目。
13. Staking reward 過渡（已整合 D18）：MVP 以 receipt + economic_purpose 映射
    Cr Staking Income。

nice-to-have（3）：
14. 最小 change log 提前 MVP（已整合 D19）：PolicySet/MappingRule 變更 +
    review 人工決策紀錄，否則 AI 分類對審計師是黑箱。
15. PricePoint 帶 FV hierarchy level（level 1/2）欄位。
16. 非目標明文「不做 tax basis 與遞延稅」。

OK 面向：雙軌+PolicySet 架構、FIFO MVP/WAC P1（註記 L2 基金偏好 WAC）、
TB+重估 MVP/三大表 P2、ERP 選型、anchor 定位、gas 資本化選項承接。

## 三、frontend-design review

總判定：設計系統有真意圖（TallyMarina paper/ink/brass/aqua、語意色合約、
mascot governance、break-precision 渲染），達 GTM 水準；問題是執行落差。

執行落差（MVP 修復批次，D17）：
1. `web/src/tokens.css:34` + `web/index.html:10`：`--font-body: 'Mona Sans'` 從未載入，
   實際 fallback system-ui。→ self-host 或改誠實 token。
2. 字體雙重載入且矛盾：tokens.css `@import`（離散 400;600;700）vs index.html
   `<link>`（range 400..600）；`base.css:50` 的 `font-weight: 560` 只有 range 版能渲染。
   → 收斂 index.html 單一來源。
3. `web/src/components/data/JournalTable.tsx:66-67`：金額渲染 raw minor（`5000000000`），
   無千分位無 scale 換算。recon 已有 `fmtMinor`（`ReconTable.tsx:11`，grouping +
   U+2212）→ journal 重用；raw minor 留 tooltip。
4. JournalTable 整表 inline style 繞過 `Table.module.css` primitive；表格實作共 4 套
   （primitive / recon / policy+onboarding 複製貼上 / journal inline）→ 收斂到
   primitive + modifier。
5. Badge/pill 5 套；`policy.css:8-9` 與 `close.css:106` brass 底白字對比 ~3.1:1
   （<4.5:1），違反 `Button.module.css:3` 自訂規則「brass fill 配 navy 文字」；
   fallback hex 與 tokens 正典值漂移。
6. `ExceptionsWorkspace.tsx:22-70`、`AuditWorkspace.tsx:37-60` 版面骨架 inline style；
   Audit 借用 `.exceptions-layout` 命名撒謊 → 抽中性名。
7. `CloseCockpit.tsx:53` 裸原生 `<button>`（Reopen 是敏感治理動作）→ ghost/danger variant。
8. 標題層級：workspace 內部卡片標題有的 `h2` 有的 styled `<div>`，SR 導航與視覺不同步。
9. Exceptions 摘要「N open · N blocking close」是最重要數字卻最小（`--text-sm`）；
   Exceptions/Recon 缺 Close cockpit verdict 行的對等物。

規格條文（會計冊 §15 的 5 條，可判定）：
1. 金額必經 formatter（千分位+scale+U+2212）；數字欄右對齊+tabular-nums+mono；
   scale 未知渲染 raw minor 帶 `?` 上標，禁止 default scale（後半已是 runtime throw）。
2. 語意色合約：aqua 僅 on-chain/anchor；credit/debit 僅借貸與通過/阻擋；brass =
   manual/off-chain 與導航 CTA；status 色必伴非顏色線索；brass 底文字必為 ink，
   禁白字（對比 <4.5:1 即 fail）。
3. Token-only styling：元件禁 hex 字面值與繞過 type scale；表格/badge/button 必用
   shared primitive；可用 stylelint declaration-strict-value 判定。
4. 字體：display=Fraunces、mono=IBM Plex Mono、body 必須實際載入；宣告單一出處，
   禁 `@import` 與 `<link>` 並存。
5. Data-surface 紀律：mascot/裝飾禁入 journal 表、hash、對帳格、簽名 modal；
   驗收沿用 `mascot-governance.test.tsx`。

正面資產（商業冊 §4 差異化佐證）：break-precision 渲染（leading-zero 調暗）、
語意色合約、mascot governance、close cockpit lights-grid 色盲可讀設計。
