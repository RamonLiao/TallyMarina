# Off-chain Ingestion — 設計規格 v1

**日期**：2026-06-20
**範圍**：Off-chain 骨架第一刀 — Ingestion 做深（接 live testnet）
**前置**：`docs/architecture/2026-06-20-architecture-spec.md`（架構 v1）、`specs/SPEC-STATUS.md`、`move-notes.md`（AuditAnchor 12/12 pass）
**對映**：business-spec-v3 §2.5 Paid Pilot、§2.6 設計原則、§6 模組、§15 實體、§17 驗收

## 0. 目標與非目標

**目標**：把架構 spec §2 的 `[1 Ingestion]` 做扎實——針對 entity 地址，從 Sui testnet 忠實拉取鏈上活動，落成 immutable `RawTransaction` + 解構後的 `RawEffect`，具備 provider 抽象、三層冪等、cursor 斷點續抓。

**非目標（本刀不做）**：
- 不做任何會計判斷（記哪個科目、借貸方向、internal/external 淨額）——往後推到 normalize / rules engine。
- Rules Engine / Snapshot Svc 本刀只留 stub 介面，不做深。
- 不依賴會計 7 ADR sign-off（DESIGN_BLOCKED 項以配置表/設定檔留白，不寫死）。

## 1. 技術棧決策

- **語言/runtime**：TypeScript / Node。
- **理由（GTM 權重排序）**：①買家（Web2 企業/CEX/ERP 整合團隊）IT 人力以 TS/Python 為主，Rust 採用阻力大；②time-to-pilot：骨架期 TS 迭代速度數倍於 Rust；③Sui 官方 dev stack 一級公民是 TS（`@mysten/sui`、dApp Kit、Move→TS 型別生成）；④monorepo 與前端共享一套型別。
- **確定性靠紀律而非語言**：金額全程整數最小單位 + 字串存儲、禁 JS `number` 浮點、純函數 + 表驅動、測試 encode「同 input → 同輸出」。
- **DB**：Postgres（`raw_json` 用 `jsonb` 換彈性，避免 schema 演進 migration）。

## 2. 設計原則對映（§2.6）

- **Source immutable**：原始包（`raw_json`/`content_hash`）寫入後永不 UPDATE。
- **Ingestion 不做語義判斷**：忠實落事實，語義往後推 → ADR sign-off 後只換 policy 表，不動 ingestion。
- **Exception-first**：不認識的活動標 `kind='unknown'` 落地，不丟不報錯。
- **Fail loud**：同 digest 內容不一致 → 寫 `IngestionAnomaly` 告警，不靜默覆蓋。

## 3. Ingestion 追蹤標的

- **抓什麼**：按 entity 地址抓**全部** transaction block（不在 ingestion 做類型白名單過濾），解構成 `RawEffect` 清單（`coin_balance_change` / `object_transfer` / `gas` / `staking` / `event` / `unknown`），原始包永留。
- **API（pilot 決策，見 §4.1）**：pilot 暫用 JSON-RPC `client.queryTransactionBlocks({ filter: { FromOrToAddress: { addr } }, options: { showEffects, showBalanceChanges, showObjectChanges, showEvents, showInput }, cursor, limit, order: 'ascending' })`。
- `order: 'ascending'`（舊→新）刻意選擇：cursor 單調前進，斷點續抓不漏中間。
- ⚠️ **完整性前提（F2）**：ascending-from-genesis 只在「節點保有完整歷史」下成立。公共 RPC 節點會 prune 舊 tx → 若 entity 活動早於節點保留窗，會 **silent 從中段開始、漏掉早期活動**。對 immutable source-of-truth 必須**綁定 archival/full node**，不用 round-robin 公共 endpoint；歷史 backfill 改以 **checkpoint range** 驅動（node-independent 排序）較 address cursor 穩。無法證明抓到 genesis → 寫 `IngestionAnomaly(retention_gap)`，不假設完整（見 §10）。

### 真實場景的「雜」（設計需吸收的事實）
1. 一筆 PTB = 多個會計事件（1 tx ≠ 1 journal entry）。
2. 多資產多 decimals（SUI=9、USDC=6、同名不同 package 假幣）。
3. Gas 是費用，且可能 sponsor 付（歸屬問題）。
4. 物件層活動無金額但仍是經濟事件（staking 鎖/解/reward）。
5. internal transfer 不該記收入/支出 → 需 entity 地址簿淨額。
6. 失敗 tx 也扣 gas，仍要認列。
7. 鏈上 timestamp vs 會計期 cutoff 有時差。
8. RPC 分頁/cursor 重疊/retry → 必須冪等。

## 4. Provider 介面（`IngestionSource`）

上層 ingestion loop 不知資料來源；只依賴分頁拉取契約。

```ts
interface FetchPage {
  entityRef: string;
  address: string;
  cursor: string | null;   // null = 從頭/從上次斷點
  limit: number;
}
interface FetchResult {
  txs: RawTxEnvelope[];     // 含完整 effects/balanceChanges/objectChanges/events
  nextCursor: string | null;
  hasNextPage: boolean;
}
interface IngestionSource {
  readonly kind: 'sui-jsonrpc' | 'sui-grpc' | 'sui-graphql' | 'fixture';
  fetchTransactions(req: FetchPage): Promise<FetchResult>;
  describe(): Promise<{ chainIdentifier: string; epoch: number }>;
}
```

- `RawTxEnvelope` = SDK `SuiTransactionBlockResponse` 原樣封裝（digest、checkpoint、timestampMs、effects、balanceChanges、objectChanges、events、rawJson）。
- **Provider 只忠實取得 + 翻成 envelope，不解構成 RawEffect**——解構是 ingestion service 的事，換 provider 時解構邏輯不重寫。
- 實作：
  - `SuiJsonRpcSource`（pilot）：包 testnet `queryTransactionBlocks`（見 §3）。**標 throwaway**，見 §4.1。
  - `FixtureSource`：讀錄好的 testnet 真實回應 JSON，同介面回放（demo / 測試 / CI，不打網路）。

### 4.1 Provider 路徑決策（F1，Rule 7 surface conflict）

父架構 spec 寫「Sui RPC(gRPC, 唯讀)」，本 ingestion 選了 JSON-RPC `queryTransactionBlocks`——衝突需明確裁決，不 silent average。

**裁決：pilot 用 JSON-RPC impl，明確標 throwaway；gRPC/GraphQL 列 post-pilot 遷移。**

- **驗證結果（sui-architect F1 + sui-docs-query 交叉比對）**：JSON-RPC `queryTransactionBlocks` 在 testnet **仍可用、無經證實的硬移除日期**（sui-architect 提的 April 2026 removal 未被官方 docs 證實）；gRPC 為 GA/官方推薦新專案路徑；GraphQL beta-stable。
- **為何 pilot 仍選 JSON-RPC**：JSON-RPC 是**唯一現在 API surface 已確證、testnet 確定可用**的選項。docs-query 給的 gRPC TS 方法名（`get_transactions_by_address` 等）為**推測（agent 知識截止 Feb 2025，標 likely/or similar）**，依專案 web-search-verify / Rule 5 不採用未驗證 API 寫骨架。
- **遷移路徑**：`IngestionSource.kind` 已含 `'sui-grpc' | 'sui-graphql'`。gRPC impl 待能對 live testnet endpoint **實證方法簽名後**才寫（post-pilot），上層不動。
- **父 spec 的「gRPC 唯讀」**：當**目標方向**保留；pilot 實作層暫偏離為 JSON-RPC，本節即偏離記錄（Rule 7 標記待清理）。
- ⚠️ **行動前再驗**：寫 `SuiGrpcSource` 前，務必對 live testnet 確認 `@mysten/sui` 的 gRPC client subpath 與方法簽名，勿依賴本 spec 引用的推測名稱。

### 4.2 `describe()` 實作（F3）

`describe()` 是本 spec 自訂的 provider 抽象，**非 SDK 方法**。`SuiJsonRpcSource` 實作 = `client.getChainIdentifier()`（network id，源自 genesis checkpoint digest）+ 另一次 `getLatestSuiSystemState()`/latest checkpoint 取 epoch。啟動時斷言 `chainIdentifier === 預期 testnet 值`（hardcode/config）。
- **chainIdentifier 只是「網路守衛」非「資料完整守衛」**：惡意節點可回正確 testnet id 卻餵假 tx。資料正確性仍靠 normalize recon（§6 模組），不靠 chainIdentifier。

## 5. 資料模型

```sql
RawTransaction (
  digest        TEXT PRIMARY KEY,      -- 天然去重；一筆 tx 物理上一份原始包
  entity_ref    TEXT NOT NULL,         -- 第一抓到者 own（多地址命中同 digest 時）
  checkpoint    BIGINT NOT NULL,
  timestamp_ms  BIGINT NOT NULL,       -- response.timestampMs = validator checkpoint 時間，非 client 可設 (F5)
  status        TEXT NOT NULL,         -- success | failure（失敗仍記，gas 要認列）
  raw_json      JSONB NOT NULL,        -- 完整原始包，永不 UPDATE
  content_hash  TEXT NOT NULL,         -- sha256(canonicalJSON(raw_json))
  ingested_at   TIMESTAMPTZ DEFAULT now()
)

RawEffect (
  digest        TEXT REFERENCES RawTransaction(digest),
  raw_index     INT,                   -- 在 PTB 裡的位置，保序
  kind          TEXT NOT NULL,         -- coin_balance_change|object_transfer|gas|staking|event|unknown
  coin_type     TEXT, amount TEXT, decimals INT,   -- amount 字串存最小單位整數，禁 number
  counterparty  TEXT, object_id TEXT,
  PRIMARY KEY (digest, raw_index)      -- 同 tx 內位置唯一；衍生資料可整批 re-derive
)

IngestionCheckpoint (
  entity_ref TEXT, address TEXT, source_kind TEXT,
  last_cursor TEXT, last_checkpoint BIGINT, updated_at TIMESTAMPTZ,
  PRIMARY KEY (entity_ref, address, source_kind)
)

IngestionAnomaly (
  id BIGSERIAL PRIMARY KEY, digest TEXT, entity_ref TEXT,
  kind TEXT,                           -- content_mismatch | effect_overflow | ...
  detail JSONB, detected_at TIMESTAMPTZ DEFAULT now()
)
```

- `amount` 一律字串 + 最小單位整數，`decimals` 同存；換算丟到 pricing/normalize 用 `decimal.js`。
- `RawEffect` 是從 `raw_json` 純函數推導的衍生資料：解構改版 → `DELETE WHERE digest=? ; re-INSERT`，不碰原始包。

### 5.1 解構盲區與陷阱（F4，會計影響最大）

`balanceChanges + objectChanges + effects + events` **不等於完整經濟活動**，解構與下游 normalize 必須知道：

1. **`balanceChanges` 是淨額（per owner per coinType），藏 PTB 內的 coin split/merge**。對審計子帳記淨額通常 OK；若日後要 sub-operation 粒度，須走 `objectChanges`+`effects` 的 `Coin<T>` created/mutated/deleted。原始包永留 → 隨時可 re-derive。
2. **Gas 雙重計算陷阱**：`balanceChanges` 的 sender SUI delta **已扣 gas**。gas 另在 `effects.gasUsed`（computation/storage/rebate/nonRefundable）。若同時記 balanceChanges 的 SUI delta **和** 單獨 `gas` RawEffect → **雙重計算**。解構標記：`gas` effect 須註明「balanceChanges SUI delta 為 gas-inclusive」，淨額歸屬留 normalize。**Sponsored tx** 下 gas 由 sponsor gas object 付，不在 entity balanceChanges（歸屬已列 §8 DESIGN_BLOCKED）。
3. **Staking reward 結構性盲區**：`add_stake` 把 SUI 移入 `StakedSui` object（principal = balance 減 + objectChange）；但 **reward 在 epoch 邊界由系統發放、產生不了 tx block**。`queryTransactionBlocks(FromOrToAddress)` **永遠看不到 reward accrual**。任何 staking 的 entity 都有此完整性洞 → 列 §8，唯一補法是對鏈上 `StakedSui` 餘額做 recon（或 checkpoint-stream/indexer），非 tx-query 能解。
4. `RawEffect` enum 無 coin split/merge、object create/delete、package publish/upgrade 的 kind → 落 `unknown`（合 exception-first）。**`unknown` 必須攜帶足夠 raw context（指回 raw_json 的 path/index）以便日後 re-derive**。

## 6. 冪等策略（三層 + cursor）

1. **寫入冪等**：`INSERT ... ON CONFLICT (digest) DO NOTHING`。append-only，已存在即跳過，絕不 UPDATE 原始包。多地址命中同 digest → 第一抓到者定 ownership，後到 DO NOTHING。
2. **content_hash 偵測內容變更**：ON CONFLICT 時若新 `content_hash` ≠ 舊 → 不覆蓋，寫 `IngestionAnomaly(content_mismatch)`（fail loud）；一致 → 真重抓，靜默跳過。
   - ⚠️ **避免誤報（F6）**：`content_hash` 對「請求了哪組 `options`」與 RPC 可能新增的 volatile 欄位敏感。必須 **pin 固定的 `options` 集合**，並在 canonicalize 時**剔除易變欄位**（RPC 加的 metadata/latency 等），否則合法 re-fetch 會誤觸 `content_mismatch`。`content_hash` 守的是「同一節點對同 digest 回不同 effects」（防說謊節點），不是欄位排序差異。
3. **RawEffect 可重算**：衍生資料整批 delete+re-insert，`(digest, raw_index)` 防同批重複。
4. **cursor 持久化**：每抓完一頁，該頁所有 tx + effect 在**同一 DB transaction** 內寫完才推進 cursor。crash 在頁中間 → cursor 沒進 → 下次重抓該頁 → 靠第 1 層 DO NOTHING 吸收。at-least-once + 冪等寫入 = effectively-once。

## 7. 紅隊向量與防禦（ingestion = 資料入口）

| # | 攻擊向量 | 防禦 |
|---|---|---|
| 1 | RPC 餵假 tx / 假 balanceChange | `describe()` 驗 `chainIdentifier` 鎖網路；`content_hash` 留證；正確性最終靠 normalize recon（§6） |
| 2 | digest 碰撞/偽造 | digest 為 **tx intent (TransactionData)** 的 BLAKE2b-256 內容定址（F6），偽造需破 hash；effects 不變靠 Sui 執行確定性 + `content_hash` guard 在 ingestion 層實際把關，非靠 digest 本身 |
| 3 | cursor 注入跳抓漏資料 | cursor 只從 DB 自寫值讀，不接外部輸入 |
| 4 | 超大 PTB / effect 爆量 DoS | `raw_index` 上限 + 單 tx effect 數量上限，超過標 unknown + anomaly，不無限展開 |
| 5 | 時間戳操控跨期 | `response.timestampMs` = **validator 共識的 checkpoint 時間，非 client 可設**（F5：Sui tx 根本無 client 自填 timestamp 欄位，原措辭「tx 自填」攻擊不存在）；額外存 `checkpoint` seq 作同毫秒 tiebreak；cutoff 歸期在 normalize |

## 8. DESIGN_BLOCKED（待會計 ADR sign-off，本刀以配置留白）

- **多地址 internal transfer 的 ownership 與不重複入帳**：骨架用「digest 全域唯一 + 第一抓到者 own」，會計語義正確性留給 normalize + ADR。
- **entity 地址簿**（判 internal/external）、**coin type → 資產主檔**：設計成 DB 表 / 設定檔，不寫死在 code；ADR sign-off 後填表即可。
- **Sponsored tx 的 gas 歸屬**（F4-2）：gas 由 sponsor 付、不在 entity balanceChanges，記在誰帳上是 ADR 議題。

### 8.1 已知完整性洞（非 DESIGN_BLOCKED，是 ingestion 機制的結構限制，須在 spec 誠實標明）

- **節點 pruning → 早期活動可能漏抓（F2）**：靠綁 archival node + checkpoint-range backfill + `retention_gap` anomaly 緩解，無法 100% 由 tx-query 保證。
- **Staking reward accrual 抓不到（F4-3）**：epoch 邊界發放無 tx，per-address query 結構上看不到。pilot 若 entity 有 staking → 須對 `StakedSui` 鏈上餘額做 recon 補。列為 ingestion 非目標，下游 recon 模組承接。

## 9. 與已完成 AuditAnchor 的關係

本刀不直接呼叫 `anchor_snapshot`（那是 Snapshot Svc 的事，屬後續刀）。但 RawTransaction immutable 設計與 AuditAnchor 的 tamper-evident 證據鏈一致：原始包永留 = 任何時候能 re-derive，是 manifest_hash/merkle_root 可重算的本錢。

## 10. 驗收標準（success criteria）

狀態標記（2026-06-21 實作後校準）：✅ 已測覆蓋 / ⏸ 刻意 deferred（type 保留、非 silent drop）。

1. ✅ `SuiJsonRpcSource`（pilot；§4.1）對 testnet 地址分頁拉 tx，落 `RawTransaction` + `RawEffect`（離線以 `FixtureSource` + acceptance test 驗證；live smoke 為手動可選）。
2. ✅ 重跑同一抓取 → 0 重複 row（冪等驗證；`ingestEntity` 測試 + acceptance test）。
3. ✅ 注入「同 digest 不同 content」→ 產生 `IngestionAnomaly(content_mismatch)`，原始包不被改。
4. ✅ 中途 kill → 重啟從 cursor 續抓不漏不重（`ingestEntity` 測試含 re-scan 冪等 + resume-from-midpoint 兩種；真實 mid-cursor 續抓已補測）。
5. ✅ `FixtureSource` 同介面回放，CI 不打網路即可跑 §10.2–10.4。
6. ✅ 解構涵蓋 coin/object/gas/event，未知活動標 `unknown` 不丟（每個未識別欄位各發一個，spec 版語義），且 `unknown` 攜帶指回 raw_json 的 context（F4-4）。
7. ⏸ **完整性斷言（F2）— DEFERRED**：`AnomalyKind` 已保留 `'retention_gap'`，但 live 偵測（記錄節點最早 checkpoint）依賴 pin archival node，列 post-pilot（見 §8.1）。**非 silent**：type 在位、deferral 明示於此與 §8.1。
8. ✅ **不雙重計 gas（F4-2）**：gas effect 帶 `note='balance_change_gas_inclusive'` 標記，downstream 可辨識 balanceChanges SUI delta 已含 gas（deconstruct 測試斷言該 note）。
9. ✅ `describe()` 經 `getChainIdentifier()` 實作並斷言 == 預期 testnet id（F3；`SuiJsonRpcSource` 單元測試 + CLI 啟動 guard）。

> §10 校準依據：2026-06-21 最終 whole-branch review（opus）verdict SHIP WITH FIXES → I1（gas 標記）、I2（PG mismatch guard）、§10.4 resume 測試已落地；§10.7 明確改標 DEFERRED（fail-loud，不再框成已達成）。Monkey testing（rules/test.md）5 場景：4 安全通過，S2 cursor-cycle 確認缺陷 → 已補 `cursor_cycle` anomaly guard；S3 BIGINT 上界為 PG 層文件化限制。

## 11. Review 整合紀錄（2026-06-20）

- **sui-architect**（SUI 整合正確性審）+ **sui-docs-query**（API 現況驗證）兩輪，6 findings 全整合：
  - F1 → §3、§4.1（JSON-RPC pilot/throwaway 決策 + gRPC 遷移）
  - F2 → §3 警告、§8.1、§10.7（pruning 完整性 + retention_gap anomaly）
  - F3 → §4.2（describe via getChainIdentifier，network-guard-only）
  - F4 → §5.1（gas 雙重計算、staking reward 盲區、unknown context）、§8/§8.1
  - F5 → §5 schema 註解、§7 紅隊表（timestamp 措辭修正）
  - F6 → §6.2（content_hash pin options）、§7 紅隊表（digest 對 intent 定址）
- **未決待行動**（不阻擋進 plan，但實作 `SuiGrpcSource` 前必做）：對 live testnet 實證 `@mysten/sui` gRPC client subpath 與方法簽名（docs-query 給的名稱為推測，不採用）。
