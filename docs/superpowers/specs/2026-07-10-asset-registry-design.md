# Asset Registry — decimals 單一權威來源（Spec 1/2）

**日期**：2026-07-10
**Track**：Plan track
**狀態**：設計完成 + 三審整合（SUI / CPA / frontend，全 `READY-WITH-FIXES`），待實作
**後續 spec**：`2026-07-10-manifest-asset-commitment-design.md`（Spec 2，依賴本 spec 完成）

---

## 1. 問題陳述

系統目前**不知道**它記帳的資產各自用什麼小數刻度（decimals）。這個事實散在三處，彼此從不對帳：

| 位置 | 內容 | 誰讀 | 是否進入密碼學錨定 |
|---|---|---|---|
| `events.raw_json.assetDecimals` | **per-event** 欄位 | rules-engine（`p06_pricefx.ts:11` → `decimal.ts:19 mulUnitPrice`） | 值進成本基礎 → JE → leaf → merkle root → 上鏈 |
| `services/api/src/fixtures/acme-pilot-001.recon.json[].decimals` | per `(wallet, coinType)` | `collect.ts:58`、`lots/dto.ts:34` | 否（僅顯示） |
| 硬編 `?? 9` | 兜底預設 | `collect.ts:58`、`lots/dto.ts:134` | 否（僅顯示） |

### 1.1 四個缺陷

- **A — `assetDecimals` 是 per-event，同一 `coinType` 的兩筆 event 可帶不同刻度，無任何不變量攔阻。**
  它的值直接進 `mulUnitPrice()` 算成本基礎，成本基礎進 JE，JE 進 leaf hash，leaf 進 merkle root，root 上鏈。
  這是唯一一條「錯誤刻度可被密碼學錨定」的路徑。**目前潛伏未觸發**（events fixture 只有 `0x2::sui::SUI`，一律 `assetDecimals: 9`）。

- **B — 兩套 decimals 從不對帳。** `events.raw_json.assetDecimals`（權威，進帳）與 recon fixture 的 `decimals`（顯示）之間沒有任何斷言。

- **C — `?? 9` 在 book-only 資產上觸發。** 6dp 穩定幣被當 9dp 顯示 → 差 1000 倍，且恰好印在標了 material break 的那一列。不影響 `costMinor`，只影響顯示與 CSV。

- **D — export CSV 無 decimals 欄。** 下游 ERP 無法還原刻度。

### 1.2 已更正的錯誤前提（留痕，不靜默改掉）

`tasks/progress.md`（2026-07-10 版）宣稱：

> `lots/dto.ts:31-34` 讓 FIFO 成本基礎的刻度去讀對帳 demo fixture → 成本基礎進 JE → leaf hash → merkle root → 上鏈

**不成立。** `lots/dto.ts` 的 `decimals` 從 `decimalsLookup()`（`:31-40`）取得後只在 `:134` 寫進 DTO，**無任何下游消費**。成本基礎由 `simulateLots()`（`:45`）跑 rules-engine 重放算出，rules-engine 讀的是 `event.assetDecimals`。

progress.md 另稱 `assetDecimals` 是「ingest 側死資料」。grep 字面為真，**推論錯誤**：api 把整份 `rawJson` 交給 rules-engine，那裡讀它並以 zod 驗界（`schemas.ts:21`）。它是唯一活著的權威。

progress.md 引用的 `services/api/src/audit/buildBundle.ts` **不存在**。export 在 client-side：`web/src/workspaces/export/buildBundle.ts`。

---

## 2. 目標與非目標

### 目標
1. 系統對每個 `(entity, coinType)` 有**單一、可稽核**的 decimals 權威。
2. 缺陷 A 被封死在 ingest：不一致的 `assetDecimals` 無法入帳。
3. 報表/CSV 下載**精確**：帶 decimals，數量以無損十進位字串輸出，全程不碰浮點，格式契約明確（§6.4.1）。
4. 會計人員能看到每筆對帳差異**平到第幾位小數、從第幾位開始不平**，**輔助判斷該差異是否屬於捨入層級**。
   ⚠️ **這不是處置決策的充分依據**（見 §7.3）。
5. 未登錄的資產是**控制缺陷**，不是顯示瑕疵：擋 close，且在畫面上可見、不可被 cosmetic dismiss。

### 非目標（本 spec 明確不做）
- 不改 `JeLine` / `je_json` / `leafCodec` / merkle / 既有 snapshot root。
- 不改 rules-engine（繼續讀 `event.assetDecimals`，只是該值現在必須通過 registry 驗證才進得來）。
- 不改 snapshot-svc / anchor-svc / Move 合約。（manifest 承諾刻度是 **Spec 2**。）
- 不做自動 dust 處置 policy、不做 materiality 主檔化（見 §10）。
- 不正規化既有表（`lot_movement.coin_type` 等）的 coinType 字面值。
- **不做暗色模式**：此 app 無暗色模式（`tokens.css` 僅有 `:root`，全 repo 無 `prefers-color-scheme` / `data-theme`）。新 token 一律留在 paper palette。
- **本表是 decimals 權威，不是會計分類主檔。** 資產分類（intangible / financial asset）、功能性貨幣範疇、公允價值 level 1-2-3、減損政策 → 獨立主檔，另案（§10）。

### 2.1 本控制無法斷言的事（誠實揭露）

`UNREGISTERED_ASSET` 只在資產**出現在 book（event）或 statement（對帳單）**時觸發。一個鏈上實際持有、但從未產生 event、也不在保管方對帳單上的 token（空投、直接收到的 dust）**完全隱形** —— 沒有任何東西讓它浮現。

**本 spec 不斷言資產母體完整性（completeness assertion）。** 未入帳資產偵測是獨立議題（§10）。此處明說，是因為靜默 = 假裝有涵蓋，而未入帳資產是數位資產審計的頭號風險。

---

## 3. 核心裁決

| # | 裁決 | 理由 |
|---|---|---|
| D1 | Registry 是**獨立宣告**的主檔，不從交易資料推導 | 從交易推導主檔 = 讓最後一筆 event 有權改寫全帳的刻度定義，即缺陷 A 的成因 |
| D2 | 權威來源**混合**：預設抓鏈上 `CoinMetadata`（`source='chain'`），抓不到才人工宣稱（`source='manual'`） | 鏈上刻度可被審計人員獨立重驗；人工宣稱不行。混在同一欄而不標記 = 讓不可驗證資料偽裝成可驗證 |
| D3 | `source='manual'` 的資產**可以** anchor，但必須揭露，且 manual 路徑目前**無 SoD**（§3.1） | 沿用 H2 restatement disclosure 模式。禁止 anchor 會擋住合法場景（新發行 coin、私有 coin） |
| D4 | Registry **entity-scoped**，PK `(entity_id, coin_type)` | 這張表存的不是「這個 coin 的 decimals」，而是「這個 entity 的帳簿承認這個 coin 用什麼刻度記帳」 |
| D5 | Registry 只**驗證** `event.assetDecimals`，不取代它 | 值不變 → leaf / merkle / 既有 snapshot root byte-identical → 零 re-anchor |
| D6 | 三層閘門：ingest **fail-closed**、顯示**容忍且亮紅燈**、export **fail-closed** | CSV 少了刻度進 ERP，下游會拿它當某個刻度解讀，錯得無聲 |
| D7 | `decimals` **不可 UPDATE**。已入帳資產要改走 restatement | 已有 event 以某刻度入帳後改 registry = 追溯改寫全部歷史數量的意義 |
| **D7b** | **但提供零爆炸半徑的更正路徑**：僅當該 `(entity, coin_type)` 的 event/JE count = 0 **且**未出現在任何 anchored snapshot 時，允許 correct（delete + reinsert），log `outcome='corrected'` | **CPA Critical**。沒有它，第一個 typo 就會逼出「登錄一個新的 canonical 變體來繞過不可變更」的行為 —— 控制設計自己在製造繞過並污染主檔 |
| D8 | 加 `CHECK` constraint | **刻意偏離既有慣例**，見 §4.1 |
| D9 | 精度剖面是**純資訊**；`thresholdMinor` 仍是唯一 close gate；處置走既有 disposition 狀態機 | 「建議」與「裁決」分離 |
| D10 | 「平到第幾位」用**截斷**判定，不用四捨五入 | 唯一不引入 rounding policy 爭議的定義。CPA 覆核 affirm：`breakMinor` 本身已是精確 minor 整數，用四捨五入描述反而會**謊報**「平到第 N 位」（`0.0005` 被進位） |
| D11 | **無 backfill、無 `source='backfill'`** | 產品沒有 legacy。從既有 event payload 反推 registry 正是 D1 否決的「從交易推導主檔」 |
| D12 | 未登錄資產 → `UNREGISTERED_ASSET` 旗標，**擋 close**，且**抑制 disposition 控制項** | 持有一筆資產而系統不知道它的刻度，是不該結帳的狀態 |
| D13 | `decided_by` 取 **server-side 常數**，絕不收 client body | 既有 pattern：`routes.ts:633,926` 硬編 `'demo-controller'`、`:723` 用 `LOCKED_BY` |
| **D14** | **鏈上讀取一律走 `client.stateService.getCoinInfo()`，禁用 `client.getCoinMetadata()`** | **SUI Critical**。見 §3.2 |
| **D15** | **網路/傳輸錯誤必須 propagate（`503`），絕不得與「鏈上無 metadata」混為一談，絕不引導至 manual** | **SUI Critical × CPA Critical 的交集**。見 §3.2 |
| **D16** | registry 存 `symbol` / `display_name`（chain 自動擷取、manual 必填）與 `chain_object_version` | **CPA + SUI**。沒有人類可讀識別，審計師無法用 64-hex struct tag re-perform；沒有物件版本，日後重驗讀到的是當下鏈上狀態，無版本錨點 |

### 3.1 Open control gap（不假裝有控制）

**`source='manual'` 路徑目前沒有職責分工（SoD）。** `decided_by` 是 server-side 常數（D13 已擋掉身分冒充，但那不是核准）。manual 值 → 成本基礎 → JE → merkle → **上鏈**，唯一的「控制」是一個揭露旗標。

更糟的是它與 D12 複合：結帳期限壓力下，當事人**自助登錄一個假 decimals 就能解鎖 `UNREGISTERED_ASSET` 的 close gate**，然後被錨定。這正好製造本 spec 想防的「垃圾進、被密碼學承諾」。

**本輪的最小補償控制**（不是 SoD，是使其可見）：
- registry 記 `created_at`（已有）。
- 若登錄時點落在該 entity 的 period close window 內 → 在 export disclosure 與 close cockpit **標紅**「close window 內登錄的資產」。
- `reason` 必須有意義：最小長度驗證，拒絕 `"n/a"` 類佔位字串。

**真正的 maker-checker（輸入者 ≠ 覆核者）需要 H1（authenticated principal）落地。** 在 H1 之前，`decided_by` 與任何 `reviewed_by` 都只會是 server-side 常數，**兩個常數互相覆核是假控制，比誠實揭露更糟**。此處列為 open control gap，綁 H1。

### 3.2 SDK 陷阱（SUI 審查實查，已複驗）

`@mysten/sui@2.19.0` 的 `client.getCoinMetadata()` **不可用於本 spec 的目的**：

```
grpc/core.mjs:147-164
150:   try {
151:     ({response} = await this.#client.stateService.getCoinInfo({ coinType }));
152:   } catch {
153:     return { coinMetadata: null };        ← 吞掉所有 transport error
154:   }
155:   if (!response.metadata) return { coinMetadata: null };
158:   decimals: response.metadata.decimals ?? 0,   ← 本 spec 要修的 bug，活在 SDK 裡
```

兩個致命後果：

1. **`?? 0` coercion**（`core.mjs:158`）。`client/types.d.mts:258-266` 宣告 `CoinMetadata.decimals: number`（**required**）。所以一個 proto 上 omit 了 decimals 的 metadata object，到達應用層時是 `decimals: 0` —— 通過任何 `Number.isInteger(d) && d >= 0 && d <= 36` 的驗證，且**與一個合法的 0-decimal coin 完全無法區分**，然後被記為 `source='chain'`。這是 `?? 9` 換成 `?? 0` 在 SDK 裡重生。
   → **必須改用 `client.stateService.getCoinInfo({ coinType })`**（`grpc/client.d.mts:49` 可達），讀未經 coerce 的 raw proto。該層的 `decimals?: number` 是**真的 optional**（`state_service.d.mts:76-78`）。`decimals === undefined` 才是真的「無刻度」。

2. **bare `catch`**（`core.mjs:152-153`）。網路瞬斷與「這個 coin 鏈上沒有 metadata」回傳**完全相同的值**（`{ coinMetadata: null }`）。接上本 spec 的流程就是：RPC 瞬斷 → 判定「無 metadata」→ 要求手填 → 寫 `source='manual'` → **D7 說永不 UPDATE** → 一次網路抖動把一個鏈上可驗證的資產**永久降級**成人工宣稱。
   → **D15**：transport error 必須 propagate，onboarding 回 `503 CHAIN_UNREACHABLE`，**不**引導去 manual。
   → D7b 的更正路徑是這條的第二道保險。

**未驗證項（誠實標註）**：新的 `CoinRegistry` 模型暴露了 `MetadataCap`，proto 註解稱其「allows updating the coin's metadata fields」（`state_service.d.mts:104-116`），且 metadata 可能來自 live `coin_registry::Currency` object（`:68`）而非 frozen object。**`set_decimals` 是否存在於 CoinRegistry，未對框架原始碼查證。** D16 的 `chain_object_version` 錨點讓這個未知變得無關緊要：重驗永遠針對當初擷取的版本。

（`RegulatedCoinMetadata`（`:205`）是**獨立物件**，只帶 deny-list 資訊，不帶 decimals。DenyList 不會讓「一個 coinType 對應唯一 decimals」失效 —— 查證後無需處置。）

---

## 4. 資料模型

```sql
CREATE TABLE IF NOT EXISTS asset_registry (
  entity_id            TEXT NOT NULL REFERENCES entities(id),
  coin_type            TEXT NOT NULL,                                  -- canonical (§8 V2)
  decimals             INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  symbol               TEXT NOT NULL,                                  -- D16：人類可讀
  display_name         TEXT NOT NULL,
  source               TEXT NOT NULL CHECK (source IN ('chain','manual')),
  chain_object_id      TEXT,                                           -- source='chain'
  chain_object_version TEXT,                                           -- D16：重驗的版本錨點
  fetched_at           TEXT,                                           -- source='chain'
  decided_by           TEXT,                                           -- source='manual'
  reason               TEXT,                                           -- source='manual'，最小長度驗證
  created_at           TEXT NOT NULL,
  PRIMARY KEY (entity_id, coin_type)
);

CREATE TABLE IF NOT EXISTS asset_registry_log (   -- append-only（見 §4.3 誠實揭露）
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id        TEXT NOT NULL,
  coin_type        TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('registered','conflict','rejected','corrected')),
  decimals         INTEGER,          -- 最終寫入值（registered/corrected）
  claimed_decimals INTEGER,          -- conflict：client 宣稱值
  chain_decimals   INTEGER,          -- conflict：鏈上值
  source           TEXT,
  detail           TEXT,
  actor            TEXT NOT NULL,
  at               TEXT NOT NULL
);
```

`decimals` 的 `0..36` 上界與 rules-engine `schemas.ts:21` 一致（該處註解：「bound 指數，防 `10^n` BigInt DoS」）。

`source` **不參與任何 predicate**。它只被 export bundle 與（Spec 2 的）manifest 讀去做揭露。避免它長成第二個 `openMaterial`（名字講來源、值被拿去當權限用）。

`claimed_decimals` / `chain_decimals` 是分開的欄位而非塞進 free-text `detail`：審計師要 re-perform「我們正確拒絕了與鏈上不符的 client 值」，需要兩個值都是結構化的。

### 4.1 CHECK constraint — 刻意偏離既有慣例（Rule 7 留痕）

`services/api/src/store/schema.sql` 目前有 **0 個 CHECK constraint**。既有慣例是不用。

本 spec **不遵守**該慣例。理由是 2026-07-10 那輪的教訓原文：

> DB 對 `state` **無 CHECK constraint**，髒值會以字串抵達 predicate

既有風格是那個 bug 的**成因**，不是要保護的資產。`source` 尤其必須有 CHECK，因為 export 的揭露邏輯會讀它。

**待清理標記**：其餘表（`exception_disposition.state`、`recon_break_disposition.state` 等）同樣缺 CHECK。不在本 spec scope，記入 backlog。

### 4.2 Migration

沿用 `db.ts` 既有機制（`MIGRATIONS` 陣列逐行 `db.exec(m)`，catch 只吞 `/duplicate column/i`，其餘 re-throw）。

兩張新表以 `CREATE TABLE IF NOT EXISTS` 進 `schema.sql`（fresh DB）**與** `MIGRATIONS`（既有 DB）。冪等。

**無資料 backfill**（D11）。既有 DB 在資產登錄前，recon 會亮 `UNREGISTERED_ASSET`、export 會拒絕產出、新 event 的 ingest 會被拒。這是設計意圖，不是回歸。

demo 資料以 `scripts/seed-assets.ts` 明確 seed（可讀、可 commit、不偽裝成遷移）。

### 4.3 稽核 log 的完整性限制（誠實揭露）

`asset_registry_log` 的 append-only **只是慣例，SQLite 層無強制**，且 **log 本身未被 anchor**。這些登錄裁決餵養了上鏈資料，但裁決的 log 自己不是 tamper-evident。

SOC 1 / ICFR 下，稽核 log 的完整性本身就是一個控制。「意圖上 append-only」不是 ITGC。**週期性把 log hash 納入既有 anchor** 是正解，列入 §10。

---

## 5. 模組邊界

```
services/api/src/assets/
  normalize.ts   — canonicalCoinType(s): string        純函式
  precision.ts   — breakPrecision(breakMinor, decimals) 純函式，無 I/O
  registry.ts    — getAssetDecimals(db, entityId, coinType): AssetInfo | null   同步、無網路
  register.ts    — registerAsset(...) / correctAsset(...)   唯一有網路 I/O 的檔案
  store.ts       — asset_registry / asset_registry_log 的 SQL
```

```ts
type AssetInfo = {
  decimals: number;
  symbol: string;
  displayName: string;
  source: 'chain' | 'manual';
};
```

**不變量**：`registry.ts` 與 `precision.ts` 純同步、無網路、無 DB 寫入 → 可被 ingest 熱路徑與所有 read path 安全呼叫。網路只活在 `register.ts`。這是「onboarding 登錄、ingest 純驗證」裁決的物理落地。

---

## 6. 資料流

### 6.1 寫入 — onboarding（唯一的網路 I/O）

`POST /entities/:id/assets`
Body：`{ coinType: string, decimals?: number, reason?: string }`

1. `canonicalCoinType(coinType)` —— 本地格式驗（`isValidStructTag`）+ `normalizeStructTag`。失敗 → `400 INVALID_COIN_TYPE`。**零網路**（V5 防禦）。
   **MVR named package（`app@org::x::Y`）→ `400 NAMED_PACKAGE_UNSUPPORTED`**（V2，見 §8）。
2. `client.stateService.getCoinInfo({ coinType })`（**D14**，禁用 `getCoinMetadata`）。以 `AbortSignal` 設逾時。**失敗不重試。**
3. 分歧（**順序不可調換**）：
   - **transport / RPC error** → **propagate**，`503 CHAIN_UNREACHABLE`。**不得**落入 manual 分支（**D15**）。
   - `response.metadata` 不存在，或 `response.metadata.decimals === undefined`（raw proto，真 optional）→ 鏈上無刻度 → **必須**有 body `decimals` + `reason`（最小長度驗證）才收，`source='manual'`，`decided_by` = server-side 常數（D13），`symbol` / `display_name` 由 client 必填。缺任一 → `400 MANUAL_DECIMALS_REQUIRED`。
   - `decimals` 存在且通過**顯式驗證** → `source='chain'`，擷取 `symbol` / `name` / `chain_object_id` / `chain_object_version` / `fetched_at`。
     **若 body 也帶了 `decimals` 且與鏈上不符 → `409 CHAIN_DECIMALS_MISMATCH`，不採信 client**，log 記 `claimed_decimals` + `chain_decimals`。
4. `db.transaction`：`INSERT ... ON CONFLICT DO NOTHING` → re-read。
   - 無既有列 → `201`。
   - 既有列 `decimals` 相同 → `200`（冪等）。
   - 既有列 `decimals` 不同 → **`409 ASSET_DECIMALS_CONFLICT`，永不 UPDATE**（D7、V3）。
5. `asset_registry_log` append（在 transaction **之外**，鏡像 `ingestEvent.ts:20-24` 已文件化的 TOCTOU 處理）。

**顯式驗證**（raw proto 的 `decimals?: number`）：

```ts
const d = response.metadata?.decimals;             // 未經 SDK coerce
if (d === undefined) → manual 分支
if (!Number.isInteger(d) || d < 0 || d > 36) throw new Error('COIN_METADATA_INVALID_DECIMALS');
```

**禁止**對 decimals 使用 `??` 或 `||`。以測試釘死（§9）。

`GET /entities/:id/assets` → 列出已登錄資產（含 `source`、`symbol`、`created_at`）。

### 6.1.1 更正端點（D7b）

`DELETE /entities/:id/assets/:coinType`

**硬 predicate，缺一不可**：
- 該 `(entity_id, coin_type)` 的 event count = 0
- 該 `(entity_id, coin_type)` 的 JE count = 0（含 `je_json.lines[].origCoinType`）
- 該 coinType 未出現在任何 `status='ANCHORED'` 的 snapshot

任一不成立 → `409 ASSET_IN_USE`，訊息明說「已入帳，更正需走 restatement」。
成立 → delete，log `outcome='corrected'`。之後可重新 `POST` 正確值。

**理由**：一個尚未被任何東西引用的 typo，沒有東西可 restate。逼走 restatement 會讓人改去登錄一個新的 canonical 變體來繞過不可變更，反而污染主檔。D7 的精神（已入帳不可改）完整保留。

### 6.2 驗證 — ingest（同步、零網路）

`ingestEvent(db, entityId, rawJson)`（`services/api/src/http/ingestEvent.ts:15`）是唯一 chokepoint，且**已有 reject-log 模式**（`appendRejectedEvent`，含說明為何在 txn 外 append 的 TOCTOU 註解）。新增拒收理由，沿用同一條路徑：

| 條件 | reason |
|---|---|
| event 有 `coinType`，registry 查無 | `ASSET_NOT_REGISTERED` |
| `event.assetDecimals !== registry.decimals` | `ASSET_DECIMALS_MISMATCH`（**缺陷 A 封死**） |
| event 有 `assetDecimals` 但無 `coinType` | `ASSET_DECIMALS_WITHOUT_COIN_TYPE`（結構矛盾） |
| event 無 `coinType`（法幣/gas 類） | 略過驗證，放行 |

查表前先 `canonicalCoinType()`（V2）。

**rules-engine / `JeLine` / `leafCodec` / merkle / 既有 snapshot：0 行改動，root byte-identical。** 值沒變，只是多了進門檢查。

**完整性測試橫跨兩個 log**（審計揭露）：ingest 拒收進 `rejected_event`，登錄拒收進 `asset_registry_log`。要測「所有錯刻度嘗試都被正確擋下」需查兩處。§9 的測試涵蓋兩者。

### 6.3 讀取 — recon / lots

- `collect.ts:58` 的 `decimals: fx?.decimals ?? 9` → `getAssetDecimals()`，查無回 `null`。
- `lots/dto.ts:134` 的 `decimals: decimals.get(key) ?? 9` → 同上。`decimalsLookup()`（`:31-40`）**整個刪除**。
- `ReconFixtureRow.decimals`（`reconciliation/types.ts:6`）**整欄刪除**，`fixture.ts:26` 的對應驗證一併移除。
- DTO：`ReconRowDTO.decimals: number | null` + `unregisteredAsset: boolean`；`LotsDTO.groups[].decimals: number | null`。
- `ReconciliationResponse.summary` 新增 `unregistered: number`（`web/src/api/types.ts:156`）。

#### 6.3.1 `decimals === null` 的渲染契約（frontend Critical）

`fmtMinor(minor, decimals)` **無法在沒有 scale 時呼叫**。今天約 8 個 call site 假設 `decimals: number`（`ReconTable.tsx:60-76`、`ReconDetail.tsx:50-51,63-89`）。

**契約**：`decimals === null` 的列 —
- 金額以 **raw minor 字串**呈現於 `mono` chip，標註 `scale unknown`
- **抑制**衍生等式（opening + movements = computed 那組）
- 精度剖面**不計算**（§7）
- 該列仍然出現在畫面上（保住 `recon.collect.test.ts:44` 釘的 book-only 浮現契約）

#### 6.3.2 `UNREGISTERED_ASSET` 擋 close（D12）

語意與上一輪的 `blocksClose()` allow-list 一致（未登錄 = 未決議 = 擋）。

上一輪的教訓是「同一條 close 規則被抄了 5 份，我 grep 出 3 個就動手，外部 review 找出第 4、第 5 個」。因此本 spec **逐一列出** call site，實作時不得靠 grep 自行判斷涵蓋範圍：

1. `reconciliation/collect.ts` —— recon 半邊的阻擋計算
2. `http/routes.ts` `GET /close-readiness` —— exception 半邊
3. `http/routes.ts` `POST /snapshot` —— freeze gate
4. `http/routes.ts` `reconDTO` —— UI badge 的 tally（`blockingMaterial`）
5. `periodLock/cockpit.ts` —— classification 燈
6. **`web/.../ReconDetail.tsx:93`** —— **前端第 6 個閘門，frontend 審查抓到**

第 6 點是實質控制漏洞，不是樣式問題：該行只要 `b.material` 就渲染 Resolve/Defer/**Dismiss**。`unregisteredAsset` 與 `material` 正交，所以一列可以「既未登錄又重大」→ **被 cosmetic dismiss**，直接違反 D12。

→ **`unregisteredAsset` 的列必須抑制全部 disposition 控制項**，改顯示 `Register asset →` CTA。

實作方式沿用 `exceptions/disposition.ts` 的 `blocksClose()` 收攏模式：**單一 predicate，多處呼叫**，不再抄寫。若實作時發現第 7 個 call site，必須在 plan 中回報而非靜默加上。

**刻意不動**（鏡像上一輪裁決）：`routes.ts:112` 的 `isOpen`、`triage/agent.ts:96` 的 `isOpen`。未登錄資產與 disposition 狀態是**正交**的兩個阻擋來源，不得合併成同一個 predicate。

### 6.4 Export（client-side）

`web/src/workspaces/export/buildBundle.ts`：

- `journal.csv` 加 `origDecimals`、`origQty`（精確十進位字串）、`origSource`（`chain` / `manual`）。**保留** `origQtyMinor` → 無損 + 可讀。
  `origSource` 逐列出現而不只在 manifest：ERP 逐列匯入時看不到 manifest。
- `quantity-recon.csv` 加 `decimals`、`source`，並為 `acquiredMinor` / `disposedMinor` / `netMinor` 各加精確字串欄。
- 沿用既有 `formatMinor(amountMinor, scale)`（`web/src/lib/exportCsv.ts:53-59`，實查確認為純 `padStart`/`slice`，**不碰 `Number`/`parseFloat`**）。數量欄的 `scale` 換成該資產的 decimals；法幣欄維持 2。
- **任何一列 `decimals === null` → 拒絕產生整個 bundle**，UI 列出未登錄的 coinType 與登錄入口。
- bundle manifest 加資產揭露：每個 coinType 的 `source` / `symbol` / `chain_object_id` / `chain_object_version`；`manual` 標「未經鏈上驗證」；**close window 內登錄的資產另外標紅**（§3.1）。

#### 6.4.1 精確字串格式契約（CPA Important）

跨 locale ERP（以 `,` 為小數點）會無聲錯位 —— 正是本 spec 要消滅的「無聲刻度錯誤」換個地方重生。因此**釘死格式**：

- 小數點固定為 `.`（U+002E），**不使用 locale 格式化**
- **無**千分位分隔符
- 負號 `-`（U+002D）前置
- 固定輸出 `decimals` 位小數（不去尾零），例：`decimals=9` → `"1.200000000"`
- `decimals=0` → 無小數點，例：`"1200"`
- 產出 bundle 時附 `data-dictionary.md`，逐欄說明型別與格式

**誠實標註**：export 的閘門是**精度防護，不是授權防護**。curl API 自行組 CSV 仍可繞過前端。防線在於 DTO 本身誠實回 `null` —— 任何消費者都有足夠資訊拒絕。真正的授權 gate 是 H1 的題目。

### 6.5 資產登錄介面（frontend Critical）

元件 `AssetRegistryPanel`，`OnboardingWorkspace` 的第三個子元件（接在 `SourceTable` 之後）。兩部分：(a) 已登錄資產清單（含 §6.5.2 的來源分級）；(b) 「Add asset」表單。

#### 6.5.1 表單的 6 個狀態

| 狀態 | 內容 |
|---|---|
| `idle` | coinType 輸入 + Probe 按鈕 |
| `probing` | spinner + 「Fetching CoinMetadata on-chain…」；輸入禁用；**`AbortSignal` 逾時要有可見的逾時訊息**（這是可能卡數秒的真實網路呼叫） |
| `chain-hit` | 顯示擷取到的 `decimals`（唯讀）+ `[↗ chain-verified]` + `chain_object_id`；單一 Confirm |
| `manual-required` | 鏈上未命中 → 揭露 `decimals` / `symbol` / `reason` 輸入（全必填）+ `source='manual'` 預覽 badge |
| `submitting` | 禁用 |
| `error` | 見 §6.5.3 |

#### 6.5.2 `chain` vs `manual` 的視覺分級

**既有慣例強制**：`aqua` 顏色**專屬鏈上語意**（`recon.css:29` 註解 `/* aqua = on-chain ONLY */`，`Badge.module.css` §8.1）。因此：

| | `source='chain'` | `source='manual'` |
|---|---|---|
| 色 | `--aqua`（沿用 `prov--live`） | `--brass`（此 palette 的人工/權威 accent，未用於其他 status） |
| 字符 | `↗`（外部可驗證） | `✎`（由人宣稱） |
| 標籤 | `chain-verified` | `manual · unverified` |
| 重量 | **等重 pill —— 差異在色相+字符+標籤，不在尺寸或警示** | 等重 pill |
| hover | `CoinMetadata {chain_object_id}@{version} · fetched {ts}` | `declared by {decided_by} · {reason}` |

`manual` **不得**用紅色：它是**揭露**，不是缺陷。export bundle 的來源揭露區塊鏡射 `StaleRestatementCard`（`ExportWorkspace.tsx:159-202`）的非紅卡片形狀，與 D3 引用的 H2 restatement disclosure 前例一致。

#### 6.5.3 錯誤/結果文案表

鏡射 `SourceTable.tsx:10-20` 既有的 `ERR` map pattern：

| 回應 | 文案 |
|---|---|
| `400 INVALID_COIN_TYPE` | Not a valid coin type. Expected `0x…::module::TYPE`. |
| `400 NAMED_PACKAGE_UNSUPPORTED` | Named packages (`app@org::…`) aren't supported. Use the resolved `0x…` address. |
| `400 MANUAL_DECIMALS_REQUIRED` | No on-chain metadata found. Enter decimals, symbol and a reason to register manually. |
| `409 CHAIN_DECIMALS_MISMATCH` | On-chain metadata says N decimals; drop your override or fix it. **Chain wins.** |
| `409 ASSET_DECIMALS_CONFLICT` | Already registered at N decimals. Decimals can't be changed — this needs a restatement. |
| `409 ASSET_IN_USE`（更正端點） | This asset already has entries posted. Correction requires a restatement. |
| `503 CHAIN_UNREACHABLE` | Couldn't reach the Sui node. **This is not the same as "no metadata"** — retry before registering manually. |
| `200`（冪等） | Already registered — no change. |
| 空清單 | No assets registered yet. Every asset your books touch must be registered before close. |

`503` 的文案是 **D15 的最後一道人因防線**：操作員必須知道「打不到節點」≠「這個 coin 沒有 metadata」，否則他會手動登錄一個本可鏈上驗證的資產。

#### 6.5.4 未登錄資產的統一視覺詞彙

**一個標籤（`Unregistered asset`）、一個字符（`⛔`），四個介面**（frontend 審查：不統一會讓使用者在畫面間迷路）：

1. **recon 列**：raw-minor `mono` chip + `scale unknown`（§6.3.1）、紅色左軌（沿用 `recon-row--material` 的 `box-shadow: inset 3px 0`）、`[⛔ Unregistered]` pill
2. **ReconDetail**：抑制 disposition 控制項，顯示 `Register asset →` CTA
3. **recon summary**（`ReconciliationWorkspace.tsx:52-54` 目前是**二元** badge）：加第三個狀態 `⛔ N unregistered — blocks close`，與 `blockingMaterial` **分開計數**
4. **close cockpit**：**專屬燈** `key:'registry'`（不折進 `recon` 燈），`dispatchTarget`（`lightMeta.ts:31`）直接路由到 registry panel。D12 把它框成獨立的控制缺陷，它就該有自己的燈
5. **export**：`light--red` 卡片（沿用 `ImbalanceCard` 形狀），列出 null-decimals 的 coinType + `Register assets →` 連結

#### 6.5.5 版面

- 無暗色模式（§2 非目標）。新 token 留在 paper palette。
- registry 表在 **≤640px 必須 card 化**，沿用 `recon.css:39-46` 的 pattern。`onboarding.css` 的 `ob-table` 目前**沒有** mobile card 化，直接沿用會在 390px 溢出。
- 斷點沿用 recon 的 **640 / 1024**。
- 數字欄 `font-variant-numeric: tabular-nums`（`recon.css:16` 已有）。

---

## 7. 精度剖面（R3）

`breakPrecision(breakMinor: string, decimals: number)`，全純字串運算。

**回傳型別**（單一形狀，不用 union —— 消費端不必分歧）：

```ts
type BreakPrecision = {
  exactlyZero: boolean;
  /** 截斷到這麼多位小數後為零。null = 差異達整數位，任何小數位都不平。exactlyZero 時為 decimals。 */
  flatToDecimal: number | null;
  /** 第一個非零小數位（1-based）。null 當且僅當 flatToDecimal 為 null 或 exactlyZero。 */
  firstSignificantDecimal: number | null;
  /** 最低有效小數位（1-based）。差異為整數倍時為 0。exactlyZero 時為 0。 */
  lastSignificantDecimal: number;
};
```

```
輸入驗證（V4）：breakMinor 必須 match ^-?(0|[1-9][0-9]*)$，且長度 ≤ 80。"-0" 拒絕。
s = |breakMinor| 去符號；D = decimals

if s === "0" → { exactlyZero: true, flatToDecimal: D,
                 firstSignificantDecimal: null, lastSignificantDecimal: 0 }

last    = max(0, D - trailingZeros(s))        // clamp：10 SUI = "10000000000" 有 10 個尾零 > D
intPart = s.length > D ? s.slice(0, s.length - D) : "0"
frac    = s.slice(max(0, s.length - D)).padStart(D, "0")

if intPart !== "0" → { exactlyZero: false, flatToDecimal: null,
                       firstSignificantDecimal: null, lastSignificantDecimal: last }

i = frac 中第一個非零字元的 0-based index
                   → { exactlyZero: false, flatToDecimal: i,
                       firstSignificantDecimal: i + 1, lastSignificantDecimal: last }
```

`last` 的 clamp 不是防禦性冗餘：`10 SUI` = `"10000000000"`，`trailingZeros = 10 > D = 9`，未 clamp 會得到 `-1`。

`decimals === null` → 剖面不計算，回 `null`（整個 `BreakPrecision` 為 `null`）。

### 7.1 以真實 fixture 驗算（golden，非造假的乾淨數字）

| 資產 | `breakMinor` | `decimals` | `flatToDecimal` | `firstSig` | `lastSig` | UI 文案 / SR text |
|---|---|---|---|---|---|---|
| SUI `+1.202` | `1202000000` | 9 | `null` | `null` | 3 | 「差異達整數位，非捨入誤差」 |
| USDC `−0.5` | `-500000` | 6 | 0 | 1 | 1 | 「整數位平；小數第 1 位起不平」 |
| dust（假想） | `1` | 9 | 8 | 9 | 9 | 「平至小數第 8 位；第 9 位起不平」 |
| 整數倍（clamp 用例） | `10000000000` | 9 | `null` | `null` | 0 | 「差異達整數位，非捨入誤差」 |
| 零 | `0` | 9 | 9 | `null` | 0 | 「完全平」 |

**設計副產品（CPA affirm 保留）**：剖面順帶成為 registry 正確性的**免費金絲雀**。decimals 錯時，剖面會宣稱一個該資產根本沒有的小數位（6dp 幣不可能產生第 7 位的標記）。

### 7.2 呈現（frontend 推薦：Option A + SR text）

在**表格列**：沿用既有的 `mono` + `tabular-nums` 破口欄（`recon.css:16`），小數點對齊，**把「平的那段零」調暗**（`--ink-soft`）、**有效位維持全墨**，在平/不平的邊界放一個細髮絲游標。

```
 0x7a…1c · SUI    +1.202000000     whole-unit break — not rounding
 0x7a…1c · USDC   −0.500000        unflat from decimal 1
 0x9b…4e · SUI    +0.00000000 1    dust — flat to decimal 8
                   └────────┘└ 邊界游標
                    dimmed zeros   full-ink significant
```

沿欄往下讀，dust 天然靠右、整數級破口靠左 —— **量級由對齊本身傳達，不需要額外欄位或顏色**。

**不得使用語意色**（`--warn` / `--debit`）：剖面是純資訊，`thresholdMinor` 才是判決（D9）。用了就會與 `brk--material` pill 雙重信號。差異只用字重與墨色濃淡表達。

每個剖面 cell 的 `aria-label` = §7.1 的文案（**該字串已寫好，直接接線，不要重新設計**）。完整的三行拆解（邊界游標 + 平至第 N 位 + 首個不平位）放 `ReconDetail`，表格列只放調色後的數字。

（frontend 審查提出的「place-value ruler chip」方案在寬度上不可行 —— recon grid 在 1024px 已經在丟欄位，`recon.css:34`。列為 §10 defer。）

### 7.3 剖面的效力邊界（CPA Important，誠實揭露）

**精度剖面不是處置決策的充分依據。**

會計人員判斷「沖銷為 rounding dust」還是「升級調查」，實際依據是：
1. 差異的**功能性貨幣金額**
2. 該 coinType 的**連續破口期數**
3. **相對重大性 %**

而「平到第幾位」**不錨定金額**：6dp USDC 的 `0.5`（≈ $0.50，`flatToDecimal: 0`）與 9dp SUI 的 `1e-9`（≈ $0，`flatToDecimal: 8`）給出的位數，跟金額大小完全不對應。系統有 pricefx，剖面卻只給 token 小數位。

**本 spec 交付的是「該差異是否屬於捨入層級」的指示，不是處置理由。** UI 文案不得暗示後者。

金額 + 連續期數的並陳 → **Deferred**，歸入 materiality policy spec（§10）。

---

## 8. Red Team（實作前，dev-rules 要求）

| # | 攻擊向量 | 防禦 | 落點 |
|---|---|---|---|
| V1 | **SDK 的 `?? 0` coercion**：`getCoinMetadata` 把 proto 上缺席的 decimals coerce 成 `0`（`grpc/core.mjs:158`），且型別宣告為 required `number`（`client/types.d.mts:260`）。`0` 通過任何範圍驗證，且與合法的 0-decimal coin 無法區分。**本 spec 要修的 bug 活在 SDK 裡** | **D14**：改用 `client.stateService.getCoinInfo()`（`grpc/client.d.mts:49`），讀 raw proto 的真 optional `decimals?`（`state_service.d.mts:78`）。`undefined` 才是「無刻度」。禁止對 decimals 用 `??` / `\|\|` | `register.ts` §6.1 |
| V2 | **coinType 同形異名**：(a) `0x2::sui::SUI` vs `0x0000…0002::sui::SUI` vs 大小寫；(b) **MVR named package**：`parseStructTag` 對 named-package 位址原樣保留（`utils/sui-types.mjs:76`），但 `getCoinMetadata` 內部會 `mvr.resolveType`（`core.mjs:148`）→ **fetch 解析了別名、registry key 沒有** → 兩列同資產、decimals 可不同 | (a) 所有邊界統一 `canonicalCoinType()`（`isValidStructTag` + `normalizeStructTag`）；registry **只存 canonical**。(b) onboarding **拒收 named package**（`400 NAMED_PACKAGE_UNSUPPORTED`）。**不改寫既有 `lot_movement.coin_type`** —— 獨立的遷移風險 | `normalize.ts` |
| V3 | registry 併發寫入 / 追溯改寫 | PK + `INSERT ON CONFLICT DO NOTHING` 包 `db.transaction`，事後 re-read 比對；不同 → 409，**永不 UPDATE**。更正只走 §6.1.1 的硬 predicate 端點 | `store.ts` §6.1 |
| V4 | `breakMinor` 字串攻擊：前導零 `"007"`、`"-0"`、`"1e3"`、空字串、超長字串 → 負索引 / 誤報「完全平」/ `padStart` DoS。**歷史前科**：opening-equity 那輪的 I1 leading-zero 繞過 D2 | 嚴格 `^-?(0\|[1-9][0-9]*)$`，`"-0"` 拒絕，長度上限 80。全程純字串，**不轉 `Number`、不用 BigInt 除法** | `precision.ts` §7 |
| V5 | onboarding 打鏈濫用：POST 大量亂編 coinType → 大量 gRPC 出站 | 先本地 `isValidStructTag`（零網路）才打鏈；一請求一 coinType；`AbortSignal` 逾時（`CoreClientMethodOptions.signal`，`client/types.d.mts:31-32`，已驗證支援）；**失敗不重試** | `register.ts` §6.1 |
| **V6** | **SDK 的 bare `catch` 把 transport error 偽裝成「無 metadata」**（`core.mjs:152-153`，兩者都回 `{coinMetadata: null}`）。網路瞬斷 → 走 manual 分支 → `source='manual'` → D7 永不 UPDATE → **一次網路抖動永久降級一個鏈上可驗證的資產** | **D15**：transport error propagate，`503 CHAIN_UNREACHABLE`，**不**引導 manual。§6.5.3 的 `503` 文案是人因防線。D7b 的更正端點是第二道保險 | `register.ts` §6.1 |
| **V7** | **結帳期限壓力下的自助登錄**：當事人為解鎖 `UNREGISTERED_ASSET` 的 close gate，臨時登錄一個假 decimals（manual 路徑無核准）→ 被 anchor。**正好製造本 spec 想防的「垃圾進、被密碼學承諾」** | 最小補償控制（§3.1）：close window 內登錄的資產在 export disclosure 與 cockpit **標紅**；`reason` 最小長度驗證。**真 SoD 需 H1 —— 列為 open control gap，不假裝已控制** | §3.1 |

**已知風險（不在本 spec 修）**：`POST /entities/:id/assets` 的認證現況**未查證**，推測無 authn（H1 未落地）。「誰能呼叫這個 route」與 V7 的 maker-checker 綁同一個依賴。

---

## 9. 測試策略

- **Mutation test（dev-rules 硬要求）**：每個新守衛必須先在真實缺陷面前紅一次。移除 `ASSET_DECIMALS_MISMATCH` 檢查 → 對應測試轉紅；移除 `UNREGISTERED_ASSET` 擋 close → close-readiness 測試轉紅；移除 `ReconDetail` 的 dismiss 抑制 → 對應測試轉紅。做不到就不是回歸測試。
- **禁用 `??` 的釘死測試**：對 `services/api/src/assets/` 做原始碼掃描，出現 decimals 相關的 `??` / `||` 兜底 → fail。（V1 的結構性防禦；`?? 9` 的本質就是「有人覺得補個預設值很合理」。）
- **`getCoinMetadata` 禁用測試**：掃描 `services/api/src/` 出現 `getCoinMetadata(` → fail，錯訊指向 D14 與 `core.mjs:158`。
- **Monkey（`test.md` 要求）**：
  - raw-SQLite 直接塞 `source='hacked'` / `decimals = -1` / `37` → CHECK 擋下
  - `0x2::sui::SUI` 與 long form 同時註冊 → V2 使其為同一列
  - MVR named package `app@org::x::Y` → `400`
  - mock `getCoinInfo` 回 `{ metadata: { /* decimals absent */ } }` → 走 manual 分支，**不得**得到 `0`
  - mock `getCoinInfo` **throw**（網路錯誤）→ `503`，**不得**走 manual 分支（V6）
  - `breakMinor` = `"007"` / `"-0"` / `"1e3"` / `""` / 200 位長字串 → 全部 reject
  - registry 有列但 event 帶不同 `assetDecimals` → ingest 拒收且 reject-log 有紀錄
  - 更正端點：有 event / 有 JE / 已 anchored 三種情況各自 `409 ASSET_IN_USE`
  - 未登錄 + material 的列 → ReconDetail **不得**渲染 Dismiss
- **精度剖面 golden**：用 §7.1 的真實 fixture 值，含 clamp 用例與零用例。
- **不變量測試**：`asset_registry.coin_type` 恆等於 `canonicalCoinType(coin_type)`。
- **Live spike（一次性，非 CI）**：真 testnet `stateService.getCoinInfo({ coinType: '0x2::sui::SUI' })` → 驗證 raw proto 回 `decimals: 9` 且 call shape 正確。
  理由：`signAndExecuteTransaction` 曾因 SDK call shape 咬過一次；本輪已證實 `getCoinMetadata` 的包裝層會 coerce，raw 路徑必須實測。
- **回歸**：`recon.collect.test.ts:44` 釘住的 book-only 資產浮現契約仍成立（資產出現在畫面上，帶紅燈，而非消失）。
- **UI（dev-rules 硬要求）**：Playwright 實點擊走過 onboarding 登錄（含 `probing` / `manual-required` / `409` 三態）、recon 未登錄列、export 被擋卡片。cache-bust / hard-reload 後測。390 / 640 / 1024 三個寬度截圖。
- **Verification**：api / web 全套 + `npx tsc --noEmit` + `web build`。實作者不自我驗收，派 fresh-context verifier。

---

## 10. Deferred（誠實揭露，依 CPA 覆核後的優先序）

| 優先 | 項目 | 為何不在本 spec |
|---|---|---|
| **1** | **Spec 2：manifest 承諾刻度** | 錨在鏈上的 leaf 只 commit `origCoinType` + `origQtyMinor`，**未 commit decimals**。修法是 snapshot manifest 加 `assets: [{coinType, decimals, source, chainObjectVersion}]` 節 —— `manifest_hash` 本來就上鏈，於是刻度被密碼學承諾涵蓋，leaf 一個 bit 不動。**需要 manifest 版本欄**（`MANIFEST_V1`/`V2`，鏡像 `JE_LEAF_BCS_V1`），否則驗證路徑重算 manifestHash 時會對既有 snapshot 誤報竄改。manifest 的 coinType key **必須用同一個 `canonicalCoinType`**。SUI 審查 endorse 此做法優於改 leaf BCS。 |
| **2** | **materiality policy 主檔化** | **CPA 把它從第三提到第二。** `thresholdMinor` 現住在 recon fixture（demo scaffolding），**無 `decided_by`、無核准**，而它 governs **唯一的 pass/fail gate**。「誰核准了重大性門檻」是審計最先問的問題之一 —— 這是控制**不存在**，不是待優化。獨立的表、獨立的 policy 語意、獨立的 H1 依賴，與 decimals 權威無技術耦合。同時承載 §7.3 的剖面 enrichment（差異的 USD 金額 + 連續破口期數 + 相對重大性 %）。 |
| 3 | **maker-checker（輸入者 ≠ 覆核者）** | 需 H1（authenticated principal）。在 H1 之前 `decided_by` / `reviewed_by` 都只會是 server-side 常數，**兩個常數互相覆核是假控制**。本輪以 §3.1 的最小補償控制 + open control gap 揭露代替。 |
| 4 | **`asset_registry_log` 納入 anchor** | log 的 append-only 只是慣例，SQLite 層無強制，log 本身非 tamper-evident（§4.3）。週期性把 log hash 納入既有 anchor 是正解。 |
| 5 | **資產母體完整性（completeness assertion）** | 鏈上持有但無 event、不在對帳單上的 token 完全隱形（§2.1）。需要獨立的 on-chain balance sweep，另案。 |
| 6 | **自動 dust 處置 policy** | 「差異全落在第 N 位以下 → 自動產生 `dismissed` disposition，`reasonCode=ROUNDING_DUST`，actor=system」。預留 reason code 與 actor 語意。卡在「system 能否當 actor 簽字」= H1。CPA affirm 排最後：authn 落地前自動沖銷很危險。 |
| 7 | 會計分類主檔 | 資產分類（intangible / financial asset）、功能性貨幣、公允價值 level 1-2-3、減損政策。**CPA 明確反對塞進本表**（無技術耦合），但要求 spec 留痕，否則審計主管一問即全靜默。 |
| 8 | `source='manual'` 日後鏈上重驗升級為 `'chain'` | 需要 UPDATE，與 D7 衝突 → 需獨立設計。`chain_object_version`（D16）已為此鋪路。 |
| 9 | 法幣側 scale 硬編 2 | JPY（0dp）等非 2dp 功能性貨幣的潛在 bug。spec 從未聲明 money 側的幣別/功能性貨幣範疇。若確定單一 USD 實體可註記接受。 |
| 10 | 既有表 coinType 未正規化 | 本 spec 只在 registry 查表層 normalize，不改寫 `lot_movement.coin_type` 等歷史資料。 |
| 11 | 其餘表補 CHECK constraint | `exception_disposition.state` 等同樣缺 CHECK（§4.1）。 |
| 12 | 精度剖面的 place-value ruler 視覺 | frontend Option B。寬度不可行（recon grid 在 1024px 已在丟欄位）。會計人員要求時再議。 |
| 13 | `openMaterialReconBlockers` 函式改名 | 鄰近但無關，維持既有 backlog。 |

---

## 11. Blast radius

**新增**：
- api：`services/api/src/assets/{normalize,precision,registry,register,store}.ts`
- scripts：`scripts/seed-assets.ts`
- web：`AssetRegistryPanel`（+ css），close cockpit 新增 `key:'registry'` 燈

**修改**：
- api：`http/ingestEvent.ts`、`http/routes.ts`、`reconciliation/{collect,fixture,types}.ts`、`lots/dto.ts`、`store/{db.ts,schema.sql}`、`periodLock/cockpit.ts`、`grpcClient.ts`
- web：`src/api/types.ts`（`ReconRowDTO.decimals: number|null` + `unregisteredAsset`、`summary.unregistered`）、`src/workspaces/recon/{ReconTable.tsx,ReconDetail.tsx,recon.css}`、`src/workspaces/ReconciliationWorkspace.tsx`、`src/workspaces/onboarding/*`、`src/workspaces/export/{buildBundle.ts,ExportWorkspace.tsx}`、`src/lib/exportCsv.ts`、`src/workspaces/close/lightMeta.ts`

> 路徑更正（撰寫 plan 時實查）：recon UI 在 `web/src/workspaces/recon/`（非 `reconciliation/`）；`ReconciliationWorkspace.tsx` 在 `web/src/workspaces/` 根層；`lightMeta.ts` 在 `web/src/workspaces/close/`。另外 `dispatchTarget()`（`lightMeta.ts:29-37`）是 switch + `default: return null`，新增 `registry` 燈**必須同步加 case**，否則點下去無反應。
- fixture：`fixtures/acme-pilot-001.recon.json`（刪 `decimals` 欄）

**零改動**：`services/rules-engine`、`services/snapshot-svc`、`services/anchor-svc`、`move/`
（`.move` 零行 → `sui move test` 不適用，實證非跳過）

---

## 12. 三審整合記錄

| 審 | Verdict | 收 | 不收 / 改寫 |
|---|---|---|---|
| **SUI**（`sui-architect`） | `READY-WITH-FIXES` | Critical: `getCoinMetadata` 的 `?? 0` coercion → D14；bare `catch` 混淆 transport error 與 no-metadata → D15/V6；MVR named package 破壞 V2 → `400`；`chain_object_version` 版本錨點 → D16 | — |
| **CPA** | `READY-WITH-FIXES` | Critical: 零爆炸半徑更正路徑 → D7b；manual SoD 缺口 → §3.1 open control gap + close-window 標紅；剖面 overclaim → §7.3 + 目標 4 改寫；completeness assertion → §2.1；`symbol`/`name` → D16；CSV 格式契約 → §6.4.1；log 未 anchor → §4.3；`claimed/chain_decimals` 結構化 → §4；`reason` 最小長度 → §3.1；兩個 log 的完整性測試涵蓋 → §6.2 | 資產分類 / 公允價值 level / 減損政策**不塞進本表**（CPA 自己反對，僅留痕 → §10-7）。maker-checker 本輪不做（兩個 server 常數互相覆核是假控制）→ §10-3 |
| **frontend** | `READY-WITH-FIXES` | Critical: `AssetRegistryPanel` + 6 狀態 → §6.5.1；`decimals === null` 的渲染契約 → §6.3.1；**`ReconDetail.tsx:93` 讓未登錄列可被 cosmetic dismiss** → §6.3.2 第 6 個 call site；`summary.unregistered` 第三個 badge；統一視覺詞彙四介面 + 專屬 cockpit 燈 → §6.5.4；錯誤文案表 → §6.5.3；`chain`=aqua / `manual`=brass（既有慣例強制）→ §6.5.2；剖面禁用語意色 → §7.2；≤640px card 化 → §6.5.5 | place-value ruler（寬度不可行）→ §10-12。**更正我派工時的錯誤假設**：此 app 無暗色模式；recon 斷點是 640/1024 非 390/1280 |

**跨審交叉發現**（單一審查看不到）：SUI 的 V6（網路瞬斷 → 永久 manual）與 CPA 的 D7b（無更正路徑）是**同一個洞的兩端**。不可變更 + 無零爆炸半徑更正路徑 = 任何一次瞬時錯誤都是永久的。兩者必須一起修才有意義。
