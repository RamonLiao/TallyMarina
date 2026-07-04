# Exception-Triage Agent — Design Spec

**Date**: 2026-07-03（rev 2026-07-04，三審整合後）
**Status**: Draft — pending user review
**Origin**: `reviews/architecture-review-4lens-2026-07-03.md` F-series（AI agentic 成色 3/10）最高 ROI 建議 ①。memwal 記憶（建議 ②）明確 **out of scope**，留第二輪。
**三審**: sui-architect / CPA / frontend-design 皆 READY-WITH-FIXES，findings 已整合（§7 裁決記錄）。

## 1. Goal

把 AI 從「按鈕式分類器」升級成「自主巡邏 + human-in-the-loop 的 triage agent」：background loop 掃 open exceptions，為每筆產出 draft disposition proposal（action + reason code + rationale），人一鍵 accept 走現成 `applyDisposition` 原子管線。

**不變式（核心安全原則）**：agent 只提案，永不自行 apply。所有帳務寫入必經人工 accept。

## 2. Scope

### In
- 後端 triage module（proposal store + agent loop + scheduler + deterministic proposal gates）。
- `ApplyArgs`/disposition log additive 擴充：`source` + `proposal_id`（AI-assisted 決策在權威審計表可辨識）。
- 4 個 additive routes（run / list / accept / reject）。
- ExceptionsWorkspace 前端：proposal 卡 + accept/reject + agent badge + summary chip。

### Out（誠實 deferred）
- memwal 記憶迴路（第二輪；本輪 reject note/log 先留下訓練訊號）。
- auth/SoD（全域 mock-until-auth）。**已知 control gap（CPA F3）**：mock auth 下 preparer(AI)–reviewer(人) 兩層控制實際只剩一層，任何 client 都能打 accept；上線前 SoD 依賴 auth 輪，material 項目 second-approver（F13）同批。
- `SOURCE_CORRECTED` 新 reason code（動全域 enum，backlog）。
- proposal context/prompt 快照供審計重演（F12）；deferred aging 報表（F11）。
- 手動 resolve 路徑同樣存在「假性 resolve」洞（F7 只修 agent accept 路徑）——已知 gap，備註於 code。
- Agent 自動 apply 任何 disposition（by design 永不做）。

## 3. Architecture

沿 request-driven Fastify + SQLite 現況，新增唯一常駐機制 = in-process interval。

```
scheduler (setInterval, env-gated)
   └─> runTriageOnce(deps)
         ├─ skip if periodLocked(entity) or hasAnchoredSnapshot(db, entityId)   // I2/F8
         ├─ collectExceptions(db, entityId, periodId, cfg.exceptionLowConfidence)
         │    // 回傳全部 projection；自行 join dispositionStore、isOpen 過濾（I1）
         ├─ skip: 已有 status='proposed' proposal、或有 rejected 記錄（cooldown, F9）
         ├─ per exception: buildTriageContext()  // event raw + AI 分類 + rules 失敗原因
         │                                        // + CoA/policy 摘要 + disposition log
         ├─ GeminiClient.generateJson(prompt)     // 現成 client
         ├─ validateProposal()                    // deterministic fail-closed + 會計 gates
         └─ proposalStore.insert()

人工 accept ─> ANCHORED_READ_ONLY guard ─> 重驗 live exception（I3）
           ─> resolved×RULES_FAILED 重跑 evaluate()（F7）
           ─> CAS proposed→accepted ─> applyDisposition({source:'AGENT_PROPOSAL', proposalId})
```

### 3.1 `services/api/src/triage/proposalStore.ts`

新表（schema.sql additive）：

```sql
CREATE TABLE triage_proposal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  period_id TEXT NOT NULL,      -- 提案效力期間（F8a）
  action TEXT NOT NULL,          -- resolved | deferred | dismissed（對齊 disposition state 值）
  reason_code TEXT NOT NULL,     -- 既有 7 enum（types.ts）
  reason_note TEXT,              -- OTHER 時必填
  rationale TEXT NOT NULL,       -- LLM 給人看的完整理由
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',  -- proposed | accepted | rejected | stale
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_by TEXT,               -- 誰 accept/reject（F2）
  decided_at TEXT,
  decision_note TEXT             -- reject 原因（F10，optional）
);
CREATE UNIQUE INDEX idx_triage_open ON triage_proposal(exception_id) WHERE status = 'proposed';
```

- 每個 exception 同時最多一筆 `proposed`（partial unique index）。
- 狀態轉移：`proposed → accepted | rejected | stale`；終止態不可再轉。全部用 CAS（`UPDATE ... WHERE status='proposed'`，changes=0 即衝突）。
- **stale 觸發點**：accept 時 exception 已非法轉移／不在 live projection；period lock 時批次掃 stale（lock route 內 + list 時 lazy 補掃）；anchor 時同掃。
- append-only log 表 `triage_proposal_log` 沿 `exception_disposition_log` 慣例（seq 自增，審計軌跡）。

### 3.2 `services/api/src/exceptions/disposition.ts` — additive 擴充（F1）

- `ApplyArgs` 加 `source: 'HUMAN' | 'AGENT_PROPOSAL'`、`proposalId?: number`。
- `exception_disposition` + `exception_disposition_log` 各加 `source`、`proposal_id` 欄（additive、預設 `'HUMAN'`/NULL）。
- 既有手動 disposition route 傳 `source: 'HUMAN'`。審計師抽權威 log 即可分辨 AI-assisted population，不需跨表 join。

### 3.3 `services/api/src/triage/triageAgent.ts`

`runTriageOnce(deps): Promise<{scanned, proposed, skipped, failed}>`

- **前置 skip**：period locked 或 entity 已 anchored → 整輪跳過（locked projection 會把每個 event 打成 `RULES_FAILED: PERIOD_CLOSED`，全是 lock artifact 噪音——F8c/I2）。
- Open 過濾：`collectExceptions` 回傳全部 → join `dispositionStore.getDisposition` → 只留 `isOpen`（null 或 'open'）（I1）。
- Cooldown（F9）：該 exception 已有 `rejected` proposal → 跳過（第一輪簡化版；context-hash 比對留 memwal 輪）。
- Context 組裝（`buildTriageContext`）：event raw JSON、`ai_event_type/ai_confidence/ai_reasoning`、exception category + rules 失敗細節、CoA mapping 摘要（policyConstants）、該 event 的 disposition log。
- Prompt 要求 JSON：`{action, reasonCode, reasonNote?, rationale, confidence}`。
- **`validateProposal()` — deterministic fail-closed**（Rule 5：判斷給 LLM，路由/驗證/會計 gate 給 code）：
  - 形狀：`action ∈ {resolved, dismissed, deferred}`；`reasonCode ∈` 既有 7 enum；`OTHER` ⇒ `reasonNote` 必填；`rationale` ≤ 2000、`reasonNote` ≤ 500、`confidence ∈ [0,1]`。
  - **會計 gates（CPA Blockers）**：
    - `exception.category === 'RULES_FAILED'` ⇒ 禁 `dismissed`（blocking 例外的 dismiss = 交易永不入帳 + 解鎖月結，只准人工走手動路徑——F6c）。
    - `exception.amount > MATERIALITY_THRESHOLD`（entity-level config，demo 常數）⇒ 禁 `dismissed` 與 `IMMATERIAL_WAIVED`（materiality 判斷不外包給 LLM——F5）。
  - 任一不合格 → 丟棄該筆、計入 `failed`、log warning。**絕不入庫、絕不 retry LLM**。
- 單筆 LLM 失敗不中斷整輪（try/catch per exception）。

### 3.4 `services/api/src/triage/scheduler.ts`

- `startTriageScheduler(deps)`：`setInterval`，間隔 `TRIAGE_INTERVAL_MS`（**預設 0 = 關閉**；demo 建議 30000）。
- module-level `running` flag：上一輪未完成則跳過本 tick。**不用現有 `mutex.run`**（M3）：mutex 是排隊語意，tick 要的是 skip-if-busy；已知悉該 primitive，選擇有意。
- server close 時 `clearInterval`。

### 3.5 Routes（additive，`http/routes.ts`）

| Route | 行為 | Guards |
|---|---|---|
| `POST /entities/:id/triage/run` | 手動跑一輪，回 `{scanned, proposed, skipped, failed}` | `running` flag → 409 `TRIAGE_BUSY` |
| `GET /entities/:id/triage/proposals` | 列 proposals（預設 `status=proposed`，query 可全列）；lazy 掃 stale | — |
| `POST /triage/proposals/:id/accept` | 見下 | 見下 |
| `POST /triage/proposals/:id/reject` | body 收 optional `note`（F10）→ CAS `proposed→rejected` + log | CAS 失敗 → 409 `PROPOSAL_NOT_OPEN` |

**Accept 流程（順序即 guard 順序）**：
1. `hasAnchoredSnapshot` → 409 `ANCHORED_READ_ONLY`（**同手動 disposition 路徑 routes.ts:458 的 guard——B1 修正：不是 PERIOD_LOCKED**。locked-but-not-anchored 時手動 disposition 是允許的，accept 保持一致；lock 場景由 proposal 掃 stale 處理，不會有 open proposal 可按）。
2. 重收 live exceptions 驗 exception 仍存在（同手動路徑 routes.ts:451-456）——不在 → proposal 標 `stale`、409 `PROPOSAL_STALE`（I3）。
3. proposal `action==='resolved'` 且 category `RULES_FAILED` → 重跑 `evaluate()`（collect.ts 同一 pure function）；仍 fail → 409 `STILL_FAILING`，不落 disposition（假性 resolve 擋在 server——F7）。
4. CAS `proposed→accepted`（失敗 → 409 `PROPOSAL_NOT_OPEN`）。
5. `applyDisposition({..., decidedBy: 'demo-controller', source: 'AGENT_PROPOSAL', proposalId})`——`decided_by` 沿現有硬編碼慣例（M1），applyDisposition 轉移非法 → proposal 標 `stale`、409。

### 3.6 前端（`web/src/`）

- `useTriageProposals` hook 放 `web/src/api/hooks.ts`（沿 `useDisposition` 實際位置——M2）。
- **Proposal 卡位置與層級**：render 在 detail pane 的 SUGGESTION ZONE（`ExceptionDetail.tsx` copilot 位），有 proposal 時**取代** copilot 觸發 affordance；視為 decision surface，**不掛 mascot**。
- **Draft 視覺語言**：1px dashed brass-tint 邊框（區別已定案 `.card` paper 面）；`--text-xs` letterspaced eyebrow「AGENT PROPOSAL · NOT APPLIED」；卡內容 = 擬議 action + reason code、reasonNote（含 OTHER）、confidence、rationale。
- **主 CTA 層級（frontend Blocker）**：有 open proposal 時 **Accept 是 detail pane 唯一 `btn-primary`**，微文案帶後果：「Accept — resolve as MAPPING_ADDED」；DispositionControls 全部降 ghost，上加安靜 divider「or decide manually」。無 proposal 時 DispositionControls 維持現狀。**禁 aqua**（on-chain 專用）。
- **Blocking 後果警示（F6b）**：category ∈ blocking 時卡內顯著標示「Accepting will unblock period close; this transaction will NOT post」（dismissed 情境；agent 本不可提，此為防禦深度 + 手動情境沿用）。
- **Confidence 呈現**：純 mono 文字「confidence 0.82」，可選中性色（`--paper-line`/`--ink-soft`）無刻度小 bar。**不重用 `ConfidenceBar`**（其 AUTO/threshold 語意會暗示「過線=可自動」）；**禁 `--credit` 綠**。
- **Rationale 空間**：max-height ≈10 行 + 內部捲動（desktop）；≤768px `line-clamp` + 「Show full rationale」disclosure。全文必可達，不 silent truncate。
- **Reject**：ghost 鈕 → 展開 optional reason note（textarea）→ confirm。
- **List badge**：`--text-xs` pill，inline 於中欄 label 旁（list pane 320px，不加第四欄）；色 = brass 12% tint（`color-mix(in srgb, var(--brass) 12%, transparent)` + brass 字，沿 `.recon-summary__badge--ok` 配方）。
- **Summary chip**：新 `--agent` variant（同 brass-tint 配方），掛在 list-pane header line（現有 summary slot）：「N agent proposals pending review」。
- **狀態**：Accept/Reject pending 時 disable（鏡像 DispositionControls `isPending`）；409 訊息 inline 顯示在卡內（stale：「Already handled — proposal expired」）。anchoredReadOnly / 終止態不顯示卡（同 DispositionControls gate）。

## 4. Red Team（core logic，Plan track 適用）

| # | 攻擊向量 | 防禦 |
|---|---|---|
| 1 | Prompt injection via event memo/counterparty（誘導 agent 提 DISMISS 湮滅例外） | agent 無 apply 權（結構性）；enum 驗證；**RULES_FAILED/材料性 gate 使 dismiss 提案根本出不來**；rationale 全文呈現給人審 |
| 2 | Stale accept race（exception 已被人工 resolve／已不在 projection） | live-exception 重驗（I3）+ `applyDisposition` 轉移驗證 + CAS 標 stale + 409 |
| 3 | 用 accept endpoint 繞過 anchored 唯讀不變式 | accept 帶 `ANCHORED_READ_ONLY` guard（同手動路徑）；lock/anchor 時 proposal 掃 stale |
| 4 | LLM 輸出形狀濫用（非法 enum、超長欄位塞爆 UI/DB）＋會計上危險提案（material dismiss、假性 resolve） | `validateProposal` fail-closed + 長度 cap + materiality/RULES_FAILED gate + accept 時 `evaluate()` 重驗 |
| 5 | 重入 / double-accept / reject 後無限重提 churn | `running` flag + CAS `WHERE status='proposed'` + rejected cooldown（F9） |

## 5. Testing

- **proposalStore**：CAS 轉移矩陣（proposed→3 終止態、終止態拒轉）、partial unique index（同 exception 二筆 proposed 拒）、lock/anchor 批次掃 stale。
- **triageAgent**：誠實 mock Gemini（從 prompt 抽真實 exception id/category，抽不到 throw fail-loud——沿 F3 修復慣例）；validateProposal 全拒絕路徑（含 materiality gate、RULES_FAILED×dismissed）；open 過濾（resolved/dismissed/deferred 不產提案）；rejected cooldown；locked/anchored 整輪 skip；單筆失敗不中斷整輪。
- **routes**：run 摘要；accept happy path（disposition 落庫含 `source='AGENT_PROPOSAL'`+`proposal_id`，log 可查）；accept×anchored 409；accept×exception 已消失 → stale 409；accept×假性 resolve → `STILL_FAILING` 409；reject 含 note；double-accept 409。
- **前端**：proposal 卡 render（含 OTHER note、blocking 警示）、主 CTA 層級（有 proposal 時 DispositionControls 無 btn-primary）、accept 流 refetch、409 inline 訊息、anchoredReadOnly 隱藏、rationale disclosure。
- **Monkey**：惡意 LLM 輸出（garbage JSON、注入字串、極長欄位、material 金額 dismiss）、並發 accept、interval 與手動 run 對打、lock 當下 accept 競態。

## 6. Decisions Log

- **Loop 形態 = in-process interval + 手動觸發**：零新基礎設施、demo 可控；獨立 worker 否決（多一 process 不值）、純手動否決（按鈕式 AI 敘事弱）。
- **proposal 表獨立於 exception_disposition**：proposal 是「未生效草稿」，不污染帳務審計表；accept 才進 disposition 管線——但 accept 落庫時 `source`/`proposal_id` 進權威 log（F1），AI-assisted population 可稽核。
- **reject 記 log + optional note 不刪列**：第二輪 memwal 的訓練訊號現在就留。
- **`TRIAGE_INTERVAL_MS` 預設關閉**：測試環境不會有背景 LLM 呼叫；demo 顯式開啟。
- **accept guard = `ANCHORED_READ_ONLY` 非 `PERIOD_LOCKED`**：對齊手動 disposition 路徑語意，避免 agent-accept 比旁邊的人工鈕更嚴的不一致；lock 場景由掃 stale 收斂。
- **materiality/RULES_FAILED gate 放 validateProposal（提案端）而非只在 accept 端**：危險提案根本不該出現在人眼前——automation bias 的正解是不餵誘餌。

## 7. 三審裁決記錄（2026-07-04）

| 來源 | Finding | 裁決 |
|---|---|---|
| SUI B1 | accept guard 錯寫 PERIOD_LOCKED，實際手動路徑是 ANCHORED_READ_ONLY | 採納，§3.5 |
| SUI I1 | collectExceptions 回全部非只 open、漏第 4 參數 | 採納，§3/§3.3 |
| SUI I2 | anchored 後 scheduler 空燒 + proposal 永久掛起 | 採納（skip + 掃 stale），§3.3/§3.1 |
| SUI I3 | accept 缺 live-exception 重驗（手動路徑有 404） | 採納，§3.5 |
| SUI M1-M3 | decided_by 硬編碼慣例 / hook 位置 / mutex primitive | 採納，§3.5/§3.6/§3.4 |
| CPA F1 | 權威 disposition log 無法辨識 AI-assisted 決策 | 採納（ApplyArgs+schema additive），§3.2 |
| CPA F2/F10 | proposal 表缺 decided_by / reject 不收原因 | 採納，§3.1 |
| CPA F3 | SoD mock 下只剩一層控制未標記 | 採納（明文 known gap），§2 |
| CPA F5 | materiality 判斷外包 LLM | 採納（deterministic gate），§3.3 |
| CPA F6 | dismiss blocking 例外 = 帳不完整卻解鎖關帳 | 採納（agent 禁提 + UI 警示），§3.3/§3.6 |
| CPA F7 | 假性 resolve 可關帳 | 採納（accept 時 evaluate() 重驗），§3.5；手動路徑同洞標 known gap §2 |
| CPA F8 | lock 後 proposal 效力未定義 + lock artifact 噪音 | 採納（period_id + 掃 stale + skip locked），§3.1/§3.3 |
| CPA F9 | reject 後無限重提 churn | 採納（簡化版 cooldown），§3.3 |
| CPA F4 | AI 標記不該進 reason code | 採納（source 維度即解）；`SOURCE_CORRECTED` 降 backlog §2 |
| CPA F11-F13 | deferred aging / 重演快照 / second-approver | 降 deferred，§2 |
| FE Blocker | Accept 與 Resolve 雙 brass 主鈕衝突 | 採納（單一主 CTA 規則），§3.6 |
| FE Important×4 | zone 位置 / draft 視覺 / ConfidenceBar 誤導 / rationale 爆版 | 採納，§3.6 |
| FE Minor×3 | badge 位置 / chip variant / pending+409 位置 | 採納，§3.6 |
| FE 建議 | mobile 未展開 rationale 禁 Accept | **否決**：over-engineering，demo 不做；rationale 全文可達已足 |
