# 四視角架構審查（2026-07-03）

四個平行 fresh-context reviewer：會計師（CPA）、SUI 合約（sui-security-guard skill）、全端、AI 工程師。全部唯讀。

## 總體診斷

**設計層品質高、中間層（services/api）全是 demo stub、AI 是裝飾性。**
rules-engine（BigInt minor-unit、fail-closed、balanceCheck）、merkle/manifest（domain separation、BCS frozen schema）、`audit_anchor.move`（AnchorCap、hash-chain、cap rotation）三層都達 spec 水準。所有 Critical 集中在 API 層把 spec 承諾的控制 stub 掉。

## 會計師（Critical ×4）

- **C1 Period lock 鎖不住帳**：`routes.ts:282-309` run-rules 無 lock guard；`policyConstants.ts:6` `periodOpen: true` 寫死。lock 後仍可過帳 → 鏈上 anchor 與 DB 分岔。
- **C2 JE/event 無 period_id**：`cockpit.ts:31-33`、`collect.ts:34`。anchor 的是 entity 全歷史不是期間；cutoff/completeness assertion 不成立。
- **C3 Suspense catch-all fail-open**：`policyConstants.ts:19-23` `resolveCoa` fallback 到 Suspense，`MAPPING_MISSING` 永不觸發，未分類金額被公證上鏈。違反 spec §6.5/A.2。
- **C4 成本基礎虛構**：`buildRuleInput.ts:20-28` 合成 lot（不持久化、可無限重複消耗）+ 寫死價格 + 硬編碼 `APPROVED`/`IAS38_COST`（USDC 直接違反 spec §5.6）。
- High：H1 maker-checker 零 enforcement（`LOCKED_BY='demo-controller'`、reopen 自請自批）；H2 snapshot repo 每請求 new → supersedesSeq 永遠 0、reopen 後無強制 re-anchor；H3 除不盡即 throw、`roundingThresholdMinor` 零引用、ROUNDING leg 未實作；H4 manifest policyVersions 寫死非從 JE 推導。
- Medium：M1 `reverse()` 無 API 呼叫路徑；M2 無 by-account TB、無 value recon；M3 recon statement 端是 fixture 且缺失時 vacuously pass（fail-open）；M4 EMPTY_SNAPSHOT 擋零活動期間 close；M5 idempotency key 不含 period。
- 審計師前三槍：lock/anchor 保護不了帳本（C1+C2+H2）、成本基礎是佈景板（C4）、Suspense+自請自批 = material weakness 寫法（C3+H1）。

## SUI 合約（0 Critical）

- **S2 High PAT-VM-1**：package 已可升級（testnet UpgradeCap 活著）但 `EntityAnchorChain` 無 version 欄位/gate → 升級後舊版可繼續寫。加 `version` + `assert` + `migrate(&AdminCap)`。
- S3：hash-chain 無 known-answer test（preimage 重排 12 tests 照過）；`create_chain` 不發 `ChainCreated` event（indexer 無法從 event 流發現新 chain）；`entity_ref` 可 squatting（off-chain 必須 pin chain_id，勿信 entity_ref）。
- S4：event 無 epoch/Clock 時戳；`supersedes_seq=0` magic sentinel 未文件化。
- Anchor 特有風險（偽造/覆寫、重複期間、順序、時戳操縱）全部 cleared。

## 全端

- **High**：`@mysten/sui` 版本分裂——ingestion `^1.0.0` vs 其他 `2.19.0`/`^2.0.0`，各自 node_modules 無 hoisting，型別默默漂移。
- **High**：DTO 手寫 3-4 份（api routes 匿名 literal → `web/src/api/types.ts` 手抄 249 行），無共用 contract package，HTTP 邊界零 schema validation（zod 已裝但沒用在邊界；`fetchJson` 裸 `as T`）。
- **High**:雙軌 data fetching——`api/hooks.ts` react-query vs `data/*.ts` 手刻 useState/useEffect + genRef（~6 個 hook 重造 react-query 已有的 race cancellation）。
- Medium：LockPanel/ReopenDialog/ReconDetail 繞過 api 層 inline fetch（三種 error handling 並存）；workspace 導航用 Context if-else 不用已掛的 router（無 deep-link/back/refresh）；無 monorepo tooling（無 workspaces，file: deps 要手動 reinstall）；缺跨 service integration test（v1/v2 skew 正是現有測試抓不到的 bug 類）；`'2026-Q2'` 硬編碼 4 處。
- 澄清：5 services 實為 modular monolith（file: deps + deps/ re-export barrels），切分合理，不需拆併。
- 建議順序：統一 SDK 版本 + adopt workspaces → 收斂到 react-query → 抽 shared contracts + zod。

## AI 工程師（agentic 成色 3/10）

- **F1 High 無 agent 迴路**：兩個 AI 入口（`POST /events/:id/classify`、`/reviews/:eventId/copilot`）都是人工按鈕 one-shot。demo-e2e.ts 有 batch loop 但不在 runtime。
- **F2 High AI 分類是裝飾性**：`buildRuleInput.ts:9` 重新 parse rawJson 用 fixture 欄位；`aiEventType`/`finalEventType` 下游沒人讀。AI 唯一實質效果是 AUTO/NEEDS_REVIEW routing。評審追 data flow 會破功。
- **F3 Med**：LLM 自報 confidence 是 AUTO→POSTED 唯一閘門（routing 交給了 LLM）+ `classify.ts:43` rawJson 直接內插 prompt = prompt injection 可抬 confidence 直達 POSTED。AUTO 應改 deterministic allow-list。
- F4 Med：copilot context 傳 `{}`（沒 CoA/policy/歷史）；suggestedEntry schema 無 properties 且不做借貸平衡驗證。
- F5 Med：spec 宣稱 maker-checker/RBAC，程式碼零 auth（與會計師 H1 同源）。
- F6 Low：geminiClient 兩函式複製貼上。
- **Deadline 前最高 ROI**：① Exception-triage agent——background loop 巡邏 open exceptions、帶完整 context 呼叫 copilot、產 draft disposition proposal、人一鍵 accept 走現成 `applyDisposition`（90% 管線已存在）。② memwal 記憶——decide 後寫「pattern→人工最終分類」、classify 前檢索當 few-shot（hook 點：routes.ts:272 / :240）。

## 建議修復順序（hackathon deadline 導向）

1. **F2 + F1**（賽道生死）：`buildRuleInput` 改吃 `finalEventType`；classify 變 ingestion 後自動 background pass；有餘裕做 exception-triage agent。
2. **C1 + C3**（demo 被追問即穿幫，改動小）：run-rules/decide 加 lock guard、`periodOpen` 動態解析；刪 Suspense fallback。
3. **F3**（安全敘事加分）：AUTO 改 deterministic allow-list。
4. **S2 version gate**（合約已上 testnet，趁早）。
5. **SDK 版本統一 + npm workspaces**（結構性，半天內）。
6. C2/C4/H2（period 歸屬、lot store、snapshot 持久化）= demo→production 分水嶺，hackathon 後做。
