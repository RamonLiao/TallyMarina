# Trial Balance + ASU Roll-forward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** §11.1 Trial Balance + §11.2 ASU roll-forward（compute-on-read）、§14 步驟 5/6 lights real 化、兩支唯讀 API、web `reports` workspace。

**Architecture:** 純函式計算層（`services/api/src/reports/`，新目錄）fold 既有落庫資料（journal_entries / accounts / lot_movement / lot_valuation），零新 table；lock 凍結沿用既有 `lightsSnapshot`；LOCKED 期間 drift fail-loud。權威 spec：`docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md`（7 條裁決必讀）。

**Tech Stack:** TypeScript、Fastify、better-sqlite3、vitest、@tanstack/react-query、Playwright。

## Global Constraints

- 每個 task 開工前先讀 spec：`docs/superpowers/specs/2026-07-13-trial-balance-rollforward-design.md`。
- 金額運算一律 BigInt over minor-unit string（`amountMinor` 是法幣 minor 2dp；禁止 Number/parseFloat）。
- OPENING_LOT 歸 opening 不歸 movement（spec 裁決 1，與 `services/api/src/reconciliation/movement.ts:38-48` 同語意）。
- unknown-class account → fail-closed（closing = null、tie-out FAIL；spec 裁決 5）。
- 改動範圍：`services/api/`、`web/` 兩處；`services/rules-engine`、`services/anchor-svc`、`services/snapshot-svc`、`services/ingestion`、`.move` 零 diff。
- 不得為了讓舊測試通過而削弱 gate（completeness real 化會讓缺重估的期擋 lock——那是 §14 本意，修測試 seed 不修 gate）。
- 每個新守衛/斷言必須 mutation test 先紅一次。
- git 只准 `git add <明確檔名>`，禁止 `-A`/`--all`/`.`。
- root typecheck 用 `npm run typecheck`（不是 `npx tsc --noEmit`）。
- web 金額渲染必經 `fmtMinor`（`web/src/lib/fmtMinor.ts`）；data-surface 禁 mascot；複用 `web/src/components/ui/Table.tsx`，不另建表格。

---

### Task 1: TB 純計算層 `trialBalance.ts`

**Files:**
- Create: `services/api/src/reports/trialBalance.ts`
- Test: `services/api/test/reports.trialBalance.test.ts`

**Interfaces:**
- Consumes: `periodCutoff(periodId)`（`services/api/src/store/pricePointStore.ts:40`，malformed periodId 會 throw）；`journal_entries` join `events`（`journal_entries.event_id REFERENCES events(id)`，OPENING_LOT 判定 = `events.final_event_type = 'OPENING_LOT'`）；`accounts` 表（`name`, `class`）。
- Produces: `buildTrialBalance(db: Db, entityId: string, periodId: string): TrialBalance`；型別 `TbRow`、`TbTieOut`、`TrialBalance`、`AccountClass`（Task 4/6/7/8 依賴）。

- [ ] **Step 1: 寫失敗測試**（核心行為組；helper 直接用既有 `buildTestApp` 拿 `_db`，seed 走既有 ingest+run-rules 流程或直接 INSERT journal_entries/events/accounts——參考 `services/api/test/` 現有測試的 seed 慣例，同一慣例照抄）

```typescript
// services/api/test/reports.trialBalance.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { buildTrialBalance } from '../src/reports/trialBalance.js';

// 直接 INSERT 的最小 seed helper（本檔內私有）：
// insertJe(db, { periodId, eventType, lines: [{account, side, amountMinor}] })
// - INSERT events(id, entity_id, status='POSTED', final_event_type=eventType, period_id, raw_json='{}' ...必填欄照 schema)
// - INSERT journal_entries(id, entity_id, event_id, je_json=JSON.stringify({lines}), period_id, ...)
// - accounts 表由 buildTestApp 的 seed 帶入 ACCOUNT_SEED（DigitalAssets=asset 等）；測試自訂 account 用
//   INSERT INTO accounts(entity_id, name, class, source_section, status) 補列。

describe('buildTrialBalance', () => {
  it('方向推導：五類 class 的 closing 帶號正確', () => {
    // asset 100 Dr → closing +100（借餘）；income 100 Cr → closing +100（貸餘，呈現為正）
    // liability/equity/expense 同理各一筆，逐列斷言 closingMinor 字串
  });
  it('tie-out：平衡 JE 集 → balanced=true，sumSignedClosingMinor="0"', () => {});
  it('跨期 opening：Q2 的 JE 折入 Q3 的 openingMinor，不入 Q3 movement', () => {});
  it('OPENING_LOT 歸 opening：目標期的 OPENING_LOT JE 兩腿都進 opening，Dr/Cr movement 為 0（spec 裁決 1）', () => {});
  it('period > 目標期的 JE 一律不入（含 OPENING_LOT）', () => {});
  it('首期：無前期 JE 時 opening 僅含該期 OPENING_LOT', () => {});
  it('空期：無 JE → rows=[]、balanced=true、sums="0"', () => {});
  it('unknown-class fail-closed：account 不在 accounts 表 → 該列 accountClass=null、closingMinor=null、balanced=false、failures 含 account 名（spec 裁決 5）', () => {});
  it('VOIDED filter：je_json.status="VOIDED" 的 JE 不入任何欄（spec 裁決 7 防禦性）', () => {});
  it('非法 amountMinor（"1.5"、"abc"、""）→ throw（fail-loud，不靜默跳過）', () => {});
});
```

每個 it 都要填實 seed + 斷言（上面註解是 spec，不是 placeholder——實作本步時逐個寫完整）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/reports.trialBalance.test.ts --root services/api`
Expected: FAIL（module not found `../src/reports/trialBalance.js`）

- [ ] **Step 3: 實作**

```typescript
// services/api/src/reports/trialBalance.ts
// DATA ZONE — pure computation over persisted stores. No writes.
import type { Db } from '../store/db.js';
import { periodCutoff } from '../store/pricePointStore.js';

export type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
const DEBIT_NORMAL: ReadonlySet<string> = new Set(['asset', 'expense']);

interface JeLine { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }
interface JeDoc { status?: string; lines: JeLine[] }

export interface TbRow {
  account: string;
  accountClass: AccountClass | null;
  openingMinor: string;        // 帶號，normal-balance 方向（unknown class 時為 debit-positive 原值）
  debitMinor: string;          // period activity（不含 OPENING_LOT）
  creditMinor: string;
  closingMinor: string | null; // unknown class → null（fail-closed，spec 裁決 5）
}
export interface TbTieOut {
  sumDebitMinor: string;
  sumCreditMinor: string;
  sumSignedClosingMinor: string; // debit-positive 空間之 Σclosing，恆須 "0"
  balanced: boolean;             // ΣDr=ΣCr 且 Σclosing=0 且 failures 空
  failures: string[];            // 可判定原因（unknown-class account 名單、不平差額描述）
}
export interface TrialBalance { rows: TbRow[]; tieOut: TbTieOut }

export function buildTrialBalance(db: Db, entityId: string, periodId: string): TrialBalance {
  const targetCutoff = periodCutoff(periodId); // malformed periodId → throw（沿用既有驗證）
  const jeRows = db.prepare(
    `SELECT je.je_json AS jeJson, je.period_id AS periodId, ev.final_event_type AS eventType
       FROM journal_entries je JOIN events ev ON ev.id = je.event_id
      WHERE je.entity_id = ?`,
  ).all(entityId) as { jeJson: string; periodId: string; eventType: string | null }[];

  const classByAccount = new Map<string, AccountClass>();
  for (const a of db.prepare('SELECT name, class FROM accounts WHERE entity_id = ?')
    .all(entityId) as { name: string; class: AccountClass }[]) classByAccount.set(a.name, a.class);

  // 全程 debit-positive 帶號空間累加；呈現時才轉 normal-balance 方向。
  const opening = new Map<string, bigint>();
  const debit = new Map<string, bigint>();
  const credit = new Map<string, bigint>();
  let sumDr = 0n, sumCr = 0n;

  for (const r of jeRows) {
    const cutoff = periodCutoff(r.periodId);
    if (cutoff > targetCutoff) continue;                        // 未來期一律不入（spec §4.1）
    const je = JSON.parse(r.jeJson) as JeDoc;
    if (je.status === 'VOIDED') continue;                       // §11.1 最終狀態呈現（裁決 7）
    const toOpening = cutoff < targetCutoff || r.eventType === 'OPENING_LOT'; // 裁決 1
    for (const l of je.lines) {
      if (!/^\d+$/.test(l.amountMinor)) {
        throw new Error(`trialBalance: invalid amountMinor ${JSON.stringify(l.amountMinor)} on ${l.account}`);
      }
      const amt = BigInt(l.amountMinor);
      const net = l.side === 'DEBIT' ? amt : -amt;
      if (toOpening) opening.set(l.account, (opening.get(l.account) ?? 0n) + net);
      else if (l.side === 'DEBIT') { debit.set(l.account, (debit.get(l.account) ?? 0n) + amt); sumDr += amt; }
      else { credit.set(l.account, (credit.get(l.account) ?? 0n) + amt); sumCr += amt; }
    }
  }

  const accounts = [...new Set([...opening.keys(), ...debit.keys(), ...credit.keys()])]
    .sort((a, b) => a.localeCompare(b));
  const failures: string[] = [];
  let sumSignedClosing = 0n;
  const rows: TbRow[] = accounts.map((account) => {
    const openNet = opening.get(account) ?? 0n;
    const dr = debit.get(account) ?? 0n;
    const cr = credit.get(account) ?? 0n;
    const closeNet = openNet + dr - cr;
    sumSignedClosing += closeNet;
    const cls = classByAccount.get(account) ?? null;
    if (cls === null) {
      failures.push(`unknown account class: ${account}`);
      return { account, accountClass: null, openingMinor: openNet.toString(),
        debitMinor: dr.toString(), creditMinor: cr.toString(), closingMinor: null };
    }
    const sign = DEBIT_NORMAL.has(cls) ? 1n : -1n; // 呈現：credit-normal 轉正
    return { account, accountClass: cls, openingMinor: (openNet * sign).toString(),
      debitMinor: dr.toString(), creditMinor: cr.toString(), closingMinor: (closeNet * sign).toString() };
  });

  if (sumDr !== sumCr) failures.push(`period activity imbalance: Dr ${sumDr} != Cr ${sumCr}`);
  if (sumSignedClosing !== 0n) failures.push(`signed closing sum != 0: ${sumSignedClosing}`);
  return { rows, tieOut: {
    sumDebitMinor: sumDr.toString(), sumCreditMinor: sumCr.toString(),
    sumSignedClosingMinor: sumSignedClosing.toString(),
    balanced: failures.length === 0, failures } };
}
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `npx vitest run test/reports.trialBalance.test.ts --root services/api`
Expected: 10/10 PASS

- [ ] **Step 5: property-based 測試**（同檔追加）

```typescript
it('property：隨機平衡 JE 集 → tie-out 永真；弄壞任一條 → 必紅', () => {
  // 固定 seed 的 PRNG（不用 Math.random 裸呼叫——用 mulberry32(0xTB01) 之類確定性生成）
  // 生成 30 筆 JE：每筆 2-4 lines、隨機 ACCOUNT_SEED 帳戶、隨機金額、最後一 line 補差額配平
  // assert buildTrialBalance(...).tieOut.balanced === true
  // 再挑第 k 筆（k 也由 PRNG 定）把某 line amountMinor +1 重 seed → balanced === false
});
```

- [ ] **Step 6: mutation check（守衛先紅）**

臨時把 `toOpening` 行改成 `const toOpening = cutoff < targetCutoff;`（拿掉 OPENING_LOT 分支）→ 跑測試，OPENING_LOT 兩個測試必須紅；還原。再臨時把 `if (cls === null)` 分支改成 fallback `'asset'` → unknown-class 測試必須紅；還原。兩次結果記在 commit message 或 task report。

- [ ] **Step 7: Commit**

```bash
git add services/api/src/reports/trialBalance.ts services/api/test/reports.trialBalance.test.ts
git commit -m "feat(api): trial balance pure computation with tie-out (spec §11.1, rulings 1/5/7)"
```

---

### Task 2: Roll-forward 恆等式推導（executable derivation，先於實作）

**Files:**
- Create: `services/api/test/reports.rollforward.derivation.test.ts`
- Create: `docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md`

**Interfaces:**
- Consumes: 既有重估測試的 seed 手法（讀 `services/api/test/revaluation.splitAfterRerun.test.ts` 與同族 `revaluation.*.test.ts`——序列 A/rerun/處分 scenario 的建構方式照抄）；`foldValuationStates`（`revaluationStore.ts:196`）、`pnlBuckets`（`:299`）、`lot_valuation` 列語意（`schema.sql:311-334`，`pnl_delta_minor` 註解）。
- Produces: memo 定案的恆等式（Task 3 的實作依 memo，不得自創）。

**為什麼有這個 task**：§11.2 的恆等式「期初+additions−disposals+gains−losses=期末」中，disposals 用 cost 減除還是 carrying 減除、realized reclass 是否雙算，取決於引擎實際 JE/valuation 寫法——這是 `592be8a` 殘差戰役的同族代數，憑推導寫死公式就是重演該事故。本 task 用真 fixture 實跑定案。

- [ ] **Step 1: 寫 derivation 測試（兩個候選公式並列，跑真 scenario 看哪個精確成立）**

```typescript
// services/api/test/reports.rollforward.derivation.test.ts
// 目的：對「取得→重估→部分處分→rerun→再處分」的完整 scenario（照抄
// revaluation.splitAfterRerun.test.ts 的 seed 序列），計算：
//   openingFV(P)  = Σ per-lot fold(live lot_valuation rows, period < P 之 OPENING_FV/REVALUE/…/DISPOSAL_RELEASE)
//                   + Σ cost fold(lot_movement, period < P)（cost 底 + valuation 調整 = carrying）
//   closingFV(P)  = 同式，period <= P
//   additionsCost(P)   = Σ delta_cost_minor > 0 之 lot_movement in P（排除 OPENING_LOT 來源，join je 之 period）
//   disposalsCost(P)   = Σ -delta_cost_minor（<0 列）in P
//   disposalsCarrying(P) = disposalsCost(P) + Σ -pnl... （候選：加上 DISPOSAL_RELEASE 之 delta_minor 釋放）
//   unrealized(P) = Σ delta_minor of live REVALUE/IMPAIR/REVERSE rows in P
//   realizedReclass(P) = Σ -pnl_delta_minor of DISPOSAL_RELEASE rows in P
// 候選 A（disposals at cost）：  closing =? opening + additionsCost − disposalsCost + unrealized + realizedReclass − reclassOffset
// 候選 B（disposals at carrying）：closing =? opening + additionsCost − disposalsCarrying + unrealized
// 斷言：至少一個候選對 scenario 全期間逐期 **精確**成立（BigInt 相等，零殘差）。
// 兩個都成立 → 選呈現上符合 §11.2「disposals 依成本基礎減除」字面的那個。
// 兩個都不成立 → 本 task FAIL，回頭讀引擎（p05/p06 phase 與 DISPOSAL_RELEASE 寫入處）修公式，
//                不得帶殘差進 Task 3。
```

- [ ] **Step 2: 跑測試，記錄哪個候選精確成立**

Run: `npx vitest run test/reports.rollforward.derivation.test.ts --root services/api`
Expected: PASS（至少一候選零殘差）。輸出貼進 memo。

- [ ] **Step 3: 寫 memo 定案**

`docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md`：定案公式（逐項資料源 + SQL/fold 定義）、兩候選實跑結果數字、與 §11.2 表格欄位的對映（若定案是 carrying 減除而 spec 字面是 cost，在 memo 裡寫 spec deviation 並回頭在 design spec Revision log 加一條——留痕，不沉默偏離）。

- [ ] **Step 4: Commit**

```bash
git add services/api/test/reports.rollforward.derivation.test.ts docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md
git commit -m "test(api): roll-forward identity derivation over real revaluation scenario (pins formula for Task 3)"
```

---

### Task 3: `rollForward.ts` 實作

**Files:**
- Create: `services/api/src/reports/rollForward.ts`
- Test: `services/api/test/reports.rollforward.test.ts`

**Interfaces:**
- Consumes: Task 2 memo 定案公式；`getActivePolicy(db, entityId)`（policyStore，回 `{ doc }`，`doc.accountingStandard: 'IFRS' | 'US_GAAP'`、`doc.asu202308Applies: Record<string, boolean>`）；Task 1 的 `buildTrialBalance`（恆等式②）。
- Produces:

```typescript
export interface RollForwardRow {
  coinType: string;
  openingFvMinor: string; additionsMinor: string; disposalsMinor: string;
  gainsMinor: string; lossesMinor: string; closingFvMinor: string;
  identityOk: boolean;   // 恆等式①（逐資產）
}
export interface RollForward {
  notApplicable: boolean; reason: string | null;   // IFRS 軌 → { notApplicable: true, reason: 'IFRS' }
  rows: RollForwardRow[];
  tbTie: { digitalAssetsClosingMinor: string; closingFvTotalMinor: string; ok: boolean } | null; // 恆等式②
  identitiesOk: boolean; // rows 全 identityOk 且 tbTie.ok（notApplicable 時 true）
}
export function buildRollForward(db: Db, entityId: string, periodId: string): RollForward
```

- [ ] **Step 1: 寫失敗測試**

```typescript
// services/api/test/reports.rollforward.test.ts
describe('buildRollForward', () => {
  it('IFRS 軌 → notApplicable=true, reason="IFRS", identitiesOk=true（裁決 6）', () => {});
  it('GAAP FV 軌、完整 scenario（同 Task 2 seed）→ 逐資產恆等式① identityOk=true', () => {});
  it('恆等式②：closingFvTotal == 同期 TB 的 DigitalAssets closingMinor', () => {});
  it('gains/losses 拆列：升值期 gains>0 losses=0；貶值期反之（sign-split）', () => {});
  it('asu_2023_08_applies=false 的 coin 不出列', () => {});
  it('空期（無該類資產活動）→ rows=[]、identitiesOk=true', () => {});
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run test/reports.rollforward.test.ts --root services/api`
Expected: FAIL（module not found）

- [ ] **Step 3: 實作**（照 memo 公式；骨架如下，fold 細節依 memo 的 SQL/fold 定義填實）

```typescript
// services/api/src/reports/rollForward.ts
import type { Db } from '../store/db.js';
import { buildTrialBalance } from './trialBalance.js';
import { getActivePolicy } from '../store/policyStore.js';
// + memo 定案所需之 store imports

export function buildRollForward(db: Db, entityId: string, periodId: string): RollForward {
  const { doc } = getActivePolicy(db, entityId);
  if (doc.accountingStandard !== 'US_GAAP') {
    return { notApplicable: true, reason: doc.accountingStandard, rows: [], tbTie: null, identitiesOk: true };
  }
  const coins = Object.entries(doc.asu202308Applies).filter(([, v]) => v).map(([k]) => k);
  const rows = coins.map((coinType) => computeRow(db, entityId, periodId, coinType)); // memo 公式
  const tb = buildTrialBalance(db, entityId, periodId);
  const da = tb.rows.find((r) => r.account === 'DigitalAssets');
  const closingFvTotal = rows.reduce((s, r) => s + BigInt(r.closingFvMinor), 0n);
  const tbTie = {
    digitalAssetsClosingMinor: da?.closingMinor ?? '0',
    closingFvTotalMinor: closingFvTotal.toString(),
    ok: da?.closingMinor != null && BigInt(da.closingMinor) === closingFvTotal,
  };
  return { notApplicable: false, reason: null, rows, tbTie,
    identitiesOk: rows.every((r) => r.identityOk) && tbTie.ok };
}
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `npx vitest run test/reports.rollforward.test.ts --root services/api`
Expected: 6/6 PASS

- [ ] **Step 5: mutation check**：臨時把 `computeRow` 內 gains 的 fold 少加一類 reason（如漏 IMPAIR）→ 恆等式①測試必紅；臨時把 DigitalAssets 一筆 JE 改 account（seed 側）→ 恆等式②必紅。還原。

- [ ] **Step 6: Commit**

```bash
git add services/api/src/reports/rollForward.ts services/api/test/reports.rollforward.test.ts
git commit -m "feat(api): ASU roll-forward totals with dual identity checks (spec §11.2, memo-pinned formula)"
```

---

### Task 4: je light 升級（TB tie-out）

**Files:**
- Modify: `services/api/src/periodLock/cockpit.ts:38-53`（`jeLight`）
- Test: `services/api/test/`（既有 cockpit 測試檔追加；找 `cockpit` 或 `closeCockpit` 命名的測試檔）

**Interfaces:**
- Consumes: `buildTrialBalance`（Task 1）。
- Produces: `jeLight(db, entityId, periodId): Light`（新增 periodId 參數；`buildCockpit` 內呼叫端同步改）。

- [ ] **Step 1: 寫失敗測試**：seed 一個 unknown-class account 的平衡 JE → cockpit 的 je light 必須紅（現行實作只驗 Dr=Cr 會綠——這就是升級的 mutation 證明）；再 seed 正常資料 → 綠。
- [ ] **Step 2: 跑測試確認失敗**（unknown-class case 目前綠 → 新測試紅）。
- [ ] **Step 3: 實作**：

```typescript
function jeLight(db: Db, entityId: string, periodId: string): Light {
  const jes = listJournal(db, entityId);
  if (jes.length === 0) return { key: 'je', status: 'red', label: 'Journal entries (TB tie-out)', real: true };
  let perJeOk = true;               // §14 步驟 5：個別 JE 平衡與 TB tie-out 二者皆須綠
  for (const r of jes) {
    const je = JSON.parse(r.jeJson) as Je;
    let d = 0n, c = 0n;
    for (const l of je.lines) {
      const amt = BigInt(l.amountMinor);
      if (l.side === 'DEBIT') d += amt; else c += amt;
    }
    if (d !== c) perJeOk = false;
  }
  const tb = buildTrialBalance(db, entityId, periodId);
  const green = perJeOk && tb.tieOut.balanced;
  return { key: 'je', status: green ? 'green' : 'red', label: 'Journal entries (TB tie-out)', real: true };
}
```

`buildCockpit`（cockpit.ts:118）內呼叫改 `jeLight(db, entityId, periodId)`。
- [ ] **Step 4: 跑 api 全測試**：`npx vitest run --root services/api`，Expected: 全綠（既有 cockpit 測試不得紅——若紅，先判斷是測試 seed 缺 CoA 列（補 seed）還是 gate 誤傷（回頭修 Task 1），不得削弱 gate）。
- [ ] **Step 5: Commit**

```bash
git add services/api/src/periodLock/cockpit.ts services/api/test/<改到的測試檔>
git commit -m "feat(api): je light consumes full TB tie-out incl signed-closing and unknown-class fail-closed (spec §14 step 5)"
```

---

### Task 5: completeness light real 化 + N/A 可稽核

**Files:**
- Modify: `services/api/src/periodLock/cockpit.ts`（`Light` 介面 + completeness light、`cockpit.ts:16` 與 `:85` 附近）
- Modify: 受影響的既有 lock/cockpit 測試（seed 補跑重估）
- Test: 既有 cockpit 測試檔追加

**Interfaces:**
- Consumes: `buildRollForward`（Task 3）。
- Produces: `Light` 介面加選填 `note?: string`（`{ key: 'completeness', status, label, real: true, note? }`）；web `LightCard` 已 render 的欄位不變（note 是加欄，Task 8 消費）。

- [ ] **Step 1: 寫失敗測試**：
  - GAAP FV 軌、缺期末重估（scenario 有 asu coin 但該期無 posted 重估 JE）→ completeness 紅（現行 mock 綠 → 新測試紅，這就是 real 化的 mutation 證明）。
  - IFRS 軌 → completeness 綠且 `real: true`、`note: 'N/A — ASU 2023-08 roll-forward does not apply under IFRS'`（裁決 6：可稽核、非假綠）。
  - GAAP FV 軌、重估齊 → 綠。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**：completeness light = `buildRollForward(db, entityId, periodId)` → `notApplicable` → green + note；否則 `identitiesOk` → green/red，`real: true`。`Light` 介面加 `note?: string`。
- [ ] **Step 4: 修受影響測試的 seed（不修 gate）**：跑 `npx vitest run --root services/api`，逐一處理紅掉的既有 lock 測試——GAAP 軌 seed 補「跑重估」步驟（照 revaluation 測試既有 helper），或改用 IFRS 軌 policy（若該測試主張與軌別無關）。每處修法在 commit message 列明。demo seed（`npm run seed:*`）若受影響同步補。
- [ ] **Step 5: 跑 api 全測試**：Expected 全綠，數字回報。
- [ ] **Step 6: Commit**

```bash
git add services/api/src/periodLock/cockpit.ts services/api/test/<改到的檔>
git commit -m "feat(api): completeness light real+blocking via roll-forward identities; IFRS N/A auditable (spec §14 step 6, ruling 6)"
```

---

### Task 6: API endpoints + meta + LOCKED drift

**Files:**
- Modify: `services/api/src/http/routes.ts`（`/close-cockpit` 附近追加兩個 GET）
- Create: `services/api/src/reports/meta.ts`
- Test: `services/api/test/reports.routes.test.ts`

**Interfaces:**
- Consumes: Task 1/3 builders；`getActivePolicy`；period_lock 讀取（先找 `periodLock/store.ts` 既有 read helper——有就用；沒有就 `db.prepare('SELECT status, lights_snapshot FROM period_lock WHERE entity_id = ? AND period_id = ?').get(...)`）。
- Produces:
  - `GET /entities/:id/trial-balance?periodId=` → `{ rows, tieOut, meta, drift }`
  - `GET /entities/:id/roll-forward?periodId=` → `{ ...RollForward, meta }`
  - `meta = { accountingStandard, policySetVersion, periodStatus: 'OPEN'|'LOCKED'|..., generatedAt }`
  - `drift`: `null` | `{ code: 'LIGHTS_SNAPSHOT_DRIFT', frozenJeStatus, recomputedBalanced }`（僅 LOCKED 期間且凍結的 je light status 與現算 `tieOut.balanced` 不一致時；spec 裁決 4）

- [ ] **Step 1: 寫失敗測試**

```typescript
// services/api/test/reports.routes.test.ts
describe('GET /entities/:id/trial-balance', () => {
  it('200：rows + tieOut + meta（standard/policySetVersion/periodStatus/generatedAt 齊）', () => {});
  it('400 PERIOD_ID_REQUIRED：缺 periodId', () => {});
  it('404：unknown entity', () => {});
  it('OPEN 期間 drift=null', () => {});
  it('LOCKED 期間、帳未動 → drift=null', () => {});
  it('LOCKED 後注入一筆使 tie-out 翻紅的 JE（raw INSERT 模擬 lock 後改帳）→ drift.code="LIGHTS_SNAPSHOT_DRIFT"（裁決 4 fail-loud）', () => {});
});
describe('GET /entities/:id/roll-forward', () => {
  it('200：GAAP 軌全形狀', () => {});
  it('200：IFRS 軌 notApplicable', () => {});
  it('400 / 404 同上', () => {});
});
// monkey：periodId="2026-13"、"garbage" → 400 系（periodCutoff throw 要被 route 層轉 ApiError 400 INVALID_PERIOD，不是 500）
it('monkey：非法 periodId → 400 INVALID_PERIOD', () => {});
```

- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**（routes pattern 照 `/close-cockpit`，routes.ts:1099；`parsePeriodId`/`periodCutoff` 的 throw 用 try/catch 轉 `ApiError(400, 'INVALID_PERIOD', ...)`）。
- [ ] **Step 4: 跑測試確認全綠**；mutation：把 drift 比對臨時改恆 null → drift 測試必紅；還原。
- [ ] **Step 5: Commit**

```bash
git add services/api/src/http/routes.ts services/api/src/reports/meta.ts services/api/test/reports.routes.test.ts
git commit -m "feat(api): trial-balance + roll-forward read endpoints with audit meta and LOCKED drift fail-loud (rulings 2/4)"
```

---

### Task 7: 三視圖一致性測試

**Files:**
- Create: `services/api/test/reports.crossview.test.ts`

**Interfaces:**
- Consumes: `buildTrialBalance`、`buildRollForward`、recon 的 computed fold（`reconciliation/collect.ts` 既有函式——讀該檔找 per-coin computed 的輸出點）。

- [ ] **Step 1: 寫測試**：同一 seed（Task 2 的完整 scenario）下斷言三者相等（GAAP FV 軌）：TB `DigitalAssets` closing == roll-forward `closingFvTotalMinor`；recon 的 computed（數量側）與 lot fold 一致性沿既有 recon 測試斷言模式，金額側 tie 到 TB。**注意單位**：recon computed 是代幣 minor（coin dp）、TB 是法幣 minor（2dp）——金額側比對走 lot carrying（法幣），不是數量；測試註解明寫這個單位差（progress.md 既有教訓：同字尾兩種語意）。
- [ ] **Step 2: 跑測試確認綠**；mutation：seed 側把一筆 DigitalAssets JE 挪到別的 account → 必紅；還原。
- [ ] **Step 3: Commit**

```bash
git add services/api/test/reports.crossview.test.ts
git commit -m "test(api): three-view consistency — TB closing == roll-forward FV total, tied to recon fold (spec §14 step 6)"
```

---

### Task 8: Web — API client + `reports` workspace

**Files:**
- Modify: `web/src/api/types.ts`（TB/RF response 型別，照 Task 1/3/6 Produces 逐欄照抄）
- Modify: `web/src/api/endpoints.ts`（`getTrialBalance(entityId, periodId)`、`getRollForward(entityId, periodId)`）
- Modify: `web/src/api/hooks.ts`（`useTrialBalance`、`useRollForward`，照 `useJournal` pattern，hooks.ts:16-41）
- Modify: `web/src/app/workspaces.ts`（加 `{ id: 'reports', label: 'Reports', status: 'ready' }`；`WorkspaceId` union 加 `'reports'`；router/switch 加 case——grep `WorkspaceId` 找所有 switch 點）
- Create: `web/src/workspaces/reports/ReportsWorkspace.tsx`
- Create: `web/src/workspaces/reports/TrialBalanceTable.tsx`
- Create: `web/src/workspaces/reports/RollForwardTable.tsx`
- Test: `web/src/workspaces/reports/ReportsWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 6 endpoints；`Table`（`web/src/components/ui/Table.tsx:26`）；`fmtMinor(minor, decimals)`（`web/src/lib/fmtMinor.ts:3`，法幣欄 decimals=2）。
- Produces: `reports` workspace 頁。

- [ ] **Step 1: 寫失敗 component 測試**（@testing-library/react + vitest，mock hooks）：
  - TB 表 render：opening/Dr/Cr/closing 四欄經 `fmtMinor(…, 2)`、右對齊、`tabular-nums`。
  - tie-out 橫幅：balanced=false → 顯示 failures 每條（unknown account 名、差額）；balanced=true → PASS 樣式。
  - meta 列：standard + policySetVersion + periodStatus 可見。
  - drift 警示：drift 非 null → 醒目警示區塊（aqua 禁用——drift 不是 on-chain 語意；用既有 blocked/danger 語意色）。
  - roll-forward：兩道恆等式各自 PASS/FAIL 行；IFRS → N/A 說明（非顏色線索：文字 + 圖示）。
  - unknown-class 列：closingMinor=null → render `—` 帶 `?` 上標，**不得 default scale/default 0**（§15 條文 1）。
  - data-surface：照 `web/src/test/mascot-governance.test.tsx` 斷言模式，reports 頁禁 mascot。
- [ ] **Step 2: 跑測試確認失敗**：`npx vitest run --root web src/workspaces/reports`。
- [ ] **Step 3: 實作**（Table primitive + token-only styling，禁 hex 字面值；空狀態：無資料期顯示明確 empty state 而非空白）。
- [ ] **Step 4: 跑 web 全測試 + build**：`npx vitest run --root web` 全綠、`npm run build --workspace web` 0 error。
- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/endpoints.ts web/src/api/hooks.ts web/src/app/workspaces.ts web/src/workspaces/reports/ReportsWorkspace.tsx web/src/workspaces/reports/TrialBalanceTable.tsx web/src/workspaces/reports/RollForwardTable.tsx web/src/workspaces/reports/ReportsWorkspace.test.tsx
git commit -m "feat(web): reports workspace — trial balance + roll-forward evidence views (spec §5, §15 rules 1/3/5)"
```

---

### Task 9: Playwright 實點擊 + 全 gates

**Files:**
- 無新檔（或 `web/e2e/` 既有 Playwright 慣例處追加一條 flow——先看 repo 有沒有既存 e2e 檔，有就照慣例，沒有就用 playwright MCP 手動走）

- [ ] **Step 1: 起 dev server + seed demo 資料**，Playwright 實點擊：進 reports workspace → 看 TB 表有數字且 tie-out PASS → 切 roll-forward → 恆等式行 PASS → 切一個無資料期 → empty state 正確。cache-bust/hard-reload 後走（dev-rules UI gate）。
- [ ] **Step 2: 全 gates 實跑並記數字**：
  - `npx vitest run --root services/api` → N/N
  - `npx vitest run --root services/rules-engine`（應 zero diff 仍綠）→ 153/153
  - `npx vitest run --root web` → N/N
  - `npm run typecheck` → 0 error
  - `git diff --stat main@{upstream}` 或範圍檢查：改動只在 `services/api` + `web` + `docs/`；`.move` 零 diff（`sui move test` 不適用，實證揭露）
- [ ] **Step 3: 更新 `tasks/progress.md`**（子專案 4 狀態、gates 數字、backlog 異動）。
- [ ] **Step 4: Commit**

```bash
git add tasks/progress.md <e2e 檔若有>
git commit -m "chore: sub-project 4 gates green — playwright walkthrough + full suite numbers"
```

---

## Review 與收尾（plan 外、流程內）

Task 全完成後依 dev-rules：內部 `reviewer`（opus）→ 修復 → `dual-review` skill 外部 fresh-context 輪（**不給 spec**）→ `verifier` 實跑 → 全部收斂才算完成。UI 改動已含 Playwright gate（Task 9）。非 Move 改動，generic reviewer 可用；不觸發 sui-code-review。

## Red Team 向量（spec §7 照錄，實作時逐條對防禦）

1. unknown account 繞 tie-out → Task 1 fail-closed + mutation。
2. IFRS N/A 誤放行 GAAP entity → Task 5 兩軌測試釘住。
3. lock 後改帳 → Task 6 drift 測試（raw INSERT 模擬）。
4. OPENING_LOT reclass 進出雙算 → Task 1 歸屬測試 + Task 7 一致性。
5. superseded valuation 殘留進期末 FV → Task 2/3 只 fold live 列 + mutation。
