# Codex CEO／投資人複審 R2

**複審日期**：2026-06-19  
**審查文件**：`business-spec-v2.md`、`accounting-spec-v2.md`、`codex-review-r1.md`、`claude-review-r1.md`

## 結論先行

v2 已修正多數 R1 的結構性錯誤，尤其是 ASU 2023-08 建模、canonical event registry、stablecoin assessment、主要 JE 錯例與 ERP acknowledgement。這不再是「方向錯誤」的規格。

但仍未達可直接啟動付費 pilot 的規格成熟度。主要原因不是缺真實客戶數據，而是規格自身仍有三類未收斂：

1. paid-pilot source、事件與 Walrus 驗收範圍在同一文件內互相矛盾；
2. canonical PolicySet schema 仍包含已宣告 deprecated 的危險欄位；
3. 多個會改變 JE、lot、valuation 或 disclosure 的 E1 accounting decisions 仍未簽核，且 gate 被錯放到「正式客戶上線前」，晚於設計與 golden test。

本輪按 `claude-review-r1.md` 的採納要求拆為 12 個可驗收項目。原文編號實際只有 1–11；第 11 項同時要求文件狀態、Open Decisions Register 與 Validation Backlog，因此本表將後兩者拆成第 12 項，避免漏驗。

## A. 必修項驗收表

| # | 必修項 | 判定 | v2 證據與判斷 |
|---:|---|---|---|
| 1 | ASU 2023-08 改為 book standard + asset/position scope/model + out-of-scope route | **已修復** | 商業規格 §15.1–15.2 將 `accounting_standard` 放在 Book，並建立 `AssetPositionAssessment`；§A.1 明定 scope test、`measurement_model`、out-of-scope route 在 asset/position 層。會計規格 §2.4、§5.2 明定六項 scope test、`UNKNOWN` fail closed、`measurement_model` 與 `out_of_scope_route`；§5.1 明定 `measurement_path` 廢除。 |
| 2 | 唯一 canonical event registry + leg taxonomy，消除兩文件命名／數量不一致 | **已修復** | 會計規格 §3.0–3.0.2 建立 18 個 canonical codes 與唯一 leg taxonomy，並禁止另造同義 code。商業規格 §5.1 直接引用該 registry，paid-pilot 五個 code 與會計表的 `paid-pilot=是` 完全一致。未再發現 `ASSET_RECEIPT` 等舊 code。 |
| 3 | PolicySet schema 對齊；移除危險預設 | **部分** | 商業規格 §A.1 正確指定會計規格 §5.1 為唯一 canonical schema；會計規格 §5.2–5.3 對 stablecoin、wrapped、LP、staking receipt、issuer/related-party、scope unknown 設 fail-closed。**但 §5.1 canonical YAML 仍實際列入 `stablecoin_treatment`、`default_token_classification`，之後才稱其 deprecated。**Canonical schema 不應同時把禁止新用的欄位列成正常欄位；至少應移至 `legacy_migration_fields` 或從 v2 schema 移除。 |
| 4 | 修正 JE 不完整與 fixture 證據結構 | **部分** | 會計規格 §7.1 禁止 settlement difference catch-all；§7.2 對 USDC 先做 scope test；§7.3、§7.6 對 staking/fork/rebase fail closed；§7.5 bridge fee 補 carrying amount 與 disposal gain；§7.3 明定 IFRS impairment 先測 recoverable amount。列出的數字分錄均平衡。**但 §7 開頭要求每個 fixture 具 `facts/scope/measurement/lot/citation/expected disclosure`，實際 §7.1–7.7 沒有逐筆列 expected disclosure，§7.6–7.7 也缺完整 measurement/citation 結構，因此尚不能直接成為其自稱的 golden fixtures。** |
| 5 | 統一 JE/export state machine；ERP 為 SoR；manual acknowledgement | **部分** | 會計規格 §6.7 完整定義 `APPROVED → EXPORTED → ACKNOWLEDGED → POSTED`、`REJECTED`、`POSTED → REVERSED`、replacement、manual acknowledgement、partial acceptance。商業規格 §4.7、§5.1 同樣採用主要流程並明定 ERP 為 SoR。**但商業規格 §5.1 寫成 `...POSTED → REVERSED，拒絕為 REJECTED`，未明示 `REJECTED` 可從哪些前置狀態進入；採納清單本身的線性 `posted→rejected` 也不合理。應補正式 transition table，而非只列狀態字串。** |
| 6 | E4 五項改為 fail-closed 控制 | **已修復** | 會計規格 §2.3 禁止因 peg 自動分類現金；§1.4 對代管資產設 ownership/recognition gate；§4.5、§7.2、原則 8 禁止 price/FX 缺省為 1；§5.5 與原則 9 禁止 AI 核准 PolicySet/posted JE；§9.2 禁止敏感資料明文公開。商業規格 §8.4 亦明定公開儲存敏感資料為 fail-closed。 |
| 7 | Stablecoin 四層 assessment + 證據、效期、重評觸發 | **已修復** | 會計規格 §2.3 建立 instrument、issuer、jurisdiction、terms-version 四層模型，並要求 `evidence_refs`、legal memo、核准人、有效期、到期日、重評觸發與 conclusion；到期或觸發後回到 `PENDING_ACCOUNTING_REVIEW`。商業規格 §15.1 同步建立 `StablecoinAssessment`。 |
| 8 | 修正競品表與 Sui 支援事實；承認 Sui-native 非 moat | **已修復** | 商業規格 §10.1 新增 Sui 支援欄：TRES、Cryptio、Integral 為明確支援；Cryptoworth、Bitwave、TaxBit、ZenLedger 為未證實；ZenLedger 撤回原說法。§10.2 明確認定已有三家支援 Sui，Sui-native 本身不是 moat，差異主張須靠 benchmark。 |
| 9 | 拆 Demo MVP／paid-pilot MVP，收斂 paid pilot | **部分** | 商業規格 §2.5 已清楚拆分，paid pilot 為單 entity、單功能性貨幣、Sui wallet、五事件、單一準則、FIFO、人工核准、generic CSV、wallet recon；§5.1 事件 code 亦一致。**迴歸：§5.1「資料來源」仍把 DeepBook、CEX/custody generic CSV、手動補錄列為 MVP in-scope，與 §2.5 paid-pilot 只有 Sui wallet 衝突；§9 Phase 0 又只列四事件，漏 internal transfer。** |
| 10 | 已查證準則敘述轉成有來源事實，降低 `[需查證]` | **部分** | ASU scope、wrapped token、IFRIC 2019 routing、IAS 7、ASU presentation/disclosure 等已加入來源；總 `[需查證]` 從 R1 的 68 處降至 43 處。**但已查證內容仍有重複保留標記：會計規格 §2.2 broker-trader、§2.4 wrapped token、§3.1 ASU FV、§4.1 ASU FV、§8.3 ASU presentation/disclosure；商業規格 §A.3 又把整套準則籠統標回 `[需查證]`。修訂未完成去重與 authoritative-source consolidation。** |
| 11 | 文件狀態改為 DRAFT FOR VALIDATION | **已修復** | 兩份 v2 首頁均明確標示 `DRAFT FOR VALIDATION`。 |
| 12 | Open Decisions Register + Validation Backlog，含 owner/deadline/criteria/gate | **部分** | 兩份文件均新增 ODR；商業規格附錄 E 亦有 TAM、GTM、pricing/COGS、競品、provider、Walrus、SOC2 backlog；會計規格附錄 D 有 accounting decision record gate。**但多數 E1 accounting decisions 沒有逐項 owner、deadline、authoritative source、適用 facts 與 test cases；僅以「準則未決項」一列統包。這不足以管理會改 schema/JE 的 blocker。** |

### 必修驗收統計

- 已修復：6 項
- 部分：6 項
- 未修復：0 項

若將「部分」視為尚未完成驗收，則尚有 **6 項必修未完全關閉**。

## B. 新的不一致或迴歸

### B1. Canonical event registry：兩文件 code 一致，但產品範圍不一致

Registry 本身通過：

- 會計規格 §3 是唯一權威；
- 商業規格 §5.1 的五個 paid-pilot code 與 registry 完全一致；
- leg taxonomy 只有一份 canonical 定義；
- 未發現舊名稱殘留。

但 scope 發生迴歸：

- 商業規格 §2.5：paid pilot source 只有 Sui wallet；
- 商業規格 §5.1：MVP source 又包含 DeepBook、CEX/custody generic CSV、手動補錄；
- 商業規格 §9 Phase 0：只列四事件，與 Demo MVP 的五事件不一致。

這不是命名問題，而是 build、測試與報價邊界不確定。需把 §5 改為明確的 `Demo`、`Paid Pilot`、`Post-pilot` 三欄 capability matrix。

### B2. PolicySet schema：語意對齊，schema 尚未真正乾淨

正向結果：

- `measurement_path` 已移除；
- Book、AssetPolicy、StablecoinAssessment、EventPolicy 的責任已分層；
- 同一 book 可並存多 measurement models；
- edge assets fail closed。

剩餘矛盾：

- §5.1 canonical YAML 仍列 `stablecoin_treatment` 與 `default_token_classification`；
- §5.1 下一段又說這兩欄 deprecated、不得驅動 auto-post；
- 商業規格 §A.1 還提到不存在於 canonical YAML 的 `crypto_classification_default` 舊名。

這會造成 API、migration、UI form 與 validation 各自解讀。應發布 machine-readable v2 schema，deprecated 欄位只能位於 migration adapter，不可位於新建 PolicySet contract。

### B3. State machine：主幹一致，邊界轉移未完整

主幹流程與 ERP acknowledgement 已一致。仍缺：

- `REJECTED` 可由 `APPROVED`、`EXPORTED` 或 line-level partial acceptance 哪些狀態進入；
- export batch status 與 JE status 是否共用同一 state machine；
- acknowledgement 後發現 ERP 拒絕時是回 `REJECTED`、新 batch，還是 reversal；
- business spec 的簡寫容易被實作者解讀成 `POSTED → REJECTED`。

應補一張 transition table，逐列 current state、event、guard、next state、audit fields。

### B4. JE fixtures：算術平衡，但尚未達「會計完整 fixture」

可重算的明示分錄：

- Swap：Dr 300 = Cr 200 + Cr 100；
- ASU FV：Dr 400 = Cr 400；
- Bridge principal：Dr 2,000 = Cr 2,000；
- Bridge fee：Dr 10 = Cr 7 + Cr 3。

因此沒有 arithmetic out-of-balance。

但 completeness 未通過：

- §7 宣稱每筆 fixture 都要有 expected disclosure，實際沒有逐筆提供；
- §7.6 fork/rebase/LP 只有政策敘述，不是完整 fixture；
- §7.7 dust/spam 缺 scope conclusion、measurement、citation、expected disclosure；
- paid-pilot 五事件並未各自於 §7 提供完整 fixture；payment、internal transfer、gas 只能回看前文示例，未形成單一 golden-fixture contract；
- citation 多為分類或 scope 來源，不能替代客戶對 recognition、measurement 與 presentation 的具名 policy memo。

### B5. Walrus optional 與總驗收互相衝突

- 商業規格 §2.5：Walrus 不在首個 paid pilot 必要範圍；
- §5.1：Walrus 只為 optional async publication；
- §8.3：publication 失敗不影響 close；
- 但 §17 驗收總則仍要求「可生成含版本與 hash 的 Walrus audit snapshot」。

若 §17 是 paid-pilot 驗收，Walrus 又成 blocker。應改為「內部 immutable audit snapshot 必須；Walrus publication 選配」。

### B6. 文件品質迴歸

商業規格約 §10 開頭存在重複分隔線、章節標題與表頭。這不影響會計邏輯，但表示修訂未經最基本 lint／render review；對投資人與 design partner 交付不合格。

## C. 剩餘 `[需查證]` 分級

v2 尚有 43 處 `[需查證]`：商業規格 12 處、會計規格 31 處。以下按「會否改變首個 paid-pilot 的 schema、JE、lot、valuation、control 或 acceptance」分類，而不是按是否容易查資料分類。

### C1. E1：設計／golden test 前必須確認，仍未解

1. **首個 pilot 採 IFRS 或 US GAAP，以及對應的完整 authoritative policy pack。** 商業規格允許二選一，但在選定前無法凍結 golden JE、disclosure facts 與 review workflow。
2. **Paid-pilot 資產逐項 scope/classification。** 包含 USDC 等 stablecoin 的權利、issuer、jurisdiction、terms version，以及 SUI/其他 token 的 ASU scope 或 IFRS route。
3. **定價／FX valuation policy。** 包含 principal market、來源 waterfall、timestamp、stale/outlier、bid/ask、缺價與 override。Provider 商業選型可屬 E2，但 valuation policy 與 fixture price admissibility 是 E1。
4. **交易成本與 gas 的費用化／資本化 routing。** 直接改變 paid-pilot 的 swap、payment、gas JE。
5. **IFRS 成本路徑的 impairment/reversal，或 US GAAP in-scope FV 路徑。** 若首個 pilot 的資產與期間需要期末 closing adjustment，必須先定；不能留到上線前。
6. **外幣與功能性貨幣規則。** 即使 pilot 宣稱單一功能性貨幣，只要 price currency 不同，就需確認 spot rate、rate timestamp、monetary/non-monetary routing。
7. **披露與 presentation 最小矩陣。** 若產品生成 `DisclosureFact` 並把它列為 golden-test requirement，ASU/IFRS 欄位、aggregation 與 comparative period 必須先凍結；否則應明確移出 pilot acceptance。
8. **CEX/custody 權利模型是否屬 pilot scope。** 目前 §5.1 把 CEX generic CSV 列入 MVP，但 §2.5 排除。若保留，token ownership vs contractual claim 是 E1；若排除，應刪除該 scope。

**仍未解 E1 blocker：8 項。**

下列 R1 E1 已被合理移出首個 paid pilot，因此不是當前 blocker，但啟用對應模型前仍是 E1 gate：staking recognition、bridge/wrapped/LP/fork/rebase、IFRS revaluation active market、IAS 2 broker-trader、cost formula change、cash-flow classification。

### C2. E2：付費 pilot 前可並行驗證

- Sui API/indexer/DeepBook schema 穩定性、歷史完整性與 parser coverage。
- Pricing/FX provider 的實際 coverage、授權、SLA、成本與 redistribution rights；其中 accounting acceptance policy 仍屬 E1。
- 首個 ERP CSV template、import 行為、duplicate prevention 與 acknowledgement evidence。
- 競品的 Sui/DeepBook/object-level 實測能力、導入工時與價格。
- Pilot 客戶 security questionnaire、DPA、subprocessor、資料駐留與 retention 要求。
- ICP 訪談、named accounts、LOI、付費意願、報價與單位經濟。

### C3. E3：可延後，不得成為當前架構負擔或對外 claim

- Walrus 法律證據效力與完整加密 package；目前只需內部 immutable manifest。
- SuiNS、Seal、Nautilus、zkLogin/Enoki 等非首期元件的最新 API 與商用限制。
- 非首期 ERP connectors。
- 長期跨司法管轄區 retention 年限。
- Phase 2 以後的 stablecoin AP/AR、agentic treasury、多實體、多幣別與完整財報能力。
- 生態補助、合作夥伴與活動規則。

## D. 仍存在的高嚴重度問題

### D1. 高：paid-pilot contract scope 無法由規格唯一推導

同一文件同時給出「Sui wallet only」與「DeepBook + CEX/custody CSV + manual CSV」兩種 source scope，事件數也有四與五兩種說法。這會直接造成估價、工期、fixture、資料責任與 acceptance dispute。

**必修**：建立唯一 paid-pilot capability matrix；其他章節只能引用，不得重述。

### D2. 高：E1 gate 時點過晚

會計規格附錄 B 寫「所有 `[需查證]` 項目在正式客戶上線前」納入 sign-off。對會改 schema、JE、lot 或 disclosure 的項目，這個 gate 太晚。它們必須在 schema freeze、rule implementation 與 golden fixture approval 前完成。

**必修**：將每個 E1 decision 綁定 `DESIGN_BLOCKED → DECIDED → IMPLEMENTED → FIXTURE_APPROVED`，未決不得開發對應 auto-post path。

### D3. 高：PolicySet canonical contract 帶著 deprecated 危險欄位

這會把已修正的設計錯誤重新帶進 API 與 UI。註解「不得驅動 auto-post」不足以防止誤用。

**必修**：從 v2 create/update schema 移除；只允許 migration input，且轉換後不得持久化為 active decision source。

### D4. 高：Golden fixture acceptance 尚不可執行

文件提出正確的 fixture 元資料要求，但沒有按自己的規則交付完整 fixtures，也沒有覆蓋 paid-pilot 五事件。現在只能證明幾個示例平衡，不能證明產品規則完整。

**必修**：每個 paid-pilot event 至少提供 happy path、scope unknown、missing price/FX、insufficient lot、replay/reversal permutations，並附 expected JE、lot、DisclosureFact、exception code 與 lineage hash inputs。

### D5. 高：Walrus 是否為 pilot acceptance blocker 前後矛盾

這會造成不必要的工程依賴與驗收爭議。

**必修**：§17 改為 internal snapshot 必須、Walrus publication 非必要；刪除所有將 Walrus publication 當 close success condition 的文字。

## E. 收斂判斷

### 投資人判斷

**可進 design-partner discovery 與無承諾的資料／流程 workshop；尚未達可簽固定範圍付費 pilot 的規格成熟度。**

原因不是缺少 15 次訪談、3 個 pilot 或真實收入。那些是商業驗證，不是 spec 收斂。當前阻礙是規格仍不能唯一回答：

- pilot 到底接哪些 source、做四或五種事件；
- 哪些會計決策已足以產生 golden JE；
- 哪些欄位是 active canonical schema；
- Walrus 是否影響 acceptance；
- 每個 JE 狀態如何合法轉移。

### 達到 spec 收斂的最低條件

1. 發布唯一 paid-pilot capability matrix，消除 §2.5、§5、§9、§17 的 scope 衝突。
2. 選定首個 pilot 的單一 reporting standard 與資產清單；完成上述 8 個 E1 中適用項目的 Accounting Decision Records。
3. 發布 machine-readable PolicySet/AssetPolicy/StablecoinAssessment schema；移除 active schema 中 deprecated defaults。
4. 補正式 JE/export transition table與 partial-rejection 行為。
5. 將五個 paid-pilot events 的 golden fixtures 補到可自動測試，並證明 debit=credit、lot roll-forward、DisclosureFact、exception 與 replay/reversal。
6. 明定 internal audit snapshot 為必要、Walrus publication 為 optional。
7. 清除已由來源確認卻仍標 `[需查證]` 的重複內容，並修正文檔重複章節。

完成以上七點後，即使 pricing provider、競品 benchmark、SOC 2、Walrus 法律效力及真實客戶轉換率仍在驗證中，規格本身也可視為收斂，足以進入有明確 assumptions、exceptions 與 acceptance criteria 的付費 design-partner pilot。
