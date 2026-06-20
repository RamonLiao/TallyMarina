<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>
```
# <q>把「這個 Sui Stack 整合架構」畫成一個簡化的模組圖 + 說明（用文字描述每一層如何連接），讓你之後寫 pitch deck / 技術白皮書時可以直接引用。你會比較想要偏「對投資人講的 high-level 架構」，還是偏「給工程團隊看的具體元件與資料流」版本？</q> 我可能兩者都要。因為想參加Hackathon，有DeepBook, Walrus, DeFi&Payment, Web Agentic的賽道，只能報一個，報哪一個好？ 我需要有可以pitch並demo給評審的版本，和自己開發的版本
```

先直接給建議：
**Track 首選報「Agentic Web」，次選是「DeFi \& Payments」。**
你的題目本質是「AI + 會計規則引擎 + Sui 作為可驗證的財務控制層」，跟官方現在主推的 *agentic commerce / agentic execution* 敘事高度契合，比 DeepBook / Walrus 單一協議 track 更容易講出有深度、有延續性的故事。[^1][^2][^3][^4]

下面我分三塊：

1) 為什麼選 Agentic Web / DeFi\&Payments 而不是 DeepBook / Walrus
2) 一個給投資人看的高階架構圖（文字版）
3) 一個給工程團隊看的具體模組 + 資料流（可以拿來拆 task）

***

## 1. 選哪個 Hackathon Track 比較合理？

### 為什麼首選 Agentic Web

Sui 官方這一兩年的主軸就是「Agentic Web」：AI agent 需要一個 shared, verifiable, policy-aware 的執行層，尤其是牽涉到支付與財務時，要把「意圖 → 授權 → 執行 → 可驗證憑證」串起來。[^2][^3][^1]

你的產品正好對應這個敘事：

- AI agent 幫企業財務部「看錢包 → 解讀交易 → 套政策 → 產出分錄 → 做 audit trail」，
而 Sui 提供的是：
    - 共享且可驗證的 state（on-chain balances, DeepBook positions）。[^5][^2]
    - 授權邊界（未來可以結合 x402 / Payment Kit / AP2 那一套 agentic payment primitives）。[^6][^1]
    - 可驗證的收據與 Walrus 上的 audit snapshots。[^7][^1]

評審要看的三件事：

- 問題有沒有真實商業價值（企業會計 / treasury → Yes）。
- Sui 是否是「必須」而非「隨便一條鏈都行」（你用 Sui Stack 當 trust+storage+execution 層 → Yes）。[^3][^1]
- 專案能不能在 hackathon 後繼續走（你本來就打算做成產品 → Yes）。[^8][^9]

Agentic Web track 正是這個組合，且官方近期 blog 和宣傳都在講「AI agents + Sui stack」這條線，搭順風車對 pitch 很加分。[^1][^5][^2][^3]

### 為什麼 DeFi \& Payments 是次選

如果主辦這次的 DeFi \& Payments track 定位是「用 Sui 打造下一代 DeFi / 支付應用，特別是 real-world、可規模化的東西」，你也很適合：

- 你是「企業穩定幣 / token treasury + ERP integration」，屬於非常典型的 *payment + treasury infra* use case。[^10][^11][^12]
- Pitch 可以講「讓企業穩定幣收付款在 Sui 上結算，並直接串回 IFRS / GAAP 財報」——這在 DeFi track 裡也很亮眼。[^11][^10]

缺點是：DeFi \& Payments 參賽隊伍很多會是「protocol / AMM / lending / aggregator」，你這種偏 infra + accounting 的題目要多花力氣證明「DeFi enough」。

### 為什麼不建議把主題硬塞去 DeepBook / Walrus Track

- **DeepBook track** 多半期待你主打 orderbook 流動性、交易體驗、做市、衍生品等，會計 / ERP 會被視為「間接相關」。你可以用 DeepBook 當交易來源沒錯，但這是你系統的 input，而不是題目的中心。要拿獎會比較辛苦。[^9][^4]
- **Walrus track** 會比較希望你把 Walrus 當「核心」而不是「附加功能」，例如：大資料應用、on-chain web、社交 / 遊戲 state 存在 Walrus。 你的產品確實可以用 Walrus 存 audit snapshots、報表與 workpapers，但那比較像 bonus，而不是主敘事。要拿純 Walrus track 的獎，會拉偏重心。[^13][^7]

所以如果只能選一條主賽道，我會排：

1. Agentic Web（主敘事自然，AI + finance + Sui trust layer）
2. DeFi \& Payments（偏 payment / treasury 敘事）
3. Walrus / DeepBook（拿來當技術加分點，而不是賽道主題）

***

## 2. 給投資人 / 評審看的高階模組圖（文字版）

**一句話版本：**
> 「我們做的是 AI 驅動的數位資產子分類帳，讓 AI agent 在 Sui 上幫企業處理鏈上資產、穩定幣和 DeFi 活動，輸出 IFRS / GAAP-ready 的分錄與審計軌跡。」

可以畫成 3 層：

### Layer 1 – Sui 信任與執行層（Trust \& Execution Layer）

- **Sui L1 + DeepBook**：
    - 所有 on-chain 資金流（錢包、DeFi、DeepBook 交易）產生的 state 與 event。[^14][^9]
- **Sui Stack Components**：
    - TypeScript SDK / GraphQL / Indexer：讓我們以結構化方式讀取交易、物件、DeepBook 位置。[^15][^16][^17]
    - Walrus：儲存關帳時的 audit snapshots、報表、憑證，形成不可竄改的審計證據。[^18][^7]
    - zkLogin / SuiNS / Seal（視 demo 範圍）：提供人類友善登入、可讀地址與加密訊息通道。[^19][^18]

**投影片上可以畫成**：底部一條「Sui Stack」帶 logo，旁邊標「Shared, verifiable ledger + programmable storage + indexing」。

### Layer 2 – AI \& Accounting Engine（Intelligence Layer）

- **Normalization Engine**：
    - 把 Sui / CEX / Custody 的原始交易流，轉成統一的「財務事件」格式（收款、付款、swap、staking、fee 等）。[^20][^21]
- **Policy-Based Accounting Rules Engine**：
    - 依 entity 的 IFRS / GAAP 政策、成本基礎方法、資產分類等，把事件轉成 journal entries。
- **AI Copilot for Finance**（Agentic 部分）：
    - 分析事件、建議分類、標出例外，並根據公司 policy 提出建議分錄。
    - 透過 Sui 的 trust layer，把「AI 的決策、對應的 on-chain state 和最終分錄」綁在一起，形成 verifiable outcome。[^2][^3][^1]

投影片上可以畫成一個大方塊「AI Accounting Engine」，裡面拆「Rules」「AI」「Reconciliation」。

### Layer 3 – Enterprise Finance Layer（ERP \& 人）

- **ERP / GL 系統**（NetSuite / SAP / Xero / QuickBooks 等）：
    - 接收我們的 journal entries、reconciliation reports、period-end balances。
- **Finance \& Audit Users**：
    - 財務人員透過 Web UI 審核 AI 建議、調整政策、export 到 ERP。
    - 審計人員可以查 Walrus 上的快照和 on-chain 憑證。

投影片上畫：上層是「ERP \& Finance Team」，中層「AI Accounting Engine」，底層「Sui Stack」，從下往上箭頭是 data，上往下箭頭是 policy / intent。

***

## 3. 給工程團隊看的具體模組與資料流

這個版本比較工程味，可以直接拆成 task / repo 結構。

### A. Ingestion \& Indexing Layer

- **Sui Ingestion Service**
    - 使用 `@mysten/sui` TypeScript SDK，透過 gRPC / JSON-RPC 抓取：
        - 企業指定錢包 / objects 的交易與 state。
        - DeepBook 相關交易（如果要 demo DeFi integration）。[^17][^14][^15]
- **GraphQL / Indexer Query Service**
    - 使用 Sui GraphQL RPC + General-purpose Indexer 做：
        - 按 period / entity 查歷史交易。
        - 做 reconciliation 與報表查詢。[^16][^22]

輸出：`RawTransaction` 表 + 初步 `NormalizedEvent` 表。

### B. Normalization \& Pricing Layer

- **Event Normalizer**
    - 專門針對 Sui 的 object model、DeepBook event、Walrus interaction 寫 parser，把上述交易轉成統一的 `NormalizedEvent`（含 event_type, asset, quantity, counterparty, purpose 等）。[^14][^20]
- **Pricing \& FX Service**
    - 從 oracle / CEX / off-chain API 取價格，寫入 `PricePoint`。
    - 若你想把 pricing 也做成可驗證，可以用 Nautilus / oracle pattern 把關鍵價格寫進 Sui（這可留到後續）。[^12][^18]


### C. Accounting Rules Engine

- **Policy Store（PolicySet + MappingRules）**
    - PolicySet：IFRS / GAAP、functional currency、asset classification、stablecoin policy、staking policy 等。[^23][^24]
    - MappingRules：依 event_type 和條件產生 debit / credit line 的 JSON 化規則。[^25][^26]
- **Rules Evaluation Engine**
    - Input：`NormalizedEvent + PricePoint + PolicySet`
    - Output：`JournalEntryHeader + JournalEntryLines`
    - 需要：
        - lot tracking（FIFO / WAC）。
        - 多幣別換算。
        - 多實體 / dimension tagging（entity, wallet, cost center, project）。[^27][^20]


### D. AI Assistant \& Review Workflow

- **Classification Model**
    - Task：
        - 建議 event_type / economic_purpose / counterparty_type。
        - 標示異常（例如大額 transfer、未知合約互動）。[^21][^28]
- **Review UI \& Workflow**
    - 用 React + Sui dApp Kit：
        - 顯示 event + AI suggestion。
        - 讓 finance user Accept / Edit / Reject。
        - 把 review 決策寫回 `NormalizedEvent.review_status`。
    - 可以視情況：
        - 用 Seal / Messaging SDK 提供針對某筆事件的加密評論 / 審計備註。[^18]

只有 `review_status = APPROVED` 的事件才會進入規則引擎生成正式 JE。

### E. Reconciliation \& Walrus Snapshots

- **Reconciliation Engine**
    - 對比：
        - On-chain wallet / DeepBook / CEX balance vs subledger balance。
        - Subledger balance vs 已 export 到 ERP 的總帳 balance。[^21][^27]
- **Walrus Snapshot Writer**
    - 每個 period end：
        - 把某 entity 的 positions / JE / recon 結果打包成 JSON / parquet，寫入 Walrus 存儲。
        - 回存 Walrus blob ID 到本地 DB + Sui（做 on-chain reference）。[^7][^18]

這一層讓你在 demo 裡可以秀：「一鍵 close，並把關帳快照 publish 到 Walrus，形成 verifiable audit pack」。

### F. ERP Connectors

- **CSV Exporter**（Hackathon MVP 就好）
    - 產出符合：
        - NetSuite / Xero / QuickBooks 的 journal import 格式。
- **API Connector（Post-hackathon）**
    - 之後再做 direct API 的 bi-directional sync。

***

## 4. Hackathon Demo vs 日後產品版本

你可以這樣切 scope：

### Hackathon Demo 必須有的

- 單一 entity、單一或少數錢包的 Sui 交易 → events → AI suggestion → journal entries 全流程。
- 最少 2–3 類事件：收款、付款、swap / DeepBook trade。
- 一個簡單的 web UI：
    - 左側顯示交易流（含 on-chain tx link）。
    - 中間顯示 AI 建議分類 + 建議分錄。
    - 右側可以一鍵「Approve \& Export」，並顯示 Walrus snapshot / on-chain reference。
- Pitch 裡明講這個 flow 如何體現「Agentic Web：AI agent 在 Sui 上做財務決策，但所有結果都可驗證且有政策邊界」。[^5][^3][^1][^2]


### 自己之後要做的產品版本

- 擴成多 entity、多鏈、多來源。
- 完整 IFRS / GAAP policy editor + 規則版本控制。
- 深度 ERP connectors。
- 更完整的 AI workflow（exception routing、通知、chat-based 解釋）。

***

如果你願意，下一步我可以直接幫你寫一段**「Agentic Web track 用的 1–2 分鐘口頭 pitch + Demo 敘事腳本」**（例如 Demo flow：「看企業今天在 Sui 的資金流 → AI 幫你 close books → 一鍵把月結結果 publish 到 Walrus \& 匯入 NetSuite」），讓你可以直接拿去練 pitch。
<span style="display:none">[^29][^30][^31][^32]</span>

<div align="center">⁂</div>

[^1]: https://blog.sui.io/ai-agents-agentic-commerce-trust-layer/

[^2]: https://blog.sui.io/agentic-execution-ai-agents-need-blockchain/

[^3]: https://adeniyisui.substack.com/p/the-sui-developer-stack-powering

[^4]: https://www.facebook.com/suinetwork.vn/photos/-walrus-deepbook-mang-140k-giải-thưởng-đến-sui-overflow-2026tại-hackathon-flagsh/122217244988290094/

[^5]: https://www.bitget.com/news/detail/12560605177817

[^6]: https://x.com/SuiNetwork/status/1967950332287390064

[^7]: https://tatum.io/tatum-x-walrus-hackathon

[^8]: https://ethglobal.com/events/hackmoney2026/prizes/sui

[^9]: https://www.youtube.com/watch?v=5w2TTZejCaU

[^10]: https://www.ngpes.com/blog/how-stablecoins-are-transforming-treasury-management-and-b2b-payments

[^11]: https://stripe.com/resources/more/stablecoin-treasury-management-explained

[^12]: https://chain.link/article/stablecoin-treasury-management

[^13]: https://www.facebook.com/groups/hackathonkaki/posts/1598084330740950/

[^14]: https://www.dwellir.com/blog/what-is-sui

[^15]: https://sdk.mystenlabs.com

[^16]: https://blog.sui.io/graphql-rpc-and-general-purpose-indexer-beta/

[^17]: https://sdk.mystenlabs.com/sui/clients

[^18]: [External] HackMoney x Sui Project Ideas.pdf

[^19]: https://www.mystenlabs.com/blog/interoperability-autonomy-agentic-web

[^20]: https://coincile.io/learn/crypto-subledger/

[^21]: https://optimus.tech/blog/crypto-reconciliation-guide-for-finance-teams

[^22]: https://www.quicknode.com/docs/sui/sui-graphql

[^23]: https://www.ocorian.com/knowledge-hub/insights/accounting-treatments-your-digital-assets

[^24]: https://www.isda.org/2022/05/10/accounting-for-digital-assets-key-considerations/

[^25]: https://millenniumconsulting.com/rules-engine-and-subledger-technology/

[^26]: https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/ledger-subledger

[^27]: https://tres.finance/digital-asset-reconciliation-best-practices-for-finance-teams/

[^28]: https://www.taxbit.com/blogs/taxbit-accounting-suite-product-spotlight-ai-enabled-rules-engine

[^29]: https://www.deepsurge.xyz

[^30]: https://hackquest.io/en/hackathons/Move-on-Sui-Online-Hackathon

[^31]: https://x.com/bermudao_ch/status/2054062797739491601

[^32]: https://overflow.sui.io

