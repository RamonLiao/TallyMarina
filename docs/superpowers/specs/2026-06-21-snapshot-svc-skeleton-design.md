# Snapshot Service 骨架 — Design Spec

- **Date**: 2026-06-21
- **Status**: Approved (brainstorming)
- **Scope**: Off-chain deterministic library. NO Sui I/O, NO real DB. 接口聯調（真 Move call）為獨立後續 TODO。
- **Upstream**: `services/rules-engine`（`buildMerkle`, `encodeJeLeaf`, `RuleOutput`）
- **Downstream**: `move/audit_anchor` 的 `anchor_snapshot`（聯調階段才呼叫）

## 1. 目的

把一個會計期間內 Rules Engine 的輸出凍結成 auditor 可**跨語言重算**的 `AuditSnapshot` manifest，並產出 anchor payload（`manifest_hash` / `merkle_root` / `period_id` / `supersedes_seq`）。

缺口：`buildMerkle` 產 `merkleRoot` 但**不產** `manifest_hash`（整包 manifest 的 sha256）。算 manifest_hash 是本 service 的核心新職責。

## 2. 範圍邊界（骨架）

**做**：
- `RuleOutput[]` → 過濾 POSTABLE → flatten JE → `buildMerkle`
- 組 canonical `AuditSnapshot` manifest（BCS）→ `manifest_hash`
- 輸出 anchor payload
- in-memory 持久化（idempotency / restatement 語義）

**不做（YAGNI / 留聯調或單獨 chat）**：
- Sui PTB / 交易送出
- `prev_link` 計算（鏈上 `chain.latest_link` 狀態）
- cap epoch / gas / 競態處理
- 真 DB schema / migration
- Walrus 上傳

**聯調風險註記（sui-architect A4）**：`anchor_snapshot` 簽名不收 entityId，靠 `cap.chain_id == object::id(chain)` 綁 entity。manifest 雖綁 entityId，但 off-chain↔on-chain 對應**未在 hash 層強制** → A 主體 manifest 可被錨到 B 的 chain（manifest_hash 仍合法）。聯調階段必須建立可信的 `entityId → EntityAnchorChain object id` 映射並 gate。

## 3. Manifest 序列化決策

- **Encoding**: BCS，`SNAPSHOT_MANIFEST_BCS_V1`。與 leaf codec（`JE_LEAF_BCS_V1`）同序列化家族，避免跨語言 JSON 數字/BigInt edge case，且不與既有 BCS 路線分裂。
- **Domain prefix 三層**：leaf `0x00`、node `0x01`、**manifest `0x02`**。
- `manifest_hash = sha256(0x02 || BCS(manifest_struct))`，hex 輸出。
- BCS ↔ Move type map 凍在本 spec 附錄，供未來鏈上重算 / auditor 第三方實作。

## 4. Manifest 欄位集

| 欄位 | BCS 型別 | 為何進 hash |
|---|---|---|
| `manifestVersion` | string (`'SNAPSHOT_MANIFEST_BCS_V1'`) | 防版本混淆 |
| `entityId` | string | 綁主體，防跨 entity 重放 |
| `periodId` | string (≤64B) | 綁會計期間 |
| `merkleRoot` | bytes (32) | 綁 JE 集合 |
| `leafCount` | u64 | 防截斷（少塞 JE） |
| `leafCodecVersion` | string (`'JE_LEAF_BCS_V1'`) | 綁 leaf 編碼版本 |
| `merkleParams` | struct | 綁 merkle 建構規則；冗餘但自描述（auditor 重算不需外部文件） |
| `policyVersions` | vector\<string\>（dedupe + lex sort） | 綁 Rules Engine 政策版本 |
| `createdAtLogical` | u64 | 決定性序（period close 邏輯序，**非** wall clock） |

`merkleParams` struct 欄位（取自 `MerkleManifest`）：`algo`, `leafDomainPrefix`, `nodeDomainPrefix`, `oddNodePolicy`, `orderingPolicy`。

**刻意排除**：
- `lineageHash` — off-chain sidecar，C1/C2 已定不進 leaf，manifest 亦不進。
- wall-clock timestamp — 不決定性，破壞重算。
- `supersedesSeq` — 屬鏈上 append 語義，進 anchor payload 而非 manifest hash。

### 決策點
- `createdAtLogical` 由 **caller 傳入**（period close 的邏輯序號/版本）。library 不自生時間，保持純函式可重算。
- `policyVersions` 由 library 從 `RuleOutput.explanation.policyVersions` 收集去重排序（權威來源，不靠 caller 組裝）。

## 5. 輸入型別

```ts
buildSnapshot(
  outputs: RuleOutput[],
  meta: { entityId: string; periodId: string; createdAtLogical: number },
  repo: AuditSnapshotRepo,
  opts?: { restate?: boolean },
): { auditSnapshot: AuditSnapshot; anchorPayload: AnchorPayload }
```

- 輸入 `RuleOutput[]`（權威來源，含 policyVersions），非裸 `JournalEntry[]`。
- 直接 import rules-engine 的 `RuleOutput` 型別（上下游本就耦合）。

## 6. 資料流（buildSnapshot）

```
RuleOutput[] + { entityId, periodId, createdAtLogical }
  ① 過濾 decision==='POSTABLE' 的 RuleOutput（REVIEW_REQUIRED/REJECTED 不進 snapshot）
  ② flatten journalEntries → JE[]；空 → throw EMPTY_SNAPSHOT
  ③ buildMerkle(JE[]) → { merkleRoot, leafCount, merkleParams, leafCodecVersion }
  ④ policyVersions = dedupe+sort(flatMap explanation.policyVersions)
  ⑤ manifest struct（§4）→ BCS encode → sha256(0x02||..) = manifestHash
  ⑥ repo.freeze(entityId, periodId, snapshot, opts) → idempotency/supersedes
  → { auditSnapshot, anchorPayload }

anchorPayload = { manifestHash(hex 32B), merkleRoot(hex 32B), periodId, supersedesSeq }
  ※ prev_link NOT computed（鏈上狀態，聯調階段補）
```

## 7. 錯誤處理（fail-closed）

| Error code | 觸發 |
|---|---|
| `EMPTY_SNAPSHOT` | 無 POSTABLE JE |
| `DUPLICATE_IDEMPOTENCY_KEY` | 跨 RuleOutput 撞 idempotencyKey（buildMerkle throw 冒泡；視為上游 bug） |
| `PERIOD_ID_TOO_LONG` | periodId UTF-8 byte 長度 > 64（`Buffer.byteLength(periodId,'utf8')`，**非** `.length`；對齊 Move `vector<u8>` ≤64 bytes） |
| `INVALID_ENCODING` | entityId / periodId 非 valid UTF-8（對齊 Move `String::utf8` 約束；否則鏈上 BCS decode → `String::utf8` abort，auditor 無法重算 manifest_hash） |
| `INVALID_META` | entityId 空 / createdAtLogical 非整數（含負數、非 finite） |
| `SNAPSHOT_EXISTS` | 同 (entityId, periodId) 已凍結且未帶 `restate: true` |

restatement：`restate: true` 且既有 → 新版 + `supersedesSeq` 指前一版的 seq。

## 8. 持久化（骨架 = in-memory）

```ts
interface AuditSnapshotRepo {
  freeze(entityId: string, periodId: string, snapshot: AuditSnapshot, opts?: { restate?: boolean }): FreezeResult;
  get(entityId: string, periodId: string): AuditSnapshot | null;
}
```

- `InMemorySnapshotRepo`：Map keyed by `entityId|periodId`，每 key 保留版本鏈（restatement）。
- 鎖住語義：同 period 重 freeze 預設 reject；restate 才產新版並回填 `supersedesSeq`。
- 真 DB schema / migration 留後續。

## 9. 測試策略（vitest）

- **Golden manifest vectors**：凍 `manifestHash` 字面值（跨語言 ground truth，防序列化漂移）。
- **決定性**：同輸入兩次 → 同 hash；JE 順序打亂 → 同 root/hash。
- **Fail-closed**：每個 error code 一個 negative test。
- **欄位綁定**：逐一改 manifest 欄位 → `manifestHash` 必變（Rule 9：證明沒漏綁；可 fail 的測試）。
- **POSTABLE 過濾**：混入 REVIEW_REQUIRED/REJECTED → 不進 merkle。
- **Restatement**：freeze → re-freeze reject → restate 產新版 + supersedesSeq。
- **Monkey**：大量 RuleOutput、極長 policyVersions、unicode entityId、重複 freeze。

## 10. 附錄 — BCS ↔ Move type map（`SNAPSHOT_MANIFEST_BCS_V1`）

| Manifest 欄位 | BCS | Move (未來鏈上重算) |
|---|---|---|
| manifestVersion | string | `String` |
| entityId | string | `String` |
| periodId | string | `String` (≤64B) |
| merkleRoot | fixed bytes[32] | `vector<u8>` len 32 |
| leafCount | u64 | `u64` |
| leafCodecVersion | string | `String` |
| merkleParams.* | string×5 | `String`×5 |
| policyVersions | vector\<string\> | `vector<String>` |
| createdAtLogical | u64 | `u64` |

序列化順序 = 上表由上而下（BCS 為 positional，順序即 schema，不可重排）。

**UTF-8 約束（sui-architect A1）**：所有映成 Move `String` 的欄位（entityId/periodId/leafCodecVersion/merkleParams.*/policyVersions/manifestVersion）必須為 valid UTF-8。off-chain encode 前驗證（見 §7 `INVALID_ENCODING`），確保鏈上 BCS decode → `String::utf8` 不 abort。
