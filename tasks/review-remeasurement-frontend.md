# Frontend Design Review — 期末重估雙軌 spec §6/§7

**受審**：`docs/superpowers/specs/2026-07-12-remeasurement-dual-track-design.md` §6（cockpit light DTO，行 98）＋ §7（Web 面，行 102–106）
**基準**：CloseCockpit（現況）、PolicyWorkspace（最新視覺基準）、`web/src/tokens.css`、`tasks/review-findings-2026-07-11.md` 三之1–9
**桌審**：spec + code，未跑 dev server / Playwright
**日期**：2026-07-12

---

## TL;DR

- 視覺系統**完全夠用**：黃燈、金額正負色、試算表、按鈕、缺價 chip、價格 change log 全都能用既有 TallyMarina primitive 拼出，**零新 token、零新色**。
- 真正的風險不是「不夠美」，而是 spec §7 太薄，把「用哪個既有 primitive」留給實作臨場發明 —— 這正是 review-findings 三之3/4/5 已經踩過的坑（badge 5 套、table 4 套、對比 <4.5:1）。§7 必須把每個元素**顯式綁到既有 class**，否則會長出第 5 套。
- 兩個 blocker 是**模型層**不是樣式層：黃燈在現有 4-state light 模型裡無處安放，且「黃燈擋 lock」與現有「只有紅燈擋 lock」的判定邏輯直接矛盾。

---

## Blockers

### B1 — 黃燈（stale）在現有 light 模型無定義，且「黃擋 lock」與現有判定衝突
- **證據**：
  - `web/src/api/types.ts:203` `LightStatus = 'green' | 'red' | 'derived' | 'mock'` — **沒有 yellow/stale**。spec §6 行 98 講「綠/黃/紅」三態，但從未把「黃」對應到這個 enum。
  - `web/src/workspaces/close/LockPanel.tsx:10` `blockers = lights.filter(l => l.status === 'red')`；`CloseCockpit.tsx:22` `blockingReds = lights.filter(l => l.status === 'red')`。**只有 red 進 blocker 計數與文案**。
  - 但 spec §10 行 128「補價 → 燈黃 → lock 被擋」要求**黃燈也擋 lock**。黃 ≠ red → 現有邏輯不會擋，`canLock`（LockPanel:11）由後端 `data.closeable` 決定，光顏色與擋不擋是兩條線。
  - 現有 `derived`（amber `--warn`，glyph `≈`「Derived」）語意已被 review-findings 三之2 綁死為「completeness 燈非真實資料的誠實態」。把 stale 塞進 `derived` 會撞掉這個誠實語意。
- **後果**：實作者若沿用「red-only 擋 lock」，黃燈 stale 不擋 → §10 gate 直接失敗；若硬把 stale 發成 red，就失去「黃＝逼重跑、紅＝從沒 run/缺價」的三態區分（D8 的核心）。verdict 文案（CloseCockpit:22–25 只數 red）會出現「0 lights blocking」但 lock 卻 disabled 的鬼打牆。
- **spec 該補**：§6/§7 顯式定義新的 stale 態：(a) 是否擴 `LightStatus` 加 `'stale'`，還是後端發 red-with-reason；(b) 對應 glyph/word（建議 `⟳`「Stale — rerun」，**不要**復用 `≈`）；(c) 色用既有 `--warn`（＝現有 stale-anchor-chip 同色，close.css:118，天然一致）；(d) 明寫 blocker 計數/verdict 文案要把 stale 納入，或改由 `data.closeable` 統一驅動且 verdict 不再只數 red。這是**判定邏輯**變更，必須寫死。

### B2 — 價格 change log 在 §7 完全沒有 UI，與審計目標矛盾
- **證據**：schema §5 行 78「同 (coin_type, as_of) 多筆取最新；舊筆即 change log」、D5 行 37 明訂改價留痕；review-findings 二之14 把 change log 列為 MVP 必要（「否則 AI/人工決策對審計師是黑箱」）。但 §7 行 106 只寫「幣種下拉、日期、價格」輸入，**零字提到把歷史/舊價呈現出來**。
- **對照基準**：PolicyWorkspace 已有 `PolicyHistoryCard`（policy.css:46–49 `.policy-history-*`）專門幹這件事 —— reason/actor/diff 逐列。價格改動的可審計性需求完全同構。
- **後果**：改價留了庫但 UI 看不到 → 審計故事斷掉；實作者沒被要求做，就不會做。
- **spec 該補**：§7 增列「期末價 change history」唯讀清單需求（每筆 as_of / price / source / level / created_at，最新在頂、舊筆標 superseded），直接指名複用 `.policy-history-*` 版式。

---

## Should-fix

### S1 — 試算表欄位規格太薄，會長出第 4 套 table 又踩 formatter 坑
- **證據**：§7 行 104 只列「asset、prior carrying、current FV、delta、缺價警示」5 欄，缺以下決策：
  1. **granularity**：§6 preview 同時回 per-lot 與 per-asset（行 95），§7「試算表」單數 —— 顯示哪一層？要不要 per-asset 彙總可展開 per-lot？沒定 → 實作亂猜。
  2. **basis 欄**：GAAP_FV vs IFRS_COST（schema `basis`）在多資產混合軌時看不出來，建議加一欄或行內 chip。
  3. **delta 正負色**：valuation delta ＝ P&L gain/loss，依 review-findings 三之2 語意色合約應綁 `credit`(綠)/`debit`(紅)，PolicyPreview 已有 `.policy-debit`/`.policy-credit`（policy.css:33–34）可直接複用。§7 未指名 → 恐用錯色或不上色。
  4. **金額 formatter**：review-findings 三規格1 硬性要求「千分位＋scale＋U+2212、右對齊＋tabular-nums＋mono」，且 JournalTable 已因 raw minor 被抓過（三之3）。§7 未引用 → 高機率重蹈。
- **spec 該補**：§7 明訂欄位表（含 basis、擬 JE 借貸科目可選）、指名複用 `.policy-coa-table` + `.num`（右對齊 tabular-nums，policy.css:30）+ `fmtMinor` formatter、delta 綁 credit/debit 色。

### S2 — 重估區塊塞進 cockpit 的版面/密度沒定案
- **證據**：現況 `.close-cockpit`（close.css:93）是單欄垂直堆疊：ribbon → verdict → lights-grid → LockPanel(sticky bottom)。§7 要再塞一整張試算表＋擬 JE lines＋缺價清單＋兩顆按鈕＋燈文案，**位置沒定**（新 card？抽屜？獨立 step？現有已有 `setStep` 導覽模型，CloseCockpit.tsx:15）。review-findings 三之6/三之9 已警告 inline-style 骨架與關鍵數字被埋。
- **後果**：直接展開會把 sticky LockPanel 擠到很遠、資訊密度爆掉。
- **建議**：獨立 `<section className="card">` + `.policy-card-title` eyebrow，置於 lights-grid 與 LockPanel 之間；不要 inline style 骨架。若內容量大，preview 結果區塊用 PreviewPanel 的「Recompute 後才展開」摺疊模式（PreviewPanel.tsx:80）。spec 明寫落點與容器。

### S3 — 試算表 390px 行動策略未定
- **證據**：§7 無 mobile 字樣。現有兩種 pattern：`.policy-coa-scroll`（policy.css:16 橫向捲）與 lights-grid 640px 塌成單欄（close.css:125）。5 欄數字表在 390px 必爆版。
- **建議**：指名複用 `.policy-coa-scroll`（`overflow-x:auto` wrapper）保持與 policy 一致；**不要**新發明 stacked card。spec 一句話定死。

### S4 — Preview/Run 按鈕狀態與 disabled 理由可見性未規格
- **證據**：§7 行 104 只說「缺價時 Run disabled」。缺：(a) Run 是否 gated on「先 Preview 過一次」（PreviewPanel 強制「Recompute a preview first」，PreviewPanel.tsx:46–47）—— D1 preview→run 但沒說 Run 是否需新鮮 preview；(b) disabled **理由怎麼給使用者看**。既有強 pattern：`title={disabledReason}` tooltip ＋行內 caption（PreviewPanel.tsx:44–54、PolicyEditForm.tsx:169、LockPanel `.lock-blockers` chip）。
- **建議**：§7 明訂 Run 的 disabled 理由集合（`PRICE_MISSING × N`、尚未 preview、period LOCKED、stale 需重跑）並指名走 `title` tooltip + `.lock-blockers` chip 呈現；定義 Preview→Run 是否強制重新 preview。

### S5 — 缺價警示的呈現層級未定（單層 vs 雙層）
- **證據**：§7「缺價警示」＋§6 preview 回 `PRICE_MISSING` 清單，但沒定是「表內逐列 inline 標記」還是「頂部彙總 banner」還是兩者。review-findings 三之9 教訓：最重要的數字最小/被埋。
- **建議**：雙層 —— 彙總用紅 `.lock-blockers` chip 標「N assets missing price」，表內對應資產列加行內缺價標記（沿 `light--red` 的 inset-border 無彩色線索手法，close.css:75）。spec 寫死兩層。

### S6 — 價格輸入表單的驗證錯誤／成功回饋未規格
- **證據**：§7 行 106 只列欄位。§8 行 116 zod 擋負/零/未註冊幣種 → 400，但 UI **怎麼呈現欄位錯誤**沒寫；成功回饋也沒寫。既有 pattern：錯誤 `<p className="policy-bad">`（PreviewPanel.tsx:151、PolicyEditForm.tsx:175）、成功 `.policy-applied-badge`（綠，policy.css:39）。
- **建議**：§7 要求：欄位級錯誤文案（指名 price>0、幣種需在 registry 的具體訊息）走 `.policy-bad`；送出成功走 `.policy-applied-badge`「Price saved — 燈已更新」；幣種下拉限 registry（PolicyEditForm select pattern）。

---

## Nits

- **N1**（button variant）：Run 是**寫帳＋反向沖銷**的敏感動作，別用裸 `<button>`（review-findings 三之7 已抓 Reopen 裸 button）。指名 `btn-primary`（LockPanel.tsx:32）或 danger variant；Preview 用次級 `.export-retry-btn`（PreviewPanel 慣例）。spec 一句話。
- **N2**（LEVEL_2 / FV level 可見）：價格強制 `level='LEVEL_2'`（§5 行 76），review-findings 二之15 要求 FV hierarchy level 可見。輸入區與 change log 帶個 `LEVEL_2` chip（沿 `.policy-chip-deferred` amber chip 版式，policy.css:14）。
- **N3**（輸入小數 UX）：`price_minor` 是法幣 minor 2dp，使用者輸入是「輸美元小數還是 minor 整數」沒寫。建議輸入收 decimal 法幣、UI 轉 minor，並用 `.num`/tabular-nums 顯示。spec 註一句避免歧義。

---

## 一致性結論（明確）

**與既有視覺語言＝同一系統，可達成 —— 但前提是 spec 補上 primitive 綁定。**

- 黃燈：`--warn`（#C28A1E）已是 stale-anchor-chip / derived 燈同色，黃燈有現成的家，**零新色**。唯一要解的是 B1 的**模型/判定**衝突，不是配色。
- 金額正負：`credit`(綠 #2F7A5A)/`debit`(紅 #B5532E) 語意色合約現成，delta 直接套。
- 試算表：`.policy-coa-table` + `.policy-coa-scroll` + `.num` 現成。
- 按鈕/disabled 理由/成功/錯誤：`btn-primary` / `title` tooltip / `.policy-applied-badge` / `.policy-bad` 現成。
- change log：`.policy-history-*` 現成。
- 字體階層／間距：全走 tokens.css（`--text-*`、`--space-*`、`--policy-card-title` eyebrow 慣例），無需新增。

**風險僅在**：§7 若不顯式指名這些 class，實作者會複製貼上出第 5 套 badge / 第 4 套 table（review-findings 三之4/5 的原病），對比與 token 漂移重演。把綁定寫進 spec 即可根治。

---

## 計數

- Blocker: 2（B1 light 模型衝突、B2 price change-log 缺 UI）
- Should-fix: 6（S1–S6）
- Nit: 3（N1–N3）
- 一致性：可達成，條件＝spec 補 primitive 綁定
