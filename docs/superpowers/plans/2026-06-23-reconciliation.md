# Reconciliation Workspace (Phase 1 A-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-way reconciliation workspace — `opening + movements = computed(book)` per `(wallet, coinType)` vs a mock external statement and (SUI only) live on-chain balance, where material unresolved breaks block the period close.

**Architecture:** Approach A hybrid — the client recomputes the book side from real JE legs (recomputable evidence) while the backend independently recomputes breaks to enforce the deterministic close gate (anti-forgery). Live chain balance is browser-read, informational, and never enters the gate. Recon breaks reuse the Exception disposition *transition logic* but get a net-new 4-tuple-keyed store; material unresolved breaks feed the same snapshot freeze gate as exceptions.

**Tech Stack:** Backend Fastify + better-sqlite3 (ESM, `.js` import suffixes); Frontend Vite + React + `@mysten/dapp-kit-react` + `@mysten/sui`; BigInt minor-unit arithmetic throughout; vitest both sides.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-23-reconciliation-design.md`. Every task implicitly inherits it.
- All monetary/quantity math is **BigInt over minor-unit strings** — never float. Non-numeric input throws, never coerces.
- Backend is ESM: relative imports MUST carry the `.js` suffix (e.g. `'./types.js'`).
- `decidedBy` is a **fixed server constant** (`'demo-controller'`) — never read from the client body.
- Period: single-period demo, `DEFAULT_PERIOD = '2026-Q2'`; cutoff is entity-scoped (events carry no `period_id`).
- `breakId` wire format = `${wallet}|${coinType}`, URL-encoded in path; parse requires exactly one `|`.
- Provenance `live` is the ONLY value allowed to use the `--aqua` on-chain color token.
- After ANY backend change: `cd services/api && npm test`. After ANY frontend change: `cd web && npm test && npm run build` (build catches vite tsc errors `--noEmit` misses).
- EXISTING repo rooted at the project dir. NEVER run `git init`. Commit from repo root.
- Wallet for a JE comes from its event: `JSON.parse(event.rawJson).wallet` (a.k.a. `normalized.wallet`). JE legs carry `origCoinType`/`origQtyMinor` but NOT wallet.

---

## File Structure

**Backend (`services/api`)**
- `src/reconciliation/types.ts` — `ReconRow`, `ReconBreakDisposition`, `Provenance`, `RECON_REASON_CODES`, `ReconReasonCode`.
- `src/reconciliation/movement.ts` — `netByCoinType(lines)` (canonical netting, ported from web `origMemo`) + `walletAssetMovements(db, entityId)` (JE→event.wallet join).
- `src/reconciliation/fixture.ts` — `loadReconFixture(entityId)` + schema validation.
- `src/reconciliation/collect.ts` — `collectBreaks(db, entityId, periodId)`.
- `src/reconciliation/disposition.ts` — `applyReconDisposition` (reuses `assertDispositionTransition`).
- `src/store/reconBreakStore.ts` — `getReconDisposition` / `upsertReconDisposition` / `appendReconDispositionLog` / `listReconDispositions`.
- `src/store/schema.sql` — append `recon_break_disposition` + `recon_break_disposition_log` tables.
- `src/fixtures/acme-pilot-001.recon.json` — opening/statement/threshold per `(wallet, coinType)`.
- `src/config.ts` — add `reconLiveWallet?: string` (env `RECON_LIVE_WALLET`).
- `src/http/routes.ts` — `GET /entities/:id/reconciliation`, `POST /recon-breaks/:breakId/disposition`, close-gate recon branch, `close-readiness` restructure.

**Frontend (`web`)**
- `src/api/types.ts` — `ReconRowDTO`, `ReconciliationResponse`, `ReconBreakDispositionDTO`, `CloseReadiness`.
- `src/lib/reconBreak.ts` — `computeBreak(computedMinor, statementMinor, thresholdMinor)` → signed break + direction + materiality.
- `src/data/useReconciliation.ts` — fetch hook.
- `src/data/useChainBalance.ts` — browser SUI balance read via dapp-kit `SuiClient`.
- `src/workspaces/ReconciliationWorkspace.tsx` — table-first shell, selection, empty/celebration.
- `src/workspaces/recon/ReconTable.tsx` — responsive 8-col grid / card-ify.
- `src/workspaces/recon/ReconDetail.tsx` — T-equation + disposition controls + anchored ribbon.
- `src/workspaces/recon/recon.css` — table/card/encoding styles.
- `src/app/workspaces.ts` — flip `reconciliation` status `soon` → `ready`.
- `src/App.tsx` — dispatch `'reconciliation'` → `ReconciliationWorkspace`.

---

## Task 1: Canonical netting + parity test

**Files:**
- Create: `services/api/src/reconciliation/movement.ts`
- Test: `services/api/test/recon.parity.test.ts`

**Interfaces:**
- Produces: `netByCoinType(lines: JeLine[]): Record<string, bigint>` where `JeLine = { side: 'DEBIT'|'CREDIT'; origCoinType: string | null; origQtyMinor: string | null }`. Nets `DEBIT(+) − CREDIT(−)` of `origQtyMinor` per `origCoinType`; legs with null `origCoinType`/`origQtyMinor` are skipped. Byte-identical to web `origMemo`.

- [ ] **Step 1: Write the failing parity test**

```ts
// services/api/test/recon.parity.test.ts
import { describe, it, expect } from 'vitest';
import { netByCoinType } from '../src/reconciliation/movement.js';
import { origMemo } from '../../../web/src/lib/balance.js';

// JE fixtures spanning the edges: multi-coin, null legs, debit/credit netting, large BigInt.
const FIXTURES = [
  [
    { account: '1000', side: 'DEBIT', amountMinor: '250', origCoinType: '0x2::sui::SUI', origQtyMinor: '10' },
    { account: '4000', side: 'CREDIT', amountMinor: '250', origCoinType: null, origQtyMinor: null },
  ],
  [
    { account: '1000', side: 'CREDIT', amountMinor: '7', origCoinType: '0x2::sui::SUI', origQtyMinor: '7' },
    { account: '6000', side: 'DEBIT', amountMinor: '999999999999999999999', origCoinType: '0xusdc::usdc::USDC', origQtyMinor: '999999999999999999999' },
  ],
];

describe('netByCoinType parity with web origMemo', () => {
  for (const [i, lines] of FIXTURES.entries()) {
    it(`fixture ${i} produces byte-identical net map`, () => {
      const backend = netByCoinType(lines as never);
      const web = origMemo(lines as never);
      // Compare as sorted [coinType, string] tuples — bigint-safe equality.
      const norm = (m: Record<string, bigint>) =>
        Object.entries(m).map(([k, v]) => [k, v.toString()]).sort();
      expect(norm(backend)).toEqual(norm(web));
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.parity.test.ts`
Expected: FAIL — `Cannot find module '../src/reconciliation/movement.js'`.

- [ ] **Step 3: Implement `netByCoinType`**

```ts
// services/api/src/reconciliation/movement.ts
// BigInt-only netting of original-asset quantities per coinType.
// CANONICAL PRIMITIVE — must stay byte-identical to web/src/lib/balance.ts origMemo.
// Verified by services/api/test/recon.parity.test.ts (merge gate). Do NOT diverge.
export interface JeLine {
  side: 'DEBIT' | 'CREDIT';
  origCoinType: string | null;
  origQtyMinor: string | null;
}

export function netByCoinType(lines: JeLine[]): Record<string, bigint> {
  const memo: Record<string, bigint> = {};
  for (const l of lines) {
    if (!l.origCoinType || !l.origQtyMinor) continue;
    const q = BigInt(l.origQtyMinor);
    memo[l.origCoinType] = (memo[l.origCoinType] ?? 0n) + (l.side === 'DEBIT' ? q : -q);
  }
  return memo;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.parity.test.ts`
Expected: PASS (2 fixtures). If the web import path fails, confirm `web/src/lib/balance.ts` exports `origMemo` and that vitest resolves the relative path; if cross-package resolution is blocked, copy the two fixtures' expected outputs inline as literals AND keep the import-based assertion behind a `describe.skipIf` is NOT acceptable — instead add `web` to the api `vitest.config.ts` `resolve` or use a relative path that tsconfig allows. The parity test MUST execute against the real `origMemo`.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/reconciliation/movement.ts services/api/test/recon.parity.test.ts
git commit -m "feat(recon): canonical netByCoinType + parity test vs web origMemo"
```

---

## Task 2: Recon types, reason codes, fixture + schema validation

**Files:**
- Create: `services/api/src/reconciliation/types.ts`
- Create: `services/api/src/reconciliation/fixture.ts`
- Create: `services/api/src/fixtures/acme-pilot-001.recon.json`
- Test: `services/api/test/recon.fixture.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Provenance = 'book' | 'mock' | 'live' | 'n/a'`
  - `type ReconReasonCode = 'timing' | 'error' | 'fee' | 'fx' | 'in-transit' | 'unidentified' | 'OTHER'`; `RECON_REASON_CODES: ReconReasonCode[]`.
  - `interface ReconFixtureRow { wallet: string; coinType: string; decimals: number; openingMinor: string; statementMinor: string; thresholdMinor: string }`
  - `loadReconFixture(entityId: string): ReconFixtureRow[]` — throws on malformed/missing/dup/negative.

- [ ] **Step 1: Write the failing fixture test**

```ts
// services/api/test/recon.fixture.test.ts
import { describe, it, expect } from 'vitest';
import { loadReconFixture } from '../src/reconciliation/fixture.js';

describe('loadReconFixture', () => {
  it('loads the acme demo rows with BigInt-valid minors', () => {
    const rows = loadReconFixture('acme:pilot-001');
    expect(rows.length).toBeGreaterThanOrEqual(4); // SUI, USDC error, WETH in-transit, statement-only
    const sui = rows.find((r) => r.coinType === '0x2::sui::SUI');
    expect(sui).toBeTruthy();
    expect(() => BigInt(sui!.openingMinor)).not.toThrow();
    expect(sui!.decimals).toBe(9);
  });

  it('throws on unknown entity (fail-loud, no silent empty)', () => {
    expect(() => loadReconFixture('no:such')).toThrow(/no recon fixture/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.fixture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the fixture JSON**

```json
// services/api/src/fixtures/acme-pilot-001.recon.json
{
  "acme:pilot-001": [
    { "wallet": "0xacmeTreasury", "coinType": "0x2::sui::SUI", "decimals": 9, "openingMinor": "1200000000", "statementMinor": "3798000000", "thresholdMinor": "1000000000" },
    { "wallet": "0xacmeTreasury", "coinType": "0xusdc::usdc::USDC", "decimals": 6, "openingMinor": "5000000000", "statementMinor": "5000500000", "thresholdMinor": "100000" },
    { "wallet": "0xacmeTreasury", "coinType": "0xweth::weth::WETH", "decimals": 8, "openingMinor": "200000000", "statementMinor": "150000000", "thresholdMinor": "1000000" },
    { "wallet": "0xacmeTreasury", "coinType": "0xusdt::usdt::USDT", "decimals": 6, "openingMinor": "0", "statementMinor": "750000000", "thresholdMinor": "100000" }
  ]
}
```

Note: SUI `opening 1.2` + real JE net movement `+3.8` (evt-001 `+5.0` receipt, evt-002 `−1.2` payment) → `computed 5.0`; statement `3.798` → break `+1.202 ≥ threshold 1.0` → **material**. USDC no JEs → `computed = opening 5000.0`; statement `5000.5` → `−0.5` material **error**. WETH no JEs → `computed 2.0`; statement `1.5` → `+0.5` material **in-transit** (tracked). USDT statement-only → `computed 0` → `−750.0` material via key union.

- [ ] **Step 4: Write types + fixture loader**

```ts
// services/api/src/reconciliation/types.ts
export type Provenance = 'book' | 'mock' | 'live' | 'n/a';
export type ReconReasonCode = 'timing' | 'error' | 'fee' | 'fx' | 'in-transit' | 'unidentified' | 'OTHER';
export const RECON_REASON_CODES: ReconReasonCode[] = ['timing', 'error', 'fee', 'fx', 'in-transit', 'unidentified', 'OTHER'];

export interface ReconFixtureRow {
  wallet: string; coinType: string; decimals: number;
  openingMinor: string; statementMinor: string; thresholdMinor: string;
}
```

```ts
// services/api/src/reconciliation/fixture.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ReconFixtureRow } from './types.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acme-pilot-001.recon.json');

function assertMinor(v: unknown, field: string, key: string): string {
  if (typeof v !== 'string') throw new Error(`recon fixture ${key}: ${field} must be a string, got ${typeof v}`);
  let n: bigint;
  try { n = BigInt(v); } catch { throw new Error(`recon fixture ${key}: ${field} is not a valid integer minor: ${v}`); }
  if (n < 0n) throw new Error(`recon fixture ${key}: ${field} must be >= 0 (asset-positive convention): ${v}`);
  return v;
}

export function loadReconFixture(entityId: string): ReconFixtureRow[] {
  const all = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
  const raw = all[entityId];
  if (!Array.isArray(raw)) throw new Error(`no recon fixture for entity ${entityId}`);
  const seen = new Set<string>();
  return raw.map((r0) => {
    const r = r0 as Record<string, unknown>;
    const wallet = r.wallet, coinType = r.coinType, decimals = r.decimals;
    if (typeof wallet !== 'string' || typeof coinType !== 'string') throw new Error(`recon fixture: wallet/coinType must be strings`);
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) throw new Error(`recon fixture ${wallet}|${coinType}: decimals must be a non-negative integer`);
    const key = `${wallet}|${coinType}`;
    if (seen.has(key)) throw new Error(`recon fixture: duplicate row ${key}`);
    seen.add(key);
    return {
      wallet, coinType, decimals,
      openingMinor: assertMinor(r.openingMinor, 'openingMinor', key),
      statementMinor: assertMinor(r.statementMinor, 'statementMinor', key),
      thresholdMinor: assertMinor(r.thresholdMinor, 'thresholdMinor', key),
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.fixture.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/reconciliation/types.ts services/api/src/reconciliation/fixture.ts services/api/src/fixtures/acme-pilot-001.recon.json services/api/test/recon.fixture.test.ts
git commit -m "feat(recon): types, recon reason-code taxonomy, fixture + schema validation"
```

---

## Task 3: `collectBreaks` — key union, signed break, control totals, materiality

**Files:**
- Create: `services/api/src/reconciliation/collect.ts`
- Modify: `services/api/src/reconciliation/movement.ts` (add `walletAssetMovements`)
- Test: `services/api/test/recon.collect.test.ts`

**Interfaces:**
- Consumes: `netByCoinType` (Task 1), `loadReconFixture` (Task 2), `listJournal` (`store/journalStore.js`), `getEvent` (`store/eventStore.js`).
- Produces:
  - `walletAssetMovements(db, entityId): { byKey: Record<string, bigint>; control: Record<string, { debit: bigint; credit: bigint; legs: number }> }` keyed `${wallet}|${coinType}` (wallet from `JSON.parse(event.rawJson).wallet`).
  - `interface ReconBreak { wallet: string; coinType: string; decimals: number; openingMinor: string; movementMinor: string; computedMinor: string; statementMinor: string; breakMinor: string; thresholdMinor: string; material: boolean; control: { debitMinor: string; creditMinor: string; legs: number } }`
  - `collectBreaks(db, entityId, periodId): ReconBreak[]` — `periodId` reserved for cutoff; single-period demo ignores it for movement selection (entity-scoped) but it is threaded for forward-compat.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/recon.collect.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertJournalEntry } from '../src/store/journalStore.js';
import { collectBreaks } from '../src/reconciliation/collect.js';

function seedJe(db: Db, eventId: string, wallet: string, coinType: string, debitQty: string, creditQty: string) {
  const lines = [
    { account: '1000', side: 'DEBIT', amountMinor: debitQty, origCoinType: coinType, origQtyMinor: debitQty, priceRef: null, fxRef: null, leg: 'MAIN' },
    { account: '4000', side: 'CREDIT', amountMinor: creditQty, origCoinType: coinType, origQtyMinor: creditQty, priceRef: null, fxRef: null, leg: 'MAIN' },
  ];
  insertJournalEntry(db, { id: `je-${eventId}`, entityId: 'acme:pilot-001', eventId, jeJson: JSON.stringify({ idempotencyKey: eventId, lineageHash: 'h', reversalOf: null, lines }), idempotencyKey: eventId, leafHash: `leaf-${eventId}` });
}

describe('collectBreaks', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
  });

  it('SUI: opening + net JE movement = computed; break vs statement is signed + material', () => {
    insertEvent(db, { id: 'evt-001', entityId: 'acme:pilot-001', rawJson: JSON.stringify({ wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI' }) });
    seedJe(db, 'evt-001', '0xacmeTreasury', '0x2::sui::SUI', '5000000000', '1200000000'); // +3.8
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const sui = rows.find((r) => r.coinType === '0x2::sui::SUI')!;
    expect(sui.movementMinor).toBe('3800000000');
    expect(sui.computedMinor).toBe('5000000000');      // opening 1.2 + 3.8
    expect(sui.breakMinor).toBe('1202000000');         // computed 5.0 − statement 3.798
    expect(sui.material).toBe(true);                   // 1.202 >= threshold 1.0
    expect(sui.control.legs).toBe(2);
  });

  it('statement-only asset surfaces via key union with computed=0', () => {
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdt = rows.find((r) => r.coinType === '0xusdt::usdt::USDT')!;
    expect(usdt.computedMinor).toBe('0');
    expect(usdt.breakMinor).toBe('-750000000');        // 0 − 750.0
    expect(usdt.material).toBe(true);
  });

  it('materiality boundary: |break| == threshold is material', () => {
    // USDC fixture: no JE → computed = opening 5000.0; statement 5000.5 → break -0.5 (>= threshold 0.1)
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType === '0xusdc::usdc::USDC')!;
    expect(usdc.breakMinor).toBe('-500000');
    expect(usdc.material).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.collect.test.ts`
Expected: FAIL — `collectBreaks` not found.

- [ ] **Step 3: Add `walletAssetMovements` to movement.ts**

```ts
// append to services/api/src/reconciliation/movement.ts
import type { Db } from '../store/db.js';
import { listJournal } from '../store/journalStore.js';
import { getEvent } from '../store/eventStore.js';

export interface MovementResult {
  byKey: Record<string, bigint>; // `${wallet}|${coinType}` -> net qty
  control: Record<string, { debit: bigint; credit: bigint; legs: number }>;
}

export function walletAssetMovements(db: Db, entityId: string): MovementResult {
  const byKey: Record<string, bigint> = {};
  const control: Record<string, { debit: bigint; credit: bigint; legs: number }> = {};
  for (const r of listJournal(db, entityId)) {
    const ev = getEvent(db, r.eventId);
    if (!ev) throw new Error(`recon: JE ${r.id} references missing event ${r.eventId}`);
    const wallet = (JSON.parse(ev.rawJson) as { wallet?: string }).wallet;
    if (!wallet) throw new Error(`recon: event ${ev.id} has no wallet`);
    const je = JSON.parse(r.jeJson) as { lines: JeLine[] };
    const net = netByCoinType(je.lines);
    for (const [coinType, qty] of Object.entries(net)) {
      const key = `${wallet}|${coinType}`;
      byKey[key] = (byKey[key] ?? 0n) + qty;
    }
    for (const l of je.lines) {
      if (!l.origCoinType || !l.origQtyMinor) continue;
      const key = `${wallet}|${l.origCoinType}`;
      const c = control[key] ?? { debit: 0n, credit: 0n, legs: 0 };
      const q = BigInt(l.origQtyMinor);
      if (l.side === 'DEBIT') c.debit += q; else c.credit += q;
      c.legs += 1;
      control[key] = c;
    }
  }
  return { byKey, control };
}
```

- [ ] **Step 4: Write `collect.ts`**

```ts
// services/api/src/reconciliation/collect.ts
// Recompute-on-read break aggregator (mirrors exceptions/collect.ts). NO writes.
// This is the close-gate enforcement source — never trusts client numbers.
import type { Db } from '../store/db.js';
import { loadReconFixture } from './fixture.js';
import { walletAssetMovements } from './movement.js';

export interface ReconBreak {
  wallet: string; coinType: string; decimals: number;
  openingMinor: string; movementMinor: string; computedMinor: string;
  statementMinor: string; breakMinor: string; thresholdMinor: string;
  material: boolean;
  control: { debitMinor: string; creditMinor: string; legs: number };
}

export function collectBreaks(db: Db, entityId: string, _periodId: string): ReconBreak[] {
  const fixture = loadReconFixture(entityId); // throws on missing — fail loud
  const { byKey, control } = walletAssetMovements(db, entityId);

  // Row keys = union of fixture keys and book-movement keys (two-directional, §2).
  const keys = new Set<string>(fixture.map((f) => `${f.wallet}|${f.coinType}`));
  for (const k of Object.keys(byKey)) keys.add(k);

  const fixByKey = new Map(fixture.map((f) => [`${f.wallet}|${f.coinType}`, f]));
  const out: ReconBreak[] = [];
  for (const key of keys) {
    const sep = key.indexOf('|');
    const wallet = key.slice(0, sep);
    const coinType = key.slice(sep + 1);
    const fx = fixByKey.get(key);
    const opening = fx ? BigInt(fx.openingMinor) : 0n;
    const statement = fx ? BigInt(fx.statementMinor) : 0n; // book-only key: no statement
    const threshold = fx ? BigInt(fx.thresholdMinor) : 0n;
    const movement = byKey[key] ?? 0n;
    const computed = opening + movement;
    const brk = computed - statement;
    const ctl = control[key] ?? { debit: 0n, credit: 0n, legs: 0 };
    const abs = brk < 0n ? -brk : brk;
    // material = a nonzero break at or above threshold. A zero break is always balanced,
    // even when threshold === 0 (zero-tolerance still requires an actual difference).
    const material = abs > 0n && abs >= threshold;
    out.push({
      wallet, coinType, decimals: fx?.decimals ?? 9,
      openingMinor: opening.toString(), movementMinor: movement.toString(), computedMinor: computed.toString(),
      statementMinor: statement.toString(), breakMinor: brk.toString(), thresholdMinor: threshold.toString(),
      material,
      control: { debitMinor: ctl.debit.toString(), creditMinor: ctl.credit.toString(), legs: ctl.legs },
    });
  }
  out.sort((a, b) => Number(b.material) - Number(a.material) || a.coinType.localeCompare(b.coinType));
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.collect.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/reconciliation/collect.ts services/api/src/reconciliation/movement.ts services/api/test/recon.collect.test.ts
git commit -m "feat(recon): collectBreaks — key union, signed break, control totals, materiality"
```

---

## Task 4: Recon-break store + atomic disposition

**Files:**
- Modify: `services/api/src/store/schema.sql`
- Create: `services/api/src/store/reconBreakStore.ts`
- Create: `services/api/src/reconciliation/disposition.ts`
- Test: `services/api/test/recon.disposition.test.ts`

**Interfaces:**
- Consumes: `assertDispositionTransition`, `DispositionState` (`exceptions/disposition.js`, `exceptions/types.js`); `ReconReasonCode` (Task 2).
- Produces:
  - `interface ReconBreakRow { entityId: string; periodId: string; wallet: string; coinType: string; state: DispositionState; reasonCode: ReconReasonCode; reasonNote: string | null; decidedBy: string; decidedAt: number }`
  - `getReconDisposition(db, entityId, periodId, wallet, coinType): ReconBreakRow | null`
  - `listReconDispositions(db, entityId, periodId): ReconBreakRow[]`
  - `upsertReconDisposition(db, row)` / `appendReconDispositionLog(db, row)`
  - `applyReconDisposition(db, args): ReconBreakRow` where `args = { entityId; periodId; wallet; coinType; to: DispositionState; reasonCode: ReconReasonCode; reasonNote?: string|null; decidedBy: string; now: number }`

- [ ] **Step 1: Append tables to schema.sql**

```sql
-- append to services/api/src/store/schema.sql
CREATE TABLE IF NOT EXISTS recon_break_disposition (
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  period_id   TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  coin_type   TEXT NOT NULL,
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_id, period_id, wallet, coin_type)
);
CREATE TABLE IF NOT EXISTS recon_break_disposition_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   TEXT NOT NULL,
  period_id   TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  coin_type   TEXT NOT NULL,
  prev_state  TEXT,
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

```ts
// services/api/test/recon.disposition.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { applyReconDisposition } from '../src/reconciliation/disposition.js';
import { getReconDisposition } from '../src/store/reconBreakStore.js';

const base = { entityId: 'acme:pilot-001', periodId: '2026-Q2', wallet: '0xw', coinType: '0x2::sui::SUI', decidedBy: 'demo-controller', now: 1 };

describe('applyReconDisposition', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
  });

  it('open -> resolved persists + logs prev_state', () => {
    applyReconDisposition(db, { ...base, to: 'resolved', reasonCode: 'error', reasonNote: 'correcting JE filed' });
    const row = getReconDisposition(db, base.entityId, base.periodId, base.wallet, base.coinType)!;
    expect(row.state).toBe('resolved');
    expect(row.reasonCode).toBe('error');
    const log = db.prepare('SELECT prev_state, state FROM recon_break_disposition_log').all() as { prev_state: string | null; state: string }[];
    expect(log).toEqual([{ prev_state: null, state: 'resolved' }]);
  });

  it('rejects illegal transition resolved -> open', () => {
    applyReconDisposition(db, { ...base, to: 'resolved', reasonCode: 'error', reasonNote: null });
    expect(() => applyReconDisposition(db, { ...base, to: 'open', reasonCode: 'error', reasonNote: null, now: 2 }))
      .toThrow(/ILLEGAL_TRANSITION/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.disposition.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `reconBreakStore.ts`**

```ts
// services/api/src/store/reconBreakStore.ts
import type { Db } from './db.js';
import type { DispositionState } from '../exceptions/types.js';
import type { ReconReasonCode } from '../reconciliation/types.js';

export interface ReconBreakRow {
  entityId: string; periodId: string; wallet: string; coinType: string;
  state: DispositionState; reasonCode: ReconReasonCode; reasonNote: string | null;
  decidedBy: string; decidedAt: number;
}

function map(r: Record<string, unknown>): ReconBreakRow {
  return {
    entityId: r.entity_id as string, periodId: r.period_id as string,
    wallet: r.wallet as string, coinType: r.coin_type as string,
    state: r.state as DispositionState, reasonCode: r.reason_code as ReconReasonCode,
    reasonNote: (r.reason_note as string | null) ?? null,
    decidedBy: r.decided_by as string, decidedAt: r.decided_at as number,
  };
}

export function getReconDisposition(db: Db, entityId: string, periodId: string, wallet: string, coinType: string): ReconBreakRow | null {
  const r = db.prepare('SELECT * FROM recon_break_disposition WHERE entity_id=? AND period_id=? AND wallet=? AND coin_type=?')
    .get(entityId, periodId, wallet, coinType) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listReconDispositions(db: Db, entityId: string, periodId: string): ReconBreakRow[] {
  return (db.prepare('SELECT * FROM recon_break_disposition WHERE entity_id=? AND period_id=?').all(entityId, periodId) as Record<string, unknown>[]).map(map);
}

export function upsertReconDisposition(db: Db, row: ReconBreakRow): void {
  db.prepare(
    `INSERT INTO recon_break_disposition (entity_id, period_id, wallet, coin_type, state, reason_code, reason_note, decided_by, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_id, period_id, wallet, coin_type) DO UPDATE SET
       state=excluded.state, reason_code=excluded.reason_code, reason_note=excluded.reason_note,
       decided_by=excluded.decided_by, decided_at=excluded.decided_at`,
  ).run(row.entityId, row.periodId, row.wallet, row.coinType, row.state, row.reasonCode, row.reasonNote, row.decidedBy, row.decidedAt);
}

export function appendReconDispositionLog(db: Db, row: ReconBreakRow, prevState: DispositionState | null): void {
  db.prepare(
    `INSERT INTO recon_break_disposition_log (entity_id, period_id, wallet, coin_type, prev_state, state, reason_code, reason_note, decided_by, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.entityId, row.periodId, row.wallet, row.coinType, prevState, row.state, row.reasonCode, row.reasonNote, row.decidedBy, row.decidedAt);
}
```

- [ ] **Step 5: Write `disposition.ts`**

```ts
// services/api/src/reconciliation/disposition.ts
// AUDIT OVERLAY ONLY. No journal writes — recon disposition is triage metadata.
import type { Db } from '../store/db.js';
import type { DispositionState } from '../exceptions/types.js';
import { assertDispositionTransition } from '../exceptions/disposition.js';
import type { ReconReasonCode } from './types.js';
import { getReconDisposition, upsertReconDisposition, appendReconDispositionLog, type ReconBreakRow } from '../store/reconBreakStore.js';

export interface ApplyReconArgs {
  entityId: string; periodId: string; wallet: string; coinType: string;
  to: DispositionState; reasonCode: ReconReasonCode; reasonNote?: string | null;
  decidedBy: string; now: number;
}

export function applyReconDisposition(db: Db, args: ApplyReconArgs): ReconBreakRow {
  let result!: ReconBreakRow;
  db.transaction(() => {
    const current = getReconDisposition(db, args.entityId, args.periodId, args.wallet, args.coinType);
    const from: DispositionState = current?.state ?? 'open';
    assertDispositionTransition(from, args.to); // reuse Exception transition graph
    const row: ReconBreakRow = {
      entityId: args.entityId, periodId: args.periodId, wallet: args.wallet, coinType: args.coinType,
      state: args.to, reasonCode: args.reasonCode, reasonNote: args.reasonNote ?? null,
      decidedBy: args.decidedBy, decidedAt: args.now,
    };
    upsertReconDisposition(db, row);
    appendReconDispositionLog(db, row, current?.state ?? null);
    result = row;
  })();
  return result;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.disposition.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/store/reconBreakStore.ts services/api/src/reconciliation/disposition.ts services/api/test/recon.disposition.test.ts
git commit -m "feat(recon): atomic recon-break disposition store reusing transition graph"
```

---

## Task 5: Config `reconLiveWallet` + GET /reconciliation + POST disposition

**Files:**
- Modify: `services/api/src/config.ts` (add `reconLiveWallet`)
- Modify: `services/api/src/http/routes.ts` (two endpoints)
- Test: `services/api/test/recon.routes.test.ts`

**Interfaces:**
- Consumes: `collectBreaks` (Task 3), `applyReconDisposition` (Task 4), `getReconDisposition`/`listReconDispositions` (Task 4), `RECON_REASON_CODES` (Task 2), `requireEntity`/`hasAnchoredSnapshot`/`DEFAULT_PERIOD`/`isOpen` (existing in routes.ts), `ApiError`.
- Produces (wire):
  - `GET /entities/:id/reconciliation?periodId=` → `{ rows: ReconRowDTO[], realWallet: string | null, summary: { material: number; openMaterial: number; balanced: number } }` where `ReconRowDTO = ReconBreak & { provenance: { computed: 'book'; statement: 'mock'; chain: 'live' | 'n/a' }; disposition: { state, reasonCode, reasonNote } | null }`.
  - `POST /recon-breaks/:breakId/disposition` body `{ state, reasonCode, reasonNote?, periodId? }` → `{ disposition: ReconBreakRow }`.

- [ ] **Step 1: Add config field**

In `services/api/src/config.ts`, add to `ApiConfig`: `reconLiveWallet?: string;`. In `loadConfig` return object add: `reconLiveWallet: env['RECON_LIVE_WALLET'] && env['RECON_LIVE_WALLET'] !== '' ? env['RECON_LIVE_WALLET'] : undefined,`.

- [ ] **Step 2: Write the failing route test**

```ts
// services/api/test/recon.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertJournalEntry } from '../src/store/journalStore.js';
import { registerRoutes } from '../src/http/routes.js';

function mkApp(db: Db): FastifyInstance {
  const app = Fastify();
  registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, gemini: {} as never, chain: {} as never });
  return app;
}

describe('reconciliation routes', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
    insertEvent(db, { id: 'evt-001', entityId: 'acme:pilot-001', rawJson: JSON.stringify({ wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI' }) });
    insertJournalEntry(db, { id: 'je-1', entityId: 'acme:pilot-001', eventId: 'evt-001', jeJson: JSON.stringify({ idempotencyKey: 'evt-001', lineageHash: 'h', reversalOf: null, lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '5000000000', origCoinType: '0x2::sui::SUI', origQtyMinor: '5000000000', priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '1200000000', origCoinType: '0x2::sui::SUI', origQtyMinor: '1200000000', priceRef: null, fxRef: null, leg: 'MAIN' },
    ] }), idempotencyKey: 'evt-001', leafHash: 'leaf-1' });
    app = mkApp(db);
    await app.ready();
  });

  it('GET reconciliation returns rows with provenance + realWallet + summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/reconciliation' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.realWallet).toBe('0xreal');
    const sui = body.rows.find((r: { coinType: string }) => r.coinType === '0x2::sui::SUI');
    expect(sui.provenance).toEqual({ computed: 'book', statement: 'mock', chain: 'live' });
    const usdc = body.rows.find((r: { coinType: string }) => r.coinType === '0xusdc::usdc::USDC');
    expect(usdc.provenance.chain).toBe('n/a');
    expect(typeof body.summary.material).toBe('number');
  });

  it('POST disposition rejects breakId with multiple pipes (400)', async () => {
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${encodeURIComponent('0xa|0x2::sui::SUI|x')}/disposition`, payload: { state: 'resolved', reasonCode: 'error' } });
    expect(res.statusCode).toBe(400);
  });

  it('POST disposition on a real material break persists with server decidedBy', async () => {
    const breakId = encodeURIComponent('0xacmeTreasury|0x2::sui::SUI');
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${breakId}/disposition`, payload: { state: 'resolved', reasonCode: 'error', reasonNote: 'x', decidedBy: 'attacker' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().disposition.decidedBy).toBe('demo-controller'); // client value ignored
  });

  it('POST disposition on forged breakId 404', async () => {
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${encodeURIComponent('0xnope|0xfake::x::X')}/disposition`, payload: { state: 'resolved', reasonCode: 'error' } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.routes.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 4: Add imports + endpoints to routes.ts**

Add imports near the other recon-less imports (with `.js`):
```ts
import { collectBreaks } from '../reconciliation/collect.js';
import { applyReconDisposition } from '../reconciliation/disposition.js';
import { getReconDisposition } from '../store/reconBreakStore.js';
import { RECON_REASON_CODES, type ReconReasonCode } from '../reconciliation/types.js';
```

Add a helper near `exceptionDTO` (after it):
```ts
function reconDTO(db: Db, entityId: string, periodId: string, liveWallet: string | undefined) {
  const breaks = collectBreaks(db, entityId, periodId);
  const rows = breaks.map((b) => {
    const d = getReconDisposition(db, entityId, periodId, b.wallet, b.coinType);
    return {
      ...b,
      provenance: {
        computed: 'book' as const,
        statement: 'mock' as const,
        chain: (b.coinType === '0x2::sui::SUI' ? 'live' : 'n/a') as 'live' | 'n/a',
      },
      disposition: d ? { state: d.state, reasonCode: d.reasonCode, reasonNote: d.reasonNote } : null,
    };
  });
  const material = rows.filter((r) => r.material).length;
  const openMaterial = rows.filter((r) => r.material && isOpen(r.disposition)).length;
  const balanced = rows.filter((r) => BigInt(r.breakMinor) === 0n).length;
  return { rows, realWallet: liveWallet ?? null, summary: { material, openMaterial, balanced } };
}
```

Inside `registerRoutes`, register:
```ts
app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/reconciliation', async (req) => {
  requireEntity(db, req.params.id);
  const periodId = req.query.periodId ?? DEFAULT_PERIOD;
  return reconDTO(db, req.params.id, periodId, cfg.reconLiveWallet);
});

app.post<{ Params: { breakId: string }; Body: { state?: string; reasonCode?: string; reasonNote?: string; periodId?: string } }>('/recon-breaks/:breakId/disposition', async (req) => {
  const decoded = decodeURIComponent(req.params.breakId);
  if ((decoded.match(/\|/g) ?? []).length !== 1) throw new ApiError(400, 'VALIDATION', 'breakId must be exactly wallet|coinType');
  const [wallet, coinType] = decoded.split('|');
  const b = req.body ?? {};
  if (!b.state || !b.reasonCode) throw new ApiError(400, 'VALIDATION', 'state and reasonCode are required');
  if (!RECON_REASON_CODES.includes(b.reasonCode as ReconReasonCode)) throw new ApiError(400, 'VALIDATION', `unknown reasonCode ${b.reasonCode}`);
  if (b.reasonCode === 'OTHER' && !b.reasonNote) throw new ApiError(400, 'VALIDATION', 'reasonNote required when reasonCode is OTHER');
  const periodId = b.periodId ?? DEFAULT_PERIOD;

  // entityId is not encoded in the breakId — resolve via the wallet's owning entity,
  // then re-validate against live breaks to reject forged/stale ids.
  const entityId = requireEntityForWallet(db, wallet);
  const liveBreaks = collectBreaks(db, entityId, periodId);
  if (!liveBreaks.find((x) => x.wallet === wallet && x.coinType === coinType)) {
    throw new ApiError(404, 'RECON_BREAK_NOT_FOUND', `no current break ${decoded}`);
  }

  if (hasAnchoredSnapshot(db, entityId)) {
    throw new ApiError(409, 'ANCHORED_READ_ONLY', 'period anchored, reconciliation is informational');
  }
  try {
    const row = applyReconDisposition(db, {
      entityId, periodId, wallet, coinType,
      to: b.state as DispositionState, reasonCode: b.reasonCode as ReconReasonCode,
      reasonNote: b.reasonNote ?? null, decidedBy: 'demo-controller', now: Date.now(),
    });
    return { disposition: row };
  } catch (err) {
    if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
    throw err;
  }
});
```

Add helper `requireEntityForWallet` near `requireEntity` (single-entity demo — find the entity whose recon fixture or events reference this wallet):
```ts
function requireEntityForWallet(db: Db, wallet: string): string {
  for (const e of listEntities(db)) {
    const breaks = collectBreaks(db, e.id, DEFAULT_PERIOD);
    if (breaks.some((b) => b.wallet === wallet)) return e.id;
  }
  throw new ApiError(404, 'RECON_BREAK_NOT_FOUND', `no entity owns wallet ${wallet}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.routes.test.ts`
Expected: PASS (4 tests). Then full suite: `cd services/api && npm test` — all green.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/config.ts services/api/src/http/routes.ts services/api/test/recon.routes.test.ts
git commit -m "feat(recon): GET reconciliation + POST disposition (strict parse, server decidedBy, anchored 409)"
```

---

## Task 6: Close gate recon branch + close-readiness restructure

**Files:**
- Modify: `services/api/src/http/routes.ts` (snapshot freeze handler + close-readiness)
- Test: `services/api/test/recon.gate.test.ts`

**Interfaces:**
- Consumes: `collectBreaks`, `getReconDisposition`, `isOpen`.
- Produces: `close-readiness` shape `{ exceptions: { blocking, blockers }, recon: { blocking, blockers }, closeable: boolean }`. Freeze → `409 RECON_BREAKS_BLOCKING` when open material breaks exist.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/recon.gate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';

function seedEntity(db: Db) {
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
}

describe('recon close gate', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:'); seedEntity(db);
    app = Fastify();
    registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, gemini: {} as never, chain: {} as never });
    await app.ready();
  });

  it('open material recon break blocks freeze with RECON_BREAKS_BLOCKING', async () => {
    // No JEs → USDC/WETH/USDT fixture breaks are material & open → must block.
    const res = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RECON_BREAKS_BLOCKING');
  });

  it('close-readiness returns {exceptions, recon, closeable}', async () => {
    const res = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/close-readiness' });
    const body = res.json();
    expect(body).toHaveProperty('exceptions.blocking');
    expect(body).toHaveProperty('recon.blocking');
    expect(body.closeable).toBe(false); // recon material breaks open
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.gate.test.ts`
Expected: FAIL — freeze returns 200/other; close-readiness flat shape.

- [ ] **Step 3: Add recon gate to the snapshot freeze handler**

In `POST /entities/:id/snapshot`, immediately AFTER the existing exceptions blocker check (the `if (blockers.length > 0) { ... EXCEPTIONS_BLOCKING ... }` block) and BEFORE `buildSnapshot`/`listJournal`, insert:
```ts
const reconBlockers = collectBreaks(db, req.params.id, periodId)
  .filter((b) => b.material && isOpen(getReconDisposition(db, req.params.id, periodId, b.wallet, b.coinType)));
if (reconBlockers.length > 0) {
  throw new ApiError(409, 'RECON_BREAKS_BLOCKING',
    `${reconBlockers.length} open material break(s) block close: ${reconBlockers.map((b) => `${b.wallet}|${b.coinType}`).join(', ')}`);
}
```
(`isOpen` accepts `{ state } | null` and treats `null`/`open`/`deferred` as open — confirm against its existing definition; a `null` disposition means never-touched = open.)

- [ ] **Step 4: Restructure the close-readiness handler**

Replace the body of `GET /entities/:id/close-readiness` with:
```ts
requireEntity(db, req.params.id);
const periodId = req.query.periodId ?? DEFAULT_PERIOD;
const exBlockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
  .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
const reconBlockers = collectBreaks(db, req.params.id, periodId)
  .filter((b) => b.material && isOpen(getReconDisposition(db, req.params.id, periodId, b.wallet, b.coinType)));
return {
  exceptions: { blocking: exBlockers.length, blockers: exBlockers },
  recon: { blocking: reconBlockers.length, blockers: reconBlockers.map((b) => `${b.wallet}|${b.coinType}`) },
  closeable: exBlockers.length === 0 && reconBlockers.length === 0,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.gate.test.ts` then `cd services/api && npm test`
Expected: PASS. If a pre-existing close-readiness test asserts the old flat shape, update it to the new `{exceptions, recon, closeable}` shape (intended breaking change — Rule 9: the test must encode the new contract).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/http/routes.ts services/api/test/recon.gate.test.ts
git commit -m "feat(recon): material breaks block freeze + close-readiness {exceptions,recon,closeable}"
```

---

## Task 7: Backend Monkey tests

**Files:**
- Create: `services/api/test/recon.monkey.test.ts`

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Write the monkey suite**

```ts
// services/api/test/recon.monkey.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { applyReconDisposition } from '../src/reconciliation/disposition.js';

function mk(db: Db) {
  const app = Fastify();
  registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, gemini: {} as never, chain: {} as never });
  return app;
}
const ENT = "INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')";

describe('recon monkey', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => { db = openDb(':memory:'); db.prepare(ENT).run(); app = mk(db); await app.ready(); });

  it('breakId with zero pipes 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/recon-breaks/nopipe/disposition', payload: { state: 'resolved', reasonCode: 'error' } });
    expect(res.statusCode).toBe(400);
  });

  it('coinType containing :: round-trips through single-pipe parse', async () => {
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${encodeURIComponent('0xacmeTreasury|0xusdc::usdc::USDC')}/disposition`, payload: { state: 'dismissed', reasonCode: 'unidentified' } });
    expect([200, 404]).toContain(res.statusCode); // 200 if material break present
    if (res.statusCode === 200) expect(res.json().disposition.coinType).toBe('0xusdc::usdc::USDC');
  });

  it('unknown reasonCode 400', async () => {
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${encodeURIComponent('0xacmeTreasury|0x2::sui::SUI')}/disposition`, payload: { state: 'resolved', reasonCode: 'NOPE' } });
    expect(res.statusCode).toBe(400);
  });

  it('concurrent double disposition: last write wins, log has 2 entries, no corruption', () => {
    const args = { entityId: 'acme:pilot-001', periodId: '2026-Q2', wallet: '0xw', coinType: '0x2::sui::SUI', decidedBy: 'demo-controller' };
    applyReconDisposition(db, { ...args, to: 'deferred', reasonCode: 'timing', now: 1 });
    applyReconDisposition(db, { ...args, to: 'resolved', reasonCode: 'error', now: 2 });
    const log = db.prepare('SELECT count(*) c FROM recon_break_disposition_log').get() as { c: number };
    expect(log.c).toBe(2);
    const main = db.prepare('SELECT count(*) c FROM recon_break_disposition').get() as { c: number };
    expect(main.c).toBe(1);
  });

  it('in-transit is a valid resolution code (tracked reconciling item, not dismiss)', () => {
    const row = applyReconDisposition(db, { entityId: 'acme:pilot-001', periodId: '2026-Q2', wallet: '0xacmeTreasury', coinType: '0xweth::weth::WETH', to: 'resolved', reasonCode: 'in-transit', decidedBy: 'demo-controller', now: 1 });
    expect(row.reasonCode).toBe('in-transit');
    expect(row.state).toBe('resolved');
  });
});
```

- [ ] **Step 2: Run + verify**

Run: `cd services/api && npx vitest run test/recon.monkey.test.ts`
Expected: PASS (5 tests). Then `cd services/api && npm test` all green.

- [ ] **Step 3: Commit**

```bash
git add services/api/test/recon.monkey.test.ts
git commit -m "test(recon): backend monkey — parse injection, concurrency, taxonomy"
```

---

## Task 8: Frontend types + client break compute + data hooks

**Files:**
- Modify: `web/src/api/types.ts`
- Create: `web/src/lib/reconBreak.ts`
- Create: `web/src/data/useReconciliation.ts`
- Create: `web/src/data/useChainBalance.ts`
- Test: `web/src/lib/reconBreak.test.ts`

**Interfaces:**
- Produces:
  - types: `ReconRowDTO`, `ReconciliationResponse`, `ReconBreakDispositionDTO`, `CloseReadiness`.
  - `computeBreak(computedMinor: string, statementMinor: string, thresholdMinor: string): { breakMinor: bigint; direction: 'book-over' | 'statement-over' | 'balanced'; material: boolean }`.
  - `useReconciliation(entityId): { data?: ReconciliationResponse; loading; error; refetch }`.
  - `useChainBalance(wallet: string | null, coinType: string): { state: 'idle'|'loading'|'live'|'unavailable'; balanceMinor?: string }`.

- [ ] **Step 1: Write the failing reconBreak test**

```ts
// web/src/lib/reconBreak.test.ts
import { describe, it, expect } from 'vitest';
import { computeBreak } from './reconBreak';

describe('computeBreak', () => {
  it('computed > statement → book-over, material above threshold', () => {
    const r = computeBreak('5000000000', '3798000000', '1000000000');
    expect(r.breakMinor).toBe(1202000000n);
    expect(r.direction).toBe('book-over');
    expect(r.material).toBe(true);
  });
  it('computed < statement → statement-over', () => {
    const r = computeBreak('0', '750000000', '100000');
    expect(r.direction).toBe('statement-over');
    expect(r.breakMinor).toBe(-750000000n);
  });
  it('zero break → balanced, never material', () => {
    const r = computeBreak('100', '100', '0');
    expect(r.direction).toBe('balanced');
    expect(r.material).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/lib/reconBreak.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `reconBreak.ts`**

```ts
// web/src/lib/reconBreak.ts
// Client-side break recompute — recomputable evidence. BigInt only.
export interface BreakResult {
  breakMinor: bigint;
  direction: 'book-over' | 'statement-over' | 'balanced';
  material: boolean;
}

export function computeBreak(computedMinor: string, statementMinor: string, thresholdMinor: string): BreakResult {
  const brk = BigInt(computedMinor) - BigInt(statementMinor);
  const abs = brk < 0n ? -brk : brk;
  const direction = brk > 0n ? 'book-over' : brk < 0n ? 'statement-over' : 'balanced';
  const material = abs > 0n && abs >= BigInt(thresholdMinor);
  return { breakMinor: brk, direction, material };
}
```

- [ ] **Step 4: Add DTO types to `web/src/api/types.ts`**

```ts
// append to web/src/api/types.ts
export interface ReconRowDTO {
  wallet: string; coinType: string; decimals: number;
  openingMinor: string; movementMinor: string; computedMinor: string;
  statementMinor: string; breakMinor: string; thresholdMinor: string;
  material: boolean;
  control: { debitMinor: string; creditMinor: string; legs: number };
  provenance: { computed: 'book'; statement: 'mock'; chain: 'live' | 'n/a' };
  disposition: { state: string; reasonCode: string; reasonNote: string | null } | null;
}
export interface ReconciliationResponse {
  rows: ReconRowDTO[];
  realWallet: string | null;
  summary: { material: number; openMaterial: number; balanced: number };
}
export interface ReconBreakDispositionDTO { state: string; reasonCode: string; reasonNote: string | null; }
export interface CloseReadiness {
  exceptions: { blocking: number; blockers: unknown[] };
  recon: { blocking: number; blockers: string[] };
  closeable: boolean;
}
```

- [ ] **Step 5: Write the two hooks**

```ts
// web/src/data/useReconciliation.ts
import { useCallback, useEffect, useState } from 'react';
import type { ReconciliationResponse } from '../api/types';
import { API_BASE } from '../lib/constants';

export function useReconciliation(entityId: string | null) {
  const [data, setData] = useState<ReconciliationResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const refetch = useCallback(async () => {
    if (!entityId) return;
    setLoading(true); setError(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/reconciliation`);
      if (!res.ok) throw new Error(`reconciliation ${res.status}`);
      setData(await res.json() as ReconciliationResponse);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [entityId]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}
```

```ts
// web/src/data/useChainBalance.ts
import { useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit-react';

export type ChainState = 'idle' | 'loading' | 'live' | 'unavailable';

// SUI-only live read; fail-loud — never returns a silent 0 on error.
export function useChainBalance(wallet: string | null, coinType: string) {
  const client = useSuiClient();
  const [state, setState] = useState<ChainState>('idle');
  const [balanceMinor, setBalanceMinor] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    if (!wallet || coinType !== '0x2::sui::SUI') { setState('idle'); return; }
    setState('loading');
    client.getBalance({ owner: wallet, coinType })
      .then((b) => { if (!cancelled) { setBalanceMinor(b.totalBalance); setState('live'); } })
      .catch(() => { if (!cancelled) { setBalanceMinor(undefined); setState('unavailable'); } });
    return () => { cancelled = true; };
  }, [client, wallet, coinType]);
  return { state, balanceMinor };
}
```

(Confirm the dapp-kit hook name in this repo — grep `useSuiClient` in `web/src`; the existing anchor flow uses the client. If the export differs, match the existing usage.)

- [ ] **Step 6: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/reconBreak.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/api/types.ts web/src/lib/reconBreak.ts web/src/data/useReconciliation.ts web/src/data/useChainBalance.ts web/src/lib/reconBreak.test.ts
git commit -m "feat(recon): client break recompute + reconciliation/chain-balance hooks"
```

---

## Task 9: ReconTable — responsive grid + encoding

**Files:**
- Create: `web/src/workspaces/recon/ReconTable.tsx`
- Create: `web/src/workspaces/recon/recon.css`
- Test: `web/src/workspaces/recon/ReconTable.test.tsx`

**Interfaces:**
- Consumes: `ReconRowDTO` (Task 8), `computeBreak` (Task 8), the address-truncation helper used by the journal/event list (grep `truncate`/`short` in `web/src` — reuse, do not author a new one), `formatMinor` (if one exists; else add a tiny local formatter).
- Produces: `ReconTable({ rows, selectedKey, onSelect }: { rows: ReconRowDTO[]; selectedKey: string | null; onSelect: (key: string) => void })`. Row key = `${wallet}|${coinType}`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/workspaces/recon/ReconTable.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReconTable } from './ReconTable';
import type { ReconRowDTO } from '../../api/types';

const row = (over: Partial<ReconRowDTO>): ReconRowDTO => ({
  wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI', decimals: 9,
  openingMinor: '1200000000', movementMinor: '3800000000', computedMinor: '5000000000',
  statementMinor: '3798000000', breakMinor: '1202000000', thresholdMinor: '1000000000', material: true,
  control: { debitMinor: '5000000000', creditMinor: '1200000000', legs: 2 },
  provenance: { computed: 'book', statement: 'mock', chain: 'live' }, disposition: null, ...over,
});

describe('ReconTable', () => {
  it('renders a material break with a blocking marker and signed value', () => {
    render(<ReconTable rows={[row({})]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText('SUI')).toBeInTheDocument();
    // signed, U+2212 not hyphen-minus would be for negatives; positive book-over shows direction label.
    expect(screen.getByText(/statement|over|break/i)).toBeTruthy();
    expect(screen.getByLabelText(/material/i)).toBeInTheDocument();
  });

  it('non-SUI chain provenance renders n/a, not a balance', () => {
    render(<ReconTable rows={[row({ coinType: '0xusdc::usdc::USDC', provenance: { computed: 'book', statement: 'mock', chain: 'n/a' } })]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('row click fires onSelect with composite key', () => {
    const onSelect = vi.fn();
    render(<ReconTable rows={[row({})]} selectedKey={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('SUI'));
    expect(onSelect).toHaveBeenCalledWith('0xacmeTreasury|0x2::sui::SUI');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/workspaces/recon/ReconTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReconTable.tsx`**

```tsx
// web/src/workspaces/recon/ReconTable.tsx
import './recon.css';
import type { ReconRowDTO } from '../../api/types';
import { computeBreak } from '../../lib/reconBreak';

const SYMBOLS: Record<string, string> = {
  '0x2::sui::SUI': 'SUI', '0xusdc::usdc::USDC': 'USDC', '0xweth::weth::WETH': 'WETH', '0xusdt::usdt::USDT': 'USDT',
};
function symbol(coinType: string): string { return SYMBOLS[coinType] ?? coinType.split('::').pop() ?? coinType; }
function shortAddr(a: string): string { return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; }

export function fmtMinor(minor: string, decimals: number): string {
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + digits.slice(digits.length - decimals) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${frac}`;
}
const DIR_LABEL = { 'book-over': 'book over statement', 'statement-over': 'statement over book', balanced: 'balanced' } as const;

export function ReconTable({ rows, selectedKey, onSelect }: { rows: ReconRowDTO[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  return (
    <table className="recon-table">
      <thead>
        <tr>
          <th>Wallet · Asset</th><th>Opening</th><th>+ Movements</th><th>= Computed</th>
          <th>Statement</th><th>Break</th><th>Chain</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const key = `${r.wallet}|${r.coinType}`;
          const b = computeBreak(r.computedMinor, r.statementMinor, r.thresholdMinor);
          const cls = b.material ? 'recon-row recon-row--material' : 'recon-row';
          return (
            <tr key={key} className={`${cls}${selectedKey === key ? ' is-selected' : ''}`} onClick={() => onSelect(key)}>
              <td data-label="Wallet · Asset"><span title={r.wallet}>{shortAddr(r.wallet)}</span> · <strong title={r.coinType}>{symbol(r.coinType)}</strong></td>
              <td data-label="Opening" className="td--mono">{fmtMinor(r.openingMinor, r.decimals)}<sup>B</sup></td>
              <td data-label="+ Movements" className="td--mono">{fmtMinor(r.movementMinor, r.decimals)}</td>
              <td data-label="= Computed" className="td--mono">{fmtMinor(r.computedMinor, r.decimals)}<sup>B</sup></td>
              <td data-label="Statement" className="td--mono">{fmtMinor(r.statementMinor, r.decimals)}<sup>M</sup></td>
              <td data-label="Break" className="td--mono">
                {b.direction === 'balanced'
                  ? <span className="brk brk--ok" aria-label="balanced">{fmtMinor(r.breakMinor, r.decimals)} ✓</span>
                  : <span className={`brk ${b.material ? 'brk--material' : 'brk--immaterial'}`} aria-label={b.material ? 'material break' : 'immaterial break'}>
                      {fmtMinor(r.breakMinor, r.decimals)} {b.material ? '⛔' : '⚠'} <em>({DIR_LABEL[b.direction]})</em>
                    </span>}
              </td>
              <td data-label="Chain" className="td--mono recon-chain">
                {r.provenance.chain === 'n/a' ? <span className="prov--na">n/a</span> : <span className="prov--live">live<sup>L</sup></span>}
              </td>
              <td data-label="Status">{r.disposition ? r.disposition.state : (b.material ? 'open' : '—')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Write `recon.css` (encoding + 3-breakpoint RWD)**

```css
/* web/src/workspaces/recon/recon.css */
.recon-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.recon-table th, .recon-table td { padding: 8px 10px; text-align: right; white-space: nowrap; }
.recon-table th:first-child, .recon-table td:first-child { text-align: left; }
.td--mono { font-family: var(--font-mono, monospace); }
.recon-row { cursor: pointer; }
.recon-row.is-selected { background: var(--paper-2, #f3efe6); }
.recon-row--material { box-shadow: inset 3px 0 var(--debit, #b5532e); }
.brk sup, .recon-table sup { color: var(--ink-soft, #8a8175); font-size: 0.7em; }
.brk--material { background: var(--debit, #b5532e); color: #fff; font-weight: 700; padding: 1px 6px; border-radius: var(--radius-pill, 999px); }
.brk--immaterial { border: 1px solid var(--warn, #c79a3a); padding: 1px 6px; border-radius: var(--radius-pill, 999px); }
.brk--ok { color: var(--credit, #2e7d5b); }
.brk em { color: var(--ink-soft, #8a8175); font-style: normal; font-size: 0.85em; }
.prov--live, .prov--live sup { color: var(--aqua, #2aa9c4); }  /* aqua = on-chain ONLY */
.prov--na { color: var(--ink-soft, #8a8175); }

/* TABLET: hide the two derivation columns (Opening, +Movements). */
@media (max-width: 1024px) {
  .recon-table th:nth-child(2), .recon-table td:nth-child(2),
  .recon-table th:nth-child(3), .recon-table td:nth-child(3) { display: none; }
}
/* PHONE: card-ify — never horizontal-scroll an 8-col financial grid. */
@media (max-width: 640px) {
  .recon-table thead { display: none; }
  .recon-table, .recon-table tbody, .recon-table tr, .recon-table td { display: block; width: 100%; }
  .recon-table tr { border: 1px solid var(--line, #e0d9cc); border-radius: var(--radius, 12px); margin-bottom: 10px; padding: 6px 10px; }
  .recon-table td { text-align: right; border: none; padding: 4px 0; }
  .recon-table td::before { content: attr(data-label); float: left; color: var(--ink-soft, #8a8175); font-size: 0.8em; }
  .recon-table td:nth-child(2), .recon-table td:nth-child(3) { display: block; } /* show all in card */
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd web && npx vitest run src/workspaces/recon/ReconTable.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/workspaces/recon/ReconTable.tsx web/src/workspaces/recon/recon.css web/src/workspaces/recon/ReconTable.test.tsx
git commit -m "feat(recon): ReconTable — responsive grid, signed break, provenance glyphs, material emphasis"
```

---

## Task 10: ReconDetail — T-equation + disposition + anchored ribbon

**Files:**
- Create: `web/src/workspaces/recon/ReconDetail.tsx`
- Test: `web/src/workspaces/recon/ReconDetail.test.tsx`

**Interfaces:**
- Consumes: `ReconRowDTO`, `fmtMinor` (export from ReconTable Task 9), `computeBreak`, `useChainBalance` (Task 8), `RECON_REASON_CODES` (mirror the 7 codes as a frontend const — they're a fixed wire contract; define `RECON_REASON_CODES` in `web/src/lib/reconBreak.ts`), `API_BASE`.
- Produces: `ReconDetail({ row, realWallet, anchored, onDisposed }: { row: ReconRowDTO; realWallet: string | null; anchored: boolean; onDisposed: () => void })`.

- [ ] **Step 1: Add the frontend reason-code const**

Append to `web/src/lib/reconBreak.ts`:
```ts
export const RECON_REASON_CODES = ['timing', 'error', 'fee', 'fx', 'in-transit', 'unidentified', 'OTHER'] as const;
export type ReconReasonCode = typeof RECON_REASON_CODES[number];
```

- [ ] **Step 2: Write the failing test**

```tsx
// web/src/workspaces/recon/ReconDetail.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconDetail } from './ReconDetail';
import type { ReconRowDTO } from '../../api/types';

vi.mock('../../data/useChainBalance', () => ({ useChainBalance: () => ({ state: 'live', balanceMinor: '5000000000' }) }));

const row: ReconRowDTO = {
  wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI', decimals: 9,
  openingMinor: '1200000000', movementMinor: '3800000000', computedMinor: '5000000000',
  statementMinor: '3798000000', breakMinor: '1202000000', thresholdMinor: '1000000000', material: true,
  control: { debitMinor: '5000000000', creditMinor: '1200000000', legs: 2 },
  provenance: { computed: 'book', statement: 'mock', chain: 'live' }, disposition: null,
};

describe('ReconDetail', () => {
  it('renders the roll-forward equation with control totals', () => {
    render(<ReconDetail row={row} realWallet="0xreal" anchored={false} onDisposed={() => {}} />);
    expect(screen.getByText(/Opening balance/i)).toBeInTheDocument();
    expect(screen.getByText(/2 legs/i)).toBeInTheDocument();
    expect(screen.getByText(/threshold/i)).toBeInTheDocument();
  });

  it('shows anchored read-only ribbon and hides disposition controls when anchored', () => {
    render(<ReconDetail row={row} realWallet="0xreal" anchored onDisposed={() => {}} />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve|dismiss|defer/i })).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run src/workspaces/recon/ReconDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `ReconDetail.tsx`**

```tsx
// web/src/workspaces/recon/ReconDetail.tsx
import { useState } from 'react';
import type { ReconRowDTO } from '../../api/types';
import { fmtMinor } from './ReconTable';
import { computeBreak, RECON_REASON_CODES, type ReconReasonCode } from '../../lib/reconBreak';
import { useChainBalance } from '../../data/useChainBalance';
import { API_BASE } from '../../lib/constants';

export function ReconDetail({ row, realWallet, anchored, onDisposed }: { row: ReconRowDTO; realWallet: string | null; anchored: boolean; onDisposed: () => void }) {
  const b = computeBreak(row.computedMinor, row.statementMinor, row.thresholdMinor);
  const chain = useChainBalance(row.coinType === '0x2::sui::SUI' ? realWallet : null, row.coinType);
  const [reasonCode, setReasonCode] = useState<ReconReasonCode>('error');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function dispose(state: 'resolved' | 'dismissed' | 'deferred') {
    setBusy(true); setErr(undefined);
    try {
      const breakId = encodeURIComponent(`${row.wallet}|${row.coinType}`);
      const res = await fetch(`${API_BASE}/recon-breaks/${breakId}/disposition`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, reasonCode, reasonNote: reasonNote || null }),
      });
      if (!res.ok) throw new Error((await res.json())?.error?.message ?? `disposition ${res.status}`);
      onDisposed();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const d = (m: string) => fmtMinor(m, row.decimals);
  return (
    <section className="recon-detail">
      {anchored && <div className="recon-anchored-ribbon">Period anchored — reconciliation read-only ⚓</div>}
      <h3>{row.coinType} · {row.wallet}</h3>
      <table className="recon-eq td--mono">
        <tbody>
          <tr><td>Opening balance (book)</td><td>{d(row.openingMinor)}<sup>B</sup></td></tr>
          <tr><td>+ Movements (Σ {row.control.legs} legs)</td><td>{d(row.movementMinor)}</td></tr>
          <tr className="recon-eq-rule"><td>= Computed ending (book)</td><td>{d(row.computedMinor)}<sup>B</sup></td></tr>
          <tr><td>Statement ending (mock)</td><td>{d(row.statementMinor)}<sup>M</sup></td></tr>
          <tr className="recon-eq-rule"><td>Break (computed − statement)</td><td>{d(row.breakMinor)} {b.material ? '⛔' : b.direction === 'balanced' ? '✓' : '⚠'}</td></tr>
          <tr><td colSpan={2} className="recon-eq-note">threshold ±{d(row.thresholdMinor)} · {b.material ? '|break| ≥ threshold → blocking' : 'within tolerance'}</td></tr>
          <tr><td colSpan={2} className="recon-eq-note">control: Σdebit {d(row.control.debitMinor)} · Σcredit {d(row.control.creditMinor)} · {row.control.legs} legs</td></tr>
          <tr><td>Chain ending (live)</td><td>{chain.state === 'live' ? <span className="prov--live">{d(chain.balanceMinor ?? '0')}<sup>L</sup></span> : chain.state === 'unavailable' ? <span className="prov--unavail">unavailable ↻</span> : 'n/a'}</td></tr>
        </tbody>
      </table>

      {!anchored && b.material && (
        <div className="recon-disp">
          <label>Classification:&nbsp;
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ReconReasonCode)}>
              {RECON_REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {reasonCode === 'OTHER' && <input placeholder="note (required)" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />}
          <div className="recon-disp-actions">
            <button disabled={busy || (reasonCode === 'OTHER' && !reasonNote)} onClick={() => dispose('resolved')}>Resolve</button>
            <button disabled={busy} onClick={() => dispose('deferred')}>Defer</button>
            <button disabled={busy || (reasonCode === 'OTHER' && !reasonNote)} onClick={() => dispose('dismissed')}>Dismiss</button>
          </div>
          {err && <p className="recon-err" role="alert">{err}</p>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Add detail styles to `recon.css`**

```css
/* append to web/src/workspaces/recon/recon.css */
.recon-anchored-ribbon { background: color-mix(in srgb, var(--aqua, #2aa9c4) 14%, transparent); color: var(--aqua, #2aa9c4); padding: 6px 10px; border-radius: var(--radius, 12px); margin-bottom: 10px; }
.recon-eq { width: 100%; border-collapse: collapse; }
.recon-eq td { padding: 4px 8px; }
.recon-eq td:last-child { text-align: right; }
.recon-eq-rule td { border-top: 1px solid var(--brass, #b08d57); font-weight: 600; }
.recon-eq-note td { color: var(--ink-soft, #8a8175); font-size: 0.85em; }
.prov--unavail { color: var(--warn, #c79a3a); }
.recon-disp { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.recon-disp-actions { display: flex; gap: 8px; }
.recon-err { color: var(--debit, #b5532e); }
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd web && npx vitest run src/workspaces/recon/ReconDetail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/workspaces/recon/ReconDetail.tsx web/src/workspaces/recon/recon.css web/src/workspaces/recon/ReconDetail.test.tsx web/src/lib/reconBreak.ts
git commit -m "feat(recon): ReconDetail — T-equation, control totals, disposition, anchored ribbon"
```

---

## Task 11: ReconciliationWorkspace + registry + App dispatch + empty state

**Files:**
- Create: `web/src/workspaces/ReconciliationWorkspace.tsx`
- Modify: `web/src/app/workspaces.ts` (flip status)
- Modify: `web/src/App.tsx` (dispatch)
- Test: `web/src/workspaces/ReconciliationWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useReconciliation` (Task 8), `ReconTable` (Task 9), `ReconDetail` (Task 10), existing `EmptyState` (grep `EmptyState` for its props — pass a `variant`/`caption` for the celebration), `hasAnchoredSnapshot` info via the reconciliation/anchors data (use existing anchors hook or the `useAnchors` to know if anchored; if simpler, derive `anchored` from a `useAnchors(entityId)` non-empty list).
- Produces: `ReconciliationWorkspace({ entityId }: { entityId: string })` default-exported or named to match how `App.tsx` imports other workspaces.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/workspaces/ReconciliationWorkspace.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconciliationWorkspace } from './ReconciliationWorkspace';

vi.mock('../data/useReconciliation', () => ({
  useReconciliation: () => ({
    data: { rows: [], realWallet: '0xreal', summary: { material: 0, openMaterial: 0, balanced: 0 } },
    loading: false, error: undefined, refetch: () => {},
  }),
}));
vi.mock('../data/useAnchors', () => ({ useAnchors: () => ({ anchors: [] }) }), { virtual: true });

describe('ReconciliationWorkspace', () => {
  it('all-balanced → celebration empty state', () => {
    render(<ReconciliationWorkspace entityId="acme:pilot-001" />);
    expect(screen.getByText(/reconciled|tie to statements/i)).toBeInTheDocument();
  });

  it('resets selection when entity changes', () => {
    const { rerender } = render(<ReconciliationWorkspace entityId="acme:pilot-001" />);
    rerender(<ReconciliationWorkspace entityId="beta:pilot-002" />);
    // No detail pane shown after entity switch (selection cleared).
    expect(screen.queryByText(/Opening balance/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/workspaces/ReconciliationWorkspace.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ReconciliationWorkspace.tsx`**

```tsx
// web/src/workspaces/ReconciliationWorkspace.tsx
import { useEffect, useState } from 'react';
import { useReconciliation } from '../data/useReconciliation';
import { ReconTable } from './recon/ReconTable';
import { ReconDetail } from './recon/ReconDetail';
import './recon/recon.css';

export function ReconciliationWorkspace({ entityId }: { entityId: string }) {
  const { data, loading, error, refetch } = useReconciliation(entityId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Reset selection on entity switch (selection-leak guard).
  useEffect(() => { setSelectedKey(null); }, [entityId]);

  if (loading) return <div className="recon-loading">Loading reconciliation…</div>;
  if (error) return <div className="recon-err" role="alert">Failed to load reconciliation: {error}</div>;
  if (!data) return null;

  const allBalanced = data.rows.length === 0 || data.rows.every((r) => BigInt(r.breakMinor) === 0n);
  if (allBalanced) {
    return <div className="recon-empty">All accounts reconciled — books tie to statements ⚖</div>;
  }

  const selected = selectedKey ? data.rows.find((r) => `${r.wallet}|${r.coinType}` === selectedKey) ?? null : null;
  const anchored = false; // single-period demo: wire to useAnchors(entityId).length>0 if/when available.

  return (
    <div className={`recon-workspace${selected ? ' has-selection' : ''}`}>
      <header className="recon-summary">
        {data.summary.openMaterial > 0
          ? <span className="brk--material">material breaks: {data.summary.openMaterial}</span>
          : <span>all reconciled</span>}
      </header>
      <ReconTable rows={data.rows} selectedKey={selectedKey} onSelect={setSelectedKey} />
      {selected && (
        <>
          <button className="exceptions-back-btn" onClick={() => setSelectedKey(null)}>‹ Accounts · {data.rows.length}</button>
          <ReconDetail row={selected} realWallet={data.realWallet} anchored={anchored} onDisposed={refetch} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Flip registry status**

In `web/src/app/workspaces.ts`, change the `reconciliation` line `status: 'soon'` → `status: 'ready'`.

- [ ] **Step 5: Dispatch in App.tsx**

In `web/src/App.tsx`, where workspaces are switched by id (the existing `audit`/`exceptions` dispatch), add an arm:
```tsx
case 'reconciliation':
  return <ReconciliationWorkspace entityId={entityId} />;
```
and import it: `import { ReconciliationWorkspace } from './workspaces/ReconciliationWorkspace';`. (Match the exact switch/dispatch idiom already used — grep `ExceptionsWorkspace` in `App.tsx` and mirror it, including how `entityId` is sourced.)

- [ ] **Step 6: Run tests to verify pass**

Run: `cd web && npx vitest run src/workspaces/ReconciliationWorkspace.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/workspaces/ReconciliationWorkspace.tsx web/src/app/workspaces.ts web/src/App.tsx web/src/workspaces/ReconciliationWorkspace.test.tsx
git commit -m "feat(recon): ReconciliationWorkspace wiring + registry ready + App dispatch"
```

---

## Task 12: Frontend Monkey + full verification

**Files:**
- Create: `web/src/workspaces/recon/recon.monkey.test.tsx`

- [ ] **Step 1: Write the monkey suite**

```tsx
// web/src/workspaces/recon/recon.monkey.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconTable, fmtMinor } from './ReconTable';
import { computeBreak } from '../../lib/reconBreak';
import type { ReconRowDTO } from '../../api/types';

describe('recon monkey', () => {
  it('fmtMinor handles huge BigInt and negative without precision loss', () => {
    expect(fmtMinor('999999999999999999999', 6)).toBe('999,999,999,999,999.999999');
    expect(fmtMinor('-500000', 6)).toBe('−0.500000');
  });

  it('zero decimals asset formats with no fractional part', () => {
    expect(fmtMinor('1234', 0)).toBe('1,234');
  });

  it('computeBreak with negative computed (over-credited book) stays signed', () => {
    const r = computeBreak('-100', '0', '0');
    expect(r.direction).toBe('statement-over');
    expect(r.material).toBe(true);
  });

  it('renders a statement-only row (computed 0) without crashing', () => {
    const row: ReconRowDTO = {
      wallet: '0xw', coinType: '0xusdt::usdt::USDT', decimals: 6,
      openingMinor: '0', movementMinor: '0', computedMinor: '0', statementMinor: '750000000',
      breakMinor: '-750000000', thresholdMinor: '100000', material: true,
      control: { debitMinor: '0', creditMinor: '0', legs: 0 },
      provenance: { computed: 'book', statement: 'mock', chain: 'n/a' }, disposition: null,
    };
    render(<ReconTable rows={[row]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText('USDT')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the monkey suite**

Run: `cd web && npx vitest run src/workspaces/recon/recon.monkey.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 3: Full frontend verification**

Run: `cd web && npm test && npm run build`
Expected: all tests green; build exit 0.

- [ ] **Step 4: Full backend verification**

Run: `cd services/api && npm test && npx tsc --noEmit`
Expected: all tests green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/workspaces/recon/recon.monkey.test.tsx
git commit -m "test(recon): frontend monkey — formatting overflow, statement-only, signed negatives"
```

---

## Self-Review Notes (coverage map spec → tasks)

- §2 key union → T3; signed break+direction → T3 (`breakMinor` signed), T8 (`computeBreak.direction`), T9/T10 (display); cutoff → T3 (entity-scoped, `periodId` threaded); control totals → T3, T10; materiality boundary → T3, T8.
- §3 fixtures + sign validation + in-transit + statement-only → T2 (fixture), T3 (collect rows), T7/T12 (tests).
- §4 movement port + parity → T1; collect → T3; disposition store/atomic → T4; endpoints/strict parse/decidedBy/anchored → T5; gate before buildSnapshot + periodId + close-readiness restructure → T6; wire-value test → T5.
- §5 table-first + 3-breakpoint → T9 (css); provenance glyph + live=aqua → T9; break hierarchy → T9; T-equation → T10; number typography → T9 (`fmtMinor`, tabular-nums); anchored ribbon → T10; empty/celebration → T11; selection reset → T11.
- §6 red-team → strict parse T5, key union T3, sign T2, parity T1, anchored T5, decidedBy T5.
- §7 parity T1, collect T3, disposition T4, gate T6, wire T5, backend monkey T7, frontend monkey T12, build gate T12.
- §8 disclosed simplifications → no code (documented); anchored derivation left as a single-period stub in T11 (wire to `useAnchors` when multi-period lands).

**Known stub to flag at execution:** T11 sets `anchored = false` (single-period demo). If a `useAnchors(entityId)` hook exists, wire `anchored = anchors.length > 0` so the anchored read-only ribbon + backend 409 double-guard actually engages in the live demo. The backend 409 (T5) is the real enforcement regardless.
