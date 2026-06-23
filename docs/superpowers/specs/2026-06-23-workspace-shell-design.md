# TallyMarina UI 升級 — Workspace Shell + A/B/C 工作面（umbrella spec）

**日期**：2026-06-23
**狀態**：DESIGN — Phase 0 已批准，A/B/C 各自後續 spec
**來源**：`specs/business-spec-v3.md`（§3 角色、§4 user stories、§6 模組）
**前端基準**：`web/`（Vite + React + @mysten/dapp-kit-react），現為單一線性 5 步 close flow

---

## 0. 動機與範圍

現有前端是**單一線性 5 步**（ingest → classify → review → journal → anchor），只覆蓋 spec §2.5 Demo 欄的 happy-path。spec 描述的操作面（exception-first workflow、reconciliation、period close、audit lineage、policy、ERP export、onboarding）完全沒有 UI。

本次升級把產品從「線性 demo」升級成「關帳駕駛艙」。受眾**兩者兼顧**：專業財務工具的資訊密度 + hackathon demo 的敘事/proof beat。

### 範圍決策（已與使用者確認）
- **範圍**：全部 A + B + C，分解為 Phase 0 殼層 + 3 個 sub-project。
- **導覽**：Workspace Shell（側欄 + 頂部 entity/period 切換）。
- **後端策略**：混合 — 讀路徑接真資料，demo 難寫的寫入（lock/reopen/ERP ack）先 mock 狀態機。

### 分解與順序

| Phase | Sub-project | 內容 | 後端 |
|---|---|---|---|
| **0（地基）** | Workspace Shell | 線性 step rail 升級成可導覽工作區外殼；close flow 變其中一個 workspace | 純前端 + `GET /entities` |
| **1** | A 核心控制面 | Exception Queue + Event 並列下鑽 + Reconciliation | review-queue/decide/copilot ✅；recon roll-forward 讀真 / 差異處置寫 mock |
| **2** | B 駕駛艙 | Period Close 六燈 checklist + lock/reopen + Audit lineage 下鑽到 Sui digest | snapshot/anchors ✅；close-checklist 讀真組合 / lock·reopen 寫 mock |
| **3** | C 閉環 | ERP CSV export 狀態機 + Policy/Rules 檢視 + Entity/Source onboarding | journal/run-rules ✅；export·ack 寫 mock / policy·source 讀真或 mock |

**本文件只把 Phase 0 設計到 plan-ready 深度。** A/B/C 各自獨立 spec → plan → 實作。

---

## 1. Phase 0：Workspace Shell 詳細設計

### 1.1 核心轉變

`step`（close 內部 5 步）從「app 唯一維度」降級成「`close` workspace 的內部狀態」。在它之上新增一層 **workspace** 導覽。

### 1.2 狀態分層

拆關注點，不更動 `EntityContext` 的 close 語意：

- **新增 `app/WorkspaceContext.tsx`**：
  - state：`activeWorkspace: WorkspaceId`（預設 `'close'`）。
  - API：`setWorkspace(id: WorkspaceId): void`。
  - 必須在 `EntityProvider` 之內或之外皆可（互不依賴）；實作上 `WorkspaceProvider` 包在 `EntityProvider` 內側。
- **`EntityContext` 保持原樣**：`entity / setEntity / step / setStep / goNext / periodId`。`step` 只在 `close` workspace 內有意義，不受 workspace 切換影響（切走再切回，close 步驟保留）。
- **新增 `app/workspaces.ts`**（仿 `app/steps.ts`）：
  ```ts
  export type WorkspaceId =
    | 'close' | 'exceptions' | 'reconciliation'
    | 'audit' | 'policy' | 'export' | 'onboarding';

  export const WORKSPACES: {
    id: WorkspaceId; label: string; icon: string; status: 'ready' | 'soon';
  }[] = [
    { id: 'close',          label: 'Close',          icon: '…', status: 'ready' },
    { id: 'exceptions',     label: 'Exceptions',     icon: '…', status: 'soon' },
    { id: 'reconciliation', label: 'Reconciliation', icon: '…', status: 'soon' },
    { id: 'audit',          label: 'Audit',          icon: '…', status: 'soon' },
    { id: 'policy',         label: 'Policy',         icon: '…', status: 'soon' },
    { id: 'export',         label: 'Export',         icon: '…', status: 'soon' },
    { id: 'onboarding',     label: 'Onboarding',     icon: '…', status: 'soon' },
  ];
  ```
  - `icon` 用既有 emoji/字符或現有 mascot 資產風格，不引新 icon 依賴。
  - 各 sub-project 完成時把對應 `status` 改 `ready`。

### 1.3 Layout

```
┌──────────────────────────────────────────────────────────┐
│ TopBar（滿版 navy）：logo · EntitySwitcher · PeriodPill · WalletSlot │
├──────────┬───────────────────────────────────────────────┤
│ SideNav  │  <main> 內容區                                  │
│ (7 項,   │   activeWorkspace==='close'                     │
│  讀      │     → StepRail + 現有 5 step section            │
│  workspaces.ts) │  else 且 status==='ready' → 對應 workspace  │
│          │   else（'soon'） → EmptyState「coming soon」     │
└──────────┴───────────────────────────────────────────────┘
```

- **TopBar** 吸收現有 `Header` 的滿版 navy；entity/period/wallet 移入。`WalletSlot`（含 z-index 修正）整段搬進來，維持既有 stacking context 行為。
- **SideNav** 讀 `WORKSPACES`；每項可點。`soon` 項點了切過去但內容區渲 `EmptyState`（複用現有元件），標題明示「此工作面尚未啟用」——不假裝有資料（fail-loud，spec §12 / Rule 12）。
- **`GuardrailBanner` 與 `CopilotDock` 提升到殼層**常駐（跨 workspace），不再綁在 close section 內。
- **內容區**：`close` 時渲 `StepRail current={step}` + 現有 5 個 step 元件（行為**完全不變**）。

### 1.4 Entity / Period 切換器

- **`EntitySwitcher`**（TopBar）：讀 `GET /entities`（既有 endpoint）→ `setEntity`。entity=null 時顯示 placeholder，不崩。
- **`PeriodPill`**（TopBar）：Phase 0 顯示 `periodId`（`'2026-Q2'`），**唯讀**。多期切換延後。

### 1.5 導覽方式與取捨

- **state-based**（`WorkspaceContext` useState），不引入 react-router — 對齊現有 `EntityContext` 慣例、零新依賴（Rule 11）。
- **已知取捨（延後項）**：跨 workspace 深連結（如 Audit 下鑽想用 URL 分享）做不到。Phase 2 Audit 若真需要再評估引入 router；屆時 `WorkspaceContext` 可換成讀 URL 的 adapter，介面不變。

### 1.6 後端邊界

- 本階段只用 `GET /entities`（已存在）。其餘 workspace 為 `soon` 空殼，無新 API。

### 1.7 RWD

- ≤768px：SideNav 收成頂部橫向 tab 或漢堡抽屜（沿用既有 clamp padding + StepRail 的 RWD 手法）。
- TopBar 元素在窄寬度堆疊 / 收合（entity switcher 優先保留）。

---

## 2. 元件清單（Phase 0）

| 檔案 | 動作 | 說明 |
|---|---|---|
| `web/src/app/workspaces.ts` | 新增 | workspace registry |
| `web/src/app/WorkspaceContext.tsx` | 新增 | activeWorkspace 狀態 |
| `web/src/components/chrome/SideNav.tsx` | 新增 | 側欄導覽，讀 registry |
| `web/src/components/chrome/TopBar.tsx` | 新增 | 滿版 navy，吸收 Header + entity/period/wallet |
| `web/src/components/chrome/EntitySwitcher.tsx` | 新增 | 讀 `GET /entities` |
| `web/src/components/chrome/PeriodPill.tsx` | 新增 | 唯讀期間 |
| `web/src/components/chrome/Header.tsx` | 改/併 | 內容遷入 TopBar；若無其他引用則移除 |
| `web/src/App.tsx` | 改 | 套殼：TopBar + SideNav + 內容區 switch |
| `web/src/components/chrome/EmptyState.tsx` | 複用 | soon workspace 內容 |

mascot 治理（spec §8.4）、tokens、`.btn-primary` pill、wallet z-index 等既有規範**沿用不動**。

---

## 3. 測試策略（Rule 9 + test.md）

意圖導向，不只測「渲了什麼」：

- **WorkspaceContext**：預設 `close`；`setWorkspace` 切換；切到 `soon` 不改 `EntityContext.step`；未知 id 不崩（clamp 或忽略）。
- **Shell 渲染**：`close` → 渲 `StepRail` + close section；切到 `soon` → 渲 `EmptyState` 且**不**渲 close section（驗「為何重要」：避免空 workspace 誤顯示上一個 workspace 的內容）。
- **EntitySwitcher**：`GET /entities` 載入後可選；entity=null 不崩。
- **Monkey**：未知 workspaceId、entity=null 時切 workspace、極窄寬度（320px）側欄塌陷、快速連點切換不殘留舊內容。
- **回歸**：現有 133 web tests 全綠（close flow 行為不變是硬性條件）。

---

## 3.1 美感 / 排版 Review Gate（強制）

Phase 0 是新殼層、視覺改動大，實作完成後**必跑兩道 UI review**（對齊專案 skill-routing「前端 dApp → sui-frontend + generic reviewer」）：

1. **`sui-frontend` skill review**：dApp 結構、dapp-kit 整合（wallet slot/connect 行為）、SUI 前端 best practice。
2. **`frontend-design` skill review**：美感與排版 — 視覺層級、間距節奏、側欄/TopBar 比例、navy-brass-cream 色彩一致性、mascot 治理（§8.4）、RWD 斷點觀感。避免 generic AI 美感。

兩道 review 的 finding 整合 → 修完才算 Phase 0 完成。純樣式/版面修正後需真瀏覽器幾何 + 截圖肉眼複驗（lessons 2026-06-23）。

## 4. 成功準則（Phase 0）

- 側欄可在 7 個 workspace 間切換；`close` 行為與升級前**完全一致**。
- 6 個 `soon` workspace 顯示明確「未啟用」狀態，不偽造資料。
- TopBar 滿版 navy，entity 可切、period 顯示、wallet 連接可用且彈窗不被蓋。
- 320px–1440px RWD 不破版。
- web tests ≥ 133 全綠、`tsc --noEmit` clean、`npm run build` exit 0。
- 純樣式/版面以真瀏覽器幾何斷言驗（側欄寬、TopBar 滿版 width≈viewport、內容區 left = 側欄寬）—— 對齊 2026-06-23 lessons「computed-style 綠 ≠ 版面對」。

---

## 5. 不做（YAGNI）

- react-router / URL 同步（延後到 Phase 2 Audit 真需要）。
- 多期切換（單期 demo）。
- RBAC 角色切換 UI（spec §3 角色 demo 後話）。
- 側欄拖拉 / 釘選 / 收合記憶。
- A/B/C 任何工作面的真實內容（各自 sub-project）。

---

## 附：A/B/C 工作面情境對照（後續 sub-project 來源）

來自 spec，供後續各自 brainstorm：

- **A1 Exception Queue**（§2.6 exception-first、§4.3、§6.5）：低信心/未知合約/重大金額/新對手方/規則衝突路由到分流台；filter by risk/confidence/amount/protocol；Accept/Edit/Reject/Flag/Split；maker-checker。
- **A2 Event Detail 並列下鑽**（§4.5、§6.2）：raw Sui tx / normalized event / AI 建議+confidence / price / lot / JE preview 並列，AI 與 parser 分欄不互蓋。
- **A3 Reconciliation**（§4.6、§6.6，Demo 最小版 P0）：entity+wallet+asset 的 `opening + movements = ending` roll-forward；差異標 owner/reason/status；未解重大差異擋 close。
- **B1 Period Close Dashboard/Checklist**（§4.5、§6.11）：六類狀態燈（completeness/classification/pricing/JE/recon/export）；全綠才 lock；reopen 填 restatement reason + 額外核准（§3.2 SoD）。
- **B2 Audit Lineage Explorer**（§4.8）：period balance → JE → event → raw tx → Sui digest；顯示 price/policy/rule/parser version；原始分類 vs AI vs 人工 vs 最終 diff。複用現有 hash chain + inclusion proof。
- **C1 ERP CSV Export**（§4.7、§6.7、P0）：選 JE → 驗 debit=credit/period 開放/未重複 → 出 CSV + export hash；狀態機 `APPROVED→EXPORTED→ACKNOWLEDGED→POSTED`，manual ack。
- **C2 Policy/Rules + COA Mapping 檢視**（§4.4、§6.4）：看 active PolicySet、mapping rules、對歷史樣本 preview 規則影響再生效；AI 不可改 policy（§6.9）。
- **C3 Entity/Source Onboarding**（§4.1）：建 entity（functional currency/fiscal calendar）、加 Sui wallet source、dApp Kit 簽名驗 ownership（不存私鑰）。
