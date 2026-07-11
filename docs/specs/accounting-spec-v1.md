# 會計技術規格書 v1.0

版本：v1.0　日期：2026-07-11　狀態：Draft

> 本冊詞彙一律以商業規格書（`docs/specs/business-spec-v1.md`）附錄 B 詞彙表為準；分期標記（MVP/P1/P2）一律引用商業冊 §7（唯一權威版），本冊不重定義分期。
>
> 免責：本規格提供可設定的會計政策引擎與分錄邏輯，不構成專業會計意見。準則之最終適用、資產分類與政策選擇，須由 Entity 與其會計師/審計師確認。凡標註「由 entity 與其會計師確認」者，為政策開放點，非未完成項。

## §1 準則範圍

### §1.1 雙軌準則框架

本系統以 PolicySet 欄位 `accounting_standard` 切換兩大會計框架的政策模板，兩軌並存、互不混用（見商業冊附錄 B「PolicySet」；同一 Entity 同一期間僅適用一軌）：

- **IFRS 軌**：主要參考
  - **IAS 38 Intangible Assets（無形資產）**——非於正常營業過程中為出售而持有之數位資產的預設分類；
  - **IAS 2 Inventories（存貨）**——為出售而持有或 broker-trader 角色持有者；
  - **IFRS 9 Financial Instruments（金融工具）**——符合金融資產定義者（如具可執行贖回權之穩定幣）；
  - **IFRS 13 Fair Value Measurement（公允價值衡量）**——公允價值層級（level 1/2/3）與衡量技術；
  - 併參 IFRS Interpretations Committee 對「持有加密貨幣（Holdings of Cryptocurrencies）」之 2019 年 6 月議程決議（結論為多落入 IAS 2 或 IAS 38，加密資產本身非 IAS 32 金融工具、亦非 IAS 7 現金）。
- **US GAAP 軌**：
  - **ASU 2023-08（Intangibles—Goodwill and Other—Crypto Assets, Subtopic 350-60）**——落入其範圍之 crypto assets 一律以公允價值衡量、變動計入當期損益（fair value through net income），並於報表單獨列示、附 roll-forward 揭露；
  - 範圍外之數位資產仍沿用既有無形資產框架（ASC 350-30，成本減減損、減損不可迴轉）。

系統角色：提供可設定的政策引擎與分錄邏輯，讓企業在與會計師溝通後把既定政策落為規則，系統不替企業作最終專業判斷。

### §1.2 ASU 2023-08 範圍六項判準

US GAAP 軌下，須對每種 token 標記是否落入 ASU 2023-08 範圍，全部滿足下列六項才適用 FV through P&L：

1. 符合無形資產（intangible asset）定義；
2. 不賦予持有人對基礎商品/資產的可執行權利（no enforceable rights to underlying goods/services/assets）；
3. 存在於分散式帳本（distributed ledger）上；
4. 以密碼學保護（cryptographically secured）；
5. 可互換（fungible）；
6. 非由報導企業或其關係人發行（not created/issued by the reporting entity or its related parties）。

是否滿足以上六項（尤其第 2、6 項，例如具贖回權之穩定幣或自行發行代幣）由 entity 與其會計師確認；系統僅提供 `asu_2023_08_applies`（per asset）標記欄位承載該判斷結果。

### §1.3 Functional / Reporting Currency 範圍（引用商業冊 §6 D15）

MVP 限單一 functional currency = USD（D15，見商業冊 §6 非目標第 5 條與附錄 B）。多幣別換算（IAS 21 / ASC 830）列 P1（目標市場台灣/日本/香港/韓國）。架構接口三則（權威文字見商業冊 §6，本冊不重述）：幣別換算集中於 rules engine 之 Price/FX lookup 階段且可插拔；`functional_currency` 僅存於 PolicySet 欄位、禁 USD 硬編碼散落；JournalEntry Lines 保留 `currency` / `fx_rate` 欄位，MVP 恆為 `USD` / `1.0` 亦不省略。

## §2 資產分類模型

### §2.1 兩層分類：technical_type × accounting_class

系統對每種資產採兩層分類。**technical_type** 為技術/協議屬性（客觀，可由資料判定）；**accounting_class** 為會計衡量分類（政策決定，由 PolicySet 管理）。

**technical_type（技術類型枚舉）**：

| 值 | 說明 |
|---|---|
| `NATIVE_TOKEN` | 原生代幣（如 SUI） |
| `STABLECOIN_FIAT_BACKED` | 具清楚贖回權之法幣抵押穩定幣（如 USDC） |
| `STABLECOIN_ALGO_OR_OTHER` | 演算法型或其他機制穩定幣 |
| `GOVERNANCE_TOKEN` | 治理代幣 |
| `DEFI_LP_OR_DERIVATIVE` | DeFi LP 憑證或衍生性部位 |
| `NFT` | 非同質化代幣（MVP 可不實作，見商業冊 §7） |

**accounting_class（會計類型枚舉）**：

| 值 | 準則 | 適用情境 |
|---|---|---|
| `INTANGIBLE_ASSET_IAS38` | IFRS IAS 38 | IFRS 軌下非為出售持有之數位資產的預設分類 |
| `INVENTORY_IAS2` | IFRS IAS 2 | 為出售而持有，或 broker-trader 角色 |
| `FINANCIAL_ASSET_IFRS9` | IFRS 9 | 符合金融資產定義（如具可執行贖回權之穩定幣） |
| `CRYPTO_ASSET_FV_PNL_GAAP_ASU2023_08` | US GAAP ASU 2023-08 | 落入 §1.2 六項範圍之 crypto assets |
| `INTANGIBLE_ASSET_ASC350_30` | US GAAP ASC 350-30 | GAAP 軌下範圍外之數位資產（成本減減損、不可迴轉） |

**分類約束（系統強制）**：

- 每種 asset 在每個 Entity 下必須有明確 `accounting_class`，由 PolicySet 承載；未設定則規則引擎 fail-closed（標記「需政策配置」，不自動出帳）。
- 同一 Entity、同一 asset、同一期間內不得跨不同 `accounting_class`（避免衡量口徑混亂）；變更分類須經 PolicySet 版本更迭並記錄於 change log（見 §9，Task 5）。
- technical_type 不決定 accounting_class；兩者關係由政策映射（例如 IFRS 軌可將 `STABLECOIN_FIAT_BACKED` 映為 `FINANCIAL_ASSET_IFRS9` 或 `INTANGIBLE_ASSET_IAS38`，見 §2.2）。

### §2.2 穩定幣政策（三選項，系統不自動判斷）

穩定幣在 IFRS 下若賦予持有人可執行之贖回權（尤其設計為按固定法幣金額贖回），可能符合 IFRS 9 金融資產定義；部分實務（含 MiCAR 情境）討論特定 fiat-backed stablecoin 甚至可能視為現金等價物，惟須視合約條款與實際用法而定。此判斷屬專業會計判斷，**系統不自動判定**，改以政策欄位 `stablecoin_treatment` 承載，三選項如下，選定後須一致適用：

| `stablecoin_treatment` | 對應 accounting_class | 後續衡量預設 |
|---|---|---|
| `FINANCIAL_ASSET_IFRS9` | `FINANCIAL_ASSET_IFRS9` | 見 §2.2.1 |
| `INTANGIBLE_ASSET` | `INTANGIBLE_ASSET_IAS38`（IFRS）/ `INTANGIBLE_ASSET_ASC350_30` 或 ASU2023-08（GAAP） | 依 §5 重估/減損軌 |
| `CASH_EQUIVALENT` | 於報表併入現金及約當現金列 | 見 §2.2.3 |

#### §2.2.1（P1 細節）IFRS 9 後續衡量：amortized cost vs FVTPL

歸類 `FINANCIAL_ASSET_IFRS9` 之穩定幣，後續衡量取決於 IFRS 9 之經營模式（business model）與 SPPI（solely payments of principal and interest）測試結果：

- **Amortized cost（攤銷後成本）**：僅在資產同時通過「以收取合約現金流量為目的之經營模式」與 SPPI 測試時適用。穩定幣是否通過 SPPI 高度存疑（多數穩定幣不支付利息、贖回金額未必等於本金加利息），由 entity 與其會計師確認。
- **FVTPL（公允價值變動列入損益）**：未通過上述測試者之預設，每期按 FV 重估、變動入損益。MVP 對 IFRS 9 穩定幣之後續衡量預設採 FVTPL（較保守、且與系統既有 FV 重估管線一致）；amortized cost 為 P1 政策選項。

#### §2.2.2（P1 細節）de-peg 處理

穩定幣脫鉤（de-peg，市價顯著偏離面額）之處理隨 accounting_class 而異：

- `FINANCIAL_ASSET_IFRS9` 且 FVTPL：de-peg 自然透過每期 FV 重估反映於損益，無需額外測試。
- `FINANCIAL_ASSET_IFRS9` 且 amortized cost：適用 IFRS 9 預期信用損失（ECL）模型評估減損。
- `INTANGIBLE_ASSET_IAS38`（IFRS 成本模式）：de-peg 構成 §5.2 之減損跡象，觸發減損測試。
- ASU 2023-08 範圍：de-peg 透過每期 FV through P&L 反映。
- de-peg 是否屬暫時性、是否觸發重分類，由 entity 與其會計師確認。

#### §2.2.3（P1 細節）CASH_EQUIVALENT 報表口徑後果

選 `CASH_EQUIVALENT` 者，該穩定幣於資產負債表併入「現金及約當現金（cash and cash equivalents）」，其後果須明確告知使用者：

- 不再單獨列示於數位資產，亦不進入 §5 期末重估/減損管線（約當現金按面額，不作 FV through P&L 亦不作減損）；
- 影響現金流量表之現金定義口徑與流動性比率；
- IFRS 下歸類約當現金門檻嚴格（須為高流動性、價值變動風險極小、原始到期日通常 ≤3 個月之投資），是否符合由 entity 與其會計師確認並持續一致適用。

### §2.3 分類與衡量先後（原則）

**先分類、再計量、再分錄**：先決定 accounting_class（§2）→ 再依 §5 決定衡量金額來源（cost / FV / impairment）→ 最後依 §4 事件模板與 §10 CoA 產出分錄。

## §3 事件 taxonomy

事件類型（event_type）取自資料模型與規則引擎設計（F6），完整 **12 類**（詞條定義以商業冊附錄 B 為準，本表補列 MVP/P1 標記與 JE 對應）。**MVP 標記與商業冊 §7、§5 模組 2 一致**：MVP 事件覆蓋 = 現有 5 類（receipt / payment / swap / gas / transfer）+ CEX 存提（transfer 子型，D16）+ staking reward 過渡映射（D18：以 `ASSET_RECEIPT` + `economic_purpose` 映射 Staking Income）；期末重估非攝取事件，見 §5。

| # | event_type | 定義（摘自附錄 B） | 分期 | §4 JE 模板 |
|---|---|---|---|---|
| 1 | `ASSET_RECEIPT` | 資產收款/收入（對手非己方內部帳戶之資產流入） | **MVP** | §4.1（含 §4.1.1 staking reward 過渡） |
| 2 | `ASSET_DISPOSAL` | 資產處分/支出（資產流出且非內部移轉） | **MVP** | §4.2 |
| 3 | `INTERNAL_TRANSFER` | 同一 Entity 名下不同 AccountSource 間之內部移轉 | **MVP** | §4.3 |
| 4 | `TRADE_BUY` | 現貨買入交易 | P1 | 機制同 §4.1（取得腿）+ §4.5 對價腿 |
| 5 | `TRADE_SELL` | 現貨賣出交易 | P1 | 機制同 §4.5（處分）+ 對價入 §4.1 |
| 6 | `SWAP` | 資產對資產即時兌換（同時處分+取得兩腿） | **MVP** | §4.5 |
| 7 | `FEE_GAS` | 鏈上交易 gas / network fee 支出 | **MVP** | §4.4 |
| 8 | `STAKING_DEPOSIT` | 質押存入（資產鎖定進入質押合約） | P1 | 過渡期以 §4.3 內部移轉子科目處理 |
| 9 | `STAKING_REWARD` | 質押獎勵發放 | P1（機制經 §4.1.1 於 MVP 提供） | §4.1.1 |
| 10 | `STAKING_WITHDRAWAL` | 質押提領（解鎖並取回資產） | P1 | 過渡期以 §4.3 內部移轉子科目處理 |
| 11 | `CUSTODY_MOVE` | 進出託管方（含 CEX 存提）之資產移動 | **MVP**（transfer 子型，D16） | §4.6 |
| 12 | `UNCLASSIFIED_CONTRACT_INTERACTION` | 無法歸類之合約互動，待人工覆核 | **MVP（路由，不直接出帳）** | §4.7 |

**過渡映射說明**：

- **staking 三態完整版（`STAKING_DEPOSIT` / `STAKING_WITHDRAWAL` 正式化）列 P1**（見商業冊 §7）。MVP 過渡期：staking reward 以 `ASSET_RECEIPT` 承載、由 `economic_purpose` = `STAKING_REWARD` 導向 Staking Income 科目（D18，§4.1.1）；質押存入/提領於過渡期視為內部移轉（liquid ↔ staked 子科目，§4.3），不產生損益。
- **CEX API connector 列 P1**；MVP 之 CEX 存提以 CSV import 進 `CUSTODY_MOVE`（§4.6）。
- `UNCLASSIFIED_CONTRACT_INTERACTION` 為路由分類：進入 review queue 待人工指派為上述其一，本身不直接出帳（見 §4.7）。

**taxonomy code 與規則引擎內部事件碼之對應**：規則引擎現行內部碼（`DIGITAL_ASSET_RECEIPT` / `DIGITAL_ASSET_PAYMENT` / `INTERNAL_TRANSFER` / `SPOT_TRADE_SWAP` / `GAS_FEE` / `OPENING_LOT`）為 §3 taxonomy 之實作別名；對應為 `ASSET_RECEIPT`→`DIGITAL_ASSET_RECEIPT`、`ASSET_DISPOSAL`→`DIGITAL_ASSET_PAYMENT`、`SWAP`→`SPOT_TRADE_SWAP`、`FEE_GAS`→`GAS_FEE`、`INTERNAL_TRANSFER`/`CUSTODY_MOVE`→`INTERNAL_TRANSFER`（含動態 `WALLET:<addr>` leg）。§4 模板以 taxonomy code 標題、括註內部 leg 名以利實作對照。

## §4 事件→JE 處理規範

### §4.0 JE 模型、平衡容差與 rounding 規則

**JournalEntry 模型**（欄位取自 F6，見商業冊附錄 B「JournalEntry」）：

- **Header**：`je_id` / `entity_id` / `period` / `source_event_id` / `policy_set_version` / `rule_version` / `status` / `memo` / `created_at`。
- **Lines**：`je_line_id` / `account_code` / `dimension values` / `debit` / `credit` / `currency` / `fx_rate` / `reference_asset` / `reference_quantity`。每行僅 debit 或 credit 之一為非零。

**金額來源（amount_source）枚舉**（供 MappingRule 引用）：`COST`（處分腿之 carrying amount，per lot，見 §7）、`FV`（公允價值/交易對價，見 §6 PricePoint）、`RESIDUAL`（借貸差額，如處分損益）、`ROUNDING`（尾差殘值，見下）。

**平衡容差與 rounding difference 規則（review findings 二之12）**：

1. **精度**：鏈上數量以最高 9 位小數（native decimals，如 MIST）保存；金額 = 數量 × 單價後，**四捨五入至 functional currency 之 minor unit（USD 2 位小數/分）**。逐行獨立捨入。
2. **殘值**：逐行捨入後，∑Dr 與 ∑Cr 可能出現尾差（rounding residual）。系統以一條平衡行將殘值計入 **`RoundingDifference`** 科目（P&L 其他損益；amount_source = `ROUNDING`；CoA seed 須含此科目，見 §10 / Task 5），使 JE 嚴格平衡（∑Dr = ∑Cr）。
3. **容差上限（cap，明定）**：殘值絕對值上限為 PolicySet 欄位 `roundingThresholdMinor`（minor units，即分；現行常數預設 `0`，本規格建議 seed 預設 **2 minor units = 0.02 USD**，per JE，可由 entity 政策調整）。判定式：`|residual| ≤ roundingThresholdMinor` → 寫入 `RoundingDifference` 平衡行；`|residual| > roundingThresholdMinor` → **fail-closed**，不出帳，標記 `BALANCE_ERROR` 進入 review（不得靜默 plug）。
   - cap 之下限應涵蓋逐行捨入的理論累積（每行至多 0.5 minor unit，N 個計價行至多約 0.5N minor units）；預設 0.02 USD 適用一般 2–4 行分錄，行數更多之複合分錄由 entity 上調 `roundingThresholdMinor`。
4. **`roundingThresholdMinor` = 0 時**：等同不容許任何尾差，任何殘值即 fail-closed；此為最嚴格設定，適合要求零殘值之 entity。

**模板讀法**：下列各表列 `Dr/Cr | 科目（概念名） | 金額來源 | 軌別`。科目為概念名，實際 `account_code` 由 §10 CoA / MappingRule 解析（現行 `DEMO_COA_RULES` 已含 `DigitalAssets` / `AccountsReceivable` / `AccountsPayable` / `DisposalGain` / `DisposalLoss` / `GasFeeExpense` / `OpeningBalanceEquity`）。「軌別」= IFRS / GAAP / 通用（兩軌相同）。金額以 functional currency（MVP=USD）計。

### §4.1 ASSET_RECEIPT（資產收款）— MVP

內部碼 `DIGITAL_ASSET_RECEIPT`；legs：`ACQUISITION` / `RECEIVABLE_SETTLEMENT`。初始入帳：IFRS（IAS 38/IAS 2）按成本（對價+交易成本）；GAAP ASU 2023-08 範圍內按公允價值入帳。取得腿建立新 PositionLot（§7）。貸方依 `economic_purpose` 決定。

**情境 A：客戶付款（銷售收入收款，economic_purpose = `CUSTOMER_PAYMENT`）**

| Dr/Cr | 科目 | 金額來源 | 軌別 |
|---|---|---|---|
| Dr | DigitalAssets | COST（IFRS）/ FV（GAAP ASU2023-08） | 通用 |
| Cr | Revenue 或 AccountsReceivable / ContractLiability（依收入認列政策） | 同 Dr | 通用 |

**情境 B：既有應收之收款（economic_purpose = `RECEIVABLE_SETTLEMENT`）**

| Dr/Cr | 科目 | 金額來源 | 軌別 |
|---|---|---|---|
| Dr | DigitalAssets | COST / FV | 通用 |
| Cr | AccountsReceivable | 同 Dr | 通用 |

**情境 C：資本投入 / 股東增資（economic_purpose = `CAPITAL_CONTRIBUTION`）**

| Dr/Cr | 科目 | 金額來源 | 軌別 |
|---|---|---|---|
| Dr | DigitalAssets | COST / FV | 通用 |
| Cr | Equity（ShareCapital / AdditionalPaidInCapital） | 同 Dr | 通用 |

> 兩軌差異僅在初始衡量金額來源（IFRS 成本 vs GAAP ASU2023-08 公允價值）；分錄結構相同。收入認列時點與科目由 entity 收入政策決定。

#### §4.1.1 Staking Reward 過渡映射（D18）— MVP

質押獎勵於 MVP 以 `ASSET_RECEIPT` + `economic_purpose = STAKING_REWARD` 承載，按收到時公允價值入帳、貸記 `StakingIncome`（`staking_income_policy` 決定歸 `OPERATING_REVENUE` 或 `OTHER_INCOME`；`StakingIncome` 須加入 CoA seed，見 §10）。

範例：收到 50 SUI staking reward，收到時 FMV = 3 USD/枚 → 金額 150 USD。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | DigitalAssets（SUI） | 150.00 | FV | 通用 |
| Cr | StakingIncome | 150.00 | FV | 通用 |

> `STAKING_REWARD` 正式事件碼與 staking 三態列 P1（商業冊 §7）；MVP 僅此過渡映射，取得同時建立一筆 cost basis = FV 之新 lot。

### §4.2 ASSET_DISPOSAL（資產處分/付款）— MVP

內部碼 `DIGITAL_ASSET_PAYMENT`；legs：`EXPENSE` / `DISPOSAL` / `DISPOSAL_GAIN` / `DISPOSAL_LOSS`。處分腿依 cost method（§7）取 lot、以 carrying amount（COST）貸出 DigitalAssets；借方依用途；差額（對價 FV − carrying amount）認列處分損益。

範例：支付供應商，動用 carrying amount 200 USD 之資產，結清應付/費用 220 USD（對價 FV 220）。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | Expense / Prepaid / FixedAsset / Inventory / AccountsPayable（依用途） | 220.00 | FV（對價） | 通用 |
| Cr | DigitalAssets | 200.00 | COST（per lot carrying） | 通用 |
| Cr | DisposalGain | 20.00 | RESIDUAL | 通用 |

（若對價 < carrying amount，差額為借方 `DisposalLoss`。薪酬支付借 `SalaryExpense` / `ShareBasedPayment`；投資支付借 `Investment` / `FinancialAsset`。）

> GAAP ASU 2023-08 軌：日常 FV 變動已逐期入帳（§5.1），處分時 carrying amount 已等於前一衡量日 FV，故處分損益多僅反映衡量日至處分日之增量；分錄結構不變，仍追蹤 cost basis 與 disposal gain/loss 供揭露。

### §4.3 INTERNAL_TRANSFER（內部移轉）— MVP

內部碼 `INTERNAL_TRANSFER`；legs 為動態 `WALLET:<addr>`（catch-all → `DigitalAssets`）。同一 Entity 名下不同 AccountSource 間移位，**不改變經濟所有權、不產生損益**，按 carrying amount 平轉。

範例：Wallet A → Wallet B 移轉 carrying amount 500 USD 之資產。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | DigitalAssets – Wallet B | 500.00 | COST | 通用 |
| Cr | DigitalAssets – Wallet A | 500.00 | COST | 通用 |

> 過渡期質押存入/提領（`STAKING_DEPOSIT` / `STAKING_WITHDRAWAL`）比照本模板，於 `DigitalAssets – Liquid` ↔ `DigitalAssets – Staked` 子科目間平轉，不產生損益。lot 之 cost basis 隨資產移轉、不重設。

### §4.4 FEE_GAS（gas / network fee）— MVP

內部碼 `GAS_FEE`；legs：`NETWORK_FEE` / `DISPOSAL` / `DISPOSAL_GAIN` / `DISPOSAL_LOSS`。以支付 gas 之資產 carrying amount 貸出，借記費用；若該資產 carrying ≠ 支付時 FV，差額入處分損益。`fee_expense_policy` 決定當期費用（`EXPENSE_IMMEDIATE`）或資本化併入取得成本（`CAPITALIZE_TO_ASSET`）。

範例：花費 carrying amount 1.00 USD 之 SUI 支付 gas，支付時 FV 1.00 USD。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | GasFeeExpense（或資本化至相關資產） | 1.00 | FV | 通用 |
| Cr | DigitalAssets | 1.00 | COST（per lot） | 通用 |

（carrying 與 FV 有差時，另出 `DisposalGain` / `DisposalLoss` 平衡差額。Sui gas 之 storage rebate 淨額處理見 §13，Task 6。）

### §4.5 SWAP（資產對資產兌換）— MVP

內部碼 `SPOT_TRADE_SWAP`；legs：`ACQUISITION` / `DISPOSAL` / `DISPOSAL_GAIN` / `DISPOSAL_LOSS`。視為「處分 A + 取得 B」：A 按 carrying amount（COST，per lot）貸出；B 按公允價值（通常為交易對價 FV）借入並建立新 lot；差額認列 A 之處分損益。

範例：賣出 100 SUI（成本 2 USD/枚，carrying 200）換得 300 USDC（對價 FV 300）。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | DigitalAssets（USDC，B） | 300.00 | FV（對價） | 通用 |
| Cr | DigitalAssets（SUI，A） | 200.00 | COST（per lot） | 通用 |
| Cr | DisposalGain | 100.00 | RESIDUAL | 通用 |

（對價 < carrying 時，差額為借方 `DisposalLoss`。）

> IFRS：IAS 38 對可互換資產之成本分配無明文，實務可類比 IAS 2 成本公式（FIFO / 加權平均），一致運用即可（本系統以 §7 cost method 落實，MVP=FIFO）。GAAP ASU 2023-08：B 若在範圍內，後續以 FV 計量；處分 A 之損益仍按上式呈現並追蹤 cost basis。
>
> **TRADE_BUY / TRADE_SELL（P1）**：現貨買賣為 SWAP 之特例——買入（USD/穩定幣 → token）取得腿同 §4.1、對價貸出現金/AP；賣出（token → USD/穩定幣）處分腿同本節、對價入現金/AR。事件碼正式化列 P1，機制於 MVP 已由 §4.1/§4.5 涵蓋。

### §4.6 CUSTODY_MOVE（CEX 存提 / 託管移動）— MVP（D16）

內部碼沿用 `INTERNAL_TRANSFER`。錢包 ↔ CEX / 託管方之移動，**本質為內部移轉**，比照 §4.3 於錢包子科目與 CEX 子科目間平轉、不產生損益；若 CEX 帳戶於總帳設獨立科目，貸/借對應子科目。

範例：Wallet → CEX 存入 carrying amount 1,000 USD 之資產。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | DigitalAssets – CEX | 1,000.00 | COST | 通用 |
| Cr | DigitalAssets – Wallet | 1,000.00 | COST | 通用 |

> 存提若附帶手續費，fee 部分另依 §4.4 處理。CEX API connector 列 P1；MVP 經 CSV import 承載（D16）。

### §4.7 UNCLASSIFIED_CONTRACT_INTERACTION（未分類）— MVP（路由，不出帳）

無法歸類之合約互動不直接產生 JE：進入 review queue，由人工（AI 建議 + confidence，人工 approve）重新指派為 §3 其一事件碼後，再套對應模板出帳。規則引擎對此事件碼 **fail-closed**（無 MappingRule → 不自動出帳，標記需人工分類），符合「AI 僅建議、不自動 posting」邊界。

## §5 期末重估/減損（MVP）

期末重估為系統產生之會計分錄（非攝取事件），於月結「重估過帳」步驟執行（見 §14，Task 6）。**兩軌預設不同**：

### §5.1 GAAP 軌 — ASU 2023-08 FV through P&L（MVP 預設）

落入 §1.2 範圍之 crypto assets（`CRYPTO_ASSET_FV_PNL_GAAP_ASU2023_08`）每期按公允價值重估，**變動計入當期損益**（net income），無減損測試、無迴轉概念——每期雙向 mark-to-FV，漲跌皆入 P&L。報表須與其他無形資產分開列示，並附 roll-forward 與 cost basis 方法揭露（§11，Task 6）。

範例：期初 carrying（=前次衡量 FV 或 cost basis）1,000，期末 FV 1,400。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | CryptoAssetsAtFairValue（DigitalAssets） | 400.00 | FV − 前 carrying | GAAP |
| Cr | UnrealizedGainCryptoPnL | 400.00 | RESIDUAL | GAAP |

（FV < 前 carrying 時，Dr `UnrealizedLossCryptoPnL` / Cr DigitalAssets。此二科目須加入 CoA seed，見 §10。）

> **範圍外之 GAAP 資產**（`INTANGIBLE_ASSET_ASC350_30`，未滿足 §1.2 六項者）不適用 FV 模型，沿用 ASC 350-30 成本減減損：僅在減損時借記 `ImpairmentLoss`、**減損一經認列不可迴轉（no reversal / no write-up）**（此即「GAAP 禁止迴轉」所指之模型；ASU 2023-08 對範圍內資產以持續 FV 重估取代之，故範圍內資產無「迴轉」議題）。

### §5.2 IFRS 軌 — cost + impairment（MVP 預設）

IFRS 軌 MVP 預設採 **IAS 38 成本模式**：初始成本入帳，之後按「成本減累計減損」列示。每期依減損指標評估、依 IAS 36 測試減損。

**減損子節（review findings 二之7）**：

- **減損跡象（indicators）**：市價顯著且持續下跌、技術/協議重大不利變化、穩定幣 de-peg（§2.2.2）、法規或市場流動性惡化等。存在跡象即觸發測試。
- **測試頻率**：每一報導期末（月結）評估是否存在跡象；有跡象即測試。（IAS 38 成本模式之數位資產一般無不確定耐用年限之年度強制測試爭議，惟本系統於每月結評估跡象以求審慎。）
- **recoverable amount（可回收金額）**：取「公允價值減出售成本（fair value less costs of disposal）」與「使用價值（value in use）」之較高者；活絡市場之數位資產通常以前者為主。carrying amount 高於 recoverable amount 之差額認列為減損損失。

範例：carrying 1,000，recoverable amount 700 → 減損 300。

| Dr/Cr | 科目 | 金額 | 金額來源 | 軌別 |
|---|---|---|---|---|
| Dr | ImpairmentLoss | 300.00 | carrying − recoverable | IFRS |
| Cr | DigitalAssets（或 AccumulatedImpairment 抵減科目） | 300.00 | 同上 | IFRS |

**減損迴轉（IFRS 允許，方向不可寫反）**：

- **IFRS（IAS 36.114）允許迴轉**：後續期間若 recoverable amount 回升，得迴轉先前減損；惟**迴轉後之 carrying amount 不得超過「若未曾認列減損、原應有之 carrying amount（即原始成本，數位資產無攤銷）」之上限**（原成本上限）。迴轉分錄：Dr DigitalAssets / Cr `ImpairmentReversalGain`（P&L；須加入 CoA seed）。
- **GAAP 對照**：ASU 2023-08 範圍內資產以持續 FV through P&L 呈現、無減損/迴轉概念（§5.1）；範圍外之 ASC 350-30 資產 **減損不可迴轉**（§5.1 附註）。故「IFRS 允許迴轉（原成本上限）vs GAAP 禁止迴轉」之對照，GAAP 端指其成本減減損模型（ASC 350-30）。

### §5.3（P1 細節）IFRS Revaluation Model 機制（review findings 二之9）

IFRS revaluation model（IAS 38 重估模式）為 P1 政策選項（`revaluation_policy` = `revaluation`；見商業冊 §7 P1）。機制要點（P1 實作時展開，MVP 不啟用）：

- **重估增值入 OCI**：重估增值計入其他綜合損益（OCI），累積於權益之 **revaluation surplus（重估盈餘）**科目；重估減值**先沖抵同一資產先前之 revaluation surplus，超出部分才入當期損益**（順序不可寫反）。
- **CoA 需權益科目**：啟用重估模式須於 CoA seed 預留 `RevaluationSurplus`（權益/OCI）科目（§10 預留）。
- **IAS 38.75 active market 警示**：IAS 38 重估模式僅在資產存在**活絡市場（active market）**時方得採用；多數數位資產是否具活絡市場高度存疑，採用前須由 entity 與其會計師確認並持續評估市場活絡性；市場不再活絡時須停用重估模式並轉回成本模式。
- IAS 2 broker-trader 特例（按公允價值減出售成本、變動入損益）為另一政策選項，適用對象與條件由 entity 與其會計師確認。

## §6 Pricing / PricePoint 規格（MVP）

價格是 MVP 硬依賴（D13）：§4 之 `FV` 金額來源、§5 期末重估/減損之 recoverable amount 與 FV，均由本節之 PricePoint 供給。本節定義來源優先序、缺價處理、cut-off 時點與 PricePoint 欄位，為 §5 期末重估的計價基礎（衡量邏輯見 §5，本節不重寫，只供給價格）。

### §6.1 PricePoint 欄位

某資產在特定時點之市場價格紀錄（詞條見商業冊附錄 B「PricePoint」）。欄位：

| 欄位 | 說明 |
|---|---|
| `price_point_id` | 唯一識別 |
| `asset_id` | 計價資產 |
| `quote_currency` | 報價幣別（MVP 恆為 functional currency = USD，見 §1.3） |
| `price` | 單價（quote_currency / 單位資產） |
| `as_of` | 價格所屬時點（UTC 時間戳，見 §6.4 cut-off 換算） |
| `source` | 來源枚舉：`ORACLE_PYTH` / `ORACLE_NAUTILUS` / `MANUAL`（fallback） |
| `fv_hierarchy_level` | IFRS 13 / ASC 820 公允價值層級：`LEVEL_1`（活絡市場報價）/ `LEVEL_2`（可觀察輸入推導）（二之15；MVP 不支援 LEVEL_3 估值模型） |
| `principal_market` | 主要市場識別（見 §6.5） |
| `ingested_at` | 取得/寫入時間 |
| `staleness_seconds` | `as_of` 與使用時點之時間差（供 §6.3 stale 判定） |

一筆重估或計價所引用之 `price_point_id` 須隨 JE 留存（供審計回溯至價格證據）。

### §6.2 價格來源優先序（oracle → 手動 fallback）

規則引擎計價時按下列優先序取價，命中即止：

1. **Oracle（首選）**：候選 Pyth、Nautilus。MVP 不綁定單一來源，以下列**評估準則**擇一或多源，由 entity 與其會計師確認選用：
   - 覆蓋資產範圍（是否涵蓋 entity 持有之 token）；
   - 更新頻率與延遲（能否滿足 §6.3 staleness 門檻）；
   - 是否附信賴區間/信心度（Pyth 提供 confidence interval，可支撐 §6.3 品質判定）；
   - 可驗證性（Nautilus 之鏈下驗證計算可附 attestation，供審計）；
   - 對應之 `fv_hierarchy_level` 判定（活絡市場直接報價傾向 LEVEL_1，跨市場推導傾向 LEVEL_2）。
2. **手動輸入（fallback）**：oracle 無覆蓋或全部 stale 時，允許經授權人員手動輸入 PricePoint（`source = MANUAL`），須附來源註記（報價所（exchange/OTC）、擷取時點）；手動價一律標 `LEVEL_2` 或更低可觀察性，並記入 §9.3 change log（who/when/what）。

> 建議預設優先採 oracle、手動輸入僅作 fallback；實際選用之 oracle 與是否允許手動 fallback，由 entity 與其會計師確認。

### §6.3 stale / 缺價處理（fail-closed，不得默認 0）

- **staleness 門檻**：PolicySet 承載 `price_staleness_seconds`（建議預設 **86400 秒（24 小時）**，由 entity 與其會計師確認）。`staleness_seconds > price_staleness_seconds` 之 oracle 價視為 stale，降級至下一優先序（手動 fallback）。
- **缺價（無任何可用來源）**：需計價之事件/重估**擋在規則引擎**、不產生 JE，標記 `PRICE_MISSING` exception 進入 review queue（比照 §2.1、§4.7 之 fail-closed）。**嚴禁以 0 或前期價默認出帳**——0 會靜默扭曲損益與資產餘額。
- **期末重估缺價**：§5 之月結重估若任一持有資產缺價，該資產重估行 fail-closed、阻擋月結「重估過帳」步驟（見 §14，Task 6），不得跳過。

### §6.4 期末 cut-off 時點（明定一種）

會計日之價格切點採 **entity 時區之日曆日切**（非 block timestamp）：

- 期末重估以 **entity 時區當日 23:59:59 對應之 UTC 時點**為 `as_of` 目標，取該時點前最近且未 stale 之 PricePoint。
- **鏈上事件之計價**：交易之 block timestamp（Sui 為 UTC 毫秒）先換算為 entity 時區以歸屬會計日（period），計價取「該事件 block timestamp 當下」最近之未 stale PricePoint（即成交時點公允價值，非日終價）。
- 換算規則明定：`accounting_date = to_date(block_timestamp_utc, entity_timezone)`；`entity_timezone` 為 entity 層設定（MVP 預設 `UTC`，可由 entity 設定為 `Asia/Taipei` 等目標市場時區）。跨日切之交易一律以換算後 entity 時區日期歸屬，避免 UTC 與在地日曆錯期。

### §6.5 principal market（主要市場）

IFRS 13 / ASC 820 之公允價值以**主要市場（principal market，交易量與活動最大之市場）**價格衡量；無主要市場時採**最有利市場（most advantageous market）**。實作意涵：

- 同一資產跨多所報價時，PricePoint 之 `principal_market` 應標記所採市場，且同一資產跨期一致採用（不得逐期擇高）。
- 主要市場之判定（何所為該 entity 之主要市場）屬專業判斷，由 entity 與其會計師確認；系統以 `principal_market` 欄位承載該決策、供審計檢視一致性。

## §7 Cost basis 與 PositionLot

處分（disposal、swap、付款、gas）時之 carrying amount（§4 之 `COST` 金額來源）由本節之 lot 追蹤供給。

### §7.1 成本基礎方法

- **FIFO（MVP 預設）**：先進先出，處分時依 `acquisition_date` 由早至晚取 lot。系統既有實作即 FIFO。
- **WAC（加權平均，P1）**：加權平均單位成本。列 P1（見商業冊 §7）；註記 **L2 基金/資產管理型客戶偏好 WAC**（與其報表口徑一致），P1 開放 `cost_basis_method = WAC` 時展開。
- 方法由 PolicySet 之 `cost_basis_method` 承載（§9），同一 entity/asset 跨期一致；變更須經 PolicySet 版本更迭並記 change log（§9.3）。LIFO / HIFO / Specific Identification 非本期範圍。

### §7.2 PositionLot 欄位（F4 §4）

每筆 lot 至少記錄：

| 欄位 | 說明 |
|---|---|
| `asset_id` | 資產 |
| `acquisition_date` | 取得日（FIFO 排序鍵；期初導入 lot 為原始取得日，非導入日） |
| `acquisition_tx_ref` | 取得交易參照（鏈上 tx / 期初導入來源註記） |
| `acquired_qty` | 取得數量（native decimals，見 §4.0 精度） |
| `remaining_qty` | 剩餘未處分數量（**恆 ≥ 0**，見 §7.3 例外流程） |
| `unit_cost` | 單位成本（functional currency = USD） |
| `accounting_class` | 會計分類（§2，決定後續衡量軌） |
| `cost_method` | 建立時之成本方法（FIFO/WAC，供追溯） |

處分時：(1) 依 `cost_method` 取對應 lot；(2) 計算 disposed carrying amount（∑ 處分 qty × lot unit_cost）；(3) 與對價 FV 比較得 gain/loss（§4.2/§4.5 之 RESIDUAL）；(4) 扣減 `remaining_qty`。內部移轉（§4.3）不改 cost basis、隨資產搬移 lot。

### §7.3 期初餘額導入（opening balance / cut-over，MVP）

上線前既有持倉須以期初 lot 導入，建立 cost basis 起點。對應現有規則引擎 `OPENING_LOT` 事件（legs：`ACQUISITION` → `DigitalAssets`、`OPENING_EQUITY` → `OpeningBalanceEquity`，見 §10 / policyConstants）。

**opening lot import 格式（每列一筆 lot）**：

| 欄位 | 必填 | 說明 |
|---|---|---|
| `asset` | 是 | 資產識別（symbol / coin type） |
| `qty` | 是 | 期初數量（> 0） |
| `unit_cost` | 是 | 單位成本（USD；歷史取得成本，非導入日市價） |
| `acquisition_date` | 是 | 原始取得日（供 FIFO 排序；非導入日） |
| `source_note` | 是 | 來源註記（前系統/CEX 對帳單/錢包快照出處） |

導入分錄（每筆 lot）：Dr `DigitalAssets`（qty × unit_cost）/ Cr `OpeningBalanceEquity`（同額）。導入建立之 lot `remaining_qty = qty`、`acquisition_tx_ref` 記 `source_note`。

**例外流程——處分量超過已知 lot（fail-closed，禁止負 lot）**：

處分事件之數量若超過該資產所有 lot 之 `remaining_qty` 合計（即帳上無足額成本基礎，多因期初導入遺漏或缺一段歷史）：

- **擋下該事件、不出帳**，標記 `LOT_SHORTFALL` exception 進入 review queue；
- **嚴禁建立負數 lot 或 `remaining_qty < 0`**——負 lot 會產生虛構成本、扭曲後續所有處分損益；
- 解法為人工補建期初/遺漏 lot（回 §7.3 導入）後重跑該事件，非讓系統自行 plug。此與 §6.3 缺價、§4.7 未分類同屬 fail-closed 邊界（AI 建議、不自動 posting）。

## §8 Manual JE / Adjustment / Reversal（MVP）

自動化引擎無法覆蓋所有情境（分類更正、期末應計、審計調整），故須提供手工分錄。手工分錄之借貸表示沿用 §4 模板格式（Dr/Cr | 科目 | 金額 | 金額來源 | 軌別）。

### §8.1 手工分錄輸入約束（強制）

manual JE 進帳前，系統強制檢核：

- **借貸必平**：∑Dr = ∑Cr（依 §4.0 精度與 minor unit 捨入；不平則擋下，不套 `RoundingDifference` 自動 plug——manual JE 由編製者自負平衡）；
- **必掛 period**：須指定會計期間，且該 period 須為 open（已 lock/已關帳期間見 §8.3、§14）；
- **必留 preparer 與 reason**：記錄編製人（preparer）與事由（reason，自由文字，供審計）；建議另留覆核人（reviewer）欄位（P1 RBAC 時強制雙人）；
- manual JE 之 header `source_event_id` 為空（非源自攝取事件），`status` 標記手工來源，於 UI 以 brass 語意色標示 manual/off-chain（見 §15，Task 7）。

### §8.2 三情境

| 情境 | 用途 | 典型分錄 |
|---|---|---|
| **更正（correction）** | 修正錯誤分類或錯帳（如科目誤植） | 沖原錯誤方向 + 補正確科目；或對未匯出 JE 直接 void 重出（§8.3） |
| **應計（accrual）** | 期末認列已發生未入帳之收入/費用 | Dr Expense / Cr AccruedLiability（或 Dr AccruedReceivable / Cr Revenue）；次期迴轉 |
| **審計調整（audit adjustment）** | 審計師要求之調整分錄 | 依調整內容；reason 註明審計來源與依據 |

> 應計之次期自動迴轉（reversing entry）為便利選項，是否啟用由 entity 政策決定。

### §8.3 Reversal 規則（連動 §12）

manual JE 與自動 JE 之更改一律走「反向」而非「就地改」，以保帳簿不可竄改：

- **未匯出 JE（未進 §12 ERP export）**：可 **void**（作廢）——標記 `VOIDED`、原 JE 不計入 TB，可重新產出正確 JE。void 動作記 change log。
- **已匯出 JE（已匯入 Xero/QBO，見 §12）**：**只能反向沖銷（reversing entry），不得 void、不得就地改**——因外部 ERP 已收該 JE，就地改會使兩邊帳不一致。沖銷方式：新增一筆金額相同、借貸方向相反之 JE（`memo` 引用原 `je_id`），再視需要補正確 JE。此約定與 §12「已匯出不可改」一致（沖銷約定權威文字連動 §12，Task 6）。
- 判定「是否已匯出」以 JE 之 export 狀態為準（§12 定義 export 標記）；跨此界線後一律沖銷。

### §8.4 進 snapshot / anchor 範圍聲明

manual JE 與自動 JE **同等納入**月結 snapshot 與 audit anchor（見 §14/§17，Task 6/7）——手工分錄同屬正式帳簿之一部分，不得排除於完整性證明之外，否則 anchor 無法涵蓋全部帳務。void 之 JE 以其最終狀態（`VOIDED`）納入 snapshot（保留作廢軌跡，非刪除）。

## §9 PolicySet schema

PolicySet 為 entity 之會計政策集合，是規則引擎判定科目路徑與衡量方式之單一政策來源；落庫、版本化，**取代現行 `DEMO_POLICY_SET` 常數**（`services/api/src/http/policyConstants.ts`）。

### §9.1 欄位（F4 §5 全列）

每個 entity 有一個 active PolicySet：

| 欄位 | 值域 | 說明 |
|---|---|---|
| `accounting_standard` | `IFRS` / `US_GAAP` | 準則軌（§1.1，兩軌互不混用） |
| `functional_currency` | ISO 幣別 | 功能貨幣（MVP 恆 `USD`，見 §1.3；禁 USD 硬編碼散落） |
| `reporting_currency` | ISO 幣別 | 報導貨幣（MVP = functional = `USD`；多幣別換算 P1） |
| `cost_basis_method` | `FIFO` / `WAC` | 成本基礎（§7；MVP=FIFO，WAC 為 P1） |
| `stablecoin_treatment` | `FINANCIAL_ASSET_IFRS9` / `INTANGIBLE_ASSET` / `CASH_EQUIVALENT` | 穩定幣處理（§2.2，僅承載政策不自動判斷） |
| `crypto_classification_default` | accounting_class 枚舉 | 非穩定幣 token 之預設分類（IFRS 傾向 IAS 38、GAAP 傾向 ASU 2023-08 或 ASC 350-30，§2.1） |
| `staking_income_policy` | `OPERATING_REVENUE` / `OTHER_INCOME` | 質押收入歸類（§4.1.1，決定 `StakingIncome` 歸屬） |
| `fee_expense_policy` | `EXPENSE_IMMEDIATE` / `CAPITALIZE_TO_ASSET` | gas/fee 處理（§4.4） |
| `revaluation_policy` | `cost` / `revaluation` | IFRS 衡量模式（§5.2/§5.3；MVP=cost，revaluation 為 P1，另含 IAS 2 broker-trader 選項） |
| `asu_2023_08_applies` | per-asset 布林標記 | US GAAP 下該資產是否落入 ASU 2023-08 FV through P&L 範圍（§1.2 六項判準結果） |

> `functional_currency` / `reporting_currency` 於 MVP 恆 USD 亦不省略、不硬編碼（§1.3）。`asu_2023_08_applies` 為 per-asset 標記（非 entity 單值），承載每種 token 之範圍判定。

### §9.2 落庫與版本化

- PolicySet 落資料庫，**每次變更產生新 version**（policy_set_version）；舊版本保留。
- 每筆 JournalEntry header 記錄產生所依據之 `policy_set_version`（與 `rule_version`，見 §4.0、商業冊附錄 B）。
- 允許「以不同 policy_version 重跑某期間」做 scenario / **restatement**（重編）——期間之事件不變、換政策重算 JE，供比較。重跑不覆寫原 JE（另存版本）。
- PolicySet 涵蓋多個子版本維度（現行常數已含 `assetPolicyVersion` / `eventPolicyVersion` / `ruleVersion` / `parserVersion` / `normalizationVersion`），落庫 schema 沿用該粒度。

### §9.3 最小 change log（D19）

PolicySet 與 MappingRule（§10）之變更、及 review 人工決策，須記入最小 change log（完整 RBAC + audit log 列 P1）：

- **who**：變更/決策人；
- **when**：時間戳；
- **what**：變更對象（PolicySet 欄位 / MappingRule / asset 分類 / manual price / JE void 等）、變更前後值（before/after）、事由（reason）。

change log 為只增（append-only）、不可就地改；供審計回溯政策演進與人工介入軌跡。§2.1 之分類變更、§6.2 之手動價、§8 之 void/沖銷決策均落此 log。

## §10 CoA 與 MappingRule

科目表（CoA）與映射規則落庫、JSON 化、版本化，**取代現行 `DEMO_COA_RULES` 常數**（`services/api/src/http/policyConstants.ts`）。

### §10.1 F6 三層規則架構

規則引擎將 NormalizedEvent 轉為 JournalEntry 分三層（ideas-summary §2.4 / F6），逐層產物可版本化、JSON 儲存、不硬編碼於準則：

1. **第一層 分類規則（classification）**：由 event_type + asset 之 technical_type + economic_purpose 判定 accounting treatment candidate（候選會計處理）。
2. **第二層 政策規則（policy）**：套 PolicySet（`accounting_standard`、`stablecoin_treatment`、`accounting_class` 等，§9）決定科目路徑（IFRS/GAAP/公司政策）與衡量金額來源（cost / FV / impairment）。此層即 F4 §6 之 MappingRule（事件→科目）與 MeasurementRule（金額來源）。
3. **第三層 分錄生成規則（posting）**：產出實際 debit/credit lines（§4 模板）、平衡（§4.0 rounding）。

規則以 JSON 結構儲存並帶 `rule_version`（範例 rule_id：`swap_disposal_ifrs_v1`）；每筆 JE 記錄所依據之 rule_version（§4.0、§9.2）。

### §10.2 MappingRule 結構

現行 per-leg 映射（`{ eventType, leg, account }`，含動態 `WALLET:<addr>` catch-all）為第三層之最小落地形式，落庫後 JSON 化並版本化。條件維度可擴充 asset_class / economic_purpose / accounting_standard / stablecoin_treatment（F4 §6.2）；結果為 debit/credit account template + amount_source（§4.0 枚舉）。

**找不到 mapping → fail-closed（F5 §6.3 原則）**：未命中之 leg 解析為 `null`，標記 `MAPPING_MISSING`「需政策配置」、**不自動出帳、不落任何 fallback/Suspense 科目**（現行 `resolveCoa` 已回傳 `null`、無 default account，符合此原則）。此與 §2.1、§4.7、§6.3、§7.3 同屬 fail-closed 邊界。

### §10.3 CoA seed 清單

落庫初始 seed。**現行 `DEMO_COA_RULES` 已含**（沿用）：`DigitalAssets`、`AccountsReceivable`、`AccountsPayable`、`DisposalGain`、`DisposalLoss`、`GasFeeExpense`、`OpeningBalanceEquity`。

**本規格新增（§1–§9 標註「須加入 CoA seed」之科目，全數收錄）**：

| 科目 | 類別 | 來源節次 | 用途 |
|---|---|---|---|
| `StakingIncome` | 損益（收入） | §4.1.1 | 質押獎勵收入（`staking_income_policy` 決定歸 OPERATING_REVENUE / OTHER_INCOME） |
| `RoundingDifference` | 損益（其他損益） | §4.0 | 逐行捨入尾差之平衡科目（amount_source=ROUNDING） |
| `UnrealizedGainCryptoPnL` | 損益 | §5.1 | GAAP ASU 2023-08 FV 重估——升值（未實現利益） |
| `UnrealizedLossCryptoPnL` | 損益 | §5.1 | GAAP ASU 2023-08 FV 重估——貶值（未實現損失） |
| `ImpairmentLoss` | 損益 | §5.1 附註 / §5.2 | IFRS IAS 36 / GAAP ASC 350-30 減損損失 |
| `ImpairmentReversalGain` | 損益 | §5.2 | IFRS 減損迴轉利益（原成本上限；GAAP 不適用） |

**權益/OCI 科目預留（P1 revaluation model，§5.3）**：

| 科目 | 類別 | 來源節次 | 用途 |
|---|---|---|---|
| `RevaluationSurplus` | 權益 / OCI | §5.3 | IFRS IAS 38 重估模式重估增值累積（P1 啟用 `revaluation_policy=revaluation` 時使用；MVP 預留不出帳） |

> `RevaluationSurplus` 於 MVP 僅預留於 seed、不產生分錄（revaluation model 列 P1）。其餘六科目 MVP 即用。實際 `account_code` 編碼（科目代號）由 entity 既有 CoA 對接時確定，本清單提供概念名與必要科目集合。

## §11 Trial balance 與揭露

月結產出兩類報表：試算表（TB，各科目餘額彙總）與 ASU 2023-08 揭露（roll-forward）。二者皆為 subledger 層資料，供下游報表模組使用；MVP 不做三大報表引擎（見商業冊 §6 非目標第 2 條、§7）。

### §11.1 科目餘額視圖（Trial Balance）

TB 為期間 × 科目之餘額彙總視圖，每列欄位：

| 欄位 | 說明 |
|---|---|
| `period` | 會計期間（期間歸屬依 §13.3 引用之 §6.4 cut-off，不重定義） |
| `account` | 科目（CoA account_code / 概念名，§10.3） |
| `accounting_standard` | 軌別（IFRS / US_GAAP；兩軌各出一份 TB，不混列，§1.1） |
| `opening_balance` | 期初餘額（＝上期 `closing_balance`；首期由 §7.3 opening balance JE 建立） |
| `debit_movement` | 本期借方發生額合計 |
| `credit_movement` | 本期貸方發生額合計 |
| `closing_balance` | 期末餘額（＝期初 ± 本期借貸發生淨額，依科目正常餘額方向） |

- **TB tie-out（整表平衡）**：全科目 `∑debit_movement = ∑credit_movement` 且 `∑closing_balance`（依借貸方向帶號）＝ 0。此為 §14 步驟 5 之 JE light 聚合判準（個別 JE 平衡 ≠ TB 平衡，二者皆須綠，見 §14）。
- 金額精度、minor unit 捨入依 §4.0；逐行捨入尾差入 `RoundingDifference`（§4.0、§10.3）。
- TB 納入範圍＝該期所有 posted JE（自動 + manual，含 `VOIDED` 以最終狀態呈現，§8.4）；納入 period lock 之 `lightsSnapshot` 作為關帳證據（§14 步驟 7）。

### §11.2 ASU 2023-08 roll-forward（期間資產變動表）

US GAAP 落入 ASU 2023-08 FV-through-P&L 範圍之 crypto 資產（`asu_2023_08_applies=true`，§1.2 / §9.1），須逐資產出具期間 roll-forward：

| 列 | 內容 |
|---|---|
| 期初 FV | 期初公允價值餘額 |
| additions | 本期取得（購入 / 收款 / staking reward 等，§4.1） |
| disposals | 本期處分（依成本基礎 §7 減除，§4.2） |
| gains | 本期認列利益（處分已實現 + 期末重估未實現升值，§5.1） |
| losses | 本期認列損失（處分已實現 + 期末重估未實現貶值，§5.1） |
| 期末 FV | 期末公允價值餘額（＝期初 + additions − disposals + gains − losses） |

- **realized / unrealized 拆分**：gains / losses 之「已實現（處分）」與「未實現（期末重估）」拆分，需 **per-lot 累計 FV 調整追蹤**（逐 lot 記錄歷次重估之 FV 調整累計，以在處分時將先前未實現部分重分類為已實現）。此為**資料模型需求，見 §18**（Task 7 交棒；MVP 之 roll-forward 先出總額行，per-lot 累計 FV 追蹤之落庫 schema 於 §18 定義）。

### §11.3 揭露加厚小節（P1，二之8）

下列揭露列 P1（見商業冊 §7；MVP 先具備 §11.1 TB + §11.2 roll-forward）：

- **significant holdings 逐資產揭露**：重大持有部位逐一列示（資產名稱、期末數量、cost basis、期末 FV）。
- **出售限制（contractual sale restrictions）**：受合約性出售限制之持有（如 locked / vesting / staked 有期），揭露其性質與到期。
- **FV 變動損益表單行淨額**：本期 crypto FV 變動於損益表以單一淨額列示之揭露口徑。
- **cost basis method 揭露**：所採成本基礎方法（FIFO / WAC，§7.1 / §9.1）之揭露。

## §12 ERP export 規格

export 將已產生之 JournalEntry 以目標 ERP 之原生 import 格式輸出 CSV，供客戶匯入其總帳（GL）。MVP 支援 Xero manual journal CSV 與 QuickBooks Online（QBO）journal CSV（D8）；NetSuite 列 P1；SAP 不做（見商業冊 §6 非目標第 4 條、§7）。

### §12.1 export 批次語意與 exported 標記（權威定義，連動 §8.3）

export 以 **period 為批次單位**；產生批次時對納入之 JE 標記其 export 狀態。**本節為 exported 標記之權威定義（§8.3 交棒）**：

- **何時標**：JE 被納入一次 export 批次並成功產出目標 CSV 時，標記 `exported=true`，並記錄批次資訊：`export_batch_id`、匯出時戳、目標格式（`XERO` / `QBO` / …）、匯出人。
- **不可逆**：`exported` 標記一經設立即不可撤銷。其語意為「該 JE 已交付外部 ERP」——即使外部匯入失敗或客戶未實際匯入，帳簿端仍以已交付對待，不得清除標記以「重新視為未匯出」。
- **標記後帳簿端約束（reversal 路徑）**：已標記 `exported` 之 JE **只能反向沖銷（reversing entry），不得 void、不得就地改**（連動 §8.3；沖銷方式：新增金額相同、借貸方向相反之 JE，`memo` 引用原 `je_id`，再視需要補正確 JE）。未匯出 JE（`exported=false`）仍可 void（§8.3）。此界線＝「是否已標記 exported」，跨此界線一律沖銷。
- **冪等**：同一 period 重跑 export 不重複標記、不產生重複交付語意；重匯以新的 `export_batch_id`（批次版本）區隔，供追蹤「同一期第 N 次匯出」。冪等鍵＝（entity, period, 目標格式, batch 版本）。

### §12.2 Xero manual journal CSV 映射表

Xero manual journal 為官方原生 import、固定模板、匯入為 draft（安全，不直接過帳）、**單一帶正負號 Amount 欄**（借正貸負或依模板約定），無 mapping 步驟。逐欄位映射（欄名以官方 import 模板現行版本為準）：

| Xero 欄位 | 來源 | 映射原則 |
|---|---|---|
| Narration | JE header memo / reason | journal 敘述；**journal 分組鍵**（見 §12.6，首行填、續行留空以分組同一 journal 之多 line） |
| Date | JE 會計日（依 §6.4 cut-off） | 日期格式 per-locale（Xero US 版 `mm/dd/yyyy`，§12.6） |
| AccountCode | JE line 之科目 → 客戶 CoA account code（§10.3 對照） | 需 on-chain 類別 → 客戶 COA account code 對照表（§12.6） |
| TaxRate | 稅別 | MVP crypto JE 多為 `Tax Exempt` / `No Tax`；依客戶 CoA 設定 |
| Amount | JE line 金額 | **單一欄帶正負號**（借正貸負）；每張 journal `∑Amount = 0`（借貸相抵，§12.6 balance 驗證） |

> 其餘模板欄位（Description、Tracking 等）以官方 import 模板現行版本為準；本表僅定映射原則，不編造欄名。

### §12.3 QuickBooks Online（QBO）journal CSV 映射表

QBO 原生 import（Settings → Import data → Journal Entries）；**Debits / Credits 雙欄**（非單一帶號 Amount）；mapping UI 容忍 header 漂移。逐欄位映射（欄名以官方 import 模板現行版本為準）：

| QBO 欄位 | 來源 | 映射原則 |
|---|---|---|
| Journal No. | `export_batch_id` + JE 序 或 JE 編號 | **journal 分組鍵**（同一 journal 之多 line 共用同一 Journal No.，§12.6） |
| Journal Date | JE 會計日（依 §6.4 cut-off） | per-locale 日期格式 |
| Account Name | JE line 科目 → 客戶 CoA account name（§10.3 對照） | AP / AR 帳戶需 Name 欄（依 QBO 規則） |
| Description | JE line memo | 明細敘述 |
| Debits | JE line 借方金額 | 借方填此欄、貸方留空 |
| Credits | JE line 貸方金額 | 貸方填此欄、借方留空；每張 journal `∑Debits = ∑Credits`（§12.6） |

> 舊 plan / 地區之 import 覆蓋以官方文件現行版本為準；本表定映射原則。

### §12.4 已匯出 JE 之沖銷約定

已匯入 Xero / QBO 之 JE，**ERP 側不可改**——就地改會使兩邊帳不一致。帳簿端一律以**反向分錄再匯**處理（不 void、不就地改）：新增沖銷 JE（借貸方向相反、`memo` 引用原 `je_id`）→ 補正確 JE → 於次一 export 批次一併匯出。此約定與 §8.3「已匯出只能反向沖銷」為同一權威（§8.3 交棒 §12，見 §12.1）。

### §12.5 NetSuite（P1）與 SAP（不做）

- **NetSuite（P1）**：Import Assistant CSV 格式（每行一個 journal line、以 External ID 分組、header 欄重複）。**tenant 依賴度高**：Subsidiary（OneWorld 多實體）、account numbering 偏好、tax code 皆依客戶租戶設定，一份 CSV 無法通吃所有客戶，需 per-customer 欄位設定——故列 P1（見商業冊 §7），之後升級為 API connector（P2）。
- **SAP：明文不做**（見商業冊 §6 非目標第 4 條）。Dynamics / Workday / Sage Intacct 同不列入 MVP/P1 主打。

### §12.6 Exporter 通用設計要求（四格式共通）

- **journal-group 抽象**：exporter 內部以「journal-group」概念承載一張 journal 之多 line，per-format 序列化（Xero＝首行填 Narration+Date、續行留空；QBO＝共用 Journal No.；NetSuite＝共用 External ID）。
- **balance 驗證**：每張 journal 匯出前驗 `∑Dr = ∑Cr`（四格式 import 端皆驗餘額；不平不得匯出，對齊 §14 步驟 5 TB tie-out）。
- **日期格式 per-locale**（Xero US 版 `mm/dd/yyyy`；NetSuite 跟 tenant 設定）。
- **account 對照表**（on-chain 類別 → 客戶 CoA account code / name）為所有格式共同前置需求（§10.3），其價值大於任何單一格式支援。

## §13 Ingestion 與 Sui 資料層

本節定義鏈上 / 鏈下事件如何攝取、正規化為 NormalizedEvent，供規則引擎（§10）產生 JE。Sui 技術決策依 D7 與 review-findings 一之 1/2/4。

### §13.1 資料層決策表（D7）

JSON-RPC 於 **2026-07-31 永久停用**，現行 `SuiJsonRpcSource` 必須汰換。分兩條 workload：

| workload | 技術 | 說明 |
|---|---|---|
| 增量攝取（live） | gRPC **checkpoint streaming**（`SubscribeCheckpoints`） | 訂閱 checkpoint 流，逐筆處理新交易；gRPC 為 transport |
| 歷史 backfill + 逐期餘額重建 | **custom indexer**（tail checkpoint 落自有 DB） | 「過去某 checkpoint 的餘額」無法 live 查，須自 indexed 歷史重建；gRPC 僅 transport，落庫由自建 indexer 負責 |
| 輔助查詢 | GraphQL（beta） | 僅作 backfill 輔助，**不當主查詢層**（仍 beta） |

### §13.2 Sui tx normalization 層（六形態，一之 4）

1 筆 Sui 交易須經正規化層拆為 N 個 NormalizedEvent，否則漏接以下形態：

- **(a) PTB 多指令原子分解**：一個 PTB（programmable transaction block）1 digest 可含多指令，須分解為 **1 digest → N events**（否則 swap + transfer + gas 同筆誤記為一事件）。分解後各 event 保留同一 `tx_digest` 與指令序，供回溯原子性。
- **(b) gas 淨額（可為負）**：`gas = computation + storage − rebate`（storage rebate 為釋放物件退還之押金）；**淨額可為負**（rebate > computation+storage 時）。gas 事件金額須為此淨額，映射 §4.4 FEE_GAS。
- **(c) sponsored tx payer 欄位**：sponsored transaction 之 gas payer ≠ entity（第三方代付）。gas 事件須帶 **payer 欄位**；payer ≠ entity 時，該 gas 非 entity 費用（記錄但不入 entity gas 費用），避免誤計。
- **(d) 有價 object 物件級移動**：NFT / StakedSui / LP position / Kiosk 內物件等**有價 object 以物件移動呈現**，只讀 `balanceChanges` 會漏——須讀 `objectChanges` 捕捉物件級移轉（取得 / 處分 / 內部移轉）。
- **(e) coin split / merge 過濾**：coin 物件之 split / merge 為錢包內部 churn（同一 owner 拆併 coin），**須過濾**，否則產生假事件（假收 / 假付）。判準：owner 不變之純 split/merge 不生 NormalizedEvent。
- **(f) accumulator / native-balance 形態**：accumulator / native-balance 直接借貸不產生 coin object，讀 `objectChanges` 會漏——須另讀 native-balance 變動捕捉此形態。

### §13.3 餘額與期間歸屬

- **期末餘額用 `addressBalance`**（gRPC，涵蓋全類型資產；`coinBalance` 只含同質幣，會計期末須全類型故用 `addressBalance`）。
- **歷史餘額由 indexer 重建**（§13.1；過去 checkpoint 餘額無法 live 查）。
- **期間歸屬 / cut-off**：沿用 §6.4 定義之 entity 時區日切 `to_date(block_ts_utc, entity_tz)`，**不重定義**（§14 月結亦引用同一定義）。

### §13.4 通用 CSV import（CEX 對帳單 → NormalizedEvent）

MVP 提供通用 CSV import，將 CEX 對帳單 / 交易明細映射為 NormalizedEvent（CEX 存提為 transfer 子型，D16 / §4.6）。映射原則：CSV 每列 → 一個 NormalizedEvent；必要欄位（時間、資產、數量、方向、對手 / 帳戶）映射至 NormalizedEvent 標準欄位；缺欄或無法解析 → fail-closed 進 review queue（不臆測，對齊 §10.2 fail-closed 邊界）。具體 CEX 欄位以來源交易所對帳單現行格式為準。

### §13.5 排程與冪等

- **NormalizedEvent 唯一鍵**：以（source, `tx_digest` / 對帳單列鍵, 指令序 / leg 序）構成唯一鍵；重放 checkpoint 或重匯 CSV 時，同鍵事件不重複落庫（冪等攝取）。
- **排程**：live 攝取隨 checkpoint 流持續進行；backfill 為批次補歷史。二者以唯一鍵去重，確保 live 與 backfill 交疊區間不產生重複事件。

## §14 月結流程（close checklist）（MVP，二之 5）

月結為編號 1–9 之順序流程，每步有可判定之 **blocking 條件**，對齊現有 close-readiness lights 概念（六 lights：classification / JE / recon / completeness 為 blocking＝real+derived；pricing / export 於 MVP 為 mock 不 block，production 反轉為 real-and-blocking）。「一位會計師照章走完一次月結」須能逐步引用本編號（後續 desk check）。

| # | 步驟 | blocking 條件（不滿足則擋下） |
|---|---|---|
| 1 | **事件全分類**（review queue 清空） | classification light 綠：該期 review-queue pending count = 0（無未分類事件） |
| 2 | **exceptions 結清** | `close-readiness.exceptions.blocking` = 0（所有 blocking exception 已 disposition） |
| 3 | **recon 乾淨或 break 已 disposition** | recon light 綠：`close-readiness.recon.blocking` = 0（wallet↔subledger 對帳無 break，或每筆 break 已標 disposition） |
| 4 | **期末重估過帳** | 該期所有落 ASU 2023-08 / impairment 範圍資產之期末重估分錄（§5）已產生並 posted；缺價 fail-closed（§6.3）未解 → 擋（MVP pricing 為 mock light 不入 blocking，但重估分錄本身缺漏會使步驟 5 TB / 步驟 6 roll-forward 不成立） |
| 5 | **TB 產出複核** | JE light 綠：**個別 JE 平衡**（每筆 `∑Dr=∑Cr`）**且 TB tie-out**（整表 `∑Dr=∑Cr`、`∑closing_balance=0`，§11.1）；二者皆須綠（個別平衡 ≠ TB 平衡） |
| 6 | **roll-forward** | completeness light 綠：ASU 2023-08 roll-forward（§11.2）逐資產產出且 期初+additions−disposals+gains−losses=期末 對得起 TB 期末餘額 |
| 7 | **period lock** | 後端**重算**所有 blocking lights，全綠方可 OPEN→LOCKED；任一 blocking light 非綠 → 擋（`LIGHTS_NOT_GREEN`）。lock 時凍結 `lightsSnapshot`（關帳當下 lights 之不可變證據）、`locked_at`、`locked_by` |
| 8 | **snapshot + anchor** | 須 status=LOCKED 方可 snapshot（LOCKED-gate）；snapshot 之 Merkle Root 經 audit_anchor 合約上鏈（hash-only、cap-based 授權，§17 / 商業冊 §5-7）。Walrus 前 manifest 僅存自有 DB（D5） |
| 9 | **export ERP** | 依 §12 產生 Xero / QBO CSV 批次；納入之 JE 標記 `exported`（§12.1，不可逆）。匯出前每張 journal 驗 `∑Dr=∑Cr`（§12.6） |

- 步驟 1–3 對應 review / exception / recon 三道 gate；4–6 為帳務結算與報表產出；7 為會計關帳（Lock）；8 為完整性上鏈（Anchor，疊加於 Lock 之上）；9 為對外交付。
- **blocking = real + derived**（classification / JE / recon / completeness）；pricing / export 於 MVP 為 mock，**不 block 但顯示 mock 狀態**（不得假綠、不得用 aqua）；production 反轉為 real-and-blocking。lock 之 blocking 判定由後端重算、不信 client 輸入。

### §14.1 period reopen 程序（二之 11）

已 lock（或已 anchor）之期間若需調整，須經 reopen；判準與對已 anchor Merkle root 之處理：

- **lock 後調整 vs 入次期之判準**：
  - **入次期**（優先，不 reopen）：發現之調整屬**次期事項或非重大**者，以次期分錄處理（如應計迴轉、後續期間新事實），不動已關期間。
  - **reopen 已關期間**：僅當調整屬**已關期間之重大更正 / 重編（restatement，ASC 250 / IAS 8）**、且必須反映於該期報表時，才 reopen。reopen 須記 `reopen` 事由（`restatement_reason` / `reason_code`）。
- **reopen 對已 anchor Merkle root 之處理**：
  - reopen 一個**已 anchor** 之期間：狀態回 OPEN，該期標記 **`staleAnchor`**（曾 anchor 後 reopen 且尚未 re-anchor）——舊 Merkle root 仍在鏈上（不可竄改），但已不代表現行帳本。
  - **re-anchor（重錨）**：修正後須 **re-lock**（回 LOCKED，`/snapshot` 之 LOCKED-gate 強制此步）→ 重出 snapshot → re-anchor。re-anchor 之 anchor 以 **`supersedes_seq` 指向前一版 seq**（引用 audit_anchor 現有合約語意：`supersedes_seq` 為 metadata，鏈上不驗；同 period restatement 產生 seq=N、`supersedes_seq=N−1`），使新 anchor 取代（supersede）前版 on-chain snapshot；`staleAnchor` 於 re-anchor 後清除。
  - **實作現況**：B1 之 freeze 路徑尚未產生 v2 superseding snapshot（reopen-of-anchored 僅設 `staleAnchor`、可 re-lock，但產生鏈上 v2 為已追蹤之未來升級；Move 合約已支援 `supersedes_seq`）。本規格為目標態，實作差距見既有 anchor 服務追蹤紀錄，不阻本節目標態定義。

## §15 UI/UX 標準（D17）

前端設計系統（TallyMarina：paper/ink/brass/aqua 色階、語意色合約、mascot governance、break-precision 渲染）具真意圖，達 GTM 水準；問題是**執行落差**（見 `tasks/review-findings-2026-07-11.md` 三、frontend-design review「執行落差」1–9 項：字體未實際載入、字體雙重宣告來源矛盾、journal 金額無 formatter、表格實作四套、badge/pill 五套與對比度違規、版面骨架 inline style、裸原生按鈕、標題層級不一致、Exceptions 摘要數字過小）。**該執行落差修復批次屬 MVP 實作範圍**（分期見商業冊 §7），本節只定規格條文，落差清單以引用方式收錄、不重抄。

下列 5 條為可判定規格條文（`tasks/review-findings-2026-07-11.md` 三、frontend-design review「規格條文」1–5 條照錄），每條附判定方式：

| # | 條文 | 判定方式 |
|---|---|---|
| 1 | **金額必經 formatter**：千分位 + scale 換算 + U+2212（負號），數字欄一律右對齊、`tabular-nums`、等寬字體；scale 未知時渲染 raw minor 並帶 `?` 上標，**禁止 default scale**（未知 scale 視為缺陷，不得靜默假設） | grep 檢查表格/金額渲染元件是否呼叫統一 formatter（如既有 `fmtMinor`，`web/src/workspaces/recon/ReconTable.tsx`）而非直接插值 raw 數字；`web/src/test/mascot-governance.test.tsx` 同族之 data-surface 測試模式延伸驗證金額欄位 |
| 2 | **語意色合約**：aqua 僅用於 on-chain / anchor 相關狀態；credit / debit 色僅用於借貸方向與流程通過 / 阻擋語意；brass = manual / off-chain 與導航 CTA；status 色（燈號等）必伴隨非顏色線索（圖示 / 文字），不得單靠色彩傳達語意；brass 底文字必為 ink 色，**禁止白字**（對比 < 4.5:1 即判定 fail，WCAG AA） | grep 掃描元件 CSS/TSX 內 brass 底 class 是否搭配白字 token（如 `beea832`/`6a272e0` 已修復案例之反例掃描）；對比度以 4.5:1 為量化門檻，可用色值算 contrast ratio 腳本驗證 |
| 3 | **token-only styling**：元件禁用 hex 字面值，禁繞過既有 type scale；表格 / badge / button 必用 shared primitive（不得複製貼上另建一套） | **stylelint `declaration-strict-value`** 規則掃描 `web/src/**/*.css`（禁 hex/color 字面值，強制引用 CSS custom property）；grep 統計表格 / badge 實作套數是否收斂至 1 套 primitive + modifier |
| 4 | **字體單一來源**：`display=Fraunces`、`mono=IBM Plex Mono`、`body` 必須實際被瀏覽器載入（非 fallback 到 system-ui）；宣告只能單一出處，**禁止 `@import` 與 `<link>` 並存** | grep `web/index.html` 與 `web/src/tokens.css` 確認僅一處聲明 body 字體來源；瀏覽器 devtools / build 產物檢查 `Mona Sans`（或替代字體）之 `font-family` 實際生效（非退回 system-ui） |
| 5 | **data-surface 紀律**：mascot / 裝飾元素禁止出現於 journal 表、hash 顯示、對帳格（recon grid）、簽名 modal 等資料密度高、須被信任的介面 | 沿用既有測試 `web/src/test/mascot-governance.test.tsx`（驗收方式即該測試通過；新增 data-surface 元件須追加同類斷言） |

## §16 對帳

MVP 對帳範圍為 **wallet ↔ subledger**；**↔ ERP 第三層列 P1**（見商業冊 §5「Reconciliation」模組分期）。對帳掛入 §14 月結步驟 3（「recon 乾淨或 break 已 disposition」，引用該步驟編號，不重定義）。

### §16.1 wallet ↔ subledger 對帳（MVP）

- **book balance**：由 `lot_movement` 折疊而成——即該 wallet × coinType 之期初餘額（opening）加計本期 JE 借貸淨額（movement，依 §7 lot 異動 net 而得），`OPENING_LOT` 之 `ACQUISITION` 腿屬期初宣告、不計入本期 movement（避免與 opening 重複計）。
- **chain balance**：目標態取自鏈上 `addressBalance`（gRPC，全類型資產，§13.3；不用 `coinBalance`，理由同 §13.3）。
- **break**：`break = book_balance − chain_balance`；`|break| ≥ threshold` 判定為 material（threshold 依資產可配置；零容差時 threshold=0，非零 break 即 material）。break 物件同時保留 opening / movement / computed（book）/ statement（chain）/ break / threshold 五值與借貸 control 總數（∑debit、∑credit、legs），供審計回溯差異來源，不只顯示淨額。
- **disposition 流程**：沿用既有 exception disposition 狀態機語意——`open → resolved / dismissed / deferred`；`deferred` 可回 `open`；`resolved` / `dismissed` 為終態。僅 `resolved` 與 `dismissed` 解除 close-blocking；`open` 與 `deferred` 持續 block（§14 步驟 3 之 `recon.blocking` 計數依此判定）。disposition 須留 `reason_code`（枚舉：`timing` / `error` / `fee` / `fx` / `in-transit` / `unidentified` / `OTHER`）、`reason_note`（自由文字）、`decided_by`、`decided_at`，供審計回溯 break 之人工判斷依據。
- **未註冊資產（unregistered asset）**：break 涉及尚未於 asset registry 登記之 coinType 時，`decimals` 為 `null`（scale 未知，禁止預設，§15 條文 1 之精神延伸），介面須誠實呈現「未知 scale」而非假設，並提供「登記資產」CTA（brass 語意色，§15 條文 2）。

### §16.2 subledger ↔ ERP 對帳（P1）

已匯出 ERP（§12）之 JE 與 ERP 側實際入帳結果之第三層比對（偵測匯入失敗、客戶端手動改動等），列 P1（見商業冊 §7、§5「Reconciliation」模組分期表）；MVP 範圍不含此層，§12.1 之 `exported` 標記已足以支撐 MVP 的「已交付」語意判定。

## §17 審計層

`audit_anchor` 合約為**完整性層**（integrity layer，非可取回性層——見過渡語意）：

- **chain head**：`EntityAnchorChain`（shared object，固定大小，只存最新鏈頭，歷史以 event 存放，非物件累積增長）。
- **seq**：單調遞增序號，每次 anchor 產生新 `seq = 前 seq + 1`，為鏈上正典順序。
- **supersedes_seq**：restatement（重編）時新 anchor 之 metadata 欄位，指向其取代之前版 `seq`（鏈上不驗證此欄位之語意正確性，僅作記錄；見 §14.1 之 re-anchor 流程，本節不重規格）。
- **Merkle inclusion proof**：`SnapshotAnchored` event 攜帶 32-byte `merkle_root`；單筆 JE 之 inclusion proof 對此 root 驗證（off-chain 驗證，鏈上僅存 hash，不存明細——保護隱私、同時可驗證性）。
- **cap-based 授權**：寫入權限由**擁有型 `AnchorCap`**（非 `ctx.sender()`）承載，並綁定 epoch（`cap_epoch`）；cap 過期（rotate 後）之寫入呼叫 abort，防 sponsored tx 場景下之偽造授權。
- **hash-only 上鏈**：僅存 32-byte `manifest_hash` 與 `merkle_root`（及其鏈式雜湊 `link = sha2_256(prev_link || manifest_hash || merkle_root || period_id || bcs(seq))`），不存 JE / positions 明細本體。

以上合約語意**引用現有 `move/audit_anchor/sources/audit_anchor.move` 實作，本節不重規格**（合約細節、狀態轉移、錯誤碼等以合約原始碼為準）。

### §17.1 過渡語意（D5，明文）

**Walrus P1 前，manifest 只存自有 DB**——鏈上 anchor 僅證明「該 Merkle root 於某時點存在且未被竄改」（完整性），**不證明資料可取回性**（availability）；manifest 本身（描述一組審計相關檔案之清單，見商業冊附錄 B「Manifest」詞條）於 Walrus 上線前僅落自有資料庫，不具備去中心化可取回性保證。此為目標態下之**過渡態**，非缺陷：完整性層（anchor）與可取回性層（Walrus）為獨立能力，前者 MVP 即具備，後者列 P1。

### §17.2 P1：Walrus 審計包 + Seal 存取控制（D14）

**Walrus 審計包**（P1）與 **Seal 加密存取控制**綁定同列 P1，不得拆開規劃（審計包含 JE 財務明細，若以公開 blob 形式存放 Walrus 即等同洩漏客戶財務資料；故上 Walrus 之審計包必須同時具備 Seal 的存取控制加密，二者為同一 P1 交付單元，D14）。

- **審計包內容**：JE（journal entries，含明細）、positions（PositionLot 狀態）、recon（對帳紀錄與 break disposition）、manifest（描述本包內容之清單，與現行 DB-only manifest 為同一詞條之 P1 擴充版）。
- **P1 交付需同時具備**：(1) 審計包封裝上傳 Walrus；(2) Seal 的 threshold encryption 存取控制策略，限定僅授權對象（entity 自身、其審計師）可解密取回；缺一不得單獨上線（純 Walrus 無 Seal = 洩漏風險，純 Seal 無 Walrus = 無去中心化可取回性）。

### §17.3 anchoring gas 之 sponsored tx 評估

anchor 動作消耗 SUI gas；sponsored transaction（Enoki）/ gasless 模式可降低企業客戶之 gas 管理負擔，是否納入 P1 Walrus 審計包 + Seal 批次一併規劃，**評估詳見商業冊附錄 C**（本節不重複評估內容，僅指路）；若採 sponsored tx，需同步考量 gas payer ≠ entity 情境下之 payer 欄位記錄需求（呼應 §13.2(c) sponsored tx payer 欄位設計，同一資料需求適用於 anchoring gas 與一般鏈上事件 gas）。

## §18 資料模型

本節將 F6（`首版資料模型與會計規則引擎設計.md`，見 `tasks/ideas-summary.md` §2.4）之 10 核心實體對照現有 schema（`services/api/src/store/schema.sql`），並收錄 rev2 review 新增之資料模型需求（PolicySet 表、MappingRule 表、PricePoint 表、manual JE 支援、change log 表、opening lot 導入、per-lot 累計 FV 調整追蹤）。

### §18.1 F6 十實體 ↔ 現有 schema 對照表

| F6 實體 | 現有 schema 落點 | 對照說明 |
|---|---|---|
| **Entity** | `entities` | 已落地：`id` / `display_name` / `chain_object_id` / `cap_object_id` / `original_package_id`。多實體隔帳之基礎維度（商業冊附錄 B）。 |
| **AccountSource** | 無獨立表；現以 `events.raw_json` 內嵌來源資訊 + `entities.chain_object_id`（鏈上來源）承載 | **落地缺口**：AccountSource（錢包地址 / CEX API 帳戶 / CSV 匯入設定）尚無獨立表落庫版本化；MVP 現況以 event 層內嵌來源欄位替代，未來若需管理多 AccountSource 之啟用狀態 / 憑證，需補獨立表（本規格不因此新增表——現況足以支撐 MVP ingestion，屬附錄 A 現況差距追蹤範圍，非阻斷）。 |
| **RawTransaction** | `events.raw_json`（含 `events.id` / `entity_id` / `status` / `period_id`） | `raw_json` 即未經會計判斷之原始攝取內容，`events` 表本身 append-only（無 UPDATE raw_json 之路徑），符合 F6「永不覆蓋、可重跑」原則。 |
| **NormalizedEvent** | `events`（`ai_event_type` / `ai_purpose` / `ai_counterparty` / `ai_confidence` / `ai_reasoning` / `final_event_type` / `final_purpose` / `status` / `period_id`） | AI 建議欄位（`ai_*`）與人工核定欄位（`final_*`）分離，符合「AI 只建議、人工 approve」原則（§10.2 fail-closed 邊界之資料面對應）。 |
| **PositionLot** | `lot_movement`（append-only lot 異動帳，非直接存 lot 現值） | `lot_movement` 為**異動事件表**（`delta_qty_minor` / `delta_cost_minor` 帶號增減），非 F6 原意之 lot 現值快照表；`remaining_qty`（§7.2）為**衍生值**（fold 該 `lot_id` 全部 movement 而得，非落庫欄位）。此為既有實作之衍生帳設計（表頭註解：「Derived ledger: rows are a materialized audit trail; truth is recomputable from events」），本規格採現況、不要求另建現值快照表。 |
| **PricePoint** | **現有 schema 無此表**（見 §18.2 新增需求） | rev2 新增需求，§6 已定欄位規格，落庫需新建表。 |
| **PolicySet** | **現有 schema 無此表**（見 §18.2 新增需求；現況為程式碼常數 `DEMO_POLICY_SET`） | §9 已定欄位規格，落庫需新建表，取代現行常數（§9 開頭）。 |
| **MappingRule** | **現有 schema 無此表**（見 §18.2 新增需求；現況為程式碼常數 `DEMO_COA_RULES`） | §10 已定結構，落庫需新建表，取代現行常數（§10 開頭）。 |
| **JournalEntry** | `journal_entries`（`je_json` / `idempotency_key` / `leaf_hash` / `period_id`） | header+lines 以 `je_json` 整包存放（非逐欄正規化）；`leaf_hash` 供 Merkle tree 葉節點（§17 anchor 之 inclusion proof 基礎）；`idempotency_key` 防重複出帳。manual JE（§8）沿用同一表，以 `je_json` 內之 `source_event_id`（空值）與 `status`（手工標記）區分（見 §18.2）。 |
| **ReconciliationRecord** | `recon_break_disposition`（disposition 覆蓋層）+ recompute-on-read 之 break 計算（`lot_movement` 折疊 + recon fixture，非落庫之比對結果） | break 本身**不落表**（recompute-on-read，見 §16.1 引用之 `collectBreaks` 語意：「NO writes」），僅 disposition（人工判斷結果）落 `recon_break_disposition`；`recon_break_disposition_log` 為其 append-only 異動歷史。此為既有「唯讀重算 + 覆蓋層落庫」之設計選擇，本規格採現況。 |

F6 十實體之外，既有 schema 尚有若干支撐月結、審計、review workflow 之表未落在 F6 概念模型內（F6 為 2026 年初資料流設計，晚於 close/audit/review 等能力之落地）；為求 §18 對照表完整覆蓋，逐一列於下表，各自連回已定義之規格節次：

| 既有表 | 支撐之規格節次 | 對照說明 |
|---|---|---|
| `snapshots` | §14 步驟 8（snapshot + anchor）、§17 | 月結 LOCKED-gate 後產出之帳本快照，含 `manifest_json` / `manifest_hash` / `merkle_root` / `leaf_count` / `seq` / `supersedes_seq`；`seq`/`supersedes_seq` 對應 §17 audit_anchor 合約之鏈上同名欄位語意（§14.1 restatement 流程）。 |
| `anchors` | §17 | `snapshots` 上鏈紀錄，`link` / `digest` / `explorer_url` / `seq` 對應 §17 所引用之 `audit_anchor` 合約 `SnapshotAnchored` event 資料。 |
| `period_lock` | §14 步驟 7、§14.1 | 期間鎖定狀態機（`status` / `locked_at` / `locked_by` / `lights_snapshot` / `reopened_at` / `reopen_count`），承載 §14 步驟 7 之 lock 判定與 §14.1 之 reopen 程序（`restatement_reason` / `reason_code`）。 |
| `asset_registry` | §2、§15 條文 1（scale 未知不得預設） | 資產（coin type）之 `decimals` / `symbol` / `display_name` / `source`（`chain`/`manual`）登記表；§16.1 未註冊資產 break 之 `decimals=null` 即查此表得空結果之情形。 |
| `exception_disposition` | §14 步驟 2（exceptions 結清） | review queue 中各類 exception（如 §6.3 `PRICE_MISSING`、§7.3 `LOT_SHORTFALL`、§10.2 `MAPPING_MISSING`）之人工 disposition 覆蓋層，狀態機與 §16.1 recon disposition 同源（`open`/`resolved`/`dismissed`/`deferred`，`assertDispositionTransition` 共用）。 |
| `triage_proposal` | §10.2 fail-closed 邊界（AI 只建議、人工 approve） | AI 對 exception 之處置建議（`action` / `reason_code` / `rationale` / `confidence` / `model`），`status` 預設 `proposed`，須人工 `decided_by` 核定，符合「AI 只建議不自動 posting」原則（ideas-summary §2.4 設計原則第 4 條）。 |

`recon_break_disposition` 已於 §18.1 之 **ReconciliationRecord** 列對照，`events` / `journal_entries` / `lot_movement` 已於 §18.1 之 **NormalizedEvent** / **JournalEntry** / **PositionLot** 列對照，十表全數收錄完畢。

### §18.2 rev2 新增資料模型需求（逐條）

以下七項為 rev2 review（會計師視角 findings 1/2/8/14/15；D19）命中、現有 schema 未覆蓋之落庫需求：

1. **PolicySet 表**（§9）：落地 §9.1 全欄位（`accounting_standard` / `functional_currency` / `reporting_currency` / `cost_basis_method` / `stablecoin_treatment` / `crypto_classification_default` / `staking_income_policy` / `fee_expense_policy` / `revaluation_policy` / `asu_2023_08_applies`），每 entity 一個 active PolicySet，`policy_set_version` 遞增、舊版本保留（§9.2）；取代 `DEMO_POLICY_SET` 常數。
2. **MappingRule 表**（§10）：落地 §10.2 三層規則結構（分類規則 / 政策規則 / 分錄生成規則），JSON 化、帶 `rule_version`；取代 `DEMO_COA_RULES` 常數；條件維度含 event_type / leg / asset_class / economic_purpose / accounting_standard / stablecoin_treatment。
3. **PricePoint 表（含 hierarchy level）**（§6.1）：落地 `price_point_id` / `asset_id` / `quote_currency` / `price` / `as_of` / `source` / `fv_hierarchy_level`（`LEVEL_1` / `LEVEL_2`）/ `principal_market` / `ingested_at` / `staleness_seconds`；JE 引用之 `price_point_id` 隨 JE 留存供審計回溯（§6.1 末段）。
4. **manual JE 支援**（§8）：`journal_entries` 表結構沿用（`je_json` 承載 header/lines），需擴充語意標記——`source_event_id` 允許空值（manual 來源無源事件）、`status` 增列手工來源標記、`preparer` / `reason` / reviewer（選填）欄位（§8.1）；void / reversal 狀態（`VOIDED`、沖銷 JE 之 `memo` 引用原 `je_id`，§8.3）落於同一表之 `je_json` 或擴充欄位。
5. **change log 表**（§9.3，D19）：新表，append-only，記錄 PolicySet / MappingRule 變更與 review 人工決策：`who`（`decided_by`）/ `when`（時間戳）/ `what`（變更對象、before/after 值、reason）。既有 `exception_disposition_log`、`recon_break_disposition_log`、`triage_proposal_log`、`asset_registry_log` 為同一 append-only-log 模式之現況先例（本規格新表沿用相同模式：主表 + `_log` 影子表）；PolicySet/MappingRule 落庫後，其 change log 比照此模式新建。
6. **opening lot 導入**（§7.3）：`lot_movement` 表既有 `OPENING_LOT` 事件路徑（`je_id` 欄位註解明載：「NULL for zero-basis OPENING_LOT (no JE) and pre-feature legacy rows; non-zero OPENING_LOT does get a JE」），落庫路徑已存在；本規格新增之要求為**匯入格式**（§7.3 之 `asset` / `qty` / `unit_cost` / `acquisition_date` / `source_note` 五欄，見 §7.3 表），非新建表——沿現有 `lot_movement` + 對應 `journal_entries` 落地。
7. **per-lot 累計 FV 調整追蹤**（§11.2 依賴）：**現有 schema 無此落點**——`lot_movement` 目前只記 `delta_qty_minor` / `delta_cost_minor`（取得/處分之數量與成本異動），不記期末重估（§5）對個別 lot 之累計 FV 調整。為支撐 §11.2 roll-forward 之 realized/unrealized 拆分（處分時將該 lot 先前未實現部分重分類為已實現），需新增落庫維度：逐 lot 記錄歷次期末重估之 FV 調整累計（`lot_id` × 累計調整額，隨每次重估 JE 更新或以新增 movement-like 列追加，沿用 `lot_movement` 之 append-only 精神）。MVP 之 §11.2 roll-forward 先出總額行（不逐 lot 拆分），本落庫需求供未來 realized/unrealized 逐 lot 拆分擴充時使用；不阻 MVP 月結（§14 步驟 6）。
