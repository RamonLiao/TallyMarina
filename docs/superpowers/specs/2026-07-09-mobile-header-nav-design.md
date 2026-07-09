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
│ ☰    🦦 TallyMarina          │  row1: --text-lg (18px) display
│ ACME PILOT 001 ▾ │ 2026-Q2   │  row2: --text-xs (12px) mono, uppercase
├──────────────────────────────┤
│ Policy                       │  內容區 h1: --text-xl (22px)
│ ──────────────────────       │
│ ┌────────────────────────┐   │
│ │ ACTIVE POLICY          │   │
```

### 3.1 字級階層（frontend-design review 後修正）

初版把 brand 定在 22px、同時內容 h1 未定字級。`tokens.css:44` 對 `--text-xl`(22px) 的註解**明訂其角色為 "workspace title"**，若 brand 也用 22px，垂直距離不到 100px 內會出現兩個同尺寸襯線標題 —— **正是使用者原本抱怨的「所有字都一樣大」**。

| 元素 | Token | px | 理由 |
|---|---|---|---|
| 內容區 h1（workspace 名） | `--text-xl` | 22 | token 註解定義的角色，頁面真正主標題 |
| Brand wordmark | `--text-lg` | 18 | 仍是 header 區塊內最大字（滿足 D3 brand-dominant），但不與 h1 打架 |
| meta 列（entity/period） | `--text-xs` | 12 | `tokens.css:40` 註解：「caption, badge, **mono-meta, eyebrow label**」。初版誤用 `--text-sm`(13px)，該尺寸註解為 "dense table body"（資料表用） |

meta 列配方沿用 codebase 既有 eyebrow 慣例（`SideNav.tsx:42` 的 `soon` 標籤）：`--text-xs` + `uppercase` + `letter-spacing: 0.05em` + `--font-mono`。

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

#### 4.3.1 抽屜表面色與 token（初版未定義）

抽屜背景 = **`--ink`**（navy），視覺上是 TopBar 向下延伸的同一塊 chrome，而非內容的一部分。

`tokens.css:27-30` 已存在一組**專為 navy 表面文字設計、但目前完全沒被 chrome 使用**的 token：

| 用途 | Token |
|---|---|
| 抽屜／nav 文字 | `--austere-ink` |
| 次要 meta 文字 | `--austere-dim` |
| 分隔線、邊框 | `--austere-border` |
| active workspace | `--brass` |

現況 `EntitySwitcher.tsx:25,31` 與 `PeriodPill.tsx:9,11` 手刻 `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.16)`。既然 §4.6 本就要把它們搬進 CSS class，**一併換成上表 token**，邊際成本趨近於零並消除一組 magic number。

#### 4.3.2 抽屜的版面與動態（初版遺漏）

- **寬度**：`min(320px, 86vw)`。
- **動態**：`transform: translateX()` 側滑，180ms `ease-out`。**必須接上 `base.css:210` 既有的 `prefers-reduced-motion` 區塊**（reduced 時直接顯示，無位移動畫）——初版 a11y 清單漏列此項。
- **safe-area**：390px 即 iPhone 級距，抽屜滿版高度須加 `padding-bottom: env(safe-area-inset-bottom)`，否則末項會被 home indicator 遮住。

### 4.4 `TopBar`（改）
- ☰ 只在 ≤768px 顯示（CSS `display`），桌機 `display:none`。
- `.topbar-wallet` 於 ≤768px `display:none`；wallet 由抽屜提供。
- row2 = `.topbar-context`，內含 `EntitySwitcher` + `PeriodPill`，**強制單行**（`flex-wrap: nowrap`），entity 名稱過長時 `text-overflow: ellipsis`。
- **分隔符用 1px 垂直細線**（`--austere-border`），以 `.period-pill::before` 產生，**不新增 DOM 節點**。
  初版用 `·` 中點：中點是列表分隔符，暗示兩側同類；但左側是**可互動的 `<select>`**、右側是**靜態文字**，會誘使使用者去點 period。分隔符須編碼真實差異，而非裝飾。

### 4.5 `WorkspaceHeader`（新，`components/chrome/WorkspaceHeader.tsx`）
`<h1>` = 目前 workspace 的 **label 文字**，字級 `--text-xl`(22px)，於 `App.tsx` 的 `<main>` 頂部渲染一次（**桌機與 mobile 皆有**，D5）。
連帶刪除 `ExportWorkspace.tsx:275` 與 `:301` 的兩個重複 `<h1>Export</h1>`（兩個 render 分支各一）。

**h1 不放 icon**：icon 已在抽屜／SideNav 承擔辨識功能，h1 再放一次是重複。「離開家門前拿掉一件配飾。」

### 4.5.1 Icon 集合改為單色 SVG（`components/chrome/WorkspaceIcon.tsx`）

現況 `workspaces.ts:8-14` 的 7 個 icon **跨兩個 Unicode 平面，渲染不一致**：

| icon | 碼位 | 實際渲染 |
|---|---|---|
| ⚓ ⚠ ⚖ | U+2693 / U+26A0 / U+2696（BMP 雜項符號） | 單色字形 |
| 🔍 📐 📤 🚢 | U+1F50D / U+1F4D0 / U+1F4E4 / U+1F6A2（補充平面 emoji） | **全彩** |

390px 截圖實證：📤 呈藍紅信箱、🚢 呈紅白船 —— 這些顏色**不存在於 `tokens.css` 調色盤**。目前散在三列尚不明顯；收進抽屜後七個垂直並列，色彩不一致會非常刺眼。

**改法**：7 個換成 inline SVG，`stroke: currentColor`、`stroke-width: 1.5`。如此 active 態的 `--brass` 著色才會套用到 icon 上，整組 nav 才具設計一致性。`WORKSPACES[].icon` 型別由 `string` 改為 icon key，SVG 查表放 `WorkspaceIcon`。

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
- `WorkspaceIcon`：7 個 key 各渲染一個 `<svg>`，且 `stroke="currentColor"`；斷言 `WORKSPACES` 內**不含補充平面碼位**（`codePointAt > 0xFFFF`）——直接把「不准回頭用彩色 emoji」釘進測試（§10.9）。

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
4. §4.3 的 7 條 a11y 行為全部通過，且有非 vacuous 測試；`prefers-reduced-motion` 下無位移動畫。
5. `base.css` 中因 inline style 而生的 `!important` **歸零**；矛盾註解移除。
6. 769px 與 1280px 的桌機版面與改動前**逐項一致**（無回歸）。
7. web 全套綠、typecheck 0、build 0。
8. **無任何兩個相鄰層級同字級**：brand 18px / h1 22px / meta 12px（§3.1）。
9. **chrome 內零彩色 emoji**；7 個 workspace icon 全為 `currentColor` SVG（§4.5.1）。
10. chrome 內**零手刻 `rgba(255,255,255,…)`**；navy 表面文字一律走 `--austere-*` token（§4.3.1）。

---

## 11. Deferred（本輪明確不做）

| 項目 | 理由 |
|---|---|
| **Period chip 做成 brass 印鑑**（`OPEN` 空心／`LOCKED` 實心填滿）| frontend-design review 提出的 signature 元素——期間封印是本產品獨有的核心儀式，且恰好落在本輪設計的 meta 列上。但它需要 TopBar 取得 `lockStatus`（`GET /entities/:id/periods` 已回傳），**會替 TopBar 新增資料相依**。本輪維持純 layout 以利 review 切分。列為下輪第一候選。 |
| **`--font-body` (Mona Sans) 從未載入** | `tokens.css:34` 宣告 Mona Sans，但 `tokens.css:10` 的 `@import` 只抓 Fraunces + IBM Plex Mono，全 repo 無 `@font-face`。**body 文字一直靜默 fallback 到 `system-ui`**，影響整個 app 而非 mobile chrome。屬獨立系統級缺陷，另開 TODO，不塞進本輪。 |
| Close workspace F1/F2/F3 | 見 §範圍。獨立 code path。 |
