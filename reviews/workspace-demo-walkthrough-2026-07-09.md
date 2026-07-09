# Workspace demo 走查報告 — 2026-07-09

**範圍**：Playwright 實點擊走查 Close / Policy / Export / Onboarding 四個 workspace。
**環境**：api :8787（持久 DB 清空後重建，seed 出 entity `acme:pilot-001` + 3 筆 INGESTED events）、web :5173。
**模式**：只走查、只報告，**未修任何 code**（使用者指定）。
**寬度**：1280 × 900、390 × 844。

---

## 結論

Close workspace **完全壞掉**，且不是本次清空 DB 造成的 —— 自 `0a75c22`（C2 period 歸屬）合併後就一直是壞的。
Policy / Export / Onboarding 三個 workspace 功能與版面皆正常，390px 無 page overflow。

四個發現，兩個是同一根因的一體兩面（F1 壞掉、F2 把壞掉藏起來），F3 解釋為什麼測試抓不到。

---

## F1 — Critical：`close-cockpit` 缺 `periodId` → Close workspace 全滅

**現象**：進 `/app`（預設 Close workspace）只顯示 `No cockpit data.`，step-by-step close flow 區塊全空。Console 出現 `400 (Bad Request) @ /entities/acme%3Apilot-001/close-cockpit`。

**根因**：
- 後端硬性要求 `periodId` query param：`services/api/src/http/routes.ts:547`
  → `if (!periodId) throw new ApiError(400, 'PERIOD_ID_REQUIRED', ...)`
- 前端 hook 從來沒送過：`web/src/data/useCloseCockpit.ts:28`
  → `fetch(\`${API_BASE}/entities/${encodeURIComponent(capturedEntityId)}/close-cockpit\`)`
  hook signature 是 `useCloseCockpit(entityId)`，**根本沒有 periodId 參數**。

**何時壞的**：
- `git log -S "PERIOD_ID_REQUIRED" -- services/api/src/` → `0a75c22 feat(c2): require explicit periodId on cockpit/lock; decide derives period from event`
- `git log -S "periodId" -- web/src/data/useCloseCockpit.ts` → **無任何 commit**（前後端從未對齊過）

**根因驗證（非推測，瀏覽器實證）**：
在 runtime 用 fetch shim 對 `/close-cockpit` 補上 `?periodId=2026-Q2`，不改任何 code，重進 Close：
cockpit 完整 render —— 6 個 lights（Classification `Ready`、je/recon/completeness `Blocking`、pricing/erp `Not wired`）、
`3 lights blocking close.`、`Lock the period` 正確 disabled 且顯示 `Locked out by: je, recon, completeness`。
→ **periodId 是唯一阻礙**，Close 其餘邏輯完好。

**Blast radius 比想像大**：Export workspace 掛載時也會打這支 API（`web/src/App.tsx:28` 也呼叫 `useCloseCockpit`），
所以切到 Export 時 console 又多兩筆同樣的 400。Export 本身有正確 empty state 所以看不出來，但那支請求一直在失敗。

**建議修法**：`useCloseCockpit(entityId, periodId)`，URL 帶 `?periodId=`；periodId 來源與 TopBar 顯示的 `2026-Q2` 同源
（`GET /entities/:id/periods` 已回 `[{"periodId":"2026-Q2","lockStatus":"OPEN"}]`）。屬跨前後端契約，**非 trivial → 走 dual-review**。

---

## F2 — High：cockpit 錯誤被吞掉，400 偽裝成空狀態（違反 Rule 12 fail loud）

`web/src/workspaces/close/CloseCockpit.tsx:14`
```
const { data, loading, refetch } = useCloseCockpit(entityId);
```
hook **有回傳 `error`**（`useCloseCockpit.ts:36` 有 set，:51 有 return），但這裡直接丟掉。
於是 `CloseCockpit.tsx:20` 的 `if (!data) return <p>No cockpit data.</p>;` 把「後端 400」跟「這期沒資料」render 成同一個畫面。

這是 F1 拖這麼久沒被發現的直接原因：畫面看起來像「空的」，不像「壞的」。
**建議**：`error` 要 render 出來（帶 status code + 可 retry），空資料與錯誤必須視覺可區分。

---

## F3 — High（test-coverage）：現有測試結構上不可能抓到 F1（違反 Rule 9）

- 所有 render CloseCockpit 的元件測試都 **mock 掉 hook**：
  `App.cockpit.test.tsx:15`、`CloseCockpit.test.tsx`、`CloseCockpit.staleAnchor.test.tsx:19`、`ExportWorkspace.test.tsx:31`
  （`ExportWorkspace.test.tsx:31` 註解甚至白紙黑字寫「Mock the cockpit hook so ExportWorkspace mount does NOT fire a real close-cockpit」）
- 唯一直測 hook 的 `useCloseCockpit.test.tsx`：`:17` `vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, ... })))`
  —— stub 對**任何 URL 都回 ok**，全檔**沒有一條 assertion 檢查 fetch 被呼叫的 URL**。

結果：把 `periodId` 加上去、或拿掉，測試結果**完全不變**。這正是 Rule 9 定義的壞測試
（"A test that can't fail when business logic changes is wrong"）。

**建議**：hook 測試補 `expect(fetch).toHaveBeenCalledWith(expect.stringContaining('periodId=2026-Q2'))`；
另外考慮加一條真打 API 的 contract test，因為這是前後端契約破裂，純 unit test 天生看不到。

---

## F4 — Low（cosmetic）：Onboarding 錢包位址截斷後無法辨識

`web/src/workspaces/onboarding/SourceTable.tsx:7`
```
return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
```
Demo 的兩個 wallet 都是零填充的 66 字元位址：
- `0x0000…0abc` ← `0x000...0abc`
- `0x0000…sury` ← `0x000...acmetreasury`

`slice(0,6)` 對零填充位址永遠是 `0x0000`，前綴零資訊量，兩個錢包只能靠後 4 碼分辨。
真實 Sui 位址是隨機的所以影響有限，**多半是 fixture artifact**，非邏輯錯誤。列此供裁決是否值得處理。

---

## 正常項（實測通過，非略過）

| 項目 | 結果 |
|---|---|
| Policy 1280 | 無 overflow；`Recompute preview` 可點，回 `Changed lines: 0` + `Grand totals conserved ✓` |
| Policy 390 | page **無** overflow（`docScrollW` 380 ≤ 390）。COA table 597px 寬但被 `.policy-coa-scroll`（`overflow-x:auto`，clientW 298 / scrollW 597）正確容納 → **刻意設計，非 bug** |
| Export | 正確 empty state「Nothing to export / No journal entries found for this period」 |
| Onboarding | entity meta + 2 wallet sources 正常；eventCount 3 與 API 一致 |
| 390px page overflow（四個 workspace） | **全部 0**（Close/Policy/Export/Onboarding `pageOverflow: false`） |

---

## 未覆蓋 / 誠實揭露

- **版面結論的證據來源**：主要來自 `getBoundingClientRect()` / `getComputedStyle()` 量測。事後補看了 `policy-390.png` 截圖，與量測一致（COA 表右側 `ACCOUNT` 欄視覺上被裁切，但在 `.policy-coa-scroll` 內可橫捲 → 符合設計）。
  （更正：先前一度誤判「截圖沒落地」，實際上 Playwright MCP 把 png 寫到 repo root，已移出至 scratchpad，未進 git。）
- **Anchor / wallet-gated 流程仍 honest-skip**：`Connect Wallet`、`Verify ownership` 需真錢包擴充連 `0x1509…bc4c` 簽名，本輪未走。CLI 程式化路徑已於 `7603414` 證實可用。
- **乾淨 close flow 沒真的跑完**：清空 DB 後 je / recon / completeness 三盞燈 blocking，`Lock the period` 正確 disabled。
  要走完需先用 API 灌資料（順序見下），本輪只驗到「lock 正確擋住」為止。
- **Exceptions / Reconciliation / Audit 未走查**（本輪範圍只有四個 workspace）。

### 走完 close flow 的 API 序列（已從 code 確認，供下輪用）

`POST /entities/:id/events` → `POST /entities/:id/ingest`（auto-classify）→ `POST /reviews/:eventId/decide`
→ `POST /entities/:id/run-rules` → 處理 recon breaks → **`POST /entities/:id/period/lock`** → `POST /entities/:id/snapshot`
→ `anchor/prepare` → `anchor/confirm`

⚠️ **lock 必須在 snapshot 之前**（`routes.ts:769` 檢查 `lock.status !== 'LOCKED'`）——與舊筆記寫的順序相反。
所有 32 條路由都註冊在 `services/api/src/http/routes.ts` 的 `registerRoutes()`，無子路由檔案。
現存 `demo-e2e.ts` / `scenarios/*` 都用 `openDb(':memory:')`，**不能**拿來灌正在運行的 server。

---

## 建議處理順序

1. **F1 + F2 一起修**（同一支流程，F2 修好才會讓未來的 F1 類問題自己現形）→ 跨前後端契約，走 dual-review。
2. **F3 跟著 F1 修**（補 URL assertion，否則修完還是沒有回歸保護）。
3. F4 由使用者裁決是否值得動。
