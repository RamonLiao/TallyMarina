# PolicySet + CoA 落庫 — Design Spec

日期：2026-07-11
狀態：使用者已逐節核可（brainstorming 四節），待 spec review
上游規格：`docs/specs/accounting-spec-v1.md` §9（PolicySet）、§10（CoA 與 MappingRule）、§9.3（change log，D19）
取代對象：`services/api/src/http/policyConstants.ts` 的 `DEMO_POLICY_SET` / `DEMO_COA_RULES` 常數

## 1. Goals / Non-goals

### Goals
- G1：PolicySet 落庫、append-only 版本化，取代 `DEMO_POLICY_SET` 常數（§9.2）。
- G2：CoA MappingRule 整包 JSON 落庫、版本化，取代 `DEMO_COA_RULES`（§10.2）。
- G3：CoA seed `accounts` 表：現有 7 科目 + §10.3 新 8 科目 + `RevaluationSurplus`（P1 預留）。
- G4：append-only `change_log` 表（who/when/what/before-after/reason，D19），本輪接 PolicySet 與 MappingRule 兩個寫入源。
- G5：寫入 API 端點（PATCH policy-set / PUT coa-mapping / GET history）+ PolicyWorkspace UI 接電（PreviewPanel 從 "NOT APPLIED" 變真 apply）。
- G6：`journal_entries` 補 `policy_set_version`、`rule_version` 欄位（§9.2：JE header 記錄依據版本）。
- G7：留下 restatement 接口（版本並存不衝突），但不實作。

### Non-goals（明確不做）
- restatement 執行（換版本重跑期間）——獨立子專案。
- accounts 表的 CRUD 端點（加科目走 migration；CoA 治理後置）。
- RBAC / 真實身份（`actor` 為自由文字，P1）。
- change_log 接 manual price / JE void / asset 分類變更（各功能落地時再接）。
- change_log 的 UI diff 視覺化（歷史清單即可）。
- `parserVersion` / `normalizationVersion` 的變更端點（無對應 producer，不開放）。

## 2. 現況與紅線（scout 盤點 2026-07-11）

- `DEMO_POLICY_SET`（6 版本欄位）：`policyConstants.ts:3-7`；`ResolvedPolicySet` 型別：`services/rules-engine/src/domain/types.ts:42-53`。
- `DEMO_COA_RULES`（15 條 `{eventType, leg, account}`，`leg='*'` catch-all）：`policyConstants.ts:9-35`；`resolveCoa` 未命中回 `null` → `MAPPING_MISSING`（已符 §10.2 fail-closed）。
- idempotencyKey 含全部 6 個 policy 版本（`services/rules-engine/src/core/idempotency.ts:5-22`），**不含獨立 CoA 版本**。
- **紅線**：account 字串編進 JE leaf（`leafCodec.ts:8`）→ merkle root → anchor。任何會改變既有 JE bytes 的路徑都是禁區。
- DB 無 policy/CoA/accounts 表；`journal_entries` 無版本欄位；`lot_movement.policy_set_version` 是唯一先例（schema.sql:203）。
- UI 殼已存在：`web/src/workspaces/policy/`（PolicyWorkspace / CoaMappingTable / PreviewPanel "PREVIEW — NOT APPLIED"）；`GET /policy/active` 唯讀吐常數。

## 3. 資料模型（方案 A：append-only 版本化 JSON 文件表）

方案裁決：A（append-only JSON 版本表）勝出 B（全正規化 per-row 規則 + FK）。理由：規格原文即「JSON 儲存並帶 rule_version」；append-only 對齊審計語意；account FK 會與 leaf 內字串形成兩套權威（decimals 教訓翻版）；migration 面積最小。

### 3.1 `policy_sets`
```sql
CREATE TABLE policy_sets (
  entity_id  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  doc        TEXT NOT NULL,      -- JSON：§9.1 十政策欄位 + 6 子版本維度
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
```
- `doc.asu_2023_08_applies` 為 **per-asset map**（`{ "<coinType>": boolean }`），非 entity 單值（§9.1 註）。
- active = `MAX(version)`。不設 active flag（append-only 下 flag 是第二權威）。
- `doc` 內容含：`accounting_standard`、`functional_currency`、`reporting_currency`、`cost_basis_method`、`stablecoin_treatment`、`crypto_classification_default`、`staking_income_policy`、`fee_expense_policy`、`revaluation_policy`、`asu_2023_08_applies`，加上 `policySetVersion`/`assetPolicyVersion`/`eventPolicyVersion`/`ruleVersion`/`parserVersion`/`normalizationVersion` 六維度（沿現行 `ResolvedPolicySet` 粒度，§9.2）。

### 3.2 `coa_mapping_sets`
```sql
CREATE TABLE coa_mapping_sets (
  entity_id    TEXT NOT NULL,
  version      INTEGER NOT NULL,
  rules        TEXT NOT NULL,    -- JSON：[{eventType, leg, account}]，leg='*' catch-all 沿用
  rule_version TEXT NOT NULL,    -- 與同 transaction 寫入的 policy doc.ruleVersion 一致（稽核錨點）
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
```

### 3.3 `accounts`（CoA seed）
```sql
CREATE TABLE accounts (
  entity_id      TEXT NOT NULL,
  name           TEXT NOT NULL,  -- 即 JE line 的 account 字串（單一權威，無 id 別名）
  class          TEXT NOT NULL,  -- 'asset'|'liability'|'equity'|'income'|'expense'
  source_section TEXT NOT NULL,  -- 規格出處，如 '§4.4.1'
  status         TEXT NOT NULL,  -- 'active'|'reserved_p1'
  PRIMARY KEY (entity_id, name)
);
```
Seed 內容（§10.3 全列）：
- 沿用 7：`DigitalAssets`、`AccountsReceivable`、`AccountsPayable`、`DisposalGain`、`DisposalLoss`、`GasFeeExpense`、`OpeningBalanceEquity`。
- 新增 8（MVP 即用）：`StakingIncome`、`RoundingDifference`、`UnrealizedGainCryptoPnL`、`UnrealizedLossCryptoPnL`、`ImpairmentLoss`、`ImpairmentReversalGain`、`GasRebateIncome`、`RetainedEarnings`。
- P1 預留 1（`reserved_p1`，不出帳）：`RevaluationSurplus`。

### 3.4 `change_log`
```sql
CREATE TABLE change_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   TEXT NOT NULL,
  actor       TEXT NOT NULL,     -- 自由文字（RBAC P1）
  at          TEXT NOT NULL,
  object_type TEXT NOT NULL,     -- 'policy_set'|'mapping_rule'；預留 'asset_class'|'manual_price'|'je_void'
  object_ref  TEXT NOT NULL,     -- 如 'policy_sets:acme:pilot-001:v3'
  before      TEXT,              -- JSON；首版為 NULL
  after       TEXT NOT NULL,     -- JSON
  reason      TEXT NOT NULL
);
```
- append-only：code 層不提供 UPDATE/DELETE 路徑（SQLite 無法硬禁，P1 再評估 trigger）。

### 3.5 `journal_entries` 補欄位
- `policy_set_version TEXT`、`rule_version TEXT`（migration ALTER；舊 row 為 NULL——歷史 JE 產自常數時代，誠實留空不回填假值）。
- JE 寫入路徑（routes 的 persist loop）從當下 active policy 取值填入。

### 3.6 Migration 與 seed
- fresh DB：schema.sql 加四表 + JE 兩欄。
- legacy DB：`db.ts` ensure-helpers（比照 `ensureSnapshotSeqUnique` 先例）：建表 + `ALTER TABLE`（吞 duplicate column，其餘 fail-loud）+ seed version 1。
- **Seed version 1 = `DEMO_POLICY_SET` / `DEMO_COA_RULES` 逐 byte 原值搬入**。`policyConstants.ts` 常數降級為 seed migration 的唯一輸入，route/rules-engine 不再 import。
- change_log 不為 seed 寫入記錄（seed 非人工變更；首筆人工變更的 before = version 1 內容）。

## 4. 版本語意與不變量

- **V1 — 改 MappingRule 必 bump `ruleVersion`**：`PUT /policy/coa-mapping` 在同一 transaction 內：插 `coa_mapping_sets` 新 row、插 `policy_sets` 新 row（`doc.ruleVersion` bump）、寫 `change_log`（mapping_rule 與 policy_set 各一筆）。ruleVersion 已在 idempotencyKey 內 → 規則變更後同一 event 產生不同 key，封死「改 CoA 撞相同 idempotency key」的碰撞洞，且不動 idempotencyKey 演算法。bump 格式明定為尾碼整數遞增（`demo-rule-1` → `demo-rule-2`），由 server 計算、client 不得指定。`policySetVersion` 同格式（V2）。
- **V2 — 改 PolicySet 欄位必 bump `policySetVersion`**：同 transaction 語意；十政策欄位任一變更即開新版。
- **V3 — 版本只增、row 永不 UPDATE**：寫入 = `INSERT` with `MAX(version)+1`，route-level mutex（沿 snapshot 寫入慣例）+ PK 撞號 fail-loud 防並發。
- **V4 — anchored 期間零觸碰（紅線）**：不重算任何既有 JE；新版本只影響變更後 evaluate 的 event。驗收判準：既有測試全綠 + 既有 snapshot root byte-identical（沿 Asset Registry 零 re-anchor 驗法）。
- **Restatement 接口（留不做）**：key 含版本 → 多版 JE 天然可並存。守則：不得新增 `UNIQUE(event_id)` 類擋並存的約束。

## 5. API 端點與資料流

### 讀路徑（換源，契約不變）
- `GET /policy/active`：response 形狀不變（`{ policySet, coaMapping, periodId }`），實作改讀兩表 active version。`usePolicyData` 零改動。
- rules-engine 消費點（`buildCoaMapping` / `ResolvedPolicySet`）改由 DB loader 供給；`evaluate` 簽名不動。

### 寫路徑（`reason` 必填、`actor` 自由文字）
- `PATCH /policy/policy-set`：body = 欄位子集 + `reason` + `actor`。zod 驗 §9.1 值域；逐欄 diff，無實質變更 → `409 NO_CHANGE`（防空版本膨脹）。
- `PUT /policy/coa-mapping`：body = 整份 rules 陣列 + `reason` + `actor`。驗證：every `account` ∈ `accounts`（status='active'）、`(eventType, leg)` 無重複、陣列非空。通過 → V1 三合一 transaction。不做逐條 PATCH。
- `GET /policy/history`：change_log 倒序 + 版本列表，餵 UI。
- 不做 DELETE；不做 accounts CRUD。

### Period lock 互動（裁決，使用者已核可）
- policy 變更**不受 period lock 阻擋**：變更只影響未來 evaluate 的 event，不觸碰已鎖期間 JE（V4 保證）；change_log 時間戳供審計判斷「這版生效於哪期之中」。

## 6. UI（PolicyWorkspace 接電）

- `PreviewPanel`："PREVIEW — NOT APPLIED" → 真 apply（`PUT /policy/coa-mapping`），apply 前必填 reason 欄，成功後 refetch + 顯示新 version。
- `CoaMappingTable`：加 version 標示 + 歷史入口（`GET /policy/history` 倒序清單）。
- PolicySet 編輯表單：MVP 開放枚舉欄（`accounting_standard`、`cost_basis_method`、`stablecoin_treatment`、`staking_income_policy`、`fee_expense_policy` 等）下拉編輯；`functional_currency`/`reporting_currency` 顯示但灰化鎖 USD + tooltip（§1.3：MVP 恆 USD；UI 誠實揭露，不隱藏）。

## 7. 錯誤處理（fail-closed 總表）

| 情境 | 行為 |
|---|---|
| 讀不到 active policy/mapping（空表、DB 壞） | evaluate 端 fail-loud 503；**絕不 fallback 回常數**（兩套權威禁令） |
| 寫入驗證失敗（未知 account / 重複 `(eventType,leg)` / 非法枚舉 / 空 reason） | 400 帶具體欄位 |
| 無實質變更 | 409 `NO_CHANGE` |
| transaction 半途失敗 | 整筆 rollback，無半版狀態 |
| mapping 未命中（讀取端） | 語意不變：`resolveCoa` 回 `null` → `MAPPING_MISSING`，不落 Suspense 科目 |
| 髒 doc JSON（缺欄、未知枚舉，raw SQLite 注入） | 讀路徑 zod 驗證 fail-loud，不靜默吞 |

## 8. 測試策略（每條守衛先紅一次，lessons L4）

1. **Byte-identical 紅線**：seed migration 後既有全套原樣綠（api 全數、root typecheck 0）+ 既有 snapshot root 不變。
2. **V1 mutation test**：注入「改 mapping 不 bump ruleVersion」的壞寫入 → idempotency 碰撞守衛炸；正路 bump → 同 event 新 key 不撞。
3. 寫端點拒絕路徑逐條一測（未知 account / 重複 leg / 空 reason / NO_CHANGE / 非法枚舉）。
4. change_log：兩次變更 → seq 遞增、before/after 正確、首筆人工變更 before = seed 內容。
5. legacy DB migration（比照 `db.snapshotSeqIndex.test.ts`）：無表 → 建表+seed；已有 → 冪等。
6. UI：Playwright 實點擊 apply 全流程（reason 欄 → apply → version 更新）。
7. Monkey test（test.md 慣例）：raw SQLite 塞髒 doc / 髒 rules JSON → fail-loud。

## 9. 影響面

- `services/api`：schema.sql、db.ts（migrations + ensure-helpers）、policyConstants.ts（降級 seed 輸入）、routes.ts（GET 換源 + 3 新端點）、新 store/loader 模組。
- `services/rules-engine`：零行為改動（`ResolvedPolicySet` 型別與 `evaluate` 簽名不動；僅上游供給來源改變）。
- `web`：PolicyWorkspace / PreviewPanel / CoaMappingTable / usePolicyData（新 mutation hooks）。
- `services/anchor-svc` / `snapshot-svc` / `ingestion`：**零觸碰**。
- `.move`：零行。

## Revision log

- 2026-07-12 — external dual-review BLOCKER: 「WAC 可存不可執行」原設計把 fail-closed 放在讀端，active=MAX(version) 使存入即生效 → 全系統 503；修訂為寫入端 400 NOT_EXECUTABLE_MVP，schema 值域保留給 P1，讀端守衛保留為 raw-SQL 防線。另記：版本 bump 改變 idempotency key 的安全性依賴 POSTED 為終態（stateMachine POSTED:[]）——若未來加入 reopen/reclassify-posted 流程，需同步設計重跑防重複入帳。
