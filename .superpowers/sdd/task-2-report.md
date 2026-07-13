# Task 2 Report — Roll-forward 恆等式 executable derivation

Status: DONE（PASS，逐期零殘差）
Commit: 72bbb6f53c6fd19a8c8730b06e3cbe510c225980
Branch: feat/trial-balance-rollforward

## 定案

**Candidate B — disposals 依 carrying（成本 + 已釋放估值）減除，gains/losses = 當期未實現重估 delta（含 OPENING_FV 轉換），realized 處分損益不入資產 roll-forward。** 逐期精確成立（BigInt 相等，零 tolerance）。

恆等式（Task 3 照抄）：
```
closingFV(P) = openingFV(P) + additionsCost(P) − disposalsCarrying(P) + gains/losses(P)
disposalsCarrying(P) = disposalsCost(P) + releaseRemoved(P)   // releaseRemoved = −Σ live DISPOSAL_RELEASE.delta in P
gains/losses(P) = Σ live {REVALUE,IMPAIR,REVERSE,OPENING_FV}.delta in P
openingFV(P)/closingFV(P) = cost fold(lot_movement) + val fold(live lot_valuation), 純期界（<P / <=P, computed periodCutoff）
```

## 實跑 scenario（`services/api/test/reports.rollforward.derivation.test.ts`）

單 ASU coin=SUI，兩期（Q2/Q3），透過真 HTTP 引擎 seed：
取得 lot A(100 SUI cost 100000) → 採用 GAAP → 轉換重估@12(OPENING_FV +20000) → 期中重估@14(R1 +20000) → 部分處分 swp1(50 SUI, release −20000/pnl −10000) → rerun@16(R1 supersede+reverse, R3 +30000) → 跨期取得 lot B(30 SUI cost 30000) → 跨期重估@20(A +20000, B +30000) → 再處分 swp2(25 SUI, release −25000/pnl −20000)。

涵蓋 brief 全部要求：取得 / 期中重估升值 / 部分處分 / rerun(supersede) / 再處分 / 跨期(2 period) + 新 lot additions。

## 數字（實 dump，非推導）

| 項 | Q2 | Q3 |
|---|---:|---:|
| openingFV | 0 | 80000 |
| additionsCost | 100000 | 30000 |
| disposalsCost | 50000 | 25000 |
| disposalsCarrying | 70000 | 50000 |
| gains/losses(B) | 50000 | 50000 |
| **closingFV（真值=DA·SUI GL）** | **80000** | **110000** |
| **Candidate B** | **80000 ✓ 殘差0** | **110000 ✓ 殘差0** |
| candidateAMissingReclass（strawman：漏 reclassOffset 的錯誤版本，非 brief 的 Candidate A） | 90000（**+10000**） | 155000（**+45000**） |
| **candidateAWithReclass（coherent 成本基礎，= B 恆等重組）** | **80000 ✓ 殘差0** | **110000 ✓ 殘差0** |

更正（re-review C-1）：coherent 成本基礎公式（`openingFV + additionsCost − disposalsCost + gainsB − releaseRemoved`）存在且逐期精確，與 B 恆等（`disposalsCarrying = disposalsCost + releaseRemoved`）。定案 B 是呈現層/欄位配置決策（§11.2 六欄無 reclass 欄，releaseRemoved 折進 disposals 最不失真），使用者 2026-07-13 裁決採 B。

## Deviations（memo 詳述 + design spec Revision log v1.1 留痕）

1. **disposals 依 carrying 呈現（呈現層裁決，非代數必然）**：coherent 成本基礎公式亦零殘差且與 B 恆等；選 carrying 是因 §11.2 六欄無 reclass 欄，releaseRemoved 折進 disposals 最不失真（塞 losses 會把已認列估值移轉誤呈為虧損）。使用者 2026-07-13 裁決採 B。
2. **gains/losses = 未實現重估 delta，realized 處分損益不入本表**：disposals 依 carrying 帶走已累積估值後，realized(proceeds−carrying) 不觸及 DigitalAssets 餘額（落 P&L/TB），加回即雙算（strawman 的殘差來源之一）。realized 走恆等式②(期末FV=同期 TB DigitalAssets) 與 TB 科目稽核；pnlBuckets 仍是 realized/unrealized 拆分真相源，只是不作 roll-forward 加減項。
3. **Finding 2 — OPENING_LOT 必入 additions**（brief 註「排除 OPENING_LOT」在 Choice X 下漏帳 = OPENING_LOT 成本）：定案純期界 Choice X，OPENING_LOT 於其所屬期計入 additions，保 openingFV(P)=closingFV(P−1) 連續 + tie GL + 正確處理後期再取得。替代 Choice Y 亦零殘差但脆弱且破連續性，不採。

## Self-review（mutation，L4）

公式 mutation：定案式 `disposalsCarrying`→`disposalsCost` → `candidateB(Q2)` 變 100000，`expect(...).toBe(80000n)` 紅（差 +20000 = 未釋放 Q2 release）。實跑驗證後還原綠。恆等式 `B==closing` 兩者皆 DB 現算屬恆真——測試牙齒在固定錨（80000/110000、A 殘差 10000/45000、DA tie-out、逐項 term 錨）+ 公式 mutation，非 `B==closing` 那行。

## Verification
- `npx vitest run test/reports.rollforward.derivation.test.ts`：1/1 passed。
- `npx tsc --noEmit`（services/api）：0 error。
- 零 src/ diff（僅新增 1 test + 1 memo，append design spec Revision log 1 行）。

## Concerns / 移交 Task 3
- 本 derivation 為單 coin。多 coin 逐 coin 一列 + 恆等式② Σ tie TB，Task 3 需按 memo §5 清單實作並補多 coin 測試。
- gains/losses 正負分列（gains>0 / losses<0）為顯示層拆分，恆等式用淨額；Task 3 顯示時分兩欄。
- 若日後要 ASU 傳統表首餘額(=稅前 carrying) 呈現，走顯示層 transition 子行，恆等式數學維持 Choice X（勿改 fold）。

## Files
- services/api/test/reports.rollforward.derivation.test.ts
- docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md
- docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md（Revision log v1.1）

## Fix wave 1（review findings C-1 / I-1 / I-2）

**C-1 修復**：舊 `candidateA`（測試中原本自稱 Candidate A）其實漏了 brief 指定的 `− reclassOffset(releaseRemoved)` 項，是 strawman。已於測試中新增 `candidateAWithReclass`：
```
closingFV = openingFV + additionsCost − disposalsCost + gainsB − releaseRemoved
```
逐期驗證：Q2 = 0+100000−50000+50000−20000 = 80000；Q3 = 80000+30000−25000+50000−25000 = 110000。與定案 Candidate B（`openingFV+additionsCost−disposalsCarrying+gainsB`，因 `disposalsCarrying=disposalsCost+releaseRemoved` 恆等）代數上是同一恆等式的不同分組，非互斥候選。舊變數改名 `candidateAMissingReclass` 並在 interface/註解標明為「漏 reclassOffset 的錯誤版本示範」，不再自稱 Candidate A。

**I-1/I-2 修復（memo + design doc）**：`docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md` §0/§3/§4（Deviation 1/2 + 註）與 `docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md` Revision log v1.1 皆已改寫，刪除「成本基礎公式無法零殘差 / 不存在乾淨成本基礎公式」的錯誤陳述。正確論證：Candidate B 與 Candidate A-with-reclass 恆等、皆零殘差；定案採 B 是**呈現層 / 欄位配置**決策（§11.2 固定六欄無 reclass 欄，releaseRemoved 折入 disposals 最不失真，塞進 losses 會把已認列估值移轉誤呈為虧損），並註明**使用者已於 2026-07-13 裁決採 B**。Task 3 依 memo §5 實作 B 的結論不變。

### 驗收證據

1. `npx vitest run test/reports.rollforward.derivation.test.ts --root services/api` → **1/1 passed**（Test Files 1 passed, Tests 1 passed）。
2. Mutation：把 `candidateAWithReclass` 的 `− releaseRemoved` 臨時刪掉 → 紅：`expected 100000n to be 80000n`（Q2 差 +20000，即未 net 的 releaseRemoved）。還原後重跑 → 1/1 passed 綠。
3. `grep -n "無法.*零殘差\|公式無法\|不可能\|不存在乾淨" docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md` → 無匹配（exit 1）。

### Files touched (wave 1)
- services/api/test/reports.rollforward.derivation.test.ts（新增 candidateAWithReclass 欄位/斷言，strawman 改名 candidateAMissingReclass，頂部 doc comment 改寫）
- docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md（§0/§3/§4 改寫）
- docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md（Revision log v1.1 改寫）
- .superpowers/sdd/task-2-report.md（本節）
