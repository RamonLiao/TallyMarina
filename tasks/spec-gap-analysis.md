# 初始規格 vs 現況 — 差距分析（2026-07-11）

比對基準：`Ideas/` 9 份文件（F1–F9 對照表見下）vs 現有 codebase 盤點。
Ideas 摘要全文（session scratchpad，會過期）：`ideas-spec-summary.md`；本檔為持久版結論。

檔名對照：F1=ERP/三大報表市場調研、F2=ICP/GTM 分層、F3=PRD 模組切分+Sui stack、
F4=會計規格書 v0.1、F5=商業規格書 v0.1、F6=資料模型+規則引擎、F7=Sui Stack 架構圖/track、
F8=Sui stack 補充（Walrus/DeepBook/Nautilus/Seal）、F9=ICP 切入順序。

## 總判定

**核心 kernel 沒有走偏，走偏的是投資比重。**
F6 的 10 實體/6 步資料流（Raw→Normalized→Priced→Lot-costed→JE→Recon/Export）在 code
裡都對得上：雙分錄平衡檢查、FIFO lots、對帳、期間鎖、JE 記錄 policy_version，都是真
邏輯不是 demo 裝飾。但過去的工程量壓在「審計完整性基礎設施」（audit_anchor Move 合約、
Merkle、cap rotation、asset registry decimals）——這在規格書裡只是 F5 §6.7 一節（且
原設計是 Walrus，不是自建合約）。而規格書裡「會計師每個月真的要做的事」大半沒做。

## 逐項差距表

| 規格功能 | 出處 | 現況（已驗證） | 判定 |
|---|---|---|---|
| 排程拉取鏈上/CEX 原始交易 | F5 §6.1, F3 | 主流程吃 FixtureSource；`SuiJsonRpcSource` 僅 40 行、只有 CLI `run-ingest` 用到，未接 API 主流程 | ❌ 大缺口 |
| MVP 8 大事件類型 | F4 §3, F6 | 只有 5+opening_lot（receipt/payment/swap/gas/transfer）；**缺 staking 三態、CEX 存提、期末重估/減損**（rules-engine grep 零命中） | ❌ 缺的正是最「會計」的 |
| PolicySet 可配置+版本化+IFRS/GAAP 切換 | F4 §5, F6 | `DEMO_POLICY_SET`/`DEMO_COA_RULES` 寫死常數（`policyConstants.ts`），schema 無 policy 表；版本欄位有記但只有一個 hardcoded 版本 | ❌ 三大差異化主打之一未兌現 |
| 規則引擎（Mapping+Measurement rule） | F4 §6, F6 | 11-phase pipeline，含 recognition/measure/COA mapping/disclosure | ✅ 超規格 |
| AI 建議+Review workflow（不自動 posting） | F5 §6.2/6.4/6.8 | classify+confidence+review queue+copilot+triage agent 提案（human accept） | ✅ 超規格（agentic 部分優於原設計） |
| Reconciliation | F5 §6.5, F6 | book vs live chain 兩層；無 ERP 第三層 | ⚠️ MVP 可接受 |
| Cost basis FIFO+WAC | F4 §4 | FIFO 有；WAC 無 | ⚠️ |
| ERP export（NetSuite/Xero/QuickBooks 欄位映射） | F5 §6.6 | generic CSV/PDF；全 repo 無任何 ERP 欄位映射（grep 零命中） | ❌ subledger 的最後一哩不通 |
| Walrus audit snapshot（可下載審計包） | F5 §6.7, F8 | 換成自建 audit_anchor 合約：hash-only 上鏈，資料包不可取回 | 🔀 完整性更強、可取回性更弱；規格外自建 |
| RBAC + Audit Log | F5 §6.9 | 無（maker-checker SoD 已列 deferred） | ❌ P1 |
| 揭露：roll-forward/期末餘額 by asset | F4 §8 | disclosure facts phase 存在，但無 roll-forward 報告與 trial balance 視圖 | ⚠️ |
| 完整三大報表 | F4 §8, F5 §5.2 | 無 —— 規格本來就列 P2 非 MVP | ✅ 按規格，不算偏 |

## 「為什麼看不出和實際會計流程重疊」的診斷

1. **沒有期末重估** = 沒有月結最核心的會計作業（FV remeasurement / impairment 是
   ASU 2023-08 與 IFRS 下 crypto 會計的主戲）。
2. **沒有 trial balance / 科目餘額視圖** —— 會計師的世界以科目為軸，現有 UI 以
   event 流為軸。
3. **CoA 是 demo 常數** —— 企業無法配置自己的科目表，會計師無從上手。
4. **Export 沒有 ERP 憑證格式** —— 「feed ERP 的 subledger」這個存在理由沒兌現。
5. **Close cockpit 重心是 snapshot+anchor**（crypto-native 概念），不是會計關帳
   checklist（重估→試算→roll-forward→出 ERP 憑證）。

## 建議：不重寫，「再對準」（re-aim）

架構符合 F6 設計，重寫是浪費。建議順序：

1. **先寫正式 GTM 規格 v1.0**：合併 F4/F5/F6 為單一權威文件；修正 F5 與 F2/F9 的
   ICP L2/L3 命名不一致；明定 MVP scope 與 anchor 合約的定位（audit integrity 層，
   Walrus 補可取回審計包）。走 brainstorming → writing-plans 流程。
2. **P0（讓會計師認得這是會計系統）**：
   - PolicySet + CoA 落庫、可配置、版本化（取代 DEMO 常數）
   - 期末重估事件 + roll-forward 輸出
   - Trial balance / 科目餘額視圖
   - ERP export 欄位映射（先挑一家：Xero 或 QuickBooks）
   - SuiJsonRpcSource 接通 API 主流程（脫離 fixture-only）
3. **P1**：staking/CEX 事件、WAC、RBAC+audit log、Walrus 審計包、recon 第三層（ERP）。
4. **保留**：audit_anchor 合約（已審計、hackathon 差異化），定位收斂為完整性層。

## 未決事項（需使用者裁定）

- Hackathon demo 期限 vs GTM 重對準的優先序：若 demo 在即，P0 可改為 demo-facing
  子集（真鏈 ingestion + trial balance + export）。
- ERP 先接哪一家（影響 export 欄位設計）。
- 期末重估先做 US GAAP（ASU 2023-08 FV，單軌較簡單）還是 IFRS/GAAP 雙軌。
