# GTM 規格書 v1.0 撰寫計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依設計文件 rev3 產出兩冊權威規格書 `docs/specs/business-spec-v1.md` 與 `docs/specs/accounting-spec-v1.md`，取代 `Ideas/` 三份對話稿。

**Architecture:** 純文件撰寫（無 code）。先立骨架與詞彙表（唯一定義出處），再按冊分批填章，每批以 grep + 對照設計文件目錄驗收，最後跑會計師 desk check。

**Tech Stack:** Markdown；驗證用 grep/桌面演練。

## Global Constraints

- 分支：`docs/gtm-spec-v1`（已存在，繼續用；不動 main）。
- 全文中文（D12）；產品名暫用「Sui Agentic Subledger」，UI 設計系統代號 TallyMarina 只在 UI 章出現。
- 權威來源（writer 只讀這些，不讀對話）：
  - `docs/superpowers/specs/2026-07-11-gtm-spec-v1-design.md`（rev3；章節結構與 D1–D19 決策，**衝突時以此為準**）
  - `tasks/ideas-summary.md`（Ideas/ 9 檔摘要；需要原文細節時按其 F1–F9 對照表回讀 `Ideas/` 原檔）
  - `tasks/review-findings-2026-07-11.md`（三路 review 完整 findings，章節細節展開用）
  - `tasks/research-erp-targets.md`（ERP 章數據與來源 URL）
  - `tasks/spec-gap-analysis.md`（附錄 A 素材）
- 禁 "TBD"/"TODO"/"placeholder"/空節（`grep -riE "TBD|TODO|placeholder"` 必零命中）。
- 分期表只在商業冊 §7 完整出現一份；會計冊只寫「見商業冊 §7」。
- 詞彙表（商業冊附錄 B）是兩冊唯一名詞定義出處；正文用詞必須與詞彙表一致。
- git 只准 `git add <明確檔名>`，禁止 `-A`/`.`。
- 每個 Task 結尾 commit，訊息格式 `docs(spec): <內容>`。

---

### Task 1: 兩冊骨架 + 詞彙表

**Files:**
- Create: `docs/specs/business-spec-v1.md`
- Create: `docs/specs/accounting-spec-v1.md`

**Interfaces:**
- Produces: 兩冊完整標題階層（商業冊 §1–§7 + 附錄 A/B/C；會計冊 §1–§18），後續 Task 只填內容不改標題；附錄 B 詞彙表完整詞條。

- [ ] **Step 1: 建立商業冊骨架**：H1 標題 + 版本行（v1.0、2026-07-11、狀態 Draft）+ 設計文件「文件一」的 8 節標題（§1 產品定位與問題陳述 / §2 ICP 三層 / §3 GTM 分階段與商業模式 / §4 競品與差異化 / §5 功能模組總覽 / §6 非目標 / §7 分期 Roadmap / 附錄 A 現況差距對照 / 附錄 B 詞彙表 / 附錄 C Sui 生態整合機會）。除附錄 B 外每節先放一行「（本節由 Task 2/3 填寫）」——這是工作標記，Task 8 驗證前必須已被真內容取代。
- [ ] **Step 2: 建立會計冊骨架**：同格式，設計文件「文件二」18 章標題照抄（§1 準則範圍…§18 資料模型），每章放對應的填寫 Task 標記。
- [ ] **Step 3: 寫滿附錄 B 詞彙表**（此節 Task 1 就完成，不留標記）。必含詞條：Entity、AccountSource、RawTransaction、NormalizedEvent、事件類型（12 類逐一）、PositionLot、PricePoint、PolicySet、MappingRule、JournalEntry、ReconciliationRecord、Trial Balance、Roll-forward、Period Lock、Snapshot、Anchor、Manifest、Merkle Root、Walrus 審計包、functional/reporting currency、MVP/P1/P2、ICP L1/L2/L3。L1/L2/L3 定義採 F2/F9 三層（`tasks/ideas-summary.md` §4 表格），並加註記：「F5 商業規格草稿曾將 ICP 簡化為兩層、其 L2 實為本表 L3，v1.0 起以本表為準（D10）」。
- [ ] **Step 4: 驗證**：`grep -c "^#" docs/specs/*.md` 標題數符合（商業冊 ≥11、會計冊 ≥19）；`grep -n "L1\|L2\|L3" docs/specs/business-spec-v1.md` 附錄 B 命中。
- [ ] **Step 5: Commit**：`git add docs/specs/business-spec-v1.md docs/specs/accounting-spec-v1.md && git commit -m "docs(spec): scaffold business & accounting spec v1.0 with glossary"`

### Task 2: 商業冊 §1–§4

**Files:**
- Modify: `docs/specs/business-spec-v1.md`（§1–§4）

**Interfaces:**
- Consumes: Task 1 骨架與詞彙表。
- Produces: §4 差異化三支柱表述（後續 §5 模組表與會計冊 §15 引用其措辭）。

- [ ] **Step 1: §1 產品定位與問題陳述**：來源 `tasks/ideas-summary.md` §1（F5 §1-2 的四個問題陳述 + 一句話定位）；定位句用 F2 Phase 0 版：「AI-assisted digital asset subledger for finance teams on IFRS & US GAAP — turning on-chain chaos into ERP-ready ledgers.」+ 中文對應；明寫「ERP 是 GL of record，本產品是 subledger」五原則（ideas-summary §2.4 末段）。
- [ ] **Step 2: §2 ICP 三層**：ideas-summary §4 表格展開（L1 CEX/機構型 crypto org/Sui 項目方；L2 Web3 原生基金/做市商/支付商；L3 Web2 穩定幣企業），每層：特徵、產品價值、切入時機（F9 順序）。
- [ ] **Step 3: §3 GTM 分階段與商業模式**：F2 Phase 0/1/2 訊息分層 + F9 切入順序；計價 = 月交易量 + 實體數 + 準則/ERP 模組（D11），非按錢包數；早期 pilot 賣點「month-end close in 3 days」與半產品半服務模式。
- [ ] **Step 4: §4 競品與差異化**：ideas-summary §5 競品表（TRES/Cryptio/Bitwave/Integral/ZenLedger/Taxbit 等，標注 Integral/ZenLedger 已支援 Sui）；三差異化（Sui-native accounting intelligence / policy-switchable engine / AI-assisted close workflow）；補兩個實證：ERP 整合路徑競品驗證（`tasks/research-erp-targets.md`：Cryptio 首整合 Xero、NetSuite 客戶名單）與 UI 簽名元素（`tasks/review-findings-2026-07-11.md` 三、正面資產）。
- [ ] **Step 5: 驗證**：§1–§4 無 Task 標記殘留（`grep -n "本節由 Task" docs/specs/business-spec-v1.md` 只剩 §5–§7、附錄 A/C）；`grep -n "TRES\|Cryptio\|Integral"` 命中 §4。
- [ ] **Step 6: Commit**：`git add docs/specs/business-spec-v1.md && git commit -m "docs(spec): business spec §1-4 — positioning, ICP, GTM, competition"`

### Task 3: 商業冊 §5–§7 + 附錄 A/C

**Files:**
- Modify: `docs/specs/business-spec-v1.md`

**Interfaces:**
- Consumes: Task 2 的差異化措辭。
- Produces: §7 分期表（全案唯一權威版，會計冊各章引用）。

- [ ] **Step 1: §5 功能模組總覽**：F5 §6 的 7+2 模組（ideas-summary §2.1 逐項），每模組一小節：目的、輸入/輸出、MVP/P1/P2 標記。標記依據 = 設計文件分期表（rev3）。
- [ ] **Step 2: §6 非目標**：明文六條——不取代 ERP；MVP 不做三大報表引擎；不做稅務申報與 tax basis/遞延稅；不支援 SAP；MVP 限單一 functional currency = USD（含 D15 可插拔接口條款：換算集中於 rules engine Price/FX 階段、functional_currency 只存在 PolicySet、JE lines 保留 currency/fx_rate 欄位；P1 目標市場 TW/JP/HK/KR）；MVP 不做多實體 consolidation。
- [ ] **Step 3: §7 分期 Roadmap**：設計文件 rev3 分期表照搬展開（MVP/P1/P2 三段，MVP 含 UI 執行落差修復批次）。
- [ ] **Step 4: 附錄 A 現況差距對照**：`tasks/spec-gap-analysis.md` 的逐項差距表收斂為「規格章節 ↔ 現況 ↔ 差距」三欄表，註明「隨實作推進只更新本附錄，不改主文（D9）」。
- [ ] **Step 5: 附錄 C Sui 生態整合機會**：DeepBook（交易來源 parser/對沖延伸）、SuiNS（counterparty 顯示）、Enoki sponsored-tx anchoring 評估（review findings 一之5c）、Nautilus（若 §6 定價章 oracle 評估選型未定則於此保留候選）。
- [ ] **Step 6: 驗證**：`grep -n "本節由 Task" docs/specs/business-spec-v1.md` 零命中；`grep -c "MVP" docs/specs/business-spec-v1.md` §5/§7 有標記。
- [ ] **Step 7: Commit**：`git add docs/specs/business-spec-v1.md && git commit -m "docs(spec): business spec §5-7 + appendices — modules, non-goals, roadmap"`

### Task 4: 會計冊 §1–§5（準則、分類、taxonomy、JE、重估）

**Files:**
- Modify: `docs/specs/accounting-spec-v1.md`

**Interfaces:**
- Consumes: Task 1 詞彙表詞條。
- Produces: §3 事件 taxonomy 表（§4/§13 引用其事件代碼）；§4 JE 模板格式（§5/§8 沿用）。

- [ ] **Step 1: §1 準則範圍**：IFRS（IAS 38/IAS 2/IFRS 9/IFRS 13）與 US GAAP（ASU 2023-08）雙軌，PolicySet `accounting_standard` 切換；functional currency 範圍引用商業冊 §6 的 D15 條款（USD-only + 接口）。
- [ ] **Step 2: §2 資產分類模型**：F4 §2 的 technical_type × accounting_class 矩陣（回讀 `Ideas/好，寫出會計規格書 v0.1.md` §2 取完整枚舉）；穩定幣三選項政策（FINANCIAL_ASSET_IFRS9/INTANGIBLE_ASSET/CASH_EQUIVALENT，系統不自動判斷）；P1 細節小節：IFRS 9 後續衡量（amortized cost vs FVTPL）、de-peg 處理、CASH_EQUIVALENT 報表口徑後果（review findings 二之10）。
- [ ] **Step 3: §3 事件 taxonomy**：F6 12 類全表（ideas-summary §2.4），每類一行：定義、MVP/P1 標記。MVP = receipt/payment/swap/gas/transfer（現有5）+ 期末重估 + CEX 存提（transfer 子型，D16）+ staking reward 過渡映射（D18：receipt + economic_purpose→Staking Income）；staking 三態完整版/CEX API P1。
- [ ] **Step 4: §4 事件→JE 處理規範**：每個 MVP 事件給 Dr/Cr 模板（IFRS/GAAP 各一軌；F4 §3 有 JE 範例可回讀原檔）；JE header/lines 模型（ideas-summary §2.4 JournalEntry 欄位）；平衡容差與 rounding difference 科目規則（review findings 二之12：9-decimal × 價格 → 2-decimal 尾差入 rounding 科目，容差上限明定）。
- [ ] **Step 5: §5 期末重估/減損**：GAAP 軌 = ASU 2023-08 FV through P&L；IFRS 軌 = cost + impairment 預設。減損子節（review findings 二之7）：跡象、測試頻率、recoverable amount、IFRS 迴轉允許（原成本上限）vs GAAP 禁止迴轉。P1 小節：revaluation model 機制（OCI/surplus、減值先沖 surplus、IAS 38.75 active market 警示、CoA 需權益科目）（二之9）。
- [ ] **Step 6: 驗證**：`grep -n "本節由 Task" docs/specs/accounting-spec-v1.md` §1–§5 零殘留；`grep -n "ASU 2023-08"` 命中 §1/§5；12 類事件代碼在 §3 齊全（逐一 grep：`ASSET_RECEIPT` `ASSET_DISPOSAL` `INTERNAL_TRANSFER` `TRADE_BUY` `TRADE_SELL` `SWAP` `FEE_GAS` `STAKING_DEPOSIT` `STAKING_REWARD` `STAKING_WITHDRAWAL` `CUSTODY_MOVE` `UNCLASSIFIED_CONTRACT_INTERACTION`）。
- [ ] **Step 7: Commit**：`git add docs/specs/accounting-spec-v1.md && git commit -m "docs(spec): accounting spec §1-5 — standards, classification, taxonomy, JE, remeasurement"`

### Task 5: 會計冊 §6–§10（定價、lots、Manual JE、PolicySet、CoA）

**Files:**
- Modify: `docs/specs/accounting-spec-v1.md`

**Interfaces:**
- Consumes: §3 事件代碼、§4 JE 模板格式。
- Produces: §6 PricePoint schema（§5/§11 引用）；§9 PolicySet schema（§10/§13 引用）。

- [ ] **Step 1: §6 Pricing / PricePoint 規格（MVP，D13）**：價格來源優先序（oracle：Pyth/Nautilus 候選評估準則 → 手動輸入 fallback）；stale/缺價處理（缺價事件擋規則引擎、標 exception，不得默認 0）；期末 cut-off 時點定義（會計日以 entity 時區日切 vs block timestamp 的換算規則，明定一種）；PricePoint 欄位含 FV hierarchy level（level 1/2）（二之15）；principal market 概念一段。
- [ ] **Step 2: §7 Cost basis 與 PositionLot**：FIFO（MVP）/WAC（P1，註記 L2 基金偏好）；PositionLot 欄位（F4 §4）；**期初導入小節（MVP，二之2）**：opening lot import 格式（asset、qty、unit cost、取得日、來源註記）、與現有 `opening_lot` 事件對應、處分量超過已知 lot 的例外流程（擋下 + exception，禁止負 lot）。
- [ ] **Step 3: §8 Manual JE / Adjustment / Reversal（MVP，二之1）**：手工分錄輸入（借貸必平、必掛 period、必留 preparer 與 reason）；更正/應計/審計調整三情境；reversal 規則：未匯出 JE 可 void、已匯出 JE 只能反向沖銷（連動 §12）；manual JE 進 snapshot/anchor 的範圍聲明。
- [ ] **Step 4: §9 PolicySet schema**：F4 §5 欄位全列（accounting_standard、functional_currency、cost_basis_method、stablecoin_treatment、staking_income_policy、fee_expense_policy、revaluation_policy、asu_2023_08_applies…）；落庫 + 版本化（每次變更新 version，JE 記 policy_version，可重跑期間做 restatement）；最小 change log（D19）：PolicySet/MappingRule 變更與 review 人工決策的 who/when/what。
- [ ] **Step 5: §10 CoA 與 MappingRule**：F6 三層規則（分類→政策→分錄生成），JSON 化、版本化、落庫（取代 `DEMO_COA_RULES`）；CoA seed 清單含 rounding 科目與權益科目預留；找不到 mapping → 標「需政策配置」不自動出帳（F5 §6.3 原則）。
- [ ] **Step 6: 驗證**：§6–§10 無標記殘留；`grep -n "opening" docs/specs/accounting-spec-v1.md` 命中 §7；`grep -n "reversal\|沖銷"` 命中 §8/§12 位置。
- [ ] **Step 7: Commit**：`git add docs/specs/accounting-spec-v1.md && git commit -m "docs(spec): accounting spec §6-10 — pricing, lots & opening balance, manual JE, policy, CoA"`

### Task 6: 會計冊 §11–§14（TB/揭露、ERP export、Sui 資料層、月結）

**Files:**
- Modify: `docs/specs/accounting-spec-v1.md`

**Interfaces:**
- Consumes: §3 事件代碼、§6 PricePoint、§8 reversal 規則、§9 policy 版本。
- Produces: §14 月結流程步驟編號（Task 7 §16/§17 與 desk check 引用）。

- [ ] **Step 1: §11 Trial balance 與揭露**：科目餘額視圖（期間、科目、期初/借/貸/期末）；ASU 2023-08 roll-forward（additions/disposals/gains/losses；realized/unrealized 拆分需 per-lot 累計 FV 調整 → 記為 §18 資料模型需求）；P1 揭露小節：significant holdings 逐資產、出售限制、FV 變動單行淨額、cost basis method（二之8）。
- [ ] **Step 2: §12 ERP export**：`tasks/research-erp-targets.md` 展開——Xero manual journal CSV 逐欄位映射表（9 欄模板，單一正負 Amount）與 QBO journal CSV 映射表；export 批次語意（按期、標記 exported、冪等）；已匯出 JE 的沖銷約定（引用 §8：ERP 側不可改，只能反向分錄再匯）；NetSuite Import Assistant 列 P1（tenant 依賴說明）；SAP 明文不做（引用商業冊 §6）。
- [ ] **Step 3: §13 Ingestion 與 Sui 資料層**：review findings 一之1/2/4 全部展開——(a) 資料層決策表：增量 = gRPC checkpoint streaming、backfill/歷史餘額重建 = custom indexer 落自有 DB、GraphQL 僅輔助、JSON-RPC 2026-07-31 停用故 `SuiJsonRpcSource` 汰換；(b) **Sui tx normalization 層**：PTB 多指令 1 digest→N events 分解規則、gas = computation+storage−rebate（淨額可負）、sponsored tx payer 欄位、有價 object 物件級移動（NFT/StakedSui/LP）、coin split/merge 過濾、accumulator/native-balance 形態；(c) 餘額：期末用 addressBalance、歷史餘額由 indexer 重建；(d) 通用 CSV import 格式（CEX 對帳單欄位→NormalizedEvent 映射）；(e) 排程與冪等（NormalizedEvent 唯一鍵）。
- [ ] **Step 4: §14 月結流程（MVP，二之5）**：編號步驟——1 事件全分類（review queue 清空）→ 2 exceptions 結清 → 3 recon 乾淨或 break 已 disposition → 4 期末重估過帳 → 5 TB 產出複核 → 6 roll-forward → 7 period lock → 8 snapshot+anchor → 9 export ERP；每步 blocking 條件（用現有 close-readiness lights 概念對齊）；period reopen 程序（二之11）：lock 後調整 vs 入次期的判準、reopen 對已 anchor Merkle root 的處理（supersedes_seq 重錨，引用現有合約語意）。
- [ ] **Step 5: 驗證**：§11–§14 無標記殘留；`grep -n "addressBalance\|PTB\|rebate"` 命中 §13；`grep -n "Xero\|QuickBooks"` 命中 §12；月結步驟 1–9 編號齊全。
- [ ] **Step 6: Commit**：`git add docs/specs/accounting-spec-v1.md && git commit -m "docs(spec): accounting spec §11-14 — TB, ERP export mapping, Sui data layer, close process"`

### Task 7: 會計冊 §15–§18（UI 標準、對帳、審計層、資料模型）

**Files:**
- Modify: `docs/specs/accounting-spec-v1.md`

**Interfaces:**
- Consumes: §14 月結步驟編號、§6/§9 schema、Task 1 詞彙表。
- Produces: 會計冊完稿。

- [ ] **Step 1: §15 UI/UX 標準**：review findings 三、規格條文 5 條照錄（金額 formatter/語意色合約/token-only/字體單一來源/data-surface 紀律），每條附判定方式（grep、stylelint declaration-strict-value、現有測試 `mascot-governance.test.tsx`）；註明現有 UI 執行落差修復批次屬 MVP 實作範圍（清單引用 `tasks/review-findings-2026-07-11.md` 三之1–9，不重抄）。
- [ ] **Step 2: §16 對帳**：wallet↔subledger（MVP；book = lot movement 折疊 vs chain = addressBalance，break 物件與 disposition 流程沿現有實作語意）、↔ERP 第三層（P1）；對帳掛入 §14 步驟 3。
- [ ] **Step 3: §17 審計層**：audit_anchor = 完整性層（chain head、seq、supersedes、Merkle inclusion proof——引用現有合約，不重規格）；過渡語意明文（D5）：Walrus P1 前 manifest 只存自有 DB；P1 = Walrus 審計包 + Seal 存取控制綁定（D14，包內容：JE/positions/recon/manifest）；anchoring gas 的 sponsored tx 評估指到商業冊附錄 C。
- [ ] **Step 4: §18 資料模型**：F6 十實體 ↔ 現有 schema 對照表（`services/api/src/store/schema.sql` 的 events/journal_entries/lot_movement/snapshots/anchors/period_lock/asset_registry/exception_disposition/recon_break_disposition/triage_proposal）；rev2 新增需求逐條：PolicySet 表、MappingRule 表、PricePoint 表（含 hierarchy level）、manual JE 支援、change log 表、opening lot 導入、per-lot 累計 FV 調整追蹤（§11 依賴）。
- [ ] **Step 5: 驗證**：`grep -n "本節由 Task" docs/specs/accounting-spec-v1.md` 零命中（全冊完稿）；`grep -n "Seal"` 命中 §17；§18 對照表含全部 10 個現有表名。
- [ ] **Step 6: Commit**：`git add docs/specs/accounting-spec-v1.md && git commit -m "docs(spec): accounting spec §15-18 — UI standards, recon, audit layer, data model"`

### Task 8: 全冊一致性驗證

**Files:**
- Modify（僅修復發現的問題）: `docs/specs/business-spec-v1.md`、`docs/specs/accounting-spec-v1.md`

**Interfaces:**
- Consumes: 兩冊完稿。
- Produces: 通過 tasks/spec.md A1/A2 的定稿候選。

- [ ] **Step 1: Placeholder 掃描**：`grep -riE "TBD|TODO|placeholder|本節由 Task" docs/specs/` → 必須零命中；有命中即修復。
- [ ] **Step 2: 章節覆蓋對照**：逐節比對設計文件 rev3「文件一」8 節與「文件二」18 章標題，缺漏即補（tasks/spec.md G1/G2）。
- [ ] **Step 3: 交叉引用檢查**：分期表只在商業冊 §7 一份（會計冊 grep `P1` 出現處都是引用不是重定義）；詞彙表詞條與兩冊正文用詞抽查 10 個（Entity/NormalizedEvent/PolicySet/lot/anchor…）；G4–G9 逐條 grep 驗證（tasks/spec.md）。
- [ ] **Step 4: 修復後 Commit**：`git add docs/specs/business-spec-v1.md docs/specs/accounting-spec-v1.md && git commit -m "docs(spec): consistency pass — coverage, cross-refs, glossary alignment"`（若無修改則跳過 commit 並記錄「零發現」）。

### Task 9: 會計師 desk check（tasks/spec.md A3）

**Files:**
- 無修改（審查產出 findings；修復在 Step 3 落回兩冊）

- [ ] **Step 1: 派 fresh-context agent**（不給任何撰寫過程自述，只給兩冊路徑）執行桌面月結演練：「你是執業會計師，客戶 2026-06 有 30 筆 Sui 交易（含收款/付款/swap/gas/staking reward/一筆 CEX 提領/一筆需手工調整的分類錯誤）與期初持倉。只依 `docs/specs/accounting-spec-v1.md` §14 月結流程逐步走完，每步指出：規格是否足以指示你完成該步（PASS）或卡死（FAIL + 缺什麼）。全程唯讀。」
- [ ] **Step 2: 分類 findings**：FAIL 項 = 必修；建議項記入規格「未來版本」節或駁回（附理由）。
- [ ] **Step 3: 修復並 commit**：`git add docs/specs/accounting-spec-v1.md docs/specs/business-spec-v1.md && git commit -m "docs(spec): fix desk-check findings"`；desk check 全 PASS 才進 Task 10。

### Task 10: 使用者審閱與收尾（tasks/spec.md A4）

- [ ] **Step 1**: 更新 `tasks/spec.md` 修訂紀錄（若撰寫中有偏離設計文件，逐條留痕）。
- [ ] **Step 2**: 請使用者審閱兩冊；需要修改則回對應 Task 修復再過 Task 8 驗證。
- [ ] **Step 3**: 使用者通過後：以 `superpowers:finishing-a-development-branch` 處理 `docs/gtm-spec-v1` 分支（建議 PR 回 main）；提醒後續「重對準實作 plan」另開 chat，以會計冊 MVP 章節為輸入。

---

## Self-Review 紀錄（撰寫本計畫時已跑）

1. **Spec coverage**：tasks/spec.md G1–G9 逐條有對應 Task（G1→T2/T3、G2→T4–T7、G3→T8.1、G4→T1.3、G5→T3.3+T8.3、G6→T5/T6（六個 blocker 分居 §6/§7/§8/§14/§3/商業冊§6）、G7→T6.3、G8→T7.1、G9→T6.2）；A1–A4→T8/T9/T10。
2. **Placeholder 掃描**：計畫內「（本節由 Task N 填寫）」是骨架工作標記，T8.1 強制清零，非規格 placeholder。
3. **一致性**：章節編號沿設計文件 rev3；素材檔四份路徑在 Global Constraints 唯一列出。
