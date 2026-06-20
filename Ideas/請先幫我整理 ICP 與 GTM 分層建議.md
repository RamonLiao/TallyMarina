<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 請先幫我整理 ICP 與 GTM 分層建議

先給結論：你的 ICP 可以分三層，由「最 crypto-native、最痛」一路走到「一般 Web2 企業」，GTM 也建議走「先 Sui / CEX / 金融機構 pilot → 再擴展到穩定幣 treasury 的 Web2 企業」的路徑，每一層用不同訊息和 sales motion。下面我用「分層 ICP → 每層痛點與訊息 → GTM 範例流程」來整理。

***

## ICP 分層概觀

先畫一張大圖，之後每層再展開。


| 層級 | 類型 | 關鍵特徵 | 為何適合當前期 ICP |
| :-- | :-- | :-- | :-- |
| L1 核心 | CEX / 機構型 crypto org / Sui 項目方 | 高頻鏈上 + 已有公司實體 + 有審計壓力 | 痛點最明顯，對「subledger + ERP 整合」概念最熟，願意當 pilot。[^1][^2][^3] |
| L2 過渡 | Web3 原生公司（基金、做市商、支付商） | 數位資產是主要業務收入／成本 | 已有簡陋流程或用 Excel/通用工具，願意換成專用 subledger。[^4][^5] |
| L3 終局 | 使用穩定幣的 Web2 企業（跨境、供應鏈、treasury） | 穩定幣只是整體 cash management 的一部分 | 需要的是「IFRS/GAAP 可用的穩定幣流水 + ERP / TMS 對接」，不是 crypto toy。[^6][^7][^8] |

你的產品最終要服務 L3，但 MVP 和早期收入應該從 L1、L2 來，因為他們已經在找 crypto subledger / accounting 工具。[^3][^5]

***

## L1：CEX / 機構型 crypto org / Sui 項目方

### 定義與範例

- 中小型 CEX、券商／經紀商型平台
- Sui 上的正式營運項目：例如有實體公司、tokenomics、財報與投資人報告要求的協議或應用
- Custody / wallet-as-a-service 提供商、on/off-ramp 業者

這群人本質上就是「已經是企業，只是資產大部分在鏈上」，是現有 subledger 工具的標準目標客群。[^9][^5][^1]

### 典型痛點

- 多鏈多錢包多交易所，月關帳要靠大量 CSV + Excel 拼接。
- 稽核、投資人 due diligence 時，需要一套可以追溯到每筆 on-chain transaction 的 subledger。[^1][^9]
- ERP（或至少會計系統）已經上線，但對鏈上資產只能用手動分錄補。[^10][^9]


### 對你的產品的核心價值

- 把 Sui（以及其他主鏈）的 on-chain events 整理成 GAAP/IFRS ready 的 journal entries，feed 回 NetSuite / Xero / QuickBooks 等系統。[^11][^9][^1]
- 提供「audit-ready subledger」：每一筆財報數字都有可追溯的鏈上證據與 pricing source。[^4][^1]
- AI 幫他們把複雜 DeFi / internal transfer 先做初步分類，財務只需要 review 例外而不是全量。


### ICP 條件（你可以用來篩選）

- 有法人實體；有會計師或外部審計。
- 每月鏈上 + CEX 交易數量超過某個門檻（例如 > 1,000 筆/月）。
- 已在用或準備導 ERP / accounting system（至少 QuickBooks / Xero 等）。

***

## L2：Web3 原生公司（基金、做市商、支付商）

### 定義與範例

- Crypto fund / family office（持有大量 token / LP / staking）
- 做市商、prop trading shop
- Crypto 支付公司（幫商家收款，自己做 settlement）

這類在現有 subledger / accounting 工具報告裡，被列為主要客戶群之一，因為他們需要 DeFi coverage + NAV / P\&L 計算 + fund reporting。[^2][^5][^12]

### 典型痛點

- NAV、P\&L、performance fee 計算要在多鏈、LP 代幣、複雜策略下完成。
- 對投資人（LP）要提供可驗證的報表與流水。
- 現有工具對新鏈、新協議支援慢，特別是像 Sui 這類非 EVM 鏈。


### 對你的產品的核心價值

- 做 Sui / 特定鏈的「最佳 data + accounting engine」，補現有工具的 coverage gap。[^13][^2]
- 給 fund manager / CFO 一版可以根據 IFRS / GAAP 切換的 valuation / P\&L 報表。
- 把 on-chain data / DeFi position 整理成 NAV worksheets 與 audit workpapers。

***

## L3：使用穩定幣的 Web2 企業（終局）

### 定義與範例

- 做跨境 B2B 收付款的貿易公司、SaaS、遊戲公司（有全球客戶）。
- 使用 USDC/USDT 作為部分 treasury 的企業（特別是在美元管制、銀行基礎設施差的地區）。
- 以穩定幣支付供應商、自由工作者、affiliate 的平台。

這群客戶的語言是「treasury / ERP / TMS / compliance」，而不是「DeFi farming」。Stripe、Bitwave 等談穩定幣 treasury 管理時，用的就是這種語言。[^7][^14][^8]

### 典型痛點

- 穩定幣只是他們現金管理的一小塊，但目前卻需要完全不同的流程與報表。
- Treasury / accounting / legal / compliance 對穩定幣認知不一致，導致政策與會計處理模糊。[^6][^7]
- 希望在不重寫整個 ERP / TMS 的前提下，讓穩定幣交易自然出現在月結、現金流量表與資產負債表上。[^7][^6]


### 對你的產品的核心價值

- 提供一個「stablecoin transaction → enterprise ledger」的 pipeline：
    - 可設定資金政策（哪些 stablecoin、哪些對手方、哪些用例）。
    - 自動把錢包活動映射到 ERP / TMS 的 account / cost center / entity。
    - 支援 IFRS / GAAP 下對穩定幣的 accounting policy 選擇（金融資產 vs 現金等價物等）與 disclosure。[^15][^16]
- 讓 stablecoin treasury management 有 audit-ready trail，而不是 side system。[^8][^7]

***

## GTM 策略：分階段與分訊息

### Phase 0：定位與訊息框架

先定一句全球可用的定位句，之後針對不同 ICP 微調：

> “AI-assisted digital asset subledger for finance teams on IFRS \& US GAAP — turning on-chain chaos into ERP-ready ledgers.”

這句話裡有三個關鍵字：「finance teams」「IFRS \& US GAAP」「ERP-ready」，明確告訴對方這不是給 developer 的工具，而是財務使用的 infra。[^5][^2]

然後針對 L1 / L2 / L3 分別強調不同點：

- L1：重點在 audit trail + ERP integration（subledger 語言）。[^9][^5][^10]
- L2：加上 DeFi coverage / NAV / multi-entity（fund 語言）。[^12][^2]
- L3：換成 stablecoin treasury / TMS / policy / control（treasurer 語言）。[^6][^8][^7]


### Phase 1：Sui 生態 \& crypto-native 早期 adopter（L1 + L2）

目標：在 Sui 生態內建立「這條鏈上最懂會計的 infra」的定位，拿到 3–5 個 pilot logo。

戰術：

1. 生態內 BD
    - 參與 Sui 官方舉辦的 builder 活動、黑客松、grants program，提出「financial infra / subledger」主題。
    - 主動接觸已上線、TVL / volume 有一定規模的 Sui 協議與應用，提供「免費 1–2 月 close-as-a-service」，用你的系統幫他們整理 first clean month-end package，換 testimonial。
2. 與基礎設施 / custodian / data provider 合作
    - 與像 Fireblocks（已支援 Sui）、Ledger Enterprise 一類的 custody / treasury provider 對接，變成它們 Sui 客戶的 accounting layer。[^17][^14][^18]
    - 與 Sui 上的 indexer / data infra 合作（或自己 build），確保 data 正確性，以便對外宣稱「audit-grade data + accounting」。[^2][^8]
3. 專注 content：寫給 CFO / fund admin 的 Sui accounting 深度文
    - 類似「How to close books for a Sui protocol under IFRS / GAAP」，實際展示：
        - 事件 → 分錄 → 三大表的 mapping。
        - 不同準則下科目會如何變化。
    - 把自己定位為「懂準則又懂 Sui 的人」。目前這種內容幾乎沒有，容易拿到心智。
4. Pricing / offer
    - 早期 pilot：以「one-click close」或「month-end close in 3 days instead of 3 weeks」為賣點，收顧問 + 軟體混合的案子。
    - 以「每月交易筆數 + entity 數」分 tier，簡單易懂。[^19][^12]

### Phase 2：往穩定幣 treasury 的 Web2 企業試點（L3）

當你在 L1 / L2 有幾個漂亮案例後，可以開始對傳統企業講「穩定幣 treasury / cross-border payment」的故事。

戰術：

1. 圍繞具體 use case，而不是「導入 crypto」
    - 先找已經在用 stablecoin 做跨境、供應商付款或遊戲內結算的企業，而不是去教育完全沒碰過 crypto 的公司。
    - 引用 Stripe、Chainlink 等公司關於 stablecoin treasury management 的公開文章，說明這是已經在進行的 mainstream 趨勢。[^8][^7][^6]
2. 跟支付／treasury provider 夥伴合作
    - 找提供 stablecoin rail / treasury 的金融科技公司，一起組成解決方案：
        - 對方提供「發送／收款／錢包治理」。
        - 你提供「會計 / ERP / reporting」。
    - 這樣你不需要自己說服企業改變 payment rail，只要負責說服 finance team 接你的 subledger。
3. Messaging 調整
    - Hero message 類型：「Make stablecoin flows as clean as bank statements in your ERP.」
    - 重點詞：treasury policy、approval workflow、ERP / TMS integration、audit trail、IFRS / GAAP。[^7][^6][^8]
4. PoC 模式
    - 對 Web2 客戶，用「單一業務線 pilot」：例如只針對「拉美區供應商付款」或「特定遊戲專案收入」導入。
    - 把你之前在 L1 / L2 累積的 subledger 能力當作背後 engine，對前端只暴露穩定幣場景相關的 UI。

***

## 每層的實際觸達管道（summary）

- L1 / L2（crypto-native）
    - 來源：Sui / L1 生態活動、crypto accounting / infra 相關 podcast / 部落格、custody / CEX / fund admin 合作。[^20][^17][^2]
    - 管道：Twitter / Farcaster / Telegram / Discord、web3 conference、專門的 crypto accounting roundtable。
    - 語言：subledger, ERP integration, NAV, DeFi coverage, audit-ready。
- L3（Web2 finance / treasury）
    - 來源：treasury / CFO community、Big4 / mid-tier 會計師事務所、fintech partner。
    - 管道：LinkedIn、webinar、「stablecoin treasury / cross-border B2B」theme 的 whitepaper、與會計師事務所聯合舉辦線上講座。[^6][^8][^7]
    - 語言：stablecoin treasury management、cash operations、ERP / TMS、IFRS / GAAP、控制與合規。

***

如果你接下來打算先從 Sui 生態開始，我可以幫你具體寫出「L1 / L2 ICP 對應的 outbound pitch 模板（英文 + 中文各一版）」或「官網首頁 hero + 3 個 section 文案」，你比較想先要哪一個？
<span style="display:none">[^21][^22]</span>

<div align="center">⁂</div>

[^1]: https://coincile.io/learn/crypto-subledger/

[^2]: https://allium.so/blog/top-blockchain-data-platforms-for-accounting-and-finance-teams-in-2025/

[^3]: https://breezing.io/blog/best-crypto-accounting-subledger-tools/

[^4]: https://tres.finance/why-a-crypto-accounting-subledger-is-essential-in-2025/

[^5]: https://node40.com/compare-best-crypto-accounting-software/

[^6]: https://www.ngpes.com/blog/how-stablecoins-are-transforming-treasury-management-and-b2b-payments

[^7]: https://stripe.com/resources/more/stablecoin-treasury-management-explained

[^8]: https://chain.link/article/stablecoin-treasury-management

[^9]: https://www.cryptoworth.com/crypto-subledger

[^10]: https://cryptio.co

[^11]: https://tres.finance/finos-crypto-accounting-software/top-5-crypto-accounting-software-for-enterprises/

[^12]: https://tres.finance/crypto-accounting-for-enterprises/

[^13]: https://integral.xyz/integrations/sui

[^14]: https://www.bitwave.io/blog/bitwave-best-enterprise-platform-for-crypto-stablecoin-and-digital-asset-accounting

[^15]: https://treasury-management.com/blog/understanding-stablecoin-accounting

[^16]: https://www.linkedin.com/pulse/accounting-stablecoins-under-ifrs-chetan-hans-n2zdc

[^17]: https://blog.cryptio.co/ledger-enterprise-partners-with-cryptio-to-bring-financial-auditability-to-institutions

[^18]: https://www.fireblocks.com/blog/fireblocks-adds-support-for-leading-layer-1-sui-expanding-institutional-access-to-high-performance-defi

[^19]: https://us.fitgap.com/search/crypto-accounting-software

[^20]: https://podcasts.apple.com/us/podcast/96-building-an-enterprise-grade-crypto-accounting/id1584410579?i=1000726484671\&l=zh-Hans-CN

[^21]: https://www.taxbit.com/products/enterprise-accounting

[^22]: https://ledgible.io/accounting/

