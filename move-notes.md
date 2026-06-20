# Move Notes — AuditAnchor

**更新**：2026-06-20

## 目的
唯一 Move package。把每期 audit snapshot 的 `manifest_hash` + JE `merkle_root` 錨成 per-entity append-only hash chain，作可獨立驗證的防竄改證據。明細不上鏈。

## 修改的 module
- `move/audit_anchor/sources/audit_anchor.move`（新建）
- `move/audit_anchor/Move.toml`（edition 2024.beta，Sui 為 bundled system dep）

## 結構
- `EntityAnchorChain` (key, **shared**, 大小恆定)：`entity_ref` / `latest_link`(32B) / `seq` / `cap_epoch` / `last_period`。
- `AnchorCap` (key, store, owned)：`chain_id` + `epoch`，寫入授權，可 transfer 輪替。
- events：`SnapshotAnchored`（每次錨定）、`CapRotated`。

## entry / public fn
- `create_chain(entity_ref, ctx)`：share chain + genesis cap(epoch 0) 給 sender。
- `anchor_snapshot(chain, cap, manifest_hash, merkle_root, period_id, prev_link, supersedes_seq)`。
- `rotate_cap(chain, old_cap, new_owner, ctx)`：吃掉舊 cap → epoch+1 → mint 新 cap。

## Red-team 修正落地
- **F1** cap_epoch：`anchor_snapshot` 斷言 `cap.epoch == chain.cap_epoch`；`rotate_cap` bump epoch 使舊 cap 失效（且舊 cap 以 value 消費銷毀，雙重保證）。
- **F2** 定長：`manifest_hash`/`merkle_root` == 32、`period_id`/`entity_ref` ≤ 64。
- **F3** restatement：同 period 可多次錨定，`seq` 為真序、`supersedes_seq` 標前版。
- **F5** overflow：`seq + 1` 用預設 checked arithmetic，溢位 abort。
- 授權靠 owned cap 而非 `ctx.sender()`，防 sponsored-tx 繞過。

## 鏈上限制 / 決策
- sha2_256 在 `std::hash`（非 `sui::hash`，後者只有 blake2b/keccak）。
- chain object 大小恆定，歷史靠 event；不存 per-period frozen object（pilot 省 gas）。
- link = `sha2_256(prev_link || manifest_hash || merkle_root || period_id || bcs(seq))`。

## 實作層安全掃描（2026-06-20）
- **sui-security-guard**：source 無 secret（privkey/API key/硬編地址皆無）。secret/.env/pre-commit checklist 對純 Move package 多為 N/A。
- **sui-red-team**（5 向量，0 exploit）：新增 3 個 regression 測試補既有缺口：
  - `test_red_concurrent_writer_loses_on_stale_prev_link`：並發雙寫後到者用過期 prev_link → ELinkMismatch。證明 append-only 檢查即為 shared-object 並發 guard（Sui consensus 排序 + CAS 語義，無需額外 lock）。
  - `test_red_rotate_rejects_foreign_cap`：**補洞**——既有測試只在 `anchor_snapshot` 驗 wrong-chain，`rotate_cap` 的同款 `chain_id` assert 之前無測試守護（若被改壞，攻擊者可 bump 受害 chain epoch 廢掉所有合法 cap）。
  - `test_red_supersedes_seq_is_inert_metadata`：supersedes_seq=MAX_U64 純 emit、不污染 seq/link；全零 hash 合法（驗長度不驗內容）。
- **Dual-use（非漏洞，文件化不加 guard）**：
  - `rotate_cap(new_owner=@0x0)` 會永久凍結 chain，但這是合法「封帳」能力且為持有者自傷、第三方不可觸發 → 不加 `assert new_owner != @0x0`，保留封帳語義。
  - `create_chain` permissionless：無限建 chain 的 gas 由攻擊者自付，不影響他人 chain → 可接受。
- **信任邊界**：鏈上只驗長度不驗內容；manifest_hash/merkle_root/supersedes_seq 的語義正確性是 off-chain engine 責任。off-chain consumer 須把 supersedes_seq 當不可信欄位。

## 測試結果
`sui move test` → **12/12 PASS**（9 設計層 F1–F5 + 邊界/monkey，3 實作層 red-team）。

## 已知風險 / 待辦
- code review 完整：move-code-quality（通過）+ sui-security-guard（無 secret）+ sui-red-team（0 exploit）。
- 風格：test fn 保留 `test_` 前綴、未用 `assert_eq!`（有意識偏離 Move Book，理由：filter regex + 可讀性）。
- 尚未部署。部署前掃描已補齊。
