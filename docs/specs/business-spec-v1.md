# 商業規格書 v1.0

版本：v1.0　日期：2026-07-11　狀態：Draft

## §1 產品定位與問題陳述

（本節由 Task 2/3 填寫）

## §2 ICP 三層

（本節由 Task 2/3 填寫）

## §3 GTM 分階段與商業模式

（本節由 Task 2/3 填寫）

## §4 競品與差異化

（本節由 Task 2/3 填寫）

## §5 功能模組總覽

（本節由 Task 2/3 填寫）

## §6 非目標

（本節由 Task 2/3 填寫）

## §7 分期 Roadmap

（本節由 Task 2/3 填寫）

## 附錄 A 現況差距對照

（本節由 Task 2/3 填寫）

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

（本節由 Task 2/3 填寫）
