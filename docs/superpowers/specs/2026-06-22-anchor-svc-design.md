# Anchor Svc — Snapshot → on-chain `anchor_snapshot` 聯調 Design

- **Date**: 2026-06-22
- **Status**: Approved (brainstorming)
- **Scope**: 純 TS off-chain 模組 `services/anchor-svc/`，把 `buildSnapshot()` 產出的 `anchorPayload` 錨定到 `audit_anchor::anchor_snapshot`，含真 testnet 聯調。
- **Non-goals**: 不改 Move 合約；不重算 merkle（snapshot-svc 已算）；不串全鏈路 ingestion→rules CLI（另案）。

## 1. 背景與上游介面

`buildSnapshot(RuleOutput[], meta, repo)` 回傳 `{ auditSnapshot, anchorPayload }`：

- `auditSnapshot`: `{ entityId, periodId, manifestHash(hex), merkleRoot(hex), supersedesSeq(number|null), ... }`
- `anchorPayload`: `{ manifestHash(hex 32B), merkleRoot(hex 32B), periodId, supersedesSeq(number, 0=無前版) }`

Move 端（已部署前簽名固定）：

```
public fun anchor_snapshot(
    chain: &mut EntityAnchorChain,
    cap: &AnchorCap,
    manifest_hash: vector<u8>,   // == 32B
    merkle_root: vector<u8>,     // == 32B
    period_id: vector<u8>,       // <= 64B
    prev_link: vector<u8>,       // 必須 == chain.latest_link，否則 ELinkMismatch abort
    supersedes_seq: u64,         // 純 metadata，鏈上不驗
)
```

- `link = sha2_256(prev_link || manifest_hash || merkle_root || period_id || bcs(seq))`，`seq = chain.seq + 1`。
- `EntityAnchorChain` 為 shared object，含 `entity_ref: vector<u8>`、`latest_link`、`seq`、`cap_epoch`。
- `AnchorCap` 為 owned object，含 `epoch`（rotate 會失效舊 cap）。
- `create_chain(entity_ref, ctx)` 建 chain（genesis_link）。

**現況**：package 未部署（`audit_anchor = "0x0"`，無 published-at）。active env = testnet，signer 有 ~15.5 SUI gas。

## 2. 元件

### 2.1 EntityRegistry（受信 config）
- 結構：`Record<entityId, { chainObjectId: string; capObjectId: string }>`。
- 來源：受信 config（JSON 檔 / env），聯調前由人工填（create_chain 後拿到 object id）。
- 是 A4 風險的第一道：錯的 object id 會錨到別家實體。故 registry **不單獨可信**，須配 2.2 鏈上交叉驗證。

### 2.2 `resolveChain(entityId, registry, client): { chainObjectId, capObjectId, latestLink, seq }`
A4 gate（fail-closed）：
1. registry 查 `entityId`，缺 → `EntityNotRegistered`。
2. `client.getObject(chainObjectId)` 讀鏈上 `entity_ref` / `latest_link` / `seq` / `cap_epoch`。
3. **交叉驗證** `entity_ref === deriveEntityRef(entityId)`，不符 → `EntityRefMismatch`（防 registry 被竄改或填錯）。
4. **早驗 cap_epoch**（F2，fail-closed 省 gas）：讀 `capObjectId` 的 `epoch`，與 chain `cap_epoch` 不符 → `StaleCap`（rotate_cap 後 registry 仍存舊 cap 時，避免等鏈上 `EStaleCap` abort 才發現、白白浪費一次 retry+gas）。
5. 回傳含 `latestLink`（給 prev_link）與 `seq`。

### 2.3 `deriveEntityRef(entityId): Uint8Array`
- 定義：`sha2_256(utf8(entityId))` → 固定 32B（entityId 不限長、跨語言可重算）。
- **單一真相來源**：bootstrap 的 create_chain 與 2.2 的 verify 必呼同一函式，凍進 `core/entityRef.ts`。

### 2.4 `buildAnchorTx(payload, chainObjectId, capObjectId, prevLink): Transaction`
- 送出前 assert（fail-closed，避免鏈上才 abort 浪費 gas）：
  - `hexToBytes(manifestHash).length === 32`，否則 `BadHashLen`。
  - `hexToBytes(merkleRoot).length === 32`，否則 `BadHashLen`。
  - `period_id = utf8(payload.periodId)`，`length <= 64`，否則 `PeriodTooLong`。
  - `supersedesSeq` 為非負整數且 `<= U64_MAX`，否則 `SeqOutOfRange`。
- `tx.moveCall` 餵 pure args（hash/merkle/period 為 `vector<u8>`，prev_link 為 `vector<u8>`，seq 為 u64）。

### 2.5 `anchorSnapshot(auditSnapshot, anchorPayload, deps): { digest, seq, link }`
主協調（deps = `{ client, signer, registry, packageId }`）：
1. `resolveChain` → 拿 chainObjectId/capObjectId/latestLink。
2. `prevLink = latestLink`。
3. `buildAnchorTx` → sign + execute（`showEvents: true`）。
4. 解析 `SnapshotAnchored` event → 回 `{ digest, seq, link }`。
5. **ELinkMismatch retry**：execution 因 `ELinkMismatch` abort → 重讀 `latest_link` 重建重送**一次**；再敗 → fail-loud 拋 `LinkMismatchAfterRetry`。retry 次數為常數（非 loop）。

### 2.6 bootstrap script（一次性，testnet）
- `sui client publish` → 取 packageId、填 Move.toml `published-at`。
- **保存 UpgradeCap**（F3）：publish 吐的 UpgradeCap（owned）object id 記入 notes，未來升級用；註明 Move.toml `[addresses] audit_anchor` 0x0→實 packageId 的對映（升級相容性）。moveCall target 一律用 published packageId。
- 對每個 pilot entity：`create_chain(deriveEntityRef(entityId))` → 印出 chainObjectId / capObjectId 供填 registry。

## 2.7 SDK / 執行 transport（P126，必驗 gate — 見 §7 Task 0）

testnet 已在 Protocol 126（CLI 1.73.1）：**JSON-RPC Quorum Driver 已停用，2026-07-31 永久關閉**。`@mysten/sui` 預設 `SuiClient` 走 JSON-RPC fullnode；若執行提交路徑依賴 Quorum Driver，testnet 上送不出 tx（推測，須驗）。

- anchor-svc 釘**最新 `@mysten/sui`**（不沿用 ingestion 的 `^1.0.0`）。
- 實作務必用 `@mysten/sui`（非 `.js`）、`Transaction`（非 `TransactionBlock`）。
- **未通過 §7 Task 0 spike 前，不准往下寫執行層程式碼。**

## 3. 資料流

```
buildSnapshot → { auditSnapshot, anchorPayload }
  → anchorSnapshot()
     → resolveChain (registry + 鏈上 entity_ref 交叉驗證)
     → prev_link ← chain.latest_link (鏈上讀)
     → buildAnchorTx (送出前 fail-closed asserts)
     → sign + execute (testnet)
     → parse SnapshotAnchored event
     → { digest, seq, link }
```

## 4. 錯誤處理（全 fail-closed）

| 條件 | 錯誤 | 時機 |
|------|------|------|
| entityId 不在 registry | `EntityNotRegistered` | resolveChain |
| 鏈上 entity_ref ≠ derive | `EntityRefMismatch` | resolveChain |
| cap.epoch ≠ chain.cap_epoch | `StaleCap` | resolveChain (F2) |
| hash 長度 ≠ 32 | `BadHashLen` | buildAnchorTx 前 |
| period > 64B | `PeriodTooLong` | buildAnchorTx 前 |
| supersedesSeq 越界/負 | `SeqOutOfRange` | buildAnchorTx 前 |
| prev_link mismatch | retry 一次 → `LinkMismatchAfterRetry` | execute |

## 5. 測試策略

### 5.1 單元/整合（fake SuiClient）
fake client 可注入 `latest_link` / `entity_ref` / `seq`，可模擬 execute 第一次 ELinkMismatch、第二次成功。
- A4 gate 拒絕：registry miss、entity_ref 篡改。
- buildAnchorTx 邊界：hash≠32、period=64（過）、period=65（拒）、seq 越界。
- retry-once：第一次 mismatch → 重讀新 latest_link → 第二次成功；連兩次 mismatch → 拋。
- event 解析正確回 seq/link。

### 5.2 Monkey
超長 entityId（驗 sha256 仍 32B）、period=64B 邊界、entity_ref 被竄改、並發雙寫 stale prev_link、supersedesSeq=U64_MAX。

### 5.3 真 testnet e2e（手動跑一次）
publish → create_chain → 一筆真 anchor（驗 seq=1、link≠genesis）→ 同 period restatement（驗 seq=2、supersedes_seq=1）。

## 7. 實作 gate（Task 0，必過才往下）

**P126 SDK transport spike**：①查實際 resolve 的 `@mysten/sui` 版本與該版執行 transport（JSON-RPC vs gRPC）；②testnet 用該版送一筆 minimal tx 確認能上鏈。未過不准寫執行層程式碼（§2.5）。這是 sui-architect F1（high）。

## 8. 已知 defer（非 blocker）

- registry 人工填；未來接 indexer 自動發現 entityId→chainObjectId。
- `deriveEntityRef` 在 bootstrap 與 verify 各算一次，靠 shared util 保一致（已凍 `core/entityRef.ts`）。
- 多 entity 並行錨定的批次協調為另案。
