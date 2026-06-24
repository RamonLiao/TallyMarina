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
