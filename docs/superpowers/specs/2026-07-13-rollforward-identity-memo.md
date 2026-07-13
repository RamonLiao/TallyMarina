# Roll-forward 恆等式定案 memo（Task 2 executable derivation）

日期：2026-07-13
狀態：定案（`services/api/test/reports.rollforward.derivation.test.ts` 實跑，零殘差）
上游：`docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md` §4.2；`docs/specs/accounting-spec-v1.md` §11.2
決定範圍：Task 3 `buildRollForward()` **必須照抄本 memo 的公式**，不得自創。

---

## 0. 一句話定案

**Candidate B — disposals 依「carrying（成本 + 已釋放估值）」減除，gains/losses = 當期未實現重估 delta（含 ASU 轉換 OPENING_FV），realized 處分損益不入資產 roll-forward。** 逐期零殘差。Candidate A（disposals 依成本 + 把 realized reclass 當 gain 加回，spec §4.2 字面）逐期高估（Q2 +10000、Q3 +45000），因為「成本減除」又「加回 reclass」把已釋放的估值算了兩次。

---

## 1. 實跑 scenario（兩期，`reports.rollforward.derivation.test.ts`）

單一 ASU coin = SUI，price scale = 分（qty × price_cents）。

| # | 期 | 動作 | 結果（DA·SUI） |
|---|----|------|----------------|
| 1 | Q2 | OPENING_LOT A：100 SUI，cost 100000 | 100000 |
| 2 | Q2 | 採用 US_GAAP ASU 2023-08 | — |
| 3 | Q2 | 轉換重估 @12.00 → OPENING_FV +20000（seq-0，計 equity） | 120000 |
| 4 | Q2 | 期中重估 @14.00 → REVALUE R1 +20000（計 P&L） | 140000 |
| 5 | Q2 | 部分處分 swp1：50 SUI → DISPOSAL_RELEASE −20000（pnl −10000） | 70000 |
| 6 | Q2 | rerun @16.00 → R1 supersede+reverse，fresh R3 +30000 | **80000** |
| 7 | Q3 | OPENING_LOT B：30 SUI，cost 30000 | 110000 |
| 8 | Q3 | 跨期重估 @20.00 → A REVALUE +20000、B REVALUE +30000 | 160000 |
| 9 | Q3 | 第二次處分 swp2：25 SUI（FIFO 消耗 A）→ DISPOSAL_RELEASE −25000（pnl −20000） | **110000** |

涵蓋 brief 要求全部：取得、期中重估（升值）、部分處分、rerun（supersede）、再處分、跨期（Q2/Q3）、外加新 lot 取得（additions）。

### 落庫的 SUI 列（實 dump，非推導）

`lot_movement`（SUI，帶號 delta_cost）：
- A：+100000（Q2, OPENING_LOT）、−50000（Q2, swp1）、−25000（Q3, swp2）
- B：+30000（Q3, OPENING_LOT）
- （swap 另建 USDC 取得 lot R-DIGSWP-0 / R-DIGSWP2-0，coin=USDC，非 ASU → **coin filter 排除**，不入 SUI roll-forward。）

`lot_valuation` **live**（superseded_by IS NULL，SUI）：
- A OPENING_FV Q2 +20000（seq0，永不 supersede）
- A DISPOSAL_RELEASE Q2 −20000（pnl −10000）
- A REVALUE Q2 +30000（R3；R1 已被 rerun supersede，**不 live，排除**）
- A REVALUE Q3 +20000
- A DISPOSAL_RELEASE Q3 −25000（pnl −20000）
- B REVALUE Q3 +30000

---

## 2. 定案公式（逐項資料源 + fold，Task 3 照抄）

範圍：單一 ASU coin。SUI-scope = `lot_movement.coin_type = coin` 的 lot_id 集合；`lot_valuation` 以該 lot_id 集合過濾。**只讀 live（`superseded_by IS NULL`）估值列**（rerun 後被 supersede 的舊 REVALUE 不入；DISPOSAL_RELEASE 與 seq-0 OPENING_FV 永遠 live）。

期間歸屬 = pure period boundary（**Choice X**）：以 computed `periodCutoff(period_id)` 比較，不做 quarter 字串假設。

```
openingFV(P)  = Σ mv.delta_cost      [cutoff(mv.period) <  cutoff(P)]
              + Σ lv.delta_minor     [cutoff(lv.period) <  cutoff(P), live]
closingFV(P)  = Σ mv.delta_cost      [cutoff(mv.period) <= cutoff(P)]
              + Σ lv.delta_minor     [cutoff(lv.period) <= cutoff(P), live]

additionsCost(P)     = Σ mv.delta_cost   [period == P, delta_cost > 0]     ← 含 OPENING_LOT（見 §Finding 2）
disposalsCost(P)     = −Σ mv.delta_cost  [period == P, delta_cost < 0]
releaseRemoved(P)    = −Σ lv.delta_minor [period == P, reason = DISPOSAL_RELEASE, live]   （正值 = 離場的已釋放 carrying）
disposalsCarrying(P) = disposalsCost(P) + releaseRemoved(P)
gains/losses(P)      = Σ lv.delta_minor  [period == P, reason ∈ {REVALUE,IMPAIR,REVERSE,OPENING_FV}, live]
                       （> 0 呈 gains、< 0 呈 losses；realized 處分損益「不入本表」——見 §3）
```

**恆等式（定案）**：
```
closingFV(P) = openingFV(P) + additionsCost(P) − disposalsCarrying(P) + gains/losses(P)
```
`carrying = cost fold(lot_movement) + valuation fold(lot_valuation live)`；`disposalsCarrying` 對應處分事件把「成本 + 該批已累積估值」一起貸出 DigitalAssets，故資產帳精確平。

### 代數證明（為何是恆等式，非巧合）

`closingFV − openingFV = costDelta(P) + valDeltaLive(P)`，其中
`costDelta(P) = additionsCost − disposalsCost`、`valDeltaLive(P) = Σ live 估值 delta in P（全 reason）`。
拆 `valDeltaLive = gains/losses(P) + Σ release.delta`，而 `Σ release.delta = −releaseRemoved`，代入即得定案式。∴ 對引擎寫出的任何列恆成立——這正是「B 是 roll-forward 律」的證明。

---

## 3. 逐期實跑數字（兩候選並列）

| 項 | Q2 | Q3 |
|---|---:|---:|
| openingFV | 0 | 80000 |
| additionsCost | 100000 | 30000 |
| disposalsCost | 50000 | 25000 |
| releaseRemoved | 20000 | 25000 |
| disposalsCarrying | 70000 | 50000 |
| gains/losses（B, 含 OPENING_FV） | 50000 | 50000 |
| unrealizedA（A, 排除 OPENING_FV） | 30000 | 50000 |
| realizedReclass（= −Σ pnl_delta） | 10000 | 20000 |
| **closingFV（真值 = DA·SUI GL）** | **80000** | **110000** |
| **Candidate B** = open+add−disCarry+gains | **80000 ✓（殘差 0）** | **110000 ✓（殘差 0）** |
| Candidate A = open+add−disCost+unrealizedA+realizedReclass | 90000（**+10000**） | 155000（**+45000**） |

Candidate A 之殘差 = `realizedReclass − openingFvDelta − releaseDelta`（Q2: 10000−20000−(−20000)=10000；Q3: 20000−0−(−25000)=45000）——非任何有意義的會計量，只是把 A 硬湊回 B 所需的補正項。∴ **不存在乾淨的成本基礎公式**，定案 B。

### Mutation（守衛先紅一次，L4）

- 把定案式的 `disposalsCarrying` 換成 `disposalsCost`（錯誤的成本基礎）→ `candidateB(Q2)` 變 100000，斷言 `expect(q2.candidateB).toBe(80000n)` 紅（差 +20000 = 未釋放的 Q2 release）。已實跑驗證後還原綠。
- 恆等式 `B==closing` 兩者皆由 DB 現算，本身是恆真——故測試的「牙齒」在固定錨（closingFV 80000/110000、A 殘差 10000/45000、DA·SUI tie-out、逐項 term 錨）+ 上述公式 mutation，非 `B==closing` 那行。

---

## 4. 與 spec §11.2 / §4.2 欄位對映 + Deviation

| §11.2 欄位 | 本 memo 定案 | 對映 |
|---|---|---|
| 期初 FV | `openingFV(P)` | ✅ 直接 |
| additions | `additionsCost(P)`（含 OPENING_LOT） | ⚠️ Finding 2 |
| disposals | `disposalsCarrying(P)`（**carrying，非 cost**） | ⚠️ **Deviation 1** |
| gains / losses | `gains/losses(P)` = 當期未實現重估 delta（含 OPENING_FV），正負分列 | ⚠️ **Deviation 2** |
| 期末 FV | `closingFV(P)` | ✅ 直接；且 = 同期 DA·SUI GL（恆等式②） |

### Deviation 1 — disposals 依 carrying 減除（spec §4.2 字面為「依成本基礎釋放」）

spec §4.2 寫 disposals =「依成本基礎釋放（§4.1/§4.2）」。實跑證明成本基礎**無法**逐期零殘差：處分事件在 GL 是把「成本 + 已累積估值」整批貸出 DigitalAssets，roll-forward 是資產帳的對帳，disposals 必須帶走 carrying。定案採 carrying。留痕：design spec Revision log 已加一條。

### Deviation 2 — gains/losses = 未實現重估 delta，realized 處分損益不入本表（spec §4.2 寫「pnlBuckets() = realized 處分 + unrealized」）

spec §4.2 把 gains/losses 對映到 `pnlBuckets()`（realized reclass + unrealized）。實跑證明：disposals 已依 carrying 帶走已累積估值後，**realized 處分損益（proceeds − carrying）不觸及 DigitalAssets 餘額**，落在 P&L / DisposalGain（TB 科目），不是資產 roll-forward 的變動行；把它當 gain 加回即 Candidate A 的雙算。故本表 gains/losses 只含未實現重估（含 OPENING_FV 轉換）。realized 損益的呈現與稽核走**恆等式②**（期末 FV = 同期 TB DigitalAssets closing）與 TB 的 UnrealizedGain/DisposalGain 科目，`pnlBuckets()` 仍是 realized/unrealized 拆分的真相源，只是不作為 roll-forward 的 disposals/gains 減加項。

> 註：Deviation 只涉「哪個數進哪一行」與「一次 vs 兩次」；恆等式的**總和**在任何一致分桶下都平。定案 B 是唯一「只讀既有 fold、無補正項、逐期零殘差、且 openingFV(P)=closingFV(P−1) 連續」的形式。

### Finding 2 — OPENING_LOT 必入 additions（brief 註記「排除 OPENING_LOT 來源」在 Choice X 下會漏帳）

brief Step 1 註記 additions「排除 OPENING_LOT 來源」，並把 openingFV 定為 fold(period < P)。二者並用時，採用期（Q2）的 OPENING_LOT 成本落在 opening(<Q2)=0 與 additions（被排除）之外 → 殘差 = OPENING_LOT 成本（本例 100000）。定案採 **Choice X**：純期界 fold，OPENING_LOT 於**其所屬期**計入 additions（採用期呈現上等同「期初 0 + 轉換帶入」）。此選擇保證 `openingFV(P)=closingFV(P−1)` 連續、且 tie 回 GL，並正確處理後期 OPENING_LOT（如再取得 lot B）為當期 addition，而非硬塞入期初。

> 替代 Choice Y（OPENING_LOT / seq-0 OPENING_FV 恆計入其所屬期之後所有期的 opening，貼近 ASU 傳統表首餘額 = 稅前 carrying）**亦逐期零殘差**，但需辨識「採用期 pre-history OPENING_LOT」vs「後期再取得 OPENING_LOT」，脆弱；且 opening(Q2)=120000 破壞 `openingFV(P)=closingFV(P−1)` 連續性（B lot 之 Q3 opening 跳入）。定案不採。Task 3 若日後要 ASU 傳統表首呈現，可在**顯示層**把採用期的 OPENING_LOT+OPENING_FV 標為「transition」子行，但恆等式數學維持 Choice X。

---

## 5. Task 3 實作清單（照抄用）

1. 範圍：`asu_2023_08_applies = true` 之 coin，逐 coin 一列 roll-forward（MVP 總額行）。IFRS 軌 → `{ notApplicable: true, reason: 'IFRS' }`（design 裁決 6）。
2. SUI-scope：`lot_movement.coin_type = coin` → lot_id 集合；`lot_valuation` 以該集合 + `superseded_by IS NULL` 過濾。
3. 期界：computed `periodCutoff(period_id)` 比較（`< P` opening、`<= P` closing、`== P` 當期）。
4. 公式：§2 六個 term + 定案恆等式。gains/losses 依正負分列 gains / losses 兩欄。
5. 恆等式①：`closingFV == openingFV + additionsCost − disposalsCarrying + (gains − losses)`（逐 coin）。
6. 恆等式②：`Σ_coin closingFV == 同期 TB DigitalAssets closing（coin-scoped 加總）`（design §4.2）。tie-out FAIL → completeness light 紅。
7. 金額全程 BigInt，斷言精確相等，零 tolerance。
