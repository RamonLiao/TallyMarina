# Research: crypto subledger 的 ERP export 支援順序

- 日期：2026-07-11
- 方法：deep-research fan-out（5 個平行搜尋 agent：全球市佔 / crypto-native 實際用什麼 / 競品整合 / Big-4 審計 / journal import 格式），每個關鍵結論要求 WebFetch 讀過原文；無法 fetch 的標「未驗證」或「半驗證」。
- 兩個軸請分開讀：**「crypto-native ICP 用什麼」≠「全球市佔」**。全球市佔決定終局（Web2 穩定幣企業）路線圖；ICP 實證決定 MVP 順序。

---

## TL;DR（結論先行）

1. **MVP CSV export 優先對應：(1) Xero manual journal 格式、(2) QuickBooks Online journal 格式**。兩者都是官方原生 CSV import、欄位固定簡單、覆蓋 seed→Series A 的 crypto startup（含多數 Sui 項目方規模的團隊）。
2. **第二批：NetSuite（CSV via Import Assistant，之後升級成 API 連接器）**。NetSuite 是 scaled crypto-native 組織（Coinbase、Kraken、GSR、Paxos、Uniswap、ConsenSys）的 de facto GL，也是 Cryptio/Bitwave 的 flagship 整合——但它 tenant 依賴度高（Subsidiary、account numbering、tax code），不適合當 MVP 第一刀。
3. **不做（現階段）**：SAP / Dynamics / Workday / Sage Intacct——沒有任何競品以它們為主打，也查無 crypto-native 公司實際使用的證據；競品頁面上多為 checkbox listing。
4. Big-4 **沒有公開的 subledger→GL 格式要求**（明確查證過，見 §4）；審計端要的是功能性：交易級明細可對鏈上 reconcile、lot-level cost basis、JE 自動流入主流 ERP。
5. 競品全部走同一條路：**Xero/QBO 起家 → NetSuite 當企業級旗艦**（Cryptio 第一個整合是 Xero，2021-10；其 multi-entity NetSuite connector 是 2026-01 的最新主打）。Generic CSV export 反而是所有競品都 under-market 的空隙。

---

## 1. 全球 ERP/會計軟體市佔（按企業規模）

市場總量：2024 全球 ERP applications 市場 US$135.9B（+9.4% YoY）；前 10 大廠商合計僅 26.5%，高度碎片化。Oracle 以 6.5% 首度超越 SAP 成為 ERP 營收第一（Oracle $8.7B vs SAP $8.6B，僅 ERP segment 營收）。
來源：https://www.appsruntheworld.com/top-10-erp-software-vendors-and-market-forecast/ [2024]（已 WebFetch 驗證）

| 規模層 | 主導系統 | 挑戰者 / 地理分佈 | 證據狀態 |
|---|---|---|---|
| Micro/SMB（<50 人） | QuickBooks Online（Financial Reporting 品類偵測份額 ~39%；用戶 82% 在美國） | Xero 在 UK+ANZ 主導（FY25 4.41M subscribers，ANZ 2.6M）；Sage 50 在 UK | 6sense [2026] 已驗證；Xero FY25 已驗證 |
| 小型（50–200 人） | QuickBooks（US）、Xero（ANZ/UK）、Sage | SAP Business One、Dynamics BC 入門 | 方向性 |
| Mid-market（200–1,000 人） | Dynamics 365 BC（2026-04 達 55k online 客戶，客戶數已超車）≈ NetSuite（41–43k 客戶，**在美國 SaaS/VC-backed 公司族群明顯更強**） | Sage Intacct（~14–20k，未驗證）、Acumatica | BC 數字已驗證（yzhums.com）；NetSuite 41k 已驗證 |
| 大型企業（1,000+ 人） | SAP S/4HANA（de facto，~26k 客戶未驗證；SAP 全客戶 141k） | Oracle Fusion（ERP 營收第一）、Workday FM（2,000+，未驗證） | 部分未驗證 |

來源：
- https://www.appsruntheworld.com/top-10-erp-software-vendors-and-market-forecast/ [2024]（已驗證）
- https://www.cargoson.com/en/blog/how-big-is-the-erp-market [2024–2025]（已驗證；⚠️ 該頁內部數字不一致——headline 市場規模 $66–73B 與其份額 % 隱含的 ~$131B 矛盾。**採信 Apps Run The World 的 $135.9B 為分母**，因其份額百分比與該基數吻合且為原始研究方）
- https://6sense.com/tech/financial-reporting/quickbooks-online-market-share 、https://6sense.com/tech/financial-reporting/xero-market-share [2026]（已驗證；⚠️ 6sense 是 web-tech 偵測法，非營收份額，只當方向性參考）
- https://www.raskmedia.com.au/2025/05/15/xero-asxxro-share-price-in-focus-after-30-profit-growth-in-fy25-result/ [FY25]（已驗證）
- https://yzhums.com/63206/（BC 客戶數 40k→55k 時間序，已驗證）
- 「SAP ~22% / Oracle ~12%」類數字來自更窄的 "core ERP" 口徑，僅見於搜尋摘要——未驗證，不採用。

**矛盾處理**：ERP 市佔沒有單一權威口徑（品類定義差異巨大）。本報告以 Apps Run The World（廠商營收法）為主軸、6sense（安裝偵測法）為 SMB 方向性佐證，兩者不混算。

---

## 2. Crypto-native 公司實際用什麼（ICP 實證）

**結論：NetSuite 統治 scaled crypto-native；QBO/Xero 統治 seed→A 輪；crypto 基金是例外（用 fund admin，不用 ERP）。**

| 區隔 | 系統 | 證據 | 驗證狀態 |
|---|---|---|---|
| CEX（Coinbase） | NetSuite | "Senior NetSuite/ERP Software Engineer at Coinbase" 職缺；Accounting Manager 職缺提 "ERP enhancements in NetSuite"。https://startup.jobs/senior-netsuite-erp-software-engineer-coinbase-3759109 、https://www.coinbase.com/careers/positions/7822885 | 半驗證（頁面 403，職缺標題來自搜尋索引） |
| CEX（Kraken） | NetSuite + BlackLine + Kyriba + Fireblocks + Lukka | 職缺 "AI Agents Solutions Architect – Finance" 點名整套 finance stack。https://www.crypto-careers.com/jobs/555175900-ai-agents-solutions-architect-finance-at-kraken | 未驗證（403，snippet 層級） |
| 做市商（GSR） | NetSuite（經 Cryptio） | Cryptio blog："Uniswap, Exodus, GSR, Paxos, Ramp, and Consensys use Cryptio's NetSuite integration"。https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users | **已驗證**（最強的做市商資料點） |
| Web3 infra/protocol（Uniswap、Paxos、ConsenSys、Exodus、Ramp） | NetSuite（經 Cryptio） | https://cryptio.co/solutions/netsuite | **已驗證** |
| Cryptio 客戶（ERP 未逐一點名） | Gemini、Circle、Securitize、Worldcoin、LayerZero、Laser Digital | https://cryptio.co | **已驗證**（客戶名單） |
| Seed→A 輪 Web3 startup | QuickBooks Online（美國）；Xero（非美） | Web3 專業會計師事務所 Shay CPA 全級距服務都以 QBO reconcile 為核心。https://shaycpa.com/accounting-for-web3-companies/ | **已驗證**（QBO 部分）；Xero 為競品行銷佐證，方向性 |
| 做市商 Wintermute / Amber；Binance；Mysten Labs / Sui Foundation | — | 查無公開證據 | **未驗證 / 查不到** |
| Crypto 基金 | **不用 ERP**：~86–88% 外包給獨立 fund administrator（Formidium、NAV、Lukka 等做 NAV/資料層）；GP 管理公司自身多半只跑一套小 QBO/Xero 帳（此句為推測） | PwC/Elwood/AIMA Crypto Hedge Fund Report。https://www.pwc.com/gx/en/financial-services/pdf/3rd-annual-pwc-elwood-aima-crypto-hedge-fund-report-(may-2021).pdf [2019–2021 數據] | 半驗證（PDF 403，數字來自多年度報告的一致 snippet） |

**顯著缺席**：SAP、Workday、Sage Intacct——找不到任何一家 crypto-native 公司實際在跑的證據。

**GTM 含義**：crypto 產業的標準架構就是「crypto subledger → 彙總 JE → NetSuite（scaled）或 QBO/Xero（startup）」。你的產品照這條線走即可；**crypto 基金 segment 的 export 對象是 fund admin 的資料格式，不是 ERP journal**——若基金是 ICP 重點，這是另一條產品線，本報告不展開。

---

## 3. 競品 ERP 整合矩陣與先後順序

| 廠商 | QBO | Xero | NetSuite | Sage/Intacct | SAP | Dynamics | Workday | 通用 CSV/export | 最先做 | 現任旗艦 |
|---|---|---|---|---|---|---|---|---|---|---|
| Cryptio | Native | Native | Native | listed | listed | 365 listed | listed | 隱含（non-native tier） | **Xero（2021-10-14，已驗證）** | NetSuite |
| Bitwave | Yes | Yes | Yes | Intacct | listed | — | listed | reports/download | QB App Store 2022-10；完整順序未驗證 | **NetSuite（自稱唯一 SDN partner）** |
| TRES | Yes | Yes | Yes | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 自稱 universal connector | 未驗證 | NetSuite（enterprise）/ QBO（行銷門面） |
| Integral | Native | Native | listed | Sage listed | — | — | — | 未驗證（僅交易所 CSV） | 未驗證（推測 QBO/Xero） | QBO+Xero |
| Cryptoworth | Yes | Yes | Yes | — | — | — | — | 2-way journal sync | 未驗證（Xero App Store ≈2024 屬晚期） | QBO |

關鍵來源（皆已 WebFetch 驗證，2026-07-11 抓取）：
- Cryptio：https://cryptio.co/integrations 、首個整合公告 https://blog.cryptio.co/milestone-cryptio-launches-integration-with-xero（2021-10-14，"our first integration"）、NetSuite 主打 https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users（2026-01-15）
- Bitwave：https://www.bitwave.io/integrations 、https://www.bitwave.io/faqs 、QBO 公告 https://www.prnewswire.com/news-releases/...301652401.html（2022-10-18）、https://bitwave.io/partner/netsuite
- TRES：https://tres.finance（integrations 頁 404，清單為拼湊，未驗證完整性）；Xero App Store：https://apps.xero.com/app/tres-finance-web3-accounting
- Integral：https://integral.xyz/integrations（QBO/Xero 標 native；NetSuite/Sage 僅列名）
- Cryptoworth：https://cryptoworth.com/integrations

**共同模式（對你最重要的一段）**：每一家都是 SMB（Xero/QBO）起家、把 NetSuite 當企業級畢業旗艦；NetSuite connector 是最新、行銷最重的資產（Cryptio 的 multi-entity NetSuite connector 是 2026 年 1 月才發布的主打）。沒有人以 SAP/Dynamics/Workday 領軍——那些是 checkbox。**通用 CSV journal export 在五家都 under-marketed**，這是差異化空隙：對 hackathon/MVP 而言，一個乾淨的多格式 CSV export 就能覆蓋競品用 API connector 才能覆蓋的場景。

---

## 4. Big-4 對 subledger→GL 格式的公開要求

**明確結論：查不到任何公開的格式要求。** 沒有任何 Deloitte/PwC/EY/KPMG 公開文件指定 CSV journal schema、SAF-T、或必要欄位清單。工具的輸入規格全部藏在 demo/engagement 後面。

有找到的（功能性期待，非格式）：
- **Deloitte–Bitwave 聯盟（2023-09）**：Deloitte 公開背書「dedicated crypto subledger → 主流 ERP（點名 NetSuite、Sage Intacct）」為認可架構。https://www.prnewswire.com/news-releases/deloitte-bitwave-strategic-alliance-revolutionizes-digital-asset-accounting-and-compliance-301925148.html（已驗證）
- **EY Blockchain Analyzer: Reconciler**：期待客戶能提供「transaction-level data + wallet balances」供與公鏈 reconcile。https://www.ey.com/en_us/services/blockchain/platforms/reconciler（已驗證，頁面無輸入格式）
- **KPMG Chain Fusion**：「consistent format」指其內部資料模型，非對客戶的要求。https://kpmg.com/us/en/capabilities-services/audit-services/chain-fusion.html（已驗證）
- **PwC Halo / Crypto Assets guide**：關注鏈上審計證據與 GAAP 處理，無 handoff 格式。https://www.pwc.com/gx/en/services/audit-assurance/halo-solution-for-cryptocurrency.html（搜尋摘要層級）
- **AICPA Practice Aid**（Accounting for and Auditing of Digital Assets）：涵蓋 existence/completeness 與 lot-level cost basis；PDF 文字抽取失敗，其中確切 subledger 用語**未驗證**（lot-tracking 說法來自 TaxBit 轉述 https://www.taxbit.com/blogs/4-key-challenges-of-digital-assets-accounting）。

**寫進規格書的說法**：審計端的公開共識是功能性的——(a) 有專用 digital-asset subledger、(b) 交易級紀錄+錢包餘額可對鏈 reconcile、(c) lot-level cost basis、(d) JE 自動流入被認可的 ERP。不要在規格書引用任何「Big-4 要求的格式」——不存在。

---

## 5. 建議：export 支援順序

### 第一批（MVP，CSV 檔案 export）
1. **Xero manual journal CSV** — 官方原生 import、固定 9 欄模板（Narration/Date/AccountCode/TaxRate/Amount，單一正負號 Amount 欄）、匯入為 draft（安全）、無 mapping 步驟。實作成本最低。Docs：https://central.xero.com/s/article/Add-import-and-post-manual-journals-US（已驗證）
2. **QuickBooks Online journal CSV** — 原生 import（2024 起，Settings → Import data → Journal Entries；舊 plan/地區覆蓋未逐一驗證）；欄位：Journal No./Journal Date/Account Name/Description/Debits/Credits（AP/AR 帳戶需 Name 欄）；mapping UI 容忍 header 漂移。Docs：https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US（已驗證）

理由：(a) 覆蓋 ICP 第一階段的長尾（Sui 項目方、seed→A Web3 startup 幾乎都在 QBO/Xero 上，§2 已驗證）；(b) 兩格式皆固定模板，MVP 一週內可交付；(c) 競品第一刀也全是這兩家（Cryptio 首整合=Xero），驗證過的路。QBO 覆蓋美國、Xero 覆蓋 UK/ANZ/亞太——若 ICP 地理偏亞太/歐洲，Xero 排第一；偏美國則 QBO 第一。

### 第二批
3. **NetSuite journal CSV（Import Assistant 格式）→ 之後升級 API connector** — scaled ICP（CEX、做市商、B 輪後 protocol 公司）的 GL 就是它，也是所有競品的企業旗艦。CSV 每行一個 journal line、以 External ID 分組、header 欄重複；但 Subsidiary（OneWorld）、account numbering 偏好、tax code 都 tenant 依賴，**一份 CSV 無法通吃所有客戶**，需要 per-customer 欄位設定——所以放第二批。Docs：https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1534492737.html（已驗證）
4. （選配）**Sage Intacct** — 僅在 Deloitte-Bitwave 通路或特定客戶要求時做；官方 import docs 研究期間維護中，模板欄位未驗證（API 物件模型已驗證：https://developer.intacct.com/api/general-ledger/journal-entries/ ）。

### 不做
- **Dynamics 365 BC**：無原生 CSV journal import（要走 Edit-in-Excel / Configuration Package），且 crypto-native 無人使用——即使它在全球 mid-market 客戶數已第一。這正是「全球市佔 ≠ ICP 用什麼」的最好例證。
- **SAP / Oracle Fusion / Workday**：終局（Web2 穩定幣企業）才相關；屆時大概率走 iPaaS/中介層而非直接 CSV，現在做是浪費。

### Exporter 通用設計要求（四家共通，寫進 spec）
- 每張 journal 必須 debits=credits（四家都在 import 時驗證餘額）。
- 需要 journal 分組鍵：Xero 用「首行填 Narration+Date、續行留空」；QBO 用 Journal No.；NetSuite 用 External ID；Intacct 用 batch。exporter 抽象成一個 journal-group 概念、per-format 序列化。
- 日期格式 per-locale（Xero US 版 `mm/dd/yyyy`；NetSuite 跟 tenant 設定）。
- Account 對照表（on-chain 類別 → 客戶 COA 的 account code/name）是所有格式共同的前置需求，價值大於任何單一格式支援。

---

## 附：證據品質總覽
- **已 WebFetch 驗證**：Cryptio/Bitwave/Integral/Cryptoworth 整合頁、Cryptio Xero 首發公告（2021-10）、Deloitte-Bitwave PR、EY Reconciler、KPMG Chain Fusion、Xero/QBO/NetSuite import docs、Apps Run The World、6sense、BC 客戶數。
- **半驗證（snippet 一致但原頁 403）**：Coinbase/Kraken NetSuite 職缺、PwC crypto hedge fund 86–88% 外包數據。
- **未驗證/查不到**：Binance、Wintermute、Mysten Labs/Sui Foundation 的 GL 系統；TRES 完整整合清單；Sage Intacct CSV 模板欄位；AICPA practice aid 原文 subledger 用語；SAP S/4HANA 精確客戶數。
