# 商業規格書 v1.0

版本：v1.0　日期：2026-07-11　狀態：Draft

## §1 產品定位與問題陳述

**一句話定位**：

> AI-assisted digital asset subledger for finance teams on IFRS & US GAAP — turning on-chain chaos into ERP-ready ledgers.
>
> （中文對應：一套面向財務團隊、支援 IFRS 與 US GAAP 雙準則的 AI 輔助數位資產子分類帳——把鏈上活動的混亂狀態，轉換為可直接餵入 ERP 的分錄。）

**要解決的四個問題**：

1. **Crypto 活動難以關帳**：多鏈、多錢包、多交易所加上 DeFi 合約互動，使月結常態性耗費 2–3 週人工整理與對帳，遠超一般企業關帳週期。
2. **審計與合規風險**：缺乏可重現的 subledger 與版本化規則引擎，會計判斷散落於 Excel，無法追溯每筆分錄依據哪個政策版本產生。
3. **AI 工具與會計流程缺乏結合**：市面上 AI 能做交易分類，但缺乏可審計、可控的決策邊界——分類結果直接進帳，無人工核准節點。
4. **Sui / 新鏈 coverage 不足**：現有 crypto subledger 工具對 Sui 這類物件導向、高 TPS L1 的資料模型（PTB 多指令原子分解、有價 object 移動、accumulator 借貸）支援有限。

**核心定位澄清 —— ERP 是 GL of record，本產品是 subledger**：

本產品不取代 ERP（NetSuite/SAP/Xero/QuickBooks），而是站在 ERP 前面的會計轉譯層。此定位由五項設計原則具體落實：

| 原則 | 內容 |
|---|---|
| 1. Raw data immutable | RawTransaction 永不覆蓋、可重跑，任何時候都能從原始鏈上資料重建帳本 |
| 2. Event schema 先穩再擴充 | NormalizedEvent 的統一 schema 優先確立，protocol parser 逐步擴充，不因新鏈/新協議而破壞既有結構 |
| 3. 規則版本化可追溯 | MappingRule、PolicySet 均帶版本號，每筆 JournalEntry 記錄產生時所依據的 rule_version / policy_set_version |
| 4. AI 只建議不做 final posting | AI 對 event_type、economic_purpose、counterparty_type 給出建議與 confidence_score，最終分錄仍須人工 approve |
| 5. ERP 是 GL of record，本系統不取代 ERP | subledger 產出的 JournalEntry 匯出至既有 ERP 作為總帳記錄，本產品專注於鏈上到分錄之間的轉譯與可審計性 |

## §2 ICP 三層

目標客群（ICP）分三層，定義與切入順序採 F2/F9 版本（見附錄 B「ICP L1/L2/L3」條目；F5 商業規格草稿曾將 ICP 簡化為兩層、其 L2 實為本表 L3，v1.0 起以本表為準，D10）。切入順序由 L1 → L2 → L3，非同時鋪開。

| 層級 | 類型 | 特徵 | 產品價值 | 切入時機 |
|---|---|---|---|---|
| **L1 核心** | CEX、機構型 crypto org、Sui 項目方 | 已有正式公司實體與財務團隊；鏈上活動高頻；面對外部審計壓力，需可重現的 subledger | audit-ready subledger；GAAP/IFRS-ready JournalEntry feed 回 NetSuite/Xero/QuickBooks | 第一階段。此群體已具備會計流程與審計需求，是產品成熟度驗證與早期收費的起點 |
| **L2 過渡** | Web3 原生公司（基金、做市商、支付商） | 數位資產是主要業務收入或成本來源；需要 NAV、P&L、fund reporting 等更複雜的財務視圖 | Sui-native accounting engine 補足現有工具（TRES/Cryptio/Bitwave 等）對 Sui coverage 的缺口 | 第一階段後段，隨 L1 案例與 Sui 生態覆蓋度提升後並行擴展 |
| **L3 終局** | 使用穩定幣的一般 Web2 企業（跨境貿易、供應鏈、treasury 管理） | 穩定幣只是現金管理的一小部分，非核心業務；財務團隊對 crypto 專業術語陌生 | stablecoin transaction → enterprise ledger 的自動化管道；IFRS/GAAP policy 選擇與揭露，降低導入門檻 | 第二階段，待 L1/L2 案例與 Sui/穩定幣生態成熟後，作為長期市場擴張目標 |

三層對應同一套 Entity / AccountSource / PolicySet 架構——差異僅在導入時的資料來源複雜度（L1 高頻鏈上、L2 加上基金/做市業務邏輯、L3 以穩定幣現金流為主），不需要為各層另建獨立產品線。

## §3 GTM 分階段與商業模式

**訊息分層（Phase 0，一句話定位按 ICP 層調整）**：

| Phase | 目標客群 | 核心訊息 |
|---|---|---|
| Phase 0 | 通用定位建立 | 「AI-assisted digital asset subledger for finance teams on IFRS & US GAAP — turning on-chain chaos into ERP-ready ledgers.」按 L1/L2/L3 分別調整：對 L1 強調 audit trail + ERP 整合；對 L2 強調 DeFi coverage + NAV + 多實體支援；對 L3 強調 stablecoin treasury + policy + control |
| Phase 1 | Sui 生態 + crypto-native（L1 + L2） | 透過 Sui 官方 builder 活動、黑客松、grants 做 BD；與 Fireblocks、Ledger Enterprise 等 custody 服務商合作；針對 CFO 產出 Sui accounting 深度內容 |
| Phase 2 | Web2 企業穩定幣 treasury（L3） | 鎖定已用穩定幣做跨境付款、供應商結算的企業（非教育型客戶）；與穩定幣 rail / treasury 供應商合作組成解決方案（對方管錢包治理，本產品管會計/ERP/reporting）；訊息：「Make stablecoin flows as clean as bank statements in your ERP.」 |

**切入順序（F9）**：第一階段客群並非 Web2 企業本體，而是已具備財務團隊、鏈上活動頻繁的組織（CEX、做市商、OTC desk、基金、支付商、Sui 項目方）；第二階段才擴展至用穩定幣做跨境收付、供應商結算、treasury parking 的一般 Web2 企業。行銷訊息隨之從「for crypto teams」逐步轉為「for finance teams handling digital assets」。

**商業模式（D11）**：計價依「月交易量 + 實體（Entity）數 + 準則/ERP 模組」三個維度組合定價，**不**按錢包（AccountSource）數計費——因為單一 Entity 常對應多個 AccountSource，按錢包計費會扭曲客戶的擴張誘因，也無法反映真正的處理成本（交易量）與服務複雜度（實體數、需啟用的準則/ERP 模組）。

**早期 pilot 模式**：第一批客戶採半產品半服務模式——由團隊先手動協助建立 chart-of-accounts mapping、PolicySet 政策模板、Sui 事件分類庫，待流程穩定後再逐步產品化為自助設定介面。核心賣點是「month-end close in 3 days」：用可重現的 subledger 流程（ingestion → normalization → review → 分錄生成 → 對帳 → 關帳）取代人工整理 2–3 週的現況，直接對應 §1 問題陳述第一點。

## §4 競品與差異化

**競品現況**：

| 廠商 | 定位/特色 | Sui 支援 |
|---|---|---|
| **TRES Finance** | 定位「crypto subledger」/「第一個 Web3 financial data lake」；自動從錢包/交易所/託管收集資料、分類（swap/staking/NFT/DeFi）、算成本損益、同步 Xero/QuickBooks/NetSuite/SAP/Oracle | 未支援 |
| **Cryptio** | 150+ 鏈/交易所/託管整合；NetSuite 憑證輸出與 API 整合；多實體多幣別 | 未支援 |
| **Bitwave** | audit-ready crypto accounting；QuickBooks/NetSuite/Sage/SAP 整合；面向高交易量、複雜 DeFi/穩定幣客戶 | 未支援 |
| **Integral** | 支援多鏈 | **已支援 Sui**：針對 Sui 物件模型、平行交易做交易分類與成本計算優化 |
| **ZenLedger** | 支援 300+ 交易所、40+ 鏈；稅務+會計+NAV 計算+審計報告 | **已正式支援 Sui** |
| **Taxbit** | enterprise-grade crypto accounting，稅務起家轉企業會計 | 未支援 |

**三個差異化主軸**：

1. **Sui-native accounting intelligence**：直接對 Sui 的物件導向資料模型建模，而非把 EVM 鏈的 parser 邏輯套用到 Sui。事件 taxonomy 明確處理 Sui 特有形態——PTB 多指令原子分解（避免 swap+transfer+gas 誤併一筆）、accumulator/native-balance 直接借貸（不產生 coin object，需讀 objectChanges 而非只讀 balanceChanges）、有價 object（NFT/Kiosk/StakedSui/LP position）以物件移動表示。Integral、ZenLedger 雖已支援 Sui，但 Sui 生態內仍缺少以 Sui 為第一優先設計的會計子分類帳。
2. **Policy-switchable accounting engine**：IFRS/US GAAP 雙軌可透過 PolicySet 切換，而非為單一準則寫死規則。同一組 NormalizedEvent 可依不同 PolicySet 版本重跑，支援情境模擬（scenario）與重編（restatement），對需要同時應付多法域揭露要求的客戶（如 L3 跨境企業）是關鍵能力。
3. **AI-assisted close workflow**：AI 不僅做交易分類建議，還涵蓋例外清單（低信心事件自動進 review queue）、review queue 工作流、close checklist——形成一套完整的月結輔助流程，而非單點分類工具。所有 AI 建議需人工 approve 才進入規則引擎產出正式分錄（見 §1 五原則之四），兼顧效率與可審計性。

**佐證一：ERP 整合路徑的競品實證**（`tasks/research-erp-targets.md`）——所有主要競品都走同一條路徑：Xero/QuickBooks Online 起家、NetSuite 作為企業級畢業旗艦。Cryptio 的第一個整合即為 Xero（2021-10 公告），其 multi-entity NetSuite connector 則是 2026-01 才發布的最新主打；NetSuite 客戶名單涵蓋 Uniswap、Exodus、GSR、Paxos、Ramp、ConsenSys（經 Cryptio 整合）。此路徑驗證了本產品 D8 決策——MVP 先做 Xero manual journal CSV + QuickBooks Online journal CSV，NetSuite（Import Assistant CSV）列為 P1——與市場已驗證的落地順序一致，同時通用 CSV journal export 是五家競品共同 under-market 的空隙，屬本產品可切入的差異化位置。

**佐證二：UI 簽名元素**（`tasks/review-findings-2026-07-11.md` 三、正面資產）——產品前端已具備可辨識的設計語言，作為 close-workflow 差異化的具體佐證：break-precision 渲染（金額 leading-zero 調暗，強化可讀性與精確度信任）、語意色合約（aqua 僅用於 on-chain/anchor 相關狀態，credit/debit 色僅用於借貸與流程通過/阻擋語意）、close cockpit 的 lights-grid 色盲可讀設計。這些元素支撐「AI-assisted close workflow」差異化主張中「財務人員可信任、可審核」的體驗訴求，而非僅停留在功能清單層次。

## §5 功能模組總覽

沿 F5 §6 的 7 大核心模組（Data Ingestion → Normalization & Classification → Accounting Policy & Rules Engine → Review & Approval Workflow → Reconciliation → ERP/GL Integration → Audit Trail & Walrus Snapshot）加上 2 個輔助模組（AI Assistant 限制版、Security & Permissions），共 9 模組。各模組標記依據設計文件 rev3 分期表（見 §7，權威版）；MVP 範圍內既有能力（AI 分類、review queue、rules engine、reconciliation、close、anchor）維持照舊運作，不因本規格重寫。

### 1. Data Ingestion
- **目的**：從 Sui 鏈上與其他來源攝取原始交易，作為 subledger 資料流第一步。
- **輸入**：Sui address/object（gRPC）、通用 CSV 匯入設定；P1 起加 CEX API 憑證。
- **輸出**：RawTransaction（immutable，可重跑）。
- **標記**：**MVP** — Sui gRPC checkpoint streaming（增量攝取）+ custom indexer（歷史 backfill / 逐期餘額重建，GraphQL 僅輔助）+ 通用 CSV import（D6、D7）。**P1** — CEX API connector（取代目前僅 CSV 匯入的存提資料）。

### 2. Normalization & Classification
- **目的**：RawTransaction 轉為標準化 NormalizedEvent，AI 建議 event_type / economic_purpose / counterparty_type 與 confidence_score。
- **輸入**：RawTransaction。**輸出**：NormalizedEvent（版本化）。
- **標記**：**MVP** — Sui tx normalization 層（PTB 多指令原子分解、gas 淨額、sponsored tx payer 欄位、有價 object 物件級移動、coin split/merge 過濾、accumulator/native-balance 形態）；現有 5 類事件 + CEX 存提（transfer 子型，D16）+ staking reward 過渡映射（以 receipt + economic_purpose 映射 Staking Income，D18）。**P1** — staking 三態完整版（STAKING_DEPOSIT/STAKING_WITHDRAWAL 正式化）。

### 3. Accounting Policy & Rules Engine（接口版）
- **目的**：依 PolicySet + PricePoint + PositionLot，把 APPROVED 事件轉換為 JournalEntry；找不到 mapping 則標記「需政策配置」不自動出帳。
- **輸入**：NormalizedEvent + PricePoint + PolicySet + PositionLots。**輸出**：JournalEntryHeader + Lines。
- **標記**：**MVP** — PolicySet + CoA 落庫可配置（含最小 change log，D19）、期末重估雙軌（GAAP ASU 2023-08 FV / IFRS cost+impairment）、Pricing 規格（oracle 評估 + 手動輸入 fallback + cut-off，D13）、Manual JE/Reversal、期初餘額（cut-over）導入、trial balance + roll-forward。**P1** — WAC 成本基礎、revaluation model 機制、揭露加厚（significant holdings 等）。**P2** — 報表引擎（三大表 supporting schedules，見 §6 非目標第 2 條）。

### 4. Review & Approval Workflow
- **目的**：人工核准節點——AI 建議須經 accept/edit/reject 才能進入規則引擎產出正式分錄（§1 五原則之四）。
- **輸入**：NormalizedEvent + AI 建議（含 Sui Explorer link）。**輸出**：review_status（APPROVED 等）+ 月結 checklist 狀態。
- **標記**：**MVP** — 既有 Transaction Review Queue / Journal Review（可調 account_code/memo/dimension）照舊運作 + 月結 checklist 流程（事件全分類→exceptions 結清→recon 乾淨→重估過帳→TB→roll-forward→lock→snapshot/anchor→export）+ UI 執行落差修復批次（journal 金額 formatter、字體載入、表格/badge 收斂，D17，見 §7）。**P1** — RBAC + 完整 audit log（MVP 僅最小 change log，見模組 9）。

### 5. Reconciliation
- **目的**：按 entity + wallet + asset + period 比對來源餘額與 subledger 餘額，標記差異。
- **輸入**：source_balance（chain/CEX）+ subledger_balance。**輸出**：ReconciliationRecord（含 variance_qty/value、exception reason）。
- **標記**：**MVP** — wallet ↔ subledger 對帳（既有能力照舊）。**P1** — subledger ↔ ERP 對帳（recon ERP 層）。

### 6. ERP / GL Integration
- **目的**：已核准 JE 匯出為 ERP 可匯入格式，標記 exported。
- **輸入**：APPROVED JournalEntry。**輸出**：ERP journal 匯出檔（CSV）。
- **標記**：**MVP** — Xero manual journal CSV + QuickBooks Online journal CSV（D8）。**P1** — NetSuite（Import Assistant CSV）。**P2** — 原生 ERP API connector（SAP 不做，見 §6 非目標第 4 條）。

### 7. Audit Trail & Walrus Snapshot
- **目的**：期間結束時將 positions/JE/reconciliation 打包並上鏈記錄完整性證明。
- **輸入**：Period Close 觸發之 Snapshot。**輸出**：Merkle Root anchor（鏈上）+（P1 起）可取回的 Walrus 審計包。
- **標記**：**MVP** — audit_anchor 合約完整性層（既有能力照舊：hash-only 上鏈、cap-based 授權、Merkle inclusion proof）；Walrus 前 manifest 僅存自有 DB（D5）。**P1** — Walrus 審計包 + Seal 加密存取控制（審計包含 JE 財務明細，公開 blob 即洩漏，故與 Seal 綁定同列 P1，D14）；anchoring gas 之 sponsored tx（Enoki）評估見附錄 C。

### 8. AI Assistant（限制版）
- **目的**：建議 event_type/economic_purpose，異常提示（內部轉帳/DeFi/spam），協助生成 memo；僅 suggestion，不可未經核准直接進規則引擎（§1 五原則之四）。
- **輸入**：NormalizedEvent（候選）。**輸出**：建議標籤 + confidence_score，供模組 4 人工核准。
- **標記**：**MVP** — 既有分類建議、review queue、triage agent 能力照舊運作，隨模組 2 的事件覆蓋範圍同步擴充（CEX 存提、staking reward 過渡映射）。

### 9. Security & Permissions
- **目的**：權限控管與憑證保護，支撐可審計性。
- **輸入**：使用者角色設定、PolicySet/MappingRule 變更、review 決策。**輸出**：change log / audit log 紀錄；CEX API Key 等憑證加密儲存。
- **標記**：**MVP** — 最小 change log（PolicySet/MappingRule 變更 + review 決策紀錄，D19）。**P1** — RBAC（Admin/Accountant/Viewer）+ 完整 audit log。**P2** — zkLogin/企業 SSO。

## §6 非目標

明文界定本產品範圍邊界，避免與 ERP、報表引擎、稅務系統的職責混淆：

1. **不取代 ERP**：本產品是站在 ERP 前面的會計轉譯層（subledger），JournalEntry 匯出至既有 ERP（NetSuite/SAP/Xero/QuickBooks）作為總帳記錄。ERP 仍是 GL of record（見 §1 五原則之五）。
2. **MVP 不做三大報表引擎**：完整資產負債表、損益表、現金流量表（含 supporting schedules）不在 MVP 範圍，列為 P2；本產品僅提供期末餘額、cost basis/FV、trial balance、roll-forward 等 subledger 層資料供下游報表模組使用。
3. **不做稅務申報與 tax basis/遞延稅**：本產品聚焦財務會計（financial accounting）分錄產出，不處理稅務申報、tax basis 計算或遞延稅（deferred tax）事項；此類需求由企業自有稅務系統或稅務顧問處理。
4. **不支援 SAP**：ERP export 依 D8（`tasks/research-erp-targets.md` 研究數據）僅涵蓋 Xero manual journal CSV + QuickBooks Online journal CSV（MVP）與 NetSuite Import Assistant CSV（P1）；SAP 不在任何分期範圍內。
5. **MVP 限單一 functional currency = USD**（D15）：MVP 階段僅支援 Entity 記帳貨幣為美元，暫不支援多幣別換算（IAS 21/ASC 830）。但架構須模組化保留擴充接口，具體三項技術細則：
   - 幣別換算邏輯集中於 rules engine 的 Price/FX lookup 階段，設計為可插拔（pluggable），不得分散於程式各處硬編碼。
   - `functional_currency` 只存在於 PolicySet 欄位，禁止 USD 硬編碼散落於程式碼中。
   - JournalEntry Lines 保留 `currency` / `fx_rate` 欄位，即使 MVP 階段恆為 USD/1.0，欄位結構亦不省略，以承接 P1 擴充。
   - P1 目標市場：台灣、日本、香港、韓國（依會計師 review 確認之優先順序）。
6. **MVP 不做多實體 consolidation**：多實體（multi-entity）合併報表、跨實體 transfer pricing 不在 MVP 範圍，列為 P2；MVP 階段每個 Entity 的 subledger 各自獨立記帳。

## §7 分期 Roadmap

**本節為全案（商業冊 + 會計技術規格書）分期標記的唯一權威版本**；會計冊各章一律引用「見商業冊 §7」，不重複列表。依設計文件 rev3 分期表（`docs/superpowers/specs/2026-07-11-gtm-spec-v1-design.md`）逐項展開：

### MVP（重對準 re-aim）

| 項目 | 內容 |
|---|---|
| PolicySet + CoA | 落庫、可配置，含最小 change log（D19） |
| 期末重估 | GAAP/IFRS 雙軌（ASU 2023-08 FV / cost+impairment） |
| Pricing 規格 | oracle 評估 + 手動輸入 fallback + cut-off 時點定義（D13） |
| Manual JE / Reversal | 手工分錄、更正、應計、已匯出 JE 反向沖銷 |
| 期初餘額導入 | opening lot cut-over（cost basis + 取得日） |
| 事件覆蓋擴充 | CEX 存提（transfer 子型，D16）+ staking reward 過渡映射（D18） |
| 揭露視圖 | trial balance + roll-forward |
| 月結流程 | close checklist（事件全分類→exceptions 結清→recon 乾淨→重估過帳→TB→roll-forward→lock→snapshot/anchor→export） |
| ERP export | Xero manual journal CSV + QuickBooks Online journal CSV（D8） |
| Ingestion | Sui gRPC checkpoint streaming ingestion + normalization 層 + 通用 CSV import（D6、D7） |
| UI 執行落差修復批次 | 字體單一來源且實際載入、表格/badge 收斂為 shared primitive、journal 金額 formatter（D17） |
| 既有能力照舊 | AI 分類/review、rules engine、reconciliation（wallet↔subledger）、close、audit_anchor 完整性層 |

### P1

| 項目 | 內容 |
|---|---|
| staking 三態完整版 | STAKING_DEPOSIT/STAKING_WITHDRAWAL 正式化（脫離 MVP 過渡映射） |
| CEX API connector | 取代 MVP 之 CSV 匯入 |
| WAC | 加權平均成本基礎（與既有 FIFO 並列） |
| 多幣別 FX | IAS 21/ASC 830，目標市場台灣/日本/香港/韓國（D15） |
| RBAC + 完整 audit log | 取代 MVP 最小 change log |
| Walrus 審計包 + Seal | 審計包可取回性保證 + 加密存取控制（D5、D14 綁定） |
| Recon ERP 層 | subledger ↔ ERP 對帳（第三層，MVP 僅 wallet↔subledger） |
| NetSuite export | Import Assistant CSV（D8） |
| 揭露加厚 | significant holdings、出售限制、cost basis method 揭露 |
| revaluation model 機制 | IFRS revaluation model 政策選項（OCI/surplus 科目、IAS 38.75 active market 警示） |

### P2

| 項目 | 內容 |
|---|---|
| 報表引擎 | 三大表（資產負債表/損益表/現金流量表）supporting schedules |
| ERP API connectors | 取代 MVP/P1 之 CSV 匯出，原生 API 整合 |
| 多實體 consolidation | 跨實體合併報表、transfer pricing |
| zkLogin / 企業 SSO | 降低 Web2 財務人員 onboarding 摩擦 |

## 附錄 A 現況差距對照

依 D9（目標態主文 + 現況差距附錄，實作推進只更新本附錄、不改主文）收斂自 `tasks/spec-gap-analysis.md` 逐項差距表為下列三欄格式。**本附錄隨實作推進持續更新，主文（§1–§7）不因現況變化而改寫。**

| 規格章節 | 現況（已驗證，2026-07-11） | 差距 |
|---|---|---|
| §5-1 Data Ingestion（Sui gRPC MVP） | 主流程吃 FixtureSource；`SuiJsonRpcSource` 僅 40 行、只有 CLI `run-ingest` 用到，未接 API 主流程；且 JSON-RPC 已排定 2026-07-31 停用（D7） | ❌ 大缺口：需改建 gRPC checkpoint streaming + custom indexer，`SuiJsonRpcSource` 須汰換 |
| §5-2 Normalization（CEX 存提/staking reward 過渡映射） | 只有 5 類（receipt/payment/swap/gas/transfer）+ opening_lot；缺 staking 三態、CEX 存提、期末重估/減損（rules-engine grep 零命中） | ❌ 缺的正是最「會計」的部分 |
| §5-3 Rules Engine — PolicySet + CoA 落庫可配置 | `DEMO_POLICY_SET` / `DEMO_COA_RULES` 寫死於 `policyConstants.ts`；schema 無 policy 表；版本欄位有記錄但僅單一 hardcoded 版本 | ❌ 三大差異化主軸之一（policy-switchable engine）尚未兌現 |
| §5-3 Rules Engine — 規則引擎架構 | 11-phase pipeline，含 recognition/measure/COA mapping/disclosure | ✅ 超規格 |
| §5-4 Review & Approval — AI 建議 + review workflow | classify + confidence + review queue + copilot + triage agent 提案（human accept） | ✅ 超規格（agentic 部分優於原設計） |
| §5-5 Reconciliation | book vs live chain 兩層對帳；無 ERP 第三層 | ⚠️ MVP 可接受（ERP 層本屬 P1 範圍） |
| §5-3 Cost basis FIFO/WAC | FIFO 已實作；WAC 未實作 | ⚠️ WAC 屬 P1 範圍，MVP 無需補齊 |
| §5-6 ERP/GL Integration | 僅 generic CSV/PDF；全 repo 無任何 ERP 欄位映射（grep 零命中） | ❌ subledger 的最後一哩尚未打通，需依 D8 補 Xero/QBO 欄位映射 |
| §5-7 Audit Trail & Walrus Snapshot | 換成自建 audit_anchor 合約：hash-only 上鏈，資料包不可取回；Walrus 審計包未實作 | 🔀 完整性更強、可取回性更弱（規格外自建），定位收斂為完整性層（D5），Walrus+Seal 列 P1 |
| §5-9 Security & Permissions（RBAC + Audit Log） | 無；maker-checker SoD 已列 deferred | ❌ 屬 P1 範圍 |
| §6/§7 揭露：roll-forward/期末餘額 by asset | disclosure facts phase 存在，但無 roll-forward 報告與 trial balance 視圖 | ⚠️ 屬 MVP 範圍，待補（見 §7 MVP「揭露視圖」項） |
| §6 非目標第 2 條：完整三大報表 | 無 | ✅ 按規格本就不做，非缺口（規格本來就列 P2） |

## 附錄 B 詞彙表

本節為兩冊（商業規格書、會計技術規格書）唯一的名詞定義出處；兩冊內文引用詞彙一律以本節定義為準。

- **Entity**：進行會計記錄的法律或管理個體單位（公司、基金、子帳本等）。所有 RawTransaction、JournalEntry 均歸屬於某個 Entity，是多實體隔帳的基礎維度。

- **AccountSource**：一個可被攝取（ingest）交易資料的來源設定，例如某條鏈上錢包地址、某個 CEX API 帳戶、或某份 CSV 匯入設定。AccountSource 綁定 Entity，決定 RawTransaction 從何而來。

- **RawTransaction**：從 AccountSource 攝取的原始交易紀錄，未經任何會計判斷或分類，永不覆蓋（immutable，可重跑）。是資料流的第一步輸入。

- **NormalizedEvent**：RawTransaction 經 normalization 層處理後產出的標準化事件，具備統一 schema（event_type、資產、數量、時間戳等），供後續補價、lot 分攤、規則引擎使用。版本化。

- **事件類型（12 類）**：NormalizedEvent 的分類標籤（event_type），取自資料模型與規則引擎設計（F6），完整 12 類如下：
  - **ASSET_RECEIPT**：資產收款/收入（非交易對手為己方內部帳戶的資產流入）。
  - **ASSET_DISPOSAL**：資產處分/支出（資產流出且非內部移轉）。
  - **INTERNAL_TRANSFER**：同一 Entity 名下不同 AccountSource 間的內部資產移轉。
  - **TRADE_BUY**：現貨買入交易。
  - **TRADE_SELL**：現貨賣出交易。
  - **SWAP**：資產對資產的即時兌換（如 DEX swap），同時涉及處分與取得兩腿。
  - **FEE_GAS**：鏈上交易的 gas / network fee 支出。
  - **STAKING_DEPOSIT**：質押存入（資產鎖定進入質押合約）。
  - **STAKING_REWARD**：質押獎勵發放。
  - **STAKING_WITHDRAWAL**：質押提領（解除鎖定並取回資產）。
  - **CUSTODY_MOVE**：進出託管方（custodian）的資產移動。
  - **UNCLASSIFIED_CONTRACT_INTERACTION**：無法歸類至上述任一類型的合約互動，待人工覆核分類。

- **PositionLot**：以 FIFO（P1 增 WAC）為基礎的成本基礎（cost basis）批次，記錄某筆資產取得的數量、單位成本與取得日，供處分時計算已實現損益。

- **PricePoint**：某資產在特定時間點的市場價格紀錄，來源含 oracle（Pyth/Nautilus 評估）與手動輸入 fallback，用於期末重估與交易計價。

- **PolicySet**：可配置、版本化的會計政策集合（準則軌道 IFRS/GAAP、functional currency、cost basis method 等），取代程式碼中硬編碼的 `DEMO_POLICY_SET` 常數。

- **MappingRule**：將 NormalizedEvent（依 PolicySet 判定後）映射為 JournalEntry 借貸科目的規則，JSON 結構、可配置、版本化。

- **JournalEntry**：規則引擎依 NormalizedEvent + PolicySet + MappingRule 產出的會計分錄，含 Header（entity/period/policy_set_version/rule_version/status 等）與 Lines（account_code/debit/credit/currency/fx_rate 等）。

- **ReconciliationRecord**：對帳紀錄，比對 wallet/subledger 餘額（MVP）或 subledger/ERP 餘額（P1），標記已對平或有差異的項目。

- **Trial Balance**：試算表，各科目餘額彙總視圖，是月結流程產出之一，含 ASU 2023-08 roll-forward 揭露。

- **Roll-forward**：期間內科目餘額變動的展開追蹤（期初 → 各類異動 → 期末），特別用於 realized/unrealized 損益按 per-lot FV 調整的揭露。

- **Period Lock**：期間鎖定，月結完成後鎖定該期間不可再變更分錄；lock 後調整走下一期或走 reopen 程序。

- **Snapshot**：某期間結束時的帳本狀態快照，供審計與 anchor 使用。

- **Anchor**：將 Snapshot 的完整性證明（如 Merkle Root）上鏈記錄的動作，由 audit_anchor 合約提供完整性層保證。

- **Manifest**：描述一組審計相關檔案（如 Walrus 審計包內容）的清單紀錄。Walrus 前，manifest 僅存於自有 DB；Walrus 上線後（P1）才具備可取回性保證，anchor 僅證完整性、不證可取回性（D5）。

- **Merkle Root**：Snapshot 內容以 Merkle tree 摘要後的根雜湊，是 anchor 上鏈的核心資料，用於證明資料完整性未被竄改。

- **Walrus 審計包**：P1 功能，將審計所需之 JournalEntry 財務明細等資料封裝後存入 Walrus 去中心化儲存，因含財務明細（公開 blob 即洩漏），與 Seal 加密存取控制綁定同列 P1（D14）。

- **functional currency / reporting currency**：functional currency 為 Entity 記帳所用之主要營運貨幣，MVP 限定單一 functional currency = USD（D15）；reporting currency 為對外報表呈現所用之貨幣。P1 起支援多幣別換算（IAS 21/ASC 830）。架構上 functional_currency 僅存在於 PolicySet 欄位，禁止 USD 硬編碼散落於程式各處。

- **MVP/P1/P2**：功能分期標記。MVP＝重對準（re-aim）階段必須具備的最小可行能力；P1＝次階段擴充（如 staking 三態完整版、CEX API connector、WAC、多幣別 FX、Walrus 審計包+Seal 等）；P2＝長期擴充（三大報表引擎、ERP API connectors、多實體 consolidation、zkLogin/企業 SSO 等）。完整分期表見商業冊 §7（權威版）。

- **ICP L1/L2/L3**：目標客群三層分級。定義採 F2/F9 三層（見 `tasks/ideas-summary.md` §4 表格）為準：

  | 層級 | 類型 | 特徵 | 產品價值 |
  |---|---|---|---|
  | L1 核心 | CEX/機構型 crypto org/Sui 項目方 | 高頻鏈上+已有公司實體+審計壓力 | audit-ready subledger、GAAP/IFRS ready JE feed 回 NetSuite/Xero/QuickBooks |
  | L2 過渡 | Web3 原生公司（基金/做市商/支付商） | 數位資產是主要業務收入/成本，需 NAV/P&L/fund reporting | Sui-native accounting engine 補現有工具 coverage gap |
  | L3 終局 | 使用穩定幣的 Web2 企業（跨境/供應鏈/treasury） | 穩定幣只是 cash management 一小部分 | stablecoin transaction → enterprise ledger pipeline，IFRS/GAAP policy 選擇與 disclosure |

  **註記**：F5 商業規格草稿曾將 ICP 簡化為兩層、其 L2 實為本表 L3，v1.0 起以本表為準（D10）。

## 附錄 C Sui 生態整合機會

本附錄為機會清單（D12），非承諾功能；是否納入 roadmap 待後續評估與商業驗證。

- **DeepBook**（交易來源 parser / 對沖延伸）：作為做市商、交易策略、treasury 客群（L2）的 on-chain 交易來源，需專門 parser 解析成交/撤單/掛單 fee 事件，供 Normalization 模組（§5-2）納入 taxonomy。延伸機會：從 subledger 直接發起對沖指令到 DeepBook（policy 超標觸發），屬長期擴展方向，非 MVP/P1 承諾項目。
- **SuiNS**（counterparty 顯示）：用於 Review & Approval Workflow（§5-4）與 Reconciliation（§5-5）UI 中，將 counterparty 地址解析為人類可讀名稱，降低財務人員閱讀與核對成本；不影響底層資料模型，屬純 UI 呈現層增強。
- **Enoki sponsored-tx anchoring 評估**（`tasks/review-findings-2026-07-11.md` 一之 5c）：Audit Trail & Walrus Snapshot 模組（§5-7）的 anchoring 動作需消耗 SUI gas，sponsored transaction（Enoki）/ gasless 模式可降低企業客戶的 gas 管理負擔，值得評估是否納入 P1 Walrus 審計包 + Seal 批次一併規劃；需一併評估 sponsored tx 的 gas payer ≠ entity 情境下之 payer 欄位記錄需求（呼應 §5-2 taxonomy 的 sponsored tx payer 欄位設計）。
- **Nautilus**（oracle/off-chain data bridge 候選）：若會計技術規格書 §6 Pricing 章節的 oracle 選型（Pyth 與 Nautilus 之間）於實作階段仍未定案，Nautilus 作為候選之一保留於本附錄，可用於 valuation/fair value price feed 的可驗證上鏈，亦可延伸用於將 PolicySet 版本/核准紀錄安全寫入 Sui 作為 policy log。
