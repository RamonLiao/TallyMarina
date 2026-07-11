# GTM 正式規格 v1.0 — 設計文件（2026-07-11，使用者已逐節確認；同日經三路 review 修訂 rev2）

## 背景與動機

專案現況與初始規格（`Ideas/` F1–F9）已出現投資比重偏移：核心會計 kernel（雙分錄、
FIFO lots、對帳、期間鎖）符合原設計，但「會計師每月實際作業」缺口大（期末重估、
trial balance、可配置 PolicySet/CoA、ERP 欄位映射、真鏈 ingestion）。完整差距分析：
`tasks/spec-gap-analysis.md`。ERP 目標市場研究：`tasks/research-erp-targets.md`。

本設計定義「GTM 正式規格 v1.0」兩份文件的結構、內容決策與分期，取代 `Ideas/` 的
三份對話稿（F4 會計規格 / F5 商業規格 / F6 資料模型）成為權威規格。

rev2：經 sui-architect、執業會計師視角、frontend-design 三路獨立 review 修訂，
變更見「修訂紀錄」。

## 已定案決策（含使用者裁定）

| # | 決策 | 裁定 |
|---|---|---|
| D1 | 路線：重對準（re-aim），不重寫 | 使用者 |
| D2 | 準則：IFRS/GAAP 雙軌，PolicySet 切換 | 使用者 |
| D3 | 文件結構：兩本分冊（商業 + 會計技術），共用詞彙表 | 使用者 |
| D4 | 範圍：全貌 + MVP/P1/P2 分期標注 | 使用者 |
| D5 | 審計層：audit_anchor 合約留作完整性層；Walrus 審計包列 P1。過渡語意明文：Walrus 前 manifest 只存自有 DB（anchor 證完整性、可取回性 P1 才有） | 使用者；過渡語意 rev2 補 |
| D6 | Ingestion MVP：Sui 鏈上 + 通用 CSV import；CEX API connector 列 P1 | 使用者 |
| D7 | Sui 資料層（rev2 精確化）：gRPC 為 transport（JSON-RPC 2026-07-31 永久停用，`SuiJsonRpcSource` 必汰換）；增量攝取 = gRPC checkpoint streaming；歷史 backfill 與逐期餘額重建 = custom indexer 落自有 DB；GraphQL（beta）僅輔助；期末餘額用 addressBalance（非 coinBalance） | 使用者提醒 + sui-architect review |
| D8 | ERP export MVP：Xero manual journal CSV + QuickBooks Online journal CSV；NetSuite（Import Assistant CSV）列 P1；SAP 不做 | 研究數據（`tasks/research-erp-targets.md`） |
| D9 | 寫法：目標態主文 + 現況差距附錄（實作推進只更新附錄） | 使用者 |
| D10 | ICP 採 F2/F9 三層；修正 F5 兩層簡化訛誤 | Claude 裁定，已標記 |
| D11 | 定價模式進商業冊（F9：月交易量 + 實體數 + 模組計價） | Claude 裁定 |
| D12 | 全文中文；DeepBook/SuiNS 降商業冊附錄「機會清單」 | Claude 裁定 |
| D13 | **價格來源是 MVP 硬依賴**（重估/FV 需要）：新增 Pricing 章（MVP），來源含 oracle（Pyth/Nautilus 評估）+ 手動輸入 fallback | rev2：sui-architect + 會計師 review 同時命中 |
| D14 | **Seal 與 Walrus 審計包綁定同列 P1**（審計包含 JE 財務明細，公開 blob = 洩漏），自附錄拉回 roadmap | rev2：sui-architect review |
| D15 | **FX 範圍（使用者已確認）**：MVP 限單一 functional currency = USD，明文寫入商業冊非目標。但架構必須模組化保留擴充接口：幣別換算集中於 rules engine 的 Price/FX lookup 階段（可插拔）、functional_currency 只存在於 PolicySet 欄位（禁止 USD 硬編碼散落）、JE lines 保留 currency/fx_rate 欄位。P1 多幣別（IAS 21/ASC 830）目標市場：台灣/日本/香港/韓國 | rev2：會計師 review；使用者 2026-07-11 確認 |
| D16 | **CEX 存提拉進 MVP**（transfer 子型，F4 §3.4）：CSV import 進 MVP 而事件類型留 P1 互相矛盾，修正 | rev2：會計師 review |
| D17 | 規格書新增 **UI/UX 標準章**（5 條可判定條文，見文件二 §15）；現有 UI 執行落差（字體未載入、4 套表格、journal 金額不可讀）列 MVP 修復批次 | rev2：frontend-design review |
| D18 | staking 三態整包留 P1，但 MVP 註記過渡方案：staking reward 以 receipt + economic_purpose 映射 Staking Income | rev2：會計師 review |
| D19 | MVP 含最小 change log（PolicySet/MappingRule 變更 + review 決策紀錄）；完整 RBAC+audit log 仍 P1 | rev2：會計師 review |

## 文件一：商業規格書 v1.0（`docs/specs/business-spec-v1.md`）

1. 產品定位與問題陳述（沿 F5 §1-2；定位句用 F2 Phase 0 版）
2. ICP 三層（D10）
3. GTM 分階段與商業模式（F2 Phase 1/2 + F9 切入順序；D11 計價）
4. 競品與差異化（F1 競品表；三差異化 + ERP 研究實證；UI 簽名元素
   （break-precision 渲染、語意色合約）列為 close-workflow 差異化佐證）
5. 功能模組總覽（F5 §6 的 7+2 模組，每模組標 MVP/P1/P2）
6. 非目標（明文）：不取代 ERP；MVP 不做三大報表引擎；不做稅務申報與
   tax basis/遞延稅；不支援 SAP；MVP 限單一 functional currency（D15）
7. 分期 roadmap（見下方分期表）
8. 附錄 A：現況差距對照（自 `tasks/spec-gap-analysis.md`，隨實作更新）
   附錄 B：共用詞彙表（兩冊唯一定義出處）
   附錄 C：Sui 生態整合機會（DeepBook/SuiNS/Enoki sponsored-tx anchoring 評估）

## 文件二：會計技術規格書 v1.0（`docs/specs/accounting-spec-v1.md`）

1. 準則範圍：IFRS/GAAP 雙軌（D2）；functional/reporting currency 範圍（D15）
2. 資產分類模型（F4 §2）+ 穩定幣三選項政策；含分類後續衡量與 de-peg 處理、
   CASH_EQUIVALENT 的報表口徑後果（P1 細節）
3. 事件 taxonomy：F6 完整 12 類；MVP 覆蓋 = 現有 5 類 + 期末重估 + CEX 存提
   （transfer 子型，D16）+ staking reward 過渡映射（D18）；staking 三態
   完整版/CEX API 標 P1
4. 事件→JE 處理規範：每事件 Dr/Cr 模板，IFRS/GAAP 各一軌；JE 平衡容差與
   rounding difference 科目
5. 期末重估/減損（MVP）：GAAP 軌 = ASU 2023-08 FV；IFRS 軌 = cost + impairment
   預設、revaluation model 為政策選項。子節：減損跡象/頻率/recoverable amount、
   IFRS 迴轉上限 vs GAAP 禁止迴轉；revaluation 機制（OCI/surplus 科目、
   IAS 38.75 active market 警示）列 P1 細節
6. Pricing / PricePoint 規格（MVP，D13）：價格來源優先序（oracle → 手動輸入）、
   fallback 與 stale/缺價處理、期末 cut-off 時點定義（會計日 vs block timestamp）、
   FV hierarchy level 欄位（level 1/2 標注）
7. Cost basis：FIFO（既有）+ WAC（P1）；PositionLot 模型；**期初餘額/cut-over
   導入規格**（opening lot 含 cost basis 與取得日）與 lot 不足例外流程（MVP）
8. **Manual JE / Adjustment / Reversal（MVP）**：手工分錄、更正、應計、
   已匯出 JE 的反向沖銷流程（Xero/QBO 匯入後不可改）
9. PolicySet schema：落庫、版本化，取代 `DEMO_POLICY_SET` 常數；含最小
   change log（D19）
10. CoA 與 MappingRule：可配置、JSON、版本化；CoA seed 含 rounding 科目
    （與權益科目預留）
11. Trial balance 與揭露：科目餘額視圖 + ASU 2023-08 roll-forward
    （realized/unrealized 拆分之 per-lot FV 調整追蹤 → §16 資料模型需求）；
    significant holdings、出售限制、cost basis method 揭露列 P1
12. ERP export 規格：D8；含逐欄位映射表；已匯出 JE 的沖銷約定（連動 §8）
13. Ingestion 與 Sui 資料層（D7）：**Sui tx normalization 層**（PTB 多指令原子
    分解 1 tx→N events、gas 含 storage rebate 淨額、sponsored tx payer 欄位、
    有價 object（NFT/StakedSui/LP）物件級移動、coin split/merge 過濾、
    accumulator/native-balance 形態）；資料層決策表（gRPC streaming /
    custom indexer / GraphQL 輔助）；通用 CSV import；排程與冪等
14. **月結流程（close checklist）（MVP）**：關帳順序與各步 blocking 條件
    （事件全分類 → recon 乾淨 → 重估過帳 → TB → roll-forward → lock →
    snapshot/anchor → export）；period reopen 程序（lock 後調整 vs 入次期、
    對已 anchor Merkle root 的處理）
15. **UI/UX 標準（D17）**：五條可判定條文——(1) 金額必經 formatter（千分位+
    scale+U+2212），數字欄右對齊+tabular-nums；(2) 語意色合約（aqua=on-chain、
    brass=manual 且禁配白字、credit/debit 專屬）+ 非顏色線索；(3) token-only
    styling，表格/badge/button 必用 shared primitive；(4) 字體單一來源且必須
    實際載入；(5) data-surface 紀律（mascot 禁入 journal/hash/recon/簽名）
16. 對帳：wallet↔subledger（MVP）、↔ERP（P1）
17. 審計層：audit_anchor = 完整性層（既有）；Walrus 審計包 + Seal 加密
    存取控制 = P1 綁定（D5、D14）；anchoring gas 的 sponsored tx 評估（附錄 C）
18. 資料模型：F6 十實體 ↔ 現有 schema 對照；rev2 新增：per-lot FV 調整追蹤、
    PricePoint（含 hierarchy level）、manual JE、change log、opening lot 導入

## 分期表（兩冊共用，權威版在商業冊 §7）

| 期 | 內容 |
|---|---|
| MVP（重對準） | PolicySet+CoA 落庫可配置（含最小 change log）、期末重估雙軌、Pricing 規格（oracle 評估+手動 fallback+cut-off）、Manual JE/Reversal、期初餘額導入、CEX 存提（transfer 子型）+ staking reward 過渡映射、trial balance + roll-forward、月結 checklist 流程、Xero+QBO export、Sui gRPC ingestion + normalization 層 + 通用 CSV、UI 執行落差修復（字體載入、表格/badge 收斂、journal 金額 formatter）（既有能力照舊：AI 分類/review/rules engine/recon/close/anchor） |
| P1 | staking 三態完整版、CEX API connector、WAC、多幣別 FX（IAS 21/ASC 830）、RBAC+完整 audit log、Walrus 審計包+Seal、recon ERP 層、NetSuite export、揭露加厚（significant holdings 等）、revaluation model 機制 |
| P2 | 報表引擎（三大表 supporting schedules）、ERP API connectors、多實體 consolidation、zkLogin/企業 SSO |

## 錯誤處理 / 一致性機制

- 詞彙表為唯一定義出處；兩冊互相引用只用詞彙表詞條。
- 分期表只在商業冊維護一份，會計冊引用不複製。
- 規格內任何與現況 code 的衝突，以規格為準（D9）；差距只記錄在附錄 A。

## 驗收（此設計的完成定義）

- 兩份規格書落檔於 `docs/specs/`，涵蓋上列全部章節，無 TBD/placeholder。
- F5 vs F2/F9 的 ICP 命名不一致在詞彙表中修正並留註記。
- 每個功能模組都有明確 MVP/P1/P2 標記。
- 會計冊月結章可支撐「一位會計師照章走完一次月結」的桌面演練（desk check）。
- 使用者審閱通過。

## 修訂紀錄

- 2026-07-11 rev2：三路 review（sui-architect / 會計師視角 / frontend-design）
  整合。新增 D13–D19；會計冊新增 §6 Pricing、§8 Manual JE、§14 月結流程、
  §15 UI/UX 標準四章；§13 改寫為 normalization 層 + 資料層決策表；CEX 存提
  與 staking reward 過渡拉進 MVP；Seal 綁 Walrus P1；商業冊非目標補 tax basis
  與單一 functional currency。~~原 §11「Ingestion：Sui gRPC source + 通用
  CSV」~~ → 擴為 §13。Why：三路 review 各自命中「引擎規格 ≠ 會計師能關帳的
  規格」與 Sui 資料層精確性缺口。**D15（FX 限單一 functional currency）為
  重大 scope 限制，待使用者確認。**

## 下一步

writing-plans：先產出「規格書撰寫計畫」（兩冊的撰寫與審閱），完成後再以規格書
MVP 章節為輸入，開重對準實作的獨立 plan（另開 chat，per Move/task 切分規則）。
