# Asset Registry — decimals 單一權威來源（Spec 1/2）

**日期**：2026-07-10
**Track**：Plan track
**狀態**：設計完成，待實作
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

- **B — 兩套 decimals 從不對帳。** `events.raw_json.assetDecimals`（權威，進帳）與 recon fixture 的 `decimals`（顯示）之間沒有任何斷言。fixture 寫 6、event 寫 9，畫面與帳簿不一致且無測試會紅。

- **C — `?? 9` 在 book-only 資產上觸發。** 6dp 穩定幣被當 9dp 顯示 → 差 1000 倍，且恰好印在標了 material break 的那一列。不影響 `costMinor`（成本基礎另有來源），只影響顯示與 CSV。

- **D — export CSV 無 decimals 欄。** `journal.csv` 原封輸出 `origQtyMinor`，`quantity-recon.csv` 同樣。下游 ERP 無法還原刻度。

### 1.2 已更正的錯誤前提（留痕）

`tasks/progress.md`（2026-07-10 版）宣稱：

> `lots/dto.ts:31-34` 讓 FIFO 成本基礎的刻度去讀對帳 demo fixture → 成本基礎進 JE → leaf hash → merkle root → 上鏈

**不成立。** `lots/dto.ts` 的 `decimals` 從 `decimalsLookup()`（`:31-40`）取得後只在 `:134` 寫進 DTO，**無任何下游消費**。成本基礎由 `simulateLots()`（`:45`）跑 rules-engine 重放算出，rules-engine 讀的是 `event.assetDecimals`，不是 fixture。

progress.md 另稱 `assetDecimals` 是「ingest 側死資料，`services/api/src` 沒有任何一行讀它」。grep 字面為真，**推論錯誤**：api 把整份 `rawJson` 交給 rules-engine，rules-engine 讀它並以 zod 驗界（`schemas.ts:21`，`z.number().int().min(0).max(36)`）。它是唯一活著的權威。

progress.md 引用的 `services/api/src/audit/buildBundle.ts` **不存在**。export 在 client-side：`web/src/workspaces/export/buildBundle.ts`。

---

## 2. 目標與非目標

### 目標
1. 系統對每個 `(entity, coinType)` 有**單一、可稽核**的 decimals 權威。
2. 缺陷 A 被封死在 ingest：不一致的 `assetDecimals` 無法入帳。
3. 報表/CSV 下載**精確**：帶 decimals，數量以無損十進位字串輸出，全程不碰浮點。
4. 會計人員能看到每筆對帳差異**平到第幾位小數、從第幾位開始不平**，據以選擇處置方式。
5. 未登錄的資產是**控制缺陷**，不是顯示瑕疵：擋 close，且在畫面上可見。

### 非目標（本 spec 明確不做）
- 不改 `JeLine` / `je_json` / `leafCodec` / merkle / 既有 snapshot root。
- 不改 rules-engine（繼續讀 `event.assetDecimals`，只是該值現在必須通過 registry 驗證才進得來）。
- 不改 snapshot-svc / anchor-svc / Move 合約。（manifest 承諾刻度是 **Spec 2**。）
- 不做自動 dust 處置 policy（見 §10）。
- 不把 `thresholdMinor` 主檔化（見 §10）。
- 不正規化既有表（`lot_movement.coin_type` 等）的 coinType 字面值。

---

## 3. 核心裁決

| # | 裁決 | 理由 |
|---|---|---|
| D1 | Registry 是**獨立宣告**的主檔，不從交易資料推導 | 從交易推導主檔 = 讓最後一筆 event 有權改寫全帳的刻度定義，即缺陷 A 的成因 |
| D2 | 權威來源**混合**：預設抓鏈上 `CoinMetadata`（`source='chain'`），抓不到才人工宣稱（`source='manual'`） | 鏈上刻度可被審計人員獨立重驗；人工宣稱不行。混在同一欄而不標記 = 讓不可驗證資料偽裝成可驗證 |
| D3 | `source='manual'` 的資產**可以** anchor，但必須在 export bundle 揭露 | 沿用 H2 restatement disclosure 既有模式 |
| D4 | Registry **entity-scoped**，PK `(entity_id, coin_type)` | 這張表存的不是「這個 coin 的 decimals」，而是「這個 entity 的帳簿承認這個 coin 用什麼刻度記帳」。entity A 填錯的爆炸半徑停在 A |
| D5 | Registry 只**驗證** `event.assetDecimals`，不取代它 | 值不變 → leaf / merkle / 既有 snapshot root byte-identical → 零 re-anchor |
| D6 | 三層閘門：ingest **fail-closed**、顯示**容忍且亮紅燈**、export **fail-closed** | 畫面標「未登錄」還能看；CSV 少了刻度進 ERP，下游會拿它當某個刻度解讀，錯得無聲 |
| D7 | `decimals` **不可 UPDATE**。衝突回 409 | 已有 event 以某刻度入帳後改 registry = 追溯改寫全部歷史數量的意義。要改走 restatement |
| D8 | 加 `CHECK` constraint | **刻意偏離既有慣例**，見 §4.1 |
| D9 | 精度剖面是**純資訊**；`thresholdMinor` 仍是唯一 close gate；處置走既有 disposition 狀態機 | 「建議」與「裁決」分離：剖面是計算得出的事實，處置是人的判斷 |
| D10 | 「平到第幾位」用**截斷**判定，不用四捨五入 | 唯一不引入 rounding policy 爭議的定義。四捨五入需先裁決 half-up/half-even，`0.0005` 的答案會取決於一個沒人記得的設定 |
| D11 | **無 backfill、無 `source='backfill'`** | 產品沒有 legacy。從既有 event payload 反推 registry 正是 D1 否決的「從交易推導主檔」，用 migration 偷渡它只是把它藏起來 |
| D12 | 未登錄資產 → `UNREGISTERED_ASSET` 旗標，**擋 close** | 持有一筆資產而系統不知道它的刻度，是不該結帳的狀態 |
| D13 | `decided_by` 取 **server-side 常數**，絕不收 client body | 既有 pattern：`routes.ts:633,926` 硬編 `'demo-controller'`、`:723` 用 `LOCKED_BY` |

---

## 4. 資料模型

```sql
CREATE TABLE IF NOT EXISTS asset_registry (
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  coin_type       TEXT NOT NULL,                                  -- canonical (normalizeStructTag)
  decimals        INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  source          TEXT NOT NULL CHECK (source IN ('chain','manual')),
  chain_object_id TEXT,                                           -- source='chain'：供審計重驗
  fetched_at      TEXT,                                           -- source='chain'
  decided_by      TEXT,                                           -- source='manual'
  reason          TEXT,                                           -- source='manual'
  created_at      TEXT NOT NULL,
  PRIMARY KEY (entity_id, coin_type)
);

CREATE TABLE IF NOT EXISTS asset_registry_log (   -- append-only，記每次註冊嘗試（含被拒）
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id       TEXT NOT NULL,
  coin_type       TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('registered','conflict','rejected')),
  decimals        INTEGER,
  source          TEXT,
  detail          TEXT,
  actor           TEXT NOT NULL,
  at              TEXT NOT NULL
);
```

`decimals` 的 `0..36` 上界與 rules-engine `schemas.ts:21` 一致（該處註解說明是為了「bound 指數，防 `10^n` BigInt DoS」）。

`source` **不參與任何 predicate**。它只被 export bundle 與（Spec 2 的）manifest 讀去做揭露。這是刻意的：避免它長成第二個 `openMaterial`（名字講來源、值被拿去當權限用）。

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

---

## 5. 模組邊界

```
services/api/src/assets/
  normalize.ts   — canonicalCoinType(s): string        純函式，包 isValidStructTag + normalizeStructTag
  precision.ts   — breakPrecision(breakMinor, decimals) 純函式，無 I/O
  registry.ts    — getAssetDecimals(db, entityId, coinType): AssetDecimals | null   同步、無網路
  register.ts    — registerAsset(...): Promise<...>    唯一有網路 I/O 的檔案
  store.ts       — asset_registry / asset_registry_log 的 SQL
```

```ts
type AssetDecimals = { decimals: number; source: 'chain' | 'manual' };
```

**不變量**：`registry.ts` 與 `precision.ts` 純同步、無網路、無 DB 寫入 → 可被 ingest 熱路徑與所有 read path 安全呼叫。網路只活在 `register.ts`。這是「onboarding 登錄、ingest 純驗證」裁決的物理落地。

---

## 6. 資料流

### 6.1 寫入 — onboarding（唯一的網路 I/O）

`POST /entities/:id/assets`
Body：`{ coinType: string, decimals?: number, reason?: string }`

1. `canonicalCoinType(coinType)` —— 本地格式驗（`isValidStructTag`）+ 正規化。失敗 → `400 INVALID_COIN_TYPE`。**零網路**（V5 防禦）。
2. 嘗試 `grpc.getCoinMetadata({ coinType })`（`@mysten/sui@2.19.0`，`SuiGrpcClient` top-level method，`dist/grpc/client.d.mts:62`）。以 `AbortSignal` 設逾時。**失敗不重試。**
3. 分歧：
   - 鏈上回傳且 `decimals` 通過**顯式驗證**（V1）→ `source='chain'`，記 `chain_object_id` + `fetched_at`。**若 body 也帶了 `decimals` 且與鏈上不符 → `409 CHAIN_DECIMALS_MISMATCH`，不採信 client。**
   - 鏈上無 metadata / 無 `decimals` → **必須**有 body `decimals` + `reason` 才收，`source='manual'`，`decided_by` = server-side 常數（D13）。缺任一 → `400 MANUAL_DECIMALS_REQUIRED`。
4. `db.transaction`：`INSERT ... ON CONFLICT DO NOTHING` → re-read。
   - 無既有列 → 201。
   - 既有列 `decimals` 相同 → 200（冪等）。
   - 既有列 `decimals` 不同 → **`409 ASSET_DECIMALS_CONFLICT`，永不 UPDATE**（D7、V3）。
5. `asset_registry_log` append（在 transaction **之外**，鏡像 `ingestEvent.ts:20-24` 已文件化的 TOCTOU 處理）。

**V1 的顯式驗證**（proto `state_service.d.mts:76-78` 宣告 `decimals?: number`，是 optional）：

```ts
if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 36) {
  throw new Error('COIN_METADATA_NO_DECIMALS');
}
```

**禁止**對 decimals 使用 `??` 或 `||`。以測試釘死（§9）。

`GET /entities/:id/assets` → 列出已登錄資產（onboarding UI + export 揭露用）。

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

### 6.3 讀取 — recon / lots

- `collect.ts:58` 的 `decimals: fx?.decimals ?? 9` → `getAssetDecimals()`，查無回 `null`。
- `lots/dto.ts:134` 的 `decimals: decimals.get(key) ?? 9` → 同上。`decimalsLookup()`（`:31-40`）**整個刪除**。
- `ReconFixtureRow.decimals`（`reconciliation/types.ts:6`）**整欄刪除**，`fixture.ts:26` 的對應驗證一併移除。fixture 只留 `openingMinor` / `statementMinor` / `thresholdMinor`。
- DTO：`ReconRowDTO.decimals: number | null`、`LotsDTO.groups[].decimals: number | null`。
- 未登錄的 coinType（book 側或 statement 側皆然）→ 該列帶 `decimals: null` **且** `unregisteredAsset: true`。

**`UNREGISTERED_ASSET` 擋 close**（D12）：語意與上一輪的 `blocksClose()` allow-list 一致（未登錄 = 未決議 = 擋）。**不可被 UI 隱藏、不可被 cosmetic dismiss。**

上一輪的教訓是「同一條 close 規則被抄了 5 份，我 grep 出 3 個就動手，外部 review 找出第 4、第 5 個」。因此本 spec **逐一列出**必須加上此阻擋的 call site，實作時不得靠 grep 自行判斷涵蓋範圍：

1. `reconciliation/collect.ts` —— recon 半邊的阻擋計算
2. `http/routes.ts` `GET /close-readiness` —— exception 半邊
3. `http/routes.ts` `POST /snapshot` —— freeze gate
4. `http/routes.ts` `reconDTO` —— UI badge 的 tally（`blockingMaterial`）
5. `periodLock/cockpit.ts` —— classification 燈

實作方式沿用 `exceptions/disposition.ts` 的 `blocksClose()` 收攏模式：**單一 predicate，五處呼叫**，不再抄寫。若實作時發現第 6 個 call site，必須在 plan 中回報而非靜默加上。

**刻意不動**（鏡像上一輪裁決）：`routes.ts:112` 的 `isOpen`（供 `summary.open` 字面計數）、`triage/agent.ts:96` 的 `isOpen`（決定 agent 是否重新提案）。未登錄資產與 disposition 狀態是**正交**的兩個阻擋來源，不得合併成同一個 predicate。

資產**仍出現在畫面上**（不是 throw 讓它消失），只是帶著紅燈 —— 保住 `recon.collect.test.ts:44` 釘住的 book-only 浮現契約。

### 6.4 Export（client-side）

`web/src/workspaces/export/buildBundle.ts`：

- `journal.csv` 加 `origDecimals` 與 `origQty`（精確十進位字串）。**保留** `origQtyMinor` → 無損 + 可讀。
- `quantity-recon.csv` 加 `decimals`，並為 `acquiredMinor` / `disposedMinor` / `netMinor` 各加精確字串欄。
- 沿用既有 `formatMinor(amountMinor, scale)`（`web/src/lib/exportCsv.ts:53-59`，實查確認為純 `padStart`/`slice`，**不碰 `Number`/`parseFloat`**）。把數量欄硬編的 `scale=2` 換成該資產的 decimals；法幣欄維持 2。
- **任何一列 `decimals === null` → 拒絕產生整個 bundle**，UI 列出未登錄的 coinType 與登錄入口。
- bundle manifest 加資產揭露：每個 coinType 的 `source`；`manual` 標「未經鏈上驗證」。

**誠實標註**：這是**精度防護，不是授權防護**。curl API 自行組 CSV 仍可繞過前端。防線在於 DTO 本身誠實回 `null` —— 任何消費者都有足夠資訊拒絕。真正的授權 gate 是 H1 的題目。

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

| 資產 | `breakMinor` | `decimals` | `flatToDecimal` | `firstSig` | `lastSig` | UI 文案 |
|---|---|---|---|---|---|---|
| SUI `+1.202` | `1202000000` | 9 | `null` | `null` | 3 | 「差異達整數位，非捨入誤差」 |
| USDC `−0.5` | `-500000` | 6 | 0 | 1 | 1 | 「整數位平；小數第 1 位起不平」 |
| dust（假想） | `1` | 9 | 8 | 9 | 9 | 「平至小數第 8 位；第 9 位起不平」 |
| 整數倍（clamp 用例） | `10000000000` | 9 | `null` | `null` | 0 | 「差異達整數位，非捨入誤差」 |
| 零 | `0` | 9 | 9 | `null` | 0 | 「完全平」 |

**設計副產品**：剖面順帶成為 registry 正確性的**免費金絲雀**。decimals 錯時，剖面會宣稱一個該資產根本沒有的小數位（例如對 6dp 幣報「第 7 位起不平」）。

### 7.2 與 close gate 的關係

剖面**不參與** material 判定。`thresholdMinor` 仍是唯一 close gate。處置走既有 disposition 狀態機（`resolved` / `dismissed` / `deferred` + `blocksClose()` allow-list），**不新增狀態、不碰 control 路徑**（D9）。

---

## 8. Red Team（實作前，dev-rules 要求）

| # | 攻擊向量 | 防禦 | 落點 |
|---|---|---|---|
| V1 | `getCoinMetadata` 回 `decimals: undefined`（proto optional），或 coin 無 `CoinMetadata` object → 開發者本能寫 `?? 9`，**本輪要修的 bug 原地重生** | 顯式 `typeof` + `Number.isInteger` + 範圍檢查，否則 throw `COIN_METADATA_NO_DECIMALS`。禁止對 decimals 用 `??` / `\|\|` | `register.ts` §6.1 |
| V2 | **coinType 同形異名**：`0x2::sui::SUI` vs `0x0000…0002::sui::SUI` vs 大小寫。registry 存長式、ingest 拿短式查 → 誤判未登錄；或兩列並存且 decimals 不同 | 所有邊界統一 `canonicalCoinType()`（包 `normalizeStructTag`，`@mysten/sui/utils` 已 export，實查確認）。registry **只存 canonical**。**不改寫既有 `lot_movement.coin_type`** —— 那是獨立的遷移風險 | `normalize.ts` |
| V3 | registry 併發寫入 / 追溯改寫：兩個請求同 coinType 不同 decimals；或有人 UPDATE 已入帳資產的刻度 | PK + `INSERT ON CONFLICT DO NOTHING` 包 `db.transaction`，事後 re-read 比對；不同 → 409，**永不 UPDATE**。`asset_registry_log` append-only | `store.ts` §6.1 |
| V4 | `breakMinor` 字串攻擊：前導零 `"007"`、`"-0"`、`"1e3"`、空字串、超長字串 → 負索引 / 誤報「完全平」/ `padStart` DoS。**歷史前科**：opening-equity 那輪的 I1 leading-zero 繞過 D2 | 嚴格 `^-?(0\|[1-9][0-9]*)$`，`"-0"` 拒絕，長度上限 80。全程純字串，**不轉 `Number`、不用 BigInt 除法** | `precision.ts` §7 |
| V5 | onboarding 打鏈濫用：POST 大量亂編 coinType → 大量 gRPC 出站 | 先本地 `isValidStructTag`（零網路）才打鏈；一請求一 coinType；`AbortSignal` 逾時；**失敗不重試** | `register.ts` §6.1 |

**已知風險（不在本 spec 修）**：`POST /entities/:id/assets` 的認證現況**未查證**，推測無 authn（H1 未落地）。`decided_by` 取 server-side 常數（D13）已避免身分冒充，但「誰能呼叫這個 route」仍是開放問題，與 H1 綁同一個依賴。

---

## 9. 測試策略

- **Mutation test（dev-rules 硬要求）**：每個新守衛必須先在真實缺陷面前紅一次。移除 `ASSET_DECIMALS_MISMATCH` 檢查 → 對應測試轉紅；移除 `UNREGISTERED_ASSET` 擋 close → close-readiness 測試轉紅。做不到就不是回歸測試。
- **禁用 `??` 的釘死測試**：對 `services/api/src/assets/` 做原始碼掃描，出現 decimals 相關的 `??` / `||` 兜底 → fail。（V1 的結構性防禦；`?? 9` 這個 bug 的本質就是「有人覺得補個預設值很合理」。）
- **Monkey（`test.md` 要求）**：
  - raw-SQLite 直接塞 `source='hacked'` → CHECK 擋下
  - `decimals = -1` / `37` → CHECK 擋下
  - `0x2::sui::SUI` 與 long form 同時註冊 → V2 防禦使其為同一列
  - `getCoinMetadata` mock 回 `{}`（無 decimals）→ throw，**不得** fallback 9
  - `breakMinor` = `"007"` / `"-0"` / `"1e3"` / `""` / 200 位長字串 → 全部 reject
  - registry 有列但 event 帶不同 `assetDecimals` → ingest 拒收且 reject-log 有紀錄
- **精度剖面 golden**：用 §7.1 的真實 fixture 值，不用造假的乾淨數字。
- **不變量測試**：`asset_registry.coin_type` 恆等於 `canonicalCoinType(coin_type)`。
- **Live spike（一次性，非 CI）**：真 testnet `getCoinMetadata('0x2::sui::SUI')` → 驗證回傳 `decimals: 9` 且 call shape 正確。
  理由：`signAndExecuteTransaction` 曾因 SDK call shape（top-level vs `grpc.core`）咬過一次，`getCoinMetadata` 不重蹈。
- **回歸**：`recon.collect.test.ts:44` 釘住的 book-only 資產浮現契約必須仍然成立（資產出現在畫面上，帶紅燈，而非消失）。
- **Verification**：api / web 全套 + `npx tsc --noEmit` + `web build`。實作者不自我驗收，派 fresh-context verifier。

---

## 10. Deferred（誠實揭露）

| 項目 | 為何不在本 spec |
|---|---|
| **Spec 2：manifest 承諾刻度** | 錨在鏈上的 leaf 只 commit `origCoinType` + `origQtyMinor`，**未 commit decimals**。修法是 snapshot manifest 加 `assets: [{coinType, decimals, source}]` 節 —— `manifest_hash` 本來就上鏈，於是刻度被密碼學承諾涵蓋，leaf 一個 bit 不動。**需要 manifest 版本欄**（`MANIFEST_V1`/`V2`，鏡像 `JE_LEAF_BCS_V1` 模式），否則驗證路徑重算 manifestHash 時會對既有 snapshot 誤報竄改。依賴本 spec 完成。 |
| **自動 dust 處置 policy** | 「差異全落在第 N 位以下 → 自動產生 `dismissed` disposition，`reasonCode=ROUNDING_DUST`，actor=system」。預留 reason code 與 actor 語意。卡在「system 能否當 actor 簽字」= H1 依賴。使用者裁決：先記錄，有需求再升級。 |
| **materiality policy 主檔化** | `thresholdMinor` 現在住在 recon fixture（demo scaffolding）。產品裡它是 entity 的會計政策，該與 registry 一樣是主檔資料且有 `decided_by`（誰核准了重大性門檻 —— 審計最先問的問題之一）。獨立的表、獨立的 policy 語意、獨立的 H1 依賴，與 decimals 權威無技術耦合。**建議列為下一個 Plan track 任務。** |
| `source='manual'` 日後鏈上重驗升級為 `'chain'` | 需要 UPDATE，與 D7 不可變更裁決衝突 → 需獨立設計 |
| `decided_by` 綁 authenticated principal | H1 未落地 |
| 既有表 coinType 未正規化 | 本 spec 只在 registry 查表層 normalize，不改寫 `lot_movement.coin_type` 等歷史資料 |
| 其餘表補 CHECK constraint | `exception_disposition.state` 等同樣缺 CHECK（§4.1） |
| `openMaterialReconBlockers` 函式改名 | 鄰近但無關，維持既有 backlog |

---

## 11. Blast radius

**新增**：`services/api/src/assets/{normalize,precision,registry,register,store}.ts`、`scripts/seed-assets.ts`

**修改**：
- api：`http/ingestEvent.ts`、`http/routes.ts`、`reconciliation/{collect,fixture,types}.ts`、`lots/dto.ts`、`store/{db.ts,schema.sql}`
- web：`src/api/types.ts`、`ReconTable`、`ReconDetail`、`workspaces/export/buildBundle.ts`、`lib/exportCsv.ts`
- fixture：`fixtures/acme-pilot-001.recon.json`（刪 `decimals` 欄）

**零改動**：`services/rules-engine`、`services/snapshot-svc`、`services/anchor-svc`、`move/`（`.move` 零行 → `sui move test` 不適用，非跳過）
