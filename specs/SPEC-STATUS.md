# Spec 收斂狀態（Freeze Record）

**日期**：2026-06-19
**Baseline**：`specs/business-spec-v3.md`、`specs/accounting-spec-v3.md`
**判定**：SPEC CONVERGED — 可作為「固定範圍付費 design-partner pilot」之工程與會計依據。

## 收斂依據

兩份 review 經獨立 grep 驗證後一致：codex R3 列的 5 個可由文件直接修正的 blocker，在現行 v3 檔案上全部已關閉。

| Blocker（codex R3） | 現況 | 證據 |
|---|---|---|
| B1 SUI accounting class 與 canonical enum 衝突 | 關閉 | 全檔僅 `INTANGIBLE_IAS38_COST`（acct §2.1/§5.6/§7.8 一致），無 `_ASSET_` 變體 |
| B2 ADR test case ID 不可解析 | 關閉 | 8 個 ADR 全改引用 §7.8 實際定義的 25 個 GF-* fixture；GF-ALL-*/GF-CLOSE-IMPAIRMENT/GF-PROFILE-REJECT-CEX 已移除 |
| B3 capability matrix 外 scope 重述 | 關閉 | biz §7.5/§14.6/§4.1 改為「只依 §2.5」，Walrus 標 optional、CEX/custody/CSV 標 Post-pilot |
| B4 ADR owner 未逐筆具名 | 關閉 | 每筆 ADR 填 `TBD-BEFORE-X (Role)` 暫定 owner + contract gate；ADR-P1-008 已 DECIDED |
| B5 §5.3 ERP acknowledgement 混淆 | 關閉 | 明示 Pilot 支援 manual ack，原生 ack + 雙向 recon 為 Post-pilot |

## 殘留 `[需查證]`（35 處，非 blocker）

依 codex R3 §C 分級：
- **E2**（pilot 前並行驗證）：provider coverage、競品實測、Sui GraphQL/Indexer GA 狀態、客戶安全/DPA、ICP 訪談/定價/單位經濟。
- **E3**（可延後，不得對外 claim）：Walrus 法律效力、長期 retention、非首期元件、Phase 2+ 能力。
- **已 gate 的 pilot 外 E1**：staking/bridge/wrap/LP/fork/rebase/IFRS 重估/broker-trader/cost formula/cash-flow — 全 DESIGN_BLOCKED，禁止啟用對應 auto-post path。

均為真實世界驗證工作，無法靠寫作捏造，誠實標記優於假數據。

## 簽約前必辦 gate（pilot 內 7 個會計 ADR）

ADR-P1-001~007 仍為 `DESIGN_BLOCKED`，狀態機 `DESIGN_BLOCKED → DECIDED → IMPLEMENTED → FIXTURE_APPROVED`，僅 `FIXTURE_APPROVED` 可在 Paid Pilot 啟用。簽「固定 acceptance、固定 JE 結果」pilot 合約時，須在合約明列：每筆 ADR 的 assumptions、客戶 evidence obligations、decision deadline、未決而排除的 auto-post path、逐筆具名 owner（取代現行 TBD role placeholder）。

## 下一步

規格階段結束。後續進實作前建議：`sui-architect` 做 object model / module 結構設計，依 §2.5 Paid Pilot 範圍（指定 Sui wallet、5 事件、IFRS 成本模式、FIFO、generic CSV、wallet recon、內部 snapshot 必須 / Walrus optional）為 scope。
