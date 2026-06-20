# Sui Agentic Subledger — 架構規格 v1

**日期**：2026-06-20
**範圍**：Paid Pilot（business-spec-v3 §2.5）
**前置**：specs/SPEC-STATUS.md（SPEC CONVERGED）

## 0. 設計原則（對映 §2.6）

- Source immutable、Deterministic accounting、Human accountable（AI 不可 posting）、Exception-first、ERP remains system of record、Evidence by design。
- **鏈上 footprint 刻意最小**：Sui = 唯讀資料來源 + optional 證據錨定。Paid Pilot 驗收路徑（§17）**不依賴任何 Move 合約**；AuditAnchor 為 optional，不得阻擋 close。

## 1. 系統總覽

兩層：
1. **Off-chain 系統**（產品主體）—— ingestion → normalize → pricing/lots → rules engine → review → recon/export → snapshot。
2. **On-chain AuditAnchor**（唯一 Move package）—— 把每期 audit snapshot 的 `manifest_hash` + JE `merkle_root` 錨成 per-entity append-only hash chain，作防竄改可獨立驗證證據。

只存定長 hash，**不碰資金、不存私鑰、AI 無呼叫權**。

## 2. Off-chain 架構

```
Sui RPC(gRPC, 唯讀) ─▶ [1 Ingestion] ─▶ RawTransaction (append-only)
   [2 Normalize + AI Assist] ─▶ NormalizedEvent (revisioned；AI 僅建議)
   [3 Pricing/FX/Lots] ─▶ PricePoint, PositionLot (FIFO)
   approved event ─▶ [4 Rules Engine (deterministic, fail-closed)]
       PolicySet + MappingRule ─▶ [5 Review/Approval (maker-checker, RBAC/SoD)]
                                  ─▶ JournalEntry (balanced)
   ├─ [6 Reconciliation (wallet qty recon)]
   ├─ [7 ERP Export (generic CSV + dedup hash)]
   └─ [8 Snapshot Svc] freeze → canonical manifest → hash
         ├─▶ internal AuditSnapshot  (必須；§17 驗收條件)
         └─▶ optional: Walrus blob + AuditAnchor.anchor_snapshot()  (不阻擋 close)
```

服務對映 §6 模組、實體對映 §15。資料庫：Postgres；RawTransaction append-only，其餘 entity 版本化（§15.3）。

**關鍵約束**
- Rules Engine 純 deterministic：缺價/缺 lot/缺 mapping/不平衡 → fail closed（附錄 A.2）。
- AI Assistant 旁路：輸出寫入 NormalizedEvent suggestion 欄，**永不寫 JE、不核准、不 posting**（§6.9 禁止能力）。
- 不保存私鑰；地址驗證用 dApp Kit 簽名 challenge（§6.10）。

## 3. 鏈下→鏈上接口

Snapshot Svc 凍結資料集後計算：
- `manifest_hash` = canonical manifest 整包 sha2_256（§6.8）。
- `merkle_root` = 所有 approved JE line 的 Merkle root → auditor 可對單筆 JE 做 inclusion proof，無需上鏈明細（隱私）。

後端服務（持 `AnchorCap`）呼叫 `anchor_snapshot`。失敗只進非同步重試，不影響 close（§17）。

## 4. On-chain：AuditAnchor object model（含 red-team 修正 F1–F5）

| Object | abilities | ownership | 說明 |
|---|---|---|---|
| `EntityAnchorChain` | `key` | **shared** | per-entity；存 `latest_link`、`seq`、`cap_epoch`、`last_period`。大小恆定，不隨期數成長 |
| `AnchorCap` | `key, store` | owned（後端服務地址） | 帶 `chain_id` + `epoch`；寫入授權；可 transfer 輪替 |
| `SnapshotAnchored` | event | — | 每次錨定 emit；indexer/auditor 的主要可驗證紀錄 |

### 4.1 結構（設計，實作交 sui-developer）

```move
public struct EntityAnchorChain has key {
    id: UID,
    entity_ref: vector<u8>,   // off-chain entity id (≤64)
    latest_link: vector<u8>,  // 32 bytes; genesis = [0u8;32]
    seq: u64,
    cap_epoch: u64,           // F1: 失效舊 cap
    last_period: vector<u8>,
}
public struct AnchorCap has key, store {
    id: UID,
    chain_id: ID,             // 綁定 chain (1:1)
    epoch: u64,               // F1: 必須 == chain.cap_epoch
}
public struct SnapshotAnchored has copy, drop {
    chain_id: ID, seq: u64, period_id: vector<u8>,
    manifest_hash: vector<u8>, merkle_root: vector<u8>,
    link: vector<u8>, supersedes_seq: u64,  // F3
}
```

### 4.2 entry fn 邏輯

```
anchor_snapshot(chain: &mut EntityAnchorChain, cap: &AnchorCap,
                manifest_hash, merkle_root, period_id, prev_link,
                supersedes_seq: u64):
  assert cap.chain_id == object::id(chain)          // 授權
  assert cap.epoch == chain.cap_epoch               // F1: 舊 cap 失效
  assert len(manifest_hash)==32 && len(merkle_root)==32 && len(period_id)<=64  // F2
  assert prev_link == chain.latest_link             // append-only / tamper-evident
  seq = chain.seq + 1                                // F5: 預設 overflow abort 即可
  link = sha2_256(prev_link || manifest_hash || merkle_root || period_id || bcs(seq))
  chain.latest_link = link; chain.seq = seq; chain.last_period = period_id
  emit SnapshotAnchored{...}                         // F3: period 可多版本, 帶 supersedes_seq

rotate_cap(chain, old_cap, new_owner):               // F1
  assert old_cap.chain_id==id(chain) && old_cap.epoch==chain.cap_epoch
  chain.cap_epoch += 1
  transfer new AnchorCap{chain_id, epoch: chain.cap_epoch} to new_owner
```

### 4.3 設計決策

- **shared 而非 owned**：auditor 可直接鏈上驗證、避免 equivocation；唯一寫者靠 cap 而非 sender（防 sponsored-tx 繞過）。
- **per-period 多版本接受**（F3）：符合 spec restatement；以 `seq` 為真實順序，`supersedes_seq` 標前版。後端對帳以 event `seq` 為準，不假設 1 tx=1 期（F4）。
- **不存 per-period frozen object**：pilot 只 emit event 省 gas；永久可查物件列 Post-pilot。
- **chain object 大小恆定**：優於「鏈上存所有 anchor」，無 storage bloat（F2 定長 + 此設計共同防 DoS）。

## 5. 安全摘要（red-team 收斂）

| ID | 修正 | 狀態 |
|---|---|---|
| F1 | cap_epoch 失效舊 cap | 併入 4.1/4.2 |
| F2 | vector 定長斷言 (hash=32, period≤64) | 併入 4.2 |
| F3 | period 多版本 + supersedes_seq | 併入 4.1 |
| F4 | 後端以 event seq 對帳 | 記於 4.3 |
| F5 | seq overflow 用預設 abort | 確認 |

無資金/泛型/sender 授權面；攻擊面限於持 cap 的內部人，已由定長 + epoch + append-only 收斂。

## 6. 下一步

1. `sui-developer`：依 §4 實作 AuditAnchor package + `sui-tester` 寫 fixture（含 F1/F2 negative tests）。
2. Off-chain：先做 Ingestion + Rules Engine + Snapshot Svc 骨架（驗收核心路徑）。
3. 接口聯調：Snapshot Svc 算 manifest_hash/merkle_root → 呼叫 anchor_snapshot。
