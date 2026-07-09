# Mobile header + nav 重設計 — Design Spec

**日期**：2026-07-09
**範圍**：`web/` chrome 層（TopBar / SideNav / 內容區 h1）。**只改 ≤768px**，桌機行為不變。
**不在範圍**：Close workspace 的 F1/F2/F3 bug（`reviews/workspace-demo-walkthrough-2026-07-09.md`）—— 獨立 code path，混在一起 review 無法切分。

---

## 1. 問題陳述

使用者於 390px 截圖回報三件事：

1. **無視覺階層** —— header 內所有文字尺寸接近，沒有焦點。實測：brand `--text-xl`(22px)、nav label `--text-base`(15px)，**且兩者都用 `--font-display` 襯線體**，nav 在跟 brand 搶主角。
2. **TopBar 排版不協調** —— brand + Connect Wallet 一列、entity + period 一列，但 wallet 連上後會顯示長位址／餘額，header 塞不下。
3. **7 顆 workspace 按鈕 `flex-wrap` 成三列參差** —— 應收合成選單。

### 1.1 推翻既有決策（明示，非默默改掉）

`6338463` 曾**刻意**把 nav 從「橫捲 scroll-strip」改成 `flex-wrap: wrap`，理由是「7 個 workspace 全可見不切」。
本 spec **推翻該決策**：wrap 成三列參差、每列對齊不一，在 390px 上比橫捲更糟。
→ 舊決策標記作廢，`base.css` 對應規則與註解一併移除。

### 1.2 既存缺陷（連帶清理，位於改動路徑上）

- `base.css:222-223` 註解寫 "a single horizontal scroll strip"，實際規則是 `flex-wrap: wrap` —— **註解與程式碼矛盾**（`6338463` 改規則沒改註解）。
- `base.css:240-266` 一整串 `!important`，存在的唯一理由是打贏 `SideNav.tsx` 的 inline styles。
- 斷點不一致：`.shell-sidenav` 用 **768px**，`.topbar-*` 用 **640px**（`base.css:317`）→ 641–768px 之間是第三種混血排版（sidenav 已堆疊、topbar 仍單列帶 wallet）。

---

## 2. 使用者裁決（本輪拍板）

| # | 議題 | 裁決 |
|---|---|---|
| D1 | Connect Wallet 位置 | 搬到 mobile 抽屜**最上方**；**只改 mobile**，桌機 header 不動 |
| D2 | header 資訊密度 | 標題下方**最多兩個物件** |
| D3 | 視覺焦點 | **Brand 為主**（TallyMarina 22px display）；entity/period 降為 13px mono meta |
| D4 | entity + period 排列 | **必須同一行**（分兩行「很醜、不俐落」） |
| D5 | 目前所在 workspace | **內容區頂部統一 h1**，不放 header |
| D6 | 選單型態 | **側滑遮罩抽屜**（overlay + scrim），非向下展開面板 |

D6 的代價由使用者知情接受：focus trap / ESC / scrim 點擊 / body scroll lock / `aria-modal` 皆為**必做項**，漏一個即為真 a11y bug。

---

## 3. 目標排版（≤768px）

```
┌──────────────────────────────┐
│ ☰    🦦 TallyMarina          │  row1: 22px display serif
│ ACME PILOT 001 ▾ · 2026-Q2   │  row2: 13px mono, uppercase, 單行
├──────────────────────────────┤
│ 📐 Policy                    │  內容區 h1
│ ──────────────────────       │
│ ┌────────────────────────┐   │
│ │ ACTIVE POLICY          │   │
```

點 ☰ 後：

```
┌──────────────┬───────────────┐
│[Connect Wallet]│░░░ scrim ░░░│
│──────────────│░░░░░░░░░░░░░│
│ ⚓ Close      │░░░░░░░░░░░░░│
│ ⚠ Exceptions │░░░░░░░░░░░░░│
│ 📐 Policy  ✓ │░░░░░░░░░░░░░│
│ 🚢 Onboarding│░░░░░░░░░░░░░│
└──────────────┴───────────────┘
```

---

## 4. 架構與元件

### 4.1 新增 `WorkspaceNavList`（`components/chrome/WorkspaceNavList.tsx`）
7 顆 workspace 按鈕的唯一真相來源，桌機 `SideNav` 與 mobile `NavDrawer` **共用**。

- Props：`onNavigate?: () => void`（抽屜用來在選取後自我關閉；桌機不傳）。
- 內部仍讀 `WORKSPACES` + `useWorkspace()`。
- 樣式全走 CSS class（`.ws-nav`, `.ws-nav-item`），**零 inline style**。

**介面契約**：呼叫端只需知道「它渲染一組可導覽的 workspace 按鈕，選取後呼叫 `onNavigate`」，不需知道內部結構。

### 4.2 `SideNav`（改）
退化成 `<nav aria-label="Workspaces" class="sidenav"><WorkspaceNavList /></nav>`。inline styles 全數移除 → `base.css` 的 `!important` 區塊隨之刪除。

### 4.3 新增 `NavDrawer`（`components/chrome/NavDrawer.tsx`）
```
<button class="nav-toggle" aria-label="Open workspaces menu"
        aria-expanded={open} aria-controls="nav-drawer">☰</button>

<div class="nav-scrim" onClick={close} />          // open 時才渲染
<div id="nav-drawer" role="dialog" aria-modal="true" aria-label="Workspaces">
  <ConnectButton />
  <hr class="nav-drawer-sep" />
  <WorkspaceNavList onNavigate={close} />
</div>
```

**必做 a11y 行為（每項一條測試）**：
1. `Escape` 關閉
2. scrim 點擊關閉
3. 開啟時焦點移入抽屜；`Tab`/`Shift+Tab` 在抽屜內循環（focus trap）
4. 關閉後焦點**歸還 ☰ 按鈕**
5. 開啟時 `body` scroll lock；關閉還原
6. `aria-expanded` 隨狀態變動
7. 選取 workspace → 切換 **且** 關閉抽屜

**開關狀態** 由 `NavDrawer` 自身持有（local `useState`），不上抬到 `App`——沒有其他消費者。

### 4.4 `TopBar`（改）
- ☰ 只在 ≤768px 顯示（CSS `display`），桌機 `display:none`。
- `.topbar-wallet` 於 ≤768px `display:none`；wallet 由抽屜提供。
- row2 = `.topbar-context`，內含 `EntitySwitcher` + `PeriodPill`，**強制單行**（`flex-wrap: nowrap`），entity 名稱過長時 `text-overflow: ellipsis`。
- `·` 分隔符以 `.period-pill::before` 產生，**不新增 DOM 節點**。

### 4.5 `WorkspaceHeader`（新，`components/chrome/WorkspaceHeader.tsx`）
`<h1>` = 目前 workspace 的 `icon + label`，於 `App.tsx` 的 `<main>` 頂部渲染一次（**桌機與 mobile 皆有**，D5）。
連帶刪除 `ExportWorkspace.tsx:275` 與 `:301` 的兩個重複 `<h1>Export</h1>`（兩個 render 分支各一）。

### 4.6 inline style → CSS class 遷移（必要，非順手重構）
`EntitySwitcher.tsx:20` 與 `PeriodPill.tsx:8` 都是 inline styles。**inline 永遠打贏 stylesheet**，因此不遷移就無法在 media query 內改它們的外觀，只能再寫一批 `!important` —— 正是本 spec 要清除的東西。

- `EntitySwitcher` → `.entity-switcher`（**保留 `<select>` 元素**與 data-URI chevron，不換成自製 dropdown：保住既有 a11y 與測試）
- `PeriodPill` → `.period-pill`

### 4.7 `<aside>` 於 mobile 整個隱藏
`App.tsx` 的 `<aside>` 帶 inline `position: sticky`。mobile 改為 `.shell-sidenav { display: none }`——inline 沒有設 `display`，故**不需要 `!important`**。現有 `position: static !important` 一併刪除。

---

## 5. 斷點統一

**單一 mobile 斷點 = `max-width: 768px`**，套用於 `.topbar-*`（原 640px）與 `.shell-sidenav`（原 768px）。
消除 641–768px 的混血態。CSS 自訂屬性無法用於 media query 條件式，故以字面值 `768px` 撰寫，並在 `base.css` 頂部加註解說明此值為單一 mobile 斷點。

---

## 6. 資料流

無新增資料流。`WorkspaceNavList` 沿用 `useWorkspace()` context；`NavDrawer` 僅新增本地開關狀態。無 API 變動、無新增 props drilling。

---

## 7. 錯誤處理

此為純 chrome/layout 變更，無網路或非同步路徑，故無新增錯誤狀態。

唯一防禦性考量：`ConnectButton` 在抽屜與 `OnboardingWorkspace.tsx:17` 會同時存在於 DOM。
**這不是新風險** —— `OnboardingWorkspace` 早已與 `TopBar` 的 ConnectButton 併存，多實例為既成事實。仍需於真瀏覽器確認抽屜內實例可正常開啟錢包彈窗（見 §8.2）。

---

## 8. 測試策略

### 8.1 Unit（vitest + RTL）
- `NavDrawer`：§4.3 的 7 條行為各一條測試。
- `WorkspaceNavList`：選取觸發 `setWorkspace` 且呼叫 `onNavigate`；桌機不傳 `onNavigate` 時不炸。
- `WorkspaceHeader`：渲染當前 workspace 的 label 為 `<h1>`。
- `ExportWorkspace`：斷言**不再**有自己的 `<h1>Export</h1>`（防回歸重複標題）。

測試須編碼「**為什麼**」：focus trap 的測試要斷言焦點無法逃到抽屜外的按鈕上，而非只斷言某元素存在。

### 8.2 真瀏覽器（Playwright MCP，**不可只靠 unit test**）
依 `dev-rules.md`「UI 改動 commit 前必須實點擊走過」：

| 寬度 | 驗證 |
|---|---|
| 390 | page overflow = 0；row2 單行不換行；☰ 可開關；焦點歸還 |
| 768 | mobile 態（斷點含邊界） |
| **769** | 桌機態 —— **斷點邊界最易出混血態，必測** |
| 1280 | 桌機完全不變（對照本次改動前後） |

另需實點抽屜內 `Connect Wallet`，確認彈窗可開（§7）。
量測方式沿 2026-06-29 慣例：`getBoundingClientRect()` / `getComputedStyle()`，不靠肉眼。

### 8.3 回歸
`web` 全套（現況 422/422）+ `npm run typecheck` + `vite build`。
`SideNav.test.tsx` 現有 4 條測試會因元件結構改變而需更新——**更新而非刪除**，斷言移到 `WorkspaceNavList`。

---

## 9. Review 路徑

非 trivial（跨 5+ 檔、改元件結構、新增 a11y 契約）→ **不適用「純樣式 fast-track 跳 dual-review」慣例**，須走完整 dual-review。
非 Move、非 SUI 整合的前端變更 → 可用 generic reviewer + `sui-frontend` 輔助。

---

## 10. 成功條件

1. 390px 下 header 兩列、row2 單行、page overflow = 0。
2. 7 顆 workspace 按鈕不再出現在 mobile header；由 ☰ 抽屜提供。
3. Connect Wallet 於 mobile 僅存在於抽屜頂部；桌機仍在 header 右上。
4. §4.3 的 7 條 a11y 行為全部通過，且有非 vacuous 測試。
5. `base.css` 中因 inline style 而生的 `!important` **歸零**；矛盾註解移除。
6. 769px 與 1280px 的桌機版面與改動前**逐項一致**（無回歸）。
7. web 全套綠、typecheck 0、build 0。
