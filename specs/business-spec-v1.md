# Sui Agentic Subledger 商業／產品規格書 v1.0

**產品名稱（暫定）**：Sui Agentic Subledger  
**產品類型**：AI-assisted Digital Asset Subledger / Accounting Orchestration Layer  
**文件版本**：v1.0  
**文件狀態**：正式初版（供產品、工程、GTM、合作夥伴與評審溝通）  
**適用市場**：全球；以 IFRS 與 US GAAP 報導企業為主要設計對象  
**更新日期**：2026-06-19  
**重要聲明**：本文件描述產品與商業設計，不構成會計、審計、法律、稅務或投資建議。準則適用與會計政策應由客戶及其專業顧問確認。

---

## 1. 背景與問題定義

### 1.1 市場背景

企業使用穩定幣、鏈上資產、交易所與 DeFi 協議的情境正在增加，典型用途包括跨境收付款、資金調度、交易、做市、質押與協議營運。[需查證] 傳統 ERP、總帳與 Treasury Management System 通常無法原生理解錢包、鏈上交易、物件狀態與協議事件，因此企業需在鏈上資料與 ERP 之間建立專門的轉譯層。[需查證]

市場已形成「crypto subledger / digital asset accounting」產品類別，其典型責任為：

- 接入錢包、交易所、託管與協議資料。
- 將異質交易轉換成一致的財務事件。
- 執行定價、成本基礎、部位與損益計算。
- 依企業政策產生複式分錄。
- 對帳並輸出至 NetSuite、SAP、Oracle、QuickBooks、Xero 等 ERP／GL。[需查證]
- 保留可重現、可審查的來源、規則、價格與核准軌跡。

主流落地模式並非取代 ERP，而是在 ERP 前建立 digital asset subledger；ERP 仍為正式總帳與財務報導系統。[需查證] 本產品沿用此邊界，以降低客戶導入阻力及控制產品範圍。

### 1.2 核心痛點

1. **資料碎片化**：錢包、CEX、託管、銀行、DeFi 與 ERP 的資料格式、識別碼及時間粒度不同。
2. **事件語意不足**：鏈上資料可證明「發生了什麼技術操作」，但通常不能直接說明「為何發生」及其商業目的。
3. **關帳依賴人工**：財務團隊需使用 CSV、試算表與人工標記完成分類、對帳、定價及分錄。
4. **準則與政策不唯一**：同一資產或事件的處理會受資產權利、持有目的、企業角色、司法管轄區與會計政策影響。
5. **審計證據分散**：原始交易、價格來源、分類理由、政策版本、人工修改與 ERP 分錄缺乏完整 lineage。
6. **新鏈支援落差**：既有產品通常優先覆蓋成熟鏈；Sui 的 object-centric data model 與協議事件需要專門解析。[需查證]
7. **AI 缺乏控制邊界**：純 AI 分類雖可提升效率，但若無規則版本、信心門檻、人工核准及完整紀錄，難以作為正式帳務依據。

### 1.3 問題陳述

財務團隊需要一個可將鏈上原始活動穩定轉換為「可解釋、可核准、可重跑、可對帳、可匯入 ERP」會計輸出的系統；該系統需同時具備 Sui-native 資料能力、可切換的政策引擎與受控的 AI 協作流程。

### 1.4 市場機會與切入理由

本產品不以「支援最多鏈」作為初期競爭方式，而以以下楔子切入：

- 深度解析 Sui 錢包、資產物件及 DeepBook 等協議事件。
- 將 IFRS／US GAAP 與企業政策拆成可版本化規則，而非硬編碼單一路徑。
- 讓 AI 處理事件理解、建議與例外分流，但不越過正式入帳控制。
- 以 Walrus 關帳快照建立可驗證的 audit pack。
- 先服務已有迫切需求的 crypto-native 企業，再擴張至使用穩定幣的 Web2 企業。

穩定幣在企業 treasury、跨境 B2B 與供應商結算的採用仍在成長階段。[需查證] 若採用持續擴大，企業會需要能與既有 ERP、內控與財報流程兼容的中介資料層；此為產品中長期市場假設。

---

## 2. 產品定位與目標

### 2.1 一句話定位

> **Sui Agentic Subledger 是面向財務團隊的 AI 輔助數位資產子分類帳，將 Sui、交易所與鏈上協議活動轉換為可核准、可對帳、可匯入 ERP 的 IFRS／US GAAP policy-driven 分錄與審計軌跡。**

### 2.2 產品類別與邊界

產品是：

- 數位資產資料標準化層。
- 會計政策與規則執行層。
- 財務 review、close、reconciliation 與 audit evidence 工作台。
- ERP／GL 的上游 subledger。

產品不是：

- ERP 或正式總帳的全面替代品。
- 自動提供最終會計判斷的專業顧問。
- 稅務申報引擎。
- 錢包託管或私鑰管理服務。
- 無人工控制的自主入帳代理。

此邊界的設計理由是：企業最難替換的是既有 ERP、主檔與財務控制；以 subledger 形式加入既有架構，可先解決鏈上資料缺口，並保留客戶現行系統與責任分工。

### 2.3 ICP 分層

| 層級 | 客群 | 典型條件 | 主要採購理由 | 產品重點 |
|---|---|---|---|---|
| L1 核心 | 正式營運的 Sui 項目方、中小型 CEX、託管／錢包服務商 | 有法人、財務或外部會計師；已有月結與審計需求 | Sui coverage、縮短關帳、可追溯分錄 | Sui parser、wallet recon、DeepBook、audit pack |
| L2 過渡 | 基金、做市商、OTC、支付商、crypto-active company | 多錢包／CEX、高交易量、資產為主要營運項目 | 成本基礎、部位、損益、多來源對帳 | CEX ingestion、lots、pricing、multi-source |
| L3 終局 | 使用穩定幣的 Web2 企業 | 穩定幣用於跨境收付、供應商付款或 treasury | 讓穩定幣流程進入 ERP 與內控 | stablecoin workflow、dimensions、ERP/TMS connector |

優先順序為 L1 → L2 → L3。L1 與 L2 的痛點已存在、決策鏈較短，也較理解 subledger 價值；L3 市場較大但需更完整的企業整合、安全、法遵與變更管理能力。（推測）

### 2.4 Jobs to Be Done

當企業財務需要關閉某會計期間時，產品應協助其：

1. 確認所有指定錢包、CEX 與託管活動已完整接入。
2. 將技術交易轉為具有商業語意的標準事件。
3. 將低信心、未知協議及異常交易集中到例外佇列。
4. 依已核准政策產生一致、可解釋的分錄。
5. 比對來源餘額、subledger 與 ERP export，解決差異。
6. 鎖定期間並產生可重現的 close package 與 audit snapshot。

### 2.5 MVP 產品目標

1. 跑通單一企業、多個 Sui 地址的完整資料鏈：ingestion → normalization → review → JE → reconciliation → export。
2. 支援穩定幣收付款、內部轉帳、swap／DeepBook trade、gas fee、staking 等核心事件。
3. 提供 IFRS／US GAAP 基礎 PolicySet，允許依企業政策配置資產分類、成本方法與科目映射。
4. AI 僅產生分類與說明建議；所有正式分錄須通過確定性規則及人工核准。
5. 產出 generic CSV／ERP-ready journal export 與 Walrus audit snapshot。

### 2.6 核心產品原則

- **Source immutable**：原始資料不可覆寫，只可新增同步結果或更正版本。
- **Deterministic accounting**：相同輸入、價格、政策與規則版本必須產生相同輸出。
- **Human accountable**：AI 不具最終 posting 權限。
- **Exception-first workflow**：自動化正常交易，讓人員集中處理例外。
- **ERP remains system of record**：產品管理鏈上子帳，正式總帳仍由 ERP 承擔。
- **Evidence by design**：每筆輸出可追溯至來源、價格、規則、政策及核准人。

---

## 3. 使用者與角色

### 3.1 主要角色

#### CFO／財務主管

- 關注：關帳時間、資產曝險、控制有效性、審計準備與導入 ROI。
- 核心操作：檢視 KPI、核准政策、核准 close、查看重大例外。
- 權限：跨實體檢視；政策與期間終結核准。

#### 財務經理／Controller

- 關注：資料完整性、規則一致性、期末流程與 ERP 對接。
- 核心操作：設定 PolicySet、chart of accounts mapping、review threshold 與 close checklist。
- 權限：配置規則、指派例外、核准 JE batch、執行 period close。

#### 會計人員／外包會計師

- 關注：交易分類、分錄、supporting evidence 與對帳差異。
- 核心操作：審查事件、修改 business purpose、處理 recon、輸出分錄。
- 權限：在授權實體與期間內編輯、提交與核准。

#### Treasury／Operations／Protocol 團隊

- 關注：錢包所有權、交易目的、對手方、協議操作與部位。
- 核心操作：驗證地址、補充交易目的、回覆例外、確認內部轉帳。
- 權限：提供營運資訊但不得修改會計政策。

#### 審計人員

- 關注：完整性、存在性、估值、cutoff、權利義務及 change history。
- 核心操作：唯讀查詢來源交易、價格、規則版本、reconciliation 與 snapshot。
- 權限：限定期間與實體的只讀／下載權限。

#### 系統管理員

- 關注：身分、角色、connector、憑證、稽核紀錄與服務健康。
- 核心操作：使用者管理、來源設定、密鑰輪替、錯誤排查。
- 權限：不得因技術管理身分而自動取得財務核准權。

### 3.2 權責分離

系統至少支援以下 segregation of duties：

- 建立或修改政策者不得單獨核准該政策生效。
- 編輯事件分類者不得在高風險條件下單獨核准其分錄。
- 建立 export batch 與確認 ERP 匯入可由不同角色執行。
- Period close 後的重開、重跑或 restatement 必須留下原因與額外核准。

---

## 4. 核心使用情境（User Stories）

### 4.1 建立企業與連接資料來源

身為系統管理員或財務經理，我可以：

- 建立 Entity，設定 functional currency、reporting currency、會計年度與時區。
- 新增多個 AccountSource：Sui address、CEX、custody、CSV。
- 將 source 指派給 entity、legal owner、wallet purpose 與 GL dimension。
- 以唯讀地址直接接入；若需驗證地址所有權，可使用 dApp Kit 進行簽名驗證。
- 設定歷史回補起點與增量同步頻率。

驗收重點：

- 同一來源不得在重疊期間重複歸屬於不同 entity，除非有明確 allocation rule。
- 同步重試不得產生重複 RawTransaction。
- 每次同步需記錄 cursor、來源版本、起訖時間與錯誤。

### 4.2 載入、清洗與標準化交易

身為會計人員，我需要系統將每筆來源活動拆解為一或多筆 NormalizedEvent，並保留：

- 原始 payload 與 source reference。
- 鏈、protocol、tx digest、checkpoint／block time。
- 資產識別碼、數量、方向、來源與目的地址。
- gas、fee、swap legs 與 protocol-specific metadata。
- parser version 與 normalization version。

設計理由：一筆鏈上交易可能同時包含資產移轉、交換、手續費與獎勵；若只以 transaction 為會計單位，無法產生正確的多腿分錄。

### 4.3 AI 分類與例外分流

身為會計人員，我可以看到 AI 對以下欄位的建議：

- `event_type`
- `economic_purpose`
- `counterparty_type`
- memo／分類理由
- confidence score 與觸發依據摘要

系統行為：

- 高信心且命中確定性規則的事件可進入批次 review。
- 低信心、未知合約、重大金額、新對手方或規則衝突事件進入 exception queue。
- AI 建議不得直接修改已核准事件或建立 posted JE。
- AI model／prompt／feature version 必須記錄，以利回溯。

### 4.4 應用會計政策與產生分錄

身為 Controller，我可以：

- 選用 IFRS 或 US GAAP 基礎模板。
- 設定資產會計分類、stablecoin treatment、FIFO／WAC、fee policy、staking income policy。
- 將 internal event、asset class、business purpose 與 entity dimension 映射到 chart of accounts。
- 預覽規則對歷史樣本的影響，再提交政策版本生效。

系統僅對 `review_status = APPROVED` 且已取得必要價格與政策的事件產生 draft JE。無匹配規則、缺價格、lot 不足或 debit／credit 不平衡時，必須阻擋核准並建立 exception。

IFRS 下 crypto asset 可能涉及 IAS 38、IAS 2 或 IFRS 9；US GAAP 特定 crypto assets 可能適用 ASU 2023-08 的公允價值模式。[需查證] 穩定幣是否可視為金融資產、現金或現金等價物，取決於合約權利、贖回安排與使用情境，不應由系統自行判定。[需查證]

### 4.5 Review、Approval 與 Period Close

身為會計人員，我可以：

- 在事件詳細頁並列查看 raw transaction、normalized event、AI 建議、價格、lot 與 JE preview。
- Accept、Edit、Reject、Flag 或 Split event。
- 記錄修改理由、附件與 reviewer comment。
- 對選定事件批次核准，但高風險事件需逐筆核准。

身為財務經理，我可以：

- 查看 close checklist：資料完整性、未分類事件、缺價、未解差異、未核准 JE、未匯入 ERP。
- 鎖定 period，阻止一般使用者修改。
- 產生 close package 與 Walrus snapshot。
- 在受控流程下 reopen period，並留下 restatement reason。

### 4.6 Reconciliation

身為會計人員，我可以按 `entity + source + wallet + asset + period` 比對：

- source ending balance。
- normalized movement roll-forward。
- subledger quantity／value。
- exported JE total。
- ERP acknowledgement／book balance（有回傳資料時）。

每筆差異需有 owner、原因、狀態、處理方式與 supporting evidence。容許差異門檻應依數量與價值分別設定，不應只用單一百分比。

### 4.7 ERP 匯出與回寫

身為會計人員，我可以：

- 依 entity、period、status 與 batch 選取 JE。
- 使用欄位 mapping 產出 generic CSV 或指定 ERP import template。
- 在 export 前驗證 debit = credit、period 開放、必填 dimension 完整及未重複匯出。
- 將 batch 標記為 generated、exported、acknowledged、failed 或 reversed。
- 保留匯出檔 hash、mapping version 與操作人。

MVP 不承諾 ERP API 雙向同步；首版以可驗證的 CSV 流程降低整合範圍，待客戶需求確認後再建原生 connector。

### 4.8 審計查核

身為審計人員，我可以：

- 從 period balance 下鑽至 JE、event、raw transaction 與 Sui transaction digest。
- 查看所用價格、FX、成本 lot、政策及規則版本。
- 比較事件原始分類、AI 建議、人工修改與最終結果。
- 下載 reconciliation、position roll-forward、journal export 與 close evidence。
- 取得 Walrus blob reference 並驗證 snapshot hash。

### 4.9 穩定幣企業收付款

身為 Web2 企業財務，我可以：

- 將特定 wallet 與供應商、客戶、成本中心或業務線綁定。
- 將 stablecoin receipt／payment 對應 invoice、AP、AR 或 clearing account。
- 依企業政策標註現金流活動類別，供 ERP 編製現金流量表。
- 對 off-ramp／on-ramp、network fee、匯率差與結算差異分開入帳。

此流程的產品目標是讓穩定幣活動在財務操作上接近銀行交易，而非要求一般財務人員理解底層鏈上細節。

---

## 5. 範圍與不在範圍（MVP）

### 5.1 MVP In Scope

#### 資料來源

- Sui L1：指定地址、資產、交易、餘額與必要 object metadata。
- DeepBook：MVP 選定交易類型的成交、資產腿與 fee 解析。
- CEX／custody：一至兩種 generic CSV schema。
- 手動補錄：受控 CSV，含欄位驗證與匯入批次紀錄。

#### 事件類型

- `ASSET_RECEIPT`
- `ASSET_DISPOSAL`
- `INTERNAL_TRANSFER`
- `CEX_DEPOSIT`
- `CEX_WITHDRAWAL`
- `TRADE_BUY`
- `TRADE_SELL`
- `SWAP`
- `FEE_GAS`
- `STAKING_DEPOSIT`
- `STAKING_REWARD`
- `STAKING_WITHDRAWAL`
- `UNCLASSIFIED_CONTRACT_INTERACTION`
- `PERIOD_END_REMEASUREMENT`

#### 會計與控制

- IFRS／US GAAP 基礎 PolicySet；具體判斷由客戶確認。
- FIFO、WAC cost basis。
- Event → JE mapping rule。
- draft、reviewed、approved、exported、posted／acknowledged、reversed 狀態。
- wallet-to-subledger reconciliation。
- Generic ERP-ready CSV。
- Audit log、policy version、rule version、price lineage。
- Walrus period-end snapshot。

#### 使用者介面

- Entity／source onboarding。
- Transaction／event review queue。
- Event／JE detail。
- Reconciliation workspace。
- Period close dashboard。
- Export batch 與 audit snapshot view。

### 5.2 MVP Out of Scope

- 全鏈、全 CEX、全 DeFi 協議支援。
- 完整 AP、AR、payroll、procurement 或庫存 ERP。
- 自動稅務申報與 jurisdiction-specific tax lot optimization。
- 法遵交易監控、制裁篩查與 Travel Rule 的完整產品。
- 完整財務三表編製；本產品輸出 supporting schedules 與 JE，由 ERP 編表。
- 多實體 consolidation、intercompany elimination 與 transfer pricing。
- 自主 treasury execution、交易或資金移轉。
- 無人工核准的 AI posting。
- 對 IFRS／US GAAP 適用性提供法律效力保證。

### 5.3 Phase 1／2 擴張範圍

- 原生 CEX、custody 與 EVM connectors。
- NetSuite、Xero、QuickBooks 等 API connector；實際優先順序依 pilot 客戶決定。
- 多實體與多幣別。
- 更完整的 staking、LP、lending、bridge 與 NFT 事件。
- ERP acknowledgement 與雙向 reconciliation。
- Stablecoin AP／AR workflow、invoice matching。
- Auditor portal、evidence request 與 close sign-off。
- Policy simulation、restatement 與 scenario comparison。

---

## 6. 功能模組

### 6.1 Data Ingestion 模組

**目的**：完整、冪等且可回補地接收來源資料。

**功能需求：**

- 使用 Sui TypeScript SDK 與適用 client 讀取交易、物件與餘額。
- 支援 initial backfill、incremental sync、manual resync。
- 以 source reference／digest／event index 建立去重鍵。
- 保存 raw payload、observed time、chain time、ingestion version。
- 監控 lag、失敗率、重試次數與 checkpoint gap。
- Connector credential 加密、最小權限、可輪替。

**設計理由**：財務輸出的可信度首先取決於資料完整性；分類準確率不能補償漏交易。

**輸出**：`RawTransaction`、`IngestionRun`、`SourceBalanceSnapshot`。

### 6.2 Normalization & Classification 模組

**目的**：把技術活動轉為跨來源一致的經濟事件。

**功能需求：**

- 一筆 raw transaction 可對應多筆 events。
- Protocol parser 與 generic fallback parser 分離。
- 保留資產腿、fee、counterparty、protocol、direction、business context。
- AI 建議與 parser 結果分欄保存，不互相覆蓋。
- 支援 manual split／merge，但須保留原始 lineage。
- 新 parser version 可在 sandbox 重跑並比較差異。

**設計理由**：Normalization 是可擴充性的核心。若會計規則直接依賴 protocol-specific payload，每增加協議都會擴大規則複雜度。

### 6.3 Pricing、FX & Position Lots 模組

**目的**：提供事件時點與期末的可追溯衡量資料。

**功能需求：**

- `PricePoint` 記錄 asset、quote currency、timestamp、source、method、quality status。
- 價格來源優先級與 fallback policy 可配置。
- 支援 functional currency 換算與 FX source。
- PositionLot 記錄取得事件、數量、剩餘數量、單位成本與成本方法。
- 缺價、異常價差、stale price 必須進 exception。
- 價格覆寫需記錄原值、新值、理由與核准人。

定價來源與公允價值層級的適用，應由客戶依準則與估值政策確認。[需查證]

### 6.4 Accounting Policy & Rules Engine

**目的**：將已核准事件轉成可重現的 JE。

**輸入**：

- `NormalizedEvent`
- `AssetProfile`
- `PricePoint`／FX
- `PositionLot`
- `PolicySet`
- `MappingRule`
- `ChartOfAccountsMapping`

**輸出**：

- `JournalEntryHeader`
- `JournalEntryLine`
- `RuleEvaluationTrace`
- `AccountingException`

**規則層次**：

1. Classification rule：判定 accounting treatment candidate。
2. Policy rule：依準則與企業選項決定分類、衡量及科目路徑。
3. Measurement rule：選擇成本、公允價值、FX 與 lot。
4. Posting rule：建立 debit／credit lines 與 dimensions。
5. Validation rule：平衡、期間、必填欄位、重複與控制檢查。

**設計理由**：政策、條件與動作需資料化、版本化，避免散落在程式碼的 if／else 無法被財務審查。

### 6.5 Review & Approval Workflow 模組

**目的**：將自動化與人員責任連接。

**功能需求：**

- Queue 可按 entity、period、risk、confidence、amount、protocol 篩選。
- Event detail 顯示來源、建議、規則與 JE preview。
- 支援 maker-checker、批次操作與高風險逐筆核准。
- 所有欄位變更以 before／after 形式紀錄。
- Period lock 後限制修改。
- SLA、assigned owner、comment、attachment 與 escalation。

### 6.6 Reconciliation & Controls 模組

**目的**：證明來源資產、subledger 與 ERP 輸出一致。

**功能需求：**

- Quantity recon 與 valuation recon 分開。
- 支援 opening + movements = ending 的 roll-forward。
- 對內部轉帳進行雙邊 matching，避免重複認列收支。
- 對 CEX deposit／withdrawal 進行時間窗與數量 matching。
- 差異可分類為 timing、missing data、pricing、classification、fee、rounding、unknown。
- 未解重大差異阻擋 close。

### 6.7 ERP／GL Integration 模組

**目的**：把核准分錄可靠地交付正式總帳。

**MVP：**

- Generic CSV schema。
- Mapping profile 與 template version。
- Export batch idempotency。
- Hash、checksum 與下載紀錄。
- Reversal／re-export 控制。

**後續：**

- ERP API connector。
- Master data sync。
- Posting acknowledgement。
- Subledger-to-GL reconciliation。

### 6.8 Audit Trail & Walrus Snapshot 模組

**目的**：保存關帳狀態及其可驗證證據。

**Snapshot 內容：**

- Entity、period、policy／rule／parser version。
- Source balance、positions、lots、prices。
- Approved JE 與 export manifest。
- Reconciliation 與 exception disposition。
- Audit log 摘要與檔案 hash。

**流程：**

1. Close 前凍結資料集合。
2. 生成 canonical manifest。
3. 對 package 計算 hash。
4. 上傳 Walrus 並取得 blob reference。
5. 回寫 `AuditSnapshot`。
6. UI 顯示 reference、hash、建立人與驗證狀態。

Walrus 的持久性、可用性、成本、保留期與企業資料治理能力需在正式商用前驗證。[需查證] 敏感資料不應因「可驗證」需求而直接公開；MVP 應採最小資料、加密封裝或只存 hash／manifest 的策略。

### 6.9 AI Assistant 模組

**MVP 能力：**

- 建議 event type、business purpose、counterparty type。
- 產生可編輯 memo 與分類理由。
- 發現可能的 internal transfer、spam、dust、未知 protocol 或異常金額。
- 將事件依風險與信心排序。
- 以自然語言解釋規則結果，但答案必須引用系統內 evidence。

**禁止能力：**

- 直接變更 PolicySet。
- 直接核准事件或 JE。
- 直接 posting 至 ERP。
- 直接發起鏈上資產移轉。
- 在無 evidence 時宣稱某處理符合準則。

**設計理由**：AI 適合處理高變異的語意理解；正式衡量與分錄則應由可測試的規則引擎執行。

### 6.10 Security、Permissions & Governance

- RBAC：Admin、Controller、Accountant、Ops Contributor、Auditor、Viewer。
- 支援 entity-level 與 action-level 權限。
- 重要操作需要 step-up authentication。
- API key、token、credential 使用 envelope encryption 或 managed secret store。
- 不保存私鑰；地址驗證使用簽名 challenge。
- Audit log append-only，且具 retention policy。
- 資料匯出、snapshot、policy change 與 period reopen 需高風險告警。
- 商用前需定義資料駐留、備份、刪除、隱私與 incident response 控制。

### 6.11 Reporting & Close Workspace

- Period status dashboard。
- Event completeness、classification、pricing、JE、recon、export 六類狀態。
- Position by entity／wallet／asset。
- Realized／unrealized gain-loss supporting schedule。
- Stablecoin receipt／payment schedule。
- ASU 2023-08 或 IFRS 所需揭露資料支援欄位，實際揭露要求需由專業人員確認。[需查證]
- 報表不是正式財報；需清楚標示來源期間、政策版本與生成時間。

### 6.12 模組與 PRD 優先級

| 模組 | MVP 優先級 | 原因 |
|---|---:|---|
| Ingestion | P0 | 無完整來源即無可靠輸出 |
| Normalization | P0 | 核心 Sui-native 技術壁壘 |
| Policy／Rules | P0 | 產品成為 subledger 的必要條件 |
| Review／Approval | P0 | 企業控制與 AI 邊界 |
| ERP CSV Export | P0 | 完成端到端價值鏈 |
| Reconciliation | P1；demo 最小版 P0 | 商用必要，hackathon 可先做 wallet recon |
| Walrus Snapshot | P1；demo P0 | 展示 Sui-native audit evidence |
| Reporting | P1 | 提升 close workflow 完整性 |
| Native ERP APIs | P2 | 依付費客戶需求排序 |
| Autonomous Treasury | P3 | 高風險且偏離初期產品邊界 |

---

## 7. Sui Stack 整合設計

### 7.1 Stack 使用原則

Sui Stack 必須服務真實產品需求，而非僅為展示而堆疊。MVP 優先使用能直接提升資料完整性、事件解析、審計證據與使用體驗的元件。

### 7.2 元件對應

| Sui 元件 | 產品用途 | 階段 | 設計理由 |
|---|---|---:|---|
| TypeScript SDK | 查詢交易、物件、餘額；parser 開發 | MVP | 後端 ingestion 與 Sui-native parsing 基礎 |
| GraphQL／Indexer | 歷史查詢、期間篩選、報表與重跑 | MVP／Phase 1 | 會計工作負載需要可篩選歷史資料 |
| gRPC／RPC client | 增量同步與即時讀取 | MVP／Phase 1 | 將 ingestion 與分析查詢分流 |
| dApp Kit | 地址 ownership 驗證、wallet-connected UI | MVP 選配 | 不保存私鑰即可驗證企業地址 |
| DeepBook | 交易、fee 與 position 事件來源 | MVP 選定範圍 | 建立 Sui DeFi accounting 差異化 |
| Walrus | Close package／audit manifest 儲存 | MVP | 提供可驗證的 period-end evidence |
| SuiNS | 地址可讀名稱與 counterparty mapping | Phase 1 | 降低財務使用者認知負擔 |
| Seal | 敏感 snapshot／附件加密策略 | Phase 1 | 平衡可驗證性與機密性 |
| Nautilus | 可驗證的 off-chain pricing／policy computation | Phase 2 | 估值與機密運算的未來路徑 |
| zkLogin／Enoki | Web2-friendly onboarding | Phase 2 | L3 客群的登入體驗 |
| Clock | On-chain cutoff／時間證據（如有 Move 元件） | Phase 2 | 降低 off-chain time ambiguity |

上述元件的最新 API、穩定性、正式支援狀態與商用限制需在實作前依官方文件確認。[需查證]

### 7.3 架構模組圖

```text
┌─────────────────────────────────────────────────────────────┐
│ Enterprise Finance Layer                                    │
│ CFO / Accountant / Auditor │ ERP / GL │ Reports / Close     │
└───────────────────────────────▲─────────────────────────────┘
                                │ JE / recon / audit evidence
┌───────────────────────────────┴─────────────────────────────┐
│ Sui Agentic Subledger                                        │
│ Review & Close UI │ AI Suggestions │ Rules Engine │ ERP I/O │
│ Reconciliation   │ Pricing & Lots  │ Audit Trail  │ RBAC    │
└───────────────────────────────▲─────────────────────────────┘
                                │ normalized financial events
┌───────────────────────────────┴─────────────────────────────┐
│ Data & Trust Layer                                           │
│ Sui SDK / RPC / GraphQL / Indexer │ CEX / Custody / CSV     │
│ DeepBook parsers │ Walrus snapshots │ Seal / SuiNS (later)  │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 核心資料流

```text
Source
  → RawTransaction
  → NormalizedEvent
  → AI suggestion + human review
  → PricePoint + PositionLot
  → PolicySet + MappingRule
  → JournalEntry
  → ReconciliationRecord
  → ERP ExportBatch
  → AuditSnapshot / Walrus reference
```

所有箭頭都需保留來源 id、版本與時間，確保任一報表數字可反向追溯。

### 7.5 Hackathon Demo 邊界

Demo 應呈現單一 entity 的完整 happy path 與一個 exception：

1. 匯入 Sui 錢包交易。
2. 解析 stablecoin receipt、payment、swap／DeepBook trade 與 gas。
3. AI 建議分類，其中一筆低信心進 review。
4. 人工修改並核准。
5. 規則引擎產生平衡 JE。
6. Wallet balance 與 subledger reconciliation。
7. 匯出 CSV。
8. 建立 Walrus close snapshot 並顯示 reference。

Agentic Web 的敘事是「AI 處理理解與例外、規則控制正式結果、Sui 提供可驗證來源與證據」，而不是宣稱 AI 自主作出最終會計決策。

---

## 8. 非功能性需求

### 8.1 正確性與可重現性

- Debit 與 credit 必須平衡。
- 所有數量計算使用適合資產精度的 decimal／integer 表示，不使用 binary floating point。
- 同一輸入與版本必須重跑得到一致結果。
- 重跑不得覆蓋已 posted 結果；應建立新版本或 reversal。
- 每筆 JE 可追溯 raw transaction、event、price、lot、policy、rule 與 reviewer。

### 8.2 效能與容量

MVP 設計目標：

- 單一 entity 每月 50,000 筆 raw transactions。
- 一般 review list 查詢在合理資料量下 p95 < 2 秒（不含外部來源延遲）。
- 10,000 筆事件的批次規則評估在 10 分鐘內完成。
- 增量 ingestion lag 目標 < 15 分鐘。

以上為內部產品目標，不代表已驗證基準；需以實測調整。

### 8.3 可靠性

- Ingestion 與 export 必須 idempotent。
- 外部 API 失敗採 exponential backoff、dead-letter 與人工重跑。
- 所有 batch 有明確狀態與可恢復 checkpoint。
- Close snapshot 建立失敗不得將 period 標示為完成。
- 核心資料庫定期備份並執行 restore test。

### 8.4 安全與隱私

- TLS in transit、encryption at rest。
- Secret 不得出現在 log、prompt 或 client bundle。
- AI provider 僅接收完成任務所需最小資料；客戶敏感欄位需遮罩。
- 支援 tenant isolation。
- 高風險操作與大批量匯出需通知。
- 商用目標可評估 SOC 2、ISO 27001 或同等控制，但認證必要性與時程需查證客戶要求。[需查證]

### 8.5 可觀測性

- 監控 ingestion completeness、parser error、classification confidence、missing price、rule failure、recon variance、export failure。
- 每個 request／batch 使用 correlation id。
- 建立營運 dashboard 與告警門檻。

### 8.6 可用性與可及性

- Desktop-first，支援常見現代瀏覽器。
- 表格支援篩選、儲存 view、批次操作與 CSV。
- 顏色不可作為唯一狀態訊號。
- 財務名詞優先，鏈上技術欄位放在 secondary detail。

### 8.7 資料保留與治理

- Raw transaction、JE、audit log 與 snapshot 採不同 retention class。
- Period close 後資料不可直接刪改。
- 客戶終止時提供可攜式 export 與受控刪除流程。
- 實際保留年限依司法管轄區、契約與審計要求設定。[需查證]

---

## 9. 路線圖

### Phase 0：Hackathon MVP

- 單一 entity、Sui address ingestion。
- 4 類事件：receipt、payment、swap／DeepBook、gas。
- AI suggestion、confidence 與人工 review。
- 最小 IFRS／US GAAP policy switch demo。
- JE 產生、wallet reconciliation、CSV export。
- Walrus snapshot。

**完成定義**：從真實或可重現測試交易走完端到端流程，且每筆 JE 可追溯來源與規則。

### Phase 1：Design Partner Pilot

- 多錢包、staking、CEX CSV。
- FIFO／WAC lots 與完整 pricing exception。
- Policy／mapping UI。
- Close checklist、maker-checker、period lock。
- 3–5 個 design partners；目標數量屬 GTM 假設，不是既有承諾。（推測）

### Phase 2：Commercial v1

- 多實體、多幣別。
- 原生 ERP connector 依客戶需求排序。
- Auditor portal、SSO、企業安全控制。
- 完整 wallet／source／GL reconciliation。
- 穩定幣收付款與 invoice／counterparty mapping。

### Phase 3：Web2 Stablecoin Treasury Expansion

- Stablecoin AP／AR 與 TMS integration。
- 更多 payment rails、custody 與銀行資料。
- Policy controls、approval workflow、cash forecasting support。
- 由 crypto-native subledger 延伸為 enterprise digital asset finance operations layer。

### Phase 4：受控 Agentic Finance

- AI 主動提出 close plan、例外處理建議與 evidence package。
- Policy-as-code simulation。
- 經明確授權的非資金型自動操作，例如建立 draft JE、指派例外、準備 export。
- 任何資金執行或正式 posting 仍需獨立安全與責任設計。

---

## 10. 競品與替代方案分析

### 10.1 分析前提

下表根據 Ideas 素材中的公開描述彙整，未於本文件產製過程重新瀏覽各產品最新官網、方案與價格。所有能力與定位均應在對外使用前逐項查證。

| 產品／替代方案 | 公開定位與可能能力 | ERP／企業整合 | Sui／DeFi 觀察 | 本產品可採差異化 | 驗證狀態 |
|---|---|---|---|---|---|
| Cryptoworth | Crypto subledger、成本基礎、分錄與 NetSuite 整合 | 強調 Oracle NetSuite 等整合 | Sui 深度未知 | Sui-native parser、可切換政策、Walrus evidence | [需查證] |
| TRES Finance | Web3 financial data、subledger、reconciliation、DeFi coverage | 宣稱支援 Xero、QuickBooks、NetSuite、SAP、Oracle 等 | 新鏈擴充能力與 Sui 現況未知 | Sui object／DeepBook 深度、agentic close | [需查證] |
| Bitwave | Enterprise digital asset accounting、tax、payments／treasury 與 audit-ready workflow | 宣稱支援多種 ERP | Sui coverage 與細節未知 | 精簡導入、IFRS／US GAAP policy trace、Sui evidence | [需查證] |
| Cryptio | Institutional digital asset accounting、data transformation、多實體 | NetSuite／ERP API 為重要賣點 | Sui coverage 與協議深度未知 | Sui-first、可解釋 AI、hackathon-to-product speed | [需查證] |
| CoinTracker | 以個人投資組合與稅務為大眾認知主軸 | 企業 subledger／ERP 能力可能非核心 | Sui 與企業控制未知 | 專注企業 close、SoD、recon、ERP | [需查證] |
| TaxBit | Enterprise accounting、tax／compliance、AI-enabled rules 等 | 企業整合能力 | Sui coverage 未知 | 較窄的 Sui wedge、快速 design-partner 客製 | [需查證] |
| Integral | Crypto accounting，素材稱已支援 Sui | ERP 與會計輸出能力需確認 | 可能是最直接的 Sui 競品 | DeepBook／Walrus 深度、policy version、AI review | [需查證] |
| ZenLedger | 稅務、成本基礎與會計報告；素材稱已支援 Sui | 企業 ERP 深度需確認 | 已有 Sui 品牌／生態曝光 | 子分類帳控制、ERP close 與 audit evidence | [需查證] |
| Excel＋外包會計師 | 高彈性、低軟體門檻、依賴人工 | 以 CSV／手動 JE 連接 ERP | 可處理任何鏈但難規模化 | 可重跑、自動 lineage、例外管理 | 不適用 |
| 自建 indexer＋內部腳本 | 客製度高、可深度支援 Sui | 由企業自行整合 | 技術深度可高 | 降低維護成本、提供會計產品與控制 | 不適用 |

### 10.2 競爭判斷

- 市場類別已被驗證，但「有市場」不等於本產品自然具有競爭優勢。[需查證]
- 多數成熟競品可能在 chain coverage、ERP connectors、企業安全與客戶信任上領先。（推測）
- 本產品初期不應宣稱功能全面超越成熟平台，而應以 Sui-native depth、導入速度、政策可追溯性及可驗證 close evidence 取得 design partner。
- 若競品已能完整解析 Sui 與 DeepBook，Sui coverage 本身將不足以形成 moat；需累積 event taxonomy、規則庫、財務 review data 與 partner distribution。（推測）

### 10.3 替代成本與 switching strategy

客戶常見替代方案是 Excel、內部 SQL／Python、外包會計師或既有 subledger。切換策略應為：

- 先做 parallel close，不立即替代既有流程。
- 對同一期間輸出 reconciliation 與 variance explanation。
- 以單一 entity、wallet group 或 stablecoin use case 上線。
- 可匯出完整 source-to-JE lineage，降低 vendor lock-in 疑慮。

---

## 11. 量化 KPI 與成功指標

### 11.1 North Star Metric

**每月在控制要求內自動完成、且最終被核准並成功匯出之事件數（Controlled Auto-Processed Events）。**

此指標同時要求：

- 來源完整。
- 分類與規則成功。
- 無重大未解差異。
- 經適當 review。
- 最終被財務流程採用。

單純「AI 分類率」不足以代表客戶價值。

### 11.2 產品與營運 KPI

| 類別 | KPI | Pilot 目標 | 商用 v1 目標 | 計算說明 |
|---|---|---:|---:|---|
| 資料完整性 | Ingestion completeness | ≥ 99.5% | ≥ 99.9% | 已接收 expected records／source records |
| 時效 | 增量同步 lag p95 | < 30 分鐘 | < 15 分鐘 | chain/source time 至系統 observed time |
| 分類 | 標準事件分類 precision | ≥ 90% | ≥ 95% | 以人工最終分類抽樣評估 |
| 自動化 | 無需欄位修改的 approved events | ≥ 70% | ≥ 85% | 不含明確排除的未知 protocol |
| 例外 | 未分類事件率 | < 10% | < 5% | period close 前 |
| 定價 | 缺價格事件率 | < 2% | < 0.5% | 需估值事件中缺可接受價格者 |
| 規則 | JE first-pass success | ≥ 95% | ≥ 99% | 無規則錯誤且 debit＝credit |
| 對帳 | 已解差異率 | ≥ 95% | ≥ 99% | close 前已解 variance／全部 variance |
| 關帳 | 人工處理時間降低 | ≥ 30% | ≥ 50% | 與客戶 baseline 比較 |
| 審計 | Source-to-JE trace coverage | 100% | 100% | 每筆 JE 都有完整 lineage |
| ERP | Export batch success | ≥ 98% | ≥ 99.5% | 不含客戶主檔錯誤 |
| 使用 | Weekly active finance users | 每客戶 ≥ 2 | 每客戶 ≥ 3 | 依角色去重 |

上述為產品目標與假設，需透過 design partner baseline 校準，不應當作市場現況數字。

### 11.3 商業 KPI

| 階段 | KPI | 假設目標 |
|---|---|---:|
| Design partner | 有效訪談 | 15–25 家 |
| Design partner | 簽署 pilot | 3–5 家 |
| Pilot | 完成至少一次 parallel close | ≥ 80% pilot |
| Pilot | 轉付費率 | ≥ 40% |
| 商用初期 | Gross revenue retention | ≥ 90% |
| 商用初期 | Pilot-to-production 週期 | < 12 週 |
| 商用初期 | Implementation gross margin | 逐季改善 |

以上均為（推測）的內部目標，並非外部市場 benchmark。

### 11.4 KPI 防作弊與品質門檻

- 自動分類率不可排除困難交易後再計算，需同時揭露 coverage。
- 關帳時間縮短需以同一範圍、同等控制要求比較。
- 對帳差異不應只看價值百分比，也需追蹤數量與未解項目數。
- AI accuracy 需以最終人工結果與抽樣審查衡量。
- 若發生 material accounting error，該期間不得計入「成功 close」。

---

## 12. 風險與緩解

| 風險 | 可能影響 | 優先度 | 緩解措施 |
|---|---|---:|---|
| Sui／protocol schema 變更 | parser 失效、漏事件 | 高 | Versioned parser、fixture tests、gap monitoring、fallback queue |
| 來源資料不完整 | JE 與餘額錯誤 | 高 | Completeness checks、balance roll-forward、resync、source SLA |
| AI 誤分類 | 錯誤 business purpose | 高 | AI 僅建議、confidence threshold、人工核准、抽樣 QA |
| 會計政策誤用 | 財報錯誤與責任風險 | 高 | 客戶確認政策、版本核准、免責聲明、專業顧問合作 |
| 價格品質不足 | 估值與損益錯誤 | 高 | 多來源、stale／outlier control、manual override approval |
| Internal transfer matching 錯誤 | 重複認列收入／費用 | 高 | Ownership graph、雙邊 matching、時間窗、exception review |
| ERP 重複匯入 | 總帳重複分錄 | 高 | Idempotency key、batch manifest、acknowledgement、reversal flow |
| Walrus 資料機密性 | 敏感財務資訊外洩 | 高 | 加密、最小 manifest、只存 hash／reference、access review |
| Credential 洩漏 | CEX／客戶資料外洩 | 高 | Read-only scopes、secret manager、rotation、redaction |
| 多租戶隔離失敗 | 客戶資料交叉暴露 | 高 | Tenant-aware authorization、tests、encryption、security review |
| 成熟競品快速支援 Sui | 差異化下降 | 中高 | 深化 protocol rules、財務 workflow、partner channel、服務速度 |
| 客戶不願更換流程 | 銷售週期長 | 中高 | Parallel close、CSV-first、導入服務、可逆上線 |
| Pilot 客製化過度 | 難產品化、毛利低 | 中高 | 配置優先、客製審核、共通規則庫、明確 SOW |
| 全球準則／法規差異 | Scope expansion | 中高 | 先限 IFRS／US GAAP interfaces；不承諾稅務法遵 |
| 關帳結果不可重現 | 審計信任受損 | 高 | Immutable raw、version pinning、deterministic engine、snapshot |
| 關鍵外部服務中斷 | 同步／snapshot 失敗 | 中 | Queue、retry、cache、provider abstraction、degraded mode |

### 12.1 Go／No-Go 風險門檻

在進入付費商用前，至少需證明：

- 目標事件範圍的完整性與 parser 測試可量化。
- 任一 JE 可完整追溯與重跑。
- 客戶敏感資訊不會以明文寫入公開儲存。
- 無私鑰保存與未授權資金執行。
- PolicySet 有客戶核准紀錄。
- Export 具防重複與 reversal 機制。
- 至少完成一次真實資料 parallel close。

---

## 13. 定價與商業模式假設

### 13.1 商業模式

初期採 **SaaS 訂閱 + 導入服務 + 選配模組**：

- SaaS：依 entity、月處理事件量與功能層級收費。
- Implementation：資料來源、chart of accounts、PolicySet、歷史回補與 ERP mapping。
- Add-ons：額外 source、原生 ERP connector、auditor portal、premium SLA、客製 protocol parser。
- Advisory partner：與會計師／顧問合作，由對方提供專業判斷，本產品提供系統化落地。

設計理由：早期客戶資料與政策差異大，只收低價自助 SaaS 可能無法涵蓋導入成本；但所有服務工作都需回饋為可配置模板，避免成為純顧問公司。

### 13.2 建議方案結構

以下價格僅為（推測）的驗證假設，不是正式報價，需透過訪談與 pilot 測試 willingness-to-pay。

| 方案 | 目標客群 | 包含內容 | 計價假設 |
|---|---|---|---|
| Pilot | Sui 項目方、小型 crypto company | 1 entity、限定 sources、parallel close、CSV export | 一次性導入費＋2–3 個月 pilot fee |
| Growth | 成長型 Web3 企業 | 多 source、rules、recon、Walrus snapshot、標準支援 | 月訂閱；依事件量與 entity tier |
| Enterprise | CEX、基金、支付商、Web2 treasury | 多實體、SSO、ERP API、auditor portal、SLA | 年約＋導入費＋用量 |
| Partner | 會計師事務所／fund admin | Multi-client workspace、模板、批次 close | Platform fee＋client packs |

### 13.3 計價單位選擇

建議主要使用：

- Entity 數。
- 每月 normalized event／transaction tier。
- Source／connector 數。
- Enterprise feature 與 SLA。

不建議只按 wallet 數收費，因為：

- Wallet 數與實際處理成本及客戶價值不一定相關。
- 企業可能因安全政策建立大量地址。
- 容易促使客戶少接來源，反而降低完整性。

### 13.4 價值定價依據

銷售需量化：

- 現行每月人工工時。
- 外包會計與資料整理成本。
- Close 延遲造成的管理與審計成本。
- 未解差異與重工率。
- 新增一條鏈／協議的內部維護成本。

若產品無法在 pilot 中證明關帳時間、差異處理或 audit readiness 的改善，就不應只以「AI」或「鏈上不可竄改」支撐高價。

### 13.5 收入與成本假設

主要成本：

- Sui／CEX／pricing data provider。
- AI inference。
- Walrus storage／retrieval。
- Cloud database、queue、observability。
- 導入與客戶支援。
- 會計與安全顧問。

商業設計需追蹤每客戶 contribution margin。若 protocol parser 與 mapping 長期依賴大量人工客製，應提高 implementation fee、限制支援範圍或暫停該 segment。

---

## 14. GTM 計畫

### 14.1 GTM 原則

- 先賣「可完成一次乾淨月結」，不是賣抽象 AI 平台。
- 先找已經使用鏈上資產的企業，不教育尚未採用 crypto 的公司。
- 以 finance、audit、ERP 語言溝通，不以 DeFi 技術功能為主。
- 每個 pilot 都需產生可量化 before／after 與可重用模板。

### 14.2 Phase 1：Sui 生態 design partners

目標客戶：

- 已正式營運且有法人實體的 Sui protocol／application。
- 使用 DeepBook、staking 或大量 Sui wallet 的團隊。
- 已有外部會計師、投資人報告或審計需求的團隊。

Offer：

> 使用客戶一個月的 Sui 活動完成 parallel close，交付事件分類、wallet reconciliation、draft JE、exception list 與 audit snapshot。

管道：

- Sui hackathon、grants、builder network 與生態 BD。
- Sui custody、wallet、data provider 與會計服務夥伴。
- 「如何為 Sui 公司完成 IFRS／US GAAP month-end close」內容行銷。

生態計畫、合作方支援與活動規則均屬時效性資訊，對外使用前需查證。[需查證]

### 14.3 Phase 2：Crypto-native 擴張

- CEX、做市商、基金、支付商與 custody customer。
- 加入 CEX、multi-source、lots、NAV／P&L supporting schedule。
- 與 fund admin、會計師事務所、custodian 建 referral／implementation partnership。

### 14.4 Phase 3：Web2 stablecoin treasury

- 只鎖定已使用 stablecoin 的業務線。
- 從單一場景導入：跨境供應商付款、收款、affiliate payout 或 treasury parking。
- Hero message：讓 stablecoin flows 像 bank transactions 一樣進入 ERP。
- 與 payment rail／wallet governance provider 共同銷售，避免自行承擔支付與託管全棧。

### 14.5 銷售資格條件

高優先 lead 應符合至少三項：

- 有法人及固定月結。
- 有財務人員或外部會計師。
- 每月鏈上活動已造成顯著人工工作。
- 使用 Sui／DeepBook 或穩定幣。
- 有 ERP／會計系統。
- 願意提供一個期間做 parallel close。
- 有明確專案 owner 與預算路徑。

### 14.6 Pilot 成功交付物

- Source inventory 與 completeness assessment。
- Event taxonomy coverage report。
- PolicySet 與 chart of accounts mapping。
- 一個期間的 approved JE batch。
- Wallet／source reconciliation。
- Exception backlog 與改善建議。
- ERP-ready export。
- Walrus audit manifest。
- KPI baseline 與 ROI review。

---

## 15. 資料模型摘要

### 15.1 核心實體

| 實體 | 目的 | 關鍵欄位摘要 |
|---|---|---|
| Entity | 法人／帳務主體 | standard、functional currency、timezone、fiscal calendar |
| AccountSource | wallet／CEX／custody／CSV | provider、owner entity、source type、status |
| IngestionRun | 同步批次 | cursor、range、status、counts、errors |
| RawTransaction | 不可覆寫來源 | source ref、payload、chain time、observed time |
| NormalizedEvent | 標準財務事件 | type、asset、qty、purpose、confidence、review status |
| AssetProfile | 資產技術與會計屬性 | identifier、decimals、technical type、accounting class |
| PricePoint | 價格／FX | timestamp、source、method、quality |
| PositionLot | 成本批次 | acquired／remaining qty、unit cost、method |
| PolicySet | 企業會計政策 | standard、stablecoin treatment、valuation、version |
| MappingRule | 事件至科目規則 | conditions、actions、priority、version |
| JournalEntry | 分錄 header／lines | period、source event、status、dimensions |
| ReconciliationRecord | 對帳差異 | scope、source balance、book balance、variance、status |
| ExportBatch | ERP 交付 | format、mapping version、hash、status |
| AuditSnapshot | 關帳證據 | manifest hash、Walrus ref、period、versions |
| AuditLog | 操作軌跡 | actor、action、before、after、timestamp |

### 15.2 關鍵關聯

- Entity 1:N AccountSource。
- AccountSource 1:N RawTransaction。
- RawTransaction 1:N NormalizedEvent。
- NormalizedEvent N:1 AssetProfile，並可關聯 PricePoint、PositionLot。
- PolicySet + MappingRule + NormalizedEvent → JournalEntry。
- Entity／period／asset／source → ReconciliationRecord。
- Approved JournalEntry N:1 ExportBatch。
- Period close 的所有版本與輸出 → AuditSnapshot。

### 15.3 資料不變性與版本策略

- RawTransaction append-only。
- NormalizedEvent 修改產生 revision，不刪除既有 revision。
- PolicySet、MappingRule、parser、price override 皆版本化。
- Posted JE 不直接更新；以 reversal／replacement 處理。
- Snapshot pin 住所有相關版本，確保日後可重現。

---

## 16. 依賴、假設與待決策

### 16.1 關鍵依賴

- Sui API／Indexer 的歷史完整性與服務穩定性。
- DeepBook event schema 與可用測試資料。
- 可合法使用且品質足夠的 pricing／FX data。
- Pilot 客戶提供 wallet ownership、business purpose、COA 與政策決策。
- Walrus 對企業快照的成本與資料治理適配性。
- 會計專業人士審查模板。

### 16.2 主要產品假設

- Sui 項目方願意使用專門 subledger，而非只依賴現有多鏈平台。（推測）
- 「一次乾淨月結」比單純 dashboard 更能形成付費意願。（推測）
- AI 的主要價值在降低 review workload，而不是取代規則引擎。（推測）
- CSV-first 足以完成早期 pilot，原生 ERP API 不是首要成交條件。（推測）
- Walrus snapshot 能提升 pitch 與審計可信度，但未必是客戶採購的第一順位。（推測）

### 16.3 待決策

1. Pilot 首個資產與協議清單。
2. GraphQL、gRPC／RPC 與自建 indexer 的實際分工。
3. Pricing provider 與 fallback 方法。
4. Walrus 儲存完整加密 package 或只存 manifest／hash。
5. IFRS／US GAAP template 的正式審查流程。
6. 首個 ERP export template。
7. AI provider、資料使用條款與 tenant isolation。
8. Pilot 定價及免費／付費邊界。

---

## 17. 驗收總則

產品 v1.0 規格所描述的 MVP，只有在以下條件同時成立時才視為完成：

- 可從指定 Sui source 完整接入並重跑一個期間。
- 可將目標事件正確拆解為 normalized events。
- AI 建議與人工決策清楚分離。
- 規則引擎對已核准事件產生平衡且可追溯的 JE。
- 可完成 wallet-to-subledger reconciliation。
- 可產出防重複的 ERP-ready export。
- 可生成含版本與 hash 的 Walrus audit snapshot。
- 任一輸出數字皆可下鑽至 raw source。
- 所有政策、規則與人工修改都有 audit trail。
- 不保存客戶私鑰，不允許 AI 自主 posting 或移轉資金。

---

## 附錄 A：核心會計介面摘要

詳細會計判斷應由獨立《會計規格書》維護；本文件只定義產品接口。

### A.1 PolicySet 最小欄位

- `accounting_standard`
- `functional_currency`
- `reporting_currency`
- `cost_basis_method`
- `stablecoin_treatment`
- `crypto_classification_default`
- `staking_income_policy`
- `fee_expense_policy`
- `impairment_or_fair_value_mode`
- `chart_of_accounts_mapping_version`
- `effective_from`
- `version`
- `approval_status`

### A.2 規則引擎最小控制

- 僅處理 approved event。
- 規則有 priority、effective period 與 version。
- 缺價格、缺 lot、缺 mapping 或不平衡時 fail closed。
- 每次 evaluation 保存 matched conditions 與 amount source。
- Restatement 必須指定新舊版本與影響期間。

### A.3 準則邊界

IFRS、US GAAP、IAS 38、IAS 2、IFRS 9、IFRS 13 與 ASU 2023-08 的實際適用與揭露要求皆需由專業會計人員依最新準則及客戶事實確認。[需查證]

---

## 附錄 B：名詞

- **RawTransaction**：來源系統取得、未經會計解讀的原始資料。
- **NormalizedEvent**：跨來源一致、可由規則引擎處理的經濟事件。
- **PolicySet**：某 entity 在特定期間有效的會計政策集合。
- **MappingRule**：將事件條件映射至衡量與分錄動作的版本化規則。
- **PositionLot**：用於成本基礎與處分計算的資產批次。
- **Reconciliation**：來源、subledger、export 與 GL 間的一致性驗證。
- **AuditSnapshot**：某期間 close 狀態的固定 manifest 與證據 package。
- **Agentic**：AI 可主動分析、建議與編排工作，但受政策、權限及人工核准約束。

