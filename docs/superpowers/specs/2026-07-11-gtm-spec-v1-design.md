# GTM 正式規格 v1.0 — 設計文件（2026-07-11，使用者已逐節確認）

## 背景與動機

專案現況與初始規格（`Ideas/` F1–F9）已出現投資比重偏移：核心會計 kernel（雙分錄、
FIFO lots、對帳、期間鎖）符合原設計，但「會計師每月實際作業」缺口大（期末重估、
trial balance、可配置 PolicySet/CoA、ERP 欄位映射、真鏈 ingestion）。完整差距分析：
`tasks/spec-gap-analysis.md`。ERP 目標市場研究：`tasks/research-erp-targets.md`。

本設計定義「GTM 正式規格 v1.0」兩份文件的結構、內容決策與分期，取代 `Ideas/` 的
三份對話稿（F4 會計規格 / F5 商業規格 / F6 資料模型）成為權威規格。

## 已定案決策（含使用者裁定）

| # | 決策 | 裁定 |
|---|---|---|
| D1 | 路線：重對準（re-aim），不重寫 | 使用者 |
| D2 | 準則：IFRS/GAAP 雙軌，PolicySet 切換 | 使用者 |
| D3 | 文件結構：兩本分冊（商業 + 會計技術），共用詞彙表 | 使用者 |
| D4 | 範圍：全貌 + MVP/P1/P2 分期標注 | 使用者 |
| D5 | 審計層：audit_anchor 合約留作完整性層；Walrus 審計包列 P1 | 使用者 |
| D6 | Ingestion MVP：Sui 鏈上 + 通用 CSV import；CEX API connector 列 P1 | 使用者 |
| D7 | Sui 傳輸層用 **gRPC**（JSON-RPC 已正式棄用；現有 `SuiJsonRpcSource` 標汰換） | 使用者提醒 + 現有 asset registry 已用 gRPC |
| D8 | ERP export MVP：**Xero manual journal CSV + QuickBooks Online journal CSV**；NetSuite（Import Assistant CSV）列 P1；SAP 不做 | 研究數據（`tasks/research-erp-targets.md`）：ICP 早期客群實證在 Xero/QBO；scaled crypto 用 NetSuite；SAP 零實證；四大無公開格式要求 |
| D9 | 寫法：目標態主文 + 現況差距附錄（實作推進只更新附錄） | 使用者 |
| D10 | ICP 採 F2/F9 三層（L1 crypto-native / L2 Web3 原生金融 / L3 Web2 穩定幣企業）；修正 F5 兩層簡化訛誤 | Claude 裁定，已標記 |
| D11 | 定價模式進商業冊（F9：月交易量 + 實體數 + 準則/ERP 模組計價） | Claude 裁定 |
| D12 | 全文中文；F8 生態整合（DeepBook/Nautilus/Seal/SuiNS）降為商業冊附錄「機會清單」，不進 roadmap | Claude 裁定 |

## 文件一：商業規格書 v1.0（`docs/specs/business-spec-v1.md`）

1. 產品定位與問題陳述（沿 F5 §1-2；定位句用 F2 Phase 0 版）
2. ICP 三層（D10）
3. GTM 分階段與商業模式（F2 Phase 1/2 + F9 切入順序；D11 計價）
4. 競品與差異化（F1 競品表；三差異化：Sui-native accounting intelligence /
   policy-switchable engine / AI-assisted close；補 ERP 研究實證）
5. 功能模組總覽（F5 §6 的 7+2 模組，每模組標 MVP/P1/P2）
6. 非目標（明文）：不取代 ERP；MVP 不做三大報表引擎；不做稅務申報；不支援 SAP
7. 分期 roadmap（見下方分期表）
8. 附錄 A：現況差距對照（自 `tasks/spec-gap-analysis.md` 整理，隨實作更新）
   附錄 B：共用詞彙表（兩冊唯一定義出處，防 F5 vs F2/F9 型不一致再發生）
   附錄 C：Sui 生態整合機會（F8 內容，D12）

## 文件二：會計技術規格書 v1.0（`docs/specs/accounting-spec-v1.md`）

1. 準則範圍：IFRS/GAAP 雙軌（D2；F4 §1）
2. 資產分類模型（F4 §2：technical_type × accounting_class）+ 穩定幣三選項政策（F4 §2.2）
3. 事件 taxonomy：F6 完整 12 類；MVP 覆蓋 = 現有 5 類（receipt/payment/swap/gas/
   transfer）+ 期末重估；staking 三態、CEX 存提標 P1
4. 事件→JE 處理規範：每事件 Dr/Cr 模板，IFRS/GAAP 各一軌（F4 §3）
5. 期末重估/減損（MVP 最大新增）：GAAP 軌 = ASU 2023-08 FV；IFRS 軌 = cost +
   impairment 為預設、revaluation model 為政策選項
6. Cost basis：FIFO（既有）+ WAC（P1）；PositionLot 模型（F4 §4）
7. PolicySet schema：落庫、版本化，取代 `DEMO_POLICY_SET` 常數（F4 §5）
8. CoA 與 MappingRule：可配置、JSON、版本化（F6 三層規則架構）
9. Trial balance 與揭露輸出：科目餘額視圖 + ASU 2023-08 roll-forward（F4 §8）
10. ERP export 規格：D8；含逐欄位映射表
11. Ingestion 規格：Sui gRPC source（D7）+ 通用 CSV import；排程與冪等規範
12. 對帳：wallet↔subledger（MVP）、↔ERP（P1）
13. 審計層：audit_anchor = 完整性層（既有，含 Merkle inclusion proof）；
    Walrus 審計包 = P1（D5）
14. 資料模型：F6 十實體 ↔ 現有 schema 對照（events/journal_entries/lot_movement/
    snapshots/anchors/period_lock/asset_registry/…）

## 分期表（兩冊共用，權威版在商業冊 §7）

| 期 | 內容 |
|---|---|
| MVP（重對準） | PolicySet+CoA 落庫可配置、期末重估雙軌、trial balance、Xero+QBO export、Sui gRPC ingestion + 通用 CSV import（既有能力照舊：AI 分類/review queue/rules engine/recon/close/anchor） |
| P1 | staking+CEX 事件、CEX API connector、WAC、RBAC+audit log、Walrus 審計包、recon ERP 層、NetSuite export |
| P2 | 報表引擎（三大表 supporting schedules）、ERP API connectors、多實體 consolidation、zkLogin |

## 錯誤處理 / 一致性機制

- 詞彙表為唯一定義出處；兩冊互相引用只用詞彙表詞條。
- 分期表只在商業冊維護一份，會計冊引用不複製。
- 規格內任何與現況 code 的衝突，以規格為準（目標態主文原則，D9）；
  差距只記錄在附錄 A。

## 驗收（此設計的完成定義）

- 兩份規格書落檔於 `docs/specs/`，涵蓋上列全部章節，無 TBD/placeholder。
- F5 vs F2/F9 的 ICP 命名不一致在詞彙表中修正並留註記。
- 每個功能模組都有明確 MVP/P1/P2 標記。
- 使用者審閱通過。

## 下一步

writing-plans：先產出「規格書撰寫計畫」（兩冊的撰寫與審閱），完成後再以規格書
MVP 章節為輸入，開重對準實作的獨立 plan（另開 chat，per Move/task 切分規則）。
