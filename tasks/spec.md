# Spec: GTM 正式規格 v1.0 撰寫（2026-07-11，使用者已確認）

權威設計：`docs/superpowers/specs/2026-07-11-gtm-spec-v1-design.md`（rev3，D1–D19 全定案）。
本檔為 alignment audit 用的可判定摘要；細節以設計文件為準。

## Goals（可判定）

- G1: `docs/specs/business-spec-v1.md` 存在且涵蓋設計文件「文件一」全部 8 節（含附錄 A/B/C）。
- G2: `docs/specs/accounting-spec-v1.md` 存在且涵蓋設計文件「文件二」全部 18 章。
- G3: 兩冊無 "TBD"/"TODO"/placeholder（grep 可驗）。
- G4: ICP 採 F2/F9 三層；詞彙表含 L1/L2/L3 定義並註記修正 F5 訛誤。
- G5: 每個功能模組帶 MVP/P1/P2 標記；分期表只在商業冊出現一份，會計冊為引用。
- G6: 會計冊含 6 個 MVP-blocker 對應章節：Manual JE/Reversal、期初導入、Pricing/cut-off、月結 checklist、CEX 存提（MVP taxonomy）、USD-only FX 限制（含可插拔接口條款）。
- G7: 會計冊 §13 含 Sui tx normalization 層（PTB 分解、gas storage rebate、sponsored payer、物件級移動、split/merge 過濾）與資料層決策表（gRPC streaming / custom indexer / GraphQL 輔助）。
- G8: 會計冊 §15 含 5 條 UI/UX 可判定條文。
- G9: ERP export 章明定 Xero + QBO CSV 欄位映射（MVP）、NetSuite P1、SAP 不做。

## Non-goals

- N1: 不寫實作 code（規格書撰寫任務；重對準實作另開 plan/chat）。
- N2: 不做三大報表引擎、稅務/tax basis、SAP 支援、多幣別 FX（P1）的詳細規格——僅以分期表與非目標條目標注。
- N3: 不重寫/搬移 `Ideas/` 原始檔（保留為歷史）。

## 驗收準則

- A1: `ls docs/specs/` 見兩冊；逐章對照設計文件目錄無缺漏。
- A2: `grep -riE "TBD|TODO|placeholder" docs/specs/` 零命中。
- A3: fresh-context 會計師視角 desk check：照會計冊月結章可走完一次桌面月結演練（無卡死步驟）。
- A4: 使用者審閱通過。

## 修訂紀錄

- 2026-07-11 撰寫過程增補（非偏離，desk check 驅動）：§4.4.1 負 gas 淨額 JE（新科目
  GasRebateIncome）、§14 缺價 blocking 統一 fail-closed（依 D13）、§7.3 GAAP FV 軌
  opening_fv + ASU 2023-08 過渡調 RE（新科目 RetainedEarnings，opening_fv_minor 由
  deferred 改 MVP 必要）。CoA seed 六→八科目。G1–G9 驗證均在增補後複核通過。
