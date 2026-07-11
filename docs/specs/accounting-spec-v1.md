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

（本節由 Task 5 填寫）

## §7 Cost basis

（本節由 Task 5 填寫）

## §8 Manual JE / Adjustment / Reversal（MVP）

（本節由 Task 5 填寫）

## §9 PolicySet schema

（本節由 Task 5 填寫）

## §10 CoA 與 MappingRule

（本節由 Task 5 填寫）

## §11 Trial balance 與揭露

（本節由 Task 6 填寫）

## §12 ERP export 規格

（本節由 Task 6 填寫）

## §13 Ingestion 與 Sui 資料層

（本節由 Task 6 填寫）

## §14 月結流程（close checklist）（MVP）

（本節由 Task 6 填寫）

## §15 UI/UX 標準

（本節由 Task 7 填寫）

## §16 對帳

（本節由 Task 7 填寫）

## §17 審計層

（本節由 Task 7 填寫）

## §18 資料模型

（本節由 Task 7 填寫）
