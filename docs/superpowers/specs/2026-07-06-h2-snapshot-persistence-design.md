# H2 Snapshot Persistence — Design Spec

**Date**: 2026-07-06
**Status**: Approved (brainstorm section sign-off + 三審整合，使用者裁決 13 收 1 defer，2026-07-06)
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
| A6 | 三審整合（SUI/CPA/frontend，全 READY-WITH-FIXES） | **13 收 1 defer**：SUI S-F1..F5 全收；CPA C-F1/C-F2（blocker）/C-F3 收、C-F4 併 C-F1、C-F5 defer（新舊 manifest 皆持久化，實際 delta 事後可推導）；frontend W-F1..F5 全收。逐項落點見 §3 對應段落 |

## 3. Design

### 3.1 核心持久化：`SqliteSnapshotRepo` + freeze 語義

**Schema（additive migration）**：

- `snapshots` 加 `seq INTEGER NOT NULL`。既有 rows（seq-0 時代產物，id 尾段 `-0`）統一回填 `seq=1`，對齊 snapshot-svc「seq 從 1 起、0/null 為 no-prior sentinel」慣例；id 與 PK 不動。
- 加 `UNIQUE(entity_id, period_id, seq)` 釘鏈完整性。
- **Restatement provenance 欄位（C-F1+C-F4）**：`snapshots` 加 `restatement_reason_code`、`restatement_reason`、`affected_amount_estimate`、`restatement_requested_by`、`restatement_approved_by`（全 nullable；v1/首版為 null）。freeze restate 時從當下 `period_lock` 的 reopen 欄位**快照**進來——reopen 是單列覆蓋（`periodLock/store.ts:69-74`），連環 restatement 會蓋掉前次原因，只有凍存進 snapshot row 才能對每個版本回答「為什麼有 v2」（ASC 250/IAS 8 逐次揭露要求）。H1 maker-checker 落地後 requested/approved 可回填真值，結構先到位。

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

**Anchor prepare 兩個新 guard（SUI 輪）**：

- **S-F2 過期版防錨**：`prepareAnchor` 現只查 `status==='FROZEN'`（`anchorService.ts:37`）；H2 後同 period 可有多筆 FROZEN。prepare 拒絕 seq < 同 (entity, period) 最新 snapshot seq → `ANCHOR_SUPERSEDED` 409，否則 operator 可把已知過期的 root 錨成鏈上事實、製造永久 stale。
- **S-F1 上鏈 `supersedes_seq` 域修正**：現行把 snapshot 的 per-period seq 直接上鏈（`anchorService.ts:66`），但 Move 事件語義是 chain 全域 anchor seq（`audit_anchor.move:74-75`「points at the version this one replaces」）；至今恆 0 所以 latent，H2 首次非零即引爆域分岔。改為 prepare 時查同 (entity, period) 前一筆 anchor 的 **chain seq** 傳入（無前筆 → 0）。純 off-chain 改動，零 Move 變更（Move 端視為 inert metadata，red-team test `audit_anchor.move:705-711` 已證）。

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
- **取代既有粗 proxy（W-F1 佐證，Rule 7 不並存）**：現行 `cockpit.ts:86` 的 `staleAnchor = reopenCount>0 && wasAnchoredAtReopen && status==='OPEN'` 在 re-lock 後即熄滅（anchor 其實還 stale）——root-compare 推導嚴格更準，cockpit DTO 的 `staleAnchor` 改由新推導供值，舊式子刪除。
- **空 journal 邊界（S-F4）**：0 leaves 時 `buildSnapshot` throw `EMPTY_SNAPSHOT`（`buildSnapshot.ts:25-27`）；推導定義為空 journal ⇒ `stale=true`（root 必不等），不得 crash。
- **Codec 漂移（S-F5，一行註記）**：anchored manifest 已存 `leafCodecVersion`；日後 codec bump 時應區分 `CODEC_DRIFT` 與 STALE，不混報（目前僅 V1，不實作）。
- **Proof 語義（S-F3）**：`GET /anchors` 的 inclusion proof 用當前 journal 重算，restatement 後對 superseded anchor 的舊 root 必然驗不過——明文定義：**proof 只對最新 root 有效**；superseded anchor 的可驗性佐證鏈 = 凍存的 `manifest_json` + `journal_entries.leaf_hash`，DTO `superseded: true` 即代表「勿以當前 proof 驗此錨」。

**DTO 浮出**：

1. period lock 狀態 DTO 加 `anchorStaleness: { stale: boolean, anchoredSeq: number, anchoredRoot: string, currentRoot: string, latestSnapshotSeq: number } | null`（null = 該 period 從未 anchor）。`latestSnapshotSeq`（W-F2）讓 UI 分辨兩階段：未重凍（= anchoredSeq，下一版 = +1）vs 已重凍未 anchor（> anchoredSeq，anchor CTA 標既有新 seq 而非 +1）。
2. anchors 列表 DTO 每筆加 `superseded: boolean`（該 snapshot seq < 同 (entity, period) 最新 snapshot seq）。
3. **Export 揭露戳記（C-F3）**：export/報表 API 在 STALE_ANCHOR 為真時，於產物 header/metadata 注入 disclosure（"restatement in progress — on-chain anchor corresponds to superseded v{anchoredSeq}"），複用同一推導。揭露跟著產物走，不 hard-block（A1 不變）。

**最小 UI（close cockpit）**：

- **色彩層級（W-F1）**：`--warn` 琥珀，非 debit-red——本系統色彩契約「紅=blocking、琥珀=警示不擋」（`Badge.module.css`、`close.css:75-80` vs `close.css:159`），soft-force 不擋任何操作故為 warn 層級；升級既有 `.stale-anchor-warn`（`close.css:108`）為 chip 型 badge（樣式仿 `Badge.module.css:35-39`），不另起爐灶。
- **文案（W-F4）**：英文（全 UI 英文），badge 例 "Books changed since anchor (v{anchoredSeq})"。
- **CTA**：stale 時 Freeze CTA → 「Freeze restatement (v{latestSnapshotSeq+1})」；已重凍未 anchor 時 anchor CTA 標既有 `latestSnapshotSeq`（W-F2）。版號渲染成具體數字，使用者不需理解 seq 概念。
- **位置與 RWD（W-F3）**：badge 落點 period-ribbon（`CloseCockpit.tsx:36-42`）；ribbon 現無 `flex-wrap`（`close.css:94-102`），加 `flex-wrap:wrap` + badge 文案允許換行/truncate，390px Playwright 實測驗收（lessons RWD 鐵律）。AnchorStep 實際路徑 `web/src/steps/AnchorStep.tsx`（非 workspaces/close/ 下），badge 插 Freeze 按鈕上方一行。
- **Root 顯示（W-F5）**：badge 不必顯示 root；若顯示沿既有 truncation 慣例 `slice(0, 14)…` + mono（`AnchorStep.tsx:77`）。periodId 不進 DTO（cockpit 已 entity+period scoped）。
- 不擋操作（A1）；不做歷史鏈視圖（A3，deferred）。

### 3.3 P1 per-snapshot 精確化 + env escape-hatch

**精確化**（改寫 `backfillPeriod.ts` P1 gate）：

- 對每筆 ANCHORED snapshot，用 backfill 後屬於該 snapshot `period_id` 的 JEs 走 buildSnapshot 同一 codec 重算 root，與存的 `merkle_root` byte-compare。
- 相等 → 放行（舊 gate 的 false positive 至此消除）；不等 → 真陽性，abort 訊息列出 snapshot ids + 兩邊 root 值（fail-loud 帶值慣例）。
- 仍在同一 transaction、仍是一次性 migration（`pending.n === 0` 早退守衛不動；throw → rollback → 下次 boot 再 fire）。

**Escape-hatch**：env `C2_MIGRATION_ACCEPT_ROOT_CHANGE`，逗號分隔 snapshot ids（A5）：

- 真陽性且在 allow-list → 不 abort，migration 繼續，且**寫入持久化審計表 `migration_override_log`（C-F2 blocker）**：`snapshot_id`、`old_root`、`recomputed_root`、`operator`（env 來源標示）、`accepted_at`、`justification`。console 審計行保留但不得為唯一 evidence——對照既有 `exception_disposition_log`/`recon_break_disposition_log`/`triage_proposal_log` 持久化慣例，放行 stale 錨點的決策嚴重性更高，不能只寫 stdout。
- 不在 list → 照常 abort，錯誤訊息附解套指引。
- migration 完成後 gate 永不再跑 → env 殘留無作用，無常駐後門。
- 放行的 snapshot 不改 status、不改 root；揭露由 §3.2 STALE_ANCHOR 承擔（比突變 ANCHORED 狀態誠實：鏈上事實不可否認，「對不上」是新事實）。
- **可驗性聲明（S-F3 延伸）**：escape-hatch 放行後，鏈上舊 root 從當前 period slicing 不可重現；其審計佐證鏈 = 凍存 `manifest_json` + `journal_entries.leaf_hash`（原始 slice 重現性不保證，明文記錄於 override log 語義）。

### 3.4 明確 out of scope / deferred

- Hard-block export/報表（A1 裁決捨棄；若日後升級 enforcement，STALE_ANCHOR 推導可直接複用）。
- supersede 歷史鏈 UI 視圖（A3）。
- reopen 本身的 maker-checker（H1，獨立 finding；§3.1 restatement provenance 欄位已為其留結構）。
- **實際重述影響金額計算（C-F5，defer）**：`affected_amount_estimate` 是 reopen 時的事前估計；實際 delta 可由新舊版凍存 manifest 事後推導（兩版皆持久化，無資料遺失），本輪不算。
- InMemorySnapshotRepo 保留為 snapshot-svc 測試用參考實作，不刪。

## 4. Testing

**Unit（repo）**：`SqliteSnapshotRepo` 跑與 `InMemorySnapshotRepo` 同套契約行為（首凍 seq=1/supersedesSeq=null、無 restate 重凍 throw `SNAPSHOT_EXISTS`、restate 遞增、get 回最新版）；DB 特有：UNIQUE 違反 fail-loud、`manifest_json` 損壞 get throw。

**Integration（route，encode why）**：

- **409 死路回歸測試（核心）**：anchor → reopen → 改帳 → re-lock → freeze 必須產出 seq=2/supersedesSeq=1 而非 SNAPSHOT_CONFLICT；此測試在改動前必須是紅的。
- 同 root 重 freeze idempotent 不長 row；ANCHORED 同 root 維持 ALREADY_ANCHORED。
- STALE_ANCHOR 三態：reopen 改帳未重凍 → stale；重凍未 anchor → 仍 stale；新版 anchor → 清除。空 journal ⇒ stale=true 不 crash（S-F4）。
- anchors DTO `superseded` 正確性；`latestSnapshotSeq` 兩階段值正確（W-F2）。
- **Anchor guard（SUI 輪）**：prepare 對非最新 seq 的 FROZEN 回 `ANCHOR_SUPERSEDED` 409（S-F2）；上鏈 `supersedes_seq` 在跨期 restate 場景（Q1 anchor → Q2 anchor → Q1 restate re-anchor）傳的是前一筆 anchor 的 chain seq 而非 snapshot seq（S-F1，此場景改動前必然分岔）。
- **Restatement provenance（C-F1）**：連環 restate（v2→v3）後，v2 與 v3 各自凍存的 reason 欄位不同且不被後續 reopen 覆蓋（覆蓋 bug 的反證測試）。
- **Export 揭露（C-F3）**：stale 期間 export 產物 metadata 帶 disclosure；anchor 後清除。

**Migration（P1）**：多期 entity 但 anchored root 重算相等 → 現在放行（舊 gate false positive 轉綠，證明精確化非 no-op）；root 真變 → abort 附兩邊 root；allow-list 放行 → `migration_override_log` row 落表斷言（C-F2，非只斷言 console）；不在 list 照 abort；throw 後 rollback、下次 boot 仍 fire。

**UI**：badge/CTA vitest + commit 前 Playwright 實點（cockpit 走 reopen → re-freeze 流程）。

**Monkey（規則強制）**：restate 轟炸（連環 restatement 鏈完整性）；env 塞垃圾（不存在 id、空白、超長 list）；並發 freeze race（mutex + UNIQUE 雙防線）；DB 手改 `manifest_json`/`seq` 偽造 → fail-loud；id 字串工藝攻擊（leading-zero 類，opening-equity I1 教訓）。

**驗收 gate**：typecheck 0 + api/engine/web 全套重跑報數字；零 .move 改動 → `sui move test` N/A 明說；final whole-branch review → dual-review（codex quota 耗盡期間外部輪派 fresh-context subagent）。

## 5. Ground truth 錨點（plan 撰寫時複核）

- `routes.ts:791` per-request `new InMemorySnapshotRepo()`；`routes.ts:797` id 模板；`routes.ts:803-826` resolveExisting idempotent 邏輯。
- `snapshotRepo.ts:20-23` `AuditSnapshotRepo` 介面；`buildSnapshot.ts:15-19` `opts.restate` pass-through；`buildSnapshot.ts:72` DTO `supersedesSeq ?? 0`。
- `schema.sql:27-37` snapshots 表（現況無 seq 欄）；`schema.sql:38-47` anchors 表（有自己的鏈上 seq/link，與 snapshot seq 是兩個概念）。
- `backfillPeriod.ts:66-82` 現行 P1 entity-wide gate。
- `snapshotStore.ts:37-43` `hasAnchoredSnapshot*`（status='ANCHORED' 判準，STALE_ANCHOR 推導複用）。
- `periodLock/cockpit.ts:83-89` 既有 `staleAnchor` 粗 proxy（本輪被新推導取代）；`periodLock/store.ts:69-74` reopen 單列覆蓋（C-F1 快照理由）。
- `anchorService.ts:37`（FROZEN-only check，S-F2 guard 落點）、`anchorService.ts:66`（supersedes_seq 上鏈值，S-F1 修正落點）；`audit_anchor.move:74-75,166,169,705-711`（chain seq 語義、append-only、inert metadata 佐證）。
- `web/src/steps/AnchorStep.tsx`（anchor UI 真實路徑）、`CloseCockpit.tsx:36-42` + `close.css:94-108`（ribbon/stale 文案現況）、`web/src/api/types.ts:186`（既有 `staleAnchor` DTO 欄位，改由新推導供值）。
- `routes.ts:950-961` anchors 列表 + proof 重算（S-F3 語義聲明對象）。
