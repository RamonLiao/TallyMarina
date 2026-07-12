# SUI 架構審查 — 期末重估雙軌設計 spec

**被審**：`docs/superpowers/specs/2026-07-12-remeasurement-dual-track-design.md`
**審查員**：sui-architect skill + 全端/鏈上完整性維度
**日期**：2026-07-12
**結論**：ON-TRACK（無 P1 偷渡、無 MVP 硬需求漏掉）。核心設計方向正確，鏈上完整性層零 .move 改動宣稱**成立**。但 §5 schema 與 D8/§4.4/§6 的行為描述之間有數個**內部不一致**（決定性/idempotency/staleness 的儲存欄位缺失），須修訂 spec 後才可實作。

計數：**blocker 1 / should-fix 5 / nit 3**

---

## 已驗證為正確（非 finding，但關鍵，先講）

- **鏈上完整性零破壞**：snapshot/merkle/anchor 皆 **period-scoped**（`snapshotStore.ts:5,16,42`、`anchorStaleness.ts:20,25`）。merkle leaf 前像不含 period_id（`leafCodec encodeJeLeaf`），root 由「該 period 全部 JE 依 idempotencyKey 字典序」決定（`merkle.ts:103-121`）。重估 JE 只要帶對 period_id 走 journalStore，就**只改當期 root**，不動其他期已 anchored 的 4 個 root。合約 hash-only、cap-based，重估**零 .move 改動宣稱成立**。
- **重估為 pre-lock（§14 步驟 4，早於步驟 7 lock / 8 anchor）**：當期尚無 anchor 可被弄髒；post-anchor 重估 = reopen，spec Non-Goals 已明確排除。run 對 LOCKED period 回 400 `PERIOD_CLOSED`（spec §6）守衛存在。**re-anchor / stale-anchor 語意本案不觸發**，`deriveAnchorStaleness` 的 root-recompute 機制（`anchorStaleness.ts:19-39`）與本案相容。
- **append-only/supersede 相容**：journalStore（scout 確認）與 `lotMovementStore.ts:12-46` 同款 `INSERT OR IGNORE` + payload 比對 + ledger-corruption fail-loud。D6「反向沖銷 + 新 JE」、valuation supersede 與此守衛相容——**前提是每筆 JE 的 idempotency key 決定性且不撞既有事件 JE**（見 should-fix 2/3）。
- **FIFO 零改動宣稱成立**：`lot_valuation` 為獨立新表，`foldRemainingLots`（`lotMovementStore.ts:57-78`）只讀 `lot_movement`，不被觸及。
- **對軌**：business-spec MVP 邊界（scout 確認）— oracle 自動拉價 P1、IAS 38 revaluation model(§5.3) P1、WAC P1、restatement/reopen deferred、TB=子專案4、export=子專案5。spec 的 Goals/Non-Goals **逐項對得上**，無 P1 偷渡。

---

## BLOCKER

### B1 — `priceSetHash` 無任何持久化欄位，但 D8 staleness 燈與 run idempotency key 都依賴它
- **位置**：spec §5 schema（行 70-89）vs D8（行 40）、§6 run idempotency（行 96）、§6 cockpit DTO 綠/黃判定（行 98）。
- **問題**：D8/§6 要求「run 記錄當時價格集 hash」，且燈的綠/黃靠「run 的 priceSetHash == 現價格集 hash」比對；idempotency key 也含 priceSetHash。但 §5 只有 `price_points` 與 `lot_valuation` 兩表，**兩者皆無 priceSetHash 欄位**，也無 run-header 表。JE 記錄（scout 確認）帶 period_id/policy_set_version 但**無 priceSetHash**。
- **失敗情境**：實作者依 §5 建表後，run 完無處存 priceSetHash → staleness 燈永遠無法判斷「run 後價格是否變動」（D8 的核心防禦失效，run 後補價會被靜默漏掉，正是 spec 想擋的攻擊向量 Red Team #2）；且 idempotency key 引用一個未落庫的值 → 無法在重放時重建同一 key。
- **修法**：spec 須新增 `revaluation_run`（或等價）表，至少存 `(entity_id, period_id, basis, price_set_hash, supersede_seq, je_id/reversal_je_id, policy_set_version, created_at)`，或在 `lot_valuation` 增 `price_set_hash` 欄。這是 schema 與行為描述的硬矛盾，**照現狀無法實作**。

---

## SHOULD-FIX

### S1 — ASU 過渡 `seq-0` 判定所需的 seq/discriminator 欄位不存在
- **位置**：spec §4.4（行 64-65）、§5 lot_valuation（行 80-88，註解行 88）。
- **問題**：§4.4 冪等「以 seq-0 記錄存在與否判定」「opening_fv = 該 lot 的 seq-0 列」，但 `lot_valuation` schema **無 seq 欄**，只有 `superseded_by` 指標。「第 0 筆」在無序或以 `created_at` tie 時無決定性定義。
- **失敗情境**：同一 lot 若同秒寫入多列（過渡 JE + 首次重估同 transaction），無 seq 欄則「seq-0」不可辨識 → 過渡冪等判定不穩，二次 Run 可能重出過渡 JE（違反行 65 冪等要求）或漏認 opening_fv。
- **修法**：`lot_valuation` 增顯式 `seq`（或 `is_opening` bool + `basis`）欄，過渡列固定 seq=0；冪等以 `(entity, lot, basis, seq=0)` 存在性判定。

### S2 — `supersedeSeq` 來源/儲存未定義，卻是 run idempotency key 的一部分
- **位置**：spec §6 run（行 96）、Red Team #3（行 118）。
- **問題**：idempotency key 含 `supersedeSeq`，但無欄位存放重跑序號（`lot_valuation` 只有 `superseded_by` 指標，非單調計數）。未定義它是「該 (entity,period) 既有 supersede 列數」還是別的。
- **失敗情境**：連點/重放時若 supersedeSeq 由 client 或非決定性來源給定 → 同一次重跑可能產生兩把不同 key → 兩次都 insert（非 duplicate）→ 雙重反向沖銷 + 雙重新 JE，當期 root 被灌入重複帳。反之若定義不清，正常重跑可能撞既有 key 被 ledger-corruption 誤擋。
- **修法**：明定 supersedeSeq = server 端 `COUNT(superseded rows for (entity,period,basis))`，於 run transaction 內單調取得；反向沖銷 JE 的 idempotency key 亦須決定性（建議 = f(被沖銷 valuation 的 je_id)），spec 目前完全未定義反向 JE 的 key 推導。

### S3 — `priceSetHash` 的輸入域未定義 → 跨 period 價格汙染風險
- **位置**：spec D8（行 40）、D7 price_points entity-scoped（行 39）。
- **問題**：priceSetHash 要 hash「當時價格集」，但未定義集合邊界。price_points 是 entity-scoped，若 hash 涵蓋 entity 全部 price_points（含其他 period 的 as_of），則為 period N+1 補價會改變 hash → period N 的 run 被**誤判 stale**；反之若集合定義過窄漏掉某資產的價，該資產缺價/改價會被靜默略過。
- **失敗情境**：多 period 並行結帳時，任一 period 補價使其他 period 的重估燈全部轉黃，逼無謂重跑；或跨 period 舊價被納入 hash 稀釋當期變動偵測。
- **修法**：明定 priceSetHash 輸入 = **恰好本次 run 消費的 PricePoint 集合**（該 period cut-off as_of §6.4、該 entity、run 涵蓋的 coin 集合），排序後 hash。與 §6.4 cut-off 綁定。

### S4 — §4.4.1 負 gas 走事件時管線，但事件時取價路徑（buildRuleInput）仍硬編 price='100'，fail-closed 未接
- **位置**：spec §4.3（行 56-59，宣稱「缺價 fail-closed，同重估」）、D9（行 41）；現況 `services/api/src/http/buildRuleInput.ts:35-38`（`unitPriceMinor:'100'` 硬編、`asOfDate` 取 eventTime、`assetAssessment` 硬編 IAS38_COST）。
- **問題**：spec 把負 gas 明列「事件時規則，非期末管線」，D9 只說「gas 費用餘額組進 RuleInput」，但**沒說事件時的 FV 取價要從新 `price_points` 表查、缺價要 fail-closed**。buildRuleInput 目前對所有事件 JE 餵假價 100 且不 fail-closed。負 gas 新 lot basis = 取得日 FV（§4.4.1）在此路徑無法達成 spec 宣稱的「缺價 fail-closed」。
- **失敗情境**：負 gas 事件在缺價時仍以假價 100 建 lot → 汙染後續所有處分損益，正是 §6.3「嚴禁以 0 或前期價默認出帳」要擋的。而 spec §10 的 diff 清單（行 130）只列「rules-engine 有 diff 是預期」，未列 buildRuleInput/事件取價 switchover → 這條 MVP 硬需求的整合被漏描述。
- **修法**：spec 明列「事件時取價由 price_points 供給 + 缺價 fail-closed」屬本案範圍，並在編排/diff 清單納入 buildRuleInput 改動；或明確把負 gas 事件取價切出本案（但那會使 §4.4.1 Goal 無法交付，不建議）。

### S5 — 重估「真燈」與 §14 上游把 pricing light 定為 mock、缺價走 exceptions.blocking 的機制重疊，雙閘門權威未釐清
- **位置**：spec D1/§6（行 33、98「lock gate 吃這盞燈」）vs 上游 accounting-spec §14（行 740、755，pricing light MVP 為 mock 指示層、缺價經 `PRICE_MISSING` blocking exception 併入步驟 2 `exceptions.blocking`）；現況 `cockpit.ts:96`（`MOCK('pricing')`）、`cockpit.ts:27-30`（classificationLight 已把 blocking exception 計入）、`cockpit.ts:107`（`closeable` 排除 mock 燈）。
- **問題**：§14 權威把缺價 blocking 走 **exceptions 通道**、pricing light 維持 mock；設計 spec 改成 pricing/revaluation **真燈**直接餵 lock gate。這是對 §14 光號模型的**顯式偏離**（D1 有寫「取代 mock pricing light」，非沉默偏離，值得肯定），但兩套 blocking 機制並存會出現：光號綠但 exceptions 仍擋、或光號黃但 exceptions=0 放行的**不一致視窗**。且 `LightStatus` 現為 `'green'|'red'|'mock'`，新增「黃(stale)」會動到 union 型別與前端 `dispatchTarget` 消費端（`cockpit.ts:14-15` 及前端 routing），spec §7 只提「燈色」未點出此連鎖。
- **失敗情境**：實作者把重估燈做成 `mock`（沿用 pricing 位）→ 被 `closeable` 的 `filter(status!=='mock')` 排除 → 缺價竟可 lock；或黃燈未設 `real:true` → 同樣被排除。§14 的 exceptions 通道與新真燈對同一缺價重複判定，維護時易分岔。
- **修法**：spec 明定 (a) 重估燈 `real:true`、黃燈於 `closeable` 視為非綠擋關；(b) 缺價的**單一權威**是哪條（建議：仍以 §14 `PRICE_MISSING` exception 為 blocking 事實來源，重估燈只是其 UI 投影，避免雙來源）；(c) 記錄這是對 §14「pricing light MVP=mock」的修訂（dev-rules：偏離須修訂 spec 留痕）。

---

## NIT

### N1 — 重估 JE 必須帶 period_id 才會進當期 merkle/anchor
- jeLight/completenessLight 是 entity-scoped（`cockpit.ts:34-36` 註解：JE 無 period_id），但 merkle/anchor 是 period-scoped（`anchorStaleness.ts:25` 用 `listJournal(db,entity,periodId)`）。重估 JE 若漏帶 period_id → 不進當期 root → 不被 anchor、staleness 偵測不到。spec §6 編排未顯式點名「重估 JE 寫入時帶 periodId」。建議編排步驟明列。

### N2 — 負 gas（§4.4.1）本質事件時，塞進「期末重估」子專案是範圍聚合而非純期末
- §4.3 自認「事件時規則，非期末管線」。與期末重估同包的理由是**共用 pricing 基礎設施**（合理），且 §4.4.1 是 MVP 硬需求（accounting-spec 標 MVP），故**不算偏軌**。但實作/測試分界要清楚（事件路徑 vs run 路徑），避免 verifier 誤以為負 gas 走 run。純提醒。

### N3 — 重估 JE 的 idempotency key 不得與事件 JE 撞號
- 同一 period 的 merkle 混合事件 JE 與重估 JE，皆依 idempotencyKey 字典序排。重估 key（含 entity/period/priceSetHash/supersedeSeq）須與事件 JE key 命名空間隔離（建議加固定 prefix 如 `reval:`），否則理論上撞號會觸發 journalStore 的 ledger-corruption fail-loud。低風險，建議明訂前綴。

---

## 對軌檢查結論：ON-TRACK

business-spec 重對準拆包「1. PolicySet+CoA ✅ → 3. 本案 → 4. TB → 5. export」對得上；本案 in-scope（雙軌重估/減損、手動 pricing、§4.4.1 負 gas、§7.3 ASU 過渡、cockpit 重估閘）皆為 MVP 硬需求，out-of-scope（oracle 自動、§5.3 revaluation model、WAC 執行、restatement/reopen、TB 報表）皆對應 business-spec 的 P1/deferred 或後續子專案。**無 P1 偷渡、無 MVP 硬需求漏列**。子專案編號 1→3 跳過 2（推測為既完成的 lot_movement/FIFO ledger 子專案），非缺漏。

（註：S5 是對上游 §14 光號模型的**顯式**修訂，spec 已寫明取代 mock pricing light，屬「先修訂 spec」路線而非沉默偏離；仍建議把權威來源釘死以免雙閘門分岔。）
