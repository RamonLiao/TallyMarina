# Codex 最終驗收 R3

**驗收日期**：2026-06-19  
**驗收文件**：`specs/business-spec-v3.md`、`specs/accounting-spec-v3.md`、`reviews/claude-review-r2.md`、`reviews/codex-review-r2.md`

## 結論先行

7 條收斂條件中，**5 條關閉、2 條未關閉**。v3 已大幅收斂，但嚴格而言仍未達「規格無內部矛盾、可直接簽固定範圍付費 design-partner pilot」的門檻。

未關閉項目：

1. 唯一 capability matrix 仍被 matrix 外的 Demo／pilot deliverable 文字重述並擴張，DeepBook 與 Walrus 邊界回潮。
2. 8 個 ADR 雖有完整欄位框架與狀態機，但 owner 未逐筆具名，且其中 7 個仍是 `DESIGN_BLOCKED`；另有不存在的 test case ID，尚不能證明記錄可執行。

此外有一個新的高嚴重度 schema 迴歸：Paid Pilot 對 SUI 使用 `INTANGIBLE_ASSET_IAS38_COST`，但 canonical `accounting_class` enum 是 `INTANGIBLE_IAS38_COST`。

## A. 7 條逐條驗收

| # | 收斂條件 | 判定 | v3 證據與獨立判斷 |
|---:|---|---|---|
| 1 | 唯一 paid-pilot capability matrix；§2.5／§5／§9／§17 不再衝突 | **未關閉** | 商業規格 §2.5 已建立 Demo／Paid Pilot／Post-pilot 唯一表：Paid Pilot 為指定 Sui wallet、5 個事件、IFRS 成本模式、FIFO、generic CSV、wallet recon、內部 snapshot 必須且 Walrus optional。§5.1、§9、§17 均正確引用 §2.5，四節彼此已一致。但「唯一」要求仍被其他章節破壞：§7.5 再列 Demo 能力，包含 `swap／DeepBook trade` 及「建立 Walrus close snapshot」，與 §2.5 Demo source 僅 Sui wallet、Walrus 僅「可展示」的邊界不完全一致；§14.6 又把 `Walrus audit manifest` 列為 Pilot 成功交付物；附錄 E.3 再寫 `1 entity、5 events、CSV`。因此 source、Walrus acceptance 與 scope 仍無法只由 matrix 唯一推導。§4.1 的一般 onboarding 亦列 CEX／custody／CSV，未明示為 Post-pilot。 |
| 2 | 8 個 Accounting Decision Record 各有 owner／deadline／source／facts／test case 與狀態機 | **未關閉** | 會計規格 §5.6 已定義 `DESIGN_BLOCKED → DECIDED → IMPLEMENTED → FIXTURE_APPROVED`，並規定不可跳階、只有 `FIXTURE_APPROVED` 可於 Paid Pilot 啟用。表中 8 筆均有 deadline、authoritative source、facts、test case 欄；但 owner 沒有逐筆欄位，只以表外「預設 owner 均為具名外部會計師」統包，且沒有實際姓名或可識別角色 ID，不符合「各有 owner」的可追責要求。`ADR-P1-005` 引用 `GF-CLOSE-IMPAIRMENT`，§7.8 並不存在該 fixture；`GF-ALL-PROFILE`、`GF-ALL-MISSING-PXFX`、`GF-ALL-DISCLOSURE`、`GF-PROFILE-REJECT-CEX` 亦只有引用、沒有 fixture 定義。除 `ADR-P1-008` 外，其餘 7 筆初始狀態仍為 `DESIGN_BLOCKED`，這可作 gate，但不能宣稱決策本身已關閉。 |
| 3 | PolicySet active schema 移除 deprecated 欄位，只留 migration adapter | **關閉** | 會計規格 §5.1 發布 Draft 2020-12 JSON Schema，`additionalProperties: false`；active properties 不含 `measurement_path`、`stablecoin_treatment`、`default_token_classification`、`crypto_classification_default`。同節明定 legacy 欄位只可由 migration adapter 讀取，轉成 candidate 並人工核准後丟棄，不得持久化或作 decision source。商業規格附錄 A.1 僅引用該 schema，未另造欄位。 |
| 4 | JE／export transition table 完整，含 partial rejection 合法前置狀態 | **關閉** | 會計規格 §6.7 逐列定義 current state、event、guard、next state、audit fields。`REJECTED` 可由 `APPROVED` pre-export reject、`EXPORTED` transport/schema reject、`EXPORTED` partial acceptance、`ACKNOWLEDGED` 後續 ERP reject 進入；`POSTED` 只能更正至 `REVERSED`。Partial acceptance 的 accepted subset hash、line ERP ID/status/reason、replacement／void 行為均有定義。商業規格 §5.1 明確引用此唯一表並否定 `POSTED → REJECTED`。 |
| 5 | 5 事件 golden fixtures 各含 happy／scope-unknown／missing-price-FX／insufficient-lot／replay-reversal，且 JE 平衡 | **關閉** | 會計規格 §7.8 對 receipt、payment、internal transfer、swap、gas 各提供 5 個指定 permutation，共 25 列；每列包含 expected JE、lot roll-forward、DisclosureFact、exception/replay、citation，並定義共同 lineage hash inputs。所有有金額 JE 均可重算平衡：receipt 300=300；payment 80=50+30；internal transfer 120=120；swap 300=200+100；gas 8=5+3；各 reversal 亦平衡。對 receipt 的 insufficient-lot 明定為不消耗 lot、不得誤報；internal transfer 的 missing-price 明定成本模式下不要求新價格，均屬合理的負向斷言。注意：fixture「存在於規格」已通過，不代表 ADR 已達 `FIXTURE_APPROVED` 或 runner 已實作。 |
| 6 | §17 internal snapshot 必須、Walrus optional | **關閉** | 商業規格 §17 明定內部 immutable audit snapshot 為完成條件，Walrus 為 optional asynchronous publication，未發布或失敗不得阻擋 close 或造成 Paid Pilot 驗收失敗。§4.5、§6.8、§8.3、§7.2 亦採相同控制。此項就 §17 本身已關閉；但 §7.5、§14.6 的重述仍構成第 1 項 scope 問題。 |
| 7 | 去重已查證仍標 `[需查證]`；修排版 | **關閉** | R2 點名的會計 §2.2 broker-trader、§2.4 wrapped scope、§3.1／§4.1 ASU FV、§8.3 presentation/disclosure，以及商業附錄 A.3，v3 已改為行內來源或移除重複標記。商業 §10 未再出現重複標題、表頭或分隔線。剩餘 `[需查證]` 多為個案準則應用、供應商／市場／法遵時效資訊，未發現同一已引用事實仍重複標記的原問題。 |

## B. 新迴歸或矛盾

### B1. 高：Paid Pilot SUI accounting class 不符合 canonical enum

- 會計規格 §2.1 定義：`INTANGIBLE_IAS38_COST`。
- §5.6 frozen profile 使用：`INTANGIBLE_ASSET_IAS38_COST`。

後者不在 canonical enum。若 profile validator、AssetPolicy schema 或 fixture 使用不同字串，會造成合法 pilot 設定被拒絕，或工程另造第二個 enum。必須統一為 canonical code。

### B2. 高：ADR test case references 不可解析

§5.6 的多個必要 test case 沒有在 §7.8 定義：

- `GF-ALL-PROFILE`
- `GF-ALL-MISSING-PXFX`
- `GF-CLOSE-IMPAIRMENT`
- `GF-ALL-DISCLOSURE`
- `GF-PROFILE-REJECT-CEX`

因此 ADR 雖形式上有 `test_case_ids[]`，但目前不能以測試資產驗證狀態轉移至 `FIXTURE_APPROVED`。應補 fixture 定義，或改為現存 25 個 fixture 的明確集合。

### B3. 中：唯一 matrix 外仍有 scope 重述

- 商業 §7.5 把 DeepBook trade 與 Walrus snapshot 寫成 Demo 步驟。
- §14.6 把 Walrus manifest 寫成 Pilot 成功交付物。
- 附錄 E.3 再次固定 `1 entity、5 events、CSV`。
- §4.1 的 onboarding user story 列入 CEX、custody、CSV，沒有 scope qualifier。

這些文字未必代表工程意圖錯誤，但會讓報價、demo、pilot acceptance 各自引用不同段落。應改成只引用 §2.5，或明確標示 Post-pilot／optional。

### B4. 中：ADR owner 與「具名」要求不一致

「預設 owner 為具名外部會計師」不是具名 owner；文件沒有姓名、組織角色 ID 或 `TBD-BEFORE-CONTRACT` 欄值。若尚未選定人員，應逐筆寫明暫定 owner 與 contract gate，不能以全表預設掩蓋責任未指派。

### B5. 低：Phase 1／2 擴張描述混合

商業 §5.3 同一清單包含 ERP acknowledgement；但 §2.5 Paid Pilot 已要求 manual ERP acknowledgement。建議將標題拆成 Post-pilot expansion，並區分「manual acknowledgement」與「native/bidirectional acknowledgement」，避免被解讀為 pilot 尚不支援 acknowledgement。

## C. 收斂判定

### 固定範圍付費 design-partner pilot

**尚未收斂。**

原因不是仍有商業或準則查證工作，而是尚有可由文件直接修正的 blocker：

1. capability matrix 之外仍有 DeepBook／Walrus／source 的範圍重述；
2. SUI accounting class code 與 canonical enum 衝突；
3. ADR owner 未逐筆可追責；
4. ADR 所引用的 5 組必要 test case 未定義。

### 剩餘 `[需查證]` 與 E1 gate

剩餘 `[需查證]` 大多可歸為：

- **E2**：provider、競品、Sui 元件狀態、客戶需求、安全與商業驗證；
- **E3**：Walrus 法律效力、長期 retention、非首期元件與擴張能力；
- **已 gate 的 pilot 外 E1**：staking、bridge/wrap、LP、fork/rebase、IFRS 重估、broker-trader、cost formula、cash-flow classification。

Pilot 內 7 個會計 ADR 仍是 `DESIGN_BLOCKED`，但已明確禁止 rule merge／pilot enable，故不是偽裝成 E2/E3 的 blocker。它們可以作為簽約後、implementation 前的具名會計 sign-off gate；然而若要簽「固定 acceptance、固定 JE 結果」的 pilot，合約必須明列這些 assumptions、customer evidence obligations、decision deadline 與因未決而排除的 auto-post path。現版 ADR 因 owner 與 test case 不可解析，尚不足以承擔此功能。

## 最終統計

- **關閉：5**
- **未關閉：2**
- **收斂：否**

最小收尾修正為：統一 SUI enum、逐筆填 ADR owner、補齊或重映 ADR test cases、刪除／改寫 §7.5、§14.6、附錄 E.3 與 §4.1 的 capability 重述。完成後可再作一次純文件 diff 驗收。
