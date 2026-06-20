# 會計規格書 v3.0

**產品**：Sui Agentic Subledger  
**文件性質**：數位資產子分類帳之會計政策、事件分類、衡量、分錄與披露資料規格  
**版本**：3.0  
**狀態**：DRAFT FOR VALIDATION  
**適用對象**：產品、工程、財會、內控、稽核與外部會計顧問  
**重要聲明**：本文件是系統設計規格，不構成會計、法律、稅務或投資意見。企業應由具資格之專業人員依個別事實、合約權利、持有目的及所在地法規核准 PolicySet。

---

## 1. 準則與適用範圍

### 1.1 支援的會計框架（高層）

系統不在 entity 或 book 層設定單一 `measurement_path`。模型分為：

1. `Book.accounting_standard`：只設定 `IFRS` 或 `US_GAAP`。
2. `AssetPositionAssessment.scope_test`：按 instrument、權利、用途、issuer 關係與 position facts 判定適用準則及 scope。
3. `AssetPositionAssessment.measurement_model`：每個 asset position 解析為唯一模型；同一 book 可同時存在多種模型。
4. `out_of_scope_routing`：scope 不符、未知或證據逾期時，路由至其他已核准模型或 `PENDING_ACCOUNTING_REVIEW`，不得套用 book 級預設。

IFRS 下，IFRIC 2019 議程決議指出：若 cryptocurrency 在正常營業過程中為出售而持有，適用 IAS 2；符合 commodity broker-trader 條件者按公允價值減出售成本衡量；其他符合該決議事實的 holdings 適用 IAS 38。[來源: https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2019/holdings-of-cryptocurrencies-june-2019.pdf]

IAS 38 重估模式僅可在存在活絡市場時使用；不得把重估模式當成所有 IFRS crypto assets 的 book 級選項。[來源: https://kpmg.com/us/en/articles/2024/digital-assets-under-ifrs-accounting-standards.html]

US GAAP 下，ASU 2023-08 是符合六項 scope 條件之特定 crypto assets 的後續衡量模型，不是完整 US GAAP 路徑；in-scope assets 以公允價值衡量且變動列入淨利，out-of-scope assets 必須轉至其他適用 US GAAP 模型。[來源: https://dart.deloitte.com/USDART/home/codification/assets/asc350-60/roadmap-digital-assets/chapter-2-classification/2-3-crypto-assets-within-scope]

ASU 2023-08 適用於 2024-12-15 後開始之 fiscal years（含 interim periods），允許提前採用，並以 modified-retrospective 方法於採用期初調整 retained earnings。[來源: https://www.grantthornton.com/insights/articles/audit/2023/snapshot/december/clarifies-accounting-for-certain-crypto-assets]

本系統的責任是：

- 保存原始資料與經核准的會計政策。
- 將技術交易轉為具經濟意義的事件。
- 依 PolicySet 執行可重現的分類、衡量、lot allocation 與分錄。
- 保留人工覆核、政策例外、重跑、沖銷及披露資料軌跡。
- 輸出 ERP/GL 可接受的分錄與報表資料。

本系統不自動決定：

- 某 token 是否滿足資產定義或由企業控制。
- 穩定幣是否為現金、現金等價物、金融資產或無形資產。
- staking、DeFi、bridge 或 wrapped arrangement 的法律所有權與控制權。
- 收入認列時點、主理人或代理人判斷、稅務基礎及監管分類。

### 1.2 適用主體與帳務邊界

每一 `Entity` 為獨立帳務主體，至少具有：

- 功能性貨幣、報導貨幣、會計準則與會計年度。
- 錢包、CEX、custodian、protocol position 與銀行帳戶的所有權或控制權清單。
- 關係人、內部錢包與代管客戶資產的標記。
- 經核准的 chart of accounts、PolicySet 與 closing calendar。

客戶代管資產不得因技術上位於企業控制的錢包而當然認列為企業資產。這是 fail-closed ownership/recognition gate：缺少合約、beneficial owner 或控制證據時，系統只保留數量紀錄並設為 `PENDING_ACCOUNTING_REVIEW`，不得產生企業資產 JE。系統以 `beneficial_owner_entity_id`、`custody_capacity` 與 `balance_sheet_recognition` 分離技術控制及會計認列。

### 1.3 認列、衡量與過帳層級

處理順序固定為：

1. `RawTransaction`：不可變原始資料。
2. `NormalizedEvent`：技術交易拆解後的經濟事件。
3. `AccountingAssessment`：資產分類、事件性質與準則路徑。
4. `MeasurementResult`：成本、公允價值、匯率、減損及 lot allocation。
5. `JournalEntry`：借貸平衡之分錄。
6. `ReconciliationRecord`：鏈上/CEX 餘額、子帳與 GL 對帳。
7. `DisclosureFact`：報表及附註所需資料點。

任何後層資料均不得覆蓋前層資料。更正採新版本、沖銷或替代紀錄。

### 1.4 重要性、截止與會計期間

- 事件以區塊確認時間 `block_time` 為主要來源，並保留 `observed_at`、交易所執行時間及結算時間。
- 會計日由 entity timezone、closing cutoff、finality policy 及業務條款決定。
- 未達 finality 的交易列為 `PENDING_FINALITY`，不得過帳。
- 關帳後到達的 late event，依 `late_event_policy` 進入原期重開、次期調整或人工判斷。
- 重要性門檻只能影響覆核及彙總，不得用來刪除數量或成本軌跡。

---

## 2. 資產分類模型（Asset Classification）

### 2.1 資產類型（邏輯分類）

每一資產採四層分類，不以 symbol 作唯一識別：

| 層級 | 欄位 | 例示 |
|---|---|---|
| 技術身分 | `asset_id` | chain + package/contract + type/address |
| 技術類型 | `technical_type` | native、fungible、NFT、LP、wrapped、rebasing |
| 經濟特徵 | `economic_features` | 贖回權、收益權、治理權、底層資產請求權 |
| 會計分類 | `accounting_class` | IAS 38、IAS 2、IFRS 9、ASU 2023-08、其他 |

`technical_type` 至少包含：

- `NATIVE_TOKEN`
- `FUNGIBLE_TOKEN`
- `STABLECOIN_FIAT_BACKED`
- `STABLECOIN_CRYPTO_BACKED`
- `STABLECOIN_ALGORITHMIC`
- `GOVERNANCE_TOKEN`
- `WRAPPED_TOKEN`
- `REBASING_TOKEN`
- `LP_TOKEN`
- `STAKING_RECEIPT_TOKEN`
- `DERIVATIVE_OR_STRUCTURED_TOKEN`
- `NFT`
- `UNKNOWN_OR_SPAM`

`accounting_class` 至少包含：

- `INTANGIBLE_IAS38_COST`
- `INTANGIBLE_IAS38_REVALUATION`
- `INVENTORY_IAS2_COST`
- `INVENTORY_IAS2_BROKER_TRADER_FVLCTS`
- `FINANCIAL_ASSET_IFRS9`
- `CASH_OR_CASH_EQUIVALENT`
- `CRYPTO_ASSET_US_GAAP_FV`
- `US_GAAP_OUT_OF_SCOPE_OTHER`
- `CUSTOMER_ASSET_OFF_BALANCE_SHEET`
- `PENDING_ACCOUNTING_REVIEW`

分類由 `AssetPolicy` 在 entity 層級指定。相同 token 因持有目的、合約權利或主體業務不同，可在不同 entity 有不同分類；同一 entity 同一會計期間原則上不得無依據混用分類。

### 2.2 分類決策樹

系統依下列順序提出候選，最終仍須由核准人確認：

1. 是否為他人資產或企業不具控制？若是，轉 `CUSTOMER_ASSET_OFF_BALANCE_SHEET` 或人工評估。
2. 是否為現金？鏈上 token 不得僅因與法幣掛鉤而自動分類為現金；未有核准結論時 fail closed。
3. 是否具有收取現金或另一金融資產的合約權利？若是，IFRS 下評估 IFRS 9。
4. 是否於正常營業過程為出售而持有？若是，IFRS 下評估 IAS 2。
5. 是否為 broker-trader 持有之 commodity-like inventory？IAS 2.3(b) 對 commodity broker-traders 排除一般 measurement requirements，並以 fair value less costs to sell 衡量、變動認列損益。[來源: IFRIC, Holdings of Cryptocurrencies, June 2019] 首個 Paid Pilot 不啟用此路徑。
6. 其餘 IFRS 路徑是否符合可辨認非貨幣性、無實體形態資產特徵？若是，評估 IAS 38。
7. US GAAP 下是否逐項符合 ASU 2023-08 scope criteria？若是，使用 `CRYPTO_ASSET_US_GAAP_FV`；否則轉其他 US GAAP 模組。

分類判斷及證據保存在 `ClassificationAssessment`：

- `contract_terms_ref`
- `issuer_and_related_party`
- `enforceable_redemption_right`
- `underlying_claim`
- `fungibility`
- `held_for_sale`
- `broker_trader_status`
- `active_market_assessment`
- `asu_scope_answers[]`
- `approved_by`
- `effective_from`

### 2.3 穩定幣四層 assessment entity

穩定幣不得只依價格穩定性分類，也不得由單一 `stablecoin_treatment` 欄位驅動。系統建立四層主檔：

| 層級 | 主鍵與內容 |
|---|---|
| Instrument | chain、contract/type、token version、權利類型、wrapper/underlying |
| Issuer | legal entity、related-party、reserve/custodian、credit-risk evidence |
| Jurisdiction | holder、issuer、reserve 與 redemption 所在司法管轄區 |
| Terms version | 生效條款、持有人資格、直接/間接贖回權、費用、等待期、限額與破產順位 |

`StablecoinAssessment` 必須保存 `evidence_refs[]`、`legal_memo_ref`、`approved_by`、`effective_from`、`expires_at`、`reassessment_triggers[]` 與 `conclusion`。觸發條件至少包括條款/issuer/儲備/司法管轄區變更、depeg、贖回暫停、信用事件與證據到期。到期或觸發後自動改為 `PENDING_ACCOUNTING_REVIEW`。

至少評估：

- 發行人及儲備安排。
- 持有人是否有直接且可執行的贖回權。
- 贖回幣別、金額、費用、等待期與最低門檻。
- 法律隔離、破產順位與交易對手信用風險。
- 企業是否將其用於短期現金承諾。
- 價格偏離、流動性及主要市場。

預設：

- IFRS：無已核准條款與法律分析時，`PENDING_ACCOUNTING_REVIEW`；不得自動指定現金、現金等價物或金融資產。若持有人具有合約贖回權，可能落入 IFRS 9；IFRS 對 stablecoin 是否為 cash equivalent 無明文結論，實務存在分歧，必須依條款及事實判斷。
- US GAAP：逐項執行 ASU scope test。具有對底層資產可執行權利的 token 可能不在 ASU 2023-08 範圍 `[需查證]`。
- 價格脫鉤不改變既有分類，但可能觸發公允價值、信用減損或其他減損評估。

### 2.4 US GAAP 下 ASU 2023-08 範圍

系統以可配置問卷記錄下列六項條件：

1. 是否符合 Codification 中 intangible asset 定義。
2. 是否不賦予對底層商品、服務或其他資產之可執行權利。
3. 是否建立或存在於 distributed ledger 或相似技術。
4. 是否以 cryptography 保護。
5. 是否 fungible。
6. 是否非由報導企業或其 related party 建立或發行。

所有條件為真才可設 `asu_2023_08_scope = IN_SCOPE`。`UNKNOWN` 不得等同 `FALSE`，且不得自動過帳期末 FV 分錄。

六項條件及 fungible、非 issuer/related-party token 等範圍要求來源：[來源: https://dart.deloitte.com/USDART/home/codification/assets/asc350-60/roadmap-digital-assets/chapter-2-classification/2-3-crypto-assets-within-scope]。具有對底層商品、服務或其他資產可執行權利的 wrapped token 不在此 scope。[來源: https://www.grantthornton.com/insights/articles/audit/2023/snapshot/december/clarifies-accounting-for-certain-crypto-assets]

### 2.5 Edge-case 資產預設

| 情境 | 預設技術處理 | 預設會計處理 |
|---|---|---|
| Airdrop | 建立 receipt，標記來源與是否 claimed | 未確認控制、可可靠衡量及收入性質前，`REVIEW_REQUIRED` |
| Fork | 原資產 lot 不自動重分配 | 新資產在可控制且可可靠衡量時建立候選 lot；成本分配由政策決定 |
| Bridge | 以 burn/lock + mint/release 關聯 | 經濟所有權持續時視 internal representation change；否則視 disposal/acquisition |
| Wrapped token | 保存 underlying 與 wrapper ratio | 有可執行 1:1 贖回且風險實質不變時可做非處分轉換；否則人工評估 |
| Dust/spam | 進 quarantine，不自動估值或出 JE | 預設零帳面影響；處分前維持數量審計軌跡 |
| Rebase token | 數量調整事件，不偽造 transfer | 正 rebase 之收入或 carrying-value allocation 依政策；負 rebase 不自動視處分 |
| LP token | 拆解 deposit、pool share、fees、withdrawal | 預設人工評估是否為新資產交換；不得只按 LP symbol 當普通 token |
| Staking receipt token | 與 staked principal 關聯 | 避免同時認列 principal 與 receipt token 造成雙重資產 |

上述預設是系統控制，不代表準則結論。bridge、wrapped、LP、fork、rebase 的會計結論高度依合約事實而異 `[需查證]`。

---

## 3. Canonical Event Registry 與會計處理

### 3.0 共通處理原則

本章是兩份規格共同引用的唯一權威 event code registry。禁止 UI、DB、parser 或規則另造同義 code；不得再使用「8 大類」或「14 類」描述 schema。一筆鏈上交易可拆成多個 parent events 與 legs。

### 3.0.1 Canonical event code registry

| Canonical code | 經濟事件 | direction/subtype | paid-pilot |
|---|---|---|---:|
| `DIGITAL_ASSET_RECEIPT` | 外部收款/取得 | customer、capital、borrowing、other | 是 |
| `DIGITAL_ASSET_PAYMENT` | 對外付款；技術 disposal 是其 leg | vendor、payroll、refund、other | 是 |
| `INTERNAL_TRANSFER` | 同一 beneficial owner 內部移轉 | in/out 由 legs 表達 | 是 |
| `CEX_TRANSFER` | CEX 存提 | `DEPOSIT` / `WITHDRAWAL` | 否 |
| `SPOT_TRADE_SWAP` | 現貨買賣或 swap | buy/sell 不另造 event code | 是 |
| `STAKING_DEPOSIT` | staking principal 轉入 | — | 否 |
| `STAKING_REWARD` | staking reward 候選 | — | 否 |
| `STAKING_WITHDRAWAL` | staking principal 轉出 | — | 否 |
| `GAS_FEE` | network gas/fee | — | 是 |
| `PROTOCOL_FEE` | 非 gas protocol fee | — | 否 |
| `AIRDROP_FORK_RECEIPT` | airdrop/fork 候選取得 | `AIRDROP` / `FORK` | 否 |
| `BRIDGE_WRAP` | bridge/wrap/unwrap | subtype | 否 |
| `LP_POSITION_CHANGE` | LP deposit/withdraw/fee | subtype | 否 |
| `REBASE_QUANTITY_CHANGE` | rebase 數量變動 | positive/negative | 否 |
| `PERIOD_END_REMEASUREMENT` | 適用模型的期末衡量 | model | 否 |
| `IMPAIRMENT` | 減損 | — | 否 |
| `IMPAIRMENT_REVERSAL` | 允許時的減損迴轉 | — | 否 |
| `UNCLASSIFIED_CONTRACT_INTERACTION` | 未知互動 | — | 否 |

### 3.0.2 Canonical leg taxonomy

`PRINCIPAL_IN`、`PRINCIPAL_OUT`、`ACQUISITION`、`DISPOSAL`、`FEE`、`GAS`、`REWARD`、`RECEIVABLE_SETTLEMENT`、`PAYABLE_SETTLEMENT`、`TRANSFER_IN_TRANSIT`、`ROUNDING`。`ROUNDING` 只可處理核准門檻內的純小數，不得平衡未知差異。

所有事件至少包含：

- entity、source、wallet、counterparty、asset、quantity、event time。
- `economic_purpose`、`ownership_change`、`consideration_asset`。
- 原始交易、價格、匯率、合約與人工覆核參照。
- `event_group_id`，用以綁定 swap、bridge、staking 或 CEX 的多腿交易。

下列 JE 以功能性貨幣表示。`DA-A`/`DA-B` 代表依分類映射後的數位資產科目；實際科目由 COA mapping 決定。

### 3.1 Digital Asset Receipt（收款）

**事件代碼**：`DIGITAL_ASSET_RECEIPT`

**適用**：客戶收款、資本投入、借款撥入、贈與、airdrop、fork、外部無償轉入。內部來源不得誤歸此類。

**初始衡量**：

- 有對價：以交易日公允價值或準則要求之交易價格衡量。
- 清償應收款：資產入帳金額與應收款帳面金額的差異，依合約、匯率與處分規則處理。
- 無對價：先判定是否及何時認列收入、其他利益或權益。

| 路徑 | 收款時 | 後續 |
|---|---|---|
| IFRS 成本模式 | 按適用準則之初始成本入帳；IAS 38 資產後續成本減累計減損 | 觸發減損評估；處分時計算損益 |
| IFRS 重估模式 | 初始仍按成本；後續於符合重估條件時調至重估金額 `[需查證]` | 上調通常進 OCI/重估盈餘、反轉既有損失部分可能進損益；下調反向處理 `[需查證]` |
| US GAAP ASU 2023-08 | in-scope asset 後續每報導期按 fair value 衡量，變動認列淨利；並保留 acquisition cost 資料 | 首個 Paid Pilot 不啟用；來源為 ASC 350-60 presentation/disclosure guidance。[來源: Deloitte Roadmap ASC 350-60 ch. 6] |

**JE：客戶清償應收款，收到公允價值 10,000 的 USDC**

```text
Dr Stablecoin / Digital Asset              10,000
    Cr Accounts Receivable                         10,000
```

**JE：收到 staking 以外、已核准為其他收入之 airdrop，FV 500**

```text
Dr Digital Asset                              500
    Cr Other Digital Asset Income                    500
```

Airdrop 若未主動 claim、含惡意合約、無可觀察價格或控制尚不明，預設不產生 JE，狀態為 `QUARANTINED` 或 `REVIEW_REQUIRED`。同一概念的「空投」與 airdrop 為同一 edge case。

### 3.2 Digital Asset Payment（付款）

**事件代碼**：`DIGITAL_ASSET_PAYMENT`

**適用**：支付供應商、薪資、退款、稅款、取得服務或非數位資產。gas 另見 3.7。

付款同時包含：

1. 認列所取得的商品、服務、費用或負債清償。
2. 終止認列所支付的數位資產。
3. 認列支付資產的處分損益；若該資產在支付前已按 FV through P&L 衡量，交易時差額通常較小。

| 路徑 | 支付資產終止認列 | 處分損益 |
|---|---|---|
| IFRS 成本模式 | 按 lot carrying amount 貸記資產 | 對價 FV 與 carrying amount 差額進 P&L |
| IFRS 重估模式 | 按重估後 carrying amount 終止認列 | 差額進 P&L；相關重估盈餘轉保留盈餘之處理依政策及準則 `[需查證]` |
| US GAAP ASU 2023-08 | 按交易時 FV/帳面額終止認列 | 自最近衡量日至支付日變動進 P&L；展示方式依政策 |

**JE：以帳面 900、FV 1,000 的 token 支付供應商費用**

```text
Dr Professional Services Expense           1,000
    Cr Digital Asset                                900
    Cr Gain on Disposal of Digital Asset            100
```

若付款清償帳面 1,000 的 AP，而 token FV 980：

```text
Dr Accounts Payable                         1,000
    Cr Digital Asset                                [carrying amount]
    Cr/Dr Gain or Loss on Disposal                  [balancing amount]
```

分錄引擎不得以「付款數量 × peg」取代事件時點可支持的公允價值。

### 3.3 Internal Transfer（內部錢包／帳戶轉帳）

**事件代碼**：`INTERNAL_TRANSFER`

**適用**：同一 entity、同一 beneficial owner 的 wallet-to-wallet、custodian-to-wallet 或 account-to-account 移轉。

三條路徑均不因純內部移轉認列處分損益或重設成本。差異只在資產科目、受限制狀態、地點與 custody dimension。

| 路徑 | Principal | Fee |
|---|---|---|
| IFRS 成本模式 | carrying amount 與原 lot 延續 | 依 3.7 費用化或符合條件時資本化 |
| IFRS 重估模式 | carrying amount 與重估儲備延續 | 同上 |
| US GAAP ASU 2023-08 | FV carrying amount 延續，不建立新 acquisition cost | 通常另認 fee |

**JE：Wallet A 移至 Wallet B，帳面 5,000**

```text
Dr Digital Asset — Wallet B                5,000
    Cr Digital Asset — Wallet A                    5,000
```

若 COA 不按 wallet 分科目，可不產生 GL JE，只更新 subledger dimensions。系統須證明兩腿匹配；單腿事件在逾時前列 `TRANSFER_IN_TRANSIT`，不可直接當收入或費用。

**Bridge / wrapped token**：

- 能證明 lock/burn 與 mint/release、權利持續且無實質風險改變：預設視為 internal representation change，原 lot rollover。
- bridge 合約造成新的交易對手信用、贖回限制或權利實質改變：`REVIEW_REQUIRED`，可改判 disposal + acquisition。
- bridge fee 單獨記錄，不併入 principal 數量差異。

### 3.4 CEX Deposit / Withdrawal（交易所存提）

**事件代碼**：`CEX_TRANSFER`（以 `direction = DEPOSIT | WITHDRAWAL` 區分）

CEX account 為同一 entity 且企業保留資產權利時，原則上比照 internal transfer。若交易所條款實質形成對 CEX 的請求權，而非持有鏈上 token，可能需重新分類 `[需查證]`。

| 路徑 | Deposit/withdrawal principal | 例外 |
|---|---|---|
| IFRS 成本模式 | lot carrying amount 延續 | 權利改變時重做 IFRS 9/IAS 38 分類 |
| IFRS 重估模式 | carrying amount 與 reserve 延續 | 市場與限制改變納入估值 |
| US GAAP ASU 2023-08 | 只有仍持有同一 in-scope crypto asset 才延續 | 對 CEX 的合約請求權可能 out of scope `[需查證]` |

**JE：鏈上錢包轉入 CEX**

```text
Dr Digital Asset — CEX                    20,000
    Cr Digital Asset — On-chain Wallet            20,000
```

**CEX 未入帳或提領在途**：

```text
Dr Digital Asset Transfer in Transit      20,000
    Cr Digital Asset — Source                     20,000
```

確認到帳後：

```text
Dr Digital Asset — Destination            20,000
    Cr Digital Asset Transfer in Transit          20,000
```

CEX 破產、凍結或提領限制可能觸發分類、公允價值、信用減損或其他減損評估，須建立 `CUSTODY_RISK_TRIGGER`。

### 3.5 Spot Trade / Swap（現貨交易／代幣互換）

**事件代碼**：`SPOT_TRADE_SWAP`

一律拆為：

- `DISPOSAL_LEG`
- `ACQUISITION_LEG`
- `FEE_LEG`
- 必要時 `ROUNDING_LEG`

以收到資產或支付資產的公允價值中較可靠者作為交易價值；若交易並非 orderly transaction、涉及關係人或無可觀察市場，轉人工估值。

| 路徑 | 舊資產 | 新資產 | 損益 |
|---|---|---|---|
| IFRS 成本模式 | 按 selected lots carrying amount 終止認列 | 依適用準則按成本初始認列 | 對價 FV 減 carrying amount 及處分成本 |
| IFRS 重估模式 | 按重估 carrying amount 終止認列 | 初始按成本，後續重估 | 交易日差額進 P&L；相關 reserve 依政策轉列 `[需查證]` |
| US GAAP ASU 2023-08 | in-scope 舊資產更新至交易時 FV 後終止認列 | 新資產若 in-scope，建立 acquisition cost 並後續 FV | FV 變動與處分展示依政策，總損益不得重複 |

**JE：100 SUI，carrying amount 200，換得 FV 300 USDC**

```text
Dr Stablecoin / Digital Asset               300
    Cr Digital Asset — SUI                         200
    Cr Gain on Disposal                            100
```

**另以 3 USDC 支付 DEX fee**

```text
Dr Transaction Fee Expense                    3
    Cr Stablecoin / Digital Asset                    3
```

若 fee 是取得新資產的直接可歸屬成本，IFRS 成本路徑可依核准政策資本化；US GAAP ASU 2023-08 下交易成本處理須依最新規範確認 `[需查證]`。

**LP token**：

- 加入 liquidity 預設不是普通 internal transfer。
- 系統先辨識交付 token、取得 LP token、pool ownership、withdrawal rights、fees/rewards。
- PolicySet 可選 `DISPOSAL_AND_ACQUISITION`、`LOOK_THROUGH_POSITION` 或 `MANUAL`；預設 `MANUAL`。
- 若使用 look-through，LP token 不另作重複資產，底層份額與 impermanent-loss bridge 必須可重建。

### 3.6 Staking Deposit / Reward / Withdrawal

**事件代碼**：

- `STAKING_DEPOSIT`
- `STAKING_REWARD`
- `STAKING_WITHDRAWAL`

**Deposit/withdrawal**：若企業維持控制及 principal 權利，視流動與受限制子科目間轉換；若轉移控制、承擔 slashing、取得不同權利或 receipt token，需重新評估。

| 路徑 | Deposit/withdrawal | Reward |
|---|---|---|
| IFRS 成本模式 | 原 lot carrying amount 延續 | 於政策所定認列時點按 FV 認列資產及收入 |
| IFRS 重估模式 | 原 carrying amount/reserve 延續 | 初始按 FV 認列，後續納入重估 |
| US GAAP ASU 2023-08 | principal 若仍為同一 in-scope asset，按 FV 路徑延續 | reward 在取得控制時建立 acquisition cost，後續 FV through P&L |

Staking reward 的收入認列時點（產生、可 claim、實際 claim 或解除限制）依協議及準則判斷，沒有通用答案 `[需查證]`。PolicySet 必須指定：

- `reward_recognition_point`
- `reward_income_account`
- `slashing_treatment`
- `receipt_token_treatment`

**JE：將 carrying amount 8,000 的 SUI 委託 staking**

```text
Dr Staked Digital Asset                   8,000
    Cr Liquid Digital Asset                       8,000
```

**JE：取得控制時 reward FV 150**

```text
Dr Digital Asset — Reward                  150
    Cr Staking Income                              150
```

**JE：slashing 造成 carrying amount 減少 80**

```text
Dr Staking/Slashing Loss                    80
    Cr Staked Digital Asset                         80
```

是否將 slashing 視為處分、費用或估值變動由政策決定；ASU FV 路徑不得重複認列已包含於 FV 變動的損失。

### 3.7 Gas / Fees（交易手續費）

**事件代碼**：`GAS_FEE`

每筆 fee 必須關聯 `parent_event_id`；無法關聯者列一般 network expense。

| 路徑 | 預設 | 可選 |
|---|---|---|
| IFRS 成本模式 | 一般營運 gas 費用化 | 直接可歸屬於取得合資格資產時，依該資產準則資本化 `[需查證]` |
| IFRS 重估模式 | 同成本模式；資本化後納入 carrying amount | 不因後續重估而省略原始成本資料 |
| US GAAP ASU 2023-08 | 預設費用化，交易成本之具體處理依最新規範 `[需查證]` | 客戶政策不得違反 Codification |

**JE：以 SUI 支付 gas；交易時 FV 5、carrying amount 3**

```text
Dr Network Fee Expense                       5
    Cr Digital Asset — SUI                          3
    Cr Gain on Disposal                             2
```

**JE：符合資本化政策之 acquisition fee 5**

```text
Dr Acquired Asset                             5
    Cr Digital Asset / Payable                      5
```

Gas coin split/merge 是技術事件，不產生會計損益；只對實際消耗量建立 fee event。

### 3.8 Period-End Remeasurement / Impairment（期末重估／減損）

**事件代碼**：

- `PERIOD_END_REMEASUREMENT`
- `IMPAIRMENT`
- `IMPAIRMENT_REVERSAL`

#### IFRS 成本模式

資產維持成本減累計攤銷及減損（若適用）。無確定耐用年限之判斷、攤銷與 IAS 36 減損測試要求須依個案確認 `[需查證]`。

**減損 JE：carrying amount 1,000，可回收金額 700**

```text
Dr Impairment Loss                           300
    Cr Accumulated Impairment — Digital Asset      300
```

IFRS 下非 goodwill 資產在可回收金額回升時可能允許減損迴轉，但不得超過未認列減損時的帳面金額；適用條件須查核 `[需查證]`。

```text
Dr Accumulated Impairment — Digital Asset    120
    Cr Reversal of Impairment Gain                  120
```

#### IFRS 重估模式

重估須以同一 class of assets 一致處理，且頻率足以使帳面金額不重大偏離公允價值 `[需查證]`。

**首次上調 400**

```text
Dr Digital Asset Revaluation                 400
    Cr OCI — Revaluation Surplus                    400
```

**下調 500，已有 reserve 400**

```text
Dr OCI — Revaluation Surplus                 400
Dr Revaluation Loss — P&L                    100
    Cr Digital Asset Revaluation                    500
```

重估與 IAS 36 減損的交互順序、OCI/P&L reversal 順序須由專業政策核准 `[需查證]`。

#### US GAAP ASU 2023-08

in-scope asset 每個報導期按 FV 衡量，變動計入淨利；一般不另套舊式 indefinite-lived intangible impairment 模型 `[需查證]`。

**FV 由 1,000 升至 1,400**

```text
Dr Crypto Asset at Fair Value                400
    Cr Unrealized Gain — Crypto Assets              400
```

**FV 由 1,400 降至 900**

```text
Dr Unrealized Loss — Crypto Assets           500
    Cr Crypto Asset at Fair Value                    500
```

US GAAP 路徑沒有獨立「impairment reversal」事件；價格回升以當期 FV gain 表達。Out-of-scope 資產依其所屬 US GAAP 模型處理。

---

## 4. 成本基礎與 Lot Tracking

### 4.1 支援的成本方法

v1.0 支援：

- `FIFO`
- `WEIGHTED_AVERAGE_PERIODIC`
- `WEIGHTED_AVERAGE_MOVING`
- `SPECIFIC_IDENTIFICATION`

`LIFO`、`HIFO` 可作管理或稅務 ledger 選項，但不得作 IFRS book ledger 預設；IAS 2 允許 FIFO 或 weighted average，且禁止 LIFO。[來源: IAS Plus, IAS 2 Inventories summary] US GAAP book method 仍須依適用模型核准。首個 Paid Pilot 固定 FIFO。

成本方法設定層級：

`entity > book > accounting_class > asset_group > asset`

較細層級覆寫必須有核准理由。變更成本公式可能構成會計政策變更並涉及追溯適用 `[需查證]`。

### 4.2 Lot 模型需求

`PositionLot` 最少欄位：

```text
lot_id
entity_id
book_id
asset_id
source_event_id
acquisition_datetime
acquired_quantity
remaining_quantity
unit_cost_functional
total_cost_functional
acquisition_fv_functional
functional_currency
accounting_class
measurement_model
cost_basis_method
restricted_status
wrapper_or_underlying_ref
parent_lot_id
policy_version
status
```

另建 `LotMovement` 保存：

- acquisition、disposal、transfer、split、merge、wrap、unwrap、rebase、impairment、revaluation。
- movement 前後數量、成本、carrying amount 與 FV。
- event、rule、price、FX 及 JE line 的雙向連結。

### 4.3 Lot allocation 規則

1. 先排除 quarantined、customer asset 與不屬 entity 的數量。
2. Specific ID 必須在交易過帳前有可驗證指定；事後挑選須受控。
3. FIFO 依 acquisition datetime、block sequence、lot_id 穩定排序。
4. Moving WAC 每次取得後重算單位成本；periodic WAC 於期間結束計算。
5. 內部轉帳、CEX 存提及核准的 wrap/bridge 不建立新經濟 acquisition lot，只建立 child location lot。
6. Swap、付款與 fee 消耗 lot。
7. 正 rebase 預設按既有 lot 比例增加數量並調低單位成本；若政策認列收入，新增 reward lot。
8. 負 rebase 預設按比例減少數量，總 carrying amount 是否維持或認列損失由政策決定。

### 4.4 成本與公允價值雙軌

即使採 IFRS 重估或 ASU FV 模式，系統仍保存：

- historical acquisition cost
- current carrying amount
- cumulative FV/revaluation adjustment
- cumulative impairment
- tax basis（若另啟 tax book）

不得用當期 FV 覆寫原始 acquisition cost。這是 roll-forward、處分分析、稅務及披露的必要控制。

### 4.5 多幣別與功能性貨幣

每一事件可同時保存：

- `transaction_currency`
- `asset_unit`
- `price_currency`
- `functional_currency`
- `reporting_currency`

換算流程：

1. 取得 token 對 price currency 的價格。
2. 取得 price currency 對 functional currency 的 spot FX。
3. 產生 functional-currency measurement。
4. 報導時再由 functional currency 換至 reporting currency。

IFRS 下功能性貨幣判定及外幣交易依 IAS 21 處理；US GAAP 對 foreign currency matters 的對應規定須由客戶政策確認 `[需查證]`。

預設規則：

- 初始認列採交易日 spot rate；大量交易可否採近似平均率須依準則及波動程度核准 `[需查證]`。
- 貨幣性項目期末以 closing rate 換算；數位資產是否為貨幣性項目取決於取得固定或可決定貨幣單位之權利 `[需查證]`。
- 非貨幣性歷史成本項目保留交易日匯率。
- 非貨幣性公允價值項目使用公允價值衡量日匯率。
- 外幣兌換差額列 P&L 或 OCI 的位置，跟隨標的項目之衡量結果。
- 集團報表換算、國外營運及 CTA 屬 consolidation/reporting layer，不由單一 entity subledger 擅自過帳。

`FxRate` 必須記錄 source、timestamp、pair、rate type、bid/ask/mid、fallback、approval 與品質等級。

### 4.6 價格來源與估值控制

Price waterfall：

1. 交易本身的 observable execution price。
2. Entity 的 principal market。
3. 核准交易所或 oracle 的 executable/quoted price。
4. 多來源 median/VWAP。
5. 估值模型或人工輸入。

公允價值須符合 principal/most advantageous market、orderly transaction、valuation technique 及 hierarchy 等要求，具體 IFRS 13/ASC 820 適用需查核 `[需查證]`。

價格控制至少包含：

- stale threshold
- depeg threshold
- cross-source variance
- low-liquidity flag
- related-party market exclusion
- zero/negative price rejection
- price override approval

---

## 5. PolicySet 設計（會計政策集合）

### 5.1 PolicySet 欄位

以下 JSON Schema 是 active create/update contract；未列欄位一律拒絕。首個 Paid Pilot 另由 §5.6 profile 將可選值收窄。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://sui-agentic-subledger.example/schemas/policy-set-v3.json",
  "title": "PolicySetV3",
  "type": "object",
  "additionalProperties": false,
  "required": ["policy_set_id", "entity_id", "book_id", "version", "status", "effective_from", "accounting_standard", "functional_currency", "entity_timezone", "fiscal_calendar_id", "cost_basis_method", "price_waterfall_id", "fx_rate_policy_id", "asset_policy_ids", "event_policy_ids", "fee_policy_id", "internal_transfer_policy_id", "rounding_policy_id", "materiality_policy_id", "chart_of_accounts_mapping_version", "approval_workflow_id"],
  "properties": {
    "policy_set_id": {"type": "string", "minLength": 1},
    "entity_id": {"type": "string", "minLength": 1},
    "book_id": {"type": "string", "minLength": 1},
    "version": {"type": "integer", "minimum": 1},
    "status": {"enum": ["DRAFT", "APPROVED", "RETIRED"]},
    "effective_from": {"type": "string", "format": "date"},
    "effective_to": {"type": ["string", "null"], "format": "date"},
    "accounting_standard": {"enum": ["IFRS", "US_GAAP"]},
    "functional_currency": {"type": "string", "pattern": "^[A-Z]{3}$"},
    "reporting_currency": {"type": ["string", "null"], "pattern": "^[A-Z]{3}$"},
    "entity_timezone": {"type": "string"},
    "fiscal_calendar_id": {"type": "string"},
    "cost_basis_method": {"enum": ["FIFO", "WEIGHTED_AVERAGE_PERIODIC", "WEIGHTED_AVERAGE_MOVING", "SPECIFIC_IDENTIFICATION"]},
    "price_waterfall_id": {"type": "string"},
    "fx_rate_policy_id": {"type": "string"},
    "asset_policy_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "uniqueItems": true},
    "event_policy_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "uniqueItems": true},
    "asu_scope_policy_id": {"type": ["string", "null"]},
    "active_market_policy_id": {"type": ["string", "null"]},
    "impairment_policy_id": {"type": ["string", "null"]},
    "staking_policy_id": {"type": ["string", "null"]},
    "fee_policy_id": {"type": "string"},
    "bridge_wrap_policy_id": {"type": ["string", "null"]},
    "lp_token_policy_id": {"type": ["string", "null"]},
    "rebase_policy_id": {"type": ["string", "null"]},
    "airdrop_fork_policy_id": {"type": ["string", "null"]},
    "dust_spam_policy_id": {"type": ["string", "null"]},
    "internal_transfer_policy_id": {"type": "string"},
    "rounding_policy_id": {"type": "string"},
    "materiality_policy_id": {"type": "string"},
    "chart_of_accounts_mapping_version": {"type": "string"},
    "approval_workflow_id": {"type": "string"}
  }
}
```

人類可讀欄位清單：

```yaml
policy_set_id:
entity_id:
book_id:
version:
status: DRAFT | APPROVED | RETIRED
effective_from:
effective_to:
accounting_standard: IFRS | US_GAAP
functional_currency:
reporting_currency:
entity_timezone:
fiscal_calendar_id:
cost_basis_method:
price_waterfall_id:
fx_rate_policy_id:
asset_policy_ids:
event_policy_ids:
asu_scope_policy_id:
active_market_policy_id:
impairment_policy_id:
staking_policy_id:
fee_policy_id:
bridge_wrap_policy_id:
lp_token_policy_id:
rebase_policy_id:
airdrop_fork_policy_id:
dust_spam_policy_id:
internal_transfer_policy_id:
rounding_policy_id:
materiality_policy_id:
chart_of_accounts_mapping_version:
approval_workflow_id:
```

`accounting_standard` 是 book 層欄位；`measurement_path`、`stablecoin_treatment`、`default_token_classification`、`crypto_classification_default` 均不得出現在 active create/update payload 或持久化 active record。migration adapter 可讀取 legacy 欄位，轉換為 `AssetPolicy`／`StablecoinAssessment` candidate，輸出 migration exception 供人工核准後即丟棄 legacy 欄位；它們永遠不得成為 decision source。

### 5.2 AssetPolicy

每個 asset 至少設定：

- `accounting_class`
- `asu_2023_08_scope`
- `measurement_model`
- `scope_test_version`
- `out_of_scope_route`
- `cost_method_override`
- `fair_value_source`
- `active_market_conclusion`
- `useful_life_or_indefinite`
- `amortization_method`
- `impairment_indicator_set`
- `stablecoin_redemption_assessment`
- `presentation_account`
- `gain_loss_accounts`
- `disclosure_group`

若 asset/position 未設定或證據不足，事件停於 `POLICY_MISSING` 或 `PENDING_ACCOUNTING_REVIEW`。Stablecoin、wrapped token、LP token、staking receipt、issuer/related-party token 一律禁止依 default classification auto-post。

### 5.3 EventPolicy

每種 event_type 可配置：

- recognition point
- amount source
- debit/credit account templates
- fee capitalization
- gain/loss presentation
- lot consumption
- required evidence
- auto-approval threshold
- mandatory reviewer role
- disclosure tags

預設 `UNCLASSIFIED_CONTRACT_INTERACTION`、stablecoin、LP、fork、wrapped token、issuer/related-party token、staking/rebase、spam 與 scope unknown 不允許自動過帳，只能 `REVIEW_REQUIRED`；只有具有效 evidence、position assessment 與具名核准的 instrument policy 才可進入 posting workflow。

### 5.4 Policy Versioning

- 每次變更產生 immutable version。
- `APPROVED` 版本不得原地修改。
- JournalEntry 記錄完整 `policy_set_version`、`asset_policy_version`、`rule_version`。
- effective date 與 approval date 分離。
- 重跑歷史期間須選擇 `AS_WAS` 或 `AS_RESTATED`。
- restatement 不覆寫原 JE，須建立 reversal/replacement chain。
- 政策變更與估計變更的會計處理不同，分類須由核准人指定 `[需查證]`。

### 5.5 治理與職責分離

最低角色：

- `POLICY_AUTHOR`
- `ACCOUNTING_REVIEWER`
- `VALUATION_REVIEWER`
- `POSTING_APPROVER`
- `AUDITOR_READ_ONLY`
- `SYSTEM_ADMIN`

同一人不得同時建立並核准高風險政策；具體 SoD 規則由 entity 設定。AI 只能提出 classification、purpose、counterparty 與 exception 建議，不得單獨核准 PolicySet 或 posted JE。

### 5.6 Paid Pilot frozen profile

首個 Paid Pilot 固定為單一 IFRS book、成本模式、FIFO、單一功能性貨幣及僅 Sui wallet source。資產 universe 僅：

- SUI：`INTANGIBLE_IAS38_COST`；依 IFRIC 2019 routing 使用 IAS 38 成本模式。
- USDC：必須完成 Instrument／Issuer／Jurisdiction／Terms version 四層 `StablecoinAssessment`；在具名外部會計師核准結論前維持 `PENDING_ACCOUNTING_REVIEW`，不得進入任何 auto-post path。

Paid-pilot profile validation 必須拒絕 `accounting_standard != IFRS`、非 FIFO、非成本模式、未列資產、未列 event 或未達 `FIXTURE_APPROVED` 的 ADR dependency。

Accounting Decision Record 共用狀態機：

`DESIGN_BLOCKED → DECIDED → IMPLEMENTED → FIXTURE_APPROVED`

不得跳階或倒退覆寫；更正須建立新 ADR version。`DESIGN_BLOCKED` 或 `DECIDED` 時不得合併對應 auto-post rule；`IMPLEMENTED` 只允許 test environment；僅 `FIXTURE_APPROVED` 可在 Paid Pilot 啟用。每筆 ADR 必含 `owner`、`deadline`、`authoritative_sources[]`、`applicable_facts[]`、`test_case_ids[]`、decision、approver、effective period 與 supersedes。

8 項 Paid Pilot E1 記錄如下。

| ADR | Decision | Owner | 初始狀態 | Deadline | Authoritative source | 適用 facts | 必要 test case |
|---|---|---|---|---|---|---|---|
| `ADR-P1-001` | Reporting framework／policy pack | `TBD-BEFORE-CONTRACT (External Accounting Lead)` | `DESIGN_BLOCKED` | schema freeze 前 | IFRS Accounting Standards、IFRIC 2019 agenda decision | 單一 IFRS book、SUI／USDC | `GF-RCV-HAPPY`、`GF-PAY-HAPPY`、`GF-ITX-HAPPY`、`GF-SWP-HAPPY`、`GF-GAS-HAPPY` |
| `ADR-P1-002` | SUI 與 USDC scope/classification | `TBD-BEFORE-ASSETPOLICY (External Accounting Lead)` | `DESIGN_BLOCKED` | AssetPolicy 實作前 | IAS 38、IAS 2、IFRS 9、IFRIC 2019；USDC 合約／法律 memo | SUI 無底層 claim；USDC 四層 assessment facts | `GF-RCV-SCOPE`、`GF-SWP-SCOPE` |
| `ADR-P1-003` | Price／FX admissibility | `TBD-BEFORE-VALUATION (Valuation Reviewer)` | `DESIGN_BLOCKED` | valuation adapter 實作前 | IFRS 13、IAS 21、核准 valuation memo | principal market、timestamp、stale/outlier、price currency | `GF-RCV-MISSING-PXFX`、`GF-PAY-MISSING-PXFX`、`GF-ITX-MISSING-PXFX`、`GF-SWP-MISSING-PXFX`、`GF-GAS-MISSING-PXFX` |
| `ADR-P1-004` | Transaction cost／gas routing | `TBD-BEFORE-FEE-RULE (External Accounting Lead)` | `DESIGN_BLOCKED` | fee rule 實作前 | IAS 38 directly attributable cost guidance、核准 policy memo | payment、swap、gas purpose 與直接歸屬性 | `GF-PAY-HAPPY`、`GF-SWP-HAPPY`、`GF-GAS-HAPPY` |
| `ADR-P1-005` | IAS 36 impairment／reversal | `TBD-BEFORE-CLOSE-RULE (External Accounting Lead)` | `DESIGN_BLOCKED` | close rule 實作前 | IAS 36、IAS 38、核准 impairment memo | SUI indicator、recoverable amount、reversal ceiling | `GF-RCV-SCOPE` |
| `ADR-P1-006` | FX／functional currency | `TBD-BEFORE-FX-RULE (Valuation Reviewer)` | `DESIGN_BLOCKED` | FX rule 實作前 | IAS 21、核准 FX memo | 單一 functional currency；price/settlement currency 可不同 | `GF-RCV-MISSING-PXFX`、`GF-PAY-MISSING-PXFX`、`GF-ITX-MISSING-PXFX`、`GF-SWP-MISSING-PXFX`、`GF-GAS-MISSING-PXFX` |
| `ADR-P1-007` | 最小 presentation／DisclosureFact | `TBD-BEFORE-FIXTURE-APPROVAL (Pilot Controller)` | `DESIGN_BLOCKED` | fixture approval 前 | IAS 1、IAS 38、IAS 21、核准 disclosure memo | account mapping、gain/loss、lot roll-forward、materiality | `GF-RCV-HAPPY`、`GF-PAY-HAPPY`、`GF-ITX-HAPPY`、`GF-SWP-HAPPY`、`GF-GAS-HAPPY` |
| `ADR-P1-008` | CEX/custody rights model | `PRODUCT-ACCOUNTING-LEAD (Capability Gate Owner)` | `DECIDED`：排除 Paid Pilot | capability matrix freeze 時 | 客戶 source inventory、合約權利分析 | Paid Pilot 僅指定 Sui wallets | `GF-ITX-SCOPE` |

Pilot 外 E1：staking、bridge/wrap、LP、fork、rebase、IFRS 重估、IAS 2 broker-trader、cost formula change 與 cash-flow classification 一律維持獨立 ADR `DESIGN_BLOCKED`；解除前不得建立或啟用 auto-post path。

---

## 6. 規則引擎介面與行為（Accounting Rules Engine）

### 6.1 輸入

```json
{
  "run_context": {
    "run_id": "uuid",
    "entity_id": "entity",
    "book_id": "book",
    "period_id": "2026-06",
    "mode": "PREVIEW|POST|REPLAY",
    "as_of": "timestamp"
  },
  "event": "NormalizedEvent",
  "policy_set": "ResolvedPolicySet",
  "asset_assessment": "ClassificationAssessment",
  "lots": ["PositionLot"],
  "prices": ["PricePoint"],
  "fx_rates": ["FxRate"],
  "coa_mapping": "ChartOfAccountsMapping"
}
```

輸入須具 schema version。缺少政策、價格、匯率、lot 或核准證據時，禁止以零值猜測。

### 6.2 輸出

```json
{
  "decision": "POSTABLE|REVIEW_REQUIRED|REJECTED",
  "assessment": {
    "event_type": "SPOT_TRADE_SWAP",
    "accounting_class": "INTANGIBLE_IAS38_COST",
    "measurement_model": "IAS38_COST"
  },
  "measurements": [],
  "lot_movements": [],
  "journal_entries": [],
  "disclosure_facts": [],
  "exceptions": [],
  "explanation": {
    "rule_ids": [],
    "policy_versions": [],
    "price_refs": [],
    "fx_refs": []
  }
}
```

所有金額使用 decimal，不使用 binary floating point。每一 JE 必須：

- 借貸平衡至 functional currency 最小單位。
- 保留原幣、數量、價格與匯率。
- 指向 event、lot movement、rule 與 policy。
- 具 deterministic idempotency key。

### 6.3 規則執行階段

1. Schema validation。
2. Ownership/entity boundary。
3. Event classification。
4. Asset classification/scope。
5. Recognition gate。
6. Price/FX resolution。
7. Lot allocation。
8. Measurement。
9. MappingRule。
10. JE balancing/rounding。
11. DisclosureFact generation。
12. Validation and approval routing。

先執行 reject/stop rule，再執行 specific rule，最後才是 default rule。規則衝突不得以任意順序解決，須回傳 `RULE_CONFLICT`。

### 6.4 規則類型

- `ClassificationRule`
- `RecognitionRule`
- `MeasurementRule`
- `LotAllocationRule`
- `MappingRule`
- `PresentationRule`
- `DisclosureRule`
- `ValidationRule`
- `ApprovalRule`

規則資料示例：

```json
{
  "rule_id": "swap-ifrs-cost-v1",
  "priority": 200,
  "effective_from": "2026-01-01",
  "when": {
    "event_type": "SPOT_TRADE_SWAP",
    "measurement_model": "IAS38_COST",
    "review_status": "APPROVED"
  },
  "actions": [
    {"type": "ALLOCATE_LOTS", "method": "$policy.cost_basis_method"},
    {"type": "MEASURE", "name": "consideration_fv", "source": "approved_price"},
    {"type": "CREATE_ACQUISITION_LOT", "amount": "$consideration_fv"},
    {"type": "CREATE_JE", "template": "SWAP_DISPOSAL_ACQUISITION"}
  ],
  "on_missing": "REVIEW_REQUIRED"
}
```

### 6.5 錯誤與例外

標準 exception codes：

- `POLICY_MISSING`
- `ASSET_CLASS_UNKNOWN`
- `ASU_SCOPE_UNKNOWN`
- `PRICE_MISSING_OR_STALE`
- `FX_MISSING_OR_STALE`
- `INSUFFICIENT_LOTS`
- `NEGATIVE_POSITION`
- `TRANSFER_UNMATCHED`
- `RULE_CONFLICT`
- `DUPLICATE_EVENT`
- `FINALITY_PENDING`
- `PERIOD_CLOSED`
- `SPAM_OR_DUST`
- `MANUAL_VALUATION_REQUIRED`
- `JE_OUT_OF_BALANCE`

例外不可用「miscellaneous gain/loss」自動平衡。rounding account 僅可處理政策門檻內的純小數差。

### 6.6 Replay、冪等與沖銷

- 相同 input hash、policy/rule/price/FX versions 應產生相同 output。
- `POST` 前可多次 `PREVIEW`，不得修改 lot。
- 已 posted event 再次收到時回傳既有結果。
- 鏈重組、CEX correction 或 parser upgrade 以 reversal + replacement 處理。
- period close 後 replay 需有 reopen 或 next-period adjustment 授權。

### 6.7 與資料模型及 ERP 的契約

系統延續首版資料模型的核心實體：

- `Entity`
- `AccountSource`
- `RawTransaction`
- `NormalizedEvent`
- `PositionLot`
- `PricePoint`
- `PolicySet`
- `MappingRule`
- `JournalEntry`
- `ReconciliationRecord`

v1.0 新增 `ClassificationAssessment`、`MeasurementResult`、`LotMovement`、`FxRate`、`DisclosureFact` 與 `RuleExecutionLog`。

ERP 匯出以 header + lines + dimensions 表示。ERP/GL 是正式總帳 system of record。MVP generic CSV 無 API 回傳時，使用者必須上傳 ERP import report 或輸入 ERP batch/JE ID、匯入人與時間完成 manual acknowledgement；未 acknowledgement 不得標記 `POSTED`。

| Current state | Event | Guard | Next state | Required audit fields |
|---|---|---|---|---|
| `APPROVED` | create export batch | period open、debit=credit、dimensions complete、idempotency key unused | `EXPORTED` | export batch ID、file hash、mapping version、actor、timestamp |
| `APPROVED` | pre-export reject | reviewer reason present | `REJECTED` | reject code/reason、actor、timestamp |
| `EXPORTED` | upload/import acknowledgement | import report 或 ERP batch/JE ID 完整；全部 lines accepted | `ACKNOWLEDGED` | evidence hash、ERP IDs、importer、import time、line statuses |
| `EXPORTED` | transport/schema reject | 未被 ERP 接受 | `REJECTED` | ERP error payload/hash、reject code、actor、timestamp |
| `EXPORTED` | partial acceptance | 至少一 line accepted、至少一 line rejected | `REJECTED`（header）＋ line-level accepted/rejected | 每 line ERP ID、status、reason；accepted subset hash；remediation link |
| `ACKNOWLEDGED` | confirm ERP posted | ERP posting evidence matches full batch | `POSTED` | ERP posting ID/date、evidence hash、confirmer |
| `ACKNOWLEDGED` | ERP rejects after ack | ERP 後續拒絕、void 或 validation failure，且尚未 posted | `REJECTED` | prior acknowledgement ref、ERP rejection evidence、reason、actor |
| `POSTED` | approved correction | reversal approval、period/reopen policy satisfied | `REVERSED` | reversal JE ID、reason、approvers、effective date |
| `REJECTED` | remediate | 原 batch immutable；建立新 replacement version | `APPROVED`（replacement） | predecessor ID、changed fields、new idempotency key、approver |

Partial rejection 不得把 accepted lines 重送。系統凍結原 batch，對 ERP 已接受 lines 建立 acknowledgement evidence；拒絕 lines 以新 replacement batch 重走流程。若 ERP 不允許不平衡的 line subset，必須在 ERP void 已接受 subset 後附 void evidence，再整批 replacement。`POSTED` 永不轉 `REJECTED`。

---

## 7. 事件級 JE fixtures

每個 fixture 必須附 `facts`、`scope conclusion`、`measurement calculation`、`lot movement`、`citation` 與 expected disclosure。缺一者不得成為 golden test；JE 平衡不代表會計正確。

### 7.1 穩定幣收款

Facts：收到 10,000 USDC units 清償 carrying amount 10,000 的 AR；可支持 FV 為 9,980，但 20 的差額原因未知。結果：`REVIEW_REQUIRED`，不得使用 `Settlement Difference` 或 miscellaneous catch-all，不產生 JE。補齊合約後，才可選 contractual discount、credit loss、FX 或其他具體模板。

- Scope：先完成 instrument/issuer/jurisdiction/terms-version assessment；不得假設為 cash 或 ASU in-scope。
- Measurement：差額性質未核准，無 measurement result。
- Lot：只建立 candidate acquisition，不建立正式 lot。
- Citation：crypto 一般不符合 IAS 7 現金/現金等價物特徵。[來源: https://www.iasplus.com/en/meeting-notes/ifrs-ic/2019/june/holdings-of-cryptocurrencies]

### 7.2 Swap：100 SUI 換 USDC

Facts：SUI carrying amount 200，收到 USDC FV 300。SUI 與 USDC 必須分別完成 position scope test；USDC scope unknown 時整筆為 `REVIEW_REQUIRED`。若兩者模型已核准，IFRS IAS 38 cost fixture 為：

```text
Dr Asset — USDC                              300
    Cr Asset — SUI                                  200
    Cr Disposal Gain                                100
```

- Measurement：使用可支持 execution price 300，價格/FX 不得缺省為 1。
- Lot：SUI 依 FIFO 消耗；USDC 依 resolved model 建 lot。
- Citation：ASU scope 六條件及 out-of-scope routing。[來源: https://dart.deloitte.com/USDART/home/codification/assets/asc350-60/roadmap-digital-assets/chapter-2-classification/2-3-crypto-assets-within-scope]

### 7.3 Staking reward

Facts：50 SUI reward candidate、控制時候選 FV 150、期末市場報價 120。預設 `REVIEW_REQUIRED`，不自動認 staking income。只有協議權利、控制時點、限制及 recognition memo 核准後才建立 reward lot 與 JE。

- IFRS impairment：市場報價下降不等於 IAS 36 impairment。必須先計算 recoverable amount；只有核准結論為 120 時，才可認 impairment 30。
- Lot：核准認列前只保留 pending quantity。
- Citation：IFRIC cryptocurrency classification routing。[來源: https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2019/holdings-of-cryptocurrencies-june-2019.pdf]

### 7.4 ASU 2023-08 期末 FV

Facts：已證明 in-scope position，期初 carrying amount 1,000、期末 approved FV 1,400。

```text
Dr Crypto Asset at Fair Value                 400
    Cr Fair Value Gain — Crypto Assets               400
```

- Scope：六項條件全為 true 且 evidence 有效。
- Measurement：approved period-end FV；保留 historical acquisition cost。
- Lot：不改 quantity，新增 FV adjustment movement。
- Citation：FV through net income、分開列報、重大持有與年度 roll-forward 揭露。[來源: https://dart.deloitte.com/USDART/home/codification/assets/asc350-60/roadmap-digital-assets/chapter-6-presentation-disclosure/6-3-disclosures-about-crypto-assets]

### 7.5 Bridge/wrapped 與 fee

Facts：原生 token carrying amount 2,000，1:1 wrap 且 rights-continuity memo 已核准；fee FV 10，以 carrying amount 7 的 token 支付。

```text
Dr Wrapped Digital Asset                    2,000
    Cr Native Digital Asset                        2,000

Dr Bridge Fee Expense                          10
    Cr Digital Asset — fee token                       7
    Cr Gain on Disposal of Digital Asset               3
```

- Scope：權利實質改變或 evidence 不足時 `REVIEW_REQUIRED`，改評 disposal/acquisition。
- Lot：principal child lot 延續；fee token 依 FIFO 消耗。
- Citation：對底層有可執行權利的 wrapped token通常排除於 ASU scope。[來源: https://www.grantthornton.com/insights/articles/audit/2023/snapshot/december/clarifies-accounting-for-certain-crypto-assets]

### 7.6 Fork、rebase 與 LP

- Fork：只建立 candidate quantity/price；預設 `REVIEW_REQUIRED`，不得自動認收入或建立正式 lot。
- Rebase：預設只做 quantity movement，總 carrying amount 不變；收入路徑須證明新增經濟資源並附核准 citation。
- LP：預設 `REVIEW_REQUIRED`；權利性質、交易成本、估值可靠性與 disposal/acquisition 或 look-through 模型核准前，不得套通用 JE。

三者的 fixture citation 均來自客戶具名專業政策 memo；不得假造跨準則通用結論。

### 7.7 Dust/spam

建立 raw/event/quarantine quantity；不取價、不互動、不產生 JE。白名單、控制及價值確認後才可轉正式資產。

### 7.8 Paid Pilot executable golden fixtures

以下金額均為功能性貨幣。共同 lineage hash inputs 為 `raw_payload_hash + tx_digest + event_index + parser_version + normalization_version + policy_set_version + asset_policy_version + event_policy_version + rule_version + price_point_ids + fx_rate_ids + lot_ids + approval_ids + prior_je_id`；不適用欄位以明確 `null` 參與 canonical serialization。每筆 fixture 均驗證 debit total = credit total；`—` 代表不得產生 JE。共同準則 citation：SUI 採 IFRIC 2019 指向 IAS 38 的成本模式；FX 採 IAS 21；減損採 IAS 36；USDC 結論另須 `ADR-P1-002` 的具名四層 assessment memo。

#### 7.8.1 `DIGITAL_ASSET_RECEIPT`

Happy facts：客戶以 100 SUI 清償 AR；approved transaction-date FV 300；SUI classification 已核准。

| Fixture | Expected JE（Dr = Cr） | Lot roll-forward | DisclosureFact | Exception／replay | Citation |
|---|---|---|---|---|---|
| `GF-RCV-HAPPY` | Dr SUI asset 300 / Cr AR 300 | + lot R1: 100 units, cost 300 | acquisition 100 units/cost 300；non-cash settlement tag | none | IFRIC 2019、IAS 38、ADR-P1-007 |
| `GF-RCV-SCOPE` | — | candidate quantity only | pending asset-classification fact | `SCOPE_UNKNOWN` | IFRIC 2019、ADR-P1-002 |
| `GF-RCV-MISSING-PXFX` | — | no formal lot | missing valuation fact | `PRICE_MISSING` 或 `FX_MISSING` | IFRS 13、IAS 21、ADR-P1-003/006 |
| `GF-RCV-INSUFFICIENT-LOT` | 同 happy；receipt 不消耗 lot | +R1；驗證此 permutation 不誤報 lot shortage | 同 happy | none；assert no `INSUFFICIENT_LOT` | IAS 38、ADR-P1-007 |
| `GF-RCV-REPLAY-REVERSAL` | replay 回傳原 JE；核准 reversal：Dr AR 300 / Cr SUI asset 300 | replay 0 movement；reversal -100 units/-300 cost | reversal link、reason、prior JE | `IDEMPOTENT_REPLAY`；reversal lineage 含 prior JE | IAS 8 controlled correction policy、ADR-P1-007 |

#### 7.8.2 `DIGITAL_ASSET_PAYMENT`

Happy facts：支付 20 SUI 取得服務 FV 80；FIFO lot carrying amount 50。

| Fixture | Expected JE（Dr = Cr） | Lot roll-forward | DisclosureFact | Exception／replay | Citation |
|---|---|---|---|---|---|
| `GF-PAY-HAPPY` | Dr service expense 80 / Cr SUI asset 50 / Cr disposal gain 30 | FIFO -20 units/-50 cost | disposal proceeds 80、cost 50、gain 30 | none | IAS 38 derecognition、ADR-P1-004/007 |
| `GF-PAY-SCOPE` | — | no consumption | pending classification fact | `SCOPE_UNKNOWN` | IFRIC 2019、ADR-P1-002 |
| `GF-PAY-MISSING-PXFX` | — | no consumption | missing valuation fact | `PRICE_MISSING` 或 `FX_MISSING` | IFRS 13、IAS 21 |
| `GF-PAY-INSUFFICIENT-LOT` | — | available lot unchanged；shortfall recorded | quantity shortfall fact | `INSUFFICIENT_LOT` | approved FIFO policy、ADR-P1-001 |
| `GF-PAY-REPLAY-REVERSAL` | replay 原 JE；reversal：Dr SUI asset 50 / Dr disposal gain 30 / Cr service expense 80 | replay 0；reversal +20 units/+50 original lot lineage | reversal fact | `IDEMPOTENT_REPLAY` | IAS 8 controlled correction policy |

#### 7.8.3 `INTERNAL_TRANSFER`

Happy facts：同一 beneficial owner 的 wallet A 移轉 40 SUI 至 wallet B；carrying amount 120；gas 另由 `GAS_FEE` event 處理。

| Fixture | Expected JE（Dr = Cr） | Lot roll-forward | DisclosureFact | Exception／replay | Citation |
|---|---|---|---|---|---|
| `GF-ITX-HAPPY` | Dr SUI—wallet B 120 / Cr SUI—wallet A 120（若 GL 不分 wallet，產生 zero-value subledger movement 而非 JE） | lot location A→B；units/cost 不變 | internal transfer、no gain/loss | none | IAS 38 carrying amount continuity、approved ownership evidence |
| `GF-ITX-SCOPE` | — | unmatched candidate only | ownership unresolved | `OWNERSHIP_UNRESOLVED` | ADR-P1-002 |
| `GF-ITX-MISSING-PXFX` | Dr/Cr 120 以既有 carrying amount；不要求新 price/FX | location A→B | assert valuation-independent | none；assert no missing-price exception | IAS 38 cost model |
| `GF-ITX-INSUFFICIENT-LOT` | — | source unchanged；shortfall recorded | quantity shortfall fact | `INSUFFICIENT_LOT` | approved FIFO/lot continuity policy |
| `GF-ITX-REPLAY-REVERSAL` | replay 原結果；reversal Dr A 120 / Cr B 120 | replay 0；B→A | reversal fact | `IDEMPOTENT_REPLAY` | controlled correction policy |

#### 7.8.4 `SPOT_TRADE_SWAP`

Happy facts：以 100 SUI（FIFO carrying amount 200）換得 300 USDC；USDC 四層 assessment 已 `FIXTURE_APPROVED`。

| Fixture | Expected JE（Dr = Cr） | Lot roll-forward | DisclosureFact | Exception／replay | Citation |
|---|---|---|---|---|---|
| `GF-SWP-HAPPY` | Dr USDC asset 300 / Cr SUI asset 200 / Cr disposal gain 100 | SUI -100/-200；USDC +300 units/+300 cost | SUI disposal、USDC acquisition、gain 100 | none | IAS 38、USDC approved memo、ADR-P1-004 |
| `GF-SWP-SCOPE` | — | candidate USDC only；SUI unchanged | pending USDC classification | `SCOPE_UNKNOWN` | StablecoinAssessment、ADR-P1-002 |
| `GF-SWP-MISSING-PXFX` | — | no movement | missing valuation fact | `PRICE_MISSING` 或 `FX_MISSING` | IFRS 13、IAS 21 |
| `GF-SWP-INSUFFICIENT-LOT` | — | both positions unchanged | SUI shortfall fact | `INSUFFICIENT_LOT` | FIFO policy |
| `GF-SWP-REPLAY-REVERSAL` | replay 原 JE；reversal Dr SUI 200 / Dr gain 100 / Cr USDC 300 | replay 0；restore consumed SUI lineage、remove USDC lot | reversal fact | `IDEMPOTENT_REPLAY` | controlled correction policy |

#### 7.8.5 `GAS_FEE`

Happy facts：消耗 2 SUI gas；transaction-date FV 8；FIFO carrying amount 5；ADR-P1-004 結論為一般營運 gas 費用化。

| Fixture | Expected JE（Dr = Cr） | Lot roll-forward | DisclosureFact | Exception／replay | Citation |
|---|---|---|---|---|---|
| `GF-GAS-HAPPY` | Dr network fee expense 8 / Cr SUI asset 5 / Cr disposal gain 3 | FIFO -2/-5 | fee expense 8、disposal gain 3 | none | IAS 38 derecognition、ADR-P1-004 |
| `GF-GAS-SCOPE` | — | no consumption | fee purpose/classification pending | `SCOPE_UNKNOWN` | ADR-P1-002/004 |
| `GF-GAS-MISSING-PXFX` | — | no consumption | missing valuation fact | `PRICE_MISSING` 或 `FX_MISSING` | IFRS 13、IAS 21 |
| `GF-GAS-INSUFFICIENT-LOT` | — | source unchanged | quantity shortfall fact | `INSUFFICIENT_LOT` | FIFO policy |
| `GF-GAS-REPLAY-REVERSAL` | replay 原 JE；reversal Dr SUI 5 / Dr disposal gain 3 / Cr network fee expense 8 | replay 0；restore 2 units/5 cost | reversal fact | `IDEMPOTENT_REPLAY` | controlled correction policy |

Golden runner 另須斷言：每列 lineage hash 使用本節共同 inputs；exception fixture 不建立正式 lot、不變更 JE/export state；reversal 永不覆寫原 JE。只有對應 ADR 到達 `FIXTURE_APPROVED`，上述 happy path 才可列為可執行 auto-post candidate。

---

## 8. 披露與報表支援

### 8.1 核心報表

系統至少輸出：

- Digital asset trial balance。
- Holdings by asset/source/wallet/restriction。
- Historical cost、carrying amount、FV 與 unrealized adjustment。
- Realized gain/loss by event、asset、lot。
- Staking principal/reward/slashing。
- Fees by protocol、purpose、capitalized/expensed。
- Transfer-in-transit 與 unmatched transfers。
- Impairment/reversal/revaluation roll-forward。
- ASU 2023-08 crypto asset roll-forward。
- Price/FX source and override report。
- Reconciliation and exception aging。
- ERP posting status and rejected journals。

### 8.2 IFRS 支援資料

依分類輸出：

- IAS 38：成本或重估模式、gross carrying amount、累計攤銷/減損、revaluation reserve、期間變動。
- IAS 2：cost formula、write-down/reversal、broker-trader FVLCTS 資料。
- IFRS 9：金融資產分類、衡量、信用風險與 FV 資料。
- IFRS 13：估值技術、inputs、fair-value hierarchy 與 transfers。
- IAS 21：交易日匯率、closing rate、FX differences。

上述每一披露欄位的法定要求、彙總層級與比較期間須依最新版準則查核 `[需查證]`。

### 8.3 US GAAP ASU 2023-08 支援資料

按重要資產或要求之彙總層級提供：

- name、units、cost basis、fair value。
- additions、disposals、gains、losses。
- restrictions。
- cost basis method。
- income statement 中 gains/losses 的位置。
- in-scope 與 out-of-scope 資產分離。

ASU 2023-08 要求 in-scope crypto assets 與其他 intangible assets 分開列報，crypto gains/losses 與其他 intangible changes 分開列報，並提供重大持有及年度 roll-forward 等揭露。[來源: Deloitte Roadmap ASC 350-60 ch. 6] 本 Paid Pilot 採 IFRS，這些欄位只保留為 Post-pilot schema compatibility。

### 8.4 三大報表與 ERP mapping

**資產負債表**

- 數位資產依 current/non-current、classification 與準則要求映射。
- 客戶代管資產與企業自有資產分離。
- Transfer-in-transit、restricted/staked、CEX claim 可單獨揭露。

**損益表**

- realized disposal gain/loss。
- FV gain/loss。
- impairment/reversal。
- staking/reward income。
- network/protocol fees。
- revaluation P&L component。

**現金流量表**

數位資產交易是否構成 cash flow，以及非現金交換如何揭露，取決於資產是否為 cash/cash equivalent 與交易性質 `[需查證]`。系統提供 event-level cash-flow tags，但不在無核准政策時自動決定 operating/investing/financing。

### 8.5 DisclosureFact 模型

```text
fact_id
entity_id
period_id
standard
disclosure_topic
asset_id
accounting_class
amount_functional
amount_reporting
quantity
unit
dimension_set
source_event_ids
source_je_line_ids
policy_version
calculation_version
evidence_refs
```

所有披露數字應能 drill down 至 JE、event、lot、price/FX 與 raw transaction。

### 8.6 對帳與關帳控制

關帳前必須通過：

- 鏈上/CEX/custodian quantity 對 subledger quantity。
- subledger carrying amount 對 GL。
- negative lot、orphan event、unmatched transfer、stale price、missing FX 檢查。
- 所有 material exceptions 已核准或調整。
- PolicySet 與 rule versions 鎖定。
- 內部 immutable manifest 與報表 hash 建立。

Walrus 僅為 optional asynchronous publication，不是 accounting close dependency；失敗時進 publication retry queue，不影響內部 close。敏感資料不得以明文公開，只能使用最小 manifest/hash 或經核准的加密封裝。其保留、刪除、金鑰與法律證據效力列入 Validation Backlog。

### 8.7 競品與市場一致性

市場上的 crypto subledger 通常提供多來源匯入、transaction categorization、cost basis、reconciliation、ERP export 與 audit trail；各競品目前實際支援鏈、準則、DeFi protocol、AI 覆核及 ERP connector 的範圍會持續變動，任何比較聲明均須於對外使用前查證 `[需查證]`。

本產品 v1.0 的差異化設計為：

- Sui object/event-aware normalization。
- 規則與 PolicySet 版本化。
- 同一事件三條會計衡量路徑。
- lot、價格、FX、JE、披露的完整 lineage。
- AI 建議與 deterministic accounting engine 分離。
- 可驗證的關帳快照與 ERP 子分類帳定位。

---

## 9. 原則總結（供設計與實作參考）

1. **先判定帳務主體與控制，再分類資產。**
2. **先分類事件，再認列、衡量、分配 lot 與產生分錄。**
3. **每個 asset position 必須解析為唯一 measurement model；同一 book 可並存多模型。**
4. **穩定幣、wrapped token、bridge、LP token、rebase、fork 與 staking receipt 不得只依 token 名稱判斷。**
5. **原始資料不可變；所有衍生結果可重跑、可解釋、可追溯。**
6. **historical cost、carrying amount、FV、tax basis 分欄保存。**
7. **內部轉帳不重設成本，不產生處分損益；fee 另行處理。**
8. **價格與 FX 不可缺省為 1；缺資料即停單或人工覆核。**
9. **AI 不直接決定最終會計政策或 posted JE。**
10. **例外不得透過 miscellaneous account 隱藏。**
11. **政策、規則、價格、匯率及 COA mapping 全部版本化。**
12. **ERP/GL 為正式總帳，本系統為可驗證且可重建的數位資產子分類帳。**
13. **披露不是期末補算；事件與分錄生成時即同步產生 DisclosureFact。**
14. **準則條文、生效日期、法律權利與競品能力在對外承諾前必須查證。**

---

## 附錄 A：模型摘要（event code 以第 3 章 registry 為準）

| Event type | IFRS 成本模式 | IFRS 重估模式 | US GAAP ASU 2023-08 |
|---|---|---|---|
| Receipt | 初始成本；後續成本減減損 | 初始成本；後續合資格重估 | in-scope 後續 FV through P&L |
| Payment | 按 lot carrying amount 除帳並認處分損益 | 按重估 carrying amount 除帳；處理 reserve | 先更新交易日 FV，再終止認列 |
| Internal transfer | lot/cost 延續 | carrying amount/reserve 延續 | FV carrying amount 延續 |
| CEX deposit/withdrawal | 原權利未變則延續 | 同左；納入限制估值 | 同一 crypto asset 才延續 |
| Spot trade/swap | disposal + acquisition | disposal + acquisition；處理 reserve | FV update + exchange，不重複損益 |
| Staking | principal 延續；reward 初始認列 | principal/reserve 延續；reward 後續重估 | principal/reward 按 FV 路徑 |
| Gas/fees | 費用化或合資格資本化 | 同左 | 依 Codification 政策，預設費用化 |
| Period-end | impairment/reversal | OCI/P&L revaluation waterfall | FV gain/loss in P&L |

## 附錄 B：實作驗收條件

- Canonical registry 內的 paid-pilot events 均有按 facts permutation 建立的 golden tests。
- 每個測試驗證 JE 平衡、lot movement、DisclosureFact 與 lineage。
- edge cases 至少涵蓋 airdrop/空投、bridge、wrapped token、dust/spam、fork、rebase、LP token、impairment reversal。
- 多幣別測試至少涵蓋 price currency ≠ functional currency ≠ reporting currency。
- 缺價格、缺 FX、scope unknown、insufficient lot、unmatched transfer 必須 fail closed。
- replay 相同輸入產生相同結果。
- policy/rule version 變更不覆寫歷史結果。
- posted JE correction 只能 reversal/replacement。
- ERP rejection 不得改為 posted。
- 會改變 schema、JE、lot、valuation、DisclosureFact 或 control 的 E1 必須在對應 rule 開發前進入 ADR，並於啟用前達 `FIXTURE_APPROVED`；其他 `[需查證]` 項目在相關能力對外承諾前納入 sign-off checklist。

## 附錄 C：Open Decisions Register

| Decision | Owner | Deadline | Decision criteria |
|---|---|---|---|
| Pricing/FX provider | Product + Valuation Reviewer | paid pilot 前 6 週 | 30 日 Sui 資產 coverage、歷史深度、授權、SLA、成本、fallback |
| 首個 ERP template | Product + Pilot Controller | pilot 簽約後 2 週 | 客戶實際 ERP、CSV import 規格、manual acknowledgement 與防重複能力 |
| 政策審查機制 | Accounting Lead | 第一個 PolicySet 啟用前 | 具名專業 reviewer、citation、golden fixtures、SoD、版本生效與責任界線 |
| Walrus 策略 | Security + Legal | production go/no-go 前 | 僅 hash 或加密包、金鑰/刪除/retention、審計師接受度、法律證據效力 |

## 附錄 D：Validation Backlog

| 驗證項 | 所需 evidence | Gate |
|---|---|---|
| Pricing/FX coverage | 30 日資產樣本、缺價率、stale/outlier、授權與每客戶 COGS | paid pilot |
| 競品實測 | 同一 Sui fixture 比較 parser coverage、錯誤率、close 工時、導入時間 | positioning claim |
| Walrus 法律/治理 | 客戶、審計師、法律意見；retention/deletion/key recovery | production publication |
| SOC 2/資料駐留 | 3 個目標客戶 security questionnaire、DPA 與區域要求 | enterprise roadmap |
| 準則未決項 | Accounting Decision Record：source、facts、owner、reviewer、tests | 對應模型啟用 |
