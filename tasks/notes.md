# Notes — 決策紀錄（含 why）

> 重要決策／結論寫這，含「為什麼」與「被否決的替代方案」，方便日後查問。
> 對應 spec 在 `docs/superpowers/specs/`，這裡保留 brainstorm 的取捨理由。

---

## 2026-06-24 — Phase 1 C：先做 Export，及 Export workspace 設計決策

### 為什麼三槽先挑 Export（policy / export / onboarding 三選一）
- **Export 脊椎契合度最高**：匯出的數字 client 端可重算驗證、anchored snapshot 當防偽憑證，demo 故事完整（鏈上證據 → 可信匯出）。
- Policy 多為 CRUD/設定、會牽動既有 rules-engine 行為（風險高、脊椎弱）；Onboarding 偏一次性流程、已有 buildRegistry/bootstrap 後端基礎、控制面深度低。三者獨立，各自一輪 spec→plan→SDD。

### Export 範圍與格式決策
- **Q1 消費者/目的 → C（兩者都要）**：① ERP-import CSV ＋ ② verifiable audit bundle。C = A(餵 ERP) + B(可驗證帳冊包) 的聯集，同一次匯出兩種產物。
  - 否決理由：單做 A 脊椎弱（人家系統不驗 merkleRoot）；單做 B 少了「能接進現有 ERP」的會計實務說服力。
- **Q2 ERP CSV 格式數 → A（單一通用 General Journal CSV）**：date/account/debit/credit/memo/reference 標準欄位，多數 ERP 吃得進。
  - 否決多家具名格式（QuickBooks IIF/Xero/NetSuite）：每家 schema 都是坑、demo overkill，力氣留給 bundle 脊椎（YAGNI，呼應「別過早抽象/堆格式」）。
- **Q3 bundle 內容**：journal.csv ＋ trial-balance.csv ＋ manifest.json（entityId/periodId/產出時間/各檔 sha256/anchored merkleRoot/snapshotId/鏈上 tx digest/explorer link）＋ VERIFY.md（收件人自驗教學）。
  - **驗證兩層**：L1 內部一致（trial balance 由 journal 重算，drift fail-loud 不出包）；L2 鏈上防偽（manifest.merkleRoot 必須 == 該 period 已 anchored snapshot 的 merkleRoot）。
- **Q3(a) inclusion proof → 含**：收件人能驗「某 JE 確實在此 merkleRoot 下」，複用 Audit workspace 既有 `web/src/lib/proofVerify.ts`。
- **Q3(b) 未 anchored period → 出 draft 但浮水印 UNVERIFIED**（不擋下、不假裝有鏈上背書；fail-loud 明標）。
- **Q4 組裝位置 → A（純前端組裝、零新後端 endpoint）**：瀏覽器 fetch 既有 `/journal` + `/anchors` → client 算 trial balance / 各檔 sha256 / 組 manifest / 打包下載。脊椎最純（瀏覽器獨立產出且自驗，後端不碰 bundle）。
- **Q4(a) 打包 → 單一 .zip 下載**（一個 .zip 才像可寄出的帳冊包，manifest 內 hash 對應同包檔案才合理）。
- **Q4(b) trial balance 是否加後端 parity test → 否，純前端算**。
  - **Why**：parity test（如 recon 的 netByCoinType vs origMemo byte-identical）值得，是因為**後端那個數字 enforce gate**（擋 freeze），前後端分歧會造成「看到一個數、gate 用另一個數」的信任崩。但 export trial balance **不 enforce 任何 gate**，完整性由①借貸恆等自檢（不平 fail-loud）②收件人可重算 兩層保證，後端 parity 對收件人驗證能力零貢獻。為「不 enforce 任何事」的衍生物蓋 enforcement 級機制 = 過度工程（Rule 2）。純前端算反而天然保住 single source（trial balance 與 ERP CSV 同源 journal）。哪天 trial balance 變成某 gate 輸入，再補不遲。

### 已定（present design 後）
- UNVERIFIED draft 浮水印：bundle 本體烙印（檔名 / manifest.verified=false+anchor:null / VERIFY.md 警語）+ UI 全卡面處理（非只 badge）。
- zip lib：**fflate**（zipSync）；BCS 用既有 @mysten/bcs。
- 不限定 LOCKED：read-only、用 verified/draft 旗標區分（verified-onchain 才算 verified，verified-pending 併入 draft）。

### 2026-06-24（同日稍後）— 三角度 review 整合 + 決策 A（全閉環）
三份並行 review（sui-architect / 資深會計師 / frontend-design）全回，整合進 spec v2。重大發現：

- **命門（兩份 review 同源交會）**：bundle「可驗證」原本沒閉環。
  - sui-architect C1：`proofVerify` 從**後端給的 leafHash** 開始摺 root，收件人無法從 journal 內容自算 leafHash → CSV↔leaf 只靠後端斷言，後端可塞對不上的 CSV 而每關照過。
  - 會計師 I5：inclusion proof 只證 **existence+integrity，不證 completeness**——可給每筆 proof 都過、卻故意漏幾筆的 bundle。
- **決策 A（使用者拍板）= 全閉環**：
  - **L2 leaf binding（新增層）**：web 鏡像 `rules-engine/core/leafCodec.ts`（`leafEncode.ts`），client 重算 leafHash 並斷言 == 後端值；**byte-identical + parity test 釘死（merge gate），比照 recon netByCoinType parity**。leaf preimage 全欄位（idempotencyKey/reversalOf/lines[account,side,amountMinor,origCoinType,origQtyMinor,priceRef,fxRef,leg]）→ bundle 加 canonical `journal.json` 當重算來源。
  - **completeness 斷言**：manifest 加 `bundledJeCount` == snapshot `anchoredLeafCount`。
  - 注意 D1 例外：activity totals 不加後端 parity（不 enforce gate），但 **leafEncode 要 parity**（它是 byte-identical 正確性邊界，性質不同）。
- **會計師其他真缺口（已補 spec）**：
  - C1 命名：`trial-balance.csv` → `account-activity.csv`，明標「period activity 非 balance trial balance，opening balance deferred」（會計用詞錯誤，懂行一問就破功）。
  - I3：`amountMinor ≥ 0` invariant + fail-loud（方向只由 side 帶，負額炸 ERP import）。
  - I6/I7：journal.csv 加 `reversalOf` + `priceRef`/`fxRef` 欄（正好與 leaf preimage 欄位重疊）。
  - I4：加 `quantity-recon.csv`（by coinType acquired/disposed/net）——crypto 子帳核心，數量對帳才是審計驗 existence 起點。
  - I1：CSV 加 book-header 區塊（CSV 脫離 ZIP 仍有 context）。
- **sui-architect API-shape 修正（避免 plan 踩雷）**：真 `InclusionProof` = `{idempotencyKey, leafIndex, siblings:[{hash,position}], merkleRoot}`；proof 是 **per-JE N 次 fetch**（無 bulk endpoint）；`AnchorDTO` 無 periodId → join `snapshot.periodId` 取 latest non-superseded FROZEN，ambiguous/superseded fail-loud；manifest 不可 hash 自己；hash over final bytes（UTF-8/`\n`）；欄位真名 `digest`/`explorerUrl`。
- **frontend-design（已補 spec UX 決策）**：verified/draft **全卡面非顏色處理**（austere navy vs dashed cream + glyph，非 button-side badge）；**下載前自驗摘要為必要 §**（改變 buildBundle contract：回傳 summary 顯示值，不只 throw）；借貸不平錯誤態顯示實際數字+delta；空 period = nil return 用吉祥物（非 error）；hash UI 永不截斷。

spec v2 path 同上；待使用者 review 後進 writing-plans。

## 2026-07-03 四視角架構審查（會計/SUI/全端/AI）

完整報告：`reviews/architecture-review-4lens-2026-07-03.md`。
核心結論：設計層（rules-engine、merkle、audit_anchor.move）達 spec 水準；所有 Critical 集中在 services/api 的 demo stub 層（period lock 鎖不住、Suspense fail-open、合成 lot、maker-checker 零 enforcement）；AI 成色 3/10——分類結果在 posting path 是裝飾性的（buildRuleInput 不讀 finalEventType），是 Agentic Web 賽道最大風險。
修復優先序：F2/F1（AI 接進 posting path + 自動化）→ C1/C3（lock guard、刪 Suspense fallback）→ F3（AUTO 改 deterministic allow-list）→ S2（Move version gate）→ SDK 版本統一+workspaces。C2/C4/H2 為 demo→production 分水嶺，賽後做。

## 2026-07-03 修復完成（審查 5 優先項全落地）

全部驗收（fresh-context verifier 實跑）+ 兩輪 review（獨立 subagent + sui-security-guard on Move diff）通過：
1. **F2+F1**：`buildRuleInput` 用 finalEventType/finalPurpose 覆蓋 raw（AI 維持 suggestion-only）；`POST /ingest` 自動 classify 全部 INGESTED events（含並發 StateError skip）；per-event classify 冪等化；decide 驗 eventTypeSchema enum。
2. **C1+C3**：run-rules/decide 加 PERIOD_LOCKED 409 guard + engine 層 periodOpen 動態解析（雙層防禦）；Suspense fallback 刪除、resolveCoa fail-closed 回 null；**附帶修掉審查沒抓到的死規則 bug**——舊 DEMO_COA_RULES 的 L1 leg 名與 rules engine 真實 leg 名（ACQUISITION/EXPENSE/DISPOSAL…）完全不匹配，之前所有 JE 都在走 fallback。web policy workspace 適配 defaultAccount:null。
3. **F3**：AUTO = raw type ∈ allow-list(RECEIPT,PAYMENT) ∧ LLM agreement ∧ confidence≥threshold。GAS_FEE/SWAP/INTERNAL_TRANSFER 永遠 NEEDS_REVIEW（demo 若加此類 event 需人工 decide 才會 post——runbook 注意）。測試 stub 改「誠實 mock」（從 prompt 抽真實 eventType，抽不到就 throw）。
4. **S2**：見 move-notes.md 2026-07-03 節。**重要：需 fresh publish**（struct layout change），部署時要重建 chain + 更新 env。
5. **Workspaces**：root package.json（6 workspaces）、@mysten/sui 統一 2.19.0（web 側 dapp-kit 解析 2.20.1 同 major）、ingestion CLI SuiClient→SuiJsonRpcClient（v2）；各包 package-lock/node_modules 已清，單一 root lock。

最終數字：anchor-svc 69/69、ingestion 35/35(+2 env-skip)、rules-engine 111/111、snapshot-svc 44/44、api 205/205、web 401/401、Move 20/20，tsc 全乾淨。
未 commit；未跑 web e2e（Playwright）——commit 前要跑（UI 有小改：policy workspace defaultAccount 顯示）。
賽後 backlog：C2（period 歸屬）、C4（lot store）、H2（snapshot 持久化）、exception-triage agent + memwal（AI ROI 項）。

## 2026-07-04 Exception-Triage Agent 關鍵決策（why）
- **accept guard = ANCHORED_READ_ONLY + PERIOD_LOCKED（比 manual disposition 嚴）**：spec B1 原判「與 manual 一致、lock 靠 sweep」，外部獨立 review 證明 sweep 推理不成立（假 periodId 繞過 + LLM await 間隙 TOCTOU）→ 改三層：run route 釘死 DEFAULT_PERIOD（單期 demo，C2 period 歸屬本來就 deferred）、runTriageOnce insert 前重驗 lock/anchored、accept 對 locked 409+stale。manual path 維持原語意（disposition 是 audit overlay 非 journal write）。
- **materiality gate 是 code 不是 LLM**（CPA F5）：`TRIAGE_MATERIALITY_THRESHOLD`（預設 1000），`Math.abs(amt)`+嚴格 decimal pattern，null/空/非數字 amount 一律 fail-closed 拒絕 dismiss/IMMATERIAL_WAIVED。agent 對 RULES_FAILED 永遠禁提 dismissed（dismiss blocking 例外 = 交易不入帳卻解鎖關帳，留人工）。
- **假性 resolve 擋法**：accept `resolved`×RULES_FAILED 時 live projection 仍有該 exception = evaluate() 仍 fail（collectExceptions 內建）→ 409 STILL_FAILING，不需額外呼叫 evaluate。
- **AI provenance 進權威表**（CPA F1）：`exception_disposition(+log)` 加 `source`/`proposal_id`，審計師不用跨表 join 就能抽 AI-assisted population。accept 的 decided_by 記人（demo-controller），proposal id 進 log。
- **rejected cooldown = 永久跳過（簡化版）**：外部 review 指出實為 kill switch——有意的第一輪簡化，memwal 輪用 context-hash 比對 refine；reject 收 optional note 當訓練訊號。
- **accept 失敗一律 revert stale（非還原 proposed）**：審計誠實優先（accepted-無-disposition 是說謊）；transient 失敗犧牲該 proposal（stale 不觸發 cooldown，agent 可重提）。prod 前可再細分。
- **已知 deferred**：/triage/run 無 auth 可燒 LLM quota（全域 mock-until-auth 一致）；TRIAGE_INTERVAL_MS 無下限；mid-round lock 後剩餘迴圈仍呼叫 LLM（正確性無損，浪費 quota）；scheduler 無直接單元測試（default-OFF 由 config 測 + server.ts 才啟動保證）。

## 2026-07-04 Triage Memory 第二輪（memwal）關鍵決策（why）
- **記憶只進 prompt，不進 gate（核心不變式）**：recall 出的 precedent 只 render 成 few-shot 文字注入 prompt，`validateProposal` deterministic fail-closed gate **完全不碰記憶**。理由：記憶是 advisory（human 過往決策的 precedent），可被污染（memwal 是跨 session 可攜、外部可寫）；若讓它影響 gate，等於把 LLM+外部記憶接進金流放行路徑。被下毒的「always dismiss」precedent 仍過不了 `BLOCKING_DISMISS_FORBIDDEN`（非 vacuous 測試釘死）。
- **write-back 只在人工 accept/reject 之後（propose-only 保留）**：`remember()` 全 repo 僅 accept route(`routes.ts:584`)、reject route(616) 兩個 call site，且是 fire-and-forget（不擋 API 回應）。recall 路徑（產草稿時）不寫回 → agent 依舊只提案，記憶只從**已人工裁決**的樣本學。訓練訊號：accept=正例、reject(+optional note)=負例。
- **fail-open 且誠實 provenance**：memwal 逾時/掛掉 → fallback 到 local memory，但 `servedBy` 誠實記 `'local-fallback'` 不謊稱 memwal（`b98c40f`）。理由：記憶是加分項，絕不能因為記憶層故障就擋住 triage 或 API；但 audit 欄位不能說謊（跟第一輪 accept-非原子的審計誠實同原則）。`recall_context` persist 也在 fail-open 時據實記來源、escape/truncate few-shot、bound size 並從 list DTO 剝除（避免大 blob 進列表）。
- **預設 off**：`TRIAGE_MEMORY_MODE` 預設 `'off'`（OffMemory no-op），非法值才啟動期 fail-loud throw。demo 才設 local/memwal。理由：記憶未經長期驗證，預設不啟動；config 錯要在啟動炸不要 runtime 靜默降級。
- **Task 1 lock 意外**：`--legacy-peer-deps` 全樹 re-resolve 把 `@testing-library/dom` peer tree 從 root lock 剝掉（`npm ci` 會炸 web render 測試）→ 改 pin `@mysten/seal`+`walrus` 到 exact 1.2.1（peer 接受 ^2.19.0）、restore lock、plain `npm install`（零 ERESOLVE）。順帶消掉 seal/walrus 想要 ^2.20.1 vs 專案 pin 2.19.0 的潛在漂移，且**不需 bump sui**。
- **已知 deferred**：npm audit 11 vulns（memwal beta 依賴樹，4mod/6high/1crit）——beta SDK 現況，記錄待賽後評估。
- **⚠️ 流程誠實記**：SDD ledger（`.superpowers/sdd/progress.md`）對 triage-memory 只寫到 Task 1 complete，Task 2–9 逐 task review + 最終 whole-branch/dual-review **無留痕**。git 有全部 task commit + 3 個 review-caught fix commit（`b98c40f`/`1cffe9e`/`ea6f080`）+ monkey suite（`4c2e40e`），且 2026-07-04 於 merged main 補跑 fresh-context verifier PASS（api 311、web 415、tsc 0、build 0，read-back 證 propose-only+fail-open）——但 merge 前逐 task gate 無從追認。
