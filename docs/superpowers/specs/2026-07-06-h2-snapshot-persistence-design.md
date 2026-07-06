# H2 Snapshot Persistence — Design Spec

**Date**: 2026-07-06
**Status**: Approved (brainstorm, section-by-section user sign-off)
**Scope**: architecture-review H2（snapshot 持久化）+ P1 精確化 + migration operator escape-hatch（`reviews/architecture-review-4lens-2026-07-03.md:16`、`tasks/progress.md:74,432`）

## 1. Problem

### 1.1 H2 現況（比 review 摘要更具體）

Snapshot row 其實已持久化（`snapshots` 表 + `insertSnapshot`，`services/api/src/store/snapshotStore.ts:18`），但 freeze route（`services/api/src/http/routes.ts:791`）每請求 `new InMemorySnapshotRepo()`：

- snapshot-svc 的版本鏈邏輯（`services/snapshot-svc/src/repo/snapshotRepo.ts`）永遠看不到前版 → `supersedesSeq` 恆 0（DTO 上是首版 sentinel）。
- **實際死路 bug**：snapshot id = `snap-{entity}-{period}-{seq}` 且 seq 恆定。anchor → reopen → 改帳 → re-lock → 重 freeze 會撞同一 PK 但 merkle root 不同 → `SNAPSHOT_CONFLICT` 409 永久卡死。restatement 路徑走不通。
- reopen 後無任何機制浮出「鏈上錨點已對不上現行帳本」。

根因是**兩個 writer**：repo.freeze() 在記憶體建鏈，routes 自己 `insertSnapshot` 進 DB；repo 每次全新，鏈斷。

### 1.2 P1 現況

C2 migration gate（`services/api/src/store/backfillPeriod.ts:66-82`）是 entity-wide proxy：anchored entity 的 events 跨 >1 period 即 abort。兩個缺陷：

- **False positive**：anchor 後才出現第二期 events 時，原 period 的 root 其實不受切片影響，但 gate 照樣 brick 整個 entity。
- **無解套**：abort 後 operator 除了手改 DB 無路可走。

## 2. Adjudications（使用者裁決）

| # | 決策點 | 裁決 |
|---|--------|------|
| A1 | reopen 後「強制 re-anchor」語義 | **Soft-force**：STALE_ANCHOR 狀態浮出 + CTA 導引，不硬擋任何操作（不擋 export、re-lock 不進 PENDING_REANCHOR） |
| A2 | P1 escape-hatch 形態 | **Env allow-list + 審計痕**；前提是先精確化到 per-snapshot |
| A3 | UI 範圍 | **後端 DTO 到位 + 最小 UI**（cockpit badge + CTA 文案），不做 supersede 歷史鏈視圖 |
| A4 | 持久化架構 | **方案 A**：`SqliteSnapshotRepo` 實作 snapshot-svc 的 `AuditSnapshotRepo` 介面，writer 收斂成 repo 一個 |
| A5 | allow-list 粒度 | **snapshot id**（非選項原文的 entity id）——精確化到 per-snapshot 後，operator 確認的是單筆錨點，不開整 entity 空白支票 |

## 3. Design

### 3.1 核心持久化：`SqliteSnapshotRepo` + freeze 語義

**Schema（additive migration）**：

- `snapshots` 加 `seq INTEGER NOT NULL`。既有 rows（seq-0 時代產物，id 尾段 `-0`）統一回填 `seq=1`，對齊 snapshot-svc「seq 從 1 起、0/null 為 no-prior sentinel」慣例；id 與 PK 不動。
- 加 `UNIQUE(entity_id, period_id, seq)` 釘鏈完整性。

**`SqliteSnapshotRepo`**（新檔 `services/api/src/store/sqliteSnapshotRepo.ts`，implements `AuditSnapshotRepo`）：

- `get(entityId, periodId)`：`ORDER BY seq DESC LIMIT 1`，manifest 自 `manifest_json` 反序列化重建 `AuditSnapshot`；反序列化失敗 → throw（fail-loud，不靜默回 null）。
- `freeze(input, opts)`：沿 snapshot-svc 契約——無前版 → `seq=1, supersedesSeq=null`；有前版無 `restate:true` → throw `SNAPSHOT_EXISTS`；`restate:true` → `seq=prev+1, supersedesSeq=prev.seq`。INSERT 由 repo 執行（writer 收斂）；id 生成 `snap-{e}-{p}-{seq}` 移入 repo。
- 整個 freeze 包 better-sqlite3 transaction（既有 per-entity mutex 之上第二道防線）。

**Freeze route 改寫**（`routes.ts:759-856`）：

1. Gate 順序不動（PERIOD_NOT_LOCKED → EXCEPTIONS_BLOCKING → RECON_BREAKS_BLOCKING）。
2. 先建 manifest 算新 root，查 repo 最新版：
   - root 相同、status FROZEN → idempotent 回傳既有 row（不 insert）。
   - root 相同、status ANCHORED → `ALREADY_ANCHORED` 409（不重複凍結同內容）。
   - root 不同 → `buildSnapshot(…, {restate: true})` → 新 seq；**這是修掉 409 死路的位置**。
3. 舊 row status 不動（ANCHORED 是鏈上事實，不可撤銷）；「被取代」由 seq 推導，非狀態機轉移。
4. Snapshot DTO 增加 `seq`（`supersedesSeq` 既有）。

### 3.2 STALE_ANCHOR 推導 + DTO + 最小 UI（soft-force）

**推導定義（deterministic，無新狀態機、無 dismiss 流程）**：

```
STALE_ANCHOR(entity, period) :=
  存在 status='ANCHORED' 的 snapshot（取 seq 最大者 A）
  且 當期 journal 重算 merkle root ≠ A.merkleRoot
```

- 覆蓋兩階段：reopen 改帳後尚未重 freeze；已重 freeze 新 seq 但尚未 anchor。
- 新版 anchor 完成 → 推導自然清除。
- root 重算走既有 buildSnapshot 同一 codec（JE_LEAF_BCS_V1），不寫第二套 hash。
- P1 escape-hatch 放行的 snapshot 由同一推導自然點亮（見 §3.3）。

**DTO 浮出**：

1. period lock 狀態 DTO 加 `anchorStaleness: { stale: boolean, anchoredSeq: number, anchoredRoot: string, currentRoot: string } | null`（null = 該 period 從未 anchor）。
2. anchors 列表 DTO 每筆加 `superseded: boolean`（該 snapshot seq < 同 (entity, period) 最新 snapshot seq）。

**最小 UI（close cockpit）**：

- LockPanel/AnchorStep 既有位置加 STALE_ANCHOR badge（debit-red 警示 token，文案「帳本已變更，鏈上錨點對應舊版」）。
- stale 時 Freeze CTA 文案 → 「Freeze restatement (v{seq+1})」；anchor CTA 同理標新 seq。
- 不擋操作（A1）；不做歷史鏈視圖（A3，deferred）。

### 3.3 P1 per-snapshot 精確化 + env escape-hatch

**精確化**（改寫 `backfillPeriod.ts` P1 gate）：

- 對每筆 ANCHORED snapshot，用 backfill 後屬於該 snapshot `period_id` 的 JEs 走 buildSnapshot 同一 codec 重算 root，與存的 `merkle_root` byte-compare。
- 相等 → 放行（舊 gate 的 false positive 至此消除）；不等 → 真陽性，abort 訊息列出 snapshot ids + 兩邊 root 值（fail-loud 帶值慣例）。
- 仍在同一 transaction、仍是一次性 migration（`pending.n === 0` 早退守衛不動；throw → rollback → 下次 boot 再 fire）。

**Escape-hatch**：env `C2_MIGRATION_ACCEPT_ROOT_CHANGE`，逗號分隔 snapshot ids（A5）：

- 真陽性且在 allow-list → 不 abort，強制 console 審計行（snapshot id、舊 root、重算 root、`operator-accepted via env`），migration 繼續。
- 不在 list → 照常 abort，錯誤訊息附解套指引。
- migration 完成後 gate 永不再跑 → env 殘留無作用，無常駐後門。
- 放行的 snapshot 不改 status、不改 root；揭露由 §3.2 STALE_ANCHOR 承擔（比突變 ANCHORED 狀態誠實：鏈上事實不可否認，「對不上」是新事實）。

### 3.4 明確 out of scope / deferred

- Hard-block export/報表（A1 裁決捨棄；若日後升級 enforcement，STALE_ANCHOR 推導可直接複用）。
- supersede 歷史鏈 UI 視圖（A3）。
- reopen 本身的 maker-checker（H1，獨立 finding）。
- InMemorySnapshotRepo 保留為 snapshot-svc 測試用參考實作，不刪。

## 4. Testing

**Unit（repo）**：`SqliteSnapshotRepo` 跑與 `InMemorySnapshotRepo` 同套契約行為（首凍 seq=1/supersedesSeq=null、無 restate 重凍 throw `SNAPSHOT_EXISTS`、restate 遞增、get 回最新版）；DB 特有：UNIQUE 違反 fail-loud、`manifest_json` 損壞 get throw。

**Integration（route，encode why）**：

- **409 死路回歸測試（核心）**：anchor → reopen → 改帳 → re-lock → freeze 必須產出 seq=2/supersedesSeq=1 而非 SNAPSHOT_CONFLICT；此測試在改動前必須是紅的。
- 同 root 重 freeze idempotent 不長 row；ANCHORED 同 root 維持 ALREADY_ANCHORED。
- STALE_ANCHOR 三態：reopen 改帳未重凍 → stale；重凍未 anchor → 仍 stale；新版 anchor → 清除。
- anchors DTO `superseded` 正確性。

**Migration（P1）**：多期 entity 但 anchored root 重算相等 → 現在放行（舊 gate false positive 轉綠，證明精確化非 no-op）；root 真變 → abort 附兩邊 root；allow-list 放行 + 審計行斷言；不在 list 照 abort；throw 後 rollback、下次 boot 仍 fire。

**UI**：badge/CTA vitest + commit 前 Playwright 實點（cockpit 走 reopen → re-freeze 流程）。

**Monkey（規則強制）**：restate 轟炸（連環 restatement 鏈完整性）；env 塞垃圾（不存在 id、空白、超長 list）；並發 freeze race（mutex + UNIQUE 雙防線）；DB 手改 `manifest_json`/`seq` 偽造 → fail-loud；id 字串工藝攻擊（leading-zero 類，opening-equity I1 教訓）。

**驗收 gate**：typecheck 0 + api/engine/web 全套重跑報數字；零 .move 改動 → `sui move test` N/A 明說；final whole-branch review → dual-review（codex quota 耗盡期間外部輪派 fresh-context subagent）。

## 5. Ground truth 錨點（plan 撰寫時複核）

- `routes.ts:791` per-request `new InMemorySnapshotRepo()`；`routes.ts:797` id 模板；`routes.ts:803-826` resolveExisting idempotent 邏輯。
- `snapshotRepo.ts:20-23` `AuditSnapshotRepo` 介面；`buildSnapshot.ts:15-19` `opts.restate` pass-through；`buildSnapshot.ts:72` DTO `supersedesSeq ?? 0`。
- `schema.sql:27-37` snapshots 表（現況無 seq 欄）；`schema.sql:38-47` anchors 表（有自己的鏈上 seq/link，與 snapshot seq 是兩個概念）。
- `backfillPeriod.ts:66-82` 現行 P1 entity-wide gate。
- `snapshotStore.ts:37-43` `hasAnchoredSnapshot*`（status='ANCHORED' 判準，STALE_ANCHOR 推導複用）。
