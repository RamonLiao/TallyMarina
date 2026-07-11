# Ideas/ 目錄規格書摘要（供「初始規格 vs 已實作系統」比對用）

來源目錄：`/Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/Ideas/`
共 9 個 .md 檔，全部讀取完成，無缺漏。檔名對照表：

- F1 = `企業穩定幣與鏈上資產對接 ERP／三大報表的現況與方案.md`（競品市場現況）
- F2 = `請先幫我整理 ICP 與 GTM 分層建議.md`（ICP/GTM）
- F3 = `查看產品 PRD _ 模組切分，已經如何運用sui官方提供的開發工具dev stacks來進行開發.md`（PRD 模組切分 + Sui dev stack 對應）
- F4 = `好，寫出會計規格書 v0.1.md`（會計規格書 v0.1，主文件）
- F5 = `幫我寫一份正式的商業規格書，模板可參考其他對話的範例。會計功能的部分，要另外一份規格書，後續做系統設.md`（商業/產品規格書 v0.1，主文件）
- F6 = `首版資料模型與會計規則引擎設計.md`（資料模型 + 規則引擎設計，主文件）
- F7 = `<q>把「這個 Sui Stack 整合架構」畫成一個簡化的模組圖 + 說明（用文字描述.md`（Sui Stack 架構圖 + Hackathon track 選擇）
- F8 = `還有哪些sui stack是可以運用的？例如walrus、deepbook、nautilus、sea.md`（Sui Stack 補充：Walrus/DeepBook/Nautilus/Seal/SuiNS/Clock）
- F9 = `最終目標客群，仍是一般web2企業，但可先從小範圍開始，例如CEX或是已經正式營運的Sui項目。基本.md`（ICP 切入順序 + 定位 + 差異化，早於 F2/F3/F6 的討論）

---

## 1. 產品定位與核心價值主張

**產品名稱（暫定）**：Sui Agentic Subledger（F5）

**一句話定位**（F5 §2.1）：
> 「Sui Agentic Subledger 是一個專為財務團隊打造的數位資產子分類帳，利用 Sui Stack 與 AI，將錢包與 DeFi 活動轉換為 IFRS / GAAP-ready 的分錄與審計軌跡，並串接既有 ERP。」

**要解決的會計問題**（F5 §1.2、F9）：
1. Crypto 活動難以關帳：多鏈、多錢包、多交易所 + DeFi 合約，月結常花 2–3 週人工整理對帳。
2. 審計與合規風險：缺乏可重現的 subledger 與規則引擎，會計判斷散落 Excel。
3. AI 工具與會計流程缺乏結合：AI 能分類交易，但缺乏可審計、可控的決策邊界。
4. Sui / 新鏈 coverage 不足：現有 crypto subledger 對 Sui 這種物件導向、高 TPS L1 的支援有限。

**核心定位澄清**（F9、F3、F6）：
- 不是要取代 ERP（NetSuite/SAP/Xero/QuickBooks），而是「站在 ERP 前面的會計轉譯層 / subledger」。ERP 是 GL of record，本產品是 subledger（F6 末段五原則之一）。
- 差異化三點（F9）：Sui-native accounting intelligence／policy-switchable accounting engine（IFRS/GAAP 可切換）／AI-assisted close workflow（不只分類，還含例外清單、review queue、close checklist）。
- AI 定位（F9、F5、F6、F3）：AI 只做建議（event_type、economic_purpose、counterparty_type、異常標記），不可直接自動 posting；最終分錄仍需人工 approve，避免黑盒會計。

---

## 2. 規格書列出的功能清單（逐項標出處）

### 2.1 F5（商業規格書）7 大功能模組（§6）
1. **Data Ingestion**（F5 §6.1）：Sui TypeScript SDK + GraphQL/Indexer 抓取指定 address/object 交易與餘額；支援多 source per entity；排程更新；錯誤重試。
2. **Normalization & Classification**（F5 §6.2）：RawTransaction → NormalizedEvent；event_type 枚舉（ASSET_RECEIPT/ASSET_DISPOSAL/INTERNAL_TRANSFER/SWAP/STAKING_DEPOSIT/STAKING_REWARD/FEE_GAS/UNCLASSIFIED_CONTRACT_INTERACTION）；AI 建議 + confidence_score + review_status。
3. **Accounting Policy & Rules Engine（接口版）**（F5 §6.3）：Input=NormalizedEvent+PricePoint+PolicySet+PositionLots；Output=JournalEntryHeader+Lines；只處理 APPROVED 事件；找不到 mapping 則標記「需政策配置」不自動出帳。
4. **Review & Approval Workflow**（F5 §6.4）：Transaction Review Queue、Event 詳細頁（含 Sui Explorer link）、Journal Review（可調 account_code/memo/dimension）、Audit Log。
5. **Reconciliation**（F5 §6.5）：按 entity+wallet+asset+period 對帳；source_balance vs subledger_balance；variance_qty/value；exception reason；export CSV/PDF。
6. **ERP / GL Integration**（F5 §6.6）：MVP 先 generic CSV（對應 NetSuite/Xero/QuickBooks journal import 欄位）；分期 export；標記 exported；未來擴 API connector。
7. **Audit Trail & Walrus Snapshot**（F5 §6.7）：Period Close 時把 positions/JE/reconciliation 打包成 JSON/parquet 寫入 Walrus，取得 CID，回寫 AuditSnapshot 表，UI 可查看/下載。
8. **AI Assistant（限制版）**（F5 §6.8）：建議 event_type/economic_purpose；異常提示（內部轉帳/DeFi/spam）；協助生成 memo；限制：僅 suggestion，不可未經核准直接進規則引擎。
9. **Security & Permissions**（F5 §6.9）：RBAC（Admin/Accountant/Viewer）；完整 Audit Log；CEX API Key 等憑證加密儲存。

### 2.2 F3（PRD 模組切分）7 模組優先度表
（P0）Data ingestion／Event normalization／Policy engine／Review & close workflow；（P1）Reconciliation & controls／ERP-GL connectors；（P2）Reporting & audit pack（三表 supporting schedules、審計底稿）— F3 §模組切分表。三大報表相關功能被列為 **P2、後期補齊**，非 MVP。

### 2.3 F4（會計規格書 v0.1）具體會計功能
- **準則支援**：IFRS（IAS 38無形資產/IAS 2存貨/IFRS 9金融工具/IFRS 13公允價值）與 US GAAP（ASU 2023-08 公允價值計量）雙模板（F4 §1）。
- **資產分類模型**：technical_type（NATIVE_TOKEN/STABLECOIN_FIAT_BACKED/STABLECOIN_ALGO_OR_OTHER/GOVERNANCE_TOKEN/DEFI_LP_OR_DERIVATIVE/NFT）+ accounting_class（IAS38無形資產/IAS2存貨/IFRS9金融資產/ASU2023-08公允價值）（F4 §2）。
- **穩定幣特例政策**：STABLECOIN_TREATMENT 選項（FINANCIAL_ASSET_IFRS9/INTANGIBLE_ASSET/CASH_EQUIVALENT），系統不自動判斷，由企業與會計師決定（F4 §2.2）。
- **MVP 8 大事件類型與會計處理**（F4 §3，含 JE 範例）：
  1. Digital Asset Receipt（收款）
  2. Digital Asset Payment（付款）
  3. Internal Transfer（內部轉帳，不產生損益）
  4. CEX Deposit/Withdrawal（交易所存提）
  5. Spot Trade / Swap（現貨交易，含 disposal gain/loss 計算）
  6. Staking Deposit / Reward / Withdrawal
  7. Gas / Fees（可費用化或資本化）
  8. Period-End Remeasurement / Impairment（期末重估/減損，IFRS cost/revaluation 模式 vs US GAAP ASU 2023-08 FV模式）
- **成本基礎與 Lot Tracking**：v0.1 支援 FIFO、WAC（加權平均）；未來 LIFO/HIFO/Specific ID（F4 §4）。PositionLot 欄位：asset_id/acquisition_date/acquisition_tx_ref/acquired_qty/remaining_qty/unit_cost/accounting_class/cost_method。
- **PolicySet 設計**（F4 §5）：accounting_standard、functional_currency、reporting_currency、cost_basis_method、stablecoin_treatment、crypto_classification_default、staking_income_policy、fee_expense_policy、revaluation_policy、asu_2023_08_applies；且需 Policy Versioning（每次更新產生 version，JE 記錄使用的 policy_version，可用不同版本重跑期間做 scenario/restatement）。
- **規則引擎介面**（F4 §6）：Input=NormalizedEvent+PolicySet+PositionLots+PricePoint；Output=JournalEntry(header+lines)；規則類型分 MappingRule（事件→科目）與 MeasurementRule（金額來源：cost/FV/減損測試）；規則存資料庫可配置，不寫死 code。
- **披露與報表支援（v0.1 要求，非完整報表）**（F4 §8）：按 asset 列期末餘額（cost basis/FV/數量）；ASU 2023-08 roll-forward（加總層級：additions/disposals/gains/losses）；IFRS 模式輸出 IAS38/IAS2 分類餘額與測量方法，revaluation model 需 revaluation surplus/deficit 資訊。**規格書明確指出：系統本身不直接產出完整財報，只提供資料給報表模組**（F4 §8 末句）。

### 2.4 F6（資料模型與規則引擎）10 核心實體 + 6 步資料流
- **10 個核心實體**（F6 表格）：Entity、AccountSource、RawTransaction、NormalizedEvent、PositionLot、PricePoint、PolicySet、MappingRule、JournalEntry、ReconciliationRecord。
- **6 步固定資料流**（F6）：收 RawTransaction → 轉 NormalizedEvent → 補 PricePoint/FX → 套 lot/cost basis → 規則引擎產出 JournalEntry → 對帳後 export 到 GL/ERP。RawTransaction 永不覆蓋，NormalizedEvent/JournalEntry 皆版本化。
- **事件 taxonomy（比 F5 更完整版）**：ASSET_RECEIPT、ASSET_DISPOSAL、INTERNAL_TRANSFER、TRADE_BUY、TRADE_SELL、SWAP、FEE_GAS、STAKING_DEPOSIT、STAKING_REWARD、STAKING_WITHDRAWAL、CUSTODY_MOVE、UNCLASSIFIED_CONTRACT_INTERACTION。
- **規則引擎 3 層架構**（F6）：第一層分類規則（accounting treatment candidate）→ 第二層政策規則（IFRS/GAAP/公司政策決定科目路徑）→ 第三層分錄生成規則（實際 debit/credit lines）。規則以 JSON 結構儲存版本化（範例見 F6 rule_id: swap_disposal_ifrs_v1）。
- **JournalEntry 模型**：Header（je_id/entity_id/period/source_event_id/policy_set_version/rule_version/status/memo/created_at）+ Lines（je_line_id/account_code/dimension values/debit/credit/currency/fx_rate/reference_asset/reference_quantity）。
- **首版建議只做 8 類規則範圍**（與 F4 一致）：穩定幣收款/付款、內部錢包移轉、CEX 充提、現貨買賣/swap、Gas/network fee、Staking deposit/reward/withdrawal、期末重估。
- **設計原則（F6 末段 5 條）**：Raw data immutable 可重跑／Event schema 先穩再擴充 protocol parser／規則版本化可追溯 rule version／AI 只建議不做 final posting／ERP 是 GL of record，本系統不取代 ERP。

### 2.5 三大報表與 ERP 對接（原始市場調研，F1）
F1 是純市場調查（非本產品規格），列出現況：
- **資產負債表**：鏈上資產列為「數位資產」科目，crypto subledger 計算成本與未實現損益後匯總推進 ERP 資產科目。
- **損益表**：realized/unrealized 損益、gas fee、staking rewards 等自動分類到收入/費用科目，支援 FIFO/LIFO/WAC。
- **現金流量表**：穩定幣收支標記為營業/投資/籌資活動，多由 ERP 依分錄自動生成，crypto subledger 只需正確標註科目與活動性質。
- **市場代表產品**：TRES Finance、Cryptio、Bitwave、Integral（已支援 Sui）、ZenLedger（已支援 Sui）、Taxbit。
- 本產品規格書（F5/F3）明確把「完整三大表報表引擎」列為 **MVP 之外（Phase 2 / 不在範圍）**（F5 §5.2：「不在範圍：全面報表引擎（完整三大表、儀表板）、原生 NetSuite/SAP API Connector、全自動 tax/global regulatory reporting、多實體 transfer pricing/consolidation」）。

---

## 3. 資料模型與會計規則引擎核心設計（詳見 F6，F4 補充會計邏輯）

**架構理念**：事件驅動的數位資產子分類帳（event-driven digital asset subledger）。三層結構：**政策模板（PolicySet）+ 規則評估（Rules Engine）+ 人工覆核（Review workflow）**，規則不可硬編碼於準則，必須可配置（F6 開頭）。

- **實體（10個）**：見上節 2.4。
- **規則（3層）**：分類規則 → 政策規則 → 分錄生成規則，皆版本化、JSON 化、可儲存於 DB（非寫死 if/else）。
- **流程（6步）**：Raw → Normalized → Priced → Lot-costed → Journal → Reconciled/Exported。
- **AI 接口邊界**（F6）：AI 只碰 4 件事——建議 event_type、建議 economic_purpose、建議 counterparty_type、對低信心/異常事件打標；人工 approve 後規則引擎才出 JE。
- **實際範例**（F6 末）：收到 10,000 USDC 客戶付款 → RawTransaction → NormalizedEvent(ASSET_RECEIPT) → PolicySet 判定科目 → MappingRule 產生 Dr Digital Assets-USDC / Cr Deferred Revenue-AR-Customer Clearing → ReconciliationRecord 更新 wallet balance → JE 批次匯出 NetSuite/Xero。

---

## 4. ICP 與 GTM 分層（F2、F9）

### ICP 三層（F2 表格 + F9）
| 層級 | 類型 | 特徵 | 產品價值 |
|---|---|---|---|
| L1 核心 | CEX/機構型 crypto org/Sui 項目方 | 高頻鏈上+已有公司實體+審計壓力 | audit-ready subledger、GAAP/IFRS ready JE feed 回 NetSuite/Xero/QuickBooks |
| L2 過渡 | Web3 原生公司（基金/做市商/支付商） | 數位資產是主要業務收入/成本，需 NAV/P&L/fund reporting | Sui-native accounting engine 補現有工具 coverage gap |
| L3 終局 | 使用穩定幣的 Web2 企業（跨境/供應鏈/treasury） | 穩定幣只是 cash management 一小部分 | stablecoin transaction → enterprise ledger pipeline，IFRS/GAAP policy 選擇與 disclosure |

（注：F5 §2.2 商業規格書把 ICP 簡化為只有 L1/L2 兩層，L2 定義為「使用穩定幣收付款、treasury 管理的 Web2 企業」，與 F2/F9 原始三層定義不完全一致——**F5 的 L2 其實對應 F2/F9 的 L3**，命名有落差，屬規格書間潛在不一致，值得在比對時注意。）

### GTM 分階段（F2）
- **Phase 0**：定位句「AI-assisted digital asset subledger for finance teams on IFRS & US GAAP — turning on-chain chaos into ERP-ready ledgers.」按 L1/L2/L3 分別調整訊息（L1: audit trail+ERP；L2: DeFi coverage+NAV+multi-entity；L3: stablecoin treasury+TMS+policy+control）。
- **Phase 1**（Sui 生態+crypto-native，L1+L2）：Sui 官方 builder 活動/黑客松/grants BD；與 Fireblocks/Ledger Enterprise 等 custody 合作；寫給 CFO 的 Sui accounting 深度內容；pricing 走「每月交易筆數+entity 數」tier，早期 pilot 用「month-end close in 3 days」賣點，顧問+軟體混合收費。
- **Phase 2**（Web2 企業穩定幣 treasury，L3）：找已用 stablecoin 做跨境/供應商付款的企業（非教育型客戶）；與 stablecoin rail/treasury 供應商合作組成解決方案（對方管錢包治理，本產品管會計/ERP/reporting）；Messaging：「Make stablecoin flows as clean as bank statements in your ERP.」

### 切入順序與商業化建議（F9）
- 第一階段客群非 Web2 企業本體，而是已有財務團隊+高頻鏈上活動組織（CEX/做市商/OTC desk/基金/支付商/Sui 項目方）。
- 第二階段擴至用穩定幣做跨境收付/供應商結算/treasury parking 的一般 Web2 企業。
- **商業模式**：按「月交易量 + 實體數 + 準則/ERP 模組」計價，非按錢包數計費；第一批客戶可半產品半服務（先手動建 chart-of-accounts mapping、政策模板、Sui 事件分類庫，再產品化）。
- Messaging 從「for crypto teams」逐步轉為「for finance teams handling digital assets」。

---

## 5. 競爭對手分析（F1、F2、F9 引用）

規格書未做正式的逐項功能比較表，而是分散在市場調研（F1）與 ICP 討論（F9）中列出以下同類服務：

| 廠商 | 定位/特色 | 出處 |
|---|---|---|
| **TRES Finance** | 定位「crypto subledger」/「第一個 Web3 financial data lake」；自動從錢包/交易所/託管收集資料、分類（swap/staking/NFT/DeFi）、算成本損益、同步 Xero/QuickBooks/NetSuite/SAP/Oracle | F1 |
| **Cryptio** | 150+ 鏈/交易所/託管整合；NetSuite 憑證輸出與 API 整合；多實體多幣別 | F1 |
| **Bitwave** | audit-ready crypto accounting；QuickBooks/NetSuite/Sage/SAP 整合；高交易量+複雜 DeFi/穩定幣 | F1 |
| **Integral** | 支援多鏈+**已支援 Sui**；針對 Sui 物件模型/平行交易做交易分類與成本計算優化 | F1、F9 |
| **ZenLedger** | 支援 300+ 交易所/40+ 鏈；**已正式支援 Sui**；稅務+會計+NAV計算+審計報告 | F1、F9 |
| **Taxbit** | enterprise-grade crypto accounting，稅務起家轉企業會計 | F1 |
| **Cryptoworth** | NetSuite crypto 整合專家 | F1 |
| **Crypto Accounting（法國）** | 歐洲會計師/企業導向 | F1 |
| Fireblocks、Stripe | 非直接競品，屬 custody/payment infra，已支援 Sui，可能是合作對象而非對手 | F1、F2 |

**差異化機會（規格書觀點，非客觀評估）**：Sui 特有物件模型/平行交易/頻繁小額交易對現有工具是挑戰，仍有空間做更原生深度整合的 Sui 會計方案（F1、F9）。三個主打差異化：Sui-native accounting intelligence／policy-switchable engine（IFRS/GAAP 切換）／AI-assisted close workflow（F9）。

**規格書未提及**：市場份額數據、定價比較、任何競品的失敗案例或負評、直接的 feature-by-feature 對照表。

---

## 6. Sui Stack 運用規劃（F3、F7、F8）

### F3：核心 5 項官方工具與模組對應
| Sui 官方工具 | 角色 | 對應模組 |
|---|---|---|
| **TypeScript SDK**（`@mysten/sui`） | 核心資料接入與交易解析；查 RPC、建 transaction、BCS utilities | Ingestion service（backend 主力） |
| **GraphQL RPC + General-purpose Indexer**（beta） | 結構化、可篩選歷史資料查詢；按期間/地址/entity/asset 篩選、回溯、重跑 close | Indexing & query layer（reporting/review UI 後端） |
| **gRPC / JSON-RPC clients** | 即時 vs 讀取層分流；JSON-RPC 快速上手（MVP）、gRPC 未來 latency-sensitive streaming、GraphQL 報表 | 依工作負載分工 |
| **dApp Kit**（React bindings + create-dapp CLI） | 內部 operations console、wallet-connected workflow、client onboarding 驗證地址 ownership | Finance ops UI |
| **官方 tooling / local network**（localnet/faucet/CLI） | 本地開發測試、建立標準測試交易樣本、驗證 parser 版本一致性 | 測試環境（「會計事件模擬環境」） |
| **zkLogin**（非 MVP） | 降低 Web2 財務人員 wallet onboarding 摩擦，用熟悉 OAuth flow | Phase 2/3 UX enhancer |

**建議開發順序**（F3）：TypeScript SDK 跑通單一錢包抓取解析 → 最小版 event schema → IFRS/GAAP policy templates → 簡易 review UI → 引入 GraphQL/Indexer 優化查詢 → 最後接 dApp Kit/wallet verification/ERP connector。

### F8：補充 Sui Stack 元件（與會計/ERP/treasury 相關）
| 元件 | 角色 |
|---|---|
| **Walrus** | 儲存月結 reconciliation reports、trial balance、subledger export、audit workpaper snapshot、客戶交易附檔；可搭配 Custom Indexer 做帳務快照查詢驗證 |
| **DeepBook** | on-chain 交易來源（做市商/交易策略/treasury 客戶的 P&L 與 cost basis 來源）；專門 parser 解析成交/撤單/掛單 fee；未來延伸：從 subledger 直接發起對沖指令到 DeepBook（policy 超標觸發） |
| **Nautilus** | Oracle/off-chain data bridge；用於 valuation/fair value 的 price feed 安全上鏈；也可用於把會計政策版本/核准紀錄安全寫進 Sui 作 policy log |
| **Seal + Messaging SDK** | 財務人員 close 流程中敏感溝通加密；傳遞審計確認、政策更新、exception 說明 |
| **SuiNS** | 人類可讀地址顯示，對應 entity/counterparty master record，降低財務人員閱讀成本 |
| **Clock（Access Onchain Time）** | period cutoff 期末結帳時間判斷；多時區實體時間一致性；若部分邏輯寫在 Move 上可用 Clock 取得可審計時間戳 |
| Onchain Randomness / Enoki / SuiPlay0X1 | 規格書明說與此產品關聯性低，暫不使用 |

### F7：Hackathon Track 選擇建議（非最終產品架構，屬 pitch 策略）
- **首選 Track：Agentic Web**；次選 DeFi & Payments；DeepBook/Walrus 建議當「技術加分點」而非主賽道。
- 三層架構（pitch 用）：Layer 1 Sui 信任與執行層（Sui L1+DeepBook+SDK/GraphQL/Indexer+Walrus+zkLogin/SuiNS/Seal）→ Layer 2 AI & Accounting Engine（Normalization+Policy Rules+AI Copilot）→ Layer 3 Enterprise Finance Layer（ERP+財務/審計人員）。
- 工程版模組（A-F）：Ingestion & Indexing Layer／Normalization & Pricing Layer／Accounting Rules Engine／AI Assistant & Review Workflow／Reconciliation & Walrus Snapshots／ERP Connectors。
- **Hackathon Demo 必須有**：單一 entity+單一/少數錢包 Sui 交易→events→AI suggestion→journal entries 全流程；最少 2–3 類事件（收款/付款/swap-DeepBook trade）；簡單 web UI（交易流+AI建議分錄+一鍵Approve&Export+Walrus snapshot）。

---

## 7. 會計流程觀點：使用者 end-to-end 會計作業流程（綜合 F4/F5/F6）

規格書描述的完整流程（交易發生 → 入帳 → 報表）：

1. **資料接入（Ingestion）**：系統定期（如每10分鐘）從 Sui 錢包/CEX/託管拉取原始交易（RawTransaction），來源可多個（同一 entity 可多 source）。（F3、F5 §6.1、F6）
2. **標準化與分類（Normalization & Classification）**：RawTransaction 轉為 NormalizedEvent，AI 建議 event_type（如 ASSET_RECEIPT/SWAP/STAKING_REWARD 等）、economic_purpose、counterparty_type，並給出 confidence_score；低信心事件自動進入「需 review」佇列，不自動入帳。（F5 §6.2、F6）
3. **人工審核（Review & Approval）**：財務/會計人員在 UI 檢視每筆事件（含原始鏈上 tx、Sui Explorer link），可 Accept/Edit/Reject；所有操作留 Audit Log。只有 review_status=APPROVED 的事件才進入下一步。（F5 §6.4、F4 §6.1、F6）
4. **政策套用與計價（Policy & Pricing）**：套用 entity 的 PolicySet（IFRS/GAAP、成本基礎方法FIFO/WAC、穩定幣分類、staking收益政策等）；補上 PricePoint（fair value/FX）；套用 PositionLot 做成本批次計算（disposal 時決定 carrying amount 與 gain/loss）。（F4 §4-5、F6）
5. **分錄生成（Journal Entry Generation）**：規則引擎（MappingRule 事件→科目、MeasurementRule 決定金額來源）依政策自動產生 draft JE（header+lines），若找不到對應規則則標記「需政策配置」，不自動出帳。JE 記錄 policy_version/rule_version 供追溯。（F4 §6、F5 §6.3、F6）
6. **對帳（Reconciliation）**：比較 on-chain/CEX balance（source_balance）vs subledger 累計 JE 餘額（book_balance/subledger_balance），產生差異報告，可填 exception reason 並指派處理。（F5 §6.5、F6 ReconciliationRecord）
7. **月結關帳（Period Close）**：一鍵生成當期 subledger journal export（ERP格式）、reconciliation 報表、Walrus audit snapshot（把 positions/JE/reconciliation 打包成 JSON/parquet 寫入 Walrus，取得不可竄改 CID）。（F5 §6.7、§4.4）
8. **匯出至 ERP（Export）**：已核准的 JE 匯出為 CSV（對應 NetSuite/Xero/QuickBooks journal import 格式），標記為 exported；MVP 不做直接 API connector（留待後續版本）。（F5 §6.6、F3）
9. **審計查核（Audit）**：審計人員可依期間/實體查看 positions/balances、reconciliation 差異、對應 Sui tx hashes、Walrus snapshot，確保資料未被事後竄改。（F5 §4.5）
10. **報表產出**：規格書明確界定——本系統**不直接產出完整三大報表**，只提供 subledger 層的期末餘額、cost basis/FV、roll-forward 等資料給「報表模組」；完整報表引擎、ERP API connector、多實體 consolidation 皆列為 MVP 之外的 Phase 1/2 範圍。（F4 §8、F5 §5.2、F3 P2優先度）

**規格書未提及**：具體的三大報表（資產負債表/損益表/現金流量表）產出邏輯本身（只有 F1 市場調研有討論，非本產品規格）；完整的 close checklist 細節；跨司法管轄區的稅務申報流程；具體的 UI wireframe/畫面設計。
